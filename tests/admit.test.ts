import { describe, expect, it } from "vitest";
import { admitPeers } from "@/webrtc/admit";
import type { RosterEntry } from "@/types/signaling";

function entry(id: string, joinedAt: number): RosterEntry {
  return { id, joinedAt };
}

describe("peer admission", () => {
  it("keeps the eight earliest peers and refuses the ninth", () => {
    const roster = Array.from({ length: 9 }, (_, index) =>
      entry(`00000000-0000-4000-8000-00000000000${index}`, index + 1),
    );
    const newest = roster[8]!.id;
    const earliest = roster[0]!.id;
    expect(admitPeers(roster, newest).roomFull).toBe(true);
    expect(admitPeers(roster, newest).remoteIds).toEqual([]);

    const admitted = admitPeers(roster, earliest);
    expect(admitted.roomFull).toBe(false);
    expect(admitted.remoteIds).toHaveLength(7);
    expect(admitted.remoteIds).not.toContain(newest);
  });

  it("breaks a join-time tie by peer id", () => {
    const roster = [
      entry("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", 5),
      entry("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", 5),
    ];
    const admitted = admitPeers(roster, roster[0]!.id, 2);
    expect(admitted.remoteIds).toEqual(["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"]);
  });
});
