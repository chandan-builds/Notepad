import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const TTL_SECONDS = 12 * 60 * 60;

type CloudflareIceServer = { urls: string | string[]; username?: string; credential?: string };

export async function GET() {
  const keyId = process.env.CLOUDFLARE_TURN_KEY_ID;
  const token = process.env.CLOUDFLARE_TURN_KEY_API_TOKEN;
  if (!keyId || !token) {
    return NextResponse.json({ iceServers: null }, { headers: { "cache-control": "no-store" } });
  }

  try {
    const response = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ ttl: TTL_SECONDS }),
        cache: "no-store",
      },
    );
    if (!response.ok) throw new Error(`turn ${response.status}`);
    const data = (await response.json()) as { iceServers?: CloudflareIceServer[] };
    // Browsers block port 53, so those URLs only add a timeout.
    const iceServers = (data.iceServers ?? [])
      .map((server) => ({
        ...server,
        urls: (Array.isArray(server.urls) ? server.urls : [server.urls]).filter((url) => !/:53(\?|$)/.test(url)),
      }))
      .filter((server) => server.urls.length > 0);
    return NextResponse.json({ iceServers }, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ iceServers: null }, { status: 502, headers: { "cache-control": "no-store" } });
  }
}
