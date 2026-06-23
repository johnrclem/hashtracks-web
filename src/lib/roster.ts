import { resolveAvatarSrc, type AvatarSource } from "@/lib/avatar";

/** An opted-in (PUBLIC) self check-in. Always backed by a registered user. */
export interface RosterAttendee extends AvatarSource {
  userId: string;
  hashName: string | null;
}

/** A hare credit. May be unlinked (no user); always shown regardless of privacy. */
export interface RosterHare extends AvatarSource {
  userId: string | null;
  hareName: string;
  /** Linked user's public hash name, if the hare is a registered user. */
  hashName?: string | null;
  role: string;
}

/** A unified roster row ready to render. */
export interface RosterEntry {
  key: string;
  userId: string | null;
  name: string;
  avatarSrc: string | null;
  isHare: boolean;
  hareRole: string | null;
}

/**
 * Build the public attendee roster for a PAST event.
 *
 * Inputs are already privacy-filtered by the caller: `attendees` contains only
 * hashers who opted in (PUBLIC) and checked in; `hares` are always public
 * (a private hasher who hared still appears — that's the #110 contract).
 *
 * Hares win over a duplicate self check-in (deduped by userId and badged as a
 * hare). Hares sort first, then attendees, each group alphabetical by name.
 */
export function assemblePastEventRoster(input: {
  attendees: RosterAttendee[];
  hares: RosterHare[];
}): RosterEntry[] {
  const entries: RosterEntry[] = [];
  const hareUserIds = new Set<string>();

  for (const hare of input.hares) {
    if (hare.userId) hareUserIds.add(hare.userId);
    entries.push({
      key: hare.userId ? `u:${hare.userId}` : `h:${hare.hareName}`,
      userId: hare.userId,
      name: hare.hashName?.trim() || hare.hareName.trim() || "Hare",
      avatarSrc: resolveAvatarSrc(hare),
      isHare: true,
      hareRole: hare.role,
    });
  }

  // Attendees may arrive from more than one source (self check-in + misman-
  // recorded), so dedup by userId here too — not just against hares.
  const seenAttendee = new Set<string>();
  for (const att of input.attendees) {
    if (hareUserIds.has(att.userId)) continue; // hare credit already covers them
    if (seenAttendee.has(att.userId)) continue;
    seenAttendee.add(att.userId);
    entries.push({
      key: `u:${att.userId}`,
      userId: att.userId,
      name: att.hashName?.trim() || "Hasher",
      avatarSrc: resolveAvatarSrc(att),
      isHare: false,
      hareRole: null,
    });
  }

  return entries.sort((a, b) => {
    if (a.isHare !== b.isHare) return a.isHare ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}
