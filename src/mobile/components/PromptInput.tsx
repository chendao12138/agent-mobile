import { useRef, useState } from 'react';

export interface PendingAttachment {
  id: string;
  name: string;
  size: number;
  category: string;
  uploading?: boolean;
}

interface PromptInputProps {
  onSend: (text: string) => void;
  onStop: () => void;
  isRunning: boolean;
  mode: string;
  onToggleMode: () => void;
  model: string;
  onToggleModel: () => void;
  attachments: PendingAttachment[];
  canAttach: boolean;
  onAttachFiles: (files: FileList) => void;
  onRemoveAttachment: (id: string) => void;
  onAttachUnavailable: () => void;
}

export default function PromptInput({
  onSend,
  onStop,
  isRunning,
  mode,
  onToggleMode,
  model,
  onToggleModel,
  attachments,
  canAttach,
  onAttachFiles,
  onRemoveAttachment,
  onAttachUnavailable,
}: PromptInputProps) {
  const [text, setText] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const hasUploading = attachments.some((a) => a.uploading);

  const handleSubmit = () => {
    if ((!text.trim() && attachments.length === 0) || hasUploading) return;
    onSend(text.trim());
    setText('');
  };

  const handleAttachClick = () => {
    if (!canAttach) {
      onAttachUnavailable();
      return;
    }
    fileInputRef.current?.click();
  };

  return (
    <div className="px-3 pt-2 pb-safe border-t border-slate-700 bg-slate-850">
      {/* Stop button — only when running */}
      {isRunning && (
        <div className="flex justify-center mb-2">
          <button
            onClick={onStop}
            className="px-4 py-1 rounded-full bg-red-600/20 border border-red-500/50 text-red-400 text-xs active:bg-red-600/40 transition-colors"
          >
            ⏹ 终止运行
          </button>
        </div>
      )}

      {attachments.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-2 terminal-scroll">
          {attachments.map((a) => (
            <div key={a.id} className="flex items-center gap-1 max-w-[180px] shrink-0 rounded-lg border border-slate-700 bg-slate-800 px-2 py-1">
              <span className="text-xs">{iconForCategory(a.category)}</span>
              <span className="truncate text-[11px] text-slate-300">{a.name}</span>
              <span className="text-[10px] text-slate-500">{formatBytes(a.size)}</span>
              {a.uploading ? (
                <span className="text-[10px] text-cyan-400">上传中</span>
              ) : (
                <button
                  onClick={() => onRemoveAttachment(a.id)}
                  className="ml-1 text-slate-500 active:text-slate-200"
                  title="移除附件"
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Toolbar row */}
      <div className="flex items-center gap-1 mb-2">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.doc,.docx,.ppt,.pptx,.txt,.md,.markdown,.csv,.tsv,.json,.jsonl,.log,.xml,.yaml,.yml,image/*,video/*"
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) onAttachFiles(e.target.files);
            e.currentTarget.value = '';
          }}
        />

        {/* Attachment picker */}
        <button
          onClick={handleAttachClick}
          disabled={isRunning}
          className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-800 border border-slate-700 text-slate-400 text-lg active:bg-slate-700 disabled:opacity-30"
          title={canAttach ? '添加附件' : '请选择已有会话后添加附件'}
        >
          +
        </button>

        {/* Mode toggle */}
        <button
          onClick={onToggleMode}
          className="px-2 py-1 rounded-full bg-slate-800 border border-slate-700 text-[11px] text-slate-400 active:bg-slate-700"
          title={`当前: ${mode}，点击切换`}
        >
          {{ plan: '📋', auto: '🛡️', bypass: '🚀' }[mode] ?? '🔧'} {mode}
        </button>

        <div className="flex-1" />

        {/* Model toggle */}
        <button
          onClick={onToggleModel}
          className="px-2 py-1 rounded-full bg-slate-800 border border-slate-700 text-[11px] text-amber-400 active:bg-slate-700"
          title="切换模型"
        >
          {model}
        </button>

        {/* Send button */}
        <button
          onClick={handleSubmit}
          disabled={(!text.trim() && attachments.length === 0) || isRunning || hasUploading}
          className="w-9 h-9 rounded-full bg-cyan-600 text-white font-bold disabled:opacity-30 active:bg-cyan-500 transition-colors flex items-center justify-center text-base"
        >
          ↑
        </button>
      </div>

      {/* Textarea */}
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSubmit();
          }
        }}
        placeholder={isRunning ? 'Claude 正在运行中…' : attachments.length > 0 ? '输入附件说明…' : '输入消息…'}
        rows={3}
        readOnly={isRunning}
        className="w-full resize-none rounded-xl bg-slate-800 border border-slate-600 px-3 py-3 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500 disabled:opacity-50"
      />
    </div>
  );
}

function iconForCategory(category: string): string {
  if (category === 'pdf') return 'PDF';
  if (category === 'word') return 'DOC';
  if (category === 'ppt') return 'PPT';
  if (category === 'image') return 'IMG';
  if (category === 'video') return 'VID';
  return 'TXT';
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}M`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)}K`;
  return `${bytes}B`;
}
