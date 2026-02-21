/**
 * profiles.ts — In-memory wallet profile store (hackathon grade).
 *
 * Keyed by lowercase Ethereum address.
 * Survives as long as the API process is running.
 */

export interface Profile {
  address:   string;
  nickname?: string;
  color?:    string;
  createdAt: number;
  lastSeenAt: number;
}

const profiles = new Map<string, Profile>();

/** Get or create a profile, bumping lastSeenAt. */
export function getOrCreateProfile(address: string): Profile {
  const addr = address.toLowerCase();
  if (!profiles.has(addr)) {
    profiles.set(addr, {
      address:    addr,
      createdAt:  Date.now(),
      lastSeenAt: Date.now(),
    });
  }
  const p = profiles.get(addr)!;
  p.lastSeenAt = Date.now();
  return p;
}

/** Update editable fields. Trims nickname to 24 chars. */
export function updateProfile(
  address: string,
  updates: Partial<Pick<Profile, "nickname" | "color">>,
): Profile {
  const profile = getOrCreateProfile(address);
  if (updates.nickname !== undefined) {
    const trimmed = updates.nickname.trim().slice(0, 24);
    profile.nickname = trimmed.length > 0 ? trimmed : undefined;
  }
  if (updates.color !== undefined) {
    profile.color = updates.color;
  }
  return profile;
}

/** Lightweight lookup for nickname enrichment — returns undefined if no profile. */
export function lookupNickname(address: string): string | undefined {
  return profiles.get(address.toLowerCase())?.nickname;
}
