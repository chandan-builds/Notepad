import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TURN_FREE_EGRESS_BYTES,
  egressBytesFromUsage,
  monthlyTurnEgress,
  resetTurnQuotaCache,
  turnMonthWindow,
  turnRelayEnabled,
  withinFreeAllowance,
} from "@/webrtc/turn-quota";

const accountId = "a".repeat(32);

afterEach(() => {
  resetTurnQuotaCache();
  vi.unstubAllEnvs();
});

describe("TURN free allowance", () => {
  it("uses the UTC calendar month", () => {
    expect(turnMonthWindow(new Date("2026-10-14T18:30:00.000Z"))).toEqual({
      from: "2026-10-01",
      to: "2026-10-14",
    });
    expect(turnMonthWindow(new Date("2026-11-01T00:30:00.000Z"))).toEqual({
      from: "2026-11-01",
      to: "2026-11-01",
    });
  });

  it("allows relay use until monthly egress reaches 1,000 GB", () => {
    expect(withinFreeAllowance(0)).toBe(true);
    expect(withinFreeAllowance(TURN_FREE_EGRESS_BYTES - 1)).toBe(true);
    expect(withinFreeAllowance(TURN_FREE_EGRESS_BYTES)).toBe(false);
    expect(withinFreeAllowance(TURN_FREE_EGRESS_BYTES + 1)).toBe(false);
  });

  it("sums hourly egress and rejects a truncated or failed reading", () => {
    expect(
      egressBytesFromUsage({
        data: {
          viewer: {
            accounts: [
              {
                callsTurnUsageAdaptiveGroups: [{ sum: { egressBytes: 40 } }, { sum: { egressBytes: "60" } }],
              },
            ],
          },
        },
      }),
    ).toBe(100);
    expect(egressBytesFromUsage({ data: { viewer: { accounts: [{ callsTurnUsageAdaptiveGroups: [] }] } } })).toBe(0);
    expect(egressBytesFromUsage({ errors: [{ message: "nope" }] })).toBeNull();
    expect(egressBytesFromUsage({ data: { viewer: { accounts: [] } } })).toBeNull();
    expect(
      egressBytesFromUsage({
        data: {
          viewer: {
            accounts: [
              {
                callsTurnUsageAdaptiveGroups: Array.from({ length: 10_000 }, () => ({ sum: { egressBytes: 1 } })),
              },
            ],
          },
        },
      }),
    ).toBeNull();
  });

  it("keeps the relay on when usage is not metered", async () => {
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "");
    vi.stubEnv("CLOUDFLARE_ANALYTICS_API_TOKEN", "");
    const fetchImpl = vi.fn<typeof fetch>();
    expect(await turnRelayEnabled(fetchImpl)).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("stops the relay at the cap and caches the reading", async () => {
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", accountId);
    vi.stubEnv("CLOUDFLARE_ANALYTICS_API_TOKEN", "analytics-token");
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json({
        data: {
          viewer: {
            accounts: [{ callsTurnUsageAdaptiveGroups: [{ sum: { egressBytes: TURN_FREE_EGRESS_BYTES } }] }],
          },
        },
      }),
    );

    expect(await turnRelayEnabled(fetchImpl)).toBe(false);
    expect(await turnRelayEnabled(fetchImpl)).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    resetTurnQuotaCache();
    fetchImpl.mockResolvedValue(
      Response.json({
        data: { viewer: { accounts: [{ callsTurnUsageAdaptiveGroups: [{ sum: { egressBytes: 12 } }] }] } },
      }),
    );
    expect(await turnRelayEnabled(fetchImpl)).toBe(true);
  });

  it("stops the relay when the usage check fails", async () => {
    const egress = await monthlyTurnEgress({
      accountId,
      token: "analytics-token",
      now: new Date("2026-10-14T00:00:00.000Z"),
      fetchImpl: vi.fn<typeof fetch>(async () => new Response("no", { status: 401 })),
    });
    expect(egress).toBeNull();
  });
});
