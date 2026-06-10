import { useRef, useEffect } from 'react';
import type { RunState } from '../../core/run-state';

export interface HistoryMessage {
  role: string;
  content: string;
  timestamp: string;
  /** Structured blocks from JSONL — same format as Claude's content blocks */
  blocks?: Array<{ type: string; text?: string; thinking?: string; id?: string; name?: string; input?: unknown; tool_use_id?: string; content?: unknown; is_error?: boolean }>;
}

interface ChatViewProps {
  messages: HistoryMessage[];
  streamState: RunState | null;
}

function formatTime(ts: string): string {
  if (!ts) return '';
  try { return new Date(ts).toLocaleTimeString('zh-CN', { hour:'2-digit', minute:'2-digit' }); }
  catch { return ''; }
}

export default function ChatView({ messages, streamState }: ChatViewProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, streamState]);

  return (
    <div className="space-y-3">
      {messages.map((msg, i) => (
        <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
          <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
            msg.role === 'user'
              ? 'bg-cyan-600 text-white rounded-br-md'
              : 'bg-slate-800 border border-slate-700 text-slate-200 rounded-bl-md'
          }`}>
            {msg.role === 'user' ? (
              <div className="whitespace-pre-wrap break-words">{msg.content}</div>
            ) : msg.blocks ? (
              <AssistantContent blocks={msg.blocks} />
            ) : (
              <div className="whitespace-pre-wrap break-words">{msg.content}</div>
            )}
            {msg.timestamp && (
              <div className={`text-[10px] mt-1 ${msg.role === 'user' ? 'text-cyan-200' : 'text-slate-500'}`}>
                {formatTime(msg.timestamp)}
              </div>
            )}
          </div>
        </div>
      ))}

      {streamState && (
        <div className="flex justify-start">
          <div className="max-w-[85%] rounded-2xl rounded-bl-md px-3 py-2 text-sm bg-slate-800 border border-slate-700 text-slate-200">
            <AssistantContent
              reasoning={streamState.reasoning.content || undefined}
              reasoningActive={streamState.reasoning.active}
              runBlocks={streamState.blocks}
              footer={streamState.footer}
              terminal={streamState.terminal}
              errorMsg={streamState.errorMsg}
            />
          </div>
        </div>
      )}

      {messages.length === 0 && !streamState && (
        <div className="text-center text-slate-600 py-12">
          <p className="text-4xl mb-3">🧠</p>
          <p className="text-sm">发送消息开始与 Claude 对话</p>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}

// ── Single rendering path for all assistant content ──

type HistoryBlock = HistoryMessage['blocks'] extends (infer T)[] | undefined ? T : never;

interface AssistantContentProps {
  /** History: raw content blocks from JSONL */
  blocks?: Array<{ type: string; text?: string; thinking?: string; id?: string; name?: string; input?: unknown; tool_use_id?: string; content?: unknown; is_error?: boolean }>;
  /** Live: reasoning text */
  reasoning?: string;
  reasoningActive?: boolean;
  /** Live: RunState blocks */
  runBlocks?: RunState['blocks'];
  /** Live: footer status */
  footer?: RunState['footer'];
  /** Live: terminal status */
  terminal?: RunState['terminal'];
  errorMsg?: string;
}

function AssistantContent(props: AssistantContentProps) {
  const { blocks, reasoning, reasoningActive, runBlocks, footer, terminal, errorMsg } = props;

  return (
    <>
      {/* Reasoning */}
      {reasoning && (
        <div className={`mb-2 rounded-lg p-2 text-[11px] ${reasoningActive ? 'bg-amber-500/10 border border-amber-500/30' : 'bg-slate-900/50'}`}>
          <div className="text-amber-400 text-[10px] mb-1">
            {reasoningActive ? '🧠 思考中…' : '🧠 思考完成'}
          </div>
          <div className="text-slate-400 whitespace-pre-wrap max-h-24 overflow-y-auto">
            {reasoning.slice(-800)}
          </div>
        </div>
      )}

      {/* Blocks — live stream */}
      {runBlocks && runBlocks.map((block, i) => {
        if (block.kind === 'text') {
          if (!block.content.trim()) return null;
          return (
            <div key={i} className="whitespace-pre-wrap break-words">
              {block.content}
              {block.streaming && <span className="inline-block w-1.5 h-3 bg-cyan-400 animate-pulse ml-0.5 align-middle" />}
            </div>
          );
        }
        return <ToolBlock key={block.tool.id} name={block.tool.name} status={block.tool.status} output={block.tool.output} />;
      })}

      {/* Blocks — history */}
      {blocks && !runBlocks && blocks.map((b, i) => {
        if (b.type === 'text' && b.text) {
          return <div key={i} className="whitespace-pre-wrap break-words">{b.text}</div>;
        }
        if (b.type === 'thinking' && b.thinking) {
          return (
            <div key={i} className="my-1 rounded-lg p-1.5 text-[11px] bg-slate-900/50">
              <div className="text-amber-400 text-[10px] mb-0.5">🧠 思考</div>
              <div className="text-slate-400 whitespace-pre-wrap max-h-24 overflow-y-auto">{b.thinking.slice(-500)}</div>
            </div>
          );
        }
        if (b.type === 'tool_use' && b.id && b.name) {
          return <ToolBlock key={b.id} name={b.name} status="done" />;
        }
        if (b.type === 'tool_result' && b.tool_use_id) {
          const output = typeof b.content === 'string' ? b.content : JSON.stringify(b.content);
          return <ToolBlock key={`tr-${b.tool_use_id}`} name="result" status={b.is_error ? 'error' : 'done'} output={output} />;
        }
        return null;
      })}

      {/* Live indicators */}
      {terminal === 'running' && (
        <div className="flex items-center gap-1 mt-1">
          {footer === 'thinking' && (
            <><span className="thinking-dot w-1.5 h-1.5 rounded-full bg-amber-400" /><span className="thinking-dot w-1.5 h-1.5 rounded-full bg-amber-400" /><span className="thinking-dot w-1.5 h-1.5 rounded-full bg-amber-400" /></>
          )}
          {footer === 'tool_running' && <span className="text-[10px] text-slate-500">🔧 调用工具中…</span>}
          {footer === 'streaming' && <span className="text-[10px] text-slate-500">✍️ 输出中</span>}
        </div>
      )}

      {terminal && terminal !== 'running' && (
        <div className={`text-[10px] mt-1 ${terminal === 'error' ? 'text-red-400' : terminal === 'interrupted' ? 'text-amber-400' : 'text-slate-500'}`}>
          {terminal === 'done' && '✓'}
          {terminal === 'interrupted' && '⏹ 已中断'}
          {terminal === 'error' && `⚠️ ${errorMsg ?? ''}`}
        </div>
      )}
    </>
  );
}

function toolIcon(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes('bash') || lower.includes('shell')) return '⚡';
  if (lower.includes('read') || lower.includes('file')) return '📖';
  if (lower.includes('write') || lower.includes('edit')) return '✏️';
  if (lower.includes('grep') || lower.includes('search') || lower.includes('glob')) return '🔍';
  if (lower.includes('web')) return '🌐';
  return '🔧';
}

function ToolBlock({ name, status, output }: { name: string; status: string; output?: string }) {
  const isRunning = status === 'running';
  return (
    <div className={`my-1 rounded-lg p-1.5 text-[11px] ${isRunning ? 'bg-blue-500/10 border border-blue-500/30' : status === 'error' ? 'bg-red-500/10 border border-red-500/30' : 'bg-slate-900/30'}`}>
      <span className="text-slate-400">
        {isRunning ? '⏳' : status === 'error' ? '❌' : '✅'} {toolIcon(name)} <span className="font-medium">{name}</span>
      </span>
      {output && <div className="mt-1 text-[10px] text-slate-500 truncate">{output.slice(-200)}</div>}
    </div>
  );
}
