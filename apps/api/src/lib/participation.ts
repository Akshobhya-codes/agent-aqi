/**
 * participation.ts — In-memory battle participation store.
 *
 * Tracks which addresses predicted which agent in each battle.
 * Capped at MAX_PER_BATTLE entries per battle (oldest evicted).
 * Nicknames are resolved lazily from the profile store at read time.
 */

import { lookupNickname } from "./profiles";

export interface Participant {
  address:   string;
  agentId:   string;
  txHash?:   string;
  timestamp: number;
  nickname?: string;
}

const MAX_PER_BATTLE = 200;

// battleId -> ordered participant list
const store = new Map<string, Participant[]>();

/** Record or update a participant. Upserts by address (most recent prediction wins). */
export function recordParticipant(
  battleId:    string,
  participant: Omit<Participant, "nickname">,
): void {
  if (!store.has(battleId)) store.set(battleId, []);
  const list      = store.get(battleId)!;
  const addrLower = participant.address.toLowerCase();

  const idx = list.findIndex((p) => p.address === addrLower);
  const entry: Participant = { ...participant, address: addrLower };

  if (idx !== -1) {
    list[idx] = entry; // update in place
  } else {
    list.push(entry);
    if (list.length > MAX_PER_BATTLE) list.shift(); // drop oldest
  }
}

/** Get participants for a battle with nicknames resolved. */
export function getParticipants(battleId: string): Participant[] {
  return (store.get(battleId) ?? []).map((p) => ({
    ...p,
    nickname: lookupNickname(p.address) ?? p.nickname,
  }));
}
