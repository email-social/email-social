/**
 * The one-click unsubscribe request of RFC 8058: the only request to
 * anyone other than the account's own mail servers that the bridge ever
 * makes, and only when the reader asks to unsubscribe from a story (spec
 * section 12.5).
 *
 * One POST with the body "List-Unsubscribe=One-Click" (RFC 8058 §3.1) and
 * no other header than its type and length: no cookies, no referrer, no
 * user agent. At most one redirect is followed (RFC 8058 §3.2 asks senders
 * not to redirect at all), again with the same POST, and only to https.
 * Everything, redirect included, has 10 seconds.
 */

import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

export const ONE_CLICK_BODY = "List-Unsubscribe=One-Click";
export const ONE_CLICK_TIMEOUT_MS = 10_000;

export interface OneClickOptions {
  timeoutMs?: number;
  /** Tests only: where the request really goes (a local server instead of the sender's). */
  rewrite?: (url: URL) => URL;
}

/** The answer: the final status and the URL that gave it. */
export interface OneClickResult {
  status: number;
  url: string;
}

function post(url: URL, signal: AbortSignal): Promise<{ status: number; location: string | null }> {
  return new Promise((resolve, reject) => {
    const send = url.protocol === "https:" ? httpsRequest : httpRequest;
    const req = send(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "content-length": String(Buffer.byteLength(ONE_CLICK_BODY)) },
      agent: false,
      signal,
    });
    req.on("response", (res) => {
      const location = typeof res.headers.location === "string" ? res.headers.location : null;
      res.resume();
      res.on("end", () => resolve({ status: res.statusCode ?? 0, location }));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.end(ONE_CLICK_BODY);
  });
}

/**
 * Sends the one-click request to an https URI. Resolves on a 2xx answer;
 * rejects with a sentence for the reader otherwise.
 */
export async function oneClickUnsubscribe(uri: string, options: OneClickOptions = {}): Promise<OneClickResult> {
  let url = new URL(uri);
  if (url.protocol !== "https:") throw new Error("A one-click unsubscribe needs an https address (RFC 8058)");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? ONE_CLICK_TIMEOUT_MS);
  try {
    for (let redirects = 0; ; redirects++) {
      const target = options.rewrite?.(url) ?? url;
      let answer: { status: number; location: string | null };
      try {
        answer = await post(target, controller.signal);
      } catch (e) {
        if (controller.signal.aborted) throw new Error(`${url.host} did not answer in time`);
        throw new Error(`Could not reach ${url.host}: ${e instanceof Error ? e.message : String(e)}`);
      }
      if (answer.status >= 200 && answer.status < 300) return { status: answer.status, url: url.href };
      if (answer.status >= 300 && answer.status < 400 && answer.location !== null) {
        if (redirects >= 1) throw new Error(`${url.host} redirected the request more than once`);
        const next = new URL(answer.location, url);
        if (next.protocol !== "https:") throw new Error(`${url.host} redirected the request away from https`);
        url = next;
        continue;
      }
      throw new Error(`${url.host} answered the unsubscribe request with status ${answer.status}`);
    }
  } finally {
    clearTimeout(timer);
  }
}
