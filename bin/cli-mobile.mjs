#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const args = process.argv.slice(2);
const command = args[0];

if (command === 'dev' || !command) {
  // Run the server with tsx for development
  const tsx = resolve(root, 'node_modules', '.bin', 'tsx');
  const server = spawn(tsx || 'npx', [tsx ? 'src/server/index.ts' : 'tsx src/server/index.ts'], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'development' },
    shell: true,
  });
  server.on('exit', (code) => process.exit(code ?? 0));
} else if (command === 'help' || command === '--help') {
  console.log('cli-mobile — Mobile remote control for CLI agents');
  console.log('');
  console.log('Usage:');
  console.log('  cli-mobile          Start the server');
  console.log('  cli-mobile dev      Start in development mode');
  console.log('  cli-mobile --help   Show this help');
} else {
  console.error(`Unknown command: ${command}`);
  process.exit(1);
}
