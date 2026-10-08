/**
 * Extension point for a future badge next to a sender's name. This
 * repository checks no signatures, so it renders nothing: no text, no icon.
 */
export function VerificationBadgeSlot(_props: { address: string }) {
  return null;
}
