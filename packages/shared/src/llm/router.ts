import type { z } from "zod";
import modelsConfig from "./models.json";
import { parseLooseJson } from "./json-repair";
import { PROVIDERS } from "./providers";
import { Redactor } from "./redact";
import { applyStyle, type StyleResult } from "./style";
import {
  LlmError,
  type KeyStore,
  type LlmProvider,
  type LlmRequest,
  type LlmSinks,
  type PersonalInfo,
  type ProviderKey,
  type ProviderName,
} from "./types";

export type ModelsConfig = {
  order: ProviderName[];
  providers: Record<ProviderName, { enabled: boolean; models: string[] }>;
  tasks: Record<string, { temperature: number; maxOutputTokens: number }>;
};

export const MODELS_CONFIG = modelsConfig as unknown as ModelsConfig;

/** Every provider failed or was cooling down. The user gets a "needs fixing" alert. */
export class AllProvidersFailedError extends Error {
  constructor(readonly attempts: string[]) {
    super(
      attempts.length === 0
        ? "No AI key is set up. Add a free Gemini key in Settings."
        : `Every AI provider failed: ${attempts.join("; ")}`,
    );
    this.name = "AllProvidersFailedError";
  }
}

/** The model's JSON was still invalid after one repair attempt. */
export class LlmOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmOutputError";
  }
}

export type RouterOptions = {
  keys: KeyStore;
  sinks: LlmSinks;
  config?: ModelsConfig;
  providers?: Partial<Record<ProviderName, LlmProvider>>;
  /** Keys available to everyone, e.g. a shared OpenRouter key from env. Used after the user's own. */
  sharedKeys?: Partial<Record<ProviderName, string>>;
  now?: () => Date;
};

type CallOptions = { system?: string; personal?: PersonalInfo };

const COOLDOWN_KINDS = new Set(["rate_limit", "quota"]);

export class LlmRouter {
  private readonly config: ModelsConfig;
  private readonly providers: Record<ProviderName, LlmProvider>;
  private readonly now: () => Date;

  constructor(private readonly opts: RouterOptions) {
    this.config = opts.config ?? MODELS_CONFIG;
    this.providers = { ...PROVIDERS, ...opts.providers };
    this.now = opts.now ?? (() => new Date());
  }

  /** JSON task: validated with `schema`, repaired once with the validation error, else LlmOutputError. */
  async generateJson<S extends z.ZodTypeAny>(
    task: string,
    schema: S,
    prompt: string,
    userId: string,
    opts: CallOptions = {},
  ): Promise<z.infer<S>> {
    const redactor = new Redactor(opts.personal ?? {});
    const system = [
      opts.system,
      "Reply with one JSON value only. No markdown, no comments, no text before or after it.",
    ]
      .filter(Boolean)
      .join("\n\n");
    const safePrompt = redactor.redact(prompt);

    const first = await this.call(task, userId, {
      system: redactor.redact(system),
      prompt: safePrompt,
      json: true,
    });
    const firstTry = this.validate(first, schema, redactor);
    if (firstTry.ok) return firstTry.value;

    const retryPrompt = `${safePrompt}\n\nYour previous reply was not valid:\n${firstTry.error}\n\nReply again with corrected JSON only.`;
    const second = await this.call(task, userId, {
      system: redactor.redact(system),
      prompt: retryPrompt,
      json: true,
    });
    const secondTry = this.validate(second, schema, redactor);
    if (secondTry.ok) return secondTry.value;
    throw new LlmOutputError(`The AI's answer for ${task} was not valid: ${secondTry.error}`);
  }

  /** Text task: personal details restored, house style applied, length flagged (never cut). */
  async generateText(
    task: string,
    prompt: string,
    maxWords: number,
    userId: string,
    opts: CallOptions = {},
  ): Promise<StyleResult> {
    const redactor = new Redactor(opts.personal ?? {});
    const system = [
      opts.system,
      `Write at most ${maxWords} words. Plain, specific, first person. No em dashes. No buzzwords.`,
    ]
      .filter(Boolean)
      .join("\n\n");
    const raw = await this.call(task, userId, {
      system: redactor.redact(system),
      prompt: redactor.redact(prompt),
      json: false,
    });
    return applyStyle(redactor.restore(raw), maxWords);
  }

  private validate<S extends z.ZodTypeAny>(
    raw: string,
    schema: S,
    redactor: Redactor,
  ): { ok: true; value: z.infer<S> } | { ok: false; error: string } {
    let parsed: unknown;
    try {
      parsed = parseLooseJson(raw);
    } catch (e) {
      return {
        ok: false,
        error: `Not valid JSON (${e instanceof Error ? e.message : "parse error"}).`,
      };
    }
    const result = schema.safeParse(redactor.restoreDeep(parsed));
    if (result.success) return { ok: true, value: result.data };
    const issues = result.error.issues
      .slice(0, 8)
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    return { ok: false, error: issues };
  }

  /** Tries providers in order and each provider's models in order. Returns the raw text. */
  private async call(
    task: string,
    userId: string,
    req: Pick<LlmRequest, "system" | "prompt" | "json">,
  ): Promise<string> {
    const taskConfig = this.config.tasks[task] ?? { temperature: 0.3, maxOutputTokens: 2048 };
    const userKeys = await this.opts.keys.getKeys(userId);
    const now = this.now();
    const attempts: string[] = [];

    for (const name of this.config.order) {
      const providerConfig = this.config.providers[name];
      if (!providerConfig?.enabled) continue;

      const candidates: (ProviderKey & { shared: boolean })[] = [];
      const own = userKeys.find((k) => k.provider === name);
      if (own) candidates.push({ ...own, shared: false });
      const shared = this.opts.sharedKeys?.[name];
      if (shared)
        candidates.push({ provider: name, apiKey: shared, coolingUntil: null, shared: true });

      for (const key of candidates) {
        if (key.coolingUntil && key.coolingUntil > now) {
          attempts.push(`${name} cooling down until ${key.coolingUntil.toISOString()}`);
          continue;
        }
        const outcome = await this.tryProvider(name, key, task, userId, { ...taskConfig, ...req });
        if (outcome.ok) return outcome.text;
        attempts.push(`${name}: ${outcome.error.kind}`);

        if (!key.shared) {
          if (COOLDOWN_KINDS.has(outcome.error.kind)) {
            const until = outcome.error.retryAt ?? new Date(now.getTime() + 60_000);
            await this.opts.keys.markCoolingDown(userId, name, until, outcome.error.message);
          } else if (outcome.error.kind === "auth") {
            await this.opts.keys.markBroken(userId, name, outcome.error.message);
          }
        }
      }
    }

    const message =
      attempts.length === 0
        ? "No AI key is set up. Add a free Gemini key in Settings."
        : "All your AI keys are out of quota or not working right now. Check Settings, or add a backup key.";
    await this.opts.sinks.needsFixing(userId, message);
    throw new AllProvidersFailedError(attempts);
  }

  private async tryProvider(
    name: ProviderName,
    key: ProviderKey,
    task: string,
    userId: string,
    base: Omit<LlmRequest, "model">,
  ): Promise<{ ok: true; text: string } | { ok: false; error: LlmError }> {
    const provider = this.providers[name];
    let lastError = new LlmError("model_not_found", "no models configured");

    for (const model of this.config.providers[name].models) {
      const started = Date.now();
      try {
        const res = await provider.generate(key.apiKey, { ...base, model });
        await this.log({ userId, task, provider: name, model, started, ok: true, res });
        return { ok: true, text: res.text };
      } catch (e) {
        const error = e instanceof LlmError ? e : new LlmError("server", String(e));
        await this.log({
          userId,
          task,
          provider: name,
          model,
          started,
          ok: false,
          kind: error.kind,
        });
        lastError = error;
        // Only a missing model means "try this provider's next model".
        if (error.kind !== "model_not_found") break;
      }
    }
    return { ok: false, error: lastError };
  }

  private async log(e: {
    userId: string;
    task: string;
    provider: ProviderName;
    model: string;
    started: number;
    ok: boolean;
    res?: { inputTokens: number | null; outputTokens: number | null };
    kind?: LlmError["kind"];
  }) {
    try {
      await this.opts.sinks.logCall({
        userId: e.userId,
        task: e.task,
        provider: e.provider,
        model: e.model,
        inputTokens: e.res?.inputTokens ?? null,
        outputTokens: e.res?.outputTokens ?? null,
        latencyMs: Date.now() - e.started,
        ok: e.ok,
        errorKind: e.kind ?? null,
      });
    } catch {
      // Usage logging must never break a call.
    }
  }
}
