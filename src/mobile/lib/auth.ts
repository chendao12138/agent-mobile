// Device token management + authenticated API wrapper

const TOKEN_KEY = 'cli_mobile_device_token';

/**
 * Get the stored device token.
 * Priority: URL query param > localStorage
 * If found in URL, persists to localStorage and cleans URL.
 */
export function getDeviceToken(): string | null {
  // Check URL query param (for QR code scan flow)
  try {
    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get('token');
    if (urlToken && urlToken.length >= 32) {
      setDeviceToken(urlToken);
      // Clean URL to avoid leaking token in browser history
      const url = new URL(window.location.href);
      url.searchParams.delete('token');
      window.history.replaceState({}, '', url.toString());
      return urlToken;
    }
  } catch { /* ignore */ }

  return localStorage.getItem(TOKEN_KEY);
}

/**
 * Get the pair token from URL (for initial pairing, not device token).
 */
export function getPairToken(): string | null {
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get('pair');
  } catch {
    return null;
  }
}

export function setDeviceToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearDeviceToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

/**
 * Detect a human-readable device name from the user agent.
 */
export function getDeviceName(): string {
  const ua = navigator.userAgent;
  // Mobile Safari
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android.*Mobile/.test(ua)) {
    const match = ua.match(/Android.*;\s*(.+?)\s*(?:Build|\))/);
    return match ? match[1]!.trim() : 'Android Phone';
  }
  if (/Android/.test(ua)) return 'Android Tablet';
  // Desktop
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows PC';
  if (/Linux/.test(ua)) return 'Linux';
  // Fallback
  return ua.slice(0, 30) || 'Unknown Device';
}

/**
 * Fetch wrapper that attaches device token Bearer header.
 * Falls back to unauthenticated fetch if no token (for /api/pair, /api/health).
 */
export async function apiFetch(url: string, opts?: RequestInit): Promise<Response> {
  const token = getDeviceToken();
  const headers = new Headers(opts?.headers);

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  return fetch(url, {
    ...opts,
    headers,
  });
}
