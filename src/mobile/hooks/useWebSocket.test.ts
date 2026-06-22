import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { RunState } from '../../core/run-state';

// We need to test the useWebSocket hook, which creates a real WebSocket.
// We'll mock the global WebSocket constructor.

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static reset() { this.instances = []; }

  url: string;
  readyState: number;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((evt: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];

  constructor(url: string) {
    this.url = url;
    this.readyState = 0; // CONNECTING
    MockWebSocket.instances.push(this);
  }

  send(data: string) { this.sent.push(data); }
  close() { this.readyState = 3; this.onclose?.(); }

  static get OPEN() { return 1; }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).WebSocket = MockWebSocket;

// Mock the auth module since useWebSocket imports getDeviceToken
vi.mock('../lib/auth', () => ({
  getDeviceToken: vi.fn().mockReturnValue('test-device-token-32chars-long-xxx'),
}));

// Mock the React useState/useRef/useEffect in the hook
import { useWebSocket } from '../hooks/useWebSocket';

describe('useWebSocket', () => {
  beforeEach(() => {
    MockWebSocket.reset();
    vi.useFakeTimers();
    // Replace the global URL constructor behavior
    vi.stubGlobal('location', {
      ...window.location,
      protocol: 'http:',
      host: 'localhost:3009',
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('connects with token in URL', () => {
    const { result } = renderHook(() => useWebSocket());

    expect(MockWebSocket.instances).toHaveLength(1);
    const ws = MockWebSocket.instances[0]!;
    expect(ws.url).toContain('ws://localhost:3009/ws');
    expect(ws.url).toContain('token=test-device-token-32chars-long-xxx');
  });

  it('sets connected=true onopen', () => {
    const { result } = renderHook(() => useWebSocket());

    const ws = MockWebSocket.instances[0]!;
    act(() => { ws.onopen?.(); });

    expect(result.current.connected).toBe(true);
  });

  it('dispatches stream callbacks', () => {
    const { result } = renderHook(() => useWebSocket());
    const onStream = vi.fn();

    act(() => { result.current.onStream(onStream); });
    const ws = MockWebSocket.instances[0]!;
    const mockState: RunState = {
      blocks: [],
      reasoning: { content: '', active: false },
      footer: null,
      terminal: 'running',
    };

    act(() => {
      ws.onmessage?.({
        data: JSON.stringify({
          type: 'stream',
          workspace: 'test-ws',
          sessionId: 'sid1',
          state: mockState,
        }),
      });
    });

    expect(onStream).toHaveBeenCalledWith(mockState, 'test-ws', 'sid1');
  });

  it('sets connected=false and retries on close', () => {
    const { result } = renderHook(() => useWebSocket());

    const ws = MockWebSocket.instances[0]!;
    act(() => { ws.onopen?.(); });
    expect(result.current.connected).toBe(true);

    act(() => { ws.onclose?.(); });
    expect(result.current.connected).toBe(false);

    // After 3 seconds, a new connection attempt should be made
    act(() => { vi.advanceTimersByTime(3000); });
    expect(MockWebSocket.instances.length).toBeGreaterThan(1);
  });

  it('sends ping every 25 seconds when connected', () => {
    renderHook(() => useWebSocket());

    const ws = MockWebSocket.instances[0]!;
    act(() => { ws.readyState = MockWebSocket.OPEN; });
    act(() => { ws.onopen?.(); });

    act(() => { vi.advanceTimersByTime(25000); });

    expect(ws.sent).toContain(JSON.stringify({ type: 'ping' }));
  });
});
