const DEFAULT_STUN = ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"];
const RELAY_TIMEOUT_MS = 2_500;

export function iceServers(): RTCIceServer[] {
  const configured = process.env.NEXT_PUBLIC_STUN_URLS;
  const urls = (configured ? configured.split(",") : DEFAULT_STUN)
    .map((url) => url.trim())
    .filter((url) => url.startsWith("stun:") || url.startsWith("turn:") || url.startsWith("turns:"));
  return [{ urls: urls.length > 0 ? urls : DEFAULT_STUN }];
}

export async function loadIceServers(): Promise<RTCIceServer[]> {
  const stun = iceServers();
  try {
    const response = await fetch("/api/turn", {
      cache: "no-store",
      signal: AbortSignal.timeout(RELAY_TIMEOUT_MS),
    });
    if (!response.ok) return stun;
    const data = (await response.json()) as { iceServers: RTCIceServer[] | null };
    if (!Array.isArray(data.iceServers) || data.iceServers.length === 0) return stun;
    return [...stun, ...data.iceServers];
  } catch {
    return stun;
  }
}
