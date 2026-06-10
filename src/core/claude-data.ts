// On startup, scan ~/.claude/ and persist an accurate workspace/session
// tree to ~/.cli-mobile/tree.json. The frontend reads from this file.
//
// ws.name  = basename of cwd (last folder)
// ws.sessions[].name = user-assigned name, or '' if not set
//
// Only workspaces with valid metadata cwd are included — no lossy fallback.

import { readdir, readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline';
import { createReadStream } from 'node:fs';

const CLAUDE_DIR = join(homedir(), '.claude');
const PROJECTS_DIR = join(CLAUDE_DIR, 'projects');
const SESSIONS_META_DIR = join(CLAUDE_DIR, 'sessions');
const MOBILE_DIR = join(homedir(), '.cli-mobile');
const TREE_PATH = join(MOBILE_DIR, 'tree.json');

// ── Public types ──

export interface SessionInfo {
  id: string;            // Claude session UUID
  name: string;          // '' or user-assigned name
  cwd: string;           // accurate, from metadata
  startedAt: number;
  updatedAt: number;
  messageCount: number;
  archived: boolean;     // hidden from main list
  pinned: boolean;       // shown at top
}

export interface WorkspaceInfo {
  name: string;          // basename of cwd, e.g. "KIMI_Codes"
  cwd: string;           // accurate, from metadata
  sessions: SessionInfo[];
}

export interface StoredTree {
  workspaces: WorkspaceInfo[];
  updatedAt: number;
}

// ── Scan + persist ──

export async function refreshTree(userNames: Record<string, string> = {}): Promise<StoredTree> {
  const metaIndex = await buildMetaIndex();

  // Load existing tree to preserve session names and archived/pinned state
  const oldTree = await readTree();
  const mergedNames: Record<string, string> = { ...userNames };
  const oldState = new Map<string, { archived: boolean; pinned: boolean }>();
  for (const ws of oldTree.workspaces) {
    for (const s of ws.sessions) {
      if (s.name && !mergedNames[s.id]) {
        mergedNames[s.id] = s.name;
      }
      if (s.archived || s.pinned) {
        oldState.set(s.id, { archived: s.archived, pinned: s.pinned });
      }
    }
  }

  const workspaces = await scanWorkspaces(metaIndex, mergedNames, oldState);

  const tree: StoredTree = {
    workspaces,
    updatedAt: Date.now(),
  };

  await mkdir(MOBILE_DIR, { recursive: true });
  await writeFile(TREE_PATH, JSON.stringify(tree, null, 2) + '\n', 'utf8');

  return tree;
}

/** Read the cached tree from disk without re-scanning. */
export async function readTree(): Promise<StoredTree> {
  try {
    const text = await readFile(TREE_PATH, 'utf8');
    return JSON.parse(text) as StoredTree;
  } catch {
    return { workspaces: [], updatedAt: 0 };
  }
}

/** Update a session's name in the persisted tree. */
export async function updateSessionName(sessionId: string, name: string): Promise<boolean> {
  const tree = await readTree();
  let found = false;
  for (const ws of tree.workspaces) {
    for (const s of ws.sessions) {
      if (s.id === sessionId) {
        s.name = name;
        found = true;
      }
    }
  }
  if (!found) return false;
  tree.updatedAt = Date.now();
  await writeFile(TREE_PATH, JSON.stringify(tree, null, 2) + '\n', 'utf8');
  return true;
}

// ── Internal: scan ~/.claude/ ──

async function buildMetaIndex(): Promise<Map<string, SessionMeta>> {
  const index = new Map<string, SessionMeta>();
  if (!existsSync(SESSIONS_META_DIR)) return index;

  let files: string[];
  try { files = await readdir(SESSIONS_META_DIR); } catch { return index; }

  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    try {
      const text = await readFile(join(SESSIONS_META_DIR, file), 'utf8');
      const obj = JSON.parse(text) as { sessionId?: string; name?: string; cwd?: string; startedAt?: number; updatedAt?: number };
      if (obj.sessionId && obj.cwd) {
        index.set(obj.sessionId, {
          sessionId: obj.sessionId,
          name: obj.name ?? '',
          cwd: obj.cwd,
          startedAt: obj.startedAt ?? 0,
          updatedAt: obj.updatedAt ?? 0,
        });
      }
    } catch { /* skip */ }
  }
  return index;
}

interface SessionMeta {
  sessionId: string;
  name: string;
  cwd: string;
  startedAt: number;
  updatedAt: number;
}

async function scanWorkspaces(
  metaIndex: Map<string, SessionMeta>,
  userNames: Record<string, string>,
  oldState?: Map<string, { archived: boolean; pinned: boolean }>,
): Promise<WorkspaceInfo[]> {
  if (!existsSync(PROJECTS_DIR)) return [];

  const dirs = await readdir(PROJECTS_DIR);

  // Step 1: find the cwd for each slug. Priority: metadata > slugToCwd
  // Removed fuzzy cache fallback — it caused child/sibling dirs to be matched
  // against parent cached cwds, breaking session-cwd consistency.
  const slugCwd = new Map<string, string>();
  for (const slug of dirs) {
    let cwd = '';
    try {
      const wsDir = join(PROJECTS_DIR, slug);
      const files = await readdir(wsDir);
      for (const file of files) {
        if (!file.endsWith('.jsonl')) continue;
        const sid = file.replace('.jsonl', '');
        const meta = metaIndex.get(sid);
        if (meta?.cwd) { cwd = meta.cwd; break; }
      }
    } catch { /* ignore */ }
    if (!cwd) cwd = slugToCwd(slug);
    slugCwd.set(slug, cwd);
  }

  // Step 2: collect sessions grouped by cwd
  const cwdMap = new Map<string, { sessions: SessionInfo[] }>();

  for (const slug of dirs) {
    const wsDir = join(PROJECTS_DIR, slug);
    const st = await stat(wsDir).catch(() => null);
    if (!st?.isDirectory()) continue;

    const files = await readdir(wsDir);
    const jsonlFiles = files.filter((f) => f.endsWith('.jsonl'));

    const wsCwd = slugCwd.get(slug) || slugToCwd(slug);

    for (const file of jsonlFiles) {
      const sessionId = file.replace('.jsonl', '');
      const meta = metaIndex.get(sessionId);
      // Use metadata cwd if available (more accurate), otherwise workspace cwd
      const cwd = meta?.cwd || wsCwd;
      const filePath = join(wsDir, file);
      const msgCount = await countLines(filePath);
      const fileSt = await stat(filePath).catch(() => null);

      const prev = oldState?.get(sessionId);
      const session: SessionInfo = {
        id: sessionId,
        name: userNames[sessionId] || meta?.name || '',
        cwd,
        startedAt: meta?.startedAt || fileSt?.birthtimeMs || fileSt?.mtimeMs || 0,
        updatedAt: meta?.updatedAt || fileSt?.mtimeMs || 0,
        messageCount: msgCount,
        archived: prev?.archived ?? false,
        pinned: prev?.pinned ?? false,
      };

      const existing = cwdMap.get(cwd);
      if (existing) {
        existing.sessions.push(session);
      } else {
        cwdMap.set(cwd, { sessions: [session] });
      }
    }
  }

  // Convert to workspace list, dedup by normalizing similar cwds
  const workspaces: WorkspaceInfo[] = [];
  for (const [cwd, entry] of cwdMap) {
    // Skip workspaces whose actual directory no longer exists.
    // This filters out moved/deleted projects without deleting any records.
    const cwdStat = await stat(cwd).catch(() => null);
    if (!cwdStat?.isDirectory()) continue;

    entry.sessions.sort((a, b) => b.updatedAt - a.updatedAt);
    workspaces.push({
      name: basename(cwd) || cwd,
      cwd,
      sessions: entry.sessions,
    });
  }

  workspaces.sort((a, b) => {
    const aLatest = a.sessions[0]?.updatedAt ?? 0;
    const bLatest = b.sessions[0]?.updatedAt ?? 0;
    return bLatest - aLatest;
  });

  return workspaces;
}

/** Count user messages (conversation rounds) by scanning the JSONL file. */
async function countLines(filePath: string): Promise<number> {
  return new Promise((resolve) => {
    let count = 0;
    const rl = createInterface({ input: createReadStream(filePath), crlfDelay: Infinity });
    rl.on('line', (line) => {
      // Fast check: only count user message lines, not system/tool/queue events
      if (!line.includes('"type":"user"')) return;
      // Exclude tool_result lines — Claude JSONL marks tool returns as type:user too.
      // Safe string check: real user input has escaped quotes in JSON strings,
      // so unescaped '"type":"tool_result"' can only come from structured blocks.
      if (line.includes('"type":"tool_result"')) return;
      count++;
    });
    rl.on('close', () => resolve(count));
    rl.on('error', () => resolve(0));
  });
}

/** Convert project slug back to approximate cwd. Last-resort fallback. */
function slugToCwd(slug: string): string {
  return '/' + slug.slice(1).replace(/-/g, '/');
}

// ── Session actions ──

export async function archiveSession(sessionId: string): Promise<boolean> {
  return updateSessionField(sessionId, { archived: true });
}

export async function restoreSession(sessionId: string): Promise<boolean> {
  return updateSessionField(sessionId, { archived: false });
}

export async function togglePin(sessionId: string): Promise<boolean> {
  const tree = await readTree();
  for (const ws of tree.workspaces) {
    for (const s of ws.sessions) {
      if (s.id === sessionId) {
        s.pinned = !s.pinned;
        tree.updatedAt = Date.now();
        await writeFile(TREE_PATH, JSON.stringify(tree, null, 2) + '\n', 'utf8');
        return true;
      }
    }
  }
  return false;
}

async function updateSessionField(sessionId: string, fields: Partial<SessionInfo>): Promise<boolean> {
  const tree = await readTree();
  for (const ws of tree.workspaces) {
    for (const s of ws.sessions) {
      if (s.id === sessionId) {
        Object.assign(s, fields);
        tree.updatedAt = Date.now();
        await writeFile(TREE_PATH, JSON.stringify(tree, null, 2) + '\n', 'utf8');
        return true;
      }
    }
  }
  return false;
}
