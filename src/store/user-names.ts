// Tiny store for user-assigned session names. Everything else
// (workspace/session tree) comes from ~/.claude/ directly.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { homedir } from 'node:os';

const DEFAULT_PATH = `${homedir()}/.cli-mobile/user-names.json`;

export class UserNamesStore {
  private data: Record<string, string> = {};
  private saving: Promise<void> = Promise.resolve();
  private readonly path: string;

  constructor(path: string = DEFAULT_PATH) {
    this.path = path;
  }

  async load(): Promise<Record<string, string>> {
    try {
      const text = await readFile(this.path, 'utf8');
      this.data = JSON.parse(text) as Record<string, string>;
    } catch {
      // file doesn't exist yet — fine
    }
    return { ...this.data };
  }

  get(sessionId: string): string | undefined {
    return this.data[sessionId];
  }

  set(sessionId: string, name: string): void {
    this.data[sessionId] = name;
    this.schedulePersist();
  }

  remove(sessionId: string): void {
    delete this.data[sessionId];
    this.schedulePersist();
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
      .catch((err) => console.error('[user-names] persist error:', err));
  }
}
