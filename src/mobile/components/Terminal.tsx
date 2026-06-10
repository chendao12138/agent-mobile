import type { RunState } from '../../core/run-state';

interface TerminalProps {
  state: RunState;
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

function formatToolInput(input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const obj = input as Record<string, unknown>;
  // Show the most relevant field
  if (typeof obj.command === 'string') return obj.command;
  if (typeof obj.file_path === 'string') return obj.file_path;
  if (typeof obj.pattern === 'string') return obj.pattern;
  if (typeof obj.url === 'string') return obj.url;
  const keys = Object.keys(obj);
  const first = keys[0];
  if (first && typeof obj[first] === 'string') return String(obj[first]);
  return JSON.stringify(input).slice(0, 80);
}

export default function Terminal({ state }: TerminalProps) {
  return (
    <div className="space-y-2 font-mono text-xs leading-relaxed">
      {/* Reasoning panel */}
      {state.reasoning.content && (
        <div className={`rounded-lg border p-2 mb-2 ${state.reasoning.active ? 'border-amber-500/50 bg-amber-500/5' : 'border-slate-700 bg-slate-800/50'}`}>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-amber-400 text-[10px]">
              {state.reasoning.active ? '🧠 思考中…' : '🧠 思考完成'}
            </span>
          </div>
          <div className="text-slate-400 whitespace-pre-wrap text-[11px] max-h-32 overflow-y-auto">
            {state.reasoning.content.slice(-1500)}
          </div>
        </div>
      )}

      {/* Blocks */}
      {state.blocks.map((block, i) => {
        if (block.kind === 'text') {
          if (!block.content.trim()) return null;
          return (
            <div key={i} className="text-slate-200 whitespace-pre-wrap">
              {block.content}
              {block.streaming && <span className="inline-block w-2 h-3 bg-cyan-400 animate-pulse ml-0.5 align-middle" />}
            </div>
          );
        }

        // Tool block
        const { tool } = block;
        const isRunning = tool.status === 'running';
        return (
          <div
            key={tool.id}
            className={`rounded-lg border p-2 mb-2 ${isRunning ? 'border-blue-500/50 bg-blue-500/5 tool-running' : tool.status === 'error' ? 'border-red-500/50 bg-red-500/5' : 'border-slate-700 bg-slate-800/50'}`}
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px]">
                {isRunning ? '⏳' : tool.status === 'error' ? '❌' : '✅'}
              </span>
              <span className="font-semibold text-slate-300">
                {toolIcon(tool.name)} {tool.name}
              </span>
            </div>
            {tool.input && (
              <div className="text-[10px] text-slate-500 truncate">
                {formatToolInput(tool.input)}
              </div>
            )}
            {tool.output && (
              <div className={`mt-1 text-[10px] whitespace-pre-wrap max-h-24 overflow-y-auto rounded p-1 ${tool.status === 'error' ? 'text-red-400 bg-red-500/10' : 'text-slate-400 bg-slate-900/50'}`}>
                {tool.output.slice(-1000)}
              </div>
            )}
          </div>
        );
      })}

      {/* Terminal state footer */}
      {state.terminal !== 'running' && (
        <div className={`text-center text-[10px] py-2 ${
          state.terminal === 'error' ? 'text-red-400' :
          state.terminal === 'interrupted' ? 'text-amber-400' :
          'text-slate-500'
        }`}>
          {state.terminal === 'done' && '— 完成 —'}
          {state.terminal === 'interrupted' && '⏹ 已中断'}
          {state.terminal === 'error' && `⚠️ ${state.errorMsg ?? '未知错误'}`}
          {state.terminal === 'idle_timeout' && `⏱ ${state.idleTimeoutMinutes ?? 0} 分钟无响应，已终止`}
        </div>
      )}

      {/* Running indicator */}
      {state.terminal === 'running' && (
        <div className="flex items-center gap-1 text-[10px] text-slate-500 py-1">
          {state.footer === 'thinking' && (
            <>
              <span className="thinking-dot w-1.5 h-1.5 rounded-full bg-amber-400" />
              <span className="thinking-dot w-1.5 h-1.5 rounded-full bg-amber-400" />
              <span className="thinking-dot w-1.5 h-1.5 rounded-full bg-amber-400" />
              <span className="ml-1">思考中</span>
            </>
          )}
          {state.footer === 'tool_running' && <span>🔧 调用工具中…</span>}
          {state.footer === 'streaming' && <span>✍️ 输出中</span>}
        </div>
      )}
    </div>
  );
}
