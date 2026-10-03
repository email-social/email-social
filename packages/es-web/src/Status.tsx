import type { StartProgress, SyncStatus } from "@email-social/es-bridge/api";

/** While signing in: the step and a number that changes (seconds, or messages loaded). */
export function SigningIn({ address, progress, seconds }: { address: string; progress: StartProgress; seconds: number }) {
  const line =
    progress.step === "connecting"
      ? `Connecting to the mail server… ${seconds} s`
      : progress.step === "listing"
        ? `Listing your messages… ${seconds} s`
        : `Loading messages: ${progress.loaded} of ${progress.total ?? "?"}`;
  return (
    <main class="notice">
      <section role="status" aria-live="polite">
        <h1>Signing in as {address}</h1>
        <p>{line}</p>
        {progress.step === "loading" && progress.total !== null && progress.total > 0 ? (
          <progress max={progress.total} value={progress.loaded}>
            {progress.loaded} of {progress.total}
          </progress>
        ) : null}
        <p class="hint">The newest messages come first; your chats appear as soon as they are in, and older messages keep loading.</p>
      </section>
    </main>
  );
}

/** After sign-in: older messages loading, a lost connection, or an error with "Try again". Nothing when all is well. */
export function StatusBar({ sync, connected, onRetry }: { sync: SyncStatus; connected: boolean; onRetry: () => void }) {
  const reconnecting = !connected || sync.connection === "reconnecting";
  if (!reconnecting && sync.loading === null && sync.error === null) return null;
  return (
    <div class="status-bar">
      {reconnecting ? (
        <p class="status-line" role="status">
          Reconnecting…
        </p>
      ) : null}
      {sync.loading !== null ? (
        <p class="status-line" role="status">
          Loading older messages: {sync.loading.loaded} of {sync.loading.total}{" "}
          <progress max={sync.loading.total} value={sync.loading.loaded} aria-hidden="true" />
        </p>
      ) : null}
      {sync.error !== null ? (
        <p class="error" role="alert">
          {sync.error}{" "}
          <button type="button" class="retry" onClick={onRetry}>
            Try again
          </button>
        </p>
      ) : null}
    </div>
  );
}
