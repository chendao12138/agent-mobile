import type { IncomingMessage } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { readTree } from './claude-data';

export type AttachmentCategory = 'pdf' | 'word' | 'ppt' | 'image' | 'video' | 'txt';

export interface AttachmentRecord {
  id: string;
  sessionId: string;
  originalName: string;
  filename: string;
  path: string;
  mimeType: string;
  category: AttachmentCategory;
  size: number;
  createdAt: number;
}

interface ParsedUpload {
  fields: Record<string, string>;
  file: {
    filename: string;
    mimeType: string;
    data: Buffer;
  };
}

export const MAX_ATTACHMENT_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_SESSION_ATTACHMENT_BYTES = 100 * 1024 * 1024;

const ATTACHMENTS_DIR = join(homedir(), '.cli-mobile', 'attachments');
const MANIFEST_FILE = 'manifest.json';
const CLEANUP_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;
const MULTIPART_OVERHEAD_BYTES = 512 * 1024;

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

export function startAttachmentCleanup(): void {
  if (cleanupTimer) return;
  void cleanupExpiredAttachments();
  cleanupTimer = setInterval(() => {
    void cleanupExpiredAttachments();
  }, CLEANUP_INTERVAL_MS);
  cleanupTimer.unref();
}

export async function handleAttachmentUpload(req: IncomingMessage): Promise<AttachmentRecord> {
  const upload = await parseMultipartUpload(req);
  const workspace = upload.fields.workspace;
  const sessionId = upload.fields.sessionId;

  if (!workspace || !sessionId || sessionId === 'new') {
    throw new AttachmentError(400, '附件只能上传到已有会话');
  }

  await ensureSessionInWorkspace(workspace, sessionId);

  if (upload.file.data.length > MAX_ATTACHMENT_FILE_BYTES) {
    throw new AttachmentError(413, '单个附件不能超过 20MB');
  }

  const category = detectCategory(upload.file.filename, upload.file.mimeType);
  if (!category) {
    throw new AttachmentError(415, '仅支持 pdf/word/ppt/image/video/txt 附件');
  }

  const sessionDir = join(ATTACHMENTS_DIR, sessionId);
  await mkdir(sessionDir, { recursive: true });

  const records = await readManifest(sessionId);
  const usedBytes = await totalAttachmentBytes(sessionId, records);
  if (usedBytes + upload.file.data.length > MAX_SESSION_ATTACHMENT_BYTES) {
    throw new AttachmentError(413, '当前会话附件总大小不能超过 100MB');
  }

  const originalName = basename(upload.file.filename || 'attachment');
  const safeName = sanitizeFilename(originalName, category);
  const id = `att_${randomUUID()}`;
  const filename = `${id}-${safeName}`;
  const filePath = join(sessionDir, filename);

  await writeFile(filePath, upload.file.data);

  const record: AttachmentRecord = {
    id,
    sessionId,
    originalName,
    filename,
    path: filePath,
    mimeType: upload.file.mimeType || 'application/octet-stream',
    category,
    size: upload.file.data.length,
    createdAt: Date.now(),
  };

  records.push(record);
  await writeManifest(sessionId, records);
  return record;
}

export async function listAttachments(workspace: string, sessionId: string): Promise<AttachmentRecord[]> {
  if (!workspace || !sessionId || sessionId === 'new') return [];
  await ensureSessionInWorkspace(workspace, sessionId);
  return readManifest(sessionId);
}

export async function resolveAttachments(
  workspace: string,
  sessionId: string,
  attachmentIds: string[] | undefined,
): Promise<AttachmentRecord[]> {
  if (!attachmentIds || attachmentIds.length === 0) return [];
  if (sessionId === 'new') {
    throw new AttachmentError(400, '附件只能用于已有会话');
  }

  await ensureSessionInWorkspace(workspace, sessionId);
  const idSet = new Set(attachmentIds);
  const records = await readManifest(sessionId);
  const matched = records.filter((r) => idSet.has(r.id));

  if (matched.length !== idSet.size) {
    throw new AttachmentError(404, '部分附件不存在或不属于当前会话');
  }

  for (const record of matched) {
    const fileStat = await stat(record.path).catch(() => null);
    if (!fileStat?.isFile()) {
      throw new AttachmentError(404, `附件文件不存在: ${record.originalName}`);
    }
  }

  return matched;
}

export async function deleteAttachment(workspace: string, sessionId: string, id: string): Promise<boolean> {
  if (!workspace || !sessionId || sessionId === 'new') return false;
  await ensureSessionInWorkspace(workspace, sessionId);

  const records = await readManifest(sessionId);
  const idx = records.findIndex((r) => r.id === id);
  if (idx === -1) return false;

  const [record] = records.splice(idx, 1);
  if (record) {
    await unlink(record.path).catch(() => {});
  }
  await writeManifest(sessionId, records);
  return true;
}

export class AttachmentError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function ensureSessionInWorkspace(workspace: string, sessionId: string): Promise<void> {
  const tree = await readTree();
  const ws = tree.workspaces.find((w) => w.name === workspace);
  if (!ws) {
    throw new AttachmentError(404, 'Workspace not found or no longer available');
  }
  const session = ws.sessions.find((s) => s.id === sessionId);
  if (!session) {
    throw new AttachmentError(404, 'Session is not in this workspace');
  }
}

async function parseMultipartUpload(req: IncomingMessage): Promise<ParsedUpload> {
  const contentType = req.headers['content-type'] ?? '';
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  const boundary = boundaryMatch?.[1] ?? boundaryMatch?.[2];
  if (!boundary) {
    throw new AttachmentError(400, 'Expected multipart/form-data');
  }

  const declaredLength = Number(req.headers['content-length'] ?? 0);
  if (declaredLength > MAX_ATTACHMENT_FILE_BYTES + MULTIPART_OVERHEAD_BYTES) {
    throw new AttachmentError(413, '单个附件不能超过 20MB');
  }

  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > MAX_ATTACHMENT_FILE_BYTES + MULTIPART_OVERHEAD_BYTES) {
      throw new AttachmentError(413, '单个附件不能超过 20MB');
    }
    chunks.push(buf);
  }

  const body = Buffer.concat(chunks);
  const parts = splitBuffer(body, Buffer.from(`--${boundary}`));
  const fields: Record<string, string> = {};
  let file: ParsedUpload['file'] | null = null;

  for (const rawPart of parts) {
    let part = trimPart(rawPart);
    if (part.length === 0 || part.equals(Buffer.from('--'))) continue;
    if (part.subarray(0, 2).toString() === '--') continue;

    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd === -1) continue;

    const headerText = part.subarray(0, headerEnd).toString('utf8');
    let value = part.subarray(headerEnd + 4);
    if (value.subarray(-2).toString() === '\r\n') {
      value = value.subarray(0, -2);
    }

    const disposition = headerText.match(/content-disposition:\s*form-data;([^\r\n]+)/i)?.[1] ?? '';
    const name = disposition.match(/name="([^"]+)"/i)?.[1];
    const filename = disposition.match(/filename="([^"]*)"/i)?.[1];
    const mimeType = headerText.match(/content-type:\s*([^\r\n]+)/i)?.[1]?.trim() ?? '';

    if (!name) continue;

    if (filename !== undefined) {
      if (name === 'file' && value.length > 0) {
        file = { filename, mimeType, data: value };
      }
    } else {
      fields[name] = value.toString('utf8');
    }
  }

  if (!file) {
    throw new AttachmentError(400, '缺少附件文件');
  }

  return { fields, file };
}

function splitBuffer(buffer: Buffer, delimiter: Buffer): Buffer[] {
  const parts: Buffer[] = [];
  let start = 0;
  let idx = buffer.indexOf(delimiter, start);

  while (idx !== -1) {
    parts.push(buffer.subarray(start, idx));
    start = idx + delimiter.length;
    idx = buffer.indexOf(delimiter, start);
  }
  parts.push(buffer.subarray(start));
  return parts;
}

function trimPart(part: Buffer): Buffer {
  let start = 0;
  let end = part.length;
  while (part.subarray(start, start + 2).toString() === '\r\n') start += 2;
  while (part.subarray(end - 2, end).toString() === '\r\n') end -= 2;
  return part.subarray(start, end);
}

function detectCategory(filename: string, mimeType: string): AttachmentCategory | null {
  const ext = extname(filename).toLowerCase();
  const mime = mimeType.toLowerCase();

  if (mime === 'application/pdf' || ext === '.pdf') return 'pdf';
  if (
    mime === 'application/msword' ||
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    ext === '.doc' ||
    ext === '.docx'
  ) return 'word';
  if (
    mime === 'application/vnd.ms-powerpoint' ||
    mime === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
    ext === '.ppt' ||
    ext === '.pptx'
  ) return 'ppt';
  if (mime.startsWith('image/') || ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.heic', '.heif'].includes(ext)) return 'image';
  if (mime.startsWith('video/') || ['.mp4', '.mov', '.m4v', '.webm'].includes(ext)) return 'video';
  if (
    mime.startsWith('text/') ||
    ['.txt', '.md', '.markdown', '.csv', '.tsv', '.json', '.jsonl', '.log', '.xml', '.yaml', '.yml'].includes(ext)
  ) return 'txt';

  return null;
}

function sanitizeFilename(filename: string, category: AttachmentCategory): string {
  const fallbackExt: Record<AttachmentCategory, string> = {
    pdf: '.pdf',
    word: '.docx',
    ppt: '.pptx',
    image: '.png',
    video: '.mp4',
    txt: '.txt',
  };

  const base = basename(filename || `attachment${fallbackExt[category]}`)
    .normalize('NFKC')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 120);

  const safe = base || `attachment${fallbackExt[category]}`;
  return extname(safe) ? safe : `${safe}${fallbackExt[category]}`;
}

async function readManifest(sessionId: string): Promise<AttachmentRecord[]> {
  try {
    const text = await readFile(join(ATTACHMENTS_DIR, sessionId, MANIFEST_FILE), 'utf8');
    const parsed = JSON.parse(text) as AttachmentRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeManifest(sessionId: string, records: AttachmentRecord[]): Promise<void> {
  const sessionDir = join(ATTACHMENTS_DIR, sessionId);
  await mkdir(sessionDir, { recursive: true });
  await writeFile(join(sessionDir, MANIFEST_FILE), JSON.stringify(records, null, 2) + '\n', 'utf8');
}

async function totalAttachmentBytes(sessionId: string, records: AttachmentRecord[]): Promise<number> {
  let total = 0;
  for (const record of records) {
    const fileStat = await stat(record.path).catch(() => null);
    total += fileStat?.isFile() ? fileStat.size : record.size;
  }
  return total;
}

async function cleanupExpiredAttachments(): Promise<void> {
  if (!existsSync(ATTACHMENTS_DIR)) return;

  const now = Date.now();
  const sessionDirs = await readdir(ATTACHMENTS_DIR, { withFileTypes: true }).catch(() => []);

  for (const dirent of sessionDirs) {
    if (!dirent.isDirectory()) continue;
    const sessionId = dirent.name;
    const records = await readManifest(sessionId);
    const kept: AttachmentRecord[] = [];

    for (const record of records) {
      if (now - record.createdAt > CLEANUP_AFTER_MS) {
        await unlink(record.path).catch(() => {});
      } else {
        kept.push(record);
      }
    }

    if (kept.length === 0) {
      await rm(join(ATTACHMENTS_DIR, sessionId), { recursive: true, force: true }).catch(() => {});
    } else if (kept.length !== records.length) {
      await writeManifest(sessionId, kept);
    }
  }
}
