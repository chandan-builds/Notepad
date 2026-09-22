import { describe, expect, it } from "vitest";
import { decryptBytes, derivePasswordKeys, encryptBytes, randomSalt } from "@/cloud/password";

describe("note password", () => {
  it("decrypts with the same password and rejects a different one", async () => {
    const salt = randomSalt();
    const derived = await derivePasswordKeys("field-note", salt);
    const other = await derivePasswordKeys("wrong-note", salt);
    const body = await encryptBytes(derived.key, new TextEncoder().encode("keep this"));

    expect(new TextDecoder().decode((await decryptBytes(derived.key, body))!)).toBe("keep this");
    expect(await decryptBytes(other.key, body)).toBeNull();
    expect(derived.verifier).not.toBe(other.verifier);
  });
});
