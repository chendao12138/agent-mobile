// Parse Claude Code session JSONL files to extract conversation history

import { readFile } from 'node:fs/promises';
import { createReadStream, existsSync, readdirSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  blocks?: ContentBlock[];
  timestamp: string;
}

export interface ContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
}

interface JsonlLine {
  type?: string;
  message?: {
    role?: string;
    content?: string | ContentBlock[];
  };
  timestamp?: string;
  sessionId?: string;
}

export function findSessionFile(sessionId: string, cwd?: string): string | null {
  const projectsDir = join(homedir(), '.claude', 'projects');
  if (!existsSync(projectsDir)) return null;

  const projectDirs = [cwd, process.cwd(), undefined]
    .filter(Boolean)
    .map((d) => d!.replace(/\//g, '-'));

  for (const dir of projectDirs) {
    const filePath = join(projectsDir, dir!, `${sessionId}.jsonl`);
    if (existsSync(filePath)) return filePath;
  }

  try {
    const dirs = readdirSync(projectsDir);
    for (const dir of dirs) {
      const filePath = join(projectsDir, dir, `${sessionId}.jsonl`);
      if (existsSync(filePath)) return filePath;
    }
  } catch { /* ignore */ }

  return null;
}

export async function readSessionHistory(
  sessionId: string,
  cwd?: string,
  maxMessages: number = 100,
): Promise<ChatMessage[]> {
  const filePath = findSessionFile(sessionId, cwd);
  if (!filePath) return [];
  return readHistoryFromFile(filePath, maxMessages);
}

async function readHistoryFromFile(filePath: string, maxMessages: number): Promise<ChatMessage[]> {
  const messages: ChatMessage[] = [];

  return new Promise((resolve) => {
    const rl = createInterface({
      input: createReadStream(filePath),
      crlfDelay: Infinity,
    });

    // Merge consecutive assistant/tool_result entries into one bubble
    let pending: ChatMessage | null = null;

    function flushPending() {
      if (!pending) return;
      if (pending.blocks && pending.blocks.length > 0) {
        pending.content = blocksToText(pending.blocks);
      }
      messages.push(pending);
      pending = null;
    }

    rl.on('line', (line) => {
      if (messages.length >= maxMessages) { rl.close(); return; }
      const trimmed = line.trim();
      if (!trimmed) return;

      let obj: JsonlLine;
      try { obj = JSON.parse(trimmed); } catch { return; }

      if (obj.type !== 'user' && obj.type !== 'assistant') return;
      if (!obj.message?.content) return;

      const isToolResult = obj.type === 'user'
        && Array.isArray(obj.message.content)
        && (obj.message.content as ContentBlock[]).every((b) => b.type === 'tool_result');

      const isAssistantBlock = obj.type === 'assistant' || isToolResult;
      const role = isAssistantBlock ? 'assistant' : 'user';

      // Flush pending assistant bubble when a real user message arrives
      if (!isAssistantBlock) {
        flushPending();
        if (typeof obj.message.content === 'string') {
          messages.push({ role: 'user', content: obj.message.content, timestamp: obj.timestamp ?? '' });
        }
        return;
      }

      // Merge into pending assistant bubble
      const blocks = Array.isArray(obj.message.content)
        ? (obj.message.content as ContentBlock[])
        : [{ type: 'text', text: String(obj.message.content) }];

      if (!pending) {
        pending = { role: 'assistant', content: '', blocks: [], timestamp: obj.timestamp ?? '' };
      }
      pending.blocks = [...(pending.blocks ?? []), ...blocks];
      // Keep earliest timestamp
      if (!pending.timestamp && obj.timestamp) pending.timestamp = obj.timestamp;
    });

    rl.on('close', () => {
      flushPending();
      resolve(messages);
    });
  });
}

function blocksToText(blocks: ContentBlock[]): string {
  return blocks
    .map((b) => {
      if (b.type === 'text' && b.text) return b.text;
      if (b.type === 'thinking' && b.thinking) return '';
      if (b.type === 'tool_use') return '';
      if (b.type === 'tool_result') return '';
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

export async function readHistoryFromPath(filePath: string, maxMessages = 200): Promise<ChatMessage[]> {
  return readHistoryFromFile(filePath, maxMessages);
}

export async function readSessionFileRaw(sessionId: string, cwd?: string): Promise<string | null> {
  const filePath = findSessionFile(sessionId, cwd);
  if (!filePath) return null;
  return readFile(filePath, 'utf8');
}
