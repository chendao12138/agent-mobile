import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import jsQR from 'jsqr';
import { getDeviceToken, setDeviceToken, clearDeviceToken, getPairToken, getDeviceName, apiFetch } from '../lib/auth';

interface AuthGateProps {
  children: ReactNode;
}

type AuthState = 'loading' | 'unpaired' | 'authenticated';

interface BarcodeDetectorCtor {
  new (options?: { formats?: string[] }): {
    detect(source: HTMLVideoElement): Promise<Array<{ rawValue?: string }>>;
  };
}

export default function AuthGate({ children }: AuthGateProps) {
  const [state, setState] = useState<AuthState>('loading');
  const [pairCode, setPairCode] = useState('');
  const [deviceName] = useState(getDeviceName);
  const [error, setError] = useState('');
  const [pairing, setPairing] = useState(false);
  const [scanning, setScanning] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameRef = useRef<number | null>(null);

  // Auto-fill pair token from URL
  useEffect(() => {
    const urlPair = getPairToken();
    if (urlPair) setPairCode(urlPair.toUpperCase());
  }, []);

  // Check existing token on mount
  useEffect(() => {
    const token = getDeviceToken();
    if (!token) {
      setState('unpaired');
      return;
    }
    // Validate existing token against an auth-required endpoint
    apiFetch('/api/tree')
      .then((r) => {
        if (r.ok) {
          setState('authenticated');
        } else {
          clearDeviceToken();
          setState('unpaired');
        }
      })
      .catch(() => {
        // Server might not be reachable yet — keep token but show unpaired
        // The user can retry or re-pair
        setState('unpaired');
      });
  }, []);

  const stopScanner = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setScanning(false);
  }, []);

  const pairWithCode = useCallback(async (rawCode: string) => {
    const code = rawCode.trim().toUpperCase();
    if (code.length < 4) {
      setError('请输入完整配对码');
      return;
    }

    setPairing(true);
    setError('');

    try {
      const res = await apiFetch('/api/pair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pairToken: code, deviceName }),
      });
      const data = await res.json();

      if (data.ok && data.deviceToken) {
        setDeviceToken(data.deviceToken);
        setState('authenticated');
      } else {
        setError(data.error || '配对失败，请检查配对码');
      }
    } catch {
      setError('无法连接服务器，请检查网络');
    } finally {
      setPairing(false);
    }
  }, [deviceName]);

  const handlePair = useCallback(async () => {
    await pairWithCode(pairCode);
  }, [pairCode, pairWithCode]);

  useEffect(() => {
    if (!scanning) return;

    let cancelled = false;

    async function startCameraScan(): Promise<void> {
      const detectorCtor = (window as Window & { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('当前浏览器无法调用相机');
        setScanning(false);
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;

        video.srcObject = stream;
        await video.play();

        const detector = detectorCtor ? new detectorCtor({ formats: ['qr_code'] }) : null;
        const scan = async (): Promise<void> => {
          if (cancelled || !videoRef.current) return;
          let code: string | null = null;

          try {
            if (detector) {
              const codes = await detector.detect(videoRef.current);
              code = extractPairCode(codes[0]?.rawValue ?? '');
            }
          } catch {
            // Keep scanning; camera frames can briefly fail while focusing.
          }

          if (!code) {
            code = decodeQrFromVideo(videoRef.current, canvasRef.current);
          }

          if (code) {
            setPairCode(code);
            stopScanner();
            void pairWithCode(code);
            return;
          }

          frameRef.current = requestAnimationFrame(() => { void scan(); });
        };

        frameRef.current = requestAnimationFrame(() => { void scan(); });
      } catch {
        setError('无法打开相机，请检查浏览器相机权限');
        setScanning(false);
      }
    }

    void startCameraScan();

    return () => {
      cancelled = true;
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, [pairWithCode, scanning, stopScanner]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handlePair();
  }, [handlePair]);

  const handlePairCodeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    // Auto-uppercase, max 6 chars, alphanumeric only
    const cleaned = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    setPairCode(cleaned);
  }, []);

  // ── Loading ──
  if (state === 'loading') {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin w-8 h-8 border-2 border-cyan-400 border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-slate-400 text-sm">验证设备凭证…</p>
        </div>
      </div>
    );
  }

  // ── Authenticated ──
  if (state === 'authenticated') {
    return <>{children}</>;
  }

  // ── Unpaired: pairing screen ──
  return (
    <div className="h-full flex items-center justify-center px-6">
      <div className="w-full max-w-sm text-center">
        {/* Icon */}
        <div className="text-5xl mb-4">📱</div>
        <h1 className="text-xl font-semibold text-slate-100 mb-1">CLI Mobile</h1>
        <p className="text-sm text-slate-400 mb-6">
          请在终端查看配对码并输入下方
        </p>

        {/* Device name */}
        <div className="text-xs text-slate-500 mb-4">
          设备: <span className="text-slate-300">{deviceName}</span>
        </div>

        {/* Pair code input */}
        <div className="mb-3">
          <input
            autoFocus
            type="text"
            inputMode="text"
            autoComplete="off"
            autoCapitalize="characters"
            value={pairCode}
            onChange={handlePairCodeChange}
            onKeyDown={handleKeyDown}
            placeholder="输入6位配对码"
            maxLength={6}
            className="w-full text-center text-2xl tracking-[0.3em] font-mono rounded-xl bg-slate-800 border border-slate-600 px-4 py-3 text-cyan-300 placeholder-slate-600 focus:outline-none focus:border-cyan-500"
          />
        </div>

        {/* Error */}
        {error && (
          <p className="text-red-400 text-xs mb-3">{error}</p>
        )}

        <div className="flex gap-2 mb-4">
          <button
            onClick={() => { setError(''); setScanning(true); }}
            disabled={pairing || scanning}
            className="w-24 py-3 rounded-xl bg-slate-800 border border-slate-600 text-slate-200 font-semibold text-sm active:bg-slate-700 disabled:opacity-40 transition-colors"
          >
            扫码
          </button>
          <button
            onClick={handlePair}
            disabled={pairing || pairCode.length < 4}
            className="flex-1 py-3 rounded-xl bg-cyan-600 text-white font-semibold text-sm active:bg-cyan-500 disabled:opacity-40 transition-colors"
          >
            {pairing ? '连接中…' : '连接'}
          </button>
        </div>

        {scanning && (
          <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-slate-950/95 px-6">
            <div className="w-full max-w-sm">
              <div className="relative overflow-hidden rounded-2xl border border-cyan-500/50 bg-black aspect-square">
                <video ref={videoRef} className="h-full w-full object-cover" playsInline muted />
                <canvas ref={canvasRef} className="hidden" />
                <div className="absolute inset-8 rounded-xl border-2 border-cyan-400/80" />
              </div>
              <p className="mt-4 text-center text-sm text-slate-300">对准终端里的二维码</p>
              <button
                onClick={stopScanner}
                className="mt-4 w-full py-3 rounded-xl bg-slate-800 border border-slate-600 text-slate-200 text-sm font-semibold active:bg-slate-700"
              >
                取消
              </button>
            </div>
          </div>
        )}

        {/* Help text */}
        <p className="text-[10px] text-slate-600 leading-relaxed">
          在运行 cli-mobile 的终端中找到 6 位配对码，<br />
          或扫描终端中的二维码自动填入
        </p>
      </div>
    </div>
  );
}

function extractPairCode(rawValue: string): string | null {
  if (!rawValue) return null;

  try {
    const url = new URL(rawValue);
    const pair = url.searchParams.get('pair');
    if (pair) return cleanPairCode(pair);
  } catch {
    // Not a URL; fall through to plain token parsing.
  }

  const pairMatch = rawValue.match(/[?&]pair=([A-Z0-9]+)/i);
  if (pairMatch?.[1]) return cleanPairCode(pairMatch[1]);

  return cleanPairCode(rawValue);
}

function cleanPairCode(value: string): string | null {
  const cleaned = value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  return cleaned.length >= 4 ? cleaned : null;
}

function decodeQrFromVideo(video: HTMLVideoElement, canvas: HTMLCanvasElement | null): string | null {
  if (!canvas || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth || !video.videoHeight) {
    return null;
  }

  const maxSize = 640;
  const scale = Math.min(1, maxSize / Math.max(video.videoWidth, video.videoHeight));
  const width = Math.max(1, Math.floor(video.videoWidth * scale));
  const height = Math.max(1, Math.floor(video.videoHeight * scale));
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  ctx.drawImage(video, 0, 0, width, height);
  const imageData = ctx.getImageData(0, 0, width, height);
  const result = jsQR(imageData.data, width, height, { inversionAttempts: 'dontInvert' });
  return extractPairCode(result?.data ?? '');
}
