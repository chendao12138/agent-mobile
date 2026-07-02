# Multi-Agent Support with Themed Frontend — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor cli-mobile to support multiple agent backends (Claude Code, Kimi Code, and future agents like Codex/Qoder/Kamaclaude). Each agent gets its own themed frontend — distinct colors, logos, and capability-aware UI (e.g., fork button visible only for Claude). The active agent is selected at server startup via `CLI_MOBILE_AGENT`; the session tree shows **only that agent's sessions**. The theme (colors, logo, StatusBar indicator) makes the active agent immediately obvious — no per-session agent labels needed.

**Design principle:** The frontend never knows about "other agents." It receives one agent's metadata via `/api/agent`, renders one agent's sessions in the workspace tree, and displays one agent's theme. Agent identity is communicated through the visual shell (logo, accent color, StatusBar), not through data labels on individual sessions. Switching agents means restarting the server — the frontend simply wakes up in a different theme with different sessions.

**Architecture:** Two-phase design. Phase 1 establishes a shared `AgentMeta` contract: every adapter declares its identity, theme colors, logo, and boolean capabilities. The server exposes this via a `/api/agent` endpoint, and serves only the active agent's session tree. Each agent owns its own `-tree.json` file; the server reads the active agent's file directly — no cross-agent merging at display time. Phase 2 rebuilds the frontend around an `AgentProvider` context. CSS custom properties driven by a `data-agent` attribute on `<html>` control all theme colors. Components read capabilities from context to conditionally render fork buttons, thinking panels, and usage stats. This plan intentionally modifies React pages/hooks/components to establish the abstraction; after that foundation exists, adding another agent should require only config-layer changes (new adapter + data scanner/history reader + registry/service dispatch + theme/CSS/logo entries).

**Tech Stack:** Node.js ≥20, TypeScript, React 18, Tailwind CSS 3, CSS custom properties, same npm dependencies as existing project.

---

## Global Constraints

- Must not break existing Claude Code functionality or UI
- Agent metadata must be declared statically per adapter (no runtime config files)
- Theme colors live in CSS custom properties scoped to `[data-agent="..."]` — no inline styles, no Tailwind config changes per agent
- This migration will modify React page/component/hook files to add `AgentProvider`, metadata loading, WebSocket metadata handling, and capability gates. After those abstractions are in place, adding a future agent (Codex, Qoder, Kamaclaude) should not require further React page/component/hook changes — only config-layer files: new adapter + data scanner/history reader + theme entry + CSS block + registry + service dispatch
- Frontend must work offline after initial load (switching agents requires server restart with `CLI_MOBILE_AGENT`; runtime hot-switching is future work)
- Frontend only sees the active agent's sessions — no cross-agent session display, no per-session agent labels, no agentId badges
- `AgentAdapter` interface replaces standalone `id`/`displayName` with `meta`. This is a breaking TypeScript shape change; update all mock adapters and direct property reads in the same task.
- Node.js ≥20 required (unchanged)

---

## Agent Theme Map

| Agent ID | Display Name | Primary | Logo SVG | Fork | Thinking | Usage Stats | Streaming |
|----------|-------------|---------|----------|------|----------|-------------|-----------|
| `claude` | Claude Code | Orange `#f97316` | `claudecode.svg` | ✅ | ✅ | ✅ | ✅ |
| `kimi` | Kimi Code | Blue `#3b82f6` | `kimi.svg` | ❌ | ❌ | ❌ | ❌ (complete msgs) |
| `codex` (future) | Codex CLI | Zinc `#18181b` | `codex.svg` | Future agent decides | Future agent decides | Future agent decides | Future agent decides |
| `qoder` (future) | Qoder | Emerald `#10b981` | `qoder.svg` | Future agent decides | Future agent decides | Future agent decides | Future agent decides |
| `kamaclaude` (future) | Kamaclaude | Teal `#0d9488` | `kamaclaude.svg` (future asset) | Future agent decides | Future agent decides | Future agent decides | Future agent decides |

SVG logos live in `src/mobile/assets/logos/`. Each SVG is 24×24 viewBox, designed for 1em height. `claudecode.svg` and `qoder.svg` have hardcoded brand colors; `kimi.svg` uses `fill="currentColor"` (inherits CSS theme variable); `codex.svg` has its own gradient. All are rendered via `<img>` tag, preserving original colors.

---

## File Structure Map

```
src/agent/
├── types.ts                              # MODIFY — add AgentMeta, Capabilities
├── index.ts                              # MODIFY — export new types + KimiCodeAdapter
├── claude/
│   ├── adapter.ts                        # MODIFY — add meta getter
│   ├── stream-json.ts                    # UNCHANGED
│   └── stream-json.test.ts              # UNCHANGED
└── kimi/
    ├── adapter.ts                        # CREATE — KimiCodeAdapter with meta
    ├── stream-json.ts                    # CREATE — Kimi stream-json translator
    ├── adapter.test.ts                   # CREATE
    └── stream-json.test.ts              # CREATE

src/core/
├── session-tree-types.ts                 # CREATE — shared SessionInfo/WorkspaceInfo/StoredTree
├── claude-data.ts                        # MODIFY — import shared tree types; add agentId: 'claude'
├── kimi-data.ts                          # CREATE — Kimi session/workspace scanner
├── kimi-history.ts                       # CREATE — Kimi wire.jsonl history reader
├── session-data-service.ts               # CREATE — active-agent tree/history/mutation dispatch
└── agent-registry.ts                     # CREATE — auto-detect + select agent

src/server/
├── index.ts                              # MODIFY — use agent registry, refresh active tree
├── api-router.ts                         # MODIFY — /api/agent endpoint, fork capability check
├── ws-server.ts                          # MODIFY — emit agent_meta on connection
├── ws-types.ts                           # MODIFY — add ServerAgentMeta message type

src/mobile/
├── assets/
│   └── logos/                              # CREATE — SVG logo files from img/
│       ├── claudecode.svg                   # CREATE
│       ├── kimi.svg                         # CREATE
│       ├── codex.svg                        # CREATE
│       └── qoder.svg                        # CREATE
├── lib/
│   ├── agent-context.tsx                 # CREATE — AgentProvider + useAgent hook
│   └── agent-themes.ts                   # CREATE — frontend theme config + SVG imports
├── components/
│   ├── AgentLogo.tsx                     # CREATE — renders SVG logo in themed circle
│   ├── AuthGate.tsx                      # MODIFY — fetch agent info after auth, persist agentId for FOUC prevention
│   ├── StatusBar.tsx                     # MODIFY — show agent name + colored dot via useAgent
│   ├── CommandBar.tsx                    # UNCHANGED — already theme-neutral (slate-only)
│   └── ActionSheet.tsx                   # UNCHANGED — already theme-neutral (slate-only)
├── pages/
│   ├── WorkspaceList.tsx                 # MODIFY — conditional fork via can('fork'), switch to useWebSocket hook
│   └── WorkspaceView.tsx                 # MODIFY — ADD fork button + onAgentMeta registration
├── hooks/
│   └── useWebSocket.ts                   # MODIFY — add onAgentMeta callback, handle agent_meta message
├── App.tsx                               # MODIFY — wrap with AgentProvider
├── index.css                             # MODIFY — CSS custom properties per agent
└── main.tsx                              # UNCHANGED

src/commands/
└── index.ts                              # MODIFY — agent.displayName → agent.meta.displayName

README.md                                 # MODIFY — document multi-agent support
```

---

## Execution Order Gate

Task 1 updates shared adapter/session types. **Task 1.5 (Kimi CLI Integration Verification) must run immediately after Task 1 and before Tasks 2, 3, or 5.** Tasks 2, 3, and 5 assume Kimi CLI flags, stream-json schema, session index paths, and local file access behavior. If verification finds any mismatch, update the affected task snippets before writing implementation code.

Recommended execution order:

1. Task 1 — shared `AgentMeta` + session tree types
2. Task 1.5 — Kimi CLI verification and recorded findings
3. Task 2 + Task 5 in parallel (Kimi translator & data reader) → Task 3 (KimiAdapter, depends on 2+5) → Task 6 (unified session service)
4. Tasks 7-7.6 — server/API/WS/attachment integration
5. Task 4 + Task 8 (frontend theme config + CSS, can start any time after Task 1)
6. Tasks 9-14 — frontend provider/capability wiring, docs, verification

---

### Task 1: Extend AgentAdapter with Metadata & Capabilities

**Files:**
- Modify: `src/agent/types.ts`
- Modify: `src/agent/index.ts` (re-export new types)
- Modify: `src/agent/claude/adapter.ts` (add meta getter, remove standalone id/displayName)
- Create: `src/core/session-tree-types.ts` (shared session tree interfaces)
- Modify: `src/core/claude-data.ts` (import shared tree interfaces, add `agentId: 'claude'`)
- Modify: `src/commands/index.ts` (update `agent.displayName` → `agent.meta.displayName`)
- Modify: `src/commands/index.test.ts` (mock adapter shape)
- Modify: `src/server/api-router.test.ts` (mock adapter shape)
- Modify: `src/server/smoke.test.ts` (mock adapter shape)

**Why first:** Every subsequent task depends on the AgentMeta shape. This is the foundation.

- [ ] **Step 1: Add types to agent/types.ts**

After the existing `AgentEvent` type, add:

```typescript
/** Boolean feature flags — each agent declares what it supports. */
export interface Capabilities {
  /** Session forking via CLI (--fork-session or equivalent). */
  fork: boolean;
  /** Thinking/reasoning content in stream output. */
  thinking: boolean;
  /** Token usage / cost stats in stream output. */
  usageStats: boolean;
  /** Streaming text deltas (vs complete messages flushed at once). */
  streaming: boolean;
  /** File attachment upload support. */
  attachments: boolean;
}

/** Static metadata describing an agent backend. */
export interface AgentMeta {
  /** Unique machine-readable id, e.g. "claude", "kimi". */
  id: string;
  /** Human-readable display name, e.g. "Claude Code". */
  displayName: string;
  /** Theme accent color in hex, e.g. "#f97316". */
  accentColor: string;
  /** Logo filename (e.g. "claudecode.svg") — resolved by frontend to asset URL. */
  logo: string;
  /** Feature flags for conditional UI. */
  capabilities: Capabilities;
}
```

Modify `AgentAdapter` — replace standalone `id`/`displayName` with `meta`:

```typescript
export interface AgentAdapter {
  readonly meta: AgentMeta;
  isAvailable(): Promise<boolean>;
  run(opts: AgentRunOptions): AgentRun;
}
```

- [ ] **Step 1a: Extract shared session-tree types** (create `src/core/session-tree-types.ts`)

Both `claude-data.ts` and `kimi-data.ts` define the same `SessionInfo`/`WorkspaceInfo`/`StoredTree` interfaces. Extract them to a shared file so `session-data-service.ts` doesn't couple to either backend:

```typescript
// src/core/session-tree-types.ts

export interface SessionInfo {
  id: string;
  name: string;
  cwd: string;
  startedAt: number;
  updatedAt: number;
  messageCount: number;
  archived: boolean;
  pinned: boolean;
  agentId: string;  // 'claude' | 'kimi' | ...
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
```

Update `claude-data.ts` to import from this file instead of defining the interfaces inline. `kimi-data.ts` (Task 5) and `session-data-service.ts` (Task 6) also import from here.

- [ ] **Step 2: Update agent/index.ts exports**

```typescript
// src/agent/index.ts
export type { AgentAdapter, AgentEvent, AgentRun, AgentRunOptions, AgentMeta, Capabilities } from './types';
export { ClaudeAdapter } from './claude/adapter';
```

- [ ] **Step 3: Update ClaudeAdapter to use meta**

In `src/agent/claude/adapter.ts`, remove `readonly id` and `readonly displayName`, replace with:

```typescript
import type { AgentAdapter, AgentMeta, AgentRun, AgentRunOptions } from '../types';

export class ClaudeAdapter implements AgentAdapter {
  readonly meta: AgentMeta = {
    id: 'claude',
    displayName: 'Claude Code',
    accentColor: '#f97316',
    logo: 'claudecode.svg',
    capabilities: {
      fork: true,
      thinking: true,
      usageStats: true,
      streaming: true,
      attachments: true,
    },
  };

  // ... rest unchanged — binary, isAvailable(), run() stay the same
```

Update any internal references from `this.id` to `this.meta.id` and `this.displayName` to `this.meta.displayName`.

- [ ] **Step 3b: Update commands/index.ts**

In `src/commands/index.ts`, the `/status` handler references `ctx.agent.displayName` (line 102). After removing standalone `displayName` from the interface, this must change:

```typescript
// OLD:
`**🤖 Agent:** ${ctx.agent.displayName}`,

// NEW:
`**🤖 Agent:** ${ctx.agent.meta.displayName}`,
```

- [ ] **Step 3c: Update test mock adapters (3 files)**

Three test files construct mock `AgentAdapter` objects using the old `{ id, displayName }` shape. They must be updated to the new `meta` shape or they will fail TypeScript compilation.

> 💡 **Shared test fixture opportunity:** All three mocks produce near-identical `AgentAdapter` shapes with the same `meta` structure. After updating them, consider extracting a `createMockAgent(overrides?)` factory to a shared test helper (e.g. `src/test-utils/mock-agent.ts`) so future `AgentMeta` changes only touch one place.

**`src/commands/index.test.ts`** — `mockAgent()` (line 6-12):

```typescript
// OLD:
function mockAgent(): AgentAdapter {
  return {
    id: 'test',
    displayName: 'Test Agent',
    isAvailable: vi.fn().mockResolvedValue(true),
    run: vi.fn(),
  };
}

// NEW:
function mockAgent(): AgentAdapter {
  return {
    meta: {
      id: 'test',
      displayName: 'Test Agent',
      accentColor: '#000000',
      logo: 'test.svg',
      capabilities: { fork: false, thinking: false, usageStats: false, streaming: false, attachments: false },
    },
    isAvailable: vi.fn().mockResolvedValue(true),
    run: vi.fn(),
  };
}
```

The `/status` test assertion on line 125 (`expect(result?.message).toContain('Test Agent')`) still passes — the displayed text is the same, only the access path changed.

**`src/server/api-router.test.ts`** — `mockAgent()` (line 45-52):

```typescript
// OLD:
function mockAgent(): AgentAdapter {
  return {
    id: 'test',
    displayName: 'Test',
    isAvailable: vi.fn().mockResolvedValue(true),
    run: vi.fn(),
  };
}

// NEW:
function mockAgent(): AgentAdapter {
  return {
    meta: {
      id: 'test',
      displayName: 'Test',
      accentColor: '#000000',
      logo: 'test.svg',
      capabilities: { fork: true, thinking: true, usageStats: true, streaming: true, attachments: true },
    },
    isAvailable: vi.fn().mockResolvedValue(true),
    run: vi.fn(),
  };
}
```

Set `fork: true` so the existing branch endpoint tests continue to pass.

**`src/server/smoke.test.ts`** — `mockAgent()` (line 17-26):

```typescript
// OLD:
function mockAgent(): AgentAdapter {
  return {
    id: 'test',
    displayName: 'Test Agent',
    isAvailable: async () => true,
    run: () => { throw new Error('agent.run not implemented in smoke test'); },
  };
}

// NEW:
function mockAgent(): AgentAdapter {
  return {
    meta: {
      id: 'test',
      displayName: 'Test Agent',
      accentColor: '#000000',
      logo: 'test.svg',
      capabilities: { fork: false, thinking: false, usageStats: false, streaming: false, attachments: false },
    },
    isAvailable: async () => true,
    run: () => { throw new Error('agent.run not implemented in smoke test'); },
  };
}
```

- [ ] **Step 4: Run existing tests to verify no breakage**

Run: `npx vitest run`
Expected: All existing tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agent/types.ts src/agent/index.ts src/agent/claude/adapter.ts src/core/session-tree-types.ts src/core/claude-data.ts src/commands/index.ts src/commands/index.test.ts src/server/api-router.test.ts src/server/smoke.test.ts
git commit -m "feat: add AgentMeta and Capabilities to AgentAdapter

Each adapter declares: id, displayName, accentColor, logo, capabilities
(fork, thinking, usageStats, streaming, attachments). Frontend will use
this for per-agent theming and conditional UI.

Updated shared session tree types and 3 test files with mock AgentAdapter
using the new meta shape."
```

---

### Task 1.5: Kimi CLI Integration Verification (⚠️ REQUIRED before Tasks 2, 3, and 5)

**Files:**
- Create: `docs/superpowers/specs/kimi-cli-verification.md`

**Why this task:** Tasks 2, 3, and 5 assume Kimi CLI behavior (`-p`, `--output-format stream-json`, `--session`, `--yolo`, `--auto`, `--plan`, `~/.kimi-code/session_index.jsonl`, `state.json`, `wire.jsonl`, local file access in `-p` mode). These assumptions come from documentation and must be verified before implementation. If any assumption is wrong, Kimi support will silently break in production.

**⚠️ DO NOT skip this task.** If Kimi CLI is unavailable, stop and either install/verify it or revise this plan to implement Claude-only abstractions first. If any verification step fails, update the relevant plan task before writing adapter/data-reader code.

- [ ] **Step 1: Verify Kimi CLI is installed and responds**

Run:

```bash
kimi --version
```

Expected: exits 0 and prints a version string. Record the exact output in `docs/superpowers/specs/kimi-cli-verification.md`.

- [ ] **Step 2: Verify stream-json output format**

Run:

```bash
kimi -p "say hello" --output-format stream-json
```

Expected: JSONL lines with role-based messages, including assistant content. Check and record:
- Whether the prompt is echoed as `{"role":"user",...}`
- Whether assistant messages contain `content` as a string or structured value
- Whether tool calls appear as `tool_calls` inside assistant messages
- Whether any init/session metadata event appears before messages

If the schema differs from Task 2's assumptions, edit Task 2 before implementing it.

- [ ] **Step 3: Verify persistent session files**

Run:

```bash
kimi -p "my name is TestUser" --output-format stream-json
```

Then inspect:

```bash
cat ~/.kimi-code/session_index.jsonl
```

Expected: `session_index.jsonl` exists and contains valid JSONL entries with session identifier, session directory, and working directory fields. Verify the referenced session directory contains the equivalent of `state.json` and `wire.jsonl`. If field names differ from `{sessionId, sessionDir, workDir}`, update Task 5 and Task 6 before implementation.

- [ ] **Step 4: Verify resume flag**

Using a session ID from Step 3, run:

```bash
kimi -p "what is my name?" --session <SESSION_ID> --output-format stream-json
```

Expected: Kimi resumes the prior session. If `--session` is rejected or named differently, update Task 3's argument mapping.

- [ ] **Step 5: Verify permission flags**

Run:

```bash
kimi -p "test" --yolo --output-format stream-json
kimi -p "test" --auto --output-format stream-json
kimi -p "test" --plan --output-format stream-json
```

Expected: all three flags are accepted without "unknown flag" errors. If any flag is rejected, update `KimiCodeAdapter` permission mapping in Task 3.

- [ ] **Step 6: Verify local file access in `-p` mode**

Run:

```bash
printf "test content\n" > /tmp/cli-mobile-kimi-test.txt
kimi -p "read /tmp/cli-mobile-kimi-test.txt and tell me what it says" --output-format stream-json --yolo
rm /tmp/cli-mobile-kimi-test.txt
```

Expected: Kimi reads the file and includes its content in the response. If it fails or says it cannot read files, set `attachments: false` in Kimi's `AgentMeta.capabilities` and adjust frontend attachment expectations.

- [ ] **Step 7: Record findings**

Create `docs/superpowers/specs/kimi-cli-verification.md` with:

```bash
mkdir -p docs/superpowers/specs
```

```markdown
# Kimi CLI Verification

Date: 2026-06-24
Kimi CLI version: <paste exact output>

## Stream JSON
- Prompt echo:
- Assistant content shape:
- Tool call shape:
- Session/init metadata:

## Session Files
- Session index path:
- Session index fields:
- Session state path/fields:
- Wire/history path:

## Flags
- --session:
- --yolo:
- --auto:
- --plan:

## Local File Access
- Result:
- Attachment capability decision:

## Plan Updates Required
- <write "None" if every assumption matched; otherwise list exact tasks/lines to update>
```

- [ ] **Step 8: Commit verification notes**

```bash
git add docs/superpowers/specs/kimi-cli-verification.md docs/superpowers/plans/2026-06-24-multi-agent-support.md
git commit -m "docs: verify Kimi CLI assumptions for multi-agent support"
```

---

### Task 2: Kimi Stream-JSON Translator

> ⚠️ **Prerequisite:** Task 1.5 (Kimi CLI verification) must pass first. The JSONL schema below is documentation-based until verified; if Task 1.5 finds differences, update this task before writing code.

**Files:**
- Create: `src/agent/kimi/stream-json.ts`
- Create: `src/agent/kimi/stream-json.test.ts`

**Background:** Kimi Code's `--output-format stream-json` emits JSONL in OpenAI-compatible role-based format:

```json
{"role": "user", "content": "prompt text"}
{"role": "assistant", "content": "response text"}
{"role": "assistant", "content": "text", "tool_calls": [{"type": "function", "id": "tc_1", "function": {"name": "Shell", "arguments": "{\"command\":\"ls\"}"}}]}
{"role": "tool", "tool_call_id": "tc_1", "content": "file1\nfile2"}
```

Key differences from Claude's format: no system init event, no thinking in JSONL, no usage stats, tool calls embedded in assistant messages, complete messages not deltas.

**Interfaces:**
- Consumes: `AgentEvent` from `src/agent/types.ts`
- Produces: `translateEvent(raw: unknown): Generator<AgentEvent>` — same signature as Claude's translator

- [ ] **Step 1: Write the translator**

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

  if (msg.role === 'user') return; // echoed prompt, skip

  if (msg.role === 'assistant') {
    const content = typeof msg.content === 'string' ? msg.content : '';
    if (content) yield { type: 'text', delta: content };

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

- [ ] **Step 2: Write tests (10 cases)**

```typescript
// src/agent/kimi/stream-json.test.ts
import { describe, it, expect } from 'vitest';
import { translateEvent } from './stream-json';

describe('translateEvent', () => {
  it('emits text for assistant message', () => {
    expect([...translateEvent({ role: 'assistant', content: 'Hello!' })])
      .toEqual([{ type: 'text', delta: 'Hello!' }]);
  });

  it('skips user messages', () => {
    expect([...translateEvent({ role: 'user', content: 'prompt' })])
      .toEqual([]);
  });

  it('emits text + tool_use for assistant with tool_calls', () => {
    const events = [...translateEvent({
      role: 'assistant', content: 'Checking...',
      tool_calls: [{
        type: 'function', id: 't1',
        function: { name: 'Shell', arguments: '{"command":"ls"}' }
      }]
    })];
    expect(events).toEqual([
      { type: 'text', delta: 'Checking...' },
      { type: 'tool_use', id: 't1', name: 'Shell', input: { command: 'ls' } }
    ]);
  });

  it('emits only tool_use when content is empty', () => {
    const events = [...translateEvent({
      role: 'assistant', content: '',
      tool_calls: [{
        type: 'function', id: 't2',
        function: { name: 'Read', arguments: '{"file":"a.txt"}' }
      }]
    })];
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'tool_use', id: 't2' });
  });

  it('emits tool_result for tool messages', () => {
    expect([...translateEvent({
      role: 'tool', tool_call_id: 't1', content: 'file1.py\nfile2.py'
    })]).toEqual([
      { type: 'tool_result', id: 't1', output: 'file1.py\nfile2.py', isError: false }
    ]);
  });

  it('emits multiple tool_use for multiple tool_calls', () => {
    const events = [...translateEvent({
      role: 'assistant', content: '',
      tool_calls: [
        { type: 'function', id: 'a', function: { name: 'Read', arguments: '{}' } },
        { type: 'function', id: 'b', function: { name: 'Grep', arguments: '{}' } }
      ]
    })];
    expect(events).toHaveLength(2);
  });

  it('skips invalid objects', () => {
    expect([...translateEvent({})]).toEqual([]);
    expect([...translateEvent(null)]).toEqual([]);
  });

  it('stringifies non-string tool content', () => {
    expect([...translateEvent({
      role: 'tool', tool_call_id: 'x', content: { result: 'ok' }
    })]).toEqual([
      { type: 'tool_result', id: 'x', output: '{"result":"ok"}', isError: false }
    ]);
  });

  it('handles object arguments in tool_calls', () => {
    const events = [...translateEvent({
      role: 'assistant', content: '',
      tool_calls: [{
        type: 'function', id: 't3',
        function: { name: 'Bash', arguments: { command: 'ls' } }
      }]
    })];
    expect(events[0]).toMatchObject({ input: { command: 'ls' } });
  });

  it('passes malformed arguments string through', () => {
    const events = [...translateEvent({
      role: 'assistant', content: '',
      tool_calls: [{
        type: 'function', id: 't4',
        function: { name: 'X', arguments: 'not-json' }
      }]
    })];
    expect(events[0]).toMatchObject({ input: 'not-json' });
  });
});
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run src/agent/kimi/stream-json.test.ts`
Expected: All 10 PASS.

- [ ] **Step 4: Commit**

```bash
git add src/agent/kimi/stream-json.ts src/agent/kimi/stream-json.test.ts
git commit -m "feat: add Kimi Code stream-json translator

Translates Kimi's OpenAI-compatible role-based JSONL (user/assistant/tool)
into AgentEvent stream. Key differences from Claude:
- No system init event, no thinking, no usage stats
- Tool calls embedded in assistant messages
- Complete messages, not streaming deltas"
```

---

### Task 3: KimiCodeAdapter

**Files:**
- Create: `src/agent/kimi/adapter.ts`
- Create: `src/agent/kimi/adapter.test.ts`
- Modify: `src/agent/index.ts` (add export)

> ⚠️ **Dependency:** Requires Task 1.5 (Kimi CLI verification), Task 2 (stream-json translator), and Task 5 (`kimi-data.ts`). The adapter statically imports `readKimiSessionIds` for new-session detection.
>
> **⛔ Do NOT implement Task 3 before Task 5.** The adapter imports `readKimiSessionIds` from `../../core/kimi-data` — this module does not exist until Task 5 is complete. Task 3 is numbered before Task 5 for narrative flow (adapter → data reader → service), but the dependency arrow goes the other way: build Task 5 first, then come back to Task 3.

**Interfaces:**
- Consumes: `AgentAdapter`, `AgentMeta`, `Capabilities`, `AgentRun`, `AgentRunOptions` from types.ts
- Consumes: `translateEvent` from `./stream-json`
- Produces: `KimiCodeAdapter` class implementing `AgentAdapter`

**Kimi CLI argument mapping:**

| AgentRunOptions field | Kimi CLI flag | Notes |
|---|---|---|
| `prompt` | `-p` | Same as Claude |
| `sessionId` | `--session <id>` | NOT `--resume` |
| `forkFrom` | N/A | Throws — Kimi `/fork` is TUI-only, no CLI equivalent |
| `model` | `--model` | e.g. `kimi-code/kimi-for-coding` |
| `permissionMode: 'bypassPermissions'` | `--yolo` | |
| `permissionMode: 'acceptEdits'` | `--auto` | Closest match |
| `permissionMode: 'plan'` | `--plan` | |
| `permissionMode: 'default'` | (omit flag) | Kimi default is interactive |

- [ ] **Step 1: Write the adapter**

```typescript
// src/agent/kimi/adapter.ts
import type { ChildProcessByStdio } from 'node:child_process';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';
import type { AgentAdapter, AgentMeta, AgentEvent, AgentRun, AgentRunOptions } from '../types';
import { translateEvent } from './stream-json';
import { readKimiSessionIds, readKimiSessionIdsSync } from '../../core/kimi-data';

export interface KimiCodeAdapterOptions {
  binary?: string;
}

type KimiChild = ChildProcessByStdio<null, Readable, Readable>;

export class KimiCodeAdapter implements AgentAdapter {
  readonly meta: AgentMeta = {
    id: 'kimi',
    displayName: 'Kimi Code',
    accentColor: '#3b82f6',
    logo: 'kimi.svg',
    capabilities: {
      fork: false,
      thinking: false,
      usageStats: false,
      streaming: false,
      attachments: true,
    },
  };

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
    if (opts.forkFrom) {
      throw new Error(
        'Kimi Code does not support --fork-session via CLI. ' +
        'Session forking (/fork) is only available in the Kimi TUI, ' +
        'not in non-interactive (-p) mode.'
      );
    }

    const args = ['-p', opts.prompt, '--output-format', 'stream-json'];

    if (opts.sessionId) args.push('--session', opts.sessionId);
    if (opts.model) args.push('--model', opts.model);

    switch (opts.permissionMode) {
      case 'bypassPermissions': args.push('--yolo'); break;
      case 'acceptEdits':       args.push('--auto'); break;
      case 'plan':              args.push('--plan'); break;
      case 'default':           break;
      default:                  args.push('--yolo'); break;
    }

    const child = spawn(this.binary, args, {
      cwd: opts.cwd,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    }) as KimiChild;

    // Pre-read existing session IDs BEFORE spawn to avoid the race where
    // Kimi writes session_index.jsonl between spawn and the first stream read.
    // Uses sync I/O because run() is synchronous (AgentAdapter contract).
    const knownIds = new Set<string>();
    if (!opts.sessionId) {
      try {
        for (const id of readKimiSessionIdsSync()) knownIds.add(id);
      } catch { /* non-fatal */ }
    }

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
    child.on('error', (err) => { runtimeError = err; });
    child.on('exit', (code, signal) => {
      console.log('[agent:kimi] exit', { pid: child.pid ?? null, code, signal });
    });

    const stopGraceMs = opts.stopGraceMs ?? 5000;

    return {
      events: createEventStream(child, stderrChunks, () => runtimeError, opts.sessionId, knownIds),

      async stop() {
        if (child.exitCode !== null || child.signalCode !== null) return;
        child.kill('SIGTERM');
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
            resolve();
          }, stopGraceMs);
          child.once('exit', () => { clearTimeout(timer); resolve(); });
        });
      },

      waitForExit(timeoutMs: number): Promise<boolean> {
        if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
        return new Promise<boolean>((resolve) => {
          const onExit = (): void => { clearTimeout(timer); resolve(true); };
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
  knownSessionId: string | undefined,
  knownIds: Set<string>,
): AsyncGenerator<AgentEvent> {
  if (!child.pid) {
    const err = getError();
    yield { type: 'error', message: err ? `failed to spawn kimi: ${err.message}` : 'spawn returned no pid' };
    return;
  }

  // Kimi stream-json lacks init event — synthesize one if sessionId known
  if (knownSessionId) {
    yield { type: 'system', sessionId: knownSessionId };
  }

  const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let parsed: unknown;
      try { parsed = JSON.parse(trimmed); } catch { continue; }
      yield* translateEvent(parsed);
    }
  } finally {
    rl.close();
  }

  const exitCode = await new Promise<number | null>((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) resolve(child.exitCode);
    else child.once('exit', (code) => resolve(code));
  });

  const runtimeError = getError();
  if (exitCode !== 0 && exitCode !== null) {
    const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();
    const detail = stderr ? `: ${stderr.slice(0, 500)}` : '';
    yield { type: 'error', message: `kimi exited with code ${exitCode}${detail}` };
  } else if (runtimeError) {
    yield { type: 'error', message: `kimi runtime error: ${runtimeError.message}` };
  }

  // After successful exit, detect new session ID (for sessionId='new' prompts).
  // Kimi writes the session to session_index.jsonl after the first message.
  if (exitCode === 0 && !knownSessionId) {
    try {
      const currentIds = await readKimiSessionIds();
      const newId = currentIds.find(id => !knownIds.has(id));
      if (newId) {
        yield { type: 'system', sessionId: newId };
      }
    } catch { /* non-fatal */ }
  }

  if (exitCode === 0) yield { type: 'done' };
}
```

- [ ] **Step 2: Write adapter tests (7 cases)**

```typescript
// src/agent/kimi/adapter.test.ts
import { describe, it, expect, vi } from 'vitest';
import { KimiCodeAdapter } from './adapter';

describe('KimiCodeAdapter', () => {
  it('meta.id is "kimi"', () => {
    expect(new KimiCodeAdapter().meta.id).toBe('kimi');
  });

  it('meta.displayName is "Kimi Code"', () => {
    expect(new KimiCodeAdapter().meta.displayName).toBe('Kimi Code');
  });

  it('accentColor is blue #3b82f6', () => {
    expect(new KimiCodeAdapter().meta.accentColor).toBe('#3b82f6');
  });

  it('capabilities: fork=false, thinking=false, usageStats=false', () => {
    const c = new KimiCodeAdapter().meta.capabilities;
    expect(c.fork).toBe(false);
    expect(c.thinking).toBe(false);
    expect(c.usageStats).toBe(false);
  });

  it('isAvailable returns false for nonexistent binary', async () => {
    const a = new KimiCodeAdapter({ binary: 'definitely-not-real-xyz' });
    expect(await a.isAvailable()).toBe(false);
  });

  it('run() with forkFrom throws descriptive error', () => {
    const a = new KimiCodeAdapter();
    expect(() => a.run({ prompt: 'test', forkFrom: 'id' }))
      .toThrow(/--fork-session/);
  });

  it('run() with sessionId constructs AgentRun without spawning', () => {
    // Use a stub binary that won't produce streaming output, but won't crash.
    // The test only verifies the AgentRun shape is correct, not the process I/O.
    const a = new KimiCodeAdapter({ binary: 'echo' });
    const run = a.run({ prompt: 'test', sessionId: 'abc' });
    expect(run.events).toBeDefined();
    expect(typeof run.stop).toBe('function');
    expect(typeof run.waitForExit).toBe('function');
    // Clean up — echo exits immediately, but stop ensures no zombie
    run.stop();
  });
});
```

> **Note on `attachments: true`:** Attachments are injected into the prompt as local file paths by `withAttachmentContext()` in `ws-server.ts` — the adapter itself does not need a CLI flag. The `attachments` capability reflects whether the agent can read arbitrary local files referenced in the prompt. This needs verification for Kimi's non-interactive `-p` mode. If Kimi cannot access local file paths in `-p` mode, change to `attachments: false`.

- [ ] **Step 3: Run tests**

Run: `npx vitest run src/agent/kimi/adapter.test.ts`
Expected: 7 PASS.

- [ ] **Step 4: Update agent/index.ts**

```typescript
// src/agent/index.ts
export type { AgentAdapter, AgentEvent, AgentRun, AgentRunOptions, AgentMeta, Capabilities } from './types';
export { ClaudeAdapter } from './claude/adapter';
export { KimiCodeAdapter } from './kimi/adapter';
```

- [ ] **Step 5: Commit**

```bash
git add src/agent/kimi/adapter.ts src/agent/kimi/adapter.test.ts src/agent/index.ts
git commit -m "feat: add KimiCodeAdapter with AgentMeta

Blue theme (#3b82f6), kimi.svg logo. Capabilities: fork=false, thinking=false,
usageStats=false. Permission mode mapping: bypassPermissions→--yolo,
acceptEdits→--auto, plan→--plan. Throws clear error on forkFrom."
```

---

### Task 4: Frontend Theme Config + Logo Map

> ⚠️ **Single source of truth:** The server reads agent identity from `AgentAdapter.meta` (declared in each adapter). There is NO server-side `agent-themes.ts` — it would be dead code since `/api/agent` returns `agent.meta` directly. The frontend needs its own config ONLY for `LOGO_MAP` (SVG asset imports that Vite resolves at build time) and a minimal offline fallback.

**Files:**
- Create: `src/mobile/assets/logos/claudecode.svg`
- Create: `src/mobile/assets/logos/kimi.svg`
- Create: `src/mobile/assets/logos/codex.svg`
- Create: `src/mobile/assets/logos/qoder.svg`
- Create: `src/mobile/lib/agent-themes.ts` — frontend-only: SVG logo imports + offline fallback

- [ ] **Step 0: Migrate SVG assets before importing them**

The SVGs currently live in `img/` at the repo root. Copy them into Vite's source tree before creating `agent-themes.ts`; otherwise the imports in Step 1 fail during typecheck/build.

Run:

```bash
mkdir -p src/mobile/assets/logos
cp img/claudecode.svg src/mobile/assets/logos/
cp img/kimi.svg src/mobile/assets/logos/
cp img/codex.svg src/mobile/assets/logos/
cp img/qoder.svg src/mobile/assets/logos/
```

Expected: all four SVG files exist under `src/mobile/assets/logos/`.

- [ ] **Step 1: Create frontend theme config with SVG imports**

```typescript
// src/mobile/lib/agent-themes.ts
// Theme config + SVG logo imports for Vite bundling.
// Keep fallback entries in sync with AgentAdapter.meta declarations.

import claudeLogo from '../assets/logos/claudecode.svg';
import kimiLogo from '../assets/logos/kimi.svg';
import codexLogo from '../assets/logos/codex.svg';
import qoderLogo from '../assets/logos/qoder.svg';

export interface Capabilities {
  fork: boolean; thinking: boolean; usageStats: boolean; streaming: boolean; attachments: boolean;
}

export interface AgentMeta {
  id: string; displayName: string; accentColor: string; logo: string; capabilities: Capabilities;
}

export interface AgentTheme {
  cssClass: string; meta: AgentMeta;
}

/** Resolve an agent's logo filename to the actual SVG asset URL.
 *  e.g. LOGO_MAP['claudecode'] → imported SVG URL
 *  The API returns the filename string; the frontend maps it here. */
export const LOGO_MAP: Record<string, string> = {
  claudecode: claudeLogo,
  kimi: kimiLogo,
  codex: codexLogo,
  qoder: qoderLogo,
};

export const ALL_AGENTS: AgentTheme[] = [
  {
    cssClass: 'claude',
    meta: {
      id: 'claude', displayName: 'Claude Code', accentColor: '#f97316', logo: 'claudecode.svg',
      capabilities: { fork: true, thinking: true, usageStats: true, streaming: true, attachments: true },
    },
  },
  {
    cssClass: 'kimi',
    meta: {
      id: 'kimi', displayName: 'Kimi Code', accentColor: '#3b82f6', logo: 'kimi.svg',
      capabilities: { fork: false, thinking: false, usageStats: false, streaming: false, attachments: true },
    },
  },
];
```

- [ ] **Step 2: Add source-of-truth comment**

The frontend `agent-themes.ts` `ALL_AGENTS` array is an offline fallback — the primary agent metadata comes from `GET /api/agent` (which reads `agent.meta` from the active adapter). Add this comment at the top:

```typescript
/**
 * Frontend theme config — offline fallback only.
 *
 * PRIMARY source of truth: AgentAdapter.meta (per-adapter declaration).
 * The server serves this via GET /api/agent. This file provides:
 * 1. LOGO_MAP — Vite-resolved SVG imports (build-time, server can't do this)
 * 2. ALL_AGENTS — offline fallback if /api/agent is unreachable
 *
 * When adding a new agent, update:
 * 1. Its adapter.meta (source of truth)
 * 2. This file (LOGO_MAP entry + SVG import + ALL_AGENTS fallback entry)
 * 3. src/mobile/index.css (CSS custom properties for [data-agent="..."])
 * No server-side theme config file exists — it's redundant with adapter.meta.
 */
```

- [ ] **Step 3: Commit**

```bash
git add src/mobile/lib/agent-themes.ts src/mobile/assets/logos/
git commit -m "feat: add frontend theme config with SVG logo map

LOGO_MAP resolves agent logo filenames to Vite-imported SVG URLs.
ALL_AGENTS provides offline fallback if /api/agent is unreachable.
Primary metadata source is AgentAdapter.meta — no server-side duplicate."
```

---

### Task 5: Kimi Session Data Reader

> **Note:** This task creates `kimi-data.ts` as a backend module. The next task (Task 6) builds `session-data-service.ts` on top of it — server code will import only the service, never `claude-data` or `kimi-data` directly.

**Files:**
- Create: `src/core/kimi-data.ts`

**Interfaces (mirrors claude-data.ts):** `SessionInfo`, `WorkspaceInfo`, `StoredTree`, `refreshTree()`, `readTree()`, `updateSessionName()`, `archiveSession()`, `restoreSession()`, `togglePin()`

Kimi stores sessions at `~/.kimi-code/session_index.jsonl` (JSONL with `{sessionId, sessionDir, workDir}`). Each session has `state.json` with `{title, lastPrompt, createdAt, updatedAt}`.

- [ ] **Step 1: Write the reader**

```typescript
// src/core/kimi-data.ts
import { readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import type { SessionInfo, WorkspaceInfo, StoredTree } from './session-tree-types';

const KIMI_CODE_HOME = process.env.KIMI_CODE_HOME || join(homedir(), '.kimi-code');
const SESSION_INDEX_PATH = join(KIMI_CODE_HOME, 'session_index.jsonl');
const MOBILE_DIR = join(homedir(), '.cli-mobile');
export const KIMI_TREE_PATH = join(MOBILE_DIR, 'kimi-tree.json');

interface IndexEntry { sessionId: string; sessionDir: string; workDir: string; }
interface SessionState { title?: string; createdAt?: number; updatedAt?: number; }

async function readIndex(): Promise<IndexEntry[]> {
  try {
    const text = await readFile(SESSION_INDEX_PATH, 'utf8');
    return text.split('\n').map(l => l.trim()).filter(Boolean)
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter((e): e is IndexEntry => e?.sessionId && e?.sessionDir && e?.workDir);
  } catch { return []; }
}

/** Return all known Kimi session IDs (for new-session detection by the adapter). */
export async function readKimiSessionIds(): Promise<string[]> {
  const entries = await readIndex();
  return entries.map(e => e.sessionId);
}

/** Synchronous version — used in adapter's `run()` which cannot be async.
 *  Reads session_index.jsonl directly with `readFileSync`. */
export function readKimiSessionIdsSync(): string[] {
  try {
    const text = readFileSync(SESSION_INDEX_PATH, 'utf8');
    return text.split('\n').map(l => l.trim()).filter(Boolean)
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter((e: any): e is IndexEntry => e?.sessionId && e?.sessionDir && e?.workDir)
      .map(e => e.sessionId);
  } catch { return []; }
}

async function readState(sessionDir: string): Promise<SessionState | null> {
  try { return JSON.parse(await readFile(join(sessionDir, 'state.json'), 'utf8')); } catch { return null; }
}

export async function refreshTree(userNames: Record<string, string> = {}): Promise<StoredTree> {
  const oldTree = await readTree();
  const names: Record<string, string> = { ...userNames };
  const oldState = new Map<string, { archived: boolean; pinned: boolean }>();
  for (const ws of oldTree.workspaces) {
    for (const s of ws.sessions) {
      if (s.name && !names[s.id]) names[s.id] = s.name;
      oldState.set(s.id, { archived: s.archived ?? false, pinned: s.pinned ?? false });
    }
  }

  const entries = await readIndex();
  const cwdMap = new Map<string, { sessions: SessionInfo[] }>();

  for (const e of entries) {
    const dirStat = await stat(e.workDir).catch(() => null);
    if (!dirStat?.isDirectory()) continue;
    const st = await readState(e.sessionDir);
    const prev = oldState.get(e.sessionId);
    const session: SessionInfo = {
      id: e.sessionId, name: names[e.sessionId] || st?.title || '', cwd: e.workDir,
      startedAt: st?.createdAt || 0, updatedAt: st?.updatedAt || 0,
      messageCount: 0, // wire.jsonl parsing deferred
      archived: prev?.archived ?? false, pinned: prev?.pinned ?? false,
      agentId: 'kimi',
    };
    const existing = cwdMap.get(e.workDir);
    if (existing) existing.sessions.push(session);
    else cwdMap.set(e.workDir, { sessions: [session] });
  }

  const workspaces: WorkspaceInfo[] = [];
  for (const [cwd, entry] of cwdMap) {
    entry.sessions.sort((a, b) => b.updatedAt - a.updatedAt);
    workspaces.push({ name: basename(cwd) || cwd, cwd, sessions: entry.sessions });
  }
  workspaces.sort((a, b) => (b.sessions[0]?.updatedAt ?? 0) - (a.sessions[0]?.updatedAt ?? 0));

  const tree: StoredTree = { workspaces, updatedAt: Date.now() };
  await mkdir(MOBILE_DIR, { recursive: true });
  await writeFile(KIMI_TREE_PATH, JSON.stringify(tree, null, 2) + '\n', 'utf8');
  return tree;
}

export async function readTree(): Promise<StoredTree> {
  try { return JSON.parse(await readFile(KIMI_TREE_PATH, 'utf8')); }
  catch { return { workspaces: [], updatedAt: 0 }; }
}

export async function updateSessionName(sessionId: string, name: string): Promise<boolean> {
  const tree = await readTree(); let found = false;
  for (const ws of tree.workspaces) for (const s of ws.sessions) if (s.id === sessionId) { s.name = name; found = true; }
  if (!found) return false;
  tree.updatedAt = Date.now();
  await writeFile(KIMI_TREE_PATH, JSON.stringify(tree, null, 2) + '\n', 'utf8');
  return true;
}

async function updateField(sessionId: string, fields: Partial<SessionInfo>): Promise<boolean> {
  const tree = await readTree();
  let found = false;
  for (const ws of tree.workspaces) {
    for (const s of ws.sessions) {
      if (s.id === sessionId) {
        Object.assign(s, fields);
        found = true;
        break;
      }
    }
    if (found) break;
  }
  if (!found) return false;
  tree.updatedAt = Date.now();
  await writeFile(KIMI_TREE_PATH, JSON.stringify(tree, null, 2) + '\n', 'utf8');
  return true;
}

export const archiveSession = (id: string) => updateField(id, { archived: true });
export const restoreSession = (id: string) => updateField(id, { archived: false });

export async function togglePin(sessionId: string): Promise<boolean> {
  const tree = await readTree();
  for (const ws of tree.workspaces) for (const s of ws.sessions) {
    if (s.id === sessionId) { s.pinned = !s.pinned; tree.updatedAt = Date.now(); await writeFile(KIMI_TREE_PATH, JSON.stringify(tree, null, 2) + '\n', 'utf8'); return true; }
  }
  return false;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/core/kimi-data.ts
git commit -m "feat: add Kimi Code session data reader

Reads ~/.kimi-code/session_index.jsonl and per-session state.json.
Same interface as claude-data.ts. Caches to ~/.cli-mobile/kimi-tree.json.
messageCount is 0 — wire.jsonl parsing is deferred."
```

---

### Task 6: Unified Session Data Service

> ⚠️ **Dependency:** Requires Task 5 (`kimi-data.ts`) — the service imports from `./kimi-data`.

**Files:**
- Create: `src/core/session-data-service.ts` — agent-dispatched read/refresh/mutate for session trees
- Create: `src/core/kimi-history.ts` — Kimi wire.jsonl history reader
- Modify: `src/core/kimi-data.ts` — add/verify mutation miss behavior if tests expose a gap
- Modify: `src/core/claude-data.ts` — add `agentId: 'claude'` to SessionInfo in refreshTree()

**Why this task now:** Every subsequent task (server integration, frontend wiring) needs to read/write session trees. If they continue importing directly from `claude-data`, Kimi sessions will be overwritten on every refresh (issue #1), history won't work (issue #2), and archive/restore/pin will write to the wrong tree (issue #5). This task creates a single entry point that dispatches by agentId.

**Design:**

```
                    session-data-service.ts
                    ┌──────────────────────────────────────────────┐
                    │  readActiveTree(agentId)                      │
                    │  refreshActiveTree(agentId)                   │
                    │  updateSessionName(id, name, activeAgentId)   │
                    │  archiveSession(id, activeAgentId)            │
                    │  restoreSession / togglePin(id, activeAgentId)│
                    │  readHistory(id, activeAgentId, max)          │
                    │  resolveRunTarget(ws, sid, fork, activeAgentId)│
                    └──────┬──────────────┬─────────────────────────┘
                           │              │
                    ┌──────▼──────┐  ┌───▼──────────┐
                    │ claude-data │  │  kimi-data    │
                    │ (existing)  │  │  kimi-history │
                    └─────────────┘  └──────────────┘
```
All mutation/history functions take `activeAgentId` — no cross-agent scanning. The MUTATORS/HISTORY_READERS lookup tables dispatch to the correct backend module.

Every function dispatches by `agentId`. If a session has no `agentId` (legacy data), it defaults to `'claude'`.

**Multi-file tree strategy:** Each agent owns its own tree file — Claude → `~/.cli-mobile/tree.json`, Kimi → `~/.cli-mobile/kimi-tree.json`, future agents → `~/.cli-mobile/<agent>-tree.json`. The service reads **only the active agent's file** — no cross-agent merging at display time. Each agent's `refreshTree()` writes only its own file. Mutation operations (archive/restore/pin/rename) dispatch to the correct agent's file. The frontend never sees sessions from non-active agents.

- [ ] **Step 1: Create Kimi history reader**

```typescript
// src/core/kimi-history.ts
import { readFile } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { homedir } from 'node:os';

const KIMI_CODE_HOME = process.env.KIMI_CODE_HOME || join(homedir(), '.kimi-code');

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  /** Structured content blocks — not populated for Kimi (wire.jsonl lacks block-level data).
   *  Present for type compatibility with Claude messages from session-history.ts. */
  blocks?: Array<{ type: string; text?: string; thinking?: string; id?: string; name?: string; input?: unknown; tool_use_id?: string; content?: unknown; is_error?: boolean }>;
}

interface KimiWireLine {
  role: 'user' | 'assistant' | 'tool';
  content: string | unknown;
  tool_calls?: Array<{ type: string; id: string; function: { name: string; arguments: unknown } }>;
  tool_call_id?: string;
  timestamp?: string;
}

/** Find session directory from session_index.jsonl */
async function findSessionDir(sessionId: string): Promise<string | null> {
  const indexPath = join(KIMI_CODE_HOME, 'session_index.jsonl');
  if (!existsSync(indexPath)) return null;
  try {
    const text = await readFile(indexPath, 'utf8');
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        if (entry.sessionId === sessionId && entry.sessionDir) return entry.sessionDir;
      } catch { /* skip */ }
    }
  } catch { return null; }
  return null;
}

/** Read Kimi wire.jsonl and translate to unified ChatMessage[] */
export async function readKimiHistory(sessionId: string, maxMessages = 200): Promise<ChatMessage[]> {
  const sessionDir = await findSessionDir(sessionId);
  if (!sessionDir) return [];

  const wirePath = join(sessionDir, 'wire.jsonl');
  if (!existsSync(wirePath)) return [];

  return new Promise((resolve) => {
    const messages: ChatMessage[] = [];
    let pending: ChatMessage | null = null;

    const rl = createInterface({ input: createReadStream(wirePath), crlfDelay: Infinity });

    rl.on('line', (line) => {
      if (messages.length >= maxMessages) { rl.close(); return; }
      const trimmed = line.trim();
      if (!trimmed) return;

      let obj: KimiWireLine;
      try { obj = JSON.parse(trimmed); } catch { return; }

      if (obj.role === 'user') {
        // Flush pending assistant bubble
        if (pending) {
          messages.push(pending);
          pending = null;
        }
        const content = typeof obj.content === 'string' ? obj.content : JSON.stringify(obj.content);
        messages.push({ role: 'user', content, timestamp: obj.timestamp ?? '' });
        return;
      }

      if (obj.role === 'assistant') {
        const content = typeof obj.content === 'string' ? obj.content : '';
        if (!pending) {
          pending = { role: 'assistant', content: '', timestamp: obj.timestamp ?? '' };
        }
        if (content) pending.content += (pending.content ? '\n' : '') + content;
        return;
      }

      // role === 'tool' — skip, merged into assistant context
    });

    rl.on('close', () => {
      if (pending) messages.push(pending);
      resolve(messages);
    });
  });
}
```

- [ ] **Step 2: Create unified session data service**

```typescript
// src/core/session-data-service.ts
import type { SessionInfo, WorkspaceInfo, StoredTree } from './session-tree-types';
import {
  refreshTree as refreshClaudeTree,
  readTree as readClaudeTree,
  updateSessionName as claudeUpdateName,
  archiveSession as claudeArchive,
  restoreSession as claudeRestore,
  togglePin as claudeTogglePin,
} from './claude-data';
import {
  refreshTree as refreshKimiTree,
  readTree as readKimiTree,
  updateSessionName as kimiUpdateName,
  archiveSession as kimiArchive,
  restoreSession as kimiRestore,
  togglePin as kimiTogglePin,
} from './kimi-data';
import { readKimiHistory, type ChatMessage } from './kimi-history';
import { readSessionHistory } from './session-history';

// ── Tree operations (single-agent: reads only the active agent's file) ──

/** Map agent ID to its tree reader. Add new agents here. */
const TREE_READERS: Record<string, () => Promise<StoredTree>> = {
  claude: () => readClaudeTree(),
  kimi: () => readKimiTree(),
};

const TREE_REFRESHERS: Record<string, () => Promise<StoredTree>> = {
  claude: () => refreshClaudeTree(),
  kimi: () => refreshKimiTree(),
};

/** Read the active agent's tree. No cross-agent merging — the frontend
 *  only sees sessions belonging to the currently active agent. */
export async function readActiveTree(agentId: string): Promise<StoredTree> {
  const reader = TREE_READERS[agentId];
  if (!reader) return { workspaces: [], updatedAt: 0 };
  const tree = await reader();
  // Ensure all sessions carry agentId (backfill legacy data)
  for (const ws of tree.workspaces) {
    for (const s of ws.sessions) { if (!s.agentId) (s as any).agentId = agentId; }
  }
  return tree;
}

/** Refresh the active agent's tree (scans its data directory, writes its tree file). */
export async function refreshActiveTree(agentId: string): Promise<StoredTree> {
  const refresher = TREE_REFRESHERS[agentId];
  if (!refresher) return readActiveTree(agentId);
  const tree = await refresher();
  for (const ws of tree.workspaces) {
    for (const s of ws.sessions) { if (!s.agentId) (s as any).agentId = agentId; }
  }
  return tree;
}

// ── Session mutations (all operate on the active agent's tree ONLY) ──
//
// Design rule: every mutation takes `activeAgentId`. No cross-agent scanning.
// The server only serves one agent's sessions — there is never a reason to
// modify another agent's tree. sessionIds are UUIDs and cannot collide across
// agent backends, so single-tree dispatch is both safe and correct.

const MUTATORS: Record<string, {
  updateName: (id: string, name: string) => Promise<boolean>;
  archive: (id: string) => Promise<boolean>;
  restore: (id: string) => Promise<boolean>;
  togglePin: (id: string) => Promise<boolean>;
}> = {
  claude: {
    updateName: claudeUpdateName,
    archive: claudeArchive,
    restore: claudeRestore,
    togglePin: claudeTogglePin,
  },
  kimi: {
    updateName: kimiUpdateName,
    archive: kimiArchive,
    restore: kimiRestore,
    togglePin: kimiTogglePin,
  },
};

export function updateSessionName(sessionId: string, name: string, activeAgentId: string): Promise<boolean> {
  return MUTATORS[activeAgentId]?.updateName(sessionId, name) ?? Promise.resolve(false);
}
export function archiveSession(sessionId: string, activeAgentId: string): Promise<boolean> {
  return MUTATORS[activeAgentId]?.archive(sessionId) ?? Promise.resolve(false);
}
export function restoreSession(sessionId: string, activeAgentId: string): Promise<boolean> {
  return MUTATORS[activeAgentId]?.restore(sessionId) ?? Promise.resolve(false);
}
export function togglePin(sessionId: string, activeAgentId: string): Promise<boolean> {
  return MUTATORS[activeAgentId]?.togglePin(sessionId) ?? Promise.resolve(false);
}

// ── History (dispatched by agentId) ──

const HISTORY_READERS: Record<string, (sid: string, max: number) => Promise<ChatMessage[]>> = {
  claude: (sid, max) => readSessionHistory(sid, undefined, max),
  kimi: (sid, max) => readKimiHistory(sid, max),
};

export function readHistory(sessionId: string, activeAgentId: string, maxMessages = 200): Promise<ChatMessage[]> {
  const reader = HISTORY_READERS[activeAgentId];
  return reader ? reader(sessionId, maxMessages) : Promise.resolve([]);
}

// ── Run target resolution ──

export interface ResolveResult {
  ok: true; cwd: string;
}

export interface ResolveError {
  ok: false; message: string;
}

export async function resolveRunTarget(
  workspace: string,
  sessionId: string,
  forkFrom: string | undefined,
  activeAgentId: string,
): Promise<ResolveResult | ResolveError> {
  const tree = await readActiveTree(activeAgentId);
  const ws = tree.workspaces.find(w => w.name === workspace);
  if (!ws) {
    return { ok: false, message: 'Workspace not found or no longer available' };
  }

  if (forkFrom) {
    const source = ws.sessions.find(s => s.id === forkFrom);
    if (!source) {
      return { ok: false, message: 'Fork source session is not in this workspace' };
    }
    return { ok: true, cwd: source.cwd };
  }

  if (sessionId === 'new') {
    return { ok: true, cwd: ws.cwd };
  }

  const session = ws.sessions.find(s => s.id === sessionId);
  if (!session) {
    return { ok: false, message: 'Session is not in this workspace' };
  }

  return { ok: true, cwd: session.cwd };
}
```

- [ ] **Step 3: Verify kimi-data.ts mutation miss behavior**

Task 5's `updateField()` already returns `false` and skips the write when the target session does not exist. Verify the implementation matches this behavior:

```typescript
// Expected behavior (already implemented in Task 5):
async function updateField(sessionId: string, fields: Partial<SessionInfo>): Promise<boolean> {
  const tree = await readTree();
  let found = false;
  for (const ws of tree.workspaces) {
    for (const s of ws.sessions) {
      if (s.id === sessionId) { Object.assign(s, fields); found = true; break; }
    }
    if (found) break;  // exit outer loop too
  }
  if (!found) return false;
  tree.updatedAt = Date.now();
  await writeFile(KIMI_TREE_PATH, JSON.stringify(tree, null, 2) + '\n', 'utf8');
  return true;
}
```

`KIMI_TREE_PATH` is already exported from Task 5 — no additional changes needed here.

- [ ] **Step 5: Commit**

```bash
git add src/core/session-data-service.ts src/core/kimi-history.ts src/core/kimi-data.ts
git commit -m "feat: add unified session data service for multi-agent trees

- session-data-service.ts: single entry point for tree reads, writes,
  session mutations, history, and run-target resolution
- kimi-history.ts: reads Kimi wire.jsonl, translates to ChatMessage[]
- kimi-data.ts: verify updateField() returns false on miss
- All functions dispatch by agentId; legacy sessions default to claude
- resolveRunTarget uses active agent tree (no cross-agent sessions exposed)"
```

---



### Task 7: Server Integration

**Files:**
- Modify: `src/server/index.ts` — use registry, refresh active tree
- Modify: `src/server/api-router.ts` — add `/api/agent`, wrap fork with try-catch
- Modify: `src/server/ws-server.ts` — emit `agent_meta` on connection
- Modify: `src/server/ws-types.ts` — add `ServerAgentMeta` message type

- [ ] **Step 0: Create agent registry** (create `src/core/agent-registry.ts`)

> Moved here from Task 4 to avoid importing adapters that don't exist yet. All adapters (ClaudeAdapter, KimiCodeAdapter) are now built before this step.

```typescript
// src/core/agent-registry.ts
import { ClaudeAdapter } from '../agent/claude/adapter';
import { KimiCodeAdapter } from '../agent/kimi/adapter';
import type { AgentAdapter } from '../agent/types';

export interface AgentRegistry {
  agents: AgentAdapter[];
  active: AgentAdapter | null;
}

export async function detectAgents(): Promise<AgentRegistry> {
  const envAgent = process.env.CLI_MOBILE_AGENT?.toLowerCase();

  if (envAgent === 'claude') {
    const a = new ClaudeAdapter();
    if (!(await a.isAvailable())) throw new Error('CLI_MOBILE_AGENT=claude but claude not found on PATH');
    return { agents: [a], active: a };
  }

  if (envAgent === 'kimi') {
    const a = new KimiCodeAdapter();
    if (!(await a.isAvailable())) throw new Error('CLI_MOBILE_AGENT=kimi but kimi not found on PATH');
    return { agents: [a], active: a };
  }

  // Auto-detect: probe both, prefer Claude
  const claude = new ClaudeAdapter();
  const kimi = new KimiCodeAdapter();
  const [claudeOk, kimiOk] = await Promise.all([claude.isAvailable(), kimi.isAvailable()]);

  const agents: AgentAdapter[] = [];
  if (claudeOk) agents.push(claude);
  if (kimiOk) agents.push(kimi);

  if (agents.length === 0) {
    console.warn('⚠️  Neither claude nor kimi found on PATH. The server will start but prompts will fail.');
    console.warn('   Install claude (npm i -g @anthropic-ai/claude-code) or kimi to use cli-mobile.');
  }

  return { agents, active: agents[0] ?? null };
}
```

- [ ] **Step 1: Add /api/agent endpoint**

In `src/server/api-router.ts`, after existing routes:

```typescript
// ── Agent metadata ──
r.get('/agent', (_req, res) => {
  if (!agent) { res.json({ ok: false, error: 'No agent configured' }); return; }
  res.json({
    ok: true,
    agent: {
      id: agent.meta.id,
      displayName: agent.meta.displayName,
      accentColor: agent.meta.accentColor,
      logo: agent.meta.logo,
      capabilities: agent.meta.capabilities,
    },
  });
});
```

- [ ] **Step 2: Replace direct claude-data imports with unified service in server/index.ts**

```typescript
// OLD:
import { ClaudeAdapter } from '../agent/index';
import { refreshTree } from '../core/claude-data';

// NEW:
import { detectAgents } from '../core/agent-registry';
import { refreshActiveTree } from '../core/session-data-service';

// OLD (agent init):
const agent = new ClaudeAdapter();
const available = await agent.isAvailable();

// NEW (agent init):
const registry = await detectAgents();
const agent = registry.active;

if (!agent) {
  console.error('❌ No agent found on PATH. Install claude or kimi to use cli-mobile.');
  console.error('   Exiting because prompts cannot work without an agent backend.');
  process.exit(1);
}

console.log(`✓ Agent(s): ${registry.agents.map(a => a.meta.displayName).join(', ')}`);
console.log(`   Active: ${agent.meta.displayName}`);

// OLD (tree scan):
console.log('Scanning ~/.claude/ …');
const tree = await refreshTree();
console.log(`  ${tree.workspaces.length} workspaces, ...`);

// NEW (tree scan — single call, scans active agent only):
console.log('Scanning sessions …');
const tree = await refreshActiveTree(agent.meta.id);
console.log(`  ${tree.workspaces.length} workspaces, ${tree.workspaces.reduce((c, w) => c + w.sessions.length, 0)} sessions`);
```

- [ ] **Step 3: Add agentId to claude-data.ts SessionInfo**

In `src/core/claude-data.ts`, add `agentId: string` to the `SessionInfo` interface, populate it in `refreshTree()`, and export the tree path for the unified service:

```typescript
// In SessionInfo interface, add:
agentId: string;

// In the session construction inside scanWorkspaces(), add:
agentId: 'claude',
```

Legacy `tree.json` sessions without `agentId` will default to `'claude'` in the service.

- [ ] **Step 4: Update ws-server.ts + api-router.ts + commands/index.ts — replace all claude-data imports**

Every file that currently imports from `'../core/claude-data'` must switch to `'../core/session-data-service'`. (Attachments are handled separately in Task 7.6 — they touch 4 function signatures + 4 API call sites + tests.)

> ⚠️ **Intermediate state:** Between completing Task 7 and Task 7.6, `attachments.ts` still imports from `claude-data` while all other server modules use `session-data-service`. Kimi attachment operations (upload/list/send/delete) will 404 during this window because `ensureSessionInWorkspace` scans only the Claude tree. Task 7.6 should be implemented immediately after Task 7 — do not ship or integration-test between these two tasks.

**`ws-server.ts`:**

```typescript
// OLD:
import { readTree, refreshTree, updateSessionName } from '../core/claude-data';

// NEW:
import { readActiveTree, refreshActiveTree, updateSessionName, resolveRunTarget } from '../core/session-data-service';
```

Replace `resolveRunTarget()` call to pass active agent ID (active-agent tree — no cross-agent sessions visible):

```typescript
// OLD:
const target = await resolveRunTarget(workspace, sessionId, lastMsg.forkFrom);

// NEW:
const target = await resolveRunTarget(workspace, sessionId, lastMsg.forkFrom, agent.meta.id);
```

Delete the inline `resolveRunTarget()` function (lines 279-308) — the service now provides it.

Replace `updateSessionName` call (line ~235):

```typescript
// OLD:
await updateSessionName(seenSessionId, autoName);

// NEW:
await updateSessionName(seenSessionId, autoName, agent.meta.id);
```

Replace tree refreshes:

```typescript
// OLD:
await refreshTree();

// NEW:
await refreshActiveTree(agent.meta.id);
```

**`api-router.ts`:**

```typescript
// OLD:
import { readTree, updateSessionName, refreshTree } from '../core/claude-data';
import { findSessionFile, readHistoryFromPath } from '../core/session-history';

// NEW:
import { readActiveTree, refreshActiveTree, updateSessionName, archiveSession as svcArchive, restoreSession as svcRestore, togglePin as svcTogglePin, readHistory } from '../core/session-data-service';
```

Replace all `readTree()` calls with `readActiveTree(agent.meta.id)`, all `refreshTree()` with `refreshActiveTree(agent.meta.id)`.

> **⚠️ Guard against missing agent:** `createApiRouter(agent?: AgentAdapter)` remains optional for test compatibility (smoke tests call it without an agent). Every route that reads `agent.meta.id` MUST guard: `if (!agent) { res.status(500).json({ error: 'No agent configured' }); return; }`. The existing branch endpoint already guards this; extend the guard to GET `/tree`, POST `/tree/refresh`, GET `/sessions/:id/history`, all mutation routes (rename, archive, restore, pin), and ALL attachment routes (post/get/delete). Without these guards, `agent.meta.id` is a runtime TypeError.

Replace dynamic imports for archive/restore/pin:

```typescript
// OLD (archive — 3 places):
const { archiveSession } = await import('../core/claude-data');
// OLD (restore):
const { restoreSession } = await import('../core/claude-data');
// OLD (pin):
const { togglePin } = await import('../core/claude-data');

// NEW (direct calls — dispatch by activeAgentId, no cross-agent scanning):
if (!agent) { res.status(500).json({ error: 'No agent configured' }); return; }
const ok = await svcArchive(sessionId, agent.meta.id);
const ok = await svcRestore(sessionId, agent.meta.id);
const ok = await svcTogglePin(sessionId, agent.meta.id);
```

Replace history endpoint:

```typescript
// OLD:
const filePath = findSessionFile(sessionId);
if (!filePath) { res.json({ sessionId, messages: [] }); return; }
const msgs = await readHistoryFromPath(filePath, 200);

// NEW:
if (!agent) { res.status(500).json({ error: 'No agent configured' }); return; }
const msgs = await readHistory(sessionId, agent.meta.id, 200);
```

Remove the `session-history` import — it's now called internally by the service.

**`commands/index.ts`:**

```typescript
// OLD:
import { updateSessionName } from '../core/claude-data';

// NEW:
import { updateSessionName } from '../core/session-data-service';
```

The `/rename` handler at line 81 now passes the active agent ID:

```typescript
// OLD:
const ok = await updateSessionName(ctx.sessionId, name);

// NEW:
const ok = await updateSessionName(ctx.sessionId, name, ctx.agent.meta.id);
```

Without this fix, `/rename` in a Kimi session writes to `tree.json` (Claude's tree) instead of `kimi-tree.json`.

- [ ] **Step 5: Wrap fork endpoint with error handling**

In the branch POST handler in api-router.ts:

```typescript
try {
  const run = agent.run({ prompt: '.', forkFrom: sessionId, cwd: sourceCwd, permissionMode: 'bypassPermissions', stopGraceMs: 50 });
  // ... existing event loop ...
} catch (err) {
  if (err instanceof Error && err.message.includes('--fork-session')) {
    res.status(400).json({ ok: false, message: err.message });
    return;
  }
  throw err;
}
```

- [ ] **Step 6: Add ServerAgentMeta type to ws-types.ts**

In `src/server/ws-types.ts`, add after existing `ServerTreeUpdated`:

```typescript
export interface ServerAgentMeta {
  type: 'agent_meta';
  meta: {
    id: string;
    displayName: string;
    accentColor: string;
    logo: string;
    capabilities: {
      fork: boolean;
      thinking: boolean;
      usageStats: boolean;
      streaming: boolean;
      attachments: boolean;
    };
  };
}
```

Then add it to the `ServerMessage` union:

```typescript
// OLD:
export type ServerMessage = ServerStream | ServerCommandResult | ServerError | ServerAck | ServerPong | ServerTreeUpdated;

// NEW:
export type ServerMessage = ServerStream | ServerCommandResult | ServerError | ServerAck | ServerPong | ServerTreeUpdated | ServerAgentMeta;
```

This is required or the `send(ws, { type: 'agent_meta', meta: {...} })` call in ws-server.ts will fail TypeScript compilation — `ServerMessage` is a discriminated union and won't accept unknown types.

- [ ] **Step 7: Emit agent_meta via WebSocket**

In `ws-server.ts`, after auth on connection:

```typescript
ws.send(JSON.stringify({
  type: 'agent_meta',
  meta: {
    id: agent.meta.id,
    displayName: agent.meta.displayName,
    accentColor: agent.meta.accentColor,
    logo: agent.meta.logo,
    capabilities: agent.meta.capabilities,
  },
}));
```

- [ ] **Step 8: Commit**

```bash
git add src/server/index.ts src/server/api-router.ts src/server/ws-server.ts src/server/ws-types.ts src/core/claude-data.ts
git commit -m "feat: integrate multi-agent registry + unified session data service

- Auto-detect agents, log active agent at startup
- All tree ops (read/refresh/name/archive/pin/history) go through session-data-service
- resolveRunTarget uses active agent tree
- GET /api/agent returns active agent metadata
- WebSocket emits agent_meta on connection
- Fork endpoint returns clear error for agents without --fork-session
- Removed all direct claude-data imports from server layer"
```

---

### Task 7.6: Multi-Agent Attachment Support

> ⚠️ **Dependency:** Requires Task 7 (session-data-service must exist — attachments.ts imports from it).

**Files:**
- Modify: `src/core/attachments.ts` — replace claude-data import, thread agentId through 4 functions
- Modify: `src/core/attachments.test.ts` — update mock/spy assertions for new signatures
- Modify: `src/server/api-router.ts` — pass `agent.meta.id` to all attachment API calls

**Why a separate task:** Attachments touch 4 function signatures (`handleAttachmentUpload`, `listAttachments`, `resolveAttachments`, `deleteAttachment`), 4 API routes, the WS layer (`resolveAttachments` in `ws-server.ts`), and their tests. Burying this in Task 7's "replace all imports" step risks missed call sites and broken tests.

**Current problem:** `attachments.ts` line 7 imports `readTree` from `./claude-data`. `ensureSessionInWorkspace()` only scans the Claude tree. For Kimi sessions, every attachment operation (upload/list/send/delete) returns 404.

- [ ] **Step 1: Update attachments.ts imports and signatures**

```typescript
// OLD:
import { readTree } from './claude-data';

// NEW:
import { readActiveTree } from './session-data-service';
```

`ensureSessionInWorkspace()` accepts `agentId` and dispatches to the correct tree:

```typescript
async function ensureSessionInWorkspace(workspace: string, sessionId: string, agentId: string): Promise<void> {
  const tree = await readActiveTree(agentId);
  const ws = tree.workspaces.find((w) => w.name === workspace);
  if (!ws) throw new AttachmentError(404, 'Workspace not found or no longer available');
  const session = ws.sessions.find((s) => s.id === sessionId);
  if (!session) throw new AttachmentError(404, 'Session is not in this workspace');
}
```

- [ ] **Step 2: Thread agentId through the 4 public functions**

Each public function (`handleAttachmentUpload`, `listAttachments`, `resolveAttachments`, `deleteAttachment`) adds `agentId: string` as its last parameter and passes it to `ensureSessionInWorkspace()`.

- [ ] **Step 3: Update API routes in api-router.ts**

All 4 attachment routes (POST `/attachments`, GET `/attachments`, DELETE `/attachments/:id`, and the `resolveAttachments` call in `ws-server.ts`) must pass `agent.meta.id`. Every route MUST guard against missing agent first:

```typescript
// In each attachment route handler:
if (!agent) { res.status(500).json({ error: 'No agent configured' }); return; }
// Then: await handleAttachmentUpload(file, fields, agent.meta.id);
```

Without this guard, `agent.meta.id` blows up at runtime if `createApiRouter()` is called without an agent (smoke test path). The routes already have access to `agent` via closure from `createApiRouter(agent)`.

- [ ] **Step 4: Update attachment tests**

`attachments.test.ts` must mock `session-data-service.readActiveTree` instead of `claude-data.readTree`, and pass `agentId` in all calls.

- [ ] **Step 5: Commit**

```bash
git add src/core/attachments.ts src/core/attachments.test.ts src/server/api-router.ts src/server/ws-server.ts
git commit -m "feat: multi-agent attachment support via session-data-service

ensureSessionInWorkspace() now dispatches by agentId using readActiveTree.
All 4 public functions thread agentId through. API routes pass agent.meta.id.
Kimi sessions no longer 404 on attachment upload/list/send/delete."
```

---

### Task 8: CSS Custom Properties for Per-Agent Theming

**Files:**
- Modify: `src/mobile/index.css` (append after Tailwind imports)

- [ ] **Step 1: Add theme CSS variables**

```css
/* ── Agent theme variables (default: Claude orange) ── */
:root {
  --agent-primary: #f97316;
  --agent-primary-light: #fed7aa;
  --agent-primary-dark: #9a3412;
  --agent-primary-bg: #431407;
  --agent-primary-ring: rgba(249, 115, 22, 0.4);
}

[data-agent="kimi"] {
  --agent-primary: #3b82f6;
  --agent-primary-light: #bfdbfe;
  --agent-primary-dark: #1e40af;
  --agent-primary-bg: #172554;
  --agent-primary-ring: rgba(59, 130, 246, 0.4);
}

[data-agent="codex"] {
  --agent-primary: #18181b;
  --agent-primary-light: #d4d4d8;
  --agent-primary-dark: #09090b;
  --agent-primary-bg: #09090b;
  --agent-primary-ring: rgba(24, 24, 27, 0.4);
}

[data-agent="qoder"] {
  --agent-primary: #10b981;
  --agent-primary-light: #a7f3d0;
  --agent-primary-dark: #065f46;
  --agent-primary-bg: #022c22;
  --agent-primary-ring: rgba(16, 185, 129, 0.4);
}

[data-agent="kamaclaude"] {
  --agent-primary: #0d9488;
  --agent-primary-light: #99f6e4;
  --agent-primary-dark: #115e59;
  --agent-primary-bg: #042f2e;
  --agent-primary-ring: rgba(13, 148, 136, 0.4);
}

/* ── Theme utility classes ── */
.text-agent-primary { color: var(--agent-primary); }
.text-agent-primary-light { color: var(--agent-primary-light); }
.bg-agent-primary { background-color: var(--agent-primary); }
.border-agent-primary { border-color: var(--agent-primary); }
.border-l-agent-primary { border-left-color: var(--agent-primary); }
.ring-agent { box-shadow: 0 0 0 2px var(--agent-primary-ring); }
.bg-agent-bg { background-color: var(--agent-primary-bg); }
.hover-bg-agent:hover { background-color: var(--agent-primary-dark); }
.accent-agent { accent-color: var(--agent-primary); }
```

> **⚠️  Tailwind `/opacity` syntax won't work with these custom classes.**  
> `.border-agent-primary/30` is NOT valid — Tailwind's JIT engine only processes its own utility classes. For custom CSS classes, use a separate opacity modifier class, inline `style`, or a dedicated CSS custom property like `--agent-primary-30`. This is fixed in Task 10 (AgentLogo uses `border-white/10` instead).

- [ ] **Step 1b: Replace hardcoded accent colors in existing components**

The codebase has ~27 hardcoded `cyan-*` Tailwind references across 7 files. These must be replaced with theme-aware classes or custom properties to actually change color per agent. The plan does NOT require replacing ALL of them — some are decorative and look fine across themes — but the following interactive/stateful elements MUST be updated:

**Must replace (interactive elements whose color signals state):**

| File | Current | Replacement |
|------|---------|-------------|
| `WorkspaceList.tsx` lines 150,154 | `text-cyan-400 border-b-2 border-cyan-400` | `text-agent-primary border-b-2 border-agent-primary` (tab indicators) |
| `WorkspaceList.tsx` line 212 | `bg-cyan-600` | `bg-agent-primary hover-bg-agent` (pin button) |
| `WorkspaceList.tsx` line 249 | `bg-cyan-600` | `bg-agent-primary` (rename confirm) |
| `WorkspaceView.tsx` line 217 | `bg-cyan-500/20 border-cyan-500/50 text-cyan-300` | `bg-agent-bg border-agent-primary text-agent-primary` (session switcher). For `/20` and `/50` opacity: use inline `style` with `color-mix(in srgb, var(--agent-primary) 20%, transparent)` |
| `WorkspaceView.tsx` line 226 | `bg-cyan-500/10 border-l-cyan-400` | `bg-agent-bg border-l-agent-primary` (active session) |
| `WorkspaceView.tsx` line 228 | `text-cyan-300` | `text-agent-primary-light` (session name) |
| `ChatView.tsx` line 36 | `bg-cyan-600` | `bg-agent-primary` (user bubble) |
| `ChatView.tsx` line 47 | `text-cyan-200` | `text-agent-primary-light` (user timestamp) |
| `PromptInput.tsx` line 143 | `bg-cyan-600` | `bg-agent-primary` (send button) |
| `PromptInput.tsx` line 162 | `focus:border-cyan-500` | `ring-agent` (input focus) |
| `AuthGate.tsx` line 258 | `bg-cyan-600` | `bg-agent-primary` (pair button) |
| `SessionList.tsx` lines 40,45 | `border-cyan-500/50 bg-cyan-500/10 text-cyan-300` | `border-agent-primary bg-agent-bg text-agent-primary-light` (active session) |

**Can keep as-is (decorative, loading states, pre-auth screen):** AuthGate spinner + QR frame + pair input (shown before agent is known), ChatView/Terminal streaming cursors (tiny animation), PromptInput upload status, WorkspaceList `>_` logo.

This distinction matters: replacing ~14 interactive elements gives the per-agent feel without touching ~13 decorative ones.

- [ ] **Step 2: Add FOUC prevention — blocking script in index.html**

**Problem:** The CSS `:root` defaults to Claude orange. `AgentProvider.setAgent()` sets `data-agent` on `<html>` via React, but only after API fetch completes. During the gap (page load → React render → `/api/agent` response → `setAgent()`), the page flashes the wrong theme color. On slow networks this is a visible orange→blue flicker for Kimi users.

**Solution:** A blocking inline `<script>` in `<head>` that reads from localStorage and sets `data-agent` before the first paint. The `setAgent` function in AgentProvider also persists the agent id to localStorage so the next page load picks it up immediately.

**First-load behavior:** When localStorage is empty (fresh device, cleared cache), the script defaults to `data-agent="claude"` since Claude is the default/preferred agent. This means:
- Claude users: zero flash (correct from the start)
- Kimi users on first load: a brief Claude-orange flash until `/api/agent` responds (~200-500ms), then switches to Kimi blue. After the first load, localStorage stores `'kimi'` and subsequent loads show blue immediately.

The first-load flash for non-Claude agents is an accepted limitation — eliminating it would require server-side rendering or a separate unthemed loading state, both of which are heavier than the problem warrants.

In `index.html`, add in `<head>` before any CSS:

```html
<script>
  // Prevent theme FOUC: set data-agent before first paint.
  // Defaults to 'claude' on first visit (no localStorage); the React
  // AgentProvider will correct this after /api/agent responds if needed.
  try {
    var id = localStorage.getItem('cli_mobile_agent_id') || 'claude';
    document.documentElement.setAttribute('data-agent', id);
  } catch(e) {}
</script>
```

- [ ] **Step 3: Commit**

```bash
git add src/mobile/index.css index.html
git commit -m "feat: add CSS custom properties + FOUC prevention for per-agent theming

Five agent themes: claude (orange), kimi (blue), codex (zinc),
qoder (emerald), kamaclaude (teal). [data-agent] scoping on <html>
controls all color variants. Utility classes for theme-aware elements.

index.html: blocking <script> sets data-agent from localStorage before
first paint, preventing orange flash for returning Kimi users."
```

---

### Task 9: AgentProvider Context + useAgent Hook

**Files:**
- Create: `src/mobile/lib/agent-context.tsx`
- Modify: `src/mobile/App.tsx` (wrap with AgentProvider)

- [ ] **Step 1: Write AgentProvider**

```typescript
// src/mobile/lib/agent-context.tsx
import React, { createContext, useContext, useState, useCallback } from 'react';
import type { Capabilities } from './agent-themes';

export interface AgentState {
  id: string;
  displayName: string;
  accentColor: string;
  logo: string;
  capabilities: Capabilities;
}

interface AgentContextValue {
  agent: AgentState | null;
  setAgent: (agent: AgentState) => void;
  can: (key: keyof Capabilities) => boolean;
}

const AgentContext = createContext<AgentContextValue | null>(null);

export function AgentProvider({ children }: { children: React.ReactNode }) {
  const [agent, setAgentState] = useState<AgentState | null>(null);

  const setAgent = useCallback((a: AgentState) => {
    setAgentState(a);
    document.documentElement.setAttribute('data-agent', a.id);
    // Persist for FOUC prevention on next page load (see Task 7 Step 2)
    try { localStorage.setItem('cli_mobile_agent_id', a.id); } catch {}
  }, []);

  const can = useCallback(
    (key: keyof Capabilities): boolean => agent?.capabilities?.[key] ?? false,
    [agent],
  );

  return (
    <AgentContext.Provider value={{ agent, setAgent, can }}>
      {children}
    </AgentContext.Provider>
  );
}

export function useAgent(): AgentContextValue {
  const ctx = useContext(AgentContext);
  if (!ctx) throw new Error('useAgent must be used within AgentProvider');
  return ctx;
}
```

- [ ] **Step 2: Wrap App with AgentProvider**

In `src/mobile/App.tsx`:

```tsx
import { AgentProvider } from './lib/agent-context';
// ...

export default function App() {
  return (
    <div className="h-full flex flex-col max-w-lg mx-auto">
      <AgentProvider>
        <AuthGate>
          <Routes>
            <Route path="/" element={<WorkspaceList />} />
            <Route path="/workspace/:name" element={<WorkspaceView />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthGate>
      </AgentProvider>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/mobile/lib/agent-context.tsx src/mobile/App.tsx
git commit -m "feat: add AgentProvider context with useAgent hook

Wraps app in AgentProvider. Exposes agent state, setAgent (syncs
data-agent on <html>), and can(key) for capability checks."
```

---

### Task 10: AgentLogo Component

**Files:**
- Create: `src/mobile/components/AgentLogo.tsx`

Renders the agent's SVG logo inside a themed circle. Uses `<img>` tag to preserve SVG original colors (brand colors, gradients). The logo URL is resolved from `LOGO_MAP` in `agent-themes.ts` using the agent's `logo` filename.

- [ ] **Step 1: Write AgentLogo**

```typescript
// src/mobile/components/AgentLogo.tsx
import { useAgent } from '../lib/agent-context';
import { LOGO_MAP } from '../lib/agent-themes';

interface AgentLogoProps { size?: 'sm' | 'md' | 'lg'; }

const sizeMap = {
  sm: { container: 'w-5 h-5', img: 'w-3.5 h-3.5' },
  md: { container: 'w-8 h-8', img: 'w-5 h-5' },
  lg: { container: 'w-12 h-12', img: 'w-8 h-8' },
};

export default function AgentLogo({ size = 'md' }: AgentLogoProps) {
  const { agent } = useAgent();
  if (!agent) return null;

  const logoUrl = LOGO_MAP[agent.logo.replace('.svg', '')];
  if (!logoUrl) return null;

  return (
    <div
      className={`${sizeMap[size].container} rounded-full flex items-center justify-center bg-agent-bg border border-white/10 shrink-0`}
      title={agent.displayName}
    >
      <img
        src={logoUrl}
        alt={agent.displayName}
        className={`${sizeMap[size].img} object-contain`}
      />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/mobile/components/AgentLogo.tsx
git commit -m "feat: add AgentLogo component with SVG logo assets

Renders agent SVG logo inside themed circle via <img> tag,
preserving original brand colors and gradients. Resolves
asset URL from LOGO_MAP. Sizes: sm/md/lg."
```

---

### Task 11: Conditional Fork Button

**Files:**
- Modify: `src/mobile/pages/WorkspaceList.tsx` — `can('fork')` guard on fork in swipe actions + ActionSheet
- Modify: `src/mobile/pages/WorkspaceView.tsx` — ADD fork button to header via `can('fork')`

**Background:** Fork actions currently live in two places inside `WorkspaceList.tsx` (not `SessionList.tsx` — that component is an unused thin wrapper):
1. **Swipe left actions** (line ~210): a "🔀 分支" button inside `leftActions`
2. **Long-press ActionSheet** (line ~267): a "🔀 创建分支" action

Both currently render unconditionally. For agents without fork support (Kimi), clicking either calls `POST /api/sessions/:id/branch` which will fail because the adapter throws a `--fork-session` error. The fix: wrap both with `can('fork')`.

The chat view (`WorkspaceView`) currently has no fork button at all — users must navigate back to the session list to fork. We add a fork button to the chat header as a convenience.

> **Design note:** The frontend only sees the active agent's sessions (filtered by the server). No cross-agent sessions need labels, warnings, or blocking — the theme (logo, colors, StatusBar) already identifies the active agent.

- [ ] **Step 1: Update WorkspaceList — swipe actions**

In `WorkspaceList.tsx`, import `useAgent`:

```tsx
import { useAgent } from '../lib/agent-context';

// Inside component:
const { can } = useAgent();
```

In the `SwipeableRow` leftActions, wrap the branch button:

```tsx
leftActions={
  <div className="flex h-full w-full">
    {can('fork') && (
      <button onClick={() => handleBranch(s, ws)} disabled={branching === s.id}
        className={`flex-1 h-full flex items-center justify-center text-[10px] font-medium ${branching === s.id ? 'bg-blue-800 text-blue-300' : 'bg-blue-600 text-white'}`}>🔀 分支</button>
    )}
    <button onClick={() => { setRenaming(s); setRenameText(s.name || ''); }} className="flex-1 h-full flex items-center justify-center bg-purple-600 text-white text-[10px] font-medium">✏️ 重命名</button>
    <button onClick={() => handlePin(s)} className="flex-1 h-full flex items-center justify-center bg-cyan-600 text-white text-[10px] font-medium">{s.pinned ? '📌 取消' : '📌 置顶'}</button>
  </div>
}
```

- [ ] **Step 2: Update WorkspaceList — ActionSheet**

In the ActionSheet actions array, wrap the branch action:

```tsx
...(can('fork') ? [{
  label: branching === actionSheet.session.id ? '⏳ 正在创建分支…' : '🔀 创建分支',
  action: () => handleBranch(actionSheet.session, actionSheet.ws),
}] : []),
{
  label: showArchived ? '恢复' : '📦 归档',
  action: () => showArchived ? handleRestore(actionSheet.session) : handleArchive(actionSheet.session),
},
```

- [ ] **Step 3: ADD fork button to WorkspaceView header**

In `WorkspaceView.tsx`, import `useAgent` and add a fork button in the header after the new-session button:

```tsx
import { useAgent } from '../lib/agent-context';

// Inside component:
const { can } = useAgent();

const handleForkCurrent = useCallback(async () => {
  if (sessionId === 'new' || !currentWs) return;
  setBranching(sessionId);
  try {
    const res = await apiFetch(`/api/sessions/${sessionId}/branch`, { method: 'POST' });
    const data = await res.json();
    if (data.ok && data.newSessionId) {
      setSessionId(data.newSessionId);
      setSessionName(data.newSessionId.slice(0, 8));
      setMessages([]);
      setStreamState(null);
    } else {
      showToast(data.message || '分支创建失败');
    }
  } catch {
    showToast('分支创建失败：网络错误');
  } finally {
    setBranching(null);
  }
}, [sessionId, currentWs, showToast]);

// In header, after the new-session button:
{can('fork') && sessionId !== 'new' && (
  <button
    onClick={handleForkCurrent}
    disabled={branching === sessionId}
    className="text-slate-400 active:text-slate-200 shrink-0"
    title="创建分支"
  >
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/><path d="M6 20a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/>
      <path d="M6 17V7"/><path d="M12 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/><path d="M12 8v3"/>
      <path d="M12 11a3 3 0 0 0 3 3h3"/><line x1="6" y1="7" x2="12" y2="8"/>
    </svg>
  </button>
)}
```

Also add `branching` state and import `apiFetch` if not already present.

- [ ] **Step 4: Gate attachment UI on `can('attachments')`**

In `WorkspaceView.tsx`, the `PromptInput` receives `canAttach={sessionId !== 'new'}`. Update to also check agent capabilities:

```tsx
// OLD:
<PromptInput ... canAttach={sessionId !== 'new'} ... />

// NEW:
<PromptInput ... canAttach={sessionId !== 'new' && can('attachments')} ... />
```

The `onAttachUnavailable` toast already fires when the user taps the disabled attach button. With this change, tapping it when the agent doesn't support attachments shows "请选择已有会话后再添加附件". Update the toast text to distinguish the two cases:

```tsx
onAttachUnavailable={() => {
  if (!can('attachments')) showToast('当前 agent 不支持附件');
  else showToast('请选择已有会话后再添加附件');
}}
```

For Kimi, this means the attachment button is hidden until Task 1.5 verifies `attachments: true`. If verification shows Kimi can't read local files in `-p` mode, change Kimi's `AgentMeta.capabilities.attachments` to `false` — the button disappears automatically.

- [ ] **Step 5: Commit**

```bash
git add src/mobile/pages/WorkspaceList.tsx src/mobile/pages/WorkspaceView.tsx
git commit -m "feat: conditionally render fork + attachment UI from agent capabilities

WorkspaceList swipe actions and ActionSheet check can('fork') before showing
fork option. WorkspaceView header gains a fork button for in-chat branching.
PromptInput canAttach gates on can('attachments') — agents without attachment
support (Kimi, pending Task 1.5 verification) hide the attach button."
```

---

### Task 12: Agent-Aware StatusBar

**Files:**
- Modify: `src/mobile/components/StatusBar.tsx` — add agent indicator via `useAgent`

**Note on scope:** `CommandBar.tsx` and `ActionSheet.tsx` are already theme-neutral — they use only slate/neutral Tailwind classes and have no hardcoded accent colors to replace. No changes required for those components.

- [ ] **Step 1: StatusBar — add agent indicator**

The current StatusBar is a pure presentational component receiving `cwd`, `sessionName`, `mode`, `connected` as props. It needs to display the agent name + colored dot. Since `useAgent` requires `AgentProvider` context (already wrapping the app from Task 9), we add the hook:

```tsx
import { useAgent } from '../lib/agent-context';
import AgentLogo from './AgentLogo';

// Inside StatusBar:
const { agent } = useAgent();

// Replace the existing static header with an agent-aware one:
// Add agent indicator on the left side:
{agent && (
  <div className="flex items-center gap-1 shrink-0">
    <AgentLogo size="sm" />
    <span className="text-xs text-agent-primary font-medium hidden sm:inline">{agent.displayName}</span>
  </div>
)}
```

The existing connection dot, cwd path, session name, and mode display remain unchanged — they are already neutral.

- [ ] **Step 2: Wire StatusBar into WorkspaceView and WorkspaceList**

StatusBar is currently exported but never imported — no page renders it. Use `<StatusBar>` to replace the status-indicator portion of each page's header, while preserving all interactive controls:

> ⚠️ **Do NOT replace the entire `<header>` block.** The WorkspaceView header contains interactive buttons (← back, new-session, session-switcher, and the fork button from Task 11). The WorkspaceList header contains the title and connection indicator. StatusBar should only replace the status-line elements — all buttons stay outside StatusBar.

**`WorkspaceView.tsx`** — add StatusBar inside the existing header, replacing only the status text elements (connection dot, workspace path, session name):

```tsx
import StatusBar from '../components/StatusBar';

// In the header, replace the connection dot + path text + session name
// with <StatusBar> while keeping ALL interactive buttons:
<header className="px-3 py-2 border-b border-slate-700 bg-slate-850 flex items-center gap-2 shrink-0">
  <button onClick={() => navigate('/')} className="text-slate-400 active:text-slate-200 text-lg shrink-0">←</button>
  {/* New session button — keep */}
  <button onClick={...} className="text-slate-400 active:text-slate-200 shrink-0" title="新建会话">
    <svg ...>...</svg>
  </button>
  {/* Fork button (from Task 11) — keep */}
  {can('fork') && sessionId !== 'new' && ( ... )}
  {/* StatusBar replaces the centered info section */}
  <div className="flex-1 text-center">
    <StatusBar
      cwd={currentWs?.cwd ?? wsName}
      sessionName={sessionName || sessionId.slice(0, 8)}
      mode={mode}
      connected={connected}
    />
  </div>
  {/* Session switcher — keep */}
  <button onClick={...} className={...}>💬 {sessionName || sessionId.slice(0, 8)}</button>
</header>
```

**`WorkspaceList.tsx`** — replace the inline header (lines 138-144) with:

```tsx
import StatusBar from '../components/StatusBar';

// Replace the existing <header>...</header> block with:
<StatusBar
  cwd=""
  sessionName={`${workspaces.length} workspaces`}
  mode=""
  connected={wsConnected}
/>
```

The StatusBar component itself should render **only** the status indicator, without `py-2` or `px-3` padding (the parent header provides it):

```tsx
// StatusBar.tsx — compact inline status, no header wrapper
export default function StatusBar({ cwd, sessionName, mode, connected }: StatusBarProps) {
  const { agent } = useAgent();
  const shortCwd = cwd.replace(/^\/Users\/[^/]+/, '~');
  return (
    <span className="flex items-center gap-2 text-xs">
      {agent && (
        <span className="flex items-center gap-1 shrink-0">
          <AgentLogo size="sm" />
          <span className="text-agent-primary font-medium hidden sm:inline">{agent.displayName}</span>
        </span>
      )}
      <span className={`w-2 h-2 rounded-full shrink-0 ${connected ? 'bg-emerald-400' : 'bg-red-400'}`} />
      <span className="text-slate-400 truncate" title={cwd}>📁 {shortCwd}</span>
      {sessionName && <span className="text-cyan-400 shrink-0">💬 {sessionName}</span>}
      {mode && <span className="text-emerald-400 shrink-0">{mode}</span>}
    </span>
  );
}
```

After wiring, the left side of each page's header shows `<AgentLogo size="sm" />` + agent display name in the theme accent color. The "back" button in WorkspaceView and the "new session" button stay outside StatusBar — add them before/after the `<StatusBar>` call as needed.

- [ ] **Step 3: Commit**

```bash
git add src/mobile/components/StatusBar.tsx src/mobile/pages/WorkspaceView.tsx src/mobile/pages/WorkspaceList.tsx
git commit -m "feat: add agent indicator to StatusBar + wire into pages

StatusBar shows AgentLogo + display name via useAgent hook.
Wired into WorkspaceView and WorkspaceList headers.
CommandBar and ActionSheet are unchanged — already theme-neutral."
```

---

### Task 13: Wire Frontend to Agent API

**Files:**
- Modify: `src/mobile/components/AuthGate.tsx` — fetch `/api/agent` after pairing AND on existing-token validation, persist agentId
- Modify: `src/mobile/hooks/useWebSocket.ts` — module-level singleton + `onAgentMeta`
- Modify: `src/mobile/pages/WorkspaceView.tsx` — register `onAgentMeta` as WebSocket fallback
- Modify: `src/mobile/pages/WorkspaceList.tsx` — switch to useWebSocket hook + register `onAgentMeta`

**Background:** The existing `useWebSocket` creates a new WebSocket connection per call site ([useWebSocket.ts:40](src/mobile/hooks/useWebSocket.ts#L40)). `WorkspaceView` calls it for streams/commands, and `WorkspaceList` opens a raw WebSocket for tree updates. Adding another `useWebSocket` call in `AuthGate` for `agent_meta` would create a third connection — wasteful and fragile.

**Fix:** Refactor `useWebSocket` to use a **module-level singleton** — one WebSocket shared by all callers. Both `WorkspaceView` and `WorkspaceList` register `onAgentMeta` as WebSocket fallback, and `WorkspaceList` switches from raw WebSocket to the hook. `AuthGate` fetches `/api/agent` via REST in BOTH auth paths (fresh pairing AND existing-token validation). No new component needed.

- [ ] **Step 1: Fetch agent metadata in AuthGate after pairing (primary channel)**

In `src/mobile/components/AuthGate.tsx`, add the fetch after successful device pairing. This is the PRIMARY channel for agent metadata — the WebSocket fallback (Step 3) only kicks in if this call fails.

Import `useAgent`:

```tsx
import { useAgent } from '../lib/agent-context';
```

Inside `AuthGate`, get `setAgent`:

```tsx
const { setAgent } = useAgent();
```

In the `pairWithCode` function, after a successful pair response (`setDeviceToken(data.deviceToken); setState('authenticated')`), add the agent fetch:

```typescript
// After: setState('authenticated');

// Fetch agent metadata for theming (primary channel)
try {
  const res = await apiFetch('/api/agent', {
    headers: { Authorization: `Bearer ${data.deviceToken}` },
  });
  const agentData = await res.json();
  if (agentData.ok) {
    setAgent(agentData.agent);
    // NOTE: setAgent() persists agentId to localStorage (see Task 9 AgentProvider).
    // Do NOT duplicate localStorage.setItem here — single source of truth.
  }
} catch {
  // Non-fatal — WebSocket fallback (Step 3) will populate agent context
  console.warn('[auth] /api/agent fetch failed, relying on WebSocket fallback');
}
```

> **Note:** The `/api/agent` endpoint is behind auth middleware. We use the freshly-obtained `deviceToken` directly in the Authorization header — `apiFetch()` uses `getDeviceToken()` internally, but at this point the token was just set so `getDeviceToken()` may not return it synchronously. Using the token directly avoids a race.

> ⚠️ **Existing-token path:** The `useEffect` that validates an existing token (line 36-57) only calls `apiFetch('/api/tree')`. After Task 9 wraps the app in `AgentProvider`, this path sets `state='authenticated'` but never calls `setAgent()`. Result: `useAgent()` returns `null`, `can('fork')` returns `false`, and no theme loads. Fix: add agent fetch after the existing-token validation succeeds.
>
> ```typescript
> // In the existing-token useEffect, after setState('authenticated'):
> apiFetch('/api/agent')
>   .then(async (r) => {
>     const data = await r.json();
>     if (data.ok) {
>       setAgent(data.agent);
>       // NOTE: setAgent() persists to localStorage — do not duplicate here.
>     }
>   })
>   .catch(() => {}); // non-fatal — WebSocket fallback
> ```
>
> Both the `pairWithCode` path (above) and the existing-token path (here) now fetch agent meta. `setAgent()` handles localStorage persistence (see Task 9). The WebSocket `onAgentMeta` in WorkspaceView (Step 3) is the fallback if both REST calls fail.

- [ ] **Step 2: Refactor useWebSocket to module-level singleton**

In `src/mobile/hooks/useWebSocket.ts`, hoist the WebSocket connection from the `useEffect` to module scope:

```typescript
// Module-level singleton — one WebSocket per app instance
let singletonWs: WebSocket | null = null;
let singletonConnected = false;
const streamCallbacks = new Set<...>();
const commandResultCallbacks = new Set<...>();
const errorCallbacks = new Set<...>();
const treeUpdatedCallbacks = new Set<...>();
const agentMetaCallbacks = new Set<(meta: AgentMeta) => void>();
let lastAgentMeta: AgentMeta | null = null;  // replay cache for late subscribers
// React components subscribe to connection state via these callbacks
const connectionCallbacks = new Set<(connected: boolean) => void>();
let refCount = 0;
let pingTimer: ReturnType<typeof setInterval> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let mounted = false;

function setConnected(value: boolean) {
  singletonConnected = value;
  connectionCallbacks.forEach(cb => cb(value));
}

function ensureConnection() {
  if (singletonWs?.readyState === WebSocket.OPEN) return;
  const ws = new WebSocket(getWsUrl());
  singletonWs = ws;
  ws.onopen = () => { if (mounted) { setConnected(true); /* ping timer... */ } };
  ws.onclose = () => { if (mounted) { setConnected(false); /* reconnect... */ } };
  ws.onmessage = (evt) => {
    // ... existing dispatch cases ...
    case 'agent_meta':
      lastAgentMeta = msg.meta;  // cache for late subscribers
      agentMetaCallbacks.forEach(cb => cb(msg.meta));
      break;
  };
  ws.onerror = () => {};
}

export function useWebSocket(): UseWebSocketReturn {
  // Each component instance subscribes to connection state via React state
  const [connected, setConnectedLocal] = useState(singletonConnected);

  useEffect(() => {
    refCount++;
    const cb = (value: boolean) => setConnectedLocal(value);
    connectionCallbacks.add(cb);
    if (!mounted) { mounted = true; ensureConnection(); }
    // Cancel any pending close timer from a previous unmount (page navigation)
    if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
    return () => {
      refCount--;
      connectionCallbacks.delete(cb);
      if (refCount === 0) {
        // Delay close to survive page navigation unmount/remount gap.
        // WorkspaceList unmount → refCount=0 → 2s timer starts.
        // WorkspaceView useEffect fires → refCount=1 → timer cancelled.
        // Without this delay, navigation between authenticated pages
        // would tear down the singleton, losing in-flight streams.
        closeTimer = setTimeout(teardown, 2000);
      }
    };
  }, []);

  // ... existing callback registration (unchanged) ...
}
```

The key change: `WebSocket` connection, callback sets, and reconnect logic move from inside `useEffect` to module scope. `useEffect` manages a refCount with a **delayed close** (2s debounce) — page navigation between WorkspaceList ↔ WorkspaceView briefly drops refCount to 0, but the `closeTimer` holds the connection open. The mounting component cancels the timer. Only actual app exit (tab close, logout) triggers a real teardown after the delay. Each caller still gets its own `send`, `onStream`, etc — but they all share the same WebSocket and callback sets.

- [ ] **Step 2: Add onAgentMeta to useWebSocket (with replay for late subscribers)**

Add `onAgentMeta` to the `UseWebSocketReturn` interface and implement it inside the hook. When a component calls `onAgentMeta(cb)`, immediately replay `lastAgentMeta` if cached (server sent `agent_meta` before this component subscribed), then add `cb` to the shared set:

```typescript
// Inside useWebSocket():
const onAgentMeta = useCallback((cb: (meta: AgentMeta) => void) => {
  // Replay cached value for late subscribers (race-condition fix)
  if (lastAgentMeta) cb(lastAgentMeta);
  agentMetaCallbacks.add(cb);
  return () => { agentMetaCallbacks.delete(cb); };
}, []);
```

> ⚠️ **Without this replay,** if the WebSocket connects and the server sends `agent_meta` before the React component's `useEffect` registers `onAgentMeta`, the callback is never fired. The `lastAgentMeta` cache + immediate replay guarantees the callback always receives the agent metadata regardless of timing.

- [ ] **Step 3: Register onAgentMeta in WorkspaceView AND WorkspaceList (WebSocket fallback)**

With the singleton refactor, `useWebSocket` in both pages shares the same connection. Register the `onAgentMeta` callback in BOTH components — this ensures the WebSocket fallback works regardless of which page the user lands on first:

**In `WorkspaceView.tsx`:**

```tsx
import { useAgent } from '../lib/agent-context';

// Inside WorkspaceView:
const { setAgent } = useAgent();
const { connected, send, onStream, onCommandResult, onTreeUpdated, onAgentMeta } = useWebSocket();

// Register WebSocket fallback for agent metadata
useEffect(() => {
  return onAgentMeta((meta) => setAgent(meta));
}, [onAgentMeta, setAgent]);
```

**In `WorkspaceList.tsx`** (note: after Step 4 switch to useWebSocket hook, `onAgentMeta` is available):

```tsx
import { useAgent } from '../lib/agent-context';

// Inside WorkspaceList:
const { setAgent } = useAgent();
const { connected: wsConnected, onTreeUpdated, onAgentMeta } = useWebSocket();

// Register WebSocket fallback for agent metadata
useEffect(() => {
  return onAgentMeta((meta) => setAgent(meta));
}, [onAgentMeta, setAgent]);
```

> ⚠️ **Both pages MUST register `onAgentMeta`.** A user can land on `/` (WorkspaceList) directly — if only WorkspaceView registers the callback, the WebSocket `agent_meta` message arrives before `onAgentMeta` is registered, and the fallback is silently lost. With the singleton WebSocket, any call to `onAgentMeta` subscribes to the shared callback set, so both pages can safely register.

- [ ] **Step 4: Switch WorkspaceList from raw WebSocket to useWebSocket hook**

`WorkspaceList.tsx` currently opens its own raw WebSocket ([lines 56-70](src/mobile/pages/WorkspaceList.tsx#L56)). Replace with the singleton hook:

```tsx
// OLD:
const ws = new WebSocket(wsUrl);
ws.onopen = () => setWsConnected(true);
ws.onclose = () => setWsConnected(false);
ws.onmessage = (evt) => {
  try { const m = JSON.parse(evt.data); if (m.type === 'tree_updated') loadTree(); } catch {}
};

// NEW:
const { connected: wsConnected, onTreeUpdated } = useWebSocket();
useEffect(() => {
  return onTreeUpdated(() => loadTree());
}, [onTreeUpdated, loadTree]);
```

> `useWebSocket` is now a singleton — this call shares the same connection as `WorkspaceView`.

- [ ] **Step 5: Commit**

```bash
git add src/mobile/components/AuthGate.tsx src/mobile/hooks/useWebSocket.ts src/mobile/pages/WorkspaceView.tsx src/mobile/pages/WorkspaceList.tsx
git commit -m "feat: wire frontend to agent metadata API + WebSocket singleton

- useWebSocket refactored to module-level singleton (one connection per app)
- AuthGate fetches /api/agent after pairing as primary channel
- WorkspaceView registers onAgentMeta as WebSocket fallback
- WorkspaceList switches from raw WebSocket to singleton hook
- No AuthGateInner needed — singleton eliminates extra connections"
```

---

### Task 14: Update README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add multi-agent documentation**

After the "功能" section, before "要求":

```markdown
## 支持的 Agent

| Agent | 主题 | 分支 | 适用场景 |
|-------|------|------|---------|
| Claude Code | 橙色 | ✅ 支持 | 完整功能 |
| Kimi Code | 蓝色 | ❌ 不支持 | 基础对话 |

默认自动检测已安装的 Agent，优先使用 Claude Code。

```bash
CLI_MOBILE_AGENT=kimi npm start    # 使用 Kimi Code
CLI_MOBILE_AGENT=claude npm start  # 使用 Claude Code
```

## Kimi Code 限制

- **不支持会话分支** — Kimi 的 `/fork` 命令仅在 TUI 内可用，非交互模式无等效 CLI 参数。前端会自动隐藏分支按钮
- **无 thinking 内容** — Kimi stream-json 不输出推理过程
- **无 token 用量统计** — Kimi 不输出 usage 信息
- **无流式 delta** — 消息以完整单元输出，不逐字流式传输
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: document multi-agent support and Kimi limitations"
```

---

## Implementation Order

```
Phase 0: Prerequisite
Task 1.5 (Kimi CLI verify) ── REQUIRED before Task 2/3/5

Phase 1: Backend Foundation
Task 1 (AgentMeta types) ──► Task 1.5 (Kimi CLI verify)
       │                              │
       └──────────────► Task 4 (Theme configs only)
                                     │
              ┌──────────────────────┼──────────────────────┐
              ▼                      ▼                      ▼
      Task 2 (Kimi translator)   Task 5 (Kimi data)    Task 8 (CSS variables)
              │                      │                 [start any time]
              │                      ├──────────┐
              │                      ▼          ▼
              │           Task 3 (KimiAdapter)   Task 6 (Session Data Service)
              │           requires Task 2 + 5    requires Task 5 only
              │                      │          │
              └──────────────────────┼──────────┘
                                     │
                                     ▼
              Task 7 (Server integration + agent registry)
                                     │
                                     ▼
              Task 7.6 (Attachments)

Phase 2: Frontend Theming
Task 9 (AgentProvider) ──► Task 10 (AgentLogo)
                                 │
        Task 11 (conditional fork ) ◄─┤
        Task 12 (StatusBar agent indicator) ◄────────────────┤
        Task 13 (wire to API) ◄──────────────────────────────┘

Phase 3: Docs
Task 14 (README)
```

**Parallelism:**
- **Task 1.5 MUST be completed before Tasks 2, 3, and 5** — all Kimi-related tasks depend on verified CLI behavior
- Task 2 (Kimi translator) and Task 5 (Kimi data) can run in parallel after Task 1.5
- Task 8 (CSS) can start any time — pure CSS, no code dependencies
- Task 3 (KimiAdapter) waits for Task 2 + Task 5 (static import of kimi-data + stream-json translator)
- Task 6 (Service) waits for Task 5 (needs kimi-data tree paths + kimi-history; does NOT import any adapter — independent of Task 3)
- Task 7 (Server) waits for Task 3 + Task 6 (needs adapter + unified service)
- Task 9-13 (Frontend) are sequential, all after Task 8 (CSS)

---

## Extensibility: Adding a Future Agent

After this plan is implemented, adding a new agent (e.g., Codex) requires exactly:

1. **`src/mobile/assets/logos/<name>.svg`** — place the agent's SVG logo
2. **`src/agent/<name>/adapter.ts`** — implement `AgentAdapter` with `meta`
3. **`src/agent/<name>/stream-json.ts`** (if needed) — stream-json translator
4. **`src/core/<name>-data.ts`** — session tree scanner + history reader (same interface as claude-data.ts / kimi-data.ts)
5. **`src/core/session-data-service.ts`** — add agent to `TREE_READERS` / `TREE_REFRESHERS` maps, add dispatch cases for archive/restore/pin/history
6. **`src/mobile/lib/agent-themes.ts`** — add SVG import + `LOGO_MAP` entry + offline `ALL_AGENTS` fallback entry
7. **`src/mobile/index.css`** — add `[data-agent="<name>"]` CSS block
8. **`src/core/agent-registry.ts`** — add adapter to auto-detect list

**No React page/component/hook changes required.** Every component reads from `useAgent()` context, which auto-populates from the adapter's meta. Only config-layer files (adapter, data scanner, registry, service, theme, CSS) are touched.

---

## Limitations & Future Work

1. **No runtime agent switching** — Agent is chosen at server startup (`CLI_MOBILE_AGENT`). The session tree shows only the active agent's sessions. A future `/api/agent/switch` endpoint could reload the tree and theme without restart.
2. **Frontend fallback metadata is duplicated** — `src/mobile/lib/agent-themes.ts` keeps an offline fallback copy of agent metadata because Vite must statically import logo assets. The runtime source of truth remains `AgentAdapter.meta` served by `/api/agent`.
3. **Kimi session messageCount is 0** — wire.jsonl parsing for message counts is deferred. History reading works (via `kimi-history.ts`) but the count badge in session lists shows 0 for Kimi sessions.
4. **No runtime logo hot-swap** — Logos are imported at build time via Vite. Adding a new agent requires adding its SVG to `src/mobile/assets/logos/` and a new import in `agent-themes.ts`.
5. **Capabilities are boolean** — Partial support nuances live in error messages, not the flag system.
6. **First-load FOUC for non-Claude agents** — The anti-FOUC script defaults to `data-agent="claude"` when localStorage is empty. Kimi users see a brief orange flash on first visit. Eliminating this requires SSR or build-time agent selection.
7. **Not all UI chrome is themed** — Decorative elements (spinners, streaming cursors, QR scanner frame, pair screen) keep their original colors. Only interactive state-signaling elements (buttons, tabs, highlights) are theme-aware.
