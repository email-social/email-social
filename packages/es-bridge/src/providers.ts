/**
 * Server settings of providers whose users are likely to try Email Social.
 * Both use implicit TLS (IMAP 993, SMTP 465) and app passwords.
 */
import type { ProviderPreset } from "./api-types.js";

export const PRESETS: readonly ProviderPreset[] = [
  {
    id: "gmail",
    label: "Gmail",
    imap: { host: "imap.gmail.com", port: 993, security: "tls" },
    smtp: { host: "smtp.gmail.com", port: 465, security: "tls" },
    // Gmail keeps a copy of everything sent through smtp.gmail.com in "Sent Mail".
    appendToSent: false,
    hint: "Use an app password: Google Account → Security → 2-Step Verification → App passwords.",
  },
  {
    id: "seznam",
    label: "Seznam.cz",
    imap: { host: "imap.seznam.cz", port: 993, security: "tls" },
    smtp: { host: "smtp.seznam.cz", port: 465, security: "tls" },
    appendToSent: true,
    hint: "Allow IMAP access in the Seznam.cz e-mail settings; with two-step login, use an app password.",
  },
  {
    id: "other",
    label: "Other provider (IMAP and SMTP)",
    imap: { host: "", port: 993, security: "tls" },
    smtp: { host: "", port: 465, security: "tls" },
    appendToSent: true,
    hint: "Use the IMAP and SMTP settings your provider publishes.",
  },
];
