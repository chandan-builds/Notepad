import { base64ToBytes, bytesToBase64, toArrayBuffer } from "@/lib/bytes";

const ITERATIONS = 210_000;

export async function derivePasswordKeys(
  password: string,
  salt: Uint8Array,
): Promise<{ verifier: string; key: CryptoKey }> {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: toArrayBuffer(salt), iterations: ITERATIONS },
    material,
    512,
  );
  const bytes = new Uint8Array(bits);
  const key = await crypto.subtle.importKey("raw", toArrayBuffer(bytes.subarray(32)), "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
  return { verifier: bytesToBase64(bytes.subarray(0, 32)), key };
}

export function randomSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(16));
}

export async function encryptBytes(key: CryptoKey, plain: Uint8Array): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: toArrayBuffer(iv) }, key, toArrayBuffer(plain)),
  );
  const combined = new Uint8Array(iv.byteLength + cipher.byteLength);
  combined.set(iv, 0);
  combined.set(cipher, iv.byteLength);
  return bytesToBase64(combined);
}

export async function decryptBytes(key: CryptoKey, body: string): Promise<Uint8Array | null> {
  try {
    const bytes = base64ToBytes(body);
    if (!bytes || bytes.byteLength < 13) return null;
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: toArrayBuffer(bytes.subarray(0, 12)) },
      key,
      toArrayBuffer(bytes.subarray(12)),
    );
    return new Uint8Array(plain);
  } catch {
    return null;
  }
}
