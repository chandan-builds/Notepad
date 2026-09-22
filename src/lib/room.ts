const SECRET_PATTERN = /^[A-Za-z0-9_-]{22}$/;

export function isValidSecret(value: string): boolean {
  return SECRET_PATTERN.test(value);
}

export function isValidRoomId(value: string): boolean {
  return isValidSecret(value);
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function base64UrlToBytes(value: string): Uint8Array | null {
  if (!isValidSecret(value)) return null;
  const padded = value.replaceAll("-", "+").replaceAll("_", "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  try {
    const binary = atob(padded + pad);
    if (binary.length !== 16) return null;
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

export function randomSecret(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

export function createNoteAddress(): { roomId: string; key: string } {
  return { roomId: randomSecret(), key: randomSecret() };
}

export function notePath(roomId: string, key: string): string {
  return `/n/${roomId}#${key}`;
}

export function noteCodePath(roomId: string): string {
  return `/n/${roomId}`;
}

/** Accepts a room code or a full note URL and returns the room id. */
export function parseShareCode(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (isValidRoomId(trimmed)) return trimmed;
  const candidate = trimmed.startsWith("/")
    ? `https://local${trimmed}`
    : trimmed.includes("://")
      ? trimmed
      : `https://${trimmed}`;
  try {
    const url = new URL(candidate);
    const match = url.pathname.match(/\/n\/([^/?#]+)/);
    if (!match) return null;
    const roomId = decodeURIComponent(match[1]);
    return isValidRoomId(roomId) ? roomId : null;
  } catch {
    return null;
  }
}

/** Fragment keys are unpadded base64url. Padding, queries, and other shapes are rejected. */
export function parseFragmentKey(hash: string): string | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw) return null;
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (decoded !== raw && decoded.includes("%")) return null;
  if (!base64UrlToBytes(decoded)) return null;
  return decoded;
}
