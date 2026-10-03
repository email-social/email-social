/**
 * A small IMAP4rev1 server (RFC 3501) on 127.0.0.1, just enough for
 * imapflow: LOGIN, CAPABILITY, ID, LIST/LSUB, CREATE, SELECT/EXAMINE,
 * UID SEARCH, UID FETCH (UID, FLAGS, INTERNALDATE, BODY.PEEK[]), UID STORE,
 * APPEND (with APPENDUID, RFC 4315), IDLE (RFC 2177), NOOP, STATUS, LOGOUT.
 *
 * Tests drive it: deliver() adds a message (and tells idling clients),
 * `delayPerMessageMs` slows every message body sent, stall() stops
 * answering (sockets stay open, as with a server that hangs), and
 * dropConnections() cuts every connection. No TLS: the adapter under test is
 * given a plain connection to this loopback server only.
 */
import net from "node:net";
import { ImapFlow } from "imapflow";
import type { ImapClient, imapOptions, SmtpTransport } from "../../src/adapters/imap-smtp.js";

export interface FakeMessage {
  uid: number;
  raw: Buffer;
  flags: string[];
  internalDate: Date;
}

export interface FakeMailbox {
  name: string;
  specialUse: string | null;
  uidValidity: number;
  uidNext: number;
  messages: FakeMessage[];
}

export interface FakeImapOptions {
  user?: string;
  pass?: string;
  /** Advertise and support IDLE. Default true. */
  idle?: boolean;
  /** Wait this long before sending each message body. Default 0. */
  delayPerMessageMs?: number;
}

interface Client {
  socket: net.Socket;
  selected: FakeMailbox | null;
  idleTag: string | null;
  /** Number of messages the client knows about in the selected mailbox. */
  known: number;
  buffer: Buffer;
  /** A pending APPEND waiting for its literal. */
  literal: { tag: string; mailbox: string; flags: string[]; size: number } | null;
  queue: Promise<void>;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function imapDate(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${pad(date.getUTCDate())}-${MONTHS[date.getUTCMonth()]}-${date.getUTCFullYear()} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} +0000`;
}

/** Splits an IMAP argument string into atoms, quoted strings and parenthesised lists (as raw strings). */
function tokens(input: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < input.length) {
    const c = input[i]!;
    if (c === " ") {
      i++;
    } else if (c === '"') {
      let value = "";
      i++;
      while (i < input.length && input[i] !== '"') {
        if (input[i] === "\\") i++;
        value += input[i++];
      }
      i++;
      out.push(value);
    } else if (c === "(") {
      let depth = 0;
      const start = i;
      for (; i < input.length; i++) {
        if (input[i] === "(") depth++;
        else if (input[i] === ")" && --depth === 0) break;
      }
      out.push(input.slice(start, ++i));
    } else {
      const start = i;
      while (i < input.length && input[i] !== " ") {
        if (input[i] === "[") while (i < input.length && input[i] !== "]") i++;
        i++;
      }
      out.push(input.slice(start, i));
    }
  }
  return out;
}

/** The uids of a UID sequence set ("1:*", "3,5:7") among the given ones. */
function inSet(set: string, uids: number[], max: number): number[] {
  const wanted = new Set<number>();
  for (const part of set.split(",")) {
    const [a, b] = part.split(":");
    const from = a === "*" ? max : Number(a);
    const to = b === undefined ? from : b === "*" ? max : Number(b);
    const [lo, hi] = from <= to ? [from, to] : [to, from];
    for (const uid of uids) if (uid >= lo && uid <= hi) wanted.add(uid);
    // RFC 3501 §6.4.8: "n:*" always includes the highest uid.
    if (b === "*" && uids.length > 0) wanted.add(max);
  }
  return uids.filter((uid) => wanted.has(uid));
}

export class FakeImapServer {
  readonly mailboxes = new Map<string, FakeMailbox>();
  /** Every command received (tag removed), for assertions. */
  readonly commands: string[] = [];
  private readonly server: net.Server;
  private readonly clients = new Set<Client>();
  private stalled = false;
  private readonly options: Required<FakeImapOptions>;
  port = 0;

  constructor(options: FakeImapOptions = {}) {
    this.options = { user: "alice@example.com", pass: "app-password", idle: true, delayPerMessageMs: 0, ...options };
    this.mailboxes.set("INBOX", { name: "INBOX", specialUse: null, uidValidity: 1700000001, uidNext: 1, messages: [] });
    this.mailboxes.set("Sent", { name: "Sent", specialUse: "\\Sent", uidValidity: 1700000002, uidNext: 1, messages: [] });
    this.server = net.createServer((socket) => this.accept(socket));
  }

  async start(): Promise<number> {
    await new Promise<void>((resolve) => this.server.listen(0, "127.0.0.1", resolve));
    this.port = (this.server.address() as net.AddressInfo).port;
    return this.port;
  }

  async close(): Promise<void> {
    this.dropConnections();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  set delayPerMessageMs(ms: number) {
    this.options.delayPerMessageMs = ms;
  }

  /** Adds a message to a mailbox and tells idling clients that have it selected. Returns its uid. */
  deliver(mailboxName: string, raw: string | Uint8Array, options: { flags?: string[]; date?: Date } = {}): number {
    const mailbox = this.mailboxes.get(mailboxName)!;
    const uid = mailbox.uidNext++;
    mailbox.messages.push({ uid, raw: Buffer.from(raw), flags: [...(options.flags ?? [])], internalDate: options.date ?? new Date(Date.UTC(2026, 2, 20, 12, 0, 0)) });
    for (const client of this.clients) {
      if (client.selected === mailbox && client.idleTag !== null && !this.stalled) {
        client.known = mailbox.messages.length;
        this.write(client, `* ${mailbox.messages.length} EXISTS`);
      }
    }
    return uid;
  }

  /** Stops answering: commands are read and ignored, connections stay open. */
  stall(): void {
    this.stalled = true;
  }

  resume(): void {
    this.stalled = false;
  }

  dropConnections(): void {
    for (const client of this.clients) client.socket.destroy();
    this.clients.clear();
  }

  get connectionCount(): number {
    return this.clients.size;
  }

  private capabilities(): string {
    return ["IMAP4rev1", "LITERAL+", "UIDPLUS", "SPECIAL-USE", "ID", ...(this.options.idle ? ["IDLE"] : [])].join(" ");
  }

  private accept(socket: net.Socket): void {
    const client: Client = { socket, selected: null, idleTag: null, known: 0, buffer: Buffer.alloc(0), literal: null, queue: Promise.resolve() };
    this.clients.add(client);
    socket.on("close", () => this.clients.delete(client));
    socket.on("error", () => this.clients.delete(client));
    socket.on("data", (data) => {
      client.buffer = Buffer.concat([client.buffer, data]);
      this.drain(client);
    });
    if (!this.stalled) this.write(client, `* OK [CAPABILITY ${this.capabilities()}] Fake IMAP ready`);
  }

  private write(client: Client, line: string | Buffer): void {
    if (client.socket.destroyed) return;
    client.socket.write(typeof line === "string" ? line + "\r\n" : line);
  }

  private drain(client: Client): void {
    for (;;) {
      if (client.literal !== null) {
        const { size } = client.literal;
        if (client.buffer.length < size) return;
        const bytes = client.buffer.subarray(0, size);
        const rest = client.buffer.subarray(size);
        const nl = rest.indexOf("\r\n");
        if (nl < 0) return;
        client.buffer = rest.subarray(nl + 2);
        const pending = client.literal;
        client.literal = null;
        this.run(client, () => this.finishAppend(client, pending, Buffer.from(bytes)));
        continue;
      }
      const nl = client.buffer.indexOf("\r\n");
      if (nl < 0) return;
      const line = client.buffer.subarray(0, nl).toString("utf8");
      client.buffer = client.buffer.subarray(nl + 2);
      this.line(client, line);
    }
  }

  private run(client: Client, task: () => Promise<void> | void): void {
    client.queue = client.queue.then(task).catch(() => undefined);
  }

  private line(client: Client, line: string): void {
    if (client.idleTag !== null) {
      if (line.trim().toUpperCase() === "DONE") {
        const tag = client.idleTag;
        client.idleTag = null;
        this.commands.push("DONE");
        if (!this.stalled) this.write(client, `${tag} OK IDLE terminated`);
      }
      return;
    }
    const space = line.indexOf(" ");
    const tag = line.slice(0, space);
    let rest = line.slice(space + 1);
    let command = rest.split(" ")[0]!.toUpperCase();
    if (command === "UID") {
      const second = rest.split(" ")[1]!.toUpperCase();
      command = `UID ${second}`;
      rest = rest.split(" ").slice(2).join(" ");
    } else {
      rest = rest.slice(command.length + 1);
    }
    // APPEND "Sent" (\Seen) {123} or {123+}
    const literal = /\{(\d+)(\+?)\}$/.exec(rest);
    if (command === "APPEND" && literal !== null) {
      const args = tokens(rest.slice(0, literal.index).trim());
      this.commands.push(`APPEND ${args[0]}`);
      client.literal = { tag, mailbox: args[0]!, flags: args.find((a) => a.startsWith("("))?.slice(1, -1).split(" ").filter(Boolean) ?? [], size: Number(literal[1]) };
      if (literal[2] !== "+" && !this.stalled) this.write(client, "+ Ready for literal data");
      return;
    }
    this.commands.push(`${command} ${rest}`.trim());
    if (this.stalled) return;
    this.run(client, () => this.command(client, tag, command, rest));
  }

  private async command(client: Client, tag: string, command: string, rest: string): Promise<void> {
    const ok = (text = `${command} completed`): void => this.write(client, `${tag} OK ${text}`);
    const args = tokens(rest);
    switch (command) {
      case "CAPABILITY":
        this.write(client, `* CAPABILITY ${this.capabilities()}`);
        return ok();
      case "ID":
        this.write(client, '* ID ("name" "Fake IMAP")');
        return ok();
      case "LOGIN":
        if (args[0] === this.options.user && args[1] === this.options.pass) return ok(`[CAPABILITY ${this.capabilities()}] Logged in`);
        return this.write(client, `${tag} NO [AUTHENTICATIONFAILED] Invalid credentials`);
      case "NOOP":
        this.notifyExists(client);
        return ok();
      case "LOGOUT":
        this.write(client, "* BYE Logging out");
        ok();
        client.socket.end();
        return;
      case "LIST":
      case "LSUB":
        // LIST "" "" asks for the hierarchy delimiter (RFC 3501 §6.3.8).
        if (args[1] === "") {
          this.write(client, `* ${command} (\\Noselect) "/" ""`);
          return ok();
        }
        for (const box of this.mailboxes.values()) {
          const flags = ["\\HasNoChildren", ...(box.specialUse !== null && command === "LIST" ? [box.specialUse] : [])].join(" ");
          this.write(client, `* ${command} (${flags}) "/" "${box.name}"`);
        }
        return ok();
      case "CREATE":
        if (!this.mailboxes.has(args[0]!)) this.mailboxes.set(args[0]!, { name: args[0]!, specialUse: null, uidValidity: 1700000100 + this.mailboxes.size, uidNext: 1, messages: [] });
        return ok();
      case "STATUS": {
        const box = this.mailboxes.get(args[0]!);
        if (box === undefined) return this.write(client, `${tag} NO No such mailbox`);
        this.write(client, `* STATUS "${box.name}" (MESSAGES ${box.messages.length} UIDNEXT ${box.uidNext} UIDVALIDITY ${box.uidValidity} UNSEEN ${box.messages.filter((m) => !m.flags.includes("\\Seen")).length})`);
        return ok();
      }
      case "SELECT":
      case "EXAMINE": {
        const box = this.mailboxes.get(args[0]!);
        if (box === undefined) return this.write(client, `${tag} NO No such mailbox`);
        client.selected = box;
        client.known = box.messages.length;
        this.write(client, "* FLAGS (\\Answered \\Flagged \\Deleted \\Seen \\Draft)");
        this.write(client, "* OK [PERMANENTFLAGS (\\Answered \\Flagged \\Deleted \\Seen \\Draft \\*)] Flags permitted");
        this.write(client, `* ${box.messages.length} EXISTS`);
        this.write(client, "* 0 RECENT");
        this.write(client, `* OK [UIDVALIDITY ${box.uidValidity}] UIDs valid`);
        this.write(client, `* OK [UIDNEXT ${box.uidNext}] Predicted next UID`);
        return ok(`[${command === "SELECT" ? "READ-WRITE" : "READ-ONLY"}] ${command} completed`);
      }
      case "IDLE":
        client.idleTag = tag;
        this.write(client, "+ idling");
        this.notifyExists(client);
        return;
      case "UID SEARCH": {
        const box = client.selected!;
        this.write(client, `* SEARCH ${box.messages.map((m) => m.uid).join(" ")}`.trimEnd());
        return ok();
      }
      case "UID FETCH":
        await this.fetch(client, args[0]!, args.slice(1).join(" "));
        return ok();
      case "UID STORE": {
        const box = client.selected!;
        const uids = inSet(args[0]!, box.messages.map((m) => m.uid), box.uidNext - 1);
        const flags = (args[2] ?? "").replace(/[()]/g, "").split(" ").filter(Boolean);
        for (const uid of uids) {
          const index = box.messages.findIndex((m) => m.uid === uid);
          const message = box.messages[index]!;
          for (const flag of flags) if (!message.flags.includes(flag)) message.flags.push(flag);
          if (!args[1]!.toUpperCase().includes("SILENT")) this.write(client, `* ${index + 1} FETCH (UID ${uid} FLAGS (${message.flags.join(" ")}))`);
        }
        return ok();
      }
      case "CLOSE":
        client.selected = null;
        return ok();
      default:
        return this.write(client, `${tag} BAD Unknown command ${command}`);
    }
  }

  /** Tells a client about messages added to its selected mailbox since it last heard. */
  private notifyExists(client: Client): void {
    const box = client.selected;
    if (box !== null && box.messages.length !== client.known) {
      client.known = box.messages.length;
      this.write(client, `* ${box.messages.length} EXISTS`);
    }
  }

  private async fetch(client: Client, set: string, query: string): Promise<void> {
    const box = client.selected!;
    const uids = inSet(set, box.messages.map((m) => m.uid), Math.max(0, box.uidNext - 1));
    const wantsBody = /BODY(\.PEEK)?\[\]/i.test(query);
    for (const uid of uids) {
      const index = box.messages.findIndex((m) => m.uid === uid);
      const message = box.messages[index]!;
      const items = [`UID ${uid}`];
      if (/FLAGS/i.test(query)) items.push(`FLAGS (${message.flags.join(" ")})`);
      if (/INTERNALDATE/i.test(query)) items.push(`INTERNALDATE "${imapDate(message.internalDate)}"`);
      if (wantsBody) {
        if (this.options.delayPerMessageMs > 0) await new Promise((resolve) => setTimeout(resolve, this.options.delayPerMessageMs));
        if (this.stalled || client.socket.destroyed) return new Promise(() => undefined);
        this.write(client, Buffer.concat([Buffer.from(`* ${index + 1} FETCH (${items.join(" ")} BODY[] {${message.raw.length}}\r\n`), message.raw, Buffer.from(")\r\n")]));
      } else {
        this.write(client, `* ${index + 1} FETCH (${items.join(" ")})`);
      }
    }
  }

  private finishAppend(client: Client, pending: NonNullable<Client["literal"]>, raw: Buffer): void {
    if (this.stalled) return;
    const box = this.mailboxes.get(pending.mailbox);
    if (box === undefined) return this.write(client, `${pending.tag} NO [TRYCREATE] No such mailbox`);
    const uid = this.deliver(box.name, raw, { flags: pending.flags });
    this.write(client, `${pending.tag} OK [APPENDUID ${box.uidValidity} ${uid}] APPEND completed`);
  }
}

// ---------------------------------------------------------------- wiring the adapter to the fake server

/** An imapflow client for the adapter that talks plain IMAP to the fake server (tests only). */
export function imapTo(server: FakeImapServer, extra: { autoIdleDelay?: number } = {}): (options: ReturnType<typeof imapOptions>) => ImapClient {
  // imapflow starts IDLE after this quiet time (15 s by default); shorter keeps the tests quick.
  const autoIdleDelay = extra.autoIdleDelay ?? 300;
  return (options) =>
    new ImapFlow({ ...options, host: "127.0.0.1", port: server.port, secure: false, doSTARTTLS: false, logger: false, autoIdleDelay }) as unknown as ImapClient;
}

/** An SMTP transport that records what it would send. */
export class FakeSmtp implements SmtpTransport {
  sent: { envelope: { from: string; to: string[] }; raw: Buffer }[] = [];
  verified = false;
  failVerify: Error | null = null;
  async verify(): Promise<true> {
    if (this.failVerify !== null) throw this.failVerify;
    this.verified = true;
    return true;
  }
  async sendMail(message: { envelope: { from: string; to: string[] }; raw: Buffer }): Promise<unknown> {
    this.sent.push(message);
    return {};
  }
  close(): void {}
}
