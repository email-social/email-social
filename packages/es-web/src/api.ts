/**
 * Talking to the bridge on this origin. The session token comes from the
 * URL fragment (#token=…) that `email-social` prints; it is moved to
 * sessionStorage and removed from the address bar.
 */

const KEY = "email-social-token";

export function takeToken(): string | null {
  const fragment = new URLSearchParams(location.hash.slice(1));
  const fromUrl = fragment.get("token");
  try {
    if (fromUrl !== null) {
      sessionStorage.setItem(KEY, fromUrl);
      history.replaceState(null, "", location.pathname);
      return fromUrl;
    }
    return sessionStorage.getItem(KEY);
  } catch {
    return fromUrl;
  }
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function createApi(token: string) {
  async function call<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    const response = await fetch(path, {
      method: init.method ?? "GET",
      headers: { authorization: `Bearer ${token}`, ...(init.body !== undefined ? { "content-type": "application/json" } : {}) },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new ApiError(response.status, body?.error ?? `Request failed (${response.status})`);
    }
    return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
  }

  /**
   * Calls `onEvent` for every server event and `onConnection` when the
   * connection to the bridge is lost or back; reconnects with growing pauses.
   */
  function events(onEvent: (event: { type: string }) => void, onConnection: (connected: boolean) => void = () => undefined): () => void {
    let socket: WebSocket | null = null;
    let stopped = false;
    let delay = 500;
    const connect = (): void => {
      socket = new WebSocket(`ws://${location.host}/api/events?token=${encodeURIComponent(token)}`);
      socket.onopen = () => {
        delay = 500;
        onConnection(true);
        // Whatever happened while the page was away: ask again.
        onEvent({ type: "session" });
        onEvent({ type: "changed" });
      };
      socket.onmessage = (message) => {
        try {
          onEvent(JSON.parse(String(message.data)) as { type: string });
        } catch {
          // Ignore malformed events.
        }
      };
      socket.onclose = () => {
        if (stopped) return;
        onConnection(false);
        setTimeout(connect, delay);
        delay = Math.min(delay * 2, 10_000);
      };
    };
    connect();
    return () => {
      stopped = true;
      socket?.close();
    };
  }

  return { call, events, token };
}

export type Api = ReturnType<typeof createApi>;
