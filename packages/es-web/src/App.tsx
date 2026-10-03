import type { LoginRequest, SessionInfo } from "@email-social/es-bridge/api";
import { useEffect, useMemo, useState } from "preact/hooks";
import { ApiError, createApi, takeToken } from "./api.js";
import { LoginForm } from "./LoginForm.js";
import { MailView } from "./MailView.js";
import { SigningIn } from "./Status.js";

export function App() {
  const token = useMemo(takeToken, []);
  const api = useMemo(() => (token === null ? null : createApi(token)), [token]);
  const [info, setInfo] = useState<SessionInfo | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [connected, setConnected] = useState(true);
  const [seconds, setSeconds] = useState(0);

  const load = async (): Promise<void> => {
    if (api === null) return;
    try {
      setInfo(await api.call<SessionInfo>("/api/session"));
      setProblem(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setProblem("This page needs the address printed by email-social (it contains the access token).");
      // Anything else means the bridge is not reachable right now; the event connection says "Reconnecting…".
    }
  };

  useEffect(() => {
    if (api === null) return;
    void load();
    return api.events(
      (event) => {
        if (event.type === "session") void load();
        else setTick((t) => t + 1);
      },
      (up) => {
        setConnected(up);
        // After a reload or a lost connection, look for new mail at once.
        if (up) void api.call("/api/sync", { method: "POST", body: {} }).catch(() => undefined);
      },
    );
  }, [api]);

  // While signing in, a counter of seconds for the steps that have no count of their own.
  const step = info?.state === "connecting" ? info.progress.step : null;
  useEffect(() => {
    setSeconds(0);
    if (step === null) return;
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [step]);

  if (api === null) {
    return (
      <main class="notice">
        <h1>Email Social</h1>
        <p>Open the address that <code>email-social</code> printed when it started. It contains the access token for this session.</p>
      </main>
    );
  }
  if (problem !== null) {
    return (
      <main class="notice">
        <h1>Email Social</h1>
        <p role="alert">{problem}</p>
      </main>
    );
  }
  if (info === null) {
    return (
      <main class="notice">
        <p role="status">{connected ? "Loading…" : "Reconnecting…"}</p>
      </main>
    );
  }
  if (info.state === "connecting") return <SigningIn address={info.address} progress={info.progress} seconds={seconds} />;
  if (info.state === "signed-out") {
    const signIn = async (request: LoginRequest): Promise<void> => {
      try {
        setInfo(await api.call<SessionInfo>("/api/login", { method: "POST", body: request }));
      } catch {
        await load();
      }
    };
    const retry = (): void => {
      void api
        .call<SessionInfo>("/api/retry", { method: "POST", body: {} })
        .then(setInfo)
        .catch(() => load());
    };
    return (
      <main class="notice">
        <LoginForm presets={info.presets} keychain={info.keychain} error={info.error} onSubmit={signIn} {...(info.canRetry && info.error !== null ? { onRetry: retry } : {})} />
      </main>
    );
  }
  const signOut = async (forget: boolean): Promise<void> => {
    setInfo(await api.call<SessionInfo>("/api/logout", { method: "POST", body: { forget } }));
  };
  const retry = (): void => {
    void api.call("/api/retry", { method: "POST", body: {} }).then(load, load);
  };
  return (
    <MailView
      api={api}
      account={info.account}
      mode={info.mode}
      tick={tick}
      remembered={info.remembered}
      sync={info.sync}
      connected={connected}
      onRetry={retry}
      onSignOut={signOut}
    />
  );
}
