/**
 * The account's settings: the senders whose stories are hidden, and which
 * receipts the account sends (spec section 15, RC-8). One JSON file per
 * account, readable by its owner only (mode 0600), in the settings
 * directory (`--cache-dir` when given, else the user's configuration
 * directory); without a directory they live in memory for the session.
 *
 * The file holds addresses of senders and one word; never message content.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { canonicalAddress } from "@email-social/es-core";
import { RECEIPT_SETTINGS, type ReceiptSetting } from "./session.js";

interface SettingsFile {
  version: 1;
  /** Canonical addresses of senders whose stories are not shown, sorted. */
  hidden: string[];
  receipts?: ReceiptSetting;
}

/** Where settings are kept when no `--cache-dir` is given: $XDG_CONFIG_HOME, %APPDATA% or ~/.config, then email-social. */
export function defaultSettingsDir(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, home: string = homedir()): string {
  if (platform === "win32" && env.APPDATA) return join(env.APPDATA, "email-social");
  return join(env.XDG_CONFIG_HOME || join(home, ".config"), "email-social");
}

export class AccountSettings {
  private hiddenSet = new Set<string>();
  private receiptSetting: ReceiptSetting | null = null;

  private constructor(private readonly file: string | null) {}

  /** The settings of `account` in `dir` (null: memory only). An unreadable file counts as no settings. */
  static async open(dir: string | null, account: string): Promise<AccountSettings> {
    // One file per account; the name does not show the address.
    const file = dir === null ? null : join(dir, `settings-${createHash("sha256").update(canonicalAddress(account)).digest("hex").slice(0, 16)}.json`);
    const settings = new AccountSettings(file);
    if (file !== null) {
      try {
        const data = JSON.parse(await readFile(file, "utf8")) as Partial<SettingsFile>;
        if (data.version === 1) {
          if (Array.isArray(data.hidden)) for (const a of data.hidden) if (typeof a === "string" && a.includes("@")) settings.hiddenSet.add(canonicalAddress(a));
          settings.receiptSetting = RECEIPT_SETTINGS.find((s) => s === data.receipts) ?? null;
        }
      } catch {
        // No settings yet.
      }
    }
    return settings;
  }

  /** Senders whose stories are hidden, sorted. */
  get hidden(): string[] {
    return [...this.hiddenSet].sort();
  }

  isHidden(address: string): boolean {
    return this.hiddenSet.has(canonicalAddress(address));
  }

  /** The stored receipt setting, or null when none was ever chosen. */
  get receipts(): ReceiptSetting | null {
    return this.receiptSetting;
  }

  async hide(address: string): Promise<void> {
    this.hiddenSet.add(canonicalAddress(address));
    await this.save();
  }

  async unhide(address: string): Promise<void> {
    this.hiddenSet.delete(canonicalAddress(address));
    await this.save();
  }

  async setReceipts(setting: ReceiptSetting): Promise<void> {
    this.receiptSetting = setting;
    await this.save();
  }

  private async save(): Promise<void> {
    if (this.file === null) return;
    const data: SettingsFile = { version: 1, hidden: this.hidden, ...(this.receiptSetting !== null ? { receipts: this.receiptSetting } : {}) };
    await mkdir(join(this.file, ".."), { recursive: true, mode: 0o700 });
    await writeFile(this.file + ".tmp", JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
    await rename(this.file + ".tmp", this.file);
  }
}
