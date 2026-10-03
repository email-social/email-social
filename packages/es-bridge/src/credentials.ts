/**
 * Where a signed-in account's settings and password live.
 *
 * By default only in memory, for the life of the process. When the user
 * ticks "remember on this device", they are stored in the operating
 * system's keychain (macOS Keychain, Windows Credential Manager, Secret
 * Service on Linux) through @napi-rs/keyring, never in a plain file.
 */
import type { ServerSettings } from "./api-types.js";

export interface AccountConfig {
  address: string;
  name: string;
  /** Login name; the address when empty. */
  username: string;
  password: string;
  imap: ServerSettings;
  smtp: ServerSettings;
  appendToSent: boolean;
}

export interface CredentialStore {
  /** Whether a keychain can be used on this system. */
  available(): Promise<boolean>;
  load(): Promise<AccountConfig | null>;
  save(config: AccountConfig): Promise<void>;
  clear(): Promise<void>;
}

const SERVICE = "email-social";
const ACCOUNT = "account";

function isConfig(value: unknown): value is AccountConfig {
  const v = value as AccountConfig | null;
  return typeof v?.address === "string" && typeof v.password === "string" && typeof v.imap?.host === "string" && typeof v.smtp?.host === "string";
}

type EntryConstructor = new (service: string, user: string) => {
  getPassword(): Promise<string | undefined | null>;
  setPassword(password: string): Promise<void>;
  deletePassword(): Promise<boolean>;
};

/** The OS keychain. If the native module cannot load, `available()` is false and nothing is stored. */
export class KeychainStore implements CredentialStore {
  private entry: Promise<InstanceType<EntryConstructor> | null> | null = null;

  private open(): Promise<InstanceType<EntryConstructor> | null> {
    this.entry ??= import("@napi-rs/keyring")
      .then((m) => new (m.AsyncEntry as unknown as EntryConstructor)(SERVICE, ACCOUNT))
      .catch(() => null);
    return this.entry;
  }

  async available(): Promise<boolean> {
    return (await this.open()) !== null;
  }

  async load(): Promise<AccountConfig | null> {
    try {
      const value = await (await this.open())?.getPassword();
      if (typeof value !== "string") return null;
      const parsed: unknown = JSON.parse(value);
      return isConfig(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  async save(config: AccountConfig): Promise<void> {
    const entry = await this.open();
    if (entry === null) throw new Error("No keychain is available on this system");
    await entry.setPassword(JSON.stringify(config));
  }

  async clear(): Promise<void> {
    try {
      await (await this.open())?.deletePassword();
    } catch {
      // Nothing stored.
    }
  }
}

/** Keeps nothing beyond the process; for tests and systems without a keychain. */
export class MemoryStore implements CredentialStore {
  constructor(private value: AccountConfig | null = null) {}
  async available(): Promise<boolean> {
    return true;
  }
  async load(): Promise<AccountConfig | null> {
    return this.value;
  }
  async save(config: AccountConfig): Promise<void> {
    this.value = config;
  }
  async clear(): Promise<void> {
    this.value = null;
  }
}
