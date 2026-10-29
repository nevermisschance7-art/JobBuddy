import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  AllProvidersFailedError,
  applyStyle,
  FakeProvider,
  LlmError,
  LlmOutputError,
  LlmRouter,
  nextPacificMidnight,
  parseDuration,
  parseLooseJson,
  Redactor,
  type KeyStore,
  type LlmCallLog,
  type ModelsConfig,
  type ProviderKey,
  type ProviderName,
} from "./index";
import vectors from "./test-vectors.json";

// ---------------------------------------------------------------- shared vectors

describe("style vectors", () => {
  for (const v of vectors.style) {
    it(v.input, () => {
      const r = applyStyle(v.input, v.maxWords);
      expect(r.text).toBe(v.text);
      expect(r.overLimit).toBe(v.overLimit);
      for (const f of v.flagsContain) expect(r.flags.join(" | ")).toContain(f);
      if (v.flagsContain.length === 0) expect(r.flags).toEqual([]);
    });
  }

  it("never leaves an em dash", () => {
    expect(applyStyle("a — b —c", 80).text).not.toContain("—");
  });
});

describe("redaction vectors", () => {
  for (const v of vectors.redaction) {
    it("replaces personal details and fixed answers", () => {
      const r = new Redactor(v.personal);
      const out = r.redact(v.input);
      expect(out).toBe(v.redacted);
      for (const s of v.mustNotContain) expect(out).not.toContain(s);
      expect(r.restore("Hi {{NAME}}, {{FIXED_1}}")).toBe(
        `Hi ${v.personal.name}, ${v.personal.fixedAnswers[0]}`,
      );
    });
  }
});

describe("json repair vectors", () => {
  for (const v of vectors.jsonRepair) {
    it(JSON.stringify(v.input), () => expect(parseLooseJson(v.input)).toEqual(v.parsed));
  }
});

// ---------------------------------------------------------------- router

const CONFIG: ModelsConfig = {
  order: ["gemini", "groq", "openrouter", "anthropic"],
  providers: {
    gemini: { enabled: true, models: ["g-new", "g-old"] },
    groq: { enabled: true, models: ["q-1"] },
    openrouter: { enabled: true, models: ["o-1"] },
    anthropic: { enabled: false, models: ["c-1"] },
  },
  tasks: { t: { temperature: 0, maxOutputTokens: 100 } },
};

function setup(keys: Partial<Record<ProviderName, Partial<ProviderKey>>>, shared = {}) {
  const fakes = {
    gemini: new FakeProvider("gemini"),
    groq: new FakeProvider("groq"),
    openrouter: new FakeProvider("openrouter"),
    anthropic: new FakeProvider("anthropic"),
  };
  const cooled: { provider: ProviderName; until: Date }[] = [];
  const broken: ProviderName[] = [];
  const logs: LlmCallLog[] = [];
  const alerts: string[] = [];
  const store: KeyStore = {
    async getKeys() {
      return Object.entries(keys).map(([provider, k]) => ({
        provider: provider as ProviderName,
        apiKey: `${provider}-key`,
        coolingUntil: null,
        ...k,
      }));
    },
    async markCoolingDown(_u, provider, until) {
      cooled.push({ provider, until });
    },
    async markBroken(_u, provider) {
      broken.push(provider);
    },
  };
  const router = new LlmRouter({
    keys: store,
    sinks: {
      async logCall(e) {
        logs.push(e);
      },
      async needsFixing(_u, m) {
        alerts.push(m);
      },
    },
    config: CONFIG,
    providers: fakes,
    sharedKeys: shared,
    now: () => new Date("2026-10-21T12:00:00Z"),
  });
  return { router, fakes, cooled, broken, logs, alerts };
}

const schema = z.object({ title: z.string(), years: z.number() });

describe("LlmRouter", () => {
  it("uses the first provider when it works and logs the call", async () => {
    const { router, fakes, logs } = setup({ gemini: {} });
    fakes.gemini.queue('{"title":"Dev","years":3}');
    await expect(router.generateJson("t", schema, "p", "u1")).resolves.toEqual({
      title: "Dev",
      years: 3,
    });
    expect(logs).toMatchObject([{ provider: "gemini", model: "g-new", ok: true, task: "t" }]);
    expect(fakes.gemini.requests[0]?.json).toBe(true);
  });

  it("falls back to the next provider on rate limit and cools the first down", async () => {
    const until = new Date("2026-10-21T12:05:00Z");
    const { router, fakes, cooled } = setup({ gemini: {}, groq: {} });
    fakes.gemini.queue(new LlmError("rate_limit", "slow down", until));
    fakes.groq.queue('{"title":"Dev","years":1}');
    await expect(router.generateJson("t", schema, "p", "u1")).resolves.toEqual({
      title: "Dev",
      years: 1,
    });
    expect(cooled).toEqual([{ provider: "gemini", until }]);
  });

  it("skips a provider that is still cooling down", async () => {
    const { router, fakes } = setup({
      gemini: { coolingUntil: new Date("2026-10-21T13:00:00Z") },
      groq: {},
    });
    fakes.groq.queue('{"title":"x","years":0}');
    await router.generateJson("t", schema, "p", "u1");
    expect(fakes.gemini.requests).toHaveLength(0);
  });

  it("tries the provider's next model when a model is gone", async () => {
    const { router, fakes } = setup({ gemini: {} });
    fakes.gemini.queue(new LlmError("model_not_found", "404"), '{"title":"x","years":0}');
    await router.generateJson("t", schema, "p", "u1");
    expect(fakes.gemini.requests.map((r) => r.model)).toEqual(["g-new", "g-old"]);
  });

  it("tries the provider's next model after a server error, and logs the reason", async () => {
    const { router, fakes, logs } = setup({ gemini: {} });
    fakes.gemini.queue(new LlmError("server", "503 model overloaded"), '{"title":"x","years":0}');
    await router.generateJson("t", schema, "p", "u1");
    expect(fakes.gemini.requests.map((r) => r.model)).toEqual(["g-new", "g-old"]);
    expect(logs[0]).toMatchObject({
      ok: false,
      errorKind: "server",
      errorMessage: "503 model overloaded",
    });
  });

  it("marks a bad key as broken and moves on", async () => {
    const { router, fakes, broken } = setup({ gemini: {}, groq: {} });
    fakes.gemini.queue(new LlmError("auth", "bad key"));
    fakes.groq.queue('{"title":"x","years":0}');
    await router.generateJson("t", schema, "p", "u1");
    expect(broken).toEqual(["gemini"]);
  });

  it("uses a shared key after the user's own keys", async () => {
    const { router, fakes } = setup({}, { openrouter: "shared-key" });
    fakes.openrouter.queue('{"title":"x","years":0}');
    await router.generateJson("t", schema, "p", "u1");
    expect(fakes.openrouter.requests[0]?.apiKey).toBe("shared-key");
  });

  it("never calls a disabled provider", async () => {
    const { router, fakes } = setup({ anthropic: {} });
    await expect(router.generateJson("t", schema, "p", "u1")).rejects.toBeInstanceOf(
      AllProvidersFailedError,
    );
    expect(fakes.anthropic.requests).toHaveLength(0);
  });

  it("raises a needs-fixing alert when every provider fails", async () => {
    const { router, fakes, alerts } = setup({ gemini: {}, groq: {} });
    fakes.gemini.queue(new LlmError("quota", "daily", new Date("2026-10-22T08:00:00Z")));
    fakes.groq.queue(new LlmError("server", "500"));
    await expect(router.generateJson("t", schema, "p", "u1")).rejects.toBeInstanceOf(
      AllProvidersFailedError,
    );
    expect(alerts).toHaveLength(1);
  });

  it("explains that a key is needed when the user has none", async () => {
    const { router, alerts } = setup({});
    await expect(router.generateText("t", "p", 50, "u1")).rejects.toThrow(/No AI key/);
    expect(alerts[0]).toMatch(/No AI key/);
  });

  it("repairs fenced JSON without a retry", async () => {
    const { router, fakes } = setup({ gemini: {} });
    fakes.gemini.queue('Here you go:\n```json\n{"title":"x","years":2}\n```');
    await expect(router.generateJson("t", schema, "p", "u1")).resolves.toEqual({
      title: "x",
      years: 2,
    });
    expect(fakes.gemini.requests).toHaveLength(1);
  });

  it("retries once with the validation error, then succeeds", async () => {
    const { router, fakes } = setup({ gemini: {} });
    fakes.gemini.queue('{"title":"x","years":"two"}', '{"title":"x","years":2}');
    await expect(router.generateJson("t", schema, "p", "u1")).resolves.toEqual({
      title: "x",
      years: 2,
    });
    expect(fakes.gemini.requests[1]?.prompt).toContain("years: Expected number");
  });

  it("fails cleanly when the retry is still invalid", async () => {
    const { router, fakes } = setup({ gemini: {} });
    fakes.gemini.queue("not json", '{"title":1}');
    await expect(router.generateJson("t", schema, "p", "u1")).rejects.toBeInstanceOf(
      LlmOutputError,
    );
  });

  it("never sends personal details or fixed answers, and restores them in the result", async () => {
    const { router, fakes } = setup({ gemini: {} });
    fakes.gemini.queue('{"title":"Thanks from {{NAME}}","years":1}');
    const result = await router.generateJson(
      "t",
      schema,
      "Sam Tester, sam@x.io, needs sponsorship: Tier 2 visa required",
      "u1",
      {
        personal: { name: "Sam Tester", email: "sam@x.io", fixedAnswers: ["Tier 2 visa required"] },
      },
    );
    const sent = JSON.stringify(fakes.gemini.requests);
    expect(sent).not.toContain("Sam Tester");
    expect(sent).not.toContain("sam@x.io");
    expect(sent).not.toContain("Tier 2 visa");
    expect(result.title).toBe("Thanks from Sam Tester");
  });

  it("applies house style to text tasks and flags overlong answers", async () => {
    const { router, fakes } = setup({ gemini: {} });
    fakes.gemini.queue("I leverage Go — daily. ".repeat(10));
    const r = await router.generateText("t", "p", 20, "u1");
    expect(r.text).not.toContain("—");
    expect(r.text).not.toMatch(/leverage/i);
    expect(r.overLimit).toBe(true);
    expect(fakes.gemini.requests[0]?.json).toBe(false);
  });
});

describe("provider helpers", () => {
  it("parses rate-limit durations", () => {
    expect(parseDuration("30s")).toBe(30_000);
    expect(parseDuration("2m59.5s")).toBe(179_500);
    expect(parseDuration("12")).toBe(12_000);
    expect(parseDuration("soon")).toBeNull();
  });

  it("finds the next Google quota reset", () => {
    expect(nextPacificMidnight(new Date("2026-10-21T12:00:00Z")).toISOString()).toBe(
      "2026-10-22T08:00:00.000Z",
    );
    expect(nextPacificMidnight(new Date("2026-10-21T03:00:00Z")).toISOString()).toBe(
      "2026-10-21T08:00:00.000Z",
    );
  });
});

describe("LlmRouter time sharing", () => {
  it("moves to the backup after a hang instead of retrying the slow provider", async () => {
    const { router, fakes } = setup({ gemini: {} }, { groq: "shared-groq" });
    // Gemini times out (as when Google's free tier is overloaded); Groq answers.
    fakes.gemini.queue(new LlmError("network", "The operation was aborted due to timeout"));
    fakes.gemini.queue(new LlmError("network", "timeout again"));
    fakes.groq.queue('{"title":"Dev","years":3}');
    await expect(router.generateJson("t", schema, "p", "u1")).resolves.toEqual({
      title: "Dev",
      years: 3,
    });
    // Gemini's first model was not retried (a backup was available): its next model, then Groq.
    expect(fakes.gemini.requests.map((r) => r.model)).toEqual(["g-new", "g-old"]);
    // Each attempt got a share of the time, not the whole budget.
    expect(fakes.gemini.requests[0]!.timeoutMs).toBeLessThanOrEqual(10_000);
  });
});
