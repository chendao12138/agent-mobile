interface SessionInfo {
  name: string;
  current: boolean;
  messageCount: number;
  lastPreview: string | null;
  updatedAt: number;
}

interface SessionListProps {
  sessions: SessionInfo[];
  onSelect: (name: string) => void;
  onNew: () => void;
}

export default function SessionList({ sessions, onSelect, onNew }: SessionListProps) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">会话</h2>
        <button
          onClick={onNew}
          className="text-xs text-cyan-400 active:text-cyan-300"
        >
          + 新建
        </button>
      </div>
      {sessions.length === 0 ? (
        <p className="text-xs text-slate-600 text-center py-4">暂无会话</p>
      ) : (
        sessions.map((s) => {
          const time = new Date(s.updatedAt).toLocaleString('zh-CN', {
            month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
          });
          return (
            <button
              key={s.name}
              onClick={() => onSelect(s.name)}
              className={`w-full text-left p-2 rounded-lg border transition-colors ${
                s.current
                  ? 'border-cyan-500/50 bg-cyan-500/10'
                  : 'border-slate-700 bg-slate-800 active:bg-slate-700'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className={`text-sm font-medium ${s.current ? 'text-cyan-300' : 'text-slate-200'}`}>
                  {s.current && '▸ '}{s.name}
                </span>
                <span className="text-[10px] text-slate-500">{time}</span>
              </div>
              <div className="flex items-center justify-between mt-0.5">
                <span className="text-[10px] text-slate-500 truncate max-w-[70%]">
                  {s.lastPreview ?? '(未开始)'}
                </span>
                <span className="text-[10px] text-slate-600">{s.messageCount} 轮</span>
              </div>
            </button>
          );
        })
      )}
    </div>
  );
}
