import { base64UrlToBytes } from "@/lib/room";
import { base64ToBytes, bytesToBase64, toArrayBuffer } from "@/lib/bytes";

const INFO = new TextEncoder().encode("collab-notepad-signal-v1");

export async function deriveSignalingKey(fragmentKey: string, roomId: string): Promise<CryptoKey> {
  const raw = base64UrlToBytes(fragmentKey);
  if (!raw) throw new Error("Invalid fragment key");
  const material = await crypto.subtle.importKey("raw", toArrayBuffer(raw), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new TextEncoder().encode(roomId),
      info: INFO,
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptBody(key: CryptoKey, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv: toArrayBuffer(iv) }, key, encoded);
  const combined = new Uint8Array(iv.byteLength + cipher.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(cipher), iv.byteLength);
  return bytesToBase64(combined);
}

export async function decryptBody(key: CryptoKey, body: string): Promise<string | null> {
  try {
    const bytes = base64ToBytes(body);
    if (!bytes || bytes.byteLength < 13) return null;
    const iv = bytes.subarray(0, 12);
    const cipher = bytes.subarray(12);
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: toArrayBuffer(iv) },
      key,
      toArrayBuffer(cipher),
    );
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}
