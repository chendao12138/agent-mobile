# Kimi Code CLI Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Kimi Code CLI (`kimi`) as a second AgentAdapter implementation so cli-mobile can control Kimi Code sessions alongside Claude Code.

**Architecture:** The existing `AgentAdapter` interface is generic enough to support multiple backends. We add a `KimiCodeAdapter` parallel to `ClaudeAdapter`, a Kimi-specific stream-json translator, and a Kimi session data reader. The server auto-detects available agents at startup and exposes the active agent to the frontend. The agent can be selected via `CLI_MOBILE_AGENT` env var, defaulting to auto-detect with Claude priority.

**Tech Stack:** Node.js ≥20, TypeScript, same dependencies as existing project. No new npm packages required (stream-json parsing is internal).

---

## Global Constraints

- Must not break existing Claude Code functionality
- Must reuse the `AgentAdapter` / `AgentEvent` / `AgentRun` interface without modification
- Session forking: Kimi has `/fork` in TUI, but NO equivalent CLI flag (`--fork-session`). Since cli-mobile uses non-interactive `kimi -p` mode, forking is not possible — document as limitation, return clear error
- Kimi's stream-json does not emit thinking content or usage stats — those events will simply never fire
- Session history from wire.jsonl is parsed in simplified mode initially
- Agent priority when both available: Claude first, overridable via `CLI_MOBILE_AGENT=kimi`
- Node.js ≥20 required (unchanged)

---

## File Structure Map

```
src/agent/
├── types.ts                          # Unchanged — generic interface
├── index.ts                          # Modify — add KimiCodeAdapter export
├── claude/
│   ├── adapter.ts                    # Unchanged
│   ├── stream-json.ts                # Unchanged
│   └── stream-json.test.ts           # Unchanged
└── kimi/
    ├── adapter.ts                    # CREATE — KimiCodeAdapter
    ├── stream-json.ts                # CREATE — Kimi stream-json → AgentEvent
    ├── adapter.test.ts               # CREATE — adapter unit tests
    └── stream-json.test.ts           # CREATE — translator unit tests

src/core/
├── claude-data.ts                    # Unchanged
├── kimi-data.ts                      # CREATE — Kimi session/workspace scanner
├── kimi-session-history.ts           # CREATE — Kimi wire.jsonl history reader
├── session-history.ts                # Unchanged (Claude-specific)
└── agent-registry.ts                 # CREATE — auto-detect, select agent

src/server/
├── index.ts                          # Modify — use agent registry, multi-agent init
├── api-router.ts                     # Modify — agent-aware fork limitation
├── ws-server.ts                      # Modify — pass agent from registry

README.md                             # Modify — document Kimi Code support
```

---

### Task 1: Kimi Stream-JSON Translator

**Files:**
- Create: `src/agent/kimi/stream-json.ts`
- Create: `src/agent/kimi/stream-json.test.ts`

**Interfaces:**
- Consumes: `AgentEvent` type from `src/agent/types.ts`
- Produces: `translateEvent(raw: unknown): Generator<AgentEvent>` — same signature as Claude's translator

**Background:** Kimi Code's `--output-format stream-json` emits JSONL in OpenAI-compatible role-based format. Each line is one of:

```json
{"role": "user", "content": "prompt text"}
{"role": "assistant", "content": "response text"}
{"role": "assistant", "content": "text", "tool_calls": [{"type": "function", "id": "tc_1", "function": {"name": "Shell", "arguments": "{\"command\":\"ls\"}"}}]}
{"role": "tool", "tool_call_id": "tc_1", "content": "file1\nfile2"}
```

Key differences from Claude's format:
- No `system` init event (no sessionId/cwd/model metadata in stream)
- No thinking content (goes to stderr, not JSONL)
- No `result` summary event (no usage stats)
- Tool calls are embedded inside assistant messages, not separate content blocks
- Messages are complete units, not streaming deltas

**Mapping strategy:**

| Kimi input | AgentEvent output |
|---|---|
| `role: "assistant"` with `content: string` (text only) | `{ type: 'text', delta: <content> }` |
| `role: "assistant"` with `tool_calls[]` | First emit `{ type: 'text', delta: <content> }` if content is non-empty, then emit `{ type: 'tool_use', id, name, input }` for each tool_call |
| `role: "tool"` | `{ type: 'tool_result', id: tool_call_id, output: <content>, isError: false }` |
| `role: "user"` | Skip — this is the echoed prompt, not useful for display |
| Unknown/unparseable | Skip — return empty |

- [ ] **Step 1: Write failing tests for the translator**

```typescript
// src/agent/kimi/stream-json.test.ts
import { describe, it, expect } from 'vitest';
import { translateEvent } from './stream-json';

describe('translateEvent', () => {
  it('emits text event for assistant message with string content', () => {
    const events = [...translateEvent({
      role: 'assistant',
      content: 'Hello, world!'
    })];
    expect(events).toEqual([
      { type: 'text', delta: 'Hello, world!' }
    ]);
  });

  it('emits nothing for user messages', () => {
    const events = [...translateEvent({
      role: 'user',
      content: 'my prompt'
    })];
    expect(events).toEqual([]);
  });

  it('emits text + tool_use events for assistant with tool_calls', () => {
    const events = [...translateEvent({
      role: 'assistant',
      content: 'Let me check that.',
      tool_calls: [
        {
          type: 'function',
          id: 'tc_1',
          function: {
            name: 'Shell',
            arguments: '{"command":"ls"}'
          }
        }
      ]
    })];
    expect(events).toEqual([
      { type: 'text', delta: 'Let me check that.' },
      { type: 'tool_use', id: 'tc_1', name: 'Shell', input: { command: 'ls' } }
    ]);
  });

  it('emits only tool_use when assistant content is empty', () => {
    const events = [...translateEvent({
      role: 'assistant',
      content: '',
      tool_calls: [
        {
          type: 'function',
          id: 'tc_2',
          function: { name: 'Read', arguments: '{"file":"a.txt"}' }
        }
      ]
    })];
    expect(events).toEqual([
      { type: 'tool_use', id: 'tc_2', name: 'Read', input: { file: 'a.txt' } }
    ]);
  });

  it('emits tool_result for tool messages', () => {
    const events = [...translateEvent({
      role: 'tool',
      tool_call_id: 'tc_1',
      content: 'file1.py\nfile2.py'
    })];
    expect(events).toEqual([
      { type: 'tool_result', id: 'tc_1', output: 'file1.py\nfile2.py', isError: false }
    ]);
  });

  it('emits multiple events for multiple tool_calls in one message', () => {
    const events = [...translateEvent({
      role: 'assistant',
      content: '',
      tool_calls: [
        { type: 'function', id: 'a', function: { name: 'Read', arguments: '{}' } },
        { type: 'function', id: 'b', function: { name: 'Grep', arguments: '{}' } }
      ]
    })];
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ type: 'tool_use', id: 'a' });
    expect(events[1]).toMatchObject({ type: 'tool_use', id: 'b' });
  });

  it('skips invalid JSON objects gracefully', () => {
    const events = [...translateEvent({})];
    expect(events).toEqual([]);
  });

  it('skips null/undefined gracefully', () => {
    const events = [...translateEvent(null)];
    expect(events).toEqual([]);
  });

  it('stringifies non-string tool content', () => {
    const events = [...translateEvent({
      role: 'tool',
      tool_call_id: 'tc_x',
      content: { result: 'ok' }
    })];
    expect(events[0]).toEqual({
      type: 'tool_result',
      id: 'tc_x',
      output: '{"result":"ok"}',
      isError: false
    });
  });

  it('handles tool_calls where arguments is already an object', () => {
    const events = [...translateEvent({
      role: 'assistant',
      content: '',
      tool_calls: [
        {
          type: 'function',
          id: 'tc_3',
          function: { name: 'Bash', arguments: { command: 'ls' } }
        }
      ]
    })];
    expect(events[0]).toMatchObject({
      type: 'tool_use',
      input: { command: 'ls' }
    });
  });

  it('handles malformed tool_calls arguments string by passing as-is', () => {
    const events = [...translateEvent({
      role: 'assistant',
      content: '',
      tool_calls: [
        { type: 'function', id: 'tc_4', function: { name: 'X', arguments: 'not-json' } }
      ]
    })];
    expect(events[0]).toMatchObject({
      type: 'tool_use',
      input: 'not-json'
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/agent/kimi/stream-json.test.ts`
Expected: All tests FAIL — module does not exist yet.

- [ ] **Step 3: Write the translator implementation**

```typescript
// src/agent/kimi/stream-json.ts
import type { AgentEvent } from '../types';

interface KimiToolCall {
  type: 'function';
  id: string;
  function: {
    name: string;
    arguments: string | Record<string, unknown>;
  };
}

interface KimiMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string | unknown;
  tool_calls?: KimiToolCall[];
  tool_call_id?: string;
}

function parseArguments(args: string | Record<string, unknown>): unknown {
  if (typeof args === 'string') {
    try {
      return JSON.parse(args);
    } catch {
      return args;
    }
  }
  return args;
}

function isKimiMessage(value: unknown): value is KimiMessage {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.role === 'string' && ['user', 'assistant', 'tool'].includes(obj.role);
}

export function* translateEvent(raw: unknown): Generator<AgentEvent> {
  if (!isKimiMessage(raw)) return;

  const msg = raw;

  // User messages are echoed prompts — skip
  if (msg.role === 'user') return;

  // Assistant messages: emit text delta, then tool_use for each tool call
  if (msg.role === 'assistant') {
    const content = typeof msg.content === 'string' ? msg.content : '';
    if (content) {
      yield { type: 'text', delta: content };
    }

    if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
      for (const tc of msg.tool_calls) {
        if (!tc.id || !tc.function?.name) continue;
        yield {
          type: 'tool_use',
          id: tc.id,
          name: tc.function.name,
          input: parseArguments(tc.function.arguments),
        };
      }
    }

    // Emit done after the final assistant message (no usage stats from Kimi)
    // We detect this by checking if there are no tool_calls — the last assistant
    // message in a response is always text-only without tool_calls.
    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      yield { type: 'done' };
    }
    return;
  }

  // Tool messages: emit tool_result
  if (msg.role === 'tool') {
    const output = typeof msg.content === 'string'
      ? msg.content
      : JSON.stringify(msg.content);
    yield {
      type: 'tool_result',
      id: msg.tool_call_id ?? 'unknown',
      output,
      isError: false,
    };
    return;
  }
}
```

Wait — there's a problem with the `done` event detection. Kimi emits multiple assistant messages in a conversation. The last one is the final response. But we can't know which assistant message is the last one during streaming, because more may follow (tool results → more assistant messages). The `done` event should only fire when the stream ends naturally.

Let me reconsider. Actually, looking at Kimi's behavior: when running non-interactively with `-p`, after the final answer, `kimi` exits. The stream ending and process exit IS the signal. So the adapter (not the translator) should handle emitting `done` after the readline loop finishes. The translator should NOT emit `done`.

- [ ] **Step 4: Re-examine the translator for `done` event placement**

The `done` event should be emitted by the adapter's `createEventStream`, not the translator. Remove the `done` logic from Step 3's draft. Here's the corrected implementation:

```typescript
// src/agent/kimi/stream-json.ts
import type { AgentEvent } from '../types';

interface KimiToolCall {
  type: 'function';
  id: string;
  function: {
    name: string;
    arguments: string | Record<string, unknown>;
  };
}

interface KimiMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string | unknown;
  tool_calls?: KimiToolCall[];
  tool_call_id?: string;
}

function parseArguments(args: string | Record<string, unknown>): unknown {
  if (typeof args === 'string') {
    try { return JSON.parse(args); } catch { return args; }
  }
  return args;
}

function isKimiMessage(value: unknown): value is KimiMessage {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.role === 'string' && ['user', 'assistant', 'tool'].includes(obj.role);
}

/** Translate a single Kimi stream-json line into zero or more AgentEvents. */
export function* translateEvent(raw: unknown): Generator<AgentEvent> {
  if (!isKimiMessage(raw)) return;
  const msg = raw;

  if (msg.role === 'user') return;

  if (msg.role === 'assistant') {
    const content = typeof msg.content === 'string' ? msg.content : '';
    if (content) {
      yield { type: 'text', delta: content };
    }
    if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
      for (const tc of msg.tool_calls) {
        if (!tc.id || !tc.function?.name) continue;
        yield {
          type: 'tool_use',
          id: tc.id,
          name: tc.function.name,
          input: parseArguments(tc.function.arguments),
        };
      }
    }
    return;
  }

  if (msg.role === 'tool') {
    yield {
      type: 'tool_result',
      id: msg.tool_call_id ?? 'unknown',
      output: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
      isError: false,
    };
    return;
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/agent/kimi/stream-json.test.ts`
Expected: All 10 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/agent/kimi/stream-json.ts src/agent/kimi/stream-json.test.ts
git commit -m "feat: add Kimi Code stream-json translator

Translates Kimi's OpenAI-compatible JSONL format (user/assistant/tool roles)
into cli-mobile's AgentEvent stream. Key differences from Claude:
- No system/init event (no session metadata in stream)
- Tool calls embedded in assistant messages
- No thinking content or usage stats in JSONL"
```

---

### Task 2: KimiCodeAdapter

**Files:**
- Create: `src/agent/kimi/adapter.ts`
- Create: `src/agent/kimi/adapter.test.ts`

**Interfaces:**
- Consumes: `AgentAdapter`, `AgentRun`, `AgentRunOptions`, `AgentEvent` from `src/agent/types.ts`
- Consumes: `translateEvent` from `src/agent/kimi/stream-json.ts`
- Produces: `KimiCodeAdapter` class implementing `AgentAdapter`

**Kimi CLI argument mapping:**

| AgentRunOptions field | Kimi CLI flag | Notes |
|---|---|---|
| `prompt` | `-p <prompt>` | Same as Claude |
| `sessionId` | `--session <id>` | NOT `--resume`. Mutually exclusive with `forkFrom`. |
| `forkFrom` | N/A | NOT SUPPORTED. Kimi has no `--fork-session` CLI flag. Must throw. |
| `cwd` | spawn() cwd option | Same as Claude |
| `model` | `--model <model>` | e.g. `kimi-code/kimi-for-coding` |
| `permissionMode: 'bypassPermissions'` | `--yolo` | |
| `permissionMode: 'default'` | (no flag) | Kimi default is interactive/manual. `--auto` is also available. |
| `permissionMode: 'plan'` | `--plan` | Plan mode |
| `permissionMode: 'acceptEdits'` | `--auto` | Closest match — auto-approves tool calls |

**Kimi does NOT support `--output-format stream-json --verbose`** — Kimi's stream-json is enabled only with `--output-format stream-json` and does not need `--verbose`.

- [ ] **Step 1: Write failing tests for the adapter**

```typescript
// src/agent/kimi/adapter.test.ts
import { describe, it, expect, vi } from 'vitest';
import { KimiCodeAdapter } from './adapter';

describe('KimiCodeAdapter', () => {
  it('has id "kimi"', () => {
    const adapter = new KimiCodeAdapter();
    expect(adapter.id).toBe('kimi');
  });

  it('has displayName "Kimi Code"', () => {
    const adapter = new KimiCodeAdapter();
    expect(adapter.displayName).toBe('Kimi Code');
  });

  it('accepts custom binary name', () => {
    const adapter = new KimiCodeAdapter({ binary: '/usr/local/bin/kimi' });
    expect(adapter.id).toBe('kimi');
  });

  it('isAvailable returns true when kimi exits 0', async () => {
    // We can't easily test spawn without mocking, but the method signature is testable
    const adapter = new KimiCodeAdapter({ binary: 'node' }); // node always exists
    const available = await adapter.isAvailable();
    expect(available).toBe(true);
  });

  it('isAvailable returns false when binary not found', async () => {
    const adapter = new KimiCodeAdapter({ binary: 'definitely-not-a-real-binary-xyz' });
    const available = await adapter.isAvailable();
    expect(available).toBe(false);
  });

  it('run() with forkFrom throws synchronously', () => {
    const adapter = new KimiCodeAdapter();
    expect(() => adapter.run({ prompt: 'test', forkFrom: 'some-id' })).toThrow(
      'Kimi Code does not support --fork-session'
    );
  });

  it('run() with sessionId does not throw', () => {
    const adapter = new KimiCodeAdapter();
    // Won't actually spawn (no real kimi), but shouldn't throw on option validation
    const run = adapter.run({ prompt: 'test', sessionId: 'abc-123' });
    expect(run).toBeDefined();
    expect(run.events).toBeDefined();
    // Clean up
    run.stop();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/agent/kimi/adapter.test.ts`
Expected: Tests FAIL — module does not exist.

- [ ] **Step 3: Write the adapter implementation**

```typescript
// src/agent/kimi/adapter.ts
import type { ChildProcessByStdio } from 'node:child_process';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';
import type { AgentAdapter, AgentEvent, AgentRun, AgentRunOptions } from '../types';
import { translateEvent } from './stream-json';

export interface KimiCodeAdapterOptions {
  /** Path to the kimi binary. Default: 'kimi'. */
  binary?: string;
}

type KimiChild = ChildProcessByStdio<null, Readable, Readable>;

export class KimiCodeAdapter implements AgentAdapter {
  readonly id = 'kimi';
  readonly displayName = 'Kimi Code';

  private readonly binary: string;

  constructor(opts: KimiCodeAdapterOptions = {}) {
    this.binary = opts.binary ?? 'kimi';
  }

  async isAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      const child = spawn(this.binary, ['--version'], { stdio: 'ignore' });
      child.on('error', () => resolve(false));
      child.on('exit', (code) => resolve(code === 0));
    });
  }

  run(opts: AgentRunOptions): AgentRun {
    // Kimi Code does not support forking sessions via CLI.
    // The /fork command only exists in Kimi's TUI, not as a CLI flag.
    if (opts.forkFrom) {
      throw new Error(
        'Kimi Code does not support --fork-session via CLI. ' +
        'Session forking (/fork) is only available inside the Kimi TUI, ' +
        'not in non-interactive (-p) mode used by cli-mobile.'
      );
    }

    const args = [
      '-p', opts.prompt,
      '--output-format', 'stream-json',
    ];

    if (opts.sessionId) {
      args.push('--session', opts.sessionId);
    }

    if (opts.model) {
      args.push('--model', opts.model);
    }

    // Map permission modes to Kimi flags
    switch (opts.permissionMode) {
      case 'bypassPermissions':
        args.push('--yolo');
        break;
      case 'acceptEdits':
        args.push('--auto');
        break;
      case 'plan':
        args.push('--plan');
        break;
      case 'default':
        // Kimi default is interactive — no extra flag needed
        break;
      default:
        // Default to yolo for non-interactive usage
        args.push('--yolo');
        break;
    }

    const child = spawn(this.binary, args, {
      cwd: opts.cwd,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    }) as KimiChild;

    console.log('[agent:kimi] spawn', {
      pid: child.pid ?? null,
      cwd: opts.cwd ?? process.cwd(),
      hasSession: Boolean(opts.sessionId),
      promptChars: opts.prompt.length,
      model: opts.model,
    });

    const stderrChunks: Buffer[] = [];
    let stderrBuffer = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
      stderrBuffer += chunk.toString('utf8');
      let nl = stderrBuffer.indexOf('\n');
      while (nl !== -1) {
        const line = stderrBuffer.slice(0, nl);
        stderrBuffer = stderrBuffer.slice(nl + 1);
        if (line.trim()) console.log('[agent:kimi:stderr]', line);
        nl = stderrBuffer.indexOf('\n');
      }
    });

    let runtimeError: Error | null = null;
    child.on('error', (err) => {
      runtimeError = err;
    });
    child.on('exit', (code, signal) => {
      console.log('[agent:kimi] exit', { pid: child.pid ?? null, code, signal });
    });

    const stopGraceMs = opts.stopGraceMs ?? 5000;

    return {
      events: createEventStream(child, stderrChunks, () => runtimeError, opts.sessionId),

      async stop() {
        if (child.exitCode !== null || child.signalCode !== null) return;
        console.log('[agent:kimi] stop-sigterm', { pid: child.pid ?? null, graceMs: stopGraceMs });
        child.kill('SIGTERM');
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            if (child.exitCode === null && child.signalCode === null) {
              console.log('[agent:kimi] stop-sigkill', { pid: child.pid ?? null, graceMs: stopGraceMs });
              child.kill('SIGKILL');
            }
            resolve();
          }, stopGraceMs);
          child.once('exit', () => {
            clearTimeout(timer);
            resolve();
          });
        });
      },

      waitForExit(timeoutMs: number): Promise<boolean> {
        if (child.exitCode !== null || child.signalCode !== null) {
          return Promise.resolve(true);
        }
        return new Promise<boolean>((resolve) => {
          const onExit = (): void => {
            clearTimeout(timer);
            resolve(true);
          };
          const timer = setTimeout(() => {
            child.removeListener('exit', onExit);
            resolve(false);
          }, timeoutMs);
          child.once('exit', onExit);
        });
      },
    };
  }
}

async function* createEventStream(
  child: KimiChild,
  stderrChunks: Buffer[],
  getError: () => Error | null,
  knownSessionId?: string,
): AsyncGenerator<AgentEvent> {
  if (!child.pid) {
    const err = getError();
    yield {
      type: 'error',
      message: err ? `failed to spawn kimi: ${err.message}` : 'spawn returned no pid',
    };
    return;
  }

  // Emit system event with known session info
  // Kimi's stream-json does not include an init event, so we synthesize one
  if (knownSessionId) {
    yield { type: 'system', sessionId: knownSessionId };
  }

  const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        continue;
      }
      yield* translateEvent(parsed);
    }
  } finally {
    rl.close();
  }

  const exitCode = await new Promise<number | null>((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve(child.exitCode);
    } else {
      child.once('exit', (code) => resolve(code));
    }
  });

  const runtimeError = getError();
  if (exitCode !== 0 && exitCode !== null) {
    const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();
    const detail = stderr ? `: ${stderr.slice(0, 500)}` : '';
    yield { type: 'error', message: `kimi exited with code ${exitCode}${detail}` };
  } else if (runtimeError) {
    yield { type: 'error', message: `kimi runtime error: ${runtimeError.message}` };
  }

  // Emit done after clean exit
  if (exitCode === 0) {
    yield { type: 'done' };
  }
}
```

- [ ] **Step 4: Run tests to verify adapter tests pass**

Run: `npx vitest run src/agent/kimi/adapter.test.ts`
Expected: Tests PASS (except the spawn-based ones if no real `kimi` binary — those may need `vi.mock`).

Note: The `isAvailable` tests that spawn real processes will work or fail depending on PATH. We'll use `node` (always available) and a fake name to keep them deterministic.

- [ ] **Step 5: Update agent/index.ts to export KimiCodeAdapter**

Edit `src/agent/index.ts`:

```typescript
export type { AgentAdapter, AgentEvent, AgentRun, AgentRunOptions } from './types';
export { ClaudeAdapter } from './claude/adapter';
export { KimiCodeAdapter } from './kimi/adapter';
```

- [ ] **Step 6: Commit**

```bash
git add src/agent/kimi/adapter.ts src/agent/kimi/adapter.test.ts src/agent/index.ts
git commit -m "feat: add KimiCodeAdapter implementing AgentAdapter

Spawns 'kimi' with mapped CLI flags:
- -p for prompt, --session for resume, --model for model
- Permission modes: bypassPermissions→--yolo, plan→--plan,
  acceptEdits→--auto, default→(no flag)
- forkFrom throws — Kimi has no --fork-session CLI flag

Synthesizes system event with known sessionId since Kimi's
stream-json lacks an init event. Emits done on clean exit."
```

---

### Task 3: Kimi Session Data Reader

**Files:**
- Create: `src/core/kimi-data.ts`

**Interfaces:**
- Consumes: `WorkspaceInfo`, `SessionInfo`, `StoredTree` types from `src/core/claude-data.ts`
- Produces: `refreshTree(userNames?)`, `readTree()`, `updateSessionName()`, `archiveSession()`, `restoreSession()`, `togglePin()` — same signatures as claude-data.ts

**Kimi session storage layout:**

```
~/.kimi-code/
├── session_index.jsonl    # One JSON record per line: {sessionId, sessionDir, workDir}
├── sessions/
│   └── <workDirKey>/      # e.g. wd_-Users-chendao-Desktop-CLI_Codes-<hash>
│       └── <sessionId>/
│           └── state.json  # {title, lastPrompt, createdAt, updatedAt, forkedFrom}
```

**Differences from Claude's layout:**
- Single flat `session_index.jsonl` vs per-project directories
- `state.json` per session vs `sessions/<id>.json`
- No JSONL conversation files in a predictable `projects/` structure
- Session is identified by `workDir` (from `session_index.jsonl`) not by project slug

- [ ] **Step 1: Write the Kimi data reader**

```typescript
// src/core/kimi-data.ts
// Session scanner for Kimi Code — mirrors claude-data.ts interface.
// Reads ~/.kimi-code/session_index.jsonl and per-session state.json files.

import { readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { homedir } from 'node:os';

const KIMI_CODE_HOME = process.env.KIMI_CODE_HOME || join(homedir(), '.kimi-code');
const SESSIONS_DIR = join(KIMI_CODE_HOME, 'sessions');
const SESSION_INDEX_PATH = join(KIMI_CODE_HOME, 'session_index.jsonl');
const MOBILE_DIR = join(homedir(), '.cli-mobile');
const KIMI_TREE_PATH = join(MOBILE_DIR, 'kimi-tree.json');

// Reuse same public types as claude-data.ts
export interface SessionInfo {
  id: string;
  name: string;
  cwd: string;
  startedAt: number;
  updatedAt: number;
  messageCount: number; // Kimi: 0 — wire.jsonl parsing not implemented yet
  archived: boolean;
  pinned: boolean;
}

export interface WorkspaceInfo {
  name: string;
  cwd: string;
  sessions: SessionInfo[];
}

export interface StoredTree {
  workspaces: WorkspaceInfo[];
  updatedAt: number;
}

// ── Session index record ──

interface SessionIndexEntry {
  sessionId: string;
  sessionDir: string;
  workDir: string;
}

async function readSessionIndex(): Promise<SessionIndexEntry[]> {
  try {
    const text = await readFile(SESSION_INDEX_PATH, 'utf8');
    const entries: SessionIndexEntry[] = [];
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const obj = JSON.parse(trimmed) as Partial<SessionIndexEntry>;
        if (obj.sessionId && obj.sessionDir && obj.workDir) {
          entries.push(obj as SessionIndexEntry);
        }
      } catch { /* skip malformed lines */ }
    }
    return entries;
  } catch {
    return [];
  }
}

// ── State file ──

interface SessionState {
  title?: string;
  lastPrompt?: string;
  createdAt?: number;
  updatedAt?: number;
}

async function readSessionState(sessionDir: string): Promise<SessionState | null> {
  try {
    const text = await readFile(join(sessionDir, 'state.json'), 'utf8');
    return JSON.parse(text) as SessionState;
  } catch {
    return null;
  }
}

// ── Scan + persist ──

export async function refreshTree(userNames: Record<string, string> = {}): Promise<StoredTree> {
  const oldTree = await readTree();
  const mergedNames: Record<string, string> = { ...userNames };
  const oldState = new Map<string, { archived: boolean; pinned: boolean }>();
  for (const ws of oldTree.workspaces) {
    for (const s of ws.sessions) {
      if (s.name && !mergedNames[s.id]) mergedNames[s.id] = s.name;
      if (s.archived || s.pinned) oldState.set(s.id, { archived: s.archived, pinned: s.pinned });
    }
  }

  const entries = await readSessionIndex();
  const cwdMap = new Map<string, { sessions: SessionInfo[] }>();

  for (const entry of entries) {
    const state = await readSessionState(entry.sessionDir);
    // Verify the workDir still exists
    const workDirStat = await stat(entry.workDir).catch(() => null);
    if (!workDirStat?.isDirectory()) continue;

    const prev = oldState.get(entry.sessionId);
    const session: SessionInfo = {
      id: entry.sessionId,
      name: mergedNames[entry.sessionId] || state?.title || '',
      cwd: entry.workDir,
      startedAt: state?.createdAt || 0,
      updatedAt: state?.updatedAt || 0,
      messageCount: 0, // wire.jsonl parsing not implemented
      archived: prev?.archived ?? false,
      pinned: prev?.pinned ?? false,
    };

    const existing = cwdMap.get(entry.workDir);
    if (existing) {
      existing.sessions.push(session);
    } else {
      cwdMap.set(entry.workDir, { sessions: [session] });
    }
  }

  const workspaces: WorkspaceInfo[] = [];
  for (const [cwd, entry] of cwdMap) {
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

  const tree: StoredTree = { workspaces, updatedAt: Date.now() };
  await mkdir(MOBILE_DIR, { recursive: true });
  await writeFile(KIMI_TREE_PATH, JSON.stringify(tree, null, 2) + '\n', 'utf8');
  return tree;
}

export async function readTree(): Promise<StoredTree> {
  try {
    const text = await readFile(KIMI_TREE_PATH, 'utf8');
    return JSON.parse(text) as StoredTree;
  } catch {
    return { workspaces: [], updatedAt: 0 };
  }
}

export async function updateSessionName(sessionId: string, name: string): Promise<boolean> {
  const tree = await readTree();
  let found = false;
  for (const ws of tree.workspaces) {
    for (const s of ws.sessions) {
      if (s.id === sessionId) { s.name = name; found = true; }
    }
  }
  if (!found) return false;
  tree.updatedAt = Date.now();
  await writeFile(KIMI_TREE_PATH, JSON.stringify(tree, null, 2) + '\n', 'utf8');
  return true;
}

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
        await writeFile(KIMI_TREE_PATH, JSON.stringify(tree, null, 2) + '\n', 'utf8');
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
        await writeFile(KIMI_TREE_PATH, JSON.stringify(tree, null, 2) + '\n', 'utf8');
        return true;
      }
    }
  }
  return false;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/core/kimi-data.ts
git commit -m "feat: add Kimi Code session data reader

Reads ~/.kimi-code/session_index.jsonl and per-session state.json
to build workspace/session tree. Uses same WorkspaceInfo/SessionInfo
types as claude-data.ts. Caches to ~/.cli-mobile/kimi-tree.json.

messageCount is 0 for Kimi sessions — wire.jsonl conversation
history parsing is a future enhancement."
```

---

### Task 4: Agent Registry (Auto-Detect + Selection)

**Files:**
- Create: `src/core/agent-registry.ts`

**Interfaces:**
- Consumes: `AgentAdapter` from `src/agent/types.ts`, `ClaudeAdapter`, `KimiCodeAdapter`
- Produces: `detectAgents(): Promise<AgentAdapter[]>`, `selectAgent(): Promise<AgentAdapter>`

Logic:
1. Check `CLI_MOBILE_AGENT` env var — if set to `kimi` or `claude`, use that exclusively
2. Otherwise, probe both adapters via `isAvailable()`
3. Return all available agents, with Claude first (preferred default)

- [ ] **Step 1: Write the registry**

```typescript
// src/core/agent-registry.ts
import { ClaudeAdapter } from '../agent/claude/adapter';
import { KimiCodeAdapter } from '../agent/kimi/adapter';
import type { AgentAdapter } from '../agent/types';

export interface AgentRegistry {
  /** All detected available agents, in priority order (Claude first). */
  agents: AgentAdapter[];
  /** The selected agent for this session. */
  active: AgentAdapter;
}

/**
 * Auto-detect available agents. Respects CLI_MOBILE_AGENT env var.
 * Priority: CLI_MOBILE_AGENT env > auto-detect (Claude first, then Kimi).
 */
export async function detectAgents(): Promise<AgentRegistry> {
  const envAgent = process.env.CLI_MOBILE_AGENT?.toLowerCase();

  if (envAgent === 'claude') {
    const agent = new ClaudeAdapter();
    const available = await agent.isAvailable();
    if (!available) {
      throw new Error('CLI_MOBILE_AGENT=claude but claude binary not found on PATH');
    }
    return { agents: [agent], active: agent };
  }

  if (envAgent === 'kimi') {
    const agent = new KimiCodeAdapter();
    const available = await agent.isAvailable();
    if (!available) {
      throw new Error('CLI_MOBILE_AGENT=kimi but kimi binary not found on PATH');
    }
    return { agents: [agent], active: agent };
  }

  // Auto-detect: probe both, prefer Claude
  const agents: AgentAdapter[] = [];
  const claude = new ClaudeAdapter();
  const kimi = new KimiCodeAdapter();

  const [claudeAvailable, kimiAvailable] = await Promise.all([
    claude.isAvailable(),
    kimi.isAvailable(),
  ]);

  if (claudeAvailable) agents.push(claude);
  if (kimiAvailable) agents.push(kimi);

  if (agents.length === 0) {
    console.warn('⚠️  Neither claude nor kimi found on PATH. Starting without agent support.');
    // Return a dummy — server should handle gracefully
    agents.push(claude); // will fail calls but won't crash
  }

  return { agents, active: agents[0]! };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/core/agent-registry.ts
git commit -m "feat: add agent auto-detection and selection registry

Probes both claude and kimi on PATH. Priority:
1. CLI_MOBILE_AGENT env var (exclusive selection)
2. Auto-detect with Claude preferred as default

Returns AgentRegistry with all available agents + active selection."
```

---

### Task 5: Integrate Agent Registry into Server

**Files:**
- Modify: `src/server/index.ts` (lines 10, 128-131)
- Modify: `src/server/api-router.ts` (branch endpoint)
- Modify: `src/server/ws-server.ts` (agent reference)

**Changes:**

In `src/server/index.ts`:
- Replace hardcoded `new ClaudeAdapter()` with `detectAgents()`
- Pass the registry (or active agent) to api-router and ws-server
- Print which agent is active at startup
- Handle the case where no agent is available gracefully

- [ ] **Step 1: Modify server/index.ts**

Replace the agent initialization block (around line 128-131):

```typescript
// OLD:
import { ClaudeAdapter } from '../agent/index';

// ...
const agent = new ClaudeAdapter();
const available = await agent.isAvailable();
if (!available) console.warn('⚠️  claude CLI not found on PATH.');
else console.log('✓ claude CLI found');
```

Replace with:

```typescript
// NEW:
import { detectAgents } from '../core/agent-registry';

// ...
const registry = await detectAgents();
const agent = registry.active;

if (registry.agents.length === 0) {
  console.warn('⚠️  No agent found on PATH. Install Claude Code or Kimi Code.');
} else {
  const names = registry.agents.map(a => a.displayName).join(', ');
  console.log(`✓ Agent(s) found: ${names}`);
  console.log(`   Active: ${agent.displayName}`);
}
```

- [ ] **Step 2: Modify server api-router.ts for fork limitation**

The `POST /sessions/:sessionId/branch` endpoint uses `agent.run({ forkFrom: ... })`. For Kimi, this will throw. Wrap the call in try-catch and return a descriptive error:

In `src/server/api-router.ts`, around line 191-197, wrap in try-catch:

```typescript
// Inside the branch endpoint handler:
try {
  const run = agent.run({
    prompt: '.',
    forkFrom: sessionId,
    cwd: sourceCwd,
    permissionMode: 'bypassPermissions',
    stopGraceMs: 50,
  });
  // ... existing event loop to capture sessionId ...
} catch (err) {
  if (err instanceof Error && err.message.includes('--fork-session')) {
    res.status(400).json({
      ok: false,
      error: 'Session forking is not supported by the current agent (' + agent.displayName + ').',
    });
    return;
  }
  throw err;
}
```

- [ ] **Step 3: Update server tree scanning to support both agents**

In `src/server/index.ts`, currently only `refreshTree()` from `claude-data.ts` is called. Add Kimi tree scanning:

```typescript
import { refreshTree } from '../core/claude-data';
import { refreshTree as refreshKimiTree } from '../core/kimi-data';

// After Claude tree scan:
console.log('Scanning ~/.claude/ …');
const tree = await refreshTree();
console.log(`  ${tree.workspaces.length} workspaces, ${tree.workspaces.reduce((c, w) => c + w.sessions.length, 0)} sessions`);

// Also scan Kimi tree:
console.log('Scanning ~/.kimi-code/ …');
const kimiTree = await refreshKimiTree();
console.log(`  ${kimiTree.workspaces.length} workspaces, ${kimiTree.workspaces.reduce((c, w) => c + w.sessions.length, 0)} sessions`);
```

The frontend reads from `tree.json` (Claude) and `kimi-tree.json` (Kimi) — we may want to merge them into a single response. For simplicity, expose both trees via separate API endpoints or merge them.

Actually, the existing API endpoints in `api-router.ts` call `readTree()` from `claude-data.ts` directly. We need to make the API router agent-aware too. But that's getting complex — let's keep the plan focused: merge the trees into a unified response for the frontend, and add a new API endpoint for Kimi trees.

Wait, actually the simpler approach is: the frontend reads from `~/.cli-mobile/tree.json`. We should merge Claude + Kimi trees into one unified tree when both agents are available. Let me update the plan.

- [ ] **Step 4: Add merged tree writing to server startup**

After scanning both trees, merge and write a unified tree:

```typescript
// Merge trees from both agents
const allWorkspaces = [...tree.workspaces, ...kimiTree.workspaces];
// Deduplicate by cwd: merge sessions from same cwd
const cwdMap = new Map<string, WorkspaceInfo>();
for (const ws of allWorkspaces) {
  const existing = cwdMap.get(ws.cwd);
  if (existing) {
    // Merge sessions, dedup by sessionId
    const seenIds = new Set(existing.sessions.map(s => s.id));
    for (const s of ws.sessions) {
      if (!seenIds.has(s.id)) {
        existing.sessions.push(s);
        seenIds.add(s.id);
      }
    }
    existing.sessions.sort((a, b) => b.updatedAt - a.updatedAt);
  } else {
    cwdMap.set(ws.cwd, { ...ws });
  }
}
const unifiedTree = {
  workspaces: [...cwdMap.values()].sort((a, b) => {
    const aLatest = a.sessions[0]?.updatedAt ?? 0;
    const bLatest = b.sessions[0]?.updatedAt ?? 0;
    return bLatest - aLatest;
  }),
  updatedAt: Date.now(),
};
// Write unified tree as the primary tree.json
await writeFile(TREE_PATH, JSON.stringify(unifiedTree, null, 2) + '\n', 'utf8');
```

- [ ] **Step 5: Update ws-server.ts to accept agent from registry**

Currently `setupWebSocket(wss, agent)` receives agent directly. No change needed — we pass `registry.active`.

- [ ] **Step 6: Commit**

```bash
git add src/server/index.ts src/server/api-router.ts
git commit -m "feat: integrate agent registry into server

- Auto-detect available agents at startup
- Merge Claude and Kimi workspace/session trees
- API branch endpoint returns clear error for Kimi's missing fork support
- Print active agent info at startup"
```

---

### Task 6: Update README

**Files:**
- Modify: `README.md`

Add Kimi Code documentation.

- [ ] **Step 1: Update README**

In the "功能" section, add agent support note. After the existing bullet list, add:

```markdown
- 同时支持 Claude Code 和 Kimi Code CLI 作为后端 Agent
```

After the "要求" section, add agent selection:

```markdown
## Agent 选择

默认自动检测 `claude` 和 `kimi`，优先使用 Claude。可通过环境变量指定：

```bash
CLI_MOBILE_AGENT=kimi npm start   # 强制使用 Kimi Code
CLI_MOBILE_AGENT=claude npm start  # 强制使用 Claude Code
```

## Kimi Code 限制

- 不支持会话分支 (fork) — Kimi Code 的 `/fork` 命令仅在 TUI 内可用，cli-mobile 使用的非交互模式 (`-p`) 无等效 CLI 参数
- 会话历史详情解析为简化模式 — `wire.jsonl` 格式与 Claude 的 JSONL 不同
- 不显示 thinking 内容和 token 用量 — Kimi 的 `stream-json` 不包含这些信息
```

Update the "当前限制" section to remove Claude-specific phrasing.

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add Kimi Code compatibility documentation"
```

---

## Implementation Order

Tasks must be executed in this order (dependencies flow downward):

```
Task 1 (stream-json) ──┐
                        ├──► Task 2 (adapter) ──► Task 4 (registry) ──► Task 5 (server) ──► Task 6 (docs)
Task 3 (kimi-data) ────┘
```

Tasks 1 and 3 can run in parallel. Task 2 depends on Task 1. Task 4 depends on Task 2. Task 5 depends on Task 3 and Task 4.

---

## Limitations & Future Work

1. **No session forking for Kimi** — Kimi Code has `/fork` in TUI but no equivalent CLI flag (`--fork-session`). cli-mobile uses non-interactive `kimi -p` mode, so forking is not possible. Workaround: users can manually run `kimi` in a terminal, use `/fork` there, then resume the forked session in cli-mobile via the session ID.
2. **No thinking content for Kimi** — Kimi's `stream-json` mode sends thinking to stderr without structured format. We only get the final answer.
3. **No usage stats for Kimi** — No `result` event equivalent. Token counts are unavailable.
4. **Simplified session history** — `wire.jsonl` parsing is deferred. Session messages show as 0 count until implemented.
5. **No frontend agent switcher** — Agent selection is server-side only (env var). A frontend toggle is future work.
