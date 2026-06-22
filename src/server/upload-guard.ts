// Upload rate-limit and timeout guards.
// Protects against slowloris-style attacks and memory exhaustion from
// too many concurrent multipart uploads (multer memoryStorage buffers
// the entire file in RAM).

import type { RequestHandler } from 'express';
import { ProcessPool } from '../core/process-pool';

// ── Upload concurrency limiter ──

/** Maximum concurrent uploads in flight. Extra requests queue FIFO. */
const MAX_CONCURRENT_UPLOADS = 3;

const uploadSemaphore = new ProcessPool(MAX_CONCURRENT_UPLOADS);

/**
 * Middleware that limits concurrent upload requests.
 * Uses a FIFO semaphore — requests wait in line rather than being rejected.
 * The slot is released when the response finishes or the connection closes.
 */
export function uploadConcurrency(): RequestHandler {
  return async (_req, res, next) => {
    const release = await uploadSemaphore.acquire();
    // Release once, even if both events fire (e.g. finish then close)
    let released = false;
    const once = (): void => {
      if (released) return;
      released = true;
      release();
    };
    res.on('finish', once);
    res.on('close', once);
    next();
  };
}

// ── Upload timeout ──

/** Per-request body timeout. Socket is destroyed on expiry. */
const UPLOAD_TIMEOUT_MS = 120_000; // 2 minutes

/**
 * Sets a per-request timeout for the upload route.
 * If the client takes longer than `ms` to send the complete body,
 * the underlying socket is destroyed, causing multer to abort.
 */
export function uploadTimeout(ms = UPLOAD_TIMEOUT_MS): RequestHandler {
  return (req, _res, next) => {
    req.setTimeout(ms, () => {
      req.destroy(new Error('上传超时'));
    });
    next();
  };
}

// ── Snapshot (for debugging / health checks) ──

/** Return the current concurrency state. */
export function uploadSnapshot(): { active: number; waiting: number; cap: number } {
  return uploadSemaphore.snapshot();
}
