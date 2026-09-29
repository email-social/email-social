import type { LoginRequest, SessionInfo } from "@email-social/es-bridge/api";
import { useEffect, useMemo, useState } from "preact/hooks";
import { ApiError, createApi, takeToken } from "./api.js";
import { LoginForm } from "./LoginForm.js";
import { MailView } from "./MailView.js";

export function App() {
  const token = useMemo(takeToken, []);
  const api = useMemo(() => (token === null ? null : createApi(token)), [token]);
  const [info, setInfo] = useState<SessionInfo | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const load = async (): Promise<void> => {
    if (api === null) return;
    try {
      setInfo(await api.call<SessionInfo>("/api/session"));
      setProblem(null);
    } catch (e) {
      setProblem(e instanceof ApiError && e.status === 401 ? "This page needs the address printed by email-social (it contains the access token)." : String(e));
    }
  };

  useEffect(() => {
    if (api === null) return;
    void load();
    return api.events((event) => {
      if (event.type === "session") void load();
      else setTick((t) => t + 1);
    });
  }, [api]);

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
  if (info === null) return <main class="notice"><p>Loading…</p></main>;
  if (info.state === "connecting") {
    return (
      <main class="notice">
        <p role="status">Signing in as {info.address}…</p>
      </main>
    );
  }
  if (info.state === "signed-out") {
    const signIn = async (request: LoginRequest): Promise<void> => {
      try {
        setInfo(await api.call<SessionInfo>("/api/login", { method: "POST", body: request }));
      } catch (e) {
        setInfo({ ...info, error: e instanceof Error ? e.message : String(e) });
      }
    };
    return (
      <main class="notice">
        <LoginForm presets={info.presets} keychain={info.keychain} error={info.error} onSubmit={signIn} />
      </main>
    );
  }
  const signOut = async (forget: boolean): Promise<void> => {
    setInfo(await api.call<SessionInfo>("/api/logout", { method: "POST", body: { forget } }));
  };
  return <MailView api={api} account={info.account} mode={info.mode} tick={tick} remembered={info.remembered} onSignOut={signOut} />;
}
