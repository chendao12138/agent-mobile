// Adapted from feishu-claude-code-bridge src/workspace/store.ts

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { homedir } from 'node:os';

interface WorkspaceData {
  scopes: Record<string, { cwd: string }>;
  named: Record<string, string>;
}

const DEFAULT_PATH = `${homedir()}/.cli-mobile/workspaces.json`;

function defaultCwdFor(scope: string): string {
  return homedir();
}

export class WorkspaceStore {
  private data: WorkspaceData = { scopes: {}, named: {} };
  private saving: Promise<void> = Promise.resolve();
  private readonly path: string;

  constructor(path: string = DEFAULT_PATH) {
    this.path = path;
  }

  async load(): Promise<void> {
    try {
      const text = await readFile(this.path, 'utf8');
      const parsed = JSON.parse(text) as Partial<WorkspaceData>;
      this.data = {
        scopes: parsed.scopes ?? {},
        named: parsed.named ?? {},
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw err;
    }
  }

  cwdFor(scope: string): string {
    return this.data.scopes[scope]?.cwd ?? defaultCwdFor(scope);
  }

  setCwd(scope: string, cwd: string): void {
    this.data.scopes[scope] = { cwd };
    this.schedulePersist();
  }

  listNamed(): Record<string, string> {
    return { ...this.data.named };
  }

  getNamed(name: string): string | undefined {
    return this.data.named[name];
  }

  saveNamed(name: string, cwd: string): void {
    this.data.named[name] = cwd;
    this.schedulePersist();
  }

  removeNamed(name: string): boolean {
    if (!(name in this.data.named)) return false;
    delete this.data.named[name];
    this.schedulePersist();
    return true;
  }

  async flush(): Promise<void> {
    await this.saving;
  }

  private schedulePersist(): void {
    this.saving = this.saving
      .then(async () => {
        await mkdir(dirname(this.path), { recursive: true });
        await writeFile(this.path, JSON.stringify(this.data, null, 2) + '\n', 'utf8');
      })
      .catch((err: unknown) => {
        console.error('[workspace-store] persist error:', err);
      });
  }
}
