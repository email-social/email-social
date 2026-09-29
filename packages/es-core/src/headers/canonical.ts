/**
 * Canonical form of an e-mail address, used as the identity of a contact and
 * of a participant.
 *
 * Only the domain is lowercased. RFC 5321 §2.4 says the local part "MUST BE
 * treated as case sensitive" and that its meaning belongs to the receiving
 * host alone, while domain names are case-insensitive (RFC 4343). Folding the
 * local part could merge two different mailboxes on a host that
 * distinguishes them; not folding it at worst shows one person twice.
 */
export function canonicalAddress(input: string): string {
  let address = input.trim();
  if (address.startsWith("<") && address.endsWith(">")) address = address.slice(1, -1).trim();
  const at = address.lastIndexOf("@");
  if (at <= 0 || at === address.length - 1) return address;
  return address.slice(0, at) + "@" + address.slice(at + 1).toLowerCase();
}

/** Local part and domain of a canonical address, or null when there is no "@". */
export function splitAddress(address: string): { local: string; domain: string } | null {
  const at = address.lastIndexOf("@");
  if (at <= 0 || at === address.length - 1) return null;
  return { local: address.slice(0, at), domain: address.slice(at + 1) };
}
