import { describe, expect, it } from "vitest";
import { derivePassword, normaliseUsername, usernameError, usernameToEmail } from "./username";

describe("username", () => {
  it("normalises case and spaces", () => {
    expect(normaliseUsername("  Sam_Dev ")).toBe("sam_dev");
  });

  it.each(["sam", "sam-dev_01", "a".repeat(30)])("accepts %s", (u) => {
    expect(usernameError(u)).toBeNull();
  });

  it.each(["ab", "_sam", "sam dev", "sam@x", "a".repeat(31)])("rejects %s", (u) => {
    expect(usernameError(u)).not.toBeNull();
  });

  it("maps to a non-routable email", () => {
    expect(usernameToEmail("sam")).toBe("sam@users.jobbuddy.invalid");
  });

  it("derives a stable password per username and secret", () => {
    expect(derivePassword("sam", "s1")).toBe(derivePassword("sam", "s1"));
    expect(derivePassword("sam", "s1")).not.toBe(derivePassword("sam", "s2"));
    expect(derivePassword("sam", "s1")).not.toBe(derivePassword("max", "s1"));
  });
});
