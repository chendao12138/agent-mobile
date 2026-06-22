import { randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { access, chmod, copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { tmpdir, homedir, platform, arch } from 'node:os';
import { basename, join } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { Readable } from 'node:stream';

export interface RemoteConfig {
  setupCompleted: boolean;
  enabled: boolean;
  frpcAutoStart?: boolean;
  mode: 'stcp';
  localPort: number;
  serverAddr: string;
  serverPort: number;
  token: string;
  proxyName: string;
  secretKey: string;
  frpcBin: string;
  frpcConfig: string;
  configuredAt: number;
}

class SkipRemoteSetup extends Error {
  constructor() {
    super('skip remote setup');
  }
}

export interface DisabledRemoteConfig {
  setupCompleted: boolean;
  enabled: false;
}

export type RemoteState = RemoteConfig | DisabledRemoteConfig;

export interface RemoteSetupResult {
  config: RemoteConfig | null;
  justConfigured: boolean;
}

export interface FrpcHandle {
  stop: () => Promise<void>;
  isRunning: () => boolean;
  waitForStartup: () => Promise<FrpcStartStatus>;
}

export interface FrpcStartStatus {
  ok: boolean;
  message: string;
}

export type AskFn = (question: string) => Promise<string>;

const CLI_MOBILE_DIR = join(homedir(), '.cli-mobile');
const BIN_DIR = join(CLI_MOBILE_DIR, 'bin');
const REMOTE_DIR = join(CLI_MOBILE_DIR, 'remote');
const REMOTE_STATE_PATH = join(REMOTE_DIR, 'remote.json');
const FRPC_CONFIG_PATH = join(REMOTE_DIR, 'cli-remote-frpc.toml');
const DEFAULT_PROXY_NAME = 'cli-mobile-stcp';
const GITHUB_LATEST_RELEASE = 'https://api.github.com/repos/fatedier/frp/releases/latest';

export async function ensureRemoteSetup(opts: {
  ask?: AskFn;
  canPrompt: boolean;
  defaultPort: number;
}): Promise<RemoteSetupResult> {
  const existing = await readRemoteState();
  if (existing?.setupCompleted) {
    return { config: existing.enabled ? existing : null, justConfigured: false };
  }

  if (!opts.canPrompt || !opts.ask) {
    return { config: null, justConfigured: false };
  }

  console.log('');
  console.log('首次启动：是否配置 frp STCP 远程访问？');
  console.log('选择否会只启用局域网访问，之后可在终端输入 remote reset 重新配置。');
  const answer = await opts.ask('启用 STCP 远程访问？(y/N) ');
  if (!isYes(answer)) {
    await writeRemoteState({ setupCompleted: true, enabled: false });
    return { config: null, justConfigured: true };
  }

  const config = await runRemoteWizard(opts.ask, { defaultPort: opts.defaultPort });
  if (!config) {
    await writeRemoteState({ setupCompleted: true, enabled: false });
    return { config: null, justConfigured: true };
  }
  await writeRemoteFiles(config);
  printRemoteCopyOnce(config);
  return { config, justConfigured: true };
}

export async function resetRemoteSetup(opts: {
  ask: AskFn;
  currentPort: number;
}): Promise<RemoteConfig | null> {
  console.log('');
  console.log('重新配置 frp STCP 远程访问。当前服务已在运行，本次配置会继续使用当前监听端口。');
  const answer = await opts.ask('启用 STCP 远程访问？(y/N) ');
  if (!isYes(answer)) {
    await writeRemoteState({ setupCompleted: true, enabled: false });
    console.log('  已关闭远程 STCP 自动启动。');
    return null;
  }

  const config = await runRemoteWizard(opts.ask, {
    defaultPort: opts.currentPort,
    fixedLocalPort: opts.currentPort,
  });
  if (!config) {
    await writeRemoteState({ setupCompleted: true, enabled: false });
    console.log('  已跳过远程 STCP 配置。');
    return null;
  }
  await writeRemoteFiles(config);
  printRemoteCopyOnce(config);
  return config;
}

export async function readRemoteState(): Promise<RemoteState | null> {
  try {
    const text = await readFile(REMOTE_STATE_PATH, 'utf8');
    const parsed = JSON.parse(text) as RemoteState;
    return parsed?.setupCompleted ? parsed : null;
  } catch {
    return null;
  }
}

export async function setFrpcAutoStart(config: RemoteConfig, frpcAutoStart: boolean): Promise<RemoteConfig> {
  const next: RemoteConfig = { ...config, frpcAutoStart };
  await writeRemoteState(next);
  return next;
}

export function remoteSummary(config: RemoteConfig | null): string[] {
  if (!config) return ['远程 STCP: 未启用'];
  return [
    '远程 STCP: 已启用',
    `frpc 自动启动: ${config.frpcAutoStart === false ? '否' : '是'}`,
    `frps: ${config.serverAddr}:${config.serverPort}`,
    `proxy name: ${config.proxyName}`,
    `local: 127.0.0.1:${config.localPort}`,
    `frpc: ${config.frpcBin}`,
    `config: ${config.frpcConfig}`,
  ];
}

export function startFrpc(
  config: RemoteConfig,
): FrpcHandle | null {
  const child = spawn(config.frpcBin, ['-c', config.frpcConfig], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (!child.pid) {
    return null;
  }

  const startup = watchFrpcStartup(child.stdout, child.stderr);
  child.on('error', (err) => {
    startup.resolve({ ok: false, message: `frpc 错误: ${err.message}` });
  });
  child.on('exit', (code, signal) => {
    if (code !== 0 && signal !== 'SIGTERM' && signal !== 'SIGKILL') {
      console.warn(`[frpc] 已退出: code=${code ?? 'null'} signal=${signal ?? 'null'}`);
    }
  });

  return {
    isRunning: () => child.exitCode === null && child.signalCode === null,
    waitForStartup: () => startup.promise,
    stop: () => stopChild(child),
  };
}

async function runRemoteWizard(
  ask: AskFn,
  opts: { defaultPort: number; fixedLocalPort?: number },
): Promise<RemoteConfig | null> {
  const serverAddr = await askRequired(ask, 'frps 公网 IP 或域名: ');
  const serverPort = await askPort(ask, 'frps serverPort/bindPort: ');
  const token = await askRequired(ask, 'frps auth token: ');
  const frpcBin = await resolveFrpcBinary(ask).catch((err) => {
    if (err instanceof SkipRemoteSetup) return null;
    throw err;
  });
  if (!frpcBin) return null;
  const localPort = opts.fixedLocalPort ?? await chooseLocalPort(opts.defaultPort);
  const secretKey = randomSecretKey();

  return {
    setupCompleted: true,
    enabled: true,
    frpcAutoStart: true,
    mode: 'stcp',
    localPort,
    serverAddr,
    serverPort,
    token,
    proxyName: DEFAULT_PROXY_NAME,
    secretKey,
    frpcBin,
    frpcConfig: FRPC_CONFIG_PATH,
    configuredAt: Date.now(),
  };
}

async function resolveFrpcBinary(ask: AskFn): Promise<string> {
  const installed = join(BIN_DIR, 'frpc');
  if (await pathExists(installed)) {
    return installed;
  }

  for (;;) {
    const customPath = (await ask('frpc 程序路径（留空则自动下载安装到 ~/.cli-mobile/bin/frpc）: ')).trim();
    if (customPath) {
      await assertExecutable(customPath);
      return customPath;
    }

    console.log('  正在从 GitHub latest release 下载 frpc...');
    try {
      await installLatestFrpc(installed);
      return installed;
    } catch (err) {
      console.log(`  自动下载 frpc 失败: ${errorMessage(err)}`);
      console.log('  可以手动下载 frp 后输入 frpc 路径；直接回车将再次尝试下载。');
      const fallback = (await ask('frpc 路径，输入 skip 跳过远程配置，或回车重试下载: ')).trim();
      if (fallback.toLowerCase() === 'skip') {
        throw new SkipRemoteSetup();
      }
      if (fallback) {
        await assertExecutable(fallback);
        return fallback;
      }
    }
  }
}

async function installLatestFrpc(targetPath: string): Promise<void> {
  const releaseRes = await fetch(GITHUB_LATEST_RELEASE, {
    headers: { 'User-Agent': 'cli-mobile' },
  });
  if (!releaseRes.ok) {
    throw new Error(`获取 frp latest release 失败: HTTP ${releaseRes.status}`);
  }

  const release = await releaseRes.json() as {
    tag_name?: string;
    assets?: Array<{ name?: string; browser_download_url?: string }>;
  };
  const asset = selectFrpcAsset(release.assets ?? []);
  if (!asset?.browser_download_url || !asset.name) {
    throw new Error(`未找到适合当前平台的 frpc release 包 (${platform()}/${arch()})`);
  }

  const workDir = await mkdtemp(join(tmpdir(), 'cli-mobile-frpc-'));
  try {
    const archivePath = join(workDir, asset.name);
    await downloadToFileWithRetry(asset.browser_download_url, archivePath);
    await runCommand('tar', ['-xzf', archivePath, '-C', workDir]);
    const extractedFrpc = await findFile(workDir, process.platform === 'win32' ? 'frpc.exe' : 'frpc');
    if (!extractedFrpc) {
      throw new Error('frpc 压缩包中没有找到 frpc 可执行文件');
    }

    await mkdir(BIN_DIR, { recursive: true, mode: 0o700 });
    await copyFile(extractedFrpc, targetPath);
    await chmod(targetPath, 0o755);
    console.log(`  frpc 已安装: ${targetPath}`);
    if (release.tag_name) console.log(`  frp version: ${release.tag_name}`);
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

function selectFrpcAsset(assets: Array<{ name?: string; browser_download_url?: string }>): { name?: string; browser_download_url?: string } | null {
  const goos = platform() === 'darwin' ? 'darwin' : platform() === 'linux' ? 'linux' : platform();
  const goarch = arch() === 'x64' ? 'amd64' : arch() === 'arm64' ? 'arm64' : arch();
  const suffix = process.platform === 'win32' ? '.zip' : '.tar.gz';
  const pattern = new RegExp(`^frp_.*_${escapeRegExp(goos)}_${escapeRegExp(goarch)}${escapeRegExp(suffix)}$`);
  return assets.find((asset) => Boolean(asset.name && pattern.test(asset.name))) ?? null;
}

async function writeRemoteFiles(config: RemoteConfig): Promise<void> {
  await mkdir(BIN_DIR, { recursive: true, mode: 0o700 });
  await mkdir(REMOTE_DIR, { recursive: true, mode: 0o700 });

  const toml = renderFrpcToml(config);
  await writePrivateFile(FRPC_CONFIG_PATH, toml);
  await writeRemoteState(config);
}

async function writeRemoteState(state: RemoteState): Promise<void> {
  await mkdir(REMOTE_DIR, { recursive: true, mode: 0o700 });
  await writePrivateFile(REMOTE_STATE_PATH, JSON.stringify(state, null, 2) + '\n');
}

function renderFrpcToml(config: RemoteConfig): string {
  return [
    `serverAddr = "${tomlString(config.serverAddr)}"`,
    `serverPort = ${config.serverPort}`,
    '',
    '[auth]',
    'method = "token"',
    `token = "${tomlString(config.token)}"`,
    '',
    '[[proxies]]',
    `name = "${tomlString(config.proxyName)}"`,
    'type = "stcp"',
    `secretKey = "${tomlString(config.secretKey)}"`,
    'localIP = "127.0.0.1"',
    `localPort = ${config.localPort}`,
    '',
  ].join('\n');
}

function printRemoteCopyOnce(config: RemoteConfig): void {
  console.log('');
  console.log('STCP 配置完成。请把下面信息复制到 Burrow/visitor 端：');
  console.log(`  serverAddr: ${config.serverAddr}`);
  console.log(`  serverPort: ${config.serverPort}`);
  console.log(`  proxyName: ${config.proxyName}`);
  console.log(`  secretKey: ${config.secretKey}`);
  console.log(`  本地服务端口: ${config.localPort}`);
  console.log('');
}

async function chooseLocalPort(preferred: number): Promise<number> {
  for (let port = preferred; port < preferred + 100; port++) {
    if (await isPortAvailable(port)) return port;
  }
  throw new Error(`未找到可用本地端口，从 ${preferred} 开始连续 100 个端口都不可用`);
}

async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

async function askRequired(ask: AskFn, question: string): Promise<string> {
  for (;;) {
    const value = (await ask(question)).trim();
    if (value) return value;
    console.log('  不能为空。');
  }
}

async function askPort(ask: AskFn, question: string): Promise<number> {
  for (;;) {
    const value = Number((await ask(question)).trim());
    if (Number.isInteger(value) && value > 0 && value <= 65_535) return value;
    console.log('  请输入 1-65535 之间的端口。');
  }
}

async function assertExecutable(path: string): Promise<void> {
  const file = await stat(path).catch(() => null);
  if (!file?.isFile()) {
    throw new Error(`frpc 不存在: ${path}`);
  }
  await access(path).catch(() => {
    throw new Error(`frpc 不可访问: ${path}`);
  });
}

async function pathExists(path: string): Promise<boolean> {
  return access(path).then(() => true, () => false);
}

async function writePrivateFile(path: string, content: string): Promise<void> {
  await writeFile(path, content, { mode: 0o600, encoding: 'utf8' });
  await chmod(path, 0o600).catch(() => {});
}

async function downloadToFileWithRetry(url: string, filePath: string): Promise<void> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await unlink(filePath).catch(() => {});
      await downloadToFile(url, filePath);
      return;
    } catch (err) {
      lastErr = err;
      if (attempt < 3) {
        console.log(`  下载失败，正在重试 (${attempt + 1}/3): ${errorMessage(err)}`);
        await delay(1000 * attempt);
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function downloadToFile(url: string, filePath: string): Promise<void> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'cli-mobile' },
  });
  if (!res.ok || !res.body) {
    throw new Error(`下载 frpc 失败: HTTP ${res.status}`);
  }

  await new Promise<void>((resolve, reject) => {
    const file = createWriteStream(filePath);
    const readable = Readable.fromWeb(res.body as unknown as import('node:stream/web').ReadableStream);
    readable.on('error', reject);
    file.on('error', reject);
    file.on('finish', resolve);
    readable.pipe(file);
  });
}

async function runCommand(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'ignore' });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

async function findFile(dir: string, filename: string): Promise<string | null> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isFile() && basename(fullPath) === filename) return fullPath;
    if (entry.isDirectory()) {
      const nested = await findFile(fullPath, filename);
      if (nested) return nested;
    }
  }
  return null;
}

function watchFrpcStartup(
  stdout: NodeJS.ReadableStream,
  stderr: NodeJS.ReadableStream,
): { promise: Promise<FrpcStartStatus>; resolve: (status: FrpcStartStatus) => void } {
  let settled = false;
  let loginOk = false;
  let proxyOk = false;
  let lastLine = '';
  let resolvePromise!: (status: FrpcStartStatus) => void;
  const promise = new Promise<FrpcStartStatus>((resolve) => {
    resolvePromise = resolve;
  });

  const finish = (status: FrpcStartStatus): void => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    resolvePromise(status);
  };

  const handleLine = (line: string): void => {
    lastLine = line;
    if (line.includes('login to server success')) loginOk = true;
    if (line.includes('start proxy success')) proxyOk = true;
    if (line.includes('login to server failed') || line.includes('start proxy error') || line.includes('[E]')) {
      finish({ ok: false, message: summarizeFrpcLine(line) });
      return;
    }
    if (loginOk && proxyOk) {
      finish({ ok: true, message: 'STCP 已连接' });
    }
  };

  const timer = setTimeout(() => {
    finish({ ok: false, message: lastLine ? `frpc 启动状态未知: ${summarizeFrpcLine(lastLine)}` : 'frpc 启动状态未知' });
  }, 8000);
  timer.unref();

  collectLines(stdout, handleLine);
  collectLines(stderr, handleLine);
  return { promise, resolve: finish };
}

function collectLines(stream: NodeJS.ReadableStream, onLine: (line: string) => void): void {
  let buffer = '';
  stream.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8');
    let newline = buffer.indexOf('\n');
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trimEnd();
      buffer = buffer.slice(newline + 1);
      if (line) onLine(line);
      newline = buffer.indexOf('\n');
    }
  });
}

function summarizeFrpcLine(line: string): string {
  return line.replace(/^\d{4}-\d{2}-\d{2}[\sT]\d{2}:\d{2}:\d{2}\.\d+\s+\[[A-Z]\]\s+\[[^\]]+\]\s*/, '').trim();
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      resolve();
    }, 3000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function isYes(value: string): boolean {
  return ['y', 'yes', '是', '好', '启用'].includes(value.trim().toLowerCase());
}

function randomSecretKey(): string {
  return randomBytes(24).toString('base64url').slice(0, 32);
}

function tomlString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
