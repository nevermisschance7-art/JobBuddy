import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "./crypto";

const key = randomBytes(32).toString("base64");

describe("secret encryption", () => {
  it("round-trips", () => {
    const enc = encryptSecret("AIza-test-key", key);
    expect(enc).not.toContain("AIza");
    expect(decryptSecret(enc, key)).toBe("AIza-test-key");
  });

  it("uses a fresh IV each time", () => {
    expect(encryptSecret("same", key)).not.toBe(encryptSecret("same", key));
  });

  it("rejects tampered data", () => {
    const parts = encryptSecret("secret", key).split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decryptSecret(parts.join("."), key)).toThrow();
  });

  it("rejects the wrong key", () => {
    const other = randomBytes(32).toString("base64");
    expect(() => decryptSecret(encryptSecret("secret", key), other)).toThrow();
  });
});
