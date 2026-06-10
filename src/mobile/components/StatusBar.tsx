interface StatusBarProps {
  cwd: string;
  sessionName: string;
  mode: string;
  connected?: boolean;
}

export default function StatusBar({ cwd, sessionName, mode, connected }: StatusBarProps) {
  const shortCwd = cwd.replace(/^\/Users\/[^/]+/, '~');
  return (
    <header className="px-3 py-2 border-b border-slate-700 bg-slate-850 flex items-center gap-2 text-xs shrink-0">
      <span className={`w-2 h-2 rounded-full shrink-0 ${connected ? 'bg-emerald-400' : 'bg-red-400'}`} />
      <span className="text-slate-400 truncate flex-1" title={cwd}>
        📁 {shortCwd}
      </span>
      <span className="text-cyan-400 shrink-0">💬 {sessionName}</span>
      <span className="text-emerald-400 shrink-0">{mode}</span>
    </header>
  );
}
