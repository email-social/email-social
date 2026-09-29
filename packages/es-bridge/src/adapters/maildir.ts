/**
 * A mailbox kept as plain files, for tests and for trying Email Social
 * offline:
 *
 *   <root>/INBOX/*.eml      received messages
 *   <root>/Sent/*.eml       sent messages (appendToSent writes here)
 *   <root>/Outbox/*.eml     what `send` would have sent (nothing goes on the network)
 *   <folder>/.email-social-flags.json   flags per file name, e.g. {"a.eml": ["\\Seen"]}
 *
 * Any .eml file dropped into INBOX shows up as an unread message. This is the
 * "directory of .eml files" the task describes, not the cur/new/tmp Maildir
 * layout of mail servers.
 */

import { randomBytes } from "node:crypto";
import { readdirSync, watch as fsWatch, type FSWatcher } from "node:fs";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { SEEN, type Envelope, type FolderRole, type MailboxAdapter, type MailboxChanges, type MailEntry, type MailRef } from "./types.js";

const FOLDER_DIRS: Record<FolderRole, string> = { inbox: "INBOX", sent: "Sent" };
const OUTBOX = "Outbox";
const FLAGS_FILE = ".email-social-flags.json";

export interface MaildirOptions {
  /** How often to look for new files, in ms (fs.watch is used too, where the platform supports it). */
  pollMs?: number;
  /** File name for a new message; defaults to a time stamp and random suffix. */
  newName?: () => string;
}

type Flags = Record<string, string[]>;

/** A plain file name ending in .eml: no path separators, no leading dot. */
function isMessageName(name: string): boolean {
  return /^[^/\\.][^/\\]*\.eml$/i.test(name) && !name.includes("..");
}

function defaultName(): string {
  return `${new Date().toISOString().replace(/[-:.]/g, "")}-${randomBytes(6).toString("hex")}.eml`;
}

export class MaildirAdapter implements MailboxAdapter {
  readonly keepsKeywords = true;
  private readonly pollMs: number;
  private readonly newName: () => string;
  private readonly generations = new Map<string, Set<string>>();
  private generation = 0;
  private readonly stops = new Set<() => void>();

  constructor(
    private readonly root: string,
    options: MaildirOptions = {},
  ) {
    this.pollMs = options.pollMs ?? 2000;
    this.newName = options.newName ?? defaultName;
  }

  private dir(folder: FolderRole | typeof OUTBOX): string {
    return join(this.root, folder === OUTBOX ? OUTBOX : FOLDER_DIRS[folder]);
  }

  private file(ref: MailRef): string {
    if (!isMessageName(ref.uid)) throw new Error(`Not a message file name: ${JSON.stringify(ref.uid)}`);
    return join(this.dir(ref.folder), ref.uid);
  }

  async open(): Promise<void> {
    for (const folder of ["inbox", "sent", OUTBOX] as const) await mkdir(this.dir(folder), { recursive: true });
  }

  private async readFlags(folder: FolderRole): Promise<Flags> {
    try {
      const parsed: unknown = JSON.parse(await readFile(join(this.dir(folder), FLAGS_FILE), "utf8"));
      return typeof parsed === "object" && parsed !== null ? (parsed as Flags) : {};
    } catch {
      return {};
    }
  }

  private async writeFlags(folder: FolderRole, flags: Flags): Promise<void> {
    const path = join(this.dir(folder), FLAGS_FILE);
    await writeFile(path + ".tmp", JSON.stringify(flags, null, 2) + "\n");
    await rename(path + ".tmp", path);
  }

  private async names(folder: FolderRole): Promise<string[]> {
    const all = await readdir(this.dir(folder));
    return all.filter(isMessageName).sort();
  }

  async listSince(cursor: string | null): Promise<MailboxChanges> {
    const known = cursor === null ? undefined : this.generations.get(cursor);
    const current = new Set<string>();
    const entries: MailEntry[] = [];
    for (const folder of ["inbox", "sent"] as const) {
      const flags = await this.readFlags(folder);
      for (const uid of await this.names(folder)) {
        const key = `${folder}/${uid}`;
        current.add(key);
        if (known?.has(key)) continue;
        const own = flags[uid];
        entries.push({ folder, uid, flags: Array.isArray(own) ? own.filter((f) => typeof f === "string") : [] });
      }
    }
    const next = `gen-${++this.generation}`;
    this.generations.clear();
    this.generations.set(next, current);
    return { entries, complete: known === undefined, cursor: next };
  }

  async fetchRaw(ref: MailRef): Promise<Uint8Array> {
    return new Uint8Array(await readFile(this.file(ref)));
  }

  async addFlags(ref: MailRef, add: readonly string[]): Promise<void> {
    this.file(ref);
    const flags = await this.readFlags(ref.folder);
    const own = flags[ref.uid] ?? [];
    for (const flag of add) if (!own.includes(flag)) own.push(flag);
    flags[ref.uid] = own;
    await this.writeFlags(ref.folder, flags);
  }

  /** Writes to a temporary name first, so a watcher never sees half a message. */
  private async writeMessage(dir: string, raw: Uint8Array): Promise<string> {
    const name = this.newName();
    if (!isMessageName(name)) throw new Error(`Not a message file name: ${name}`);
    await writeFile(join(dir, "." + name + ".tmp"), raw, { flag: "wx" });
    await rename(join(dir, "." + name + ".tmp"), join(dir, name));
    return name;
  }

  async appendToSent(raw: Uint8Array): Promise<MailEntry> {
    const uid = await this.writeMessage(this.dir("sent"), raw);
    await this.addFlags({ folder: "sent", uid }, [SEEN]);
    return { folder: "sent", uid, flags: [SEEN] };
  }

  async send(raw: Uint8Array, _envelope: Envelope): Promise<void> {
    await this.writeMessage(this.dir(OUTBOX), raw);
  }

  /** The folder contents as one string; taken synchronously so no file slips in before watching starts. */
  private signatureSync(): string {
    const list = (folder: FolderRole): string[] => readdirSync(this.dir(folder)).filter(isMessageName).sort();
    return [...list("inbox"), "|", ...list("sent")].join("\n");
  }

  watch(onChange: () => void): () => void {
    let signature = this.signatureSync();
    let stopped = false;
    const check = async (): Promise<void> => {
      const names = [...(await this.names("inbox")), "|", ...(await this.names("sent"))].join("\n");
      if (!stopped && names !== signature) {
        signature = names;
        onChange();
      }
    };
    const timer = setInterval(() => void check().catch(() => undefined), this.pollMs);
    const watchers: FSWatcher[] = [];
    for (const folder of ["inbox", "sent"] as const) {
      try {
        watchers.push(fsWatch(this.dir(folder), () => void check().catch(() => undefined)));
      } catch {
        // Polling alone still finds new files.
      }
    }
    const stop = (): void => {
      stopped = true;
      clearInterval(timer);
      for (const w of watchers) w.close();
      this.stops.delete(stop);
    };
    this.stops.add(stop);
    return stop;
  }

  async close(): Promise<void> {
    for (const stop of [...this.stops]) stop();
  }
}
