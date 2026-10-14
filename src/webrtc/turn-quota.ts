/** Billed Realtime egress. The first 1,000 GB each UTC month is free; Cloudflare counts decimal gigabytes. */
export const TURN_FREE_EGRESS_BYTES = 1_000_000_000_000;

const USAGE_GROUP_LIMIT = 10_000;
const CACHE_MS = 60_000;
const USAGE_TIMEOUT_MS = 1_200;
const GRAPHQL_URL = "https://api.cloudflare.com/client/v4/graphql";

const TURN_EGRESS_QUERY = `
  query TurnEgress($accountTag: string, $from: Date, $to: Date) {
    viewer {
      accounts(filter: { accountTag: $accountTag }) {
        callsTurnUsageAdaptiveGroups(
          limit: ${USAGE_GROUP_LIMIT}
          filter: { date_geq: $from, date_leq: $to }
        ) {
          dimensions { datetimeHour }
          sum { egressBytes }
        }
      }
    }
  }
`;

type TurnUsageGroup = { sum?: { egressBytes?: number | string | null } | null };
type TurnUsageResponse = {
  errors?: unknown[] | null;
  data?: {
    viewer?: {
      accounts?: Array<{
        callsTurnUsageAdaptiveGroups?: TurnUsageGroup[] | null;
      } | null> | null;
    } | null;
  } | null;
};

type EgressCache = { key: string; at: number; egressBytes: number };
let egressCache: EgressCache | null = null;

export function resetTurnQuotaCache(): void {
  egressCache = null;
}

export function turnMonthWindow(now: Date): { from: string; to: string } {
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return { from: from.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) };
}

export function withinFreeAllowance(egressBytes: number): boolean {
  return Number.isFinite(egressBytes) && egressBytes >= 0 && egressBytes < TURN_FREE_EGRESS_BYTES;
}

export function egressBytesFromUsage(body: TurnUsageResponse): number | null {
  if (body.errors && body.errors.length > 0) return null;
  const accounts = body.data?.viewer?.accounts;
  if (!accounts || accounts.length === 0) return null;
  let total = 0;
  let groups = 0;
  for (const account of accounts) {
    for (const group of account?.callsTurnUsageAdaptiveGroups ?? []) {
      groups += 1;
      const raw = group.sum?.egressBytes ?? 0;
      const value = typeof raw === "string" ? Number(raw) : raw;
      if (!Number.isFinite(value) || value < 0) return null;
      total += value;
    }
  }
  if (groups >= USAGE_GROUP_LIMIT) return null;
  return total;
}

export async function monthlyTurnEgress(options: {
  accountId: string;
  token: string;
  now?: Date;
  fetchImpl?: typeof fetch;
}): Promise<number | null> {
  const now = options.now ?? new Date();
  const window = turnMonthWindow(now);
  const key = `${options.accountId}:${window.from}`;
  if (egressCache && egressCache.key === key && now.getTime() - egressCache.at < CACHE_MS) {
    return egressCache.egressBytes;
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(GRAPHQL_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${options.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        query: TURN_EGRESS_QUERY,
        variables: { accountTag: options.accountId, from: window.from, to: window.to },
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(USAGE_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const egress = egressBytesFromUsage((await response.json()) as TurnUsageResponse);
    if (egress == null) return null;
    egressCache = { key, at: now.getTime(), egressBytes: egress };
    return egress;
  } catch {
    return null;
  }
}

export async function turnRelayEnabled(fetchImpl?: typeof fetch): Promise<boolean> {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim() ?? "";
  const token = process.env.CLOUDFLARE_ANALYTICS_API_TOKEN?.trim() ?? "";
  if (!accountId || !token) return true;
  if (!/^[a-f0-9]{32}$/i.test(accountId)) return false;
  const egress = await monthlyTurnEgress({ accountId, token, fetchImpl });
  if (egress == null) return false;
  return withinFreeAllowance(egress);
}
