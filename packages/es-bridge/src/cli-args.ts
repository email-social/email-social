/** Command-line options of `email-social`. */

export interface CliOptions {
  demo: boolean;
  open: boolean;
  port: number;
  help: boolean;
  maildir: string | null;
  address: string | null;
  name: string | null;
  cacheDir: string | null;
  maxMessages: number;
}

export const USAGE = `Usage: email-social [options]

Starts Email Social on http://127.0.0.1:<random port> and opens it in the browser.
Without options you sign in to your IMAP/SMTP account in the page.

  --demo                 use a demo mailbox in a temporary folder (no account, no network)
  --maildir <dir>        use a folder of .eml files (INBOX/, Sent/) instead of an account
  --address <address>    your address in that folder (required with --maildir)
  --name <name>          your display name (with --maildir)
  --cache-dir <dir>      keep message metadata (never bodies) there to start faster
  --port <number>        listen on this port instead of a random one
  --no-open              do not open the browser
  --max-messages <n>     newest messages to load per IMAP folder (default 500)
  --help                 show this text
`;

export function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = { demo: false, open: true, port: 0, help: false, maildir: null, address: null, name: null, cacheDir: null, maxMessages: 500 };
  const args = argv.flatMap((a) => (a.startsWith("--") && a.includes("=") ? [a.slice(0, a.indexOf("=")), a.slice(a.indexOf("=") + 1)] : [a]));
  const value = (i: number, name: string): string => {
    const v = args[i + 1];
    if (v === undefined || v.startsWith("--")) throw new Error(`${name} needs a value`);
    return v;
  };
  const integer = (text: string, name: string, max: number): number => {
    const n = Number(text);
    if (!Number.isInteger(n) || n < 0 || n > max) throw new Error(`${name} must be a whole number up to ${max}`);
    return n;
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    switch (arg) {
      case "--demo":
        options.demo = true;
        break;
      case "--no-open":
        options.open = false;
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      case "--maildir":
        options.maildir = value(i++, arg);
        break;
      case "--address":
        options.address = value(i++, arg);
        break;
      case "--name":
        options.name = value(i++, arg);
        break;
      case "--cache-dir":
        options.cacheDir = value(i++, arg);
        break;
      case "--port":
        options.port = integer(value(i++, arg), arg, 65535);
        break;
      case "--max-messages":
        options.maxMessages = integer(value(i++, arg), arg, 1_000_000);
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }
  if (options.maildir !== null && options.address === null) throw new Error("--maildir needs --address");
  if (options.demo && options.maildir !== null) throw new Error("Use either --demo or --maildir");
  return options;
}
