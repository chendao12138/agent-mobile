import { useEffect } from 'react';

interface Action {
  label: string;
  icon?: string;
  action: () => void;
  danger?: boolean;
}

interface ActionSheetProps {
  visible: boolean;
  title?: string;
  actions: Action[];
  onClose: () => void;
}

export default function ActionSheet({ visible, title, actions, onClose }: ActionSheetProps) {
  useEffect(() => {
    if (visible) {
      const handle = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
      document.addEventListener('keydown', handle);
      return () => document.removeEventListener('keydown', handle);
    }
  }, [visible, onClose]);

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={onClose}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" />

      {/* Sheet */}
      <div className="relative w-full max-w-lg bg-slate-850 rounded-t-2xl pb-safe animate-slide-up">
        {title && (
          <div className="px-4 pt-4 pb-2 text-xs text-slate-400 text-center">{title}</div>
        )}

        {actions.map((a, i) => (
          <button
            key={i}
            onClick={(e) => {
              e.stopPropagation();
              a.action();
              onClose();
            }}
            className={`w-full px-4 py-3 text-center text-sm active:bg-slate-700 transition-colors border-b border-slate-800 ${
              a.danger ? 'text-red-400' : 'text-slate-200'
            } ${i === actions.length - 1 ? 'border-b-0' : ''}`}
          >
            {a.icon && <span className="mr-2">{a.icon}</span>}
            {a.label}
          </button>
        ))}

        <button
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          className="w-full px-4 py-3 text-center text-sm text-slate-400 active:bg-slate-700 transition-colors border-t border-slate-700 mt-1 font-medium"
        >
          取消
        </button>
      </div>
    </div>
  );
}
