import { useEffect, useRef, useState, useCallback } from 'react';
import type { RunState } from '../../core/run-state';
import { getDeviceToken } from '../lib/auth';

interface WsMessage {
  type: string;
  workspace: string;
  sessionId: string;
  state?: RunState;
  command?: string;
  result?: { ok: boolean; message: string; data?: unknown };
  message?: string;
}

interface UseWebSocketReturn {
  connected: boolean;
  send: (msg: unknown) => void;
  onStream: (cb: (state: RunState, workspace: string, sessionId: string) => void) => () => void;
  onCommandResult: (cb: (data: { command: string; result: { ok: boolean; message: string; data?: unknown } }) => void) => () => void;
  onError: (cb: (error: { workspace: string; sessionId: string; message: string }) => void) => () => void;
  onTreeUpdated: (cb: (data: { workspace: string; newSessionId?: string }) => void) => () => void;
}

const WS_URL = `ws://${window.location.host}/ws`;

export function useWebSocket(): UseWebSocketReturn {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const streamCallbacks = useRef<Set<(state: RunState, workspace: string, sessionId: string) => void>>(new Set());
  const commandResultCallbacks = useRef<Set<(data: { command: string; result: { ok: boolean; message: string; data?: unknown } }) => void>>(new Set());
  const errorCallbacks = useRef<Set<(error: { workspace: string; sessionId: string; message: string }) => void>>(new Set());
  const treeUpdatedCallbacks = useRef<Set<(data: { workspace: string; newSessionId?: string }) => void>>(new Set());

  const send = useCallback((msg: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  useEffect(() => {
    let pingTimer: ReturnType<typeof setInterval>;
    let reconnectTimer: ReturnType<typeof setTimeout>;
    let mounted = true;

    function getWsUrl(): string {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const token = getDeviceToken();
      const base = `${protocol}//${window.location.host}/ws`;
      return token ? `${base}?token=${encodeURIComponent(token)}` : base;
    }

    function connect() {
      if (!mounted) return;
      const ws = new WebSocket(getWsUrl());
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mounted) return;
        setConnected(true);
        pingTimer = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
          }
        }, 25000);
      };

      ws.onmessage = (evt) => {
        if (!mounted) return;
        let msg: WsMessage;
        try { msg = JSON.parse(evt.data); } catch { return; }
        switch (msg.type) {
          case 'stream':
            if (msg.state) streamCallbacks.current.forEach((cb) => cb(msg.state!, msg.workspace, msg.sessionId));
            break;
          case 'command_result':
            if (msg.command && msg.result) commandResultCallbacks.current.forEach((cb) => cb({ command: msg.command!, result: msg.result! }));
            break;
          case 'error':
            errorCallbacks.current.forEach((cb) => cb({ workspace: msg.workspace, sessionId: msg.sessionId, message: msg.message ?? 'Unknown error' }));
            break;
          case 'tree_updated':
            treeUpdatedCallbacks.current.forEach((cb) => cb({ workspace: msg.workspace, newSessionId: (msg as { newSessionId?: string }).newSessionId }));
            break;
        }
      };

      ws.onclose = () => {
        if (!mounted) return;
        setConnected(false);
        clearInterval(pingTimer);
        reconnectTimer = setTimeout(connect, 3000);
      };

      ws.onerror = () => {};
    }

    connect();

    return () => {
      mounted = false;
      clearInterval(pingTimer);
      clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, []);

  const onStream = useCallback((cb: (state: RunState, workspace: string, sessionId: string) => void) => {
    streamCallbacks.current.add(cb);
    return () => { streamCallbacks.current.delete(cb); };
  }, []);

  const onCommandResult = useCallback((cb: (data: { command: string; result: { ok: boolean; message: string; data?: unknown } }) => void) => {
    commandResultCallbacks.current.add(cb);
    return () => { commandResultCallbacks.current.delete(cb); };
  }, []);

  const onError = useCallback((cb: (error: { workspace: string; sessionId: string; message: string }) => void) => {
    errorCallbacks.current.add(cb);
    return () => { errorCallbacks.current.delete(cb); };
  }, []);

  const onTreeUpdated = useCallback((cb: (data: { workspace: string; newSessionId?: string }) => void) => {
    treeUpdatedCallbacks.current.add(cb);
    return () => { treeUpdatedCallbacks.current.delete(cb); };
  }, []);

  return { connected, send, onStream, onCommandResult, onError, onTreeUpdated };
}
