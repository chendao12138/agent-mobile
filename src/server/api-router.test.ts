import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import type { Express, Request, Response, NextFunction } from 'express';
import request from 'supertest';
import { createApiRouter } from './api-router';
import type { AgentAdapter } from '../agent/types';

// ── Mock all downstream modules ──

vi.mock('../core/claude-data', () => ({
  readTree: vi.fn(),
  refreshTree: vi.fn(),
  updateSessionName: vi.fn(),
  archiveSession: vi.fn(),
  restoreSession: vi.fn(),
  togglePin: vi.fn(),
}));

vi.mock('../core/device-auth', () => ({
  generatePairToken: vi.fn(),
  validatePairToken: vi.fn(),
  createDevice: vi.fn(),
  listDevices: vi.fn(),
  revokeDevice: vi.fn(),
}));

vi.mock('../core/attachments', () => ({
  AttachmentError: class extends Error {
    constructor(readonly status: number, message: string) { super(message); }
  },
  deleteAttachment: vi.fn(),
  handleAttachmentUpload: vi.fn(),
  listAttachments: vi.fn(),
  // Return a no-op middleware that just calls next()
  upload: { single: vi.fn().mockReturnValue((_req: any, _res: any, cb: Function) => cb()) },
}));

vi.mock('../core/session-history', () => ({
  findSessionFile: vi.fn(),
  readHistoryFromPath: vi.fn(),
}));

// ── Helpers ──

function mockAgent(): AgentAdapter {
  return {
    id: 'test',
    displayName: 'Test',
    isAvailable: vi.fn().mockResolvedValue(true),
    run: vi.fn(),
  };
}

function makeApp(authToken?: string): Express {
  const app = express();
  app.use(express.json()); // ← parse JSON body (mirrors real index.ts)
  // Mirror the real index.ts middleware: /api routes use auth
  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    const PUBLIC = new Set(['/pair', '/health']);
    if (PUBLIC.has(req.path)) { next(); return; }
    if (!authToken) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const header = req.headers.authorization;
    if (!header || `Bearer ${authToken}` !== header) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    next();
  });
  app.use('/api', createApiRouter(mockAgent()));
  return app;
}

// ── Tests ──

describe('api-router', () => {
  // Dynamic imports for mocked modules
  async function getMocks() {
    const claudeData = await import('../core/claude-data');
    const deviceAuth = await import('../core/device-auth');
    const attachments = await import('../core/attachments');
    const sessionHistory = await import('../core/session-history');
    return { claudeData, deviceAuth, attachments, sessionHistory };
  }

  const DEVICE_TOKEN = 'a'.repeat(64);

  describe('health', () => {
    it('returns ok without auth', async () => {
      const app = makeApp();
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
    });
  });

  describe('pair', () => {
    it('returns 400 when pairToken missing', async () => {
      const app = makeApp();
      const res = await request(app)
        .post('/api/pair')
        .send({});
      expect(res.status).toBe(400);
    });

    it('returns 403 when pairToken invalid', async () => {
      const { deviceAuth } = await getMocks();
      (deviceAuth.validatePairToken as ReturnType<typeof vi.fn>).mockReturnValue(false);

      const app = makeApp();
      const res = await request(app)
        .post('/api/pair')
        .send({ pairToken: 'INVALID', deviceName: 'iPhone' });
      expect(res.status).toBe(403);
    });

    it('returns deviceToken when pairToken valid', async () => {
      const { deviceAuth } = await getMocks();
      (deviceAuth.validatePairToken as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (deviceAuth.createDevice as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'dev1',
        name: 'iPhone',
        tokenHash: 'hash',
        token: 'device-token-here',
        createdAt: Date.now(),
      });

      const app = makeApp();
      const res = await request(app)
        .post('/api/pair')
        .send({ pairToken: 'ABCDEF', deviceName: 'iPhone' });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.deviceToken).toBe('device-token-here');
    });
  });

  describe('tree', () => {
    it('returns 401 without auth', async () => {
      const app = makeApp();
      const res = await request(app).get('/api/tree');
      expect(res.status).toBe(401);
    });

    it('returns tree data', async () => {
      const { claudeData } = await getMocks();
      const mockTree = { workspaces: [{ name: 'test', cwd: '/tmp/test', sessions: [] }], updatedAt: 1 };
      (claudeData.readTree as ReturnType<typeof vi.fn>).mockResolvedValue(mockTree);

      const app = makeApp(DEVICE_TOKEN);
      const res = await request(app)
        .get('/api/tree')
        .set('Authorization', `Bearer ${DEVICE_TOKEN}`);
      expect(res.status).toBe(200);
      expect(res.body.workspaces).toHaveLength(1);
    });
  });

  describe('tree/refresh', () => {
    it('refreshes and returns tree', async () => {
      const { claudeData } = await getMocks();
      const mockTree = { workspaces: [], updatedAt: Date.now() };
      (claudeData.refreshTree as ReturnType<typeof vi.fn>).mockResolvedValue(mockTree);

      const app = makeApp(DEVICE_TOKEN);
      const res = await request(app)
        .post('/api/tree/refresh')
        .set('Authorization', `Bearer ${DEVICE_TOKEN}`);
      expect(res.status).toBe(200);
      expect(claudeData.refreshTree).toHaveBeenCalled();
    });
  });

  describe('sessions', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('GET history returns messages', async () => {
      const { sessionHistory } = await getMocks();
      (sessionHistory.findSessionFile as ReturnType<typeof vi.fn>).mockReturnValue('/tmp/s.jsonl');
      (sessionHistory.readHistoryFromPath as ReturnType<typeof vi.fn>).mockResolvedValue([
        { role: 'user', content: 'hello', timestamp: '' },
      ]);

      const app = makeApp(DEVICE_TOKEN);
      const res = await request(app)
        .get('/api/sessions/sid123/history')
        .set('Authorization', `Bearer ${DEVICE_TOKEN}`);
      expect(res.status).toBe(200);
      expect(res.body.messages).toHaveLength(1);
    });

    it('GET history returns empty when session not found', async () => {
      const { sessionHistory } = await getMocks();
      (sessionHistory.findSessionFile as ReturnType<typeof vi.fn>).mockReturnValue(null);

      const app = makeApp(DEVICE_TOKEN);
      const res = await request(app)
        .get('/api/sessions/sid123/history')
        .set('Authorization', `Bearer ${DEVICE_TOKEN}`);
      expect(res.status).toBe(200);
      expect(res.body.messages).toEqual([]);
    });

    it('PATCH name updates session', async () => {
      const { claudeData } = await getMocks();
      (claudeData.updateSessionName as ReturnType<typeof vi.fn>).mockResolvedValue(true);

      const app = makeApp(DEVICE_TOKEN);
      const res = await request(app)
        .patch('/api/sessions/sid123/name')
        .set('Authorization', `Bearer ${DEVICE_TOKEN}`)
        .send({ name: 'new name' });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    it('PATCH name returns 400 without name field', async () => {
      const app = makeApp(DEVICE_TOKEN);
      const res = await request(app)
        .patch('/api/sessions/sid123/name')
        .set('Authorization', `Bearer ${DEVICE_TOKEN}`)
        .send({});
      expect(res.status).toBe(400);
    });

    it('PATCH archive', async () => {
      const { claudeData } = await getMocks();
      (claudeData.archiveSession as ReturnType<typeof vi.fn>).mockResolvedValue(true);

      const app = makeApp(DEVICE_TOKEN);
      const res = await request(app)
        .patch('/api/sessions/sid123/archive')
        .set('Authorization', `Bearer ${DEVICE_TOKEN}`);
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });
  });

  describe('attachments', () => {
    it('returns 400 when no file uploaded', async () => {
      const app = makeApp(DEVICE_TOKEN);
      const res = await request(app)
        .post('/api/attachments')
        .set('Authorization', `Bearer ${DEVICE_TOKEN}`)
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('缺少附件文件');
    });

    it('GET attachments returns list', async () => {
      const { attachments } = await getMocks();
      (attachments.listAttachments as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const app = makeApp(DEVICE_TOKEN);
      const res = await request(app)
        .get('/api/attachments?workspace=test-ws&sessionId=sid1')
        .set('Authorization', `Bearer ${DEVICE_TOKEN}`);
      expect(res.status).toBe(200);
      expect(res.body.attachments).toEqual([]);
    });

    it('DELETE attachment', async () => {
      const { attachments } = await getMocks();
      (attachments.deleteAttachment as ReturnType<typeof vi.fn>).mockResolvedValue(true);

      const app = makeApp(DEVICE_TOKEN);
      const res = await request(app)
        .delete('/api/attachments/att_123?workspace=test-ws&sessionId=sid1')
        .set('Authorization', `Bearer ${DEVICE_TOKEN}`);
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });
  });
});
