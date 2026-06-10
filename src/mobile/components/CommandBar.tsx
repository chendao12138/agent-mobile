interface CommandBarProps {
  onCommand?: (cmd: string) => void;
}

const QUICK_COMMANDS = [
  { cmd: '/new', label: '新建会话' },
  { cmd: '/resume', label: '历史' },
  { cmd: '/stop', label: '终止' },
  { cmd: '/status', label: '状态' },
  { cmd: '/help', label: '帮助' },
];

export default function CommandBar({ onCommand }: CommandBarProps) {
  return (
    <div className="px-2 py-1.5 border-t border-slate-700 flex gap-1 overflow-x-auto shrink-0">
      {QUICK_COMMANDS.map(({ cmd, label }) => (
        <button
          key={cmd}
          onClick={() => onCommand?.(cmd)}
          className="shrink-0 px-2.5 py-1 rounded-full bg-slate-800 border border-slate-700 text-[11px] text-slate-400 active:bg-slate-700 transition-colors"
        >
          {label}
        </button>
      ))}
    </div>
  );
}
