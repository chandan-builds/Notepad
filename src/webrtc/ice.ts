const DEFAULT_STUN = ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"];

export function iceServers(): RTCIceServer[] {
  const configured = process.env.NEXT_PUBLIC_STUN_URLS;
  const urls = (configured ? configured.split(",") : DEFAULT_STUN)
    .map((url) => url.trim())
    .filter((url) => url.startsWith("stun:") || url.startsWith("turn:") || url.startsWith("turns:"));
  return [{ urls: urls.length > 0 ? urls : DEFAULT_STUN }];
}
