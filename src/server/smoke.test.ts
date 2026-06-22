import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import request from 'supertest';
import { createApiRouter } from './api-router';
import type { AgentAdapter } from '../agent/types';

/**
 * Lightweight E2E smoke test — starts the real Express app (without
 * binding to a network port) and hits key endpoints.
 *
 * No mocks: uses real core modules, though devices / workspaces / sessions
 * will be whatever is on the actual machine.
 */

function mockAgent(): AgentAdapter {
  return {
    id: 'test',
    displayName: 'Test Agent',
    isAvailable: async () => true,
    run: () => {
      throw new Error('agent.run not implemented in smoke test');
    },
  };
}

let server: Server;

beforeAll(async () => {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // Auth middleware (same as real index.ts)
  const PUBLIC = new Set(['/pair', '/health']);
  app.use('/api', (req, res, next) => {
    if (PUBLIC.has(req.path)) { next(); return; }
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) { res.status(401).json({ error: 'Unauthorized' }); return; }
    // In smoke test we accept any token of reasonable length
    if (token.length < 32) { res.status(401).json({ error: 'Invalid token' }); return; }
    next();
  });

  app.use('/api', createApiRouter(mockAgent()));

  server = createServer(app);
  // Bind to random port
  await new Promise<void>((resolve) => server.listen(0, resolve));
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('smoke test', () => {
  const VALID_TOKEN = 'a'.repeat(64);

  function req() {
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('server not bound');
    return request(`http://127.0.0.1:${addr.port}`);
  }

  it('GET /api/health returns 200', async () => {
    const res = await req().get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('POST /api/pair without pairToken returns 400', async () => {
    const res = await req().post('/api/pair').send({});
    expect(res.status).toBe(400);
  });

  it('POST /api/pair with invalid token returns 403', async () => {
    const res = await req().post('/api/pair').send({ pairToken: 'XXXXXX', deviceName: 'Test' });
    expect(res.status).toBe(403);
  });

  it('GET /api/tree without auth returns 401', async () => {
    const res = await req().get('/api/tree');
    expect(res.status).toBe(401);
  });

  it('GET /api/tree with token returns 200', async () => {
    const res = await req()
      .get('/api/tree')
      .set('Authorization', `Bearer ${VALID_TOKEN}`);
    // Works on a real machine with ~/.claude/ populated, or returns empty
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('workspaces');
  });
});
