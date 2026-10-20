/**
 * The local service: an HTTP server and a WebSocket on 127.0.0.1 only, on a
 * random port, answering only requests that carry the per-session token
 * printed in the start URL. It serves the web client and the JSON API of
 * api-types.ts; every answer about mail is computed by a MailSession.
 *
 * Requests are also refused unless their Host header names 127.0.0.1 or
 * localhost with this port (a page on another site cannot reach the API by
 * pointing its own domain at 127.0.0.1), and the WebSocket additionally
 * checks the Origin header.
 */

import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join, sep } from "node:path";
import { canonicalAddress, collapse, parseMessage } from "@email-social/es-core";
import { WebSocketServer, type WebSocket } from "ws";
import { ImapSmtpAdapter } from "./adapters/imap-smtp.js";
import { MaildirAdapter } from "./adapters/maildir.js";
import type { MailboxAdapter } from "./adapters/types.js";
import type { LoginRequest, Person, SendRequest, ServerEvent, ServerSettings, SessionInfo, StartProgress } from "./api-types.js";
import { MetadataCache } from "./cache.js";
import { MemoryStore, type AccountConfig, type CredentialStore } from "./credentials.js";
import { PRESETS } from "./providers.js";
import { MailSession, TOPIC_LABEL_MAX } from "./session.js";

export interface BridgeOptions {
  /** Directory of the built web client (index.html and assets/); null serves the API only. */
  webRoot: string | null;
  /** 0 (the default) picks a free port. */
  port?: number;
  token?: string;
  /** Maildir mode: no sign-in, this directory is the mailbox of this account. */
  maildir?: { root: string; account: Person; pollMs?: number };
  /** Where remembered accounts are kept (IMAP mode). Default: memory only. */
  credentials?: CredentialStore;
  /** Creates the adapter for an IMAP account (tests replace it). */
  connect?: (config: AccountConfig) => MailboxAdapter;
  /** Opt-in metadata cache directory. */
  cacheDir?: string | null;
  maxMessages?: number;
  /** How often an IMAP mailbox is checked besides IDLE, in ms. Default 30 s. */
  pollMs?: number;
  /** Messages loaded before the chats are shown. Default 50. */
  firstBatch?: number;
  /** No answer from the mail server for this long (ms) is reported as an error. Default 45 s. */
  stallMs?: number;
  /** Time zone of the dates in quoted replies. Default: this computer's. */
  timeZone?: string;
  clock?: () => Date;
  newMessageId?: () => string;
  log?: (message: string) => void;
}

export interface RunningBridge {
  url: string;
  address: string;
  port: number;
  token: string;
  /** Resolves after the start-up sign-in (maildir mode, or a remembered account) has finished. */
  ready: Promise<void>;
  session(): MailSession | null;
  close(): Promise<void>;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".woff2": "font/woff2",
};

/** Content-Disposition for a download (RFC 6266 with an RFC 8187 UTF-8 filename). */
export function attachmentDisposition(filename: string): string {
  const fallback = filename.replace(/[^\x20-\x7e]|["\\]/g, "_");
  const encoded = encodeURIComponent(filename).replace(/['()*!]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

function sameToken(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function isSettings(value: unknown): value is ServerSettings {
  const v = value as ServerSettings | null;
  return (
    typeof v?.host === "string" &&
    /^[A-Za-z0-9.-]+$/.test(v.host) &&
    Number.isInteger(v.port) &&
    v.port > 0 &&
    v.port < 65536 &&
    (v.security === "tls" || v.security === "starttls")
  );
}

function loginConfig(body: unknown): { config: AccountConfig; remember: boolean } {
  const b = body as Partial<LoginRequest> | null;
  if (typeof b?.address !== "string" || !/^[^@\s]+@[^@\s]+$/.test(b.address.trim())) throw new HttpError(400, "An e-mail address is needed");
  if (typeof b.password !== "string" || b.password === "") throw new HttpError(400, "A password is needed");
  if (!isSettings(b.imap) || !isSettings(b.smtp)) throw new HttpError(400, "IMAP and SMTP need a host, a port and TLS or STARTTLS");
  return {
    config: {
      address: canonicalAddress(b.address.trim()),
      name: typeof b.name === "string" ? b.name.trim() : "",
      username: typeof b.username === "string" ? b.username.trim() : "",
      password: b.password,
      imap: b.imap,
      smtp: b.smtp,
      appendToSent: b.appendToSent !== false,
    },
    remember: b.remember === true,
  };
}

/**
 * The `topic` of POST /api/messages: undefined, { root } or { label }, with the
 * label's white space collapsed; anything else is a 400. Whether the root is
 * a topic of the chat is checked by the session.
 */
function checkTopic(value: unknown): SendRequest["topic"] {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new HttpError(400, "topic must be { root } or { label }");
  const topic = value as Record<string, unknown>;
  const hasRoot = topic.root !== undefined;
  const hasLabel = topic.label !== undefined;
  if (hasRoot === hasLabel) throw new HttpError(400, "topic must have either root or label");
  if (hasRoot) {
    if (typeof topic.root !== "string" || topic.root === "") throw new HttpError(400, "topic.root must be a message id");
    return { root: topic.root };
  }
  const label = typeof topic.label === "string" ? collapse(topic.label) : "";
  if (label === "" || label.length > TOPIC_LABEL_MAX) throw new HttpError(400, `A topic name needs 1 to ${TOPIC_LABEL_MAX} characters`);
  return { label };
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const text = body === undefined ? "" : JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(text);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  if (!(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) throw new HttpError(415, "Send JSON");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > 1_000_000) throw new HttpError(413, "Request too large");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "null");
  } catch {
    throw new HttpError(400, "Not valid JSON");
  }
}

export async function startBridge(options: BridgeOptions): Promise<RunningBridge> {
  const token = options.token ?? randomBytes(32).toString("base64url");
  const credentials = options.credentials ?? new MemoryStore();
  const log = options.log ?? ((m: string) => console.error(m));
  const clients = new Set<WebSocket>();
  let session: MailSession | null = null;
  let state: { state: "signed-out"; error: string | null } | { state: "connecting"; address: string; progress: StartProgress } | { state: "ready" } = {
    state: "signed-out",
    error: null,
  };
  let remembered = false;
  /** The last sign-in, kept in memory only, for "Try again". */
  let lastSignIn: { config: AccountConfig; remember: boolean } | null = null;
  /** Increases with every sign-in and sign-out, so a slow earlier sign-in cannot win. */
  let generation = 0;
  let port = 0;
  let webRootReal: string | null = null;
  if (options.webRoot !== null) webRootReal = await realpath(options.webRoot).catch(() => null);

  const broadcast = (event: ServerEvent): void => {
    const data = JSON.stringify(event);
    for (const client of clients) if (client.readyState === client.OPEN) client.send(data);
  };

  let lastProgressEvent = 0;
  const openSession = async (
    adapter: MailboxAdapter,
    account: Person,
    mode: "imap" | "maildir",
    appendToSent: boolean,
    onProgress?: (progress: StartProgress) => void,
  ): Promise<MailSession> =>
    MailSession.start({
      adapter,
      account,
      mode,
      appendToSent,
      cache: options.cacheDir ? new MetadataCache(options.cacheDir, account.address) : null,
      ...(options.clock ? { clock: options.clock } : {}),
      ...(options.newMessageId ? { newMessageId: options.newMessageId } : {}),
      ...(options.firstBatch !== undefined ? { firstBatch: options.firstBatch } : {}),
      ...(options.stallMs !== undefined ? { stallMs: options.stallMs } : {}),
      ...(options.timeZone !== undefined ? { timeZone: options.timeZone } : {}),
      onChange: () => broadcast({ type: "changed" }),
      onStatus: () => broadcast({ type: "session" }),
      ...(onProgress ? { onProgress } : {}),
      log,
    });

  const signIn = async (config: AccountConfig, remember: boolean): Promise<void> => {
    const mine = ++generation;
    lastSignIn = { config, remember };
    state = { state: "connecting", address: config.address, progress: { step: "connecting", loaded: 0, total: null } };
    broadcast({ type: "session" });
    const adapter =
      options.connect?.(config) ?? new ImapSmtpAdapter(config, { maxMessages: options.maxMessages ?? 500, ...(options.pollMs !== undefined ? { pollMs: options.pollMs } : {}) });
    const onProgress = (progress: StartProgress): void => {
      if (mine !== generation || state.state !== "connecting") return;
      const stepChanged = state.progress.step !== progress.step;
      state = { ...state, progress };
      // At most a few updates a second, but every change of step at once.
      const now = Date.now();
      if (stepChanged || now - lastProgressEvent >= 200 || progress.loaded === progress.total) {
        lastProgressEvent = now;
        broadcast({ type: "session" });
      }
    };
    try {
      const opened = await openSession(adapter, { address: config.address, name: config.name === "" ? config.address : config.name }, "imap", config.appendToSent, onProgress);
      if (mine !== generation) {
        await opened.close().catch(() => undefined);
        throw new HttpError(409, "A newer sign-in replaced this one");
      }
      session = opened;
      state = { state: "ready" };
      remembered = false;
      if (remember) {
        try {
          await credentials.save(config);
          remembered = true;
        } catch (e) {
          log(`could not store the account in the keychain: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    } catch (e) {
      await Promise.resolve()
        .then(() => adapter.close())
        .catch(() => undefined);
      if (e instanceof HttpError) throw e;
      if (mine === generation) state = { state: "signed-out", error: e instanceof Error ? e.message : String(e) };
      throw new HttpError(401, e instanceof Error ? e.message : "Sign-in failed");
    } finally {
      broadcast({ type: "session" });
    }
  };

  const info = async (): Promise<SessionInfo> => {
    if (state.state === "ready" && session !== null) {
      return { state: "ready", account: session.account, mode: session.mode, remembered, sync: session.status() };
    }
    if (state.state === "connecting") return { state: "connecting", address: state.address, progress: state.progress };
    return {
      state: "signed-out",
      error: state.state === "signed-out" ? state.error : null,
      presets: [...PRESETS],
      keychain: await credentials.available(),
      canRetry: lastSignIn !== null,
    };
  };

  const ready = (): MailSession => {
    if (session === null || state.state !== "ready") throw new HttpError(409, "Not signed in");
    return session;
  };

  const hostAllowed = (host: string | undefined): boolean => host === `127.0.0.1:${port}` || host === `localhost:${port}`;
  const originAllowed = (origin: string | undefined): boolean =>
    origin === undefined || origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`;
  const tokenOf = (req: IncomingMessage, url: URL): string => {
    const header = req.headers.authorization;
    if (typeof header === "string" && header.startsWith("Bearer ")) return header.slice(7);
    return url.searchParams.get("token") ?? "";
  };

  const serveStatic = async (res: ServerResponse, pathname: string): Promise<void> => {
    if (webRootReal === null) throw new HttpError(404, "Not found");
    const relative = pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1));
    if (relative !== "index.html" && !/^assets\/[A-Za-z0-9._-]+$/.test(relative)) throw new HttpError(404, "Not found");
    const file = await realpath(join(webRootReal, relative)).catch(() => null);
    if (file === null || !file.startsWith(webRootReal + sep) || !(await stat(file)).isFile()) throw new HttpError(404, "Not found");
    const headers: Record<string, string> = {
      "content-type": TYPES[extname(file)] ?? "application/octet-stream",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "cache-control": "no-cache",
    };
    if (relative === "index.html") {
      headers["content-security-policy"] = [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self'",
        "img-src 'self' data:",
        `connect-src 'self' ws://127.0.0.1:${port} ws://localhost:${port}`,
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'self'",
        "frame-ancestors 'none'",
      ].join("; ");
      headers["x-frame-options"] = "DENY";
    }
    res.writeHead(200, headers);
    res.end(await readFile(file));
  };

  const download = (res: ServerResponse, bytes: Uint8Array, filename: string, type: string): void => {
    res.writeHead(200, {
      // Never the part's own type: an HTML or SVG attachment must not run as a page of this origin.
      "content-type": type,
      "content-disposition": attachmentDisposition(filename),
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
      "cache-control": "no-store",
    });
    res.end(bytes);
  };

  const route = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    if (!hostAllowed(req.headers.host)) throw new HttpError(403, "Wrong host");
    const path = url.pathname;
    if (!path.startsWith("/api/")) {
      if (req.method !== "GET") throw new HttpError(405, "Method not allowed");
      return serveStatic(res, path);
    }
    if (!sameToken(tokenOf(req, url), token)) throw new HttpError(401, "Missing or wrong session token");
    const method = req.method ?? "GET";
    let m: RegExpExecArray | null;

    if (method === "GET" && path === "/api/session") return send(res, 200, await info());
    if (method === "POST" && path === "/api/login") {
      if (options.maildir !== undefined) throw new HttpError(409, "This bridge serves a maildir");
      const { config, remember } = loginConfig(await readJson(req));
      if (session !== null) await session.close().catch(() => undefined);
      session = null;
      await signIn(config, remember);
      return send(res, 200, await info());
    }
    if (method === "POST" && path === "/api/logout") {
      const body = (await readJson(req)) as { forget?: unknown } | null;
      if (options.maildir !== undefined) throw new HttpError(409, "This bridge serves a maildir");
      generation++;
      await session?.close().catch(() => undefined);
      session = null;
      lastSignIn = null;
      state = { state: "signed-out", error: null };
      if (body?.forget === true) await credentials.clear();
      remembered = false;
      broadcast({ type: "session" });
      return send(res, 200, await info());
    }
    if (method === "POST" && path === "/api/retry") {
      await readJson(req);
      if (session !== null && state.state === "ready") {
        void session.retry().catch((e: unknown) => log(`retry failed: ${String(e)}`));
        return send(res, 202, await info());
      }
      if (lastSignIn === null || state.state === "connecting") throw new HttpError(409, "Nothing to try again");
      await signIn(lastSignIn.config, lastSignIn.remember);
      return send(res, 200, await info());
    }
    if (method === "GET" && path === "/api/chats") return send(res, 200, await ready().chats());
    if (method === "GET" && path === "/api/other") return send(res, 200, await ready().others());
    if (method === "GET" && path === "/api/contacts") return send(res, 200, ready().contacts());
    if ((m = /^\/api\/contacts\/([^/]+)$/.exec(path)) && method === "GET") {
      const detail = ready().contact(decodeURIComponent(m[1]!));
      if (detail === null) throw new HttpError(404, "No such contact");
      return send(res, 200, detail);
    }
    if (method === "POST" && path === "/api/sync") {
      await ready().sync();
      return send(res, 204, undefined);
    }
    if ((m = /^\/api\/chats\/([^/]+)$/.exec(path)) && method === "GET") {
      const chat = await ready().chat(decodeURIComponent(m[1]!));
      if (chat === null) throw new HttpError(404, "No such chat");
      return send(res, 200, chat);
    }
    if ((m = /^\/api\/other\/([^/]+)$/.exec(path)) && method === "GET") {
      const other = await ready().other(decodeURIComponent(m[1]!));
      if (other === null) throw new HttpError(404, "No such sender");
      return send(res, 200, other);
    }
    if ((m = /^\/api\/(?:chats|other)\/([^/]+)\/read$/.exec(path)) && method === "POST") {
      await readJson(req);
      if (!(await ready().markRead(decodeURIComponent(m[1]!)))) throw new HttpError(404, "No such chat");
      return send(res, 204, undefined);
    }
    if (method === "POST" && path === "/api/messages") {
      const body = (await readJson(req)) as Partial<SendRequest> | null;
      if (typeof body?.text !== "string" || body.text.trim() === "") throw new HttpError(400, "The message is empty");
      if (body.chatId !== undefined && typeof body.chatId !== "string") throw new HttpError(400, "chatId must be a string");
      if (body.to !== undefined && (!Array.isArray(body.to) || body.to.some((a) => typeof a !== "string"))) throw new HttpError(400, "to must be a list of addresses");
      if ((body.chatId === undefined) === (body.to === undefined)) throw new HttpError(400, "Send either chatId (a reply) or to (a new chat)");
      if (body.replyTo !== undefined && typeof body.replyTo !== "string") throw new HttpError(400, "replyTo must be a message id");
      const topic = checkTopic(body.topic);
      if (topic !== undefined && "root" in topic && body.to !== undefined) throw new HttpError(400, "A new chat takes only a topic name");
      if (body.replyTo !== undefined && body.to !== undefined) throw new HttpError(400, "A new chat has nothing to reply to");
      if (body.replyTo !== undefined && topic !== undefined) throw new HttpError(400, "A reply continues the topic of the message it answers; send replyTo or topic, not both");
      const request: SendRequest = {
        text: body.text,
        ...(body.chatId !== undefined ? { chatId: body.chatId } : {}),
        ...(body.to !== undefined ? { to: body.to } : {}),
        ...(body.replyTo !== undefined ? { replyTo: body.replyTo } : {}),
        ...(topic !== undefined ? { topic } : {}),
      };
      if (request.chatId !== undefined && (await ready().chat(request.chatId)) === null) throw new HttpError(404, "No such chat");
      return send(res, 201, await ready().send(request));
    }
    if ((m = /^\/api\/messages\/([^/]+)\/attachments\/([^/]+)$/.exec(path)) && method === "GET") {
      const part = await ready().attachment(decodeURIComponent(m[1]!), decodeURIComponent(m[2]!));
      if (part === null) throw new HttpError(404, "No such attachment");
      return download(res, part.bytes, part.filename ?? "attachment", "application/octet-stream");
    }
    if ((m = /^\/api\/messages\/([^/]+)\/original$/.exec(path)) && method === "GET") {
      const raw = await ready().original(decodeURIComponent(m[1]!)).catch(() => null);
      if (raw === null) throw new HttpError(404, "No such message");
      const subject = parseMessage(raw).subject.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").slice(0, 80);
      return download(res, raw, `${subject === "" ? "message" : subject}.eml`, "message/rfc822");
    }
    throw new HttpError(404, "Not found");
  };

  const server: Server = createServer((req, res) => {
    route(req, res).catch((e: unknown) => {
      const status = e instanceof HttpError ? e.status : e instanceof RangeError ? 400 : 500;
      if (status === 500) log(`request failed: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
      if (!res.headersSent) send(res, status, { error: e instanceof Error ? e.message : "Request failed" });
      else res.end();
    });
  });

  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    const allowed =
      url.pathname === "/api/events" &&
      hostAllowed(req.headers.host) &&
      originAllowed(req.headers.origin) &&
      sameToken(url.searchParams.get("token") ?? "", token);
    if (!allowed) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      clients.add(ws);
      ws.on("close", () => clients.delete(ws));
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, "127.0.0.1", () => resolve());
  });
  const address = server.address() as AddressInfo;
  port = address.port;

  if (options.maildir !== undefined) {
    const adapter = new MaildirAdapter(options.maildir.root, { pollMs: options.maildir.pollMs ?? 2000 });
    try {
      session = await openSession(adapter, options.maildir.account, "maildir", true);
    } catch (e) {
      server.close();
      throw e;
    }
    state = { state: "ready" };
  }

  const startup = (async (): Promise<void> => {
    if (options.maildir !== undefined) return;
    const saved = await credentials.load();
    if (saved !== null) {
      await signIn(saved, false).catch(() => undefined);
      if (session !== null) remembered = true;
    }
  })();
  startup.catch((e: unknown) => log(`start-up failed: ${String(e)}`));

  return {
    url: `http://127.0.0.1:${port}/#token=${token}`,
    address: address.address,
    port,
    token,
    ready: startup.catch(() => undefined),
    session: () => session,
    close: async () => {
      for (const client of clients) client.terminate();
      wss.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      server.closeAllConnections();
      await session?.close().catch(() => undefined);
      session = null;
    },
  };
}
