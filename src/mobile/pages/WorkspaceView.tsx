import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useState, useEffect, useCallback, useRef } from 'react';
import ChatView, { type HistoryMessage } from '../components/ChatView';
import PromptInput, { type PendingAttachment } from '../components/PromptInput';
import { useWebSocket } from '../hooks/useWebSocket';
import { apiFetch } from '../lib/auth';
import type { RunState } from '../../core/run-state';

interface SessionInfo {
  id: string;
  name: string;
  cwd: string;
  messageCount: number;
  updatedAt: number;
}

interface WorkspaceInfo {
  name: string;
  cwd: string;
  sessions: SessionInfo[];
}

const MAX_ATTACHMENT_FILE_BYTES = 20 * 1024 * 1024;
const MAX_SESSION_ATTACHMENT_BYTES = 100 * 1024 * 1024;

export default function WorkspaceView() {
  const { name: wsNameParam } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as { sessionId?: string; workspaceName?: string; forkFrom?: string } | null;

  // forkFrom is consumed once — after the first prompt creates the new session,
  // subsequent prompts must NOT re-fork, or they would keep branching instead
  // of continuing the existing conversation.
  const forkFromRef = useRef<string | undefined>(state?.forkFrom);

  const wsName = decodeURIComponent(wsNameParam ?? state?.workspaceName ?? '');
  const [sessionId, setSessionId] = useState(state?.sessionId ?? 'new');
  const [sessionName, setSessionName] = useState('');
  const [messages, setMessages] = useState<HistoryMessage[]>([]);
  const [streamState, setStreamState] = useState<RunState | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const MODELS = ['sonnet', 'opus', 'haiku'];
  const MODES = ['plan', 'auto', 'bypass'];
  const [mode, setMode] = useState(() => localStorage.getItem('cli_mobile_mode') ?? 'bypass');
  const [model, setModel] = useState(() => localStorage.getItem('cli_mobile_model') ?? 'sonnet');
  const [toast, setToast] = useState<string | null>(null);
  const [currentWs, setCurrentWs] = useState<WorkspaceInfo | null>(null);
  const [showSessionNav, setShowSessionNav] = useState(false);
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);

  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;
  const wsNameRef = useRef(wsName);
  wsNameRef.current = wsName;

  const { connected, send, onStream, onCommandResult, onTreeUpdated } = useWebSocket();

  useEffect(() => {
    apiFetch('/api/tree')
      .then((r) => r.json())
      .then((data: { workspaces: WorkspaceInfo[] }) => {
        const ws = data.workspaces.find((w) => w.name === wsName);
        if (ws) { setCurrentWs(ws); const s = ws.sessions.find((s) => s.id === sessionId); if (s) setSessionName(s.name); }
      })
      .catch(() => {});
  }, [wsName, sessionId]);

  useEffect(() => {
    setAttachments([]);
    if (!sessionId || sessionId === 'new') { setMessages([]); setStreamState(null); return; }
    apiFetch(`/api/sessions/${sessionId}/history`)
      .then((r) => r.json())
      .then((data: { messages: Array<{ role: string; content: string; timestamp: string; blocks?: HistoryMessage['blocks'] }> }) => {
        if (data.messages?.length > 0) { setMessages(data.messages); setStreamState(null); }
      })
      .catch(() => {});
  }, [sessionId]);

  useEffect(() => {
    const unsub = onStream((state, wsn, sid) => {
      if (wsn !== wsNameRef.current || sid !== sessionIdRef.current) return;
      setStreamState({ ...state });
      setIsRunning(state.terminal === 'running');
    });
    return unsub;
  }, [onStream]);

  useEffect(() => {
    const unsub = onTreeUpdated(({ workspace: updatedWs, newSessionId }) => {
      if (updatedWs !== wsNameRef.current) return;
      apiFetch('/api/tree')
        .then((r) => r.json())
        .then((data: { workspaces: WorkspaceInfo[] }) => {
          const ws = data.workspaces.find((w) => w.name === wsNameRef.current);
          if (ws) {
            setCurrentWs(ws);
            if (newSessionId) {
              const s = ws.sessions.find((s) => s.id === newSessionId);
              if (s) setSessionName(s.name);
              setSessionId(newSessionId);
            }
          }
        })
        .catch(() => {});
    });
    return unsub;
  }, [onTreeUpdated]);

  useEffect(() => {
    const unsub = onCommandResult(({ result }) => { setToast(result.message); setTimeout(() => setToast(null), 4000); });
    return unsub;
  }, [onCommandResult]);

  const showToast = useCallback((message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 4000);
  }, []);

  const handleSend = useCallback((text: string) => {
    if (!connected) return;
    if (text.startsWith('/')) {
      send({ type: 'command', text, workspace: wsName, sessionId });
    } else {
      const attachmentIds = attachments.filter((a) => !a.uploading).map((a) => a.id);
      const displayText = text || (attachmentIds.length > 0 ? '请查看并处理这些附件。' : '');
      setMessages((prev) => [...prev, { role: 'user', content: displayText, timestamp: new Date().toISOString() }]);
      setStreamState(null);
      // Consume forkFrom once — clear after first use so subsequent prompts
      // continue the new session rather than forking again.
      const currentForkFrom = forkFromRef.current;
      if (currentForkFrom) forkFromRef.current = undefined;
      send({ type: 'prompt', text, workspace: wsName, sessionId, attachmentIds, mode, model, ...(currentForkFrom ? { forkFrom: currentForkFrom } : {}) });
      setAttachments([]);
    }
  }, [attachments, connected, send, wsName, sessionId, mode, model]);

  const handleStop = useCallback(() => { send({ type: 'stop', workspace: wsName, sessionId }); setIsRunning(false); }, [send, wsName, sessionId]);
  const sessionLabel = (s: SessionInfo) => s.name || s.id.slice(0, 8);

  const handleAttachFiles = useCallback((files: FileList) => {
    if (sessionId === 'new') {
      showToast('附件只能添加到已有会话');
      return;
    }

    const selected = Array.from(files);
    const oversized = selected.find((file) => file.size > MAX_ATTACHMENT_FILE_BYTES);
    if (oversized) {
      showToast(`${oversized.name} 超过 20MB`);
      return;
    }

    const pendingBytes = attachments.reduce((sum, a) => sum + a.size, 0);
    const selectedBytes = selected.reduce((sum, file) => sum + file.size, 0);
    if (pendingBytes + selectedBytes > MAX_SESSION_ATTACHMENT_BYTES) {
      showToast('本次待发送附件不能超过 100MB');
      return;
    }

    selected.forEach((file) => {
      const tempId = createTempAttachmentId();
      setAttachments((prev) => [...prev, {
        id: tempId,
        name: file.name,
        size: file.size,
        category: categoryFromFile(file),
        uploading: true,
      }]);

      const form = new FormData();
      form.append('workspace', wsName);
      form.append('sessionId', sessionId);
      form.append('file', file);

      apiFetch('/api/attachments', {
        method: 'POST',
        body: form,
      })
        .then(async (res) => {
          const data = await res.json();
          if (!res.ok || !data.ok) {
            throw new Error(data.error || '附件上传失败');
          }
          const a = data.attachment as PendingAttachment;
          setAttachments((prev) => prev.map((item) => item.id === tempId ? { ...a, uploading: false } : item));
        })
        .catch((err) => {
          setAttachments((prev) => prev.filter((item) => item.id !== tempId));
          showToast(err instanceof Error ? err.message : '附件上传失败');
        });
    });
  }, [attachments, sessionId, showToast, wsName]);

  const handleRemoveAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
    if (id.startsWith('upload_') || sessionId === 'new') return;
    void apiFetch(`/api/attachments/${encodeURIComponent(id)}?workspace=${encodeURIComponent(wsName)}&sessionId=${encodeURIComponent(sessionId)}`, {
      method: 'DELETE',
    });
  }, [sessionId, wsName]);

  return (
    <div className="h-full flex flex-col">
      <header className="px-3 py-2 border-b border-slate-700 bg-slate-850 flex items-center gap-2 shrink-0">
        <button onClick={() => navigate('/')} className="text-slate-400 active:text-slate-200 text-lg shrink-0">←</button>
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${connected ? 'bg-emerald-400' : 'bg-red-400'}`} />
        {/* New session button */}
        <button
          onClick={() => { setMessages([]); setStreamState(null); setAttachments([]); setSessionId('new'); setSessionName(''); }}
          className="text-slate-400 active:text-slate-200 shrink-0"
          title="新建会话"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            <line x1="12" y1="8" x2="12" y2="14"/>
            <line x1="9" y1="11" x2="15" y2="11"/>
          </svg>
        </button>
        {/* Centered workspace name */}
        <div className="flex-1 text-center">
          <span className="text-sm font-medium text-slate-200">📁 {wsName}</span>
        </div>
        {/* Session switcher */}
        <button onClick={() => setShowSessionNav(!showSessionNav)} className={`text-xs px-2 py-1 rounded border shrink-0 ${showSessionNav ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300' : 'border-slate-700 text-slate-400'}`}>
          💬 {sessionName || sessionId.slice(0, 8)}
        </button>
      </header>

      {showSessionNav && currentWs && (
        <div className="border-b border-slate-700 bg-slate-850 max-h-48 overflow-auto">
          {currentWs.sessions.map((s) => (
            <button key={s.id} onClick={() => { setSessionId(s.id); setSessionName(s.name); setShowSessionNav(false); }}
              className={`w-full flex items-center gap-2 px-4 py-2 text-left text-sm active:bg-slate-700 ${s.id === sessionId ? 'bg-cyan-500/10 border-l-2 border-l-cyan-400' : ''}`}>
              <span className="text-slate-400 text-xs w-4">{s.id === sessionId ? '▸' : ''}</span>
              <span className={s.id === sessionId ? 'text-cyan-300 truncate' : 'text-slate-300 truncate'}>{sessionLabel(s)}</span>
              <span className="text-[10px] text-slate-500 ml-auto">{s.messageCount}轮</span>
            </button>
          ))}
        </div>
      )}

      {toast && <div className="mx-3 mt-2 p-2 rounded-lg bg-slate-800 border border-slate-700 text-xs text-slate-300">{toast}</div>}

      <div className="flex-1 overflow-auto p-3 terminal-scroll">
        <ChatView messages={messages} streamState={streamState} isRunning={isRunning} />
      </div>

      <PromptInput
        onSend={handleSend}
        onStop={handleStop}
        isRunning={isRunning}
        mode={mode}
        onToggleMode={() => setMode((m) => {
          const next = MODES[(MODES.indexOf(m) + 1) % MODES.length]!;
          localStorage.setItem('cli_mobile_mode', next);
          return next;
        })}
        model={model}
        onToggleModel={() => setModel((m) => {
          const next = MODELS[(MODELS.indexOf(m) + 1) % MODELS.length]!;
          localStorage.setItem('cli_mobile_model', next);
          return next;
        })}
        attachments={attachments}
        canAttach={sessionId !== 'new'}
        onAttachFiles={handleAttachFiles}
        onRemoveAttachment={handleRemoveAttachment}
        onAttachUnavailable={() => showToast('请选择已有会话后再添加附件')}
      />
    </div>
  );
}

function categoryFromFile(file: File): string {
  const type = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  if (type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (name.endsWith('.doc') || name.endsWith('.docx')) return 'word';
  if (name.endsWith('.ppt') || name.endsWith('.pptx')) return 'ppt';
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('video/')) return 'video';
  return 'txt';
}

function createTempAttachmentId(): string {
  if (globalThis.crypto?.randomUUID) {
    return `upload_${globalThis.crypto.randomUUID()}`;
  }
  return `upload_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}
