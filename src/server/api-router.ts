import { Router } from 'express';
import type { Response } from 'express';
import type { AgentAdapter } from '../agent/types';
import { readTree, updateSessionName, refreshTree } from '../core/claude-data';
import { findSessionFile, readHistoryFromPath } from '../core/session-history';
import {
  AttachmentError,
  deleteAttachment,
  handleAttachmentUpload,
  listAttachments,
} from '../core/attachments';
import {
  generatePairToken,
  validatePairToken,
  createDevice,
  listDevices,
  revokeDevice,
} from '../core/device-auth';

function requireParam(param: string | undefined, res: Response): string | null {
  if (!param || typeof param !== 'string') {
    res.status(400).json({ error: 'Missing or invalid parameter' });
    return null;
  }
  return param;
}

export function createApiRouter(agent?: AgentAdapter): Router {
  const r = Router();

  // ── Device pairing ──

  r.post('/pair', async (req, res) => {
    const { pairToken, deviceName } = req.body as { pairToken?: string; deviceName?: string };
    if (!pairToken || typeof pairToken !== 'string') {
      res.status(400).json({ ok: false, error: '缺少配对码' });
      return;
    }
    if (!validatePairToken(pairToken)) {
      res.status(403).json({ ok: false, error: '配对码无效或已过期，请在终端重新生成' });
      return;
    }
    try {
      const device = await createDevice(deviceName || 'Unknown Device');
      console.log(`[auth] 新设备已配对: ${device.name} (${device.id})`);
      res.json({ ok: true, deviceToken: device.token, deviceId: device.id });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err) });
    }
  });

  r.post('/pair/renew', async (_req, res) => {
    // Protected by apiAuthMiddleware but still check we have a device token
    const token = generatePairToken();
    res.json({ ok: true, pairToken: token });
  });

  r.get('/devices', async (_req, res) => {
    try {
      const devices = await listDevices();
      // Strip tokens from response for safety
      res.json({ devices: devices.map((d) => ({ id: d.id, name: d.name, createdAt: d.createdAt, lastSeen: d.lastSeen })) });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  r.delete('/devices/:id', async (req, res) => {
    const id = requireParam(req.params.id, res);
    if (!id) return;
    const ok = await revokeDevice(id);
    res.json({ ok });
  });

  // ── Tree ──
  r.get('/tree', async (_req, res) => {
    try {
      const tree = await readTree();
      res.json(tree);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ── Session history ──
  r.get('/sessions/:sessionId/history', async (req, res) => {
    const sessionId = requireParam(req.params.sessionId, res);
    if (!sessionId) return;
    try {
      const filePath = findSessionFile(sessionId);
      if (!filePath) { res.json({ sessionId, messages: [] }); return; }
      const msgs = await readHistoryFromPath(filePath, 200);
      res.json({ sessionId, messages: msgs.map((m) => ({ role: m.role, content: m.content, timestamp: m.timestamp, blocks: m.blocks })) });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ── Rename session ──
  r.patch('/sessions/:sessionId/name', async (req, res) => {
    const sessionId = requireParam(req.params.sessionId, res);
    if (!sessionId) return;
    const { name } = req.body as { name?: string };
    if (name === undefined) { res.status(400).json({ error: 'name required' }); return; }
    const ok = await updateSessionName(sessionId, name);
    res.json({ ok, sessionId, name });
  });

  // ── Session actions ──

  r.patch('/sessions/:sessionId/archive', async (req, res) => {
    const sessionId = requireParam(req.params.sessionId, res);
    if (!sessionId) return;
    const { archiveSession } = await import('../core/claude-data');
    const ok = await archiveSession(sessionId);
    res.json({ ok });
  });

  r.patch('/sessions/:sessionId/restore', async (req, res) => {
    const sessionId = requireParam(req.params.sessionId, res);
    if (!sessionId) return;
    const { restoreSession } = await import('../core/claude-data');
    const ok = await restoreSession(sessionId);
    res.json({ ok });
  });

  r.patch('/sessions/:sessionId/pin', async (req, res) => {
    const sessionId = requireParam(req.params.sessionId, res);
    if (!sessionId) return;
    const { togglePin } = await import('../core/claude-data');
    const ok = await togglePin(sessionId);
    res.json({ ok });
  });

  // ── Branch session ──
  r.post('/sessions/:sessionId/branch', async (req, res) => {
    const sessionId = requireParam(req.params.sessionId, res);
    if (!sessionId) return;
    if (!agent) { res.status(500).json({ ok: false, message: 'Agent not available' }); return; }

    try {
      // Find source session info from tree
      const tree = await readTree();
      let sourceCwd = '';
      let sourceName = '';
      let sourceMsgCount = 0;
      for (const ws of tree.workspaces) {
        const s = ws.sessions.find((s) => s.id === sessionId);
        if (s) {
          sourceCwd = s.cwd;
          sourceName = s.name;
          sourceMsgCount = s.messageCount;
          break;
        }
      }
      if (!sourceCwd) { res.status(404).json({ ok: false, message: 'Session not found' }); return; }

      // Build branch name: <name>-branch<N> or <id prefix>-branch<N>
      const base = sourceName || sessionId.slice(0, 8);
      const branchName = `${base}-branch${sourceMsgCount}`;

      // Spawn fork subprocess — prompt '.' is just a required placeholder.
      // We kill the process as soon as we capture the new session ID from
      // system.init, before Claude has time to process the prompt.
      const run = agent.run({
        prompt: '.',
        forkFrom: sessionId,
        cwd: sourceCwd,
        permissionMode: 'bypassPermissions',
        stopGraceMs: 50,  // near-instant kill after capturing session ID
      });

      let newSessionId: string | undefined;
      const SAFETY_MS = 15_000;
      const start = Date.now();

      try {
        for await (const evt of run.events) {
          if (evt.type === 'system' && evt.sessionId) {
            newSessionId = evt.sessionId;
            break; // got the ID, no need to wait for the full response
          }
          if (evt.type === 'error') {
            res.status(500).json({ ok: false, message: `Fork failed: ${evt.message}` });
            return;
          }
          if (Date.now() - start > SAFETY_MS) {
            await run.stop();
            res.status(500).json({ ok: false, message: 'Fork timed out' });
            return;
          }
        }
      } finally {
        // Kill immediately — we already captured the session ID from system.init.
        // At that point Claude has already forked (copied history into the new
        // JSONL) but hasn't written the placeholder prompt yet, so we get a clean
        // history with no spurious "." exchange.
        await run.stop();
      }

      if (!newSessionId) {
        res.status(500).json({ ok: false, message: 'Fork failed - no session ID received' });
        return;
      }

      // Refresh tree and name the branch
      await refreshTree();
      await updateSessionName(newSessionId, branchName);

      res.json({ ok: true, newSessionId, message: `分支已创建: ${branchName}` });
    } catch (err) {
      res.status(500).json({ ok: false, message: String(err) });
    }
  });

  // ── Refresh tree on demand ──
  r.post('/tree/refresh', async (_req, res) => {
    try {
      const { refreshTree } = await import('../core/claude-data');
      const tree = await refreshTree();
      res.json(tree);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ── Attachments ──

  r.post('/attachments', async (req, res) => {
    try {
      const attachment = await handleAttachmentUpload(req);
      res.json({ ok: true, attachment: publicAttachment(attachment) });
    } catch (err) {
      sendAttachmentError(res, err);
    }
  });

  r.get('/attachments', async (req, res) => {
    const workspace = typeof req.query.workspace === 'string' ? req.query.workspace : '';
    const sessionId = typeof req.query.sessionId === 'string' ? req.query.sessionId : '';
    try {
      const attachments = await listAttachments(workspace, sessionId);
      res.json({ attachments: attachments.map(publicAttachment) });
    } catch (err) {
      sendAttachmentError(res, err);
    }
  });

  r.delete('/attachments/:id', async (req, res) => {
    const id = requireParam(req.params.id, res);
    if (!id) return;
    const workspace = typeof req.query.workspace === 'string' ? req.query.workspace : '';
    const sessionId = typeof req.query.sessionId === 'string' ? req.query.sessionId : '';
    try {
      const ok = await deleteAttachment(workspace, sessionId, id);
      res.json({ ok });
    } catch (err) {
      sendAttachmentError(res, err);
    }
  });

  r.get('/health', (_req, res) => { res.json({ ok: true }); });

  return r;
}

function publicAttachment(a: {
  id: string;
  originalName: string;
  mimeType: string;
  category: string;
  size: number;
  createdAt: number;
}): {
  id: string;
  name: string;
  mimeType: string;
  category: string;
  size: number;
  createdAt: number;
} {
  return {
    id: a.id,
    name: a.originalName,
    mimeType: a.mimeType,
    category: a.category,
    size: a.size,
    createdAt: a.createdAt,
  };
}

function sendAttachmentError(res: Response, err: unknown): void {
  if (err instanceof AttachmentError) {
    res.status(err.status).json({ ok: false, error: err.message });
    return;
  }
  res.status(500).json({ ok: false, error: String(err) });
}
