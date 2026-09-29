/**
 * The opt-in metadata cache (`--cache-dir`). It keeps what makes the next
 * start faster without downloading every message again: folder, uid, flags
 * and the parsed headers (addresses, date, subject, references, attachment
 * names). It never keeps a body: the text, the text of the ES part and the
 * raw message are left out, and are fetched from the mailbox when needed.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { EsMessage } from "@email-social/es-core";
import type { MailEntry } from "./adapters/types.js";

interface CacheFile {
  version: 1;
  messages: { key: string; entry: MailEntry; message: EsMessage }[];
}

/** The parsed message without any body content. */
export function withoutBodies(message: EsMessage): EsMessage {
  const es = message.es;
  return {
    ...message,
    text: "",
    es: es?.$type === "es.social.post" ? { ...es, text: null } : es,
  };
}

export class MetadataCache {
  private readonly file: string;

  constructor(
    private readonly dir: string,
    account: string,
  ) {
    // One file per account; the name does not show the address.
    this.file = join(dir, `metadata-${createHash("sha256").update(account).digest("hex").slice(0, 16)}.json`);
  }

  async load(): Promise<Map<string, { entry: MailEntry; message: EsMessage }>> {
    const out = new Map<string, { entry: MailEntry; message: EsMessage }>();
    try {
      const data = JSON.parse(await readFile(this.file, "utf8")) as CacheFile;
      if (data.version !== 1 || !Array.isArray(data.messages)) return out;
      for (const m of data.messages) out.set(m.key, { entry: m.entry, message: withoutBodies(m.message) });
    } catch {
      // No cache yet, or an unreadable one: start from the mailbox.
    }
    return out;
  }

  async save(messages: Iterable<{ key: string; entry: MailEntry; message: EsMessage }>): Promise<void> {
    const data: CacheFile = {
      version: 1,
      messages: [...messages].map((m) => ({ key: m.key, entry: m.entry, message: withoutBodies(m.message) })),
    };
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    await writeFile(this.file + ".tmp", JSON.stringify(data), { mode: 0o600 });
    await rename(this.file + ".tmp", this.file);
  }
}
