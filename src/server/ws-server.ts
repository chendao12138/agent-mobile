import type { WebSocketServer, WebSocket } from 'ws';
import type { AgentAdapter, AgentRun } from '../agent/types';
import { ActiveRuns, type RunHandle } from '../core/active-runs';
import { ProcessPool } from '../core/process-pool';
import { PendingQueue, type QueueMessage } from '../core/pending-queue';
import { initialState, finalizeIfRunning, markInterrupted, reduce, type RunState } from '../core/run-state';
import { tryHandleCommand } from '../commands';
import { readTree, refreshTree, updateSessionName } from '../core/claude-data';
import { validateDevice } from '../core/device-auth';
import { AttachmentError, type AttachmentRecord, resolveAttachments } from '../core/attachments';
import type { ClientMessage, ServerMessage } from './ws-types';

const DEBOUNCE_MS = 600;

interface WsContext {
  ws: WebSocket;
  agent: AgentAdapter;
  activeRuns: ActiveRuns;
  pool: ProcessPool;
}

export function setupWebSocket(
  wss: WebSocketServer,
  agent: AgentAdapter,
): void {
  const activeRuns = new ActiveRuns();
  const pool = new ProcessPool(5);

  wss.on('connection', (ws, req) => {
    // ── Token validation ──
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const token = url.searchParams.get('token');

    if (!token) {
      console.log('[ws] rejected: no token');
      ws.close(4001, 'No device token');
      return;
    }

    // Validate asynchronously — if invalid, close
    validateDevice(token).then((device) => {
      if (!device) {
        console.log('[ws] rejected: invalid token');
        ws.close(4001, 'Invalid device token');
        return;
      }

      console.log(`[ws] device connected: ${device.name} (${device.id})`);

      const ctx: WsContext = { ws, agent, activeRuns, pool };

      const pending = new PendingQueue(DEBOUNCE_MS, (scope, batch) => {
        const lastMsg = batch[batch.length - 1];
        if (!lastMsg) return;
        pending.block(scope);
        void runPrompt({ ctx, scope, lastMsg, pending });
      });

      ws.on('message', (raw) => {
        let msg: ClientMessage;
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          return;
        }

        switch (msg.type) {
          case 'ping': {
            send(ws, { type: 'pong' });
            break;
          }
          case 'prompt': {
            const scope = `${msg.workspace}:${msg.sessionId}`;
            pending.push(scope, { text: msg.text, forkFrom: msg.forkFrom, attachmentIds: msg.attachmentIds, mode: msg.mode, model: msg.model, timestamp: Date.now() });
            break;
          }
          case 'command': {
            void handleCommandSync(ctx, msg.workspace, msg.sessionId, msg.text);
            break;
          }
          case 'stop': {
            const scope = `${msg.workspace}:${msg.sessionId}`;
            pending.cancel(scope);
            activeRuns.interrupt(scope);
            break;
          }
        }
      });

      ws.on('close', () => {
        console.log('[ws] client disconnected');
        pending.cancelAll();
      });

      ws.on('error', (err) => {
        console.error('[ws] error:', err.message);
      });

    }); // end validateDevice.then
  });
}

async function handleCommandSync(
  ctx: WsContext,
  workspace: string,
  sessionId: string,
  text: string,
): Promise<void> {
  try {
    const result = await tryHandleCommand({
      text,
      workspace,
      sessionId,
      activeRuns: ctx.activeRuns,
      agent: ctx.agent,
    });

    if (result) {
      send(ctx.ws, {
        type: 'command_result',
        workspace,
        command: text,
        result: { ok: result.ok, message: result.message, data: result.data },
      });
    }
  } catch (err) {
    send(ctx.ws, {
      type: 'command_result',
      workspace,
      command: text,
      result: { ok: false, message: String(err) },
    });
  }
}

async function runPrompt(opts: {
  ctx: WsContext;
  scope: string;
  lastMsg: QueueMessage;
  pending: PendingQueue;
}): Promise<void> {
  const { ctx, scope, lastMsg } = opts;
  const { ws, agent, activeRuns, pool } = ctx;
  const [workspace, ...rest] = scope.split(':');
  const sessionId = rest.join(':');
  let run: AgentRun | null = null;
  let handle: RunHandle | null = null;
  let release: (() => void) | null = null;

  try {
    const target = await resolveRunTarget(workspace, sessionId, lastMsg.forkFrom);
    if (!target.ok) {
      send(ws, { type: 'error', workspace, sessionId, message: target.message });
      return;
    }

    const attachments = await resolveAttachments(workspace, sessionId, lastMsg.attachmentIds);
    const prompt = withAttachmentContext(lastMsg.text, attachments);

    release = await pool.acquire();

    run = agent.run({
      prompt,
      sessionId: sessionId !== 'new' ? sessionId : undefined,
      forkFrom: lastMsg.forkFrom,
      cwd: target.cwd,
      permissionMode: lastMsg.mode === 'plan' ? 'plan' : lastMsg.mode === 'auto' ? 'default' : 'bypassPermissions',
      model: lastMsg.model || undefined,
    });

    handle = activeRuns.register(scope, run);

    if (!run || !handle) return;

    let state: RunState = initialState;
    let seenSessionId: string | undefined;

    try {
      for await (const evt of run.events) {
        if (handle.interrupted) break;

        if (evt.type === 'system') {
          if (evt.sessionId) seenSessionId = evt.sessionId;
          continue;
        }

        if (evt.type === 'usage') {
          if (evt.costUsd !== undefined) {
            console.log('[usage]', { costUsd: evt.costUsd.toFixed(4) });
          }
          continue;
        }

        state = reduce(state, evt);
        send(ws, {
          type: 'stream',
          workspace,
          sessionId,
          state,
        });

        if (state.terminal !== 'running') break;
      }
    } finally {
      let stateChanged = false;
      if (state.terminal === 'running') {
        if (handle.interrupted) {
          state = markInterrupted(state);
        } else {
          state = finalizeIfRunning(state);
        }
        stateChanged = true;
      }
      if (stateChanged) {
        send(ws, { type: 'stream', workspace, sessionId, state });
      }

      // Reap subprocess
      if (handle.interrupted) {
        await handle.run.stop();
      } else {
        const exited = await handle.run.waitForExit(2000);
        if (!exited) await handle.run.stop();
      }
    }

    // Refresh tree and notify frontend so new sessions appear.
    // Auto-name new sessions with first 10 chars of the prompt.
    // refreshTree must come FIRST — it adds the new session to tree.json,
    // then updateSessionName can find and name it.
    try {
      await refreshTree();
      if (sessionId === 'new' && seenSessionId) {
        const autoName = lastMsg.text.trim().slice(0, 10);
        await updateSessionName(seenSessionId, autoName);
      }
      send(ws, {
        type: 'tree_updated',
        workspace,
        ...(sessionId === 'new' && seenSessionId ? { newSessionId: seenSessionId } : {}),
      });
    } catch { /* non-fatal */ }
  } catch (err) {
    console.error('[run]', err);
    if (err instanceof AttachmentError) {
      send(ws, { type: 'error', workspace, sessionId, message: err.message });
      return;
    }
    send(ws, { type: 'error', workspace, sessionId, message: String(err) });
  } finally {
    if (run) activeRuns.unregister(scope, run);
    release?.();
    opts.pending.unblock(scope);
  }
}

function withAttachmentContext(prompt: string, attachments: AttachmentRecord[]): string {
  if (attachments.length === 0) return prompt;

  const lines = attachments.map((a, index) => (
    `${index + 1}. ${a.originalName} (${a.category}, ${formatBytes(a.size)}): ${a.path}`
  ));

  return [
    '用户附加了以下本机文件。请在需要时读取这些路径，并把它们作为本次请求的上下文：',
    ...lines,
    '',
    '用户消息：',
    prompt || '请查看并处理这些附件。',
  ].join('\n');
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${bytes}B`;
}

async function resolveRunTarget(
  workspace: string,
  sessionId: string,
  forkFrom?: string,
): Promise<{ ok: true; cwd: string } | { ok: false; message: string }> {
  const tree = await readTree();
  const ws = tree.workspaces.find((w) => w.name === workspace);
  if (!ws) {
    return { ok: false, message: 'Workspace not found or no longer available' };
  }

  if (forkFrom) {
    const source = ws.sessions.find((s) => s.id === forkFrom);
    if (!source) {
      return { ok: false, message: 'Fork source session is not in this workspace' };
    }
    return { ok: true, cwd: source.cwd };
  }

  if (sessionId === 'new') {
    return { ok: true, cwd: ws.cwd };
  }

  const session = ws.sessions.find((s) => s.id === sessionId);
  if (!session) {
    return { ok: false, message: 'Session is not in this workspace' };
  }

  return { ok: true, cwd: session.cwd };
}

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}
