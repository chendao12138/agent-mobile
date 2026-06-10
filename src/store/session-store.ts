// Extended SessionStore — supports named sessions, branching, and history
// Unlike feishu-bridge's SessionStore (keyed by chatId), this stores
// sessions within workspaces with user-assignable names.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { homedir } from 'node:os';

const DEFAULT_PATH = `${homedir()}/.cli-mobile/sessions.json`;

export interface SessionRecord {
  name: string;
  sessionId?: string;       // claude's session ID for --resume
  cwd: string;
  workspace: string;
  parentName?: string;      // branched from this session
  branchNumber?: number;    // sequence number for auto-branch naming
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  lastPreview?: string;     // first line of last user message
  current: boolean;         // whether this is the active session in its workspace
}

interface SessionsData {
  // workspace -> name -> record
  workspaces: Record<string, Record<string, SessionRecord>>;
}

export class SessionStore {
  private data: SessionsData = { workspaces: {} };
  private saving: Promise<void> = Promise.resolve();
  private readonly path: string;

  constructor(path: string = DEFAULT_PATH) {
    this.path = path;
  }

  async load(): Promise<void> {
    try {
      const text = await readFile(this.path, 'utf8');
      const parsed = JSON.parse(text) as Partial<SessionsData>;
      this.data = { workspaces: parsed.workspaces ?? {} };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw err;
    }
  }

  private ws(workspace: string): Record<string, SessionRecord> {
    if (!this.data.workspaces[workspace]) {
      this.data.workspaces[workspace] = {};
    }
    return this.data.workspaces[workspace]!;
  }

  /** Create a new session. If name is empty, auto-generates "session<N>". */
  create(workspace: string, name: string, cwd: string): SessionRecord {
    const sessions = this.ws(workspace);
    const effectiveName = name || this.autoName(workspace);
    // Unset any previous current flag
    for (const s of Object.values(sessions)) {
      s.current = false;
    }
    const record: SessionRecord = {
      name: effectiveName,
      cwd,
      workspace,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messageCount: 0,
      current: true,
    };
    sessions[effectiveName] = record;
    this.schedulePersist();
    return record;
  }

  get(workspace: string, name: string): SessionRecord | undefined {
    return this.ws(workspace)[name];
  }

  getCurrent(workspace: string): SessionRecord | undefined {
    const sessions = this.ws(workspace);
    return Object.values(sessions).find((s) => s.current);
  }

  /** Ensure a default session exists for this workspace. */
  ensureDefault(workspace: string, cwd: string): SessionRecord {
    const current = this.getCurrent(workspace);
    if (current) return current;
    return this.create(workspace, 'session1', cwd);
  }

  setSessionId(workspace: string, name: string, sessionId: string, preview?: string): void {
    const s = this.get(workspace, name);
    if (!s) return;
    s.sessionId = sessionId;
    s.updatedAt = Date.now();
    s.messageCount++;
    if (preview) s.lastPreview = preview;
    this.schedulePersist();
  }

  /** Return sessionId if the session exists and cwd matches. */
  resumeFor(workspace: string, name: string, cwd: string): string | undefined {
    const s = this.get(workspace, name);
    if (!s?.sessionId) return undefined;
    if (s.cwd !== cwd) return undefined;
    return s.sessionId;
  }

  rename(workspace: string, oldName: string, newName: string): boolean {
    const sessions = this.ws(workspace);
    const record = sessions[oldName];
    if (!record || sessions[newName]) return false;
    record.name = newName;
    record.updatedAt = Date.now();
    delete sessions[oldName];
    sessions[newName] = record;
    this.schedulePersist();
    return true;
  }

  /** Branch from an existing session. Default name: "{source}-branch{N}". */
  branch(workspace: string, sourceName: string, branchName?: string): SessionRecord | null {
    const source = this.get(workspace, sourceName);
    if (!source) return null;
    const branchNum = (source.branchNumber ?? 0) + 1;
    const name = branchName || `${sourceName}-branch${branchNum}`;
    const cloned: SessionRecord = {
      name,
      cwd: source.cwd,
      workspace,
      parentName: sourceName,
      branchNumber: branchNum,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messageCount: 0,
      current: true,
    };
    // Unset others' current
    for (const s of Object.values(this.ws(workspace))) {
      s.current = false;
    }
    // Update source's branch counter
    source.branchNumber = branchNum;
    this.ws(workspace)[name] = cloned;
    this.schedulePersist();
    return cloned;
  }

  listRecent(workspace: string, limit: number): SessionRecord[] {
    const sessions = Object.values(this.ws(workspace));
    return sessions
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit);
  }

  listAll(workspace: string): SessionRecord[] {
    const sessions = Object.values(this.ws(workspace));
    return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  touch(workspace: string, name: string, preview?: string): void {
    const s = this.get(workspace, name);
    if (!s) return;
    s.updatedAt = Date.now();
    if (preview) s.lastPreview = preview;
    this.schedulePersist();
  }

  clear(workspace: string, name: string): void {
    const sessions = this.ws(workspace);
    delete sessions[name];
    this.schedulePersist();
  }

  /** Switch current session. */
  setCurrent(workspace: string, name: string): boolean {
    const s = this.get(workspace, name);
    if (!s) return false;
    for (const r of Object.values(this.ws(workspace))) {
      r.current = false;
    }
    s.current = true;
    this.schedulePersist();
    return true;
  }

  async flush(): Promise<void> {
    await this.saving;
  }

  private autoName(workspace: string): string {
    const sessions = this.ws(workspace);
    const existing = Object.keys(sessions);
    let n = existing.length + 1;
    while (existing.includes(`session${n}`)) n++;
    return `session${n}`;
  }

  private schedulePersist(): void {
    this.saving = this.saving
      .then(async () => {
        await mkdir(dirname(this.path), { recursive: true });
        await writeFile(this.path, JSON.stringify(this.data, null, 2) + '\n', 'utf8');
      })
      .catch((err: unknown) => {
        console.error('[session-store] persist error:', err);
      });
  }
}
