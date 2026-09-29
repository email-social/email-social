import type { LoginRequest, ProviderPreset, Security } from "@email-social/es-bridge/api";
import { useState } from "preact/hooks";

interface Props {
  presets: readonly ProviderPreset[];
  /** Whether the bridge can use the OS keychain. */
  keychain: boolean;
  error: string | null;
  onSubmit: (request: LoginRequest) => Promise<void>;
}

/** Sign-in to the user's own mailbox: IMAP to read, SMTP to send. */
export function LoginForm({ presets, keychain, error, onSubmit }: Props) {
  const [presetId, setPresetId] = useState(presets[0]?.id ?? "other");
  const preset = presets.find((p) => p.id === presetId) ?? presets[0]!;
  const [imapHost, setImapHost] = useState("");
  const [imapPort, setImapPort] = useState(993);
  const [imapSecurity, setImapSecurity] = useState<Security>("tls");
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState(465);
  const [smtpSecurity, setSmtpSecurity] = useState<Security>("tls");
  const [busy, setBusy] = useState(false);
  const custom = preset.imap.host === "";

  const submit = async (event: Event): Promise<void> => {
    event.preventDefault();
    const data = new FormData(event.currentTarget as HTMLFormElement);
    const text = (name: string): string => String(data.get(name) ?? "").trim();
    setBusy(true);
    try {
      await onSubmit({
        address: text("address"),
        name: text("name"),
        username: text("username"),
        password: String(data.get("password") ?? ""),
        imap: custom ? { host: imapHost.trim(), port: imapPort, security: imapSecurity } : preset.imap,
        smtp: custom ? { host: smtpHost.trim(), port: smtpPort, security: smtpSecurity } : preset.smtp,
        appendToSent: preset.appendToSent,
        remember: data.get("remember") === "on",
      });
    } finally {
      setBusy(false);
    }
  };

  const server = (kind: "imap" | "smtp") => {
    const [host, setHost, port, setPort, security, setSecurity] =
      kind === "imap" ? ([imapHost, setImapHost, imapPort, setImapPort, imapSecurity, setImapSecurity] as const) : ([smtpHost, setSmtpHost, smtpPort, setSmtpPort, smtpSecurity, setSmtpSecurity] as const);
    const label = kind === "imap" ? "IMAP (reading)" : "SMTP (sending)";
    return (
      <fieldset>
        <legend>{label}</legend>
        <label for={`${kind}-host`}>Server</label>
        <input id={`${kind}-host`} required value={host} onInput={(e) => setHost((e.target as HTMLInputElement).value)} placeholder={kind === "imap" ? "imap.example.com" : "smtp.example.com"} />
        <label for={`${kind}-port`}>Port</label>
        <input id={`${kind}-port`} type="number" min={1} max={65535} required value={port} onInput={(e) => setPort(Number((e.target as HTMLInputElement).value))} />
        <label for={`${kind}-security`}>Encryption of the connection</label>
        <select
          id={`${kind}-security`}
          value={security}
          onChange={(e) => {
            const value = (e.target as HTMLSelectElement).value as Security;
            setSecurity(value);
            setPort(kind === "imap" ? (value === "tls" ? 993 : 143) : value === "tls" ? 465 : 587);
          }}
        >
          <option value="tls">TLS</option>
          <option value="starttls">STARTTLS</option>
        </select>
      </fieldset>
    );
  };

  return (
    <form class="login" onSubmit={submit} aria-labelledby="login-title">
      <h1 id="login-title">Sign in to your mailbox</h1>
      <p>Email Social reads and sends your mail over IMAP and SMTP from this computer. Your messages stay in your mailbox.</p>
      {error !== null ? (
        <p class="error" role="alert">
          {error}
        </p>
      ) : null}
      <label for="provider">Provider</label>
      <select id="provider" value={presetId} onChange={(e) => setPresetId((e.target as HTMLSelectElement).value)}>
        {presets.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>
      <label for="address">E-mail address</label>
      <input id="address" name="address" type="email" required autocomplete="username" />
      <label for="password">Password</label>
      <input id="password" name="password" type="password" required autocomplete="current-password" aria-describedby="password-hint" />
      <p id="password-hint" class="hint">
        {preset.hint}
      </p>
      <label for="name">Your name (shown to recipients)</label>
      <input id="name" name="name" autocomplete="name" />
      {custom ? (
        <>
          {server("imap")}
          {server("smtp")}
        </>
      ) : null}
      <details>
        <summary>More</summary>
        <label for="username">Login name, if it is not the e-mail address</label>
        <input id="username" name="username" autocomplete="off" />
      </details>
      <p class="check">
        <input id="remember" name="remember" type="checkbox" disabled={!keychain} aria-describedby="remember-hint" />
        <label for="remember">Remember on this device</label>
      </p>
      <p id="remember-hint" class="hint">
        {keychain
          ? "Without this, the password is kept in memory only until Email Social stops. With it, the settings and password are stored in this computer's keychain."
          : "This computer has no keychain Email Social can use, so the password is kept in memory only until Email Social stops."}
      </p>
      <button type="submit" disabled={busy}>
        {busy ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
