/**
 * Records every outbound connection and DNS query of this process and lets
 * none through except loopback connections to the ports the test allows (its
 * own requests to the bridge). Every TCP/TLS client in Node (net, tls, http,
 * https, fetch/undici, ws, imapflow, nodemailer) goes through
 * net.Socket.prototype.connect; DNS goes through the dns module.
 */
import dns from "node:dns";
import net from "node:net";

export interface Attempt {
  kind: "connect" | "dns";
  host: string;
  port: number | null;
}

const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);

export function guardNetwork(allowPorts: () => readonly number[]): { attempts: Attempt[]; restore(): void } {
  const attempts: Attempt[] = [];
  const originalConnect = net.Socket.prototype.connect;
  const originals = {
    lookup: dns.lookup,
    resolve: dns.resolve,
    resolve4: dns.resolve4,
    resolve6: dns.resolve6,
    promisesLookup: dns.promises.lookup,
    promisesResolve: dns.promises.resolve,
    promisesResolve4: dns.promises.resolve4,
    promisesResolve6: dns.promises.resolve6,
  };

  net.Socket.prototype.connect = function (this: net.Socket, ...args: unknown[]): net.Socket {
    const first = args[0];
    let host = "localhost";
    let port: number | null = null;
    if (Array.isArray(first)) {
      // Internal form: [options, callback].
      const options = first[0] as { host?: string; port?: number; path?: string };
      host = options.path ?? options.host ?? "localhost";
      port = options.port ?? null;
    } else if (typeof first === "object" && first !== null) {
      const options = first as { host?: string; port?: number; path?: string };
      host = options.path ?? options.host ?? "localhost";
      port = options.port ?? null;
    } else if (typeof first === "number" || (typeof first === "string" && /^\d+$/.test(first))) {
      port = Number(first);
      host = typeof args[1] === "string" ? args[1] : "localhost";
    } else if (typeof first === "string") {
      host = first;
    }
    // Clients pass the port as a number or a string.
    port = port === null || Number.isNaN(Number(port)) ? null : Number(port);
    if (LOOPBACK.has(host) && port !== null && allowPorts().includes(port)) {
      return (originalConnect as (...a: unknown[]) => net.Socket).apply(this, args);
    }
    attempts.push({ kind: "connect", host, port });
    process.nextTick(() => this.destroy(Object.assign(new Error(`connect ECONNREFUSED ${host}:${port} (blocked by the test)`), { code: "ECONNREFUSED" })));
    return this;
  } as typeof net.Socket.prototype.connect;

  const blockedDns = (host: string): Error => Object.assign(new Error(`queryA ENOTFOUND ${host} (blocked by the test)`), { code: "ENOTFOUND", hostname: host });
  // Names of this machine itself (the test's own client, the server's listen address) resolve locally.
  const callbackDns = (name: keyof typeof originals) =>
    function (host: string, ...rest: unknown[]): void {
      if (LOOPBACK.has(host)) return (originals[name] as (...a: unknown[]) => void)(host, ...rest);
      attempts.push({ kind: "dns", host, port: null });
      const callback = rest[rest.length - 1] as (e: Error) => void;
      process.nextTick(() => callback(blockedDns(host)));
    };
  const promiseDns = (name: keyof typeof originals) =>
    async function (host: string, ...rest: unknown[]): Promise<unknown> {
      if (LOOPBACK.has(host)) return (originals[name] as (...a: unknown[]) => Promise<unknown>)(host, ...rest);
      attempts.push({ kind: "dns", host, port: null });
      throw blockedDns(host);
    };
  Object.assign(dns, { lookup: callbackDns("lookup"), resolve: callbackDns("resolve"), resolve4: callbackDns("resolve4"), resolve6: callbackDns("resolve6") });
  Object.assign(dns.promises, {
    lookup: promiseDns("promisesLookup"),
    resolve: promiseDns("promisesResolve"),
    resolve4: promiseDns("promisesResolve4"),
    resolve6: promiseDns("promisesResolve6"),
  });

  return {
    attempts,
    restore(): void {
      net.Socket.prototype.connect = originalConnect;
      Object.assign(dns, { lookup: originals.lookup, resolve: originals.resolve, resolve4: originals.resolve4, resolve6: originals.resolve6 });
      Object.assign(dns.promises, {
        lookup: originals.promisesLookup,
        resolve: originals.promisesResolve,
        resolve4: originals.promisesResolve4,
        resolve6: originals.promisesResolve6,
      });
    },
  };
}
