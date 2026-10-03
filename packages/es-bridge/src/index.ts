// es-bridge as a library: start the local service, or use its parts.
export { startBridge, type BridgeOptions, type RunningBridge } from "./bridge.js";
export { MailSession, type SessionOptions } from "./session.js";
export { MaildirAdapter } from "./adapters/maildir.js";
export { ImapSmtpAdapter } from "./adapters/imap-smtp.js";
export type { MailboxAdapter, MailEntry, MailRef, MailboxChanges, Envelope } from "./adapters/types.js";
export { KeychainStore, MemoryStore, type AccountConfig, type CredentialStore } from "./credentials.js";
export { MetadataCache } from "./cache.js";
export { buildDemoMailbox, writeDemoMaildir, DEMO_ACCOUNT } from "./demo.js";
export type * from "./api-types.js";
