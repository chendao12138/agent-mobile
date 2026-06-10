import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import SwipeableRow from '../components/SwipeableRow';
import ActionSheet from '../components/ActionSheet';
import { apiFetch, getDeviceToken } from '../lib/auth';

interface SessionInfo {
  id: string;
  name: string;
  cwd: string;
  startedAt: number;
  updatedAt: number;
  messageCount: number;
  archived: boolean;
  pinned: boolean;
}

interface WorkspaceInfo {
  name: string;
  cwd: string;
  sessions: SessionInfo[];
}

export default function WorkspaceList() {
  const navigate = useNavigate();
  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [wsConnected, setWsConnected] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [actionSheet, setActionSheet] = useState<{ session: SessionInfo; ws: WorkspaceInfo } | null>(null);
  const [renaming, setRenaming] = useState<SessionInfo | null>(null);
  const [renameText, setRenameText] = useState('');
  const [branching, setBranching] = useState<string | null>(null); // sessionId being forked

  const loadTree = useCallback(() => {
    apiFetch('/api/tree')
      .then((r) => r.json())
      .then((data: { workspaces: WorkspaceInfo[] }) => {
        setWorkspaces(data.workspaces);
        if (data.workspaces.length > 0) {
          setExpanded((prev) => {
            if (prev.size === 0) {
              const next = new Set<string>();
              next.add(data.workspaces[0]!.name);
              return next;
            }
            return prev;
          });
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => { loadTree(); }, [loadTree]);

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const token = getDeviceToken();
    const wsUrl = token
      ? `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(token)}`
      : `${protocol}//${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);
    ws.onopen = () => setWsConnected(true);
    ws.onclose = () => setWsConnected(false);
    // Listen for tree updates
    ws.onmessage = (evt) => {
      try { const m = JSON.parse(evt.data); if (m.type === 'tree_updated') loadTree(); } catch { /* */ }
    };
    return () => ws.close();
  }, [loadTree]);

  const toggleExpand = (wsName: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(wsName)) next.delete(wsName);
      else next.add(wsName);
      return next;
    });
  };

  const formatTime = (ts: number) => {
    if (!ts) return '';
    return new Date(ts).toLocaleString('zh-CN', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });
  };

  const sessionLabel = (s: SessionInfo) => s.name || s.id.slice(0, 8);

  const apiCall = async (url: string, method = 'PATCH') => {
    try { await apiFetch(url, { method }); loadTree(); } catch { /* */ }
  };

  const handleArchive = (s: SessionInfo) => apiCall(`/api/sessions/${s.id}/archive`);
  const handleRestore = (s: SessionInfo) => apiCall(`/api/sessions/${s.id}/restore`);
  const handlePin = (s: SessionInfo) => apiCall(`/api/sessions/${s.id}/pin`);

  const handleRename = async () => {
    if (!renaming || !renameText.trim()) { setRenaming(null); return; }
    await apiFetch(`/api/sessions/${renaming.id}/name`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: renameText.trim() }),
    });
    setRenaming(null);
    loadTree();
  };

  const handleBranch = async (s: SessionInfo, ws: WorkspaceInfo) => {
    setBranching(s.id);
    try {
      const res = await apiFetch(`/api/sessions/${s.id}/branch`, { method: 'POST' });
      const data = await res.json();
      if (data.ok && data.newSessionId) {
        navigate(`/workspace/${encodeURIComponent(ws.name)}`, {
          state: { sessionId: data.newSessionId, workspaceName: ws.name },
        });
      } else {
        alert(data.message || '分支创建失败');
      }
    } catch {
      alert('分支创建失败：网络错误');
    } finally {
      setBranching(null);
    }
  };

  // Filter sessions
  const filterSessions = (sessions: SessionInfo[]) => {
    const filtered = sessions.filter((s) => showArchived ? s.archived : !s.archived);
    // Sort: pinned first, then by updatedAt desc
    return filtered.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.updatedAt - a.updatedAt;
    });
  };

  return (
    <div className="h-full flex flex-col">
      <header className="px-4 py-3 border-b border-slate-700 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold"><span className="text-cyan-400 font-mono">&gt;_</span> CLI Mobile</h1>
          <p className="text-xs text-slate-400">工作区</p>
        </div>
        <span className={`w-2 h-2 rounded-full ${wsConnected ? 'bg-emerald-400' : 'bg-red-400'}`} />
      </header>

      {/* Archive toggle */}
      <div className="flex border-b border-slate-700">
        <button
          onClick={() => setShowArchived(false)}
          className={`flex-1 py-2 text-xs font-medium transition-colors ${!showArchived ? 'text-cyan-400 border-b-2 border-cyan-400' : 'text-slate-500'}`}
        >活跃</button>
        <button
          onClick={() => setShowArchived(true)}
          className={`flex-1 py-2 text-xs font-medium transition-colors ${showArchived ? 'text-cyan-400 border-b-2 border-cyan-400' : 'text-slate-500'}`}
        >已归档</button>
      </div>

      <div className="flex-1 overflow-auto">
        {workspaces.length === 0 ? (
          <div className="p-4 text-center text-slate-500 text-sm">没有工作区</div>
        ) : (
          workspaces.map((ws) => {
            const isExpanded = expanded.has(ws.name);
            const visibleSessions = filterSessions(ws.sessions);
            if (visibleSessions.length === 0 && !isExpanded) return null;

            return (
              <div key={ws.name}>
                <button
                  onClick={() => toggleExpand(ws.name)}
                  className="w-full flex items-center gap-2 px-4 py-3 text-left active:bg-slate-800 transition-colors border-b border-slate-800"
                >
                  <span className="text-amber-400 text-sm">{isExpanded ? '⌵' : '>'}</span>
                  <span className="text-sm font-medium text-slate-200">📁 {ws.name}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/workspace/${encodeURIComponent(ws.name)}`, { state: { sessionId: 'new', workspaceName: ws.name } });
                    }}
                    className="ml-auto p-1 rounded active:bg-slate-700 text-slate-500 active:text-slate-300"
                    title="新建会话"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="18" rx="2"/><path d="M8 17L15 7l2 2-7 10H6v-2z"/></svg>
                  </button>
                  <span className="text-[10px] text-slate-500">{visibleSessions.length}个会话</span>
                </button>

                {isExpanded && visibleSessions.length === 0 && (
                  <div className="px-6 py-3 text-xs text-slate-600">暂无{showArchived ? '已归档' : ''}会话</div>
                )}

                {isExpanded && visibleSessions.map((s) => (
                  <SwipeableRow
                    key={s.id}
                    rightActions={
                      showArchived ? (
                        <button
                          onClick={() => handleRestore(s)}
                          className="h-full px-4 flex items-center justify-center bg-emerald-600 text-white text-xs font-medium"
                        >恢复</button>
                      ) : (
                        <button
                          onClick={() => handleArchive(s)}
                          className="h-full px-4 flex items-center justify-center bg-amber-600 text-white text-xs font-medium"
                        >📦 归档</button>
                      )
                    }
                    leftActions={
                      <div className="flex h-full w-full">
                        <button onClick={() => handleBranch(s, ws)} disabled={branching === s.id} className={`flex-1 h-full flex items-center justify-center text-[10px] font-medium ${branching === s.id ? 'bg-blue-800 text-blue-300' : 'bg-blue-600 text-white'}`}>🔀 分支</button>
                        <button onClick={() => { setRenaming(s); setRenameText(s.name || ''); }} className="flex-1 h-full flex items-center justify-center bg-purple-600 text-white text-[10px] font-medium">✏️ 重命名</button>
                        <button onClick={() => handlePin(s)} className="flex-1 h-full flex items-center justify-center bg-cyan-600 text-white text-[10px] font-medium">{s.pinned ? '📌 取消' : '📌 置顶'}</button>
                      </div>
                    }
                    onLongPress={() => setActionSheet({ session: s, ws })}
                    onClick={() => navigate(`/workspace/${encodeURIComponent(ws.name)}`, { state: { sessionId: s.id, workspaceName: ws.name } })}
                  >
                    <div className="flex items-center gap-2 px-6 py-2.5 text-left text-sm border-b border-slate-800/50">
                      <span className="text-slate-400 text-xs">▸</span>
                      {s.pinned && <span className="text-[10px]">📌</span>}
                      <span className="text-slate-300 truncate flex-1">{sessionLabel(s)}</span>
                      <span className="text-[10px] text-slate-500">{s.messageCount}轮</span>
                      <span className="text-[10px] text-slate-600 ml-1">{formatTime(s.updatedAt)}</span>
                    </div>
                  </SwipeableRow>
                ))}
              </div>
            );
          })
        )}
      </div>

      {/* Rename modal */}
      {renaming && (
        <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={() => setRenaming(null)}>
          <div className="absolute inset-0 bg-black/50" />
          <div className="relative w-full max-w-lg bg-slate-850 rounded-t-2xl p-4 pb-safe animate-slide-up" onClick={(e) => e.stopPropagation()}>
            <div className="text-xs text-slate-400 mb-2">重命名: {sessionLabel(renaming)}</div>
            <input
              autoFocus
              value={renameText}
              onChange={(e) => setRenameText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleRename(); }}
              placeholder="输入新名称"
              className="w-full rounded-lg bg-slate-800 border border-slate-600 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500"
            />
            <div className="flex gap-2 mt-3">
              <button onClick={() => setRenaming(null)} className="flex-1 py-2 rounded-lg bg-slate-700 text-sm text-slate-300 active:bg-slate-600">取消</button>
              <button onClick={handleRename} className="flex-1 py-2 rounded-lg bg-cyan-600 text-sm text-white active:bg-cyan-500">确认</button>
            </div>
          </div>
        </div>
      )}

      {/* ActionSheet for long press */}
      <ActionSheet
        visible={!!actionSheet}
        title={actionSheet?.session.name || actionSheet?.session.id.slice(0, 8)}
        onClose={() => setActionSheet(null)}
        actions={
          actionSheet ? [
            {
              label: showArchived ? '恢复' : '📦 归档',
              action: () => showArchived ? handleRestore(actionSheet.session) : handleArchive(actionSheet.session),
            },
            {
              label: branching === actionSheet.session.id ? '⏳ 正在创建分支…' : '🔀 创建分支',
              action: () => handleBranch(actionSheet.session, actionSheet.ws),
            },
            {
              label: '✏️ 重命名',
              action: () => { setRenaming(actionSheet.session); setRenameText(actionSheet.session.name || ''); },
            },
            {
              label: actionSheet.session.pinned ? '📌 取消置顶' : '📌 置顶',
              action: () => handlePin(actionSheet.session),
            },
          ] : []
        }
      />

      {/* Branch loading overlay */}
      {branching && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-slate-800 rounded-2xl px-6 py-5 text-center shadow-xl">
            <div className="animate-spin w-8 h-8 border-2 border-cyan-400 border-t-transparent rounded-full mx-auto mb-3" />
            <p className="text-sm text-slate-200">正在创建分支…</p>
            <p className="text-[10px] text-slate-500 mt-1">{branching.slice(0, 8)}</p>
          </div>
        </div>
      )}

      <div className="px-4 py-3 pb-safe border-t border-slate-700">
        <p className="text-[10px] text-slate-600 text-center">
          {wsConnected ? '🟢 已连接' : '🔴 未连接'} · 右划归档 · 左划更多 · 长按全部选项
        </p>
      </div>
    </div>
  );
}
