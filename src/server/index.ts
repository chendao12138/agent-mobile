import { createRequire } from 'node:module';
import { createInterface } from 'node:readline';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { ClaudeAdapter } from '../agent/index';
import { refreshTree } from '../core/claude-data';
import { startAttachmentCleanup } from '../core/attachments';
import {
  ensureRemoteSetup,
  remoteSummary,
  resetRemoteSetup,
  startFrpc,
  type FrpcHandle,
  type RemoteConfig,
} from '../core/remote-access';
import { createApiRouter } from './api-router';
import { setupWebSocket } from './ws-server';
import {
  generatePairToken,
  validateDevice,
  getAccessUrls,
  listDevices,
  revokeDevice,
} from '../core/device-auth';

const require = createRequire(import.meta.url);
const packageJson = require('../../package.json') as { version?: string };
const APP_VERSION = packageJson.version ?? '0.0.0';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..', '..');
const isDev = process.env.NODE_ENV !== 'production';

// ── Auth middleware (applied only to /api routes) ──

// API paths that skip device-token auth
// NOTE: req.path is relative to the mount point (/api), so these are /pair not /api/pair
const PUBLIC_API_PATHS = new Set([
  '/pair',
  '/health',
]);

async function apiAuthMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (PUBLIC_API_PATHS.has(req.path)) {
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    res.status(401).json({ error: 'Unauthorized: no device token' });
    return;
  }

  const device = await validateDevice(token);
  if (!device) {
    res.status(401).json({ error: 'Unauthorized: invalid device token' });
    return;
  }

  // Attach device info to request
  (req as Request & { deviceName?: string }).deviceName = device.name;
  next();
}

// ── QR Code banner ──

function printBanner(pairToken: string, port: number, remoteConfig: RemoteConfig | null): void {
  const urls = getAccessUrls(port);
  const pairUrl = urls.lan[0]
    ? `${urls.lan[0]}?pair=${pairToken}`
    : (urls.public ? `${urls.public}?pair=${pairToken}` : `http://localhost:${port}?pair=${pairToken}`);

  console.log('');

  // QR code — outputs directly to terminal (no box frame, it's pixel art)
  try {
    const qrcode = require('qrcode-terminal');
    qrcode.generate(pairUrl, { small: true });
  } catch {
    console.log('(QR code generation skipped)');
  }

  // Info box below QR
  console.log('┌──────────────────────────────────────────┐');
  console.log('│        📱 CLI Mobile 扫码连接             │');
  console.log(`│  配对码: ${pairToken.padEnd(31)}│`);
  console.log('│  (30 分钟内有效)                          │');
  console.log('│                                          │');
  for (const u of urls.lan) {
    console.log(`│  LAN: ${u.padEnd(37)}│`);
  }
  if (urls.public) {
    console.log(`│  公网: ${urls.public.padEnd(36)}│`);
  }
  if (remoteConfig) {
    console.log(`│  STCP: ${remoteConfig.proxyName.padEnd(36)}│`);
  }
  console.log('└──────────────────────────────────────────┘');
  console.log('');
}

// ── Main ──

async function main(): Promise<void> {
  const defaultPort = parsePort(process.env.PORT) ?? 3009;
  const startupRemote = await prepareRemoteAtStartup(defaultPort);
  let activeRemoteConfig = startupRemote.config;
  const port = activeRemoteConfig?.localPort ?? defaultPort;
  const app = express();
  app.use(express.json());

  // ── Build + persist workspace/session tree from ~/.claude/ ──
  console.log('Scanning ~/.claude/ …');
  const tree = await refreshTree();
  console.log(`  ${tree.workspaces.length} workspaces, ${tree.workspaces.reduce((c, w) => c + w.sessions.length, 0)} sessions`);
  startAttachmentCleanup();

  // ── Agent ──
  const agent = new ClaudeAdapter();
  const available = await agent.isAvailable();
  if (!available) console.warn('⚠️  claude CLI not found on PATH.');
  else console.log('✓ claude CLI found');

  // ── Device auth: generate pair token ──
  const pairToken = generatePairToken();

  // ── Auth middleware on /api only ──
  app.use('/api', apiAuthMiddleware);

  // ── API routes ──
  app.use('/api', createApiRouter(agent));

  // ── Frontend (prod): static assets + SPA fallback (all public) ──
  if (!isDev) {
    const distDir = resolve(root, 'dist', 'mobile');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => { res.sendFile(resolve(distDir, 'index.html')); });
  }

  // ── HTTP + WS ──
  const httpServer = createServer(app);
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  setupWebSocket(wss, agent);

  let frpcHandle: FrpcHandle | null = null;

  httpServer.listen(port, () => {
    void onListening();
  });

  async function onListening(): Promise<void> {
    console.log(`\n🧠  CLI Mobile v${APP_VERSION}\n`);
    if (activeRemoteConfig) {
      frpcHandle = startFrpc(activeRemoteConfig);
      if (frpcHandle) {
        const status = await frpcHandle.waitForStartup();
        console.log(status.ok ? `✓ ${status.message}` : `⚠️  ${status.message}`);
      } else {
        console.log('⚠️  frpc 启动失败');
      }
    }
    printBanner(pairToken, port, activeRemoteConfig);
    startRepl(currentPairToken, port);
  }

  httpServer.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`端口 ${port} 已被占用。请关闭占用进程，或使用 remote reset 重新配置端口后重启。`);
    } else {
      console.error(err);
    }
    process.exit(1);
  });

  // ── Interactive terminal commands ──
  let currentPairToken = pairToken;

  function startRepl(initialToken: string, currentPort: number): void {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: '\x1b[36mcli-mobile>\x1b[0m ',
    });

    rl.prompt();

    rl.on('line', async (line) => {
      const input = line.trim();

      if (!input) {
        rl.prompt();
        return;
      }

      const parts = input.split(/\s+/);
      const cmd = parts[0]!.toLowerCase();
      const arg = parts[1];
      const sub = parts[1]?.toLowerCase();

      try {
        switch (cmd) {
          case 'devices':
          case 'ls': {
            const devices = await listDevices();
            if (devices.length === 0) {
              console.log('  (无已配对设备)');
            } else {
              console.log(`  ${devices.length} 台设备:`);
              for (const d of devices) {
                const ago = formatAgo(Date.now() - d.lastSeen);
                console.log(`  ${d.id}  ${d.name.padEnd(20)}  最后活跃: ${ago}`);
              }
            }
            break;
          }

          case 'revoke':
          case 'rm': {
            if (!arg) {
              console.log('  用法: revoke <设备ID>');
              break;
            }
            // Support partial ID match (first few chars)
            const devices = await listDevices();
            const match = devices.find((d) => d.id.startsWith(arg));
            if (!match) {
              console.log(`  未找到设备: ${arg}`);
              break;
            }
            await revokeDevice(match.id);
            console.log(`  已移除: ${match.name} (${match.id})`);
            break;
          }

          case 'pair':
          case 'newpair': {
            currentPairToken = generatePairToken();
            printBanner(currentPairToken, currentPort, activeRemoteConfig);
            break;
          }

          case 'remote': {
            if (sub === 'reset') {
              if (frpcHandle) {
                await frpcHandle.stop();
                frpcHandle = null;
              }
              const nextConfig = await resetRemoteSetup({
                ask: (question) => new Promise((resolve) => rl.question(question, resolve)),
                currentPort,
              });
              if (nextConfig) {
                activeRemoteConfig = nextConfig;
                frpcHandle = startFrpc(nextConfig);
                if (frpcHandle) {
                  const status = await frpcHandle.waitForStartup();
                  console.log(status.ok ? `  ✓ ${status.message}` : `  ⚠️  ${status.message}`);
                } else {
                  console.log('  ⚠️  frpc 启动失败');
                }
              } else {
                activeRemoteConfig = null;
              }
              break;
            }

            if (sub === 'status' || !sub) {
              const lines = remoteSummary(activeRemoteConfig);
              for (const line of lines) console.log(`  ${line}`);
              console.log(`  frpc: ${frpcHandle?.isRunning() ? '运行中' : '未运行'}`);
              break;
            }

            console.log('  用法: remote [status|reset]');
            break;
          }

          case 'help':
          case '?': {
            console.log('');
            console.log('  命令:');
            console.log('  devices, ls          列出已配对设备');
            console.log('  revoke <id>, rm <id>  移除设备');
            console.log('  pair, newpair         生成新配对码');
            console.log('  remote status         查看 STCP/frpc 状态');
            console.log('  remote reset          重新配置 STCP/frpc');
            console.log('  help, ?               显示帮助');
            console.log('  exit, quit, q         退出');
            console.log('');
            break;
          }

          case 'exit':
          case 'quit':
          case 'q': {
            console.log('  再见 👋');
            await frpcHandle?.stop();
            rl.close();
            process.exit(0);
          }

          default: {
            console.log(`  未知命令: ${cmd}（输入 help 查看帮助）`);
          }
        }
      } catch (err) {
        console.log(`  出错: ${err}`);
      }

      rl.prompt();
    });

    rl.on('close', () => {
      // readline closed, nothing to do
    });
  }

  process.on('SIGINT', () => {
    void frpcHandle?.stop().finally(() => process.exit(0));
  });

  function formatAgo(ms: number): string {
    if (ms < 60_000) return '刚刚';
    if (ms < 3600_000) return `${Math.floor(ms / 60_000)} 分钟前`;
    if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)} 小时前`;
    return `${Math.floor(ms / 86_400_000)} 天前`;
  }
}

main().catch((err) => { console.error(err); process.exit(1); });

async function prepareRemoteAtStartup(defaultPort: number): Promise<{ config: RemoteConfig | null }> {
  if (!process.stdin.isTTY) {
    return ensureRemoteSetup({ canPrompt: false, defaultPort });
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await ensureRemoteSetup({
      ask: (question) => new Promise((resolve) => rl.question(question, resolve)),
      canPrompt: true,
      defaultPort,
    });
  } finally {
    rl.close();
  }
}

function parsePort(value: string | undefined): number | null {
  if (!value) return null;
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65_535 ? port : null;
}
