// Device pairing & credential management
//
// Flow:
//   1. Server starts → auto-generates pairTokens (6-char, 30min TTL)
//   2. User scans QR / enters code on phone → POST /api/pair
//   3. Server validates pairToken → issues permanent deviceToken
//   4. Device stores deviceToken → uses for all subsequent requests
//
// Pair tokens are stored in-memory only (no persistence).
// Device tokens are persisted to ~/.cli-mobile/devices.json.

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir, networkInterfaces } from 'node:os';
import { join } from 'node:path';

// ── Types ──

export interface PairedDevice {
  id: string;
  name: string;
  token: string; // 64-char hex
  createdAt: number;
  lastSeen: number;
}

interface PairEntry {
  token: string;
  createdAt: number;
  used: boolean;
}

interface DeviceStore {
  devices: PairedDevice[];
}

// ── Constants ──

const DEVICES_PATH = join(homedir(), '.cli-mobile', 'devices.json');
const PAIR_TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes
const PAIR_TOKEN_LENGTH = 6; // e.g. "A3F9K2"
const DEVICE_TOKEN_BYTES = 32; // 64 hex chars
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // clean expired pair tokens every 5 min

// ── In-memory pair token store ──

const pairTokens = new Map<string, PairEntry>();
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function startCleanup(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [token, entry] of pairTokens) {
      if (now - entry.createdAt > PAIR_TOKEN_TTL_MS) {
        pairTokens.delete(token);
      }
    }
  }, CLEANUP_INTERVAL_MS);
  cleanupTimer.unref(); // don't prevent process exit
}

// ── Pair token (short-lived, in-memory) ──

const PAIR_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1 for readability

function randomPairToken(): string {
  const bytes = randomBytes(PAIR_TOKEN_LENGTH);
  let result = '';
  for (let i = 0; i < PAIR_TOKEN_LENGTH; i++) {
    result += PAIR_CHARS[bytes[i]! % PAIR_CHARS.length]!;
  }
  return result;
}

/**
 * Generate a new 6-character pairing token. Valid for 30 minutes.
 * Prints the token to stdout for the terminal QR code display.
 */
export function generatePairToken(): string {
  startCleanup();
  // Reuse existing unused token if still valid
  for (const [token, entry] of pairTokens) {
    if (!entry.used && Date.now() - entry.createdAt < PAIR_TOKEN_TTL_MS) {
      return token;
    }
  }
  const token = randomPairToken();
  pairTokens.set(token, { token, createdAt: Date.now(), used: false });
  return token;
}

/**
 * Validate and consume a pairing token. Returns true if valid and unused.
 */
export function validatePairToken(token: string): boolean {
  const entry = pairTokens.get(token.toUpperCase());
  if (!entry) return false;
  if (entry.used) return false;
  if (Date.now() - entry.createdAt > PAIR_TOKEN_TTL_MS) {
    pairTokens.delete(token);
    return false;
  }
  entry.used = true;
  pairTokens.delete(token); // one-time use only
  return true;
}

/**
 * Get info about a pair token (for display). Returns null if not found.
 */
export function getPairTokenInfo(token: string): { remainingMs: number } | null {
  const entry = pairTokens.get(token.toUpperCase());
  if (!entry || entry.used) return null;
  const elapsed = Date.now() - entry.createdAt;
  if (elapsed > PAIR_TOKEN_TTL_MS) {
    pairTokens.delete(token);
    return null;
  }
  return { remainingMs: PAIR_TOKEN_TTL_MS - elapsed };
}

// ── Device token (permanent, persisted) ──

function randomDeviceToken(): string {
  return randomBytes(DEVICE_TOKEN_BYTES).toString('hex');
}

function randomDeviceId(): string {
  return randomBytes(8).toString('hex'); // 16-char
}

async function readDeviceStore(): Promise<DeviceStore> {
  try {
    const text = await readFile(DEVICES_PATH, 'utf8');
    return JSON.parse(text) as DeviceStore;
  } catch {
    return { devices: [] };
  }
}

async function writeDeviceStore(store: DeviceStore): Promise<void> {
  await mkdir(join(homedir(), '.cli-mobile'), { recursive: true });
  await writeFile(DEVICES_PATH, JSON.stringify(store, null, 2) + '\n', 'utf8');
}

/**
 * Create a new paired device. Returns the device record with its permanent token.
 */
export async function createDevice(name: string): Promise<PairedDevice> {
  const store = await readDeviceStore();
  const device: PairedDevice = {
    id: randomDeviceId(),
    name: name || 'Unknown Device',
    token: randomDeviceToken(),
    createdAt: Date.now(),
    lastSeen: Date.now(),
  };
  store.devices.push(device);
  await writeDeviceStore(store);
  return device;
}

/**
 * Validate a device token. Returns the device info if valid.
 * Uses timingSafeEqual to prevent timing attacks.
 */
export async function validateDevice(token: string): Promise<PairedDevice | null> {
  if (!token || token.length < 32) return null;
  const store = await readDeviceStore();
  const tokenBuf = Buffer.from(token);

  for (const device of store.devices) {
    const deviceBuf = Buffer.from(device.token);
    if (deviceBuf.length !== tokenBuf.length) continue;
    if (timingSafeEqual(tokenBuf, deviceBuf)) {
      // Update lastSeen
      device.lastSeen = Date.now();
      // Persist asynchronously (don't block validation)
      writeDeviceStore(store).catch(() => {});
      return device;
    }
  }
  return null;
}

/**
 * List all paired devices.
 */
export async function listDevices(): Promise<PairedDevice[]> {
  const store = await readDeviceStore();
  return store.devices;
}

/**
 * Revoke (delete) a paired device by ID.
 */
export async function revokeDevice(id: string): Promise<boolean> {
  const store = await readDeviceStore();
  const idx = store.devices.findIndex((d) => d.id === id);
  if (idx === -1) return false;
  store.devices.splice(idx, 1);
  await writeDeviceStore(store);
  return true;
}

/**
 * Get the public-facing access URLs for display.
 */
export function getAccessUrls(port: number): { lan: string[]; public?: string } {
  const urls: { lan: string[]; public?: string } = { lan: [] };

  // Detect LAN IPs
  try {
    const interfaces = networkInterfaces();
    for (const [, addrs] of Object.entries(interfaces)) {
      for (const addr of addrs ?? []) {
        if (addr.family === 'IPv4' && !addr.internal) {
          urls.lan.push(`http://${addr.address}:${port}`);
        }
      }
    }
  } catch {
    // fallback
  }
  if (urls.lan.length === 0) {
    urls.lan.push(`http://localhost:${port}`);
  }

  // Public URL from env
  if (process.env.CLI_MOBILE_PUBLIC_URL) {
    urls.public = process.env.CLI_MOBILE_PUBLIC_URL;
  }

  return urls;
}
