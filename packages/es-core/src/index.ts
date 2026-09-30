// Public API of es-core. See README.md.
export type * from "./types.js";
export { extractPart, parseMessage } from "./parse.js";
export { serializeMessage, serializeReceipt, replyTargetOf } from "./serialize.js";
export { threadMessages } from "./threading/thread.js";
export { groupByParticipants } from "./chats.js";
export type { GroupOptions } from "./chats.js";
export { normalizeSubject } from "./threading/subject.js";
export type { NormalizedSubject } from "./threading/subject.js";
export { deriveContacts } from "./contacts.js";
export type { DeriveContactsOptions } from "./contacts.js";
export { canonicalAddress } from "./headers/canonical.js";
export { deriveDid, formatDid, parseDid, isValidDid } from "./did.js";
export type { EsDid } from "./did.js";
export { ES_MEDIA_TYPE, ES_DRAFT_MEDIA_TYPE, ES_TEXT_MAX_BYTES } from "./es/schema.js";
