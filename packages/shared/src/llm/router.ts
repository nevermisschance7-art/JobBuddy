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
  providers: Record<
    ProviderName,
    { enabled: boolean; models: string[]; freeRequestsPerDay?: number }
  >;
  /** timeoutMs: per attempt, for tasks with long output (a whole CV); default ATTEMPT_TIMEOUT_MS. */
  tasks: Record<string, { temperature: number; maxOutputTokens: number; timeoutMs?: number }>;
};

export const MODELS_CONFIG = modelsConfig as unknown as ModelsConfig;

/** Longest one generate call may take across all providers and models (ms). */
export const CALL_BUDGET_MS = 20_000;

/** Longest one attempt at one model may take (ms); a hang is retried once, then skipped. */
export const ATTEMPT_TIMEOUT_MS = 10_000;

/** Attempts that failed only because the provider was slow or down, not because of a key. */
const BUSY_ATTEMPT = /: (network|server|out of time)$/;

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
  /** Keys available to everyone (team backups from env, several per provider). Used after the
   * user's own. */
  sharedKeys?: Partial<Record<ProviderName, string | string[]>>;
  now?: () => Date;
};

type CallOptions = { system?: string; personal?: PersonalInfo };

const COOLDOWN_KINDS = new Set(["rate_limit", "quota"]);

/** Shared keys that hit a limit rest here (per server instance), so the next call skips them. */
const sharedCooling = new Map<string, Date>();
/** Turns through the shared keys of a provider, so their per-minute limits add up. */
let sharedTurn = 0;
// Errors tied to one model (missing, overloaded, too slow, rejects an option): try the next model.
const MODEL_LEVEL_ERRORS = new Set(["model_not_found", "server", "bad_request", "network"]);

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
    // One call must finish while the user's web request is still open (the host gives
    // functions about 10 to 26 seconds), even when providers hang.
    const deadline = Date.now() + CALL_BUDGET_MS;

    // Every usable key, in order: the user's own first (all of them), then shared backups,
    // starting from a different shared key each call.
    const queue: (ProviderKey & { shared: boolean })[] = [];
    const turn = sharedTurn++;
    for (const name of this.config.order) {
      if (!this.config.providers[name]?.enabled) continue;
      for (const own of userKeys.filter((k) => k.provider === name)) {
        queue.push({ ...own, shared: false });
      }
      const raw = this.opts.sharedKeys?.[name];
      const shared = (Array.isArray(raw) ? raw : raw ? [raw] : []).filter(Boolean);
      for (let j = 0; j < shared.length; j++) {
        const apiKey = shared[(turn + j) % shared.length]!;
        const cooling = sharedCooling.get(apiKey) ?? null;
        queue.push({ provider: name, apiKey, coolingUntil: cooling, shared: true });
      }
    }
    const usable = queue.filter((key) => {
      if (key.coolingUntil && key.coolingUntil > now) {
        attempts.push(`${key.provider} cooling down until ${key.coolingUntil.toISOString()}`);
        return false;
      }
      return true;
    });

    for (let i = 0; i < usable.length; i++) {
      const key = usable[i]!;
      const name = key.provider;
      const left = deadline - Date.now();
      if (left < 1500) {
        attempts.push(`${name}: out of time`);
        continue;
      }
      // Share the time with the backups still to come, so one slow provider (a busy free
      // Gemini) can't use it all; the last one gets whatever is left.
      const others = usable.length - 1 - i;
      const share = others > 0 ? Math.max(ATTEMPT_TIMEOUT_MS * 0.8, left / (others + 1)) : left;
      const outcome = await this.tryProvider(
        name,
        key,
        task,
        userId,
        { ...taskConfig, ...req },
        Math.min(deadline, Date.now() + share),
        others === 0,
      );
      if (outcome.ok) return outcome.text;
      attempts.push(`${name}: ${outcome.error.kind}`);

      if (key.shared) {
        if (COOLDOWN_KINDS.has(outcome.error.kind)) {
          sharedCooling.set(key.apiKey, outcome.error.retryAt ?? new Date(now.getTime() + 60_000));
        }
      } else if (COOLDOWN_KINDS.has(outcome.error.kind)) {
        const until = outcome.error.retryAt ?? new Date(now.getTime() + 60_000);
        await this.opts.keys.markCoolingDown(userId, name, until, outcome.error.message, key.id);
      } else if (outcome.error.kind === "auth") {
        await this.opts.keys.markBroken(userId, name, outcome.error.message, key.id);
      }
    }

    const message =
      attempts.length === 0
        ? "No AI key is set up. Add a free Gemini key in Settings."
        : attempts.every((a) => BUSY_ATTEMPT.test(a))
          ? "The free AI was too busy to answer just now. Your keys are fine; it usually passes within the hour."
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
    deadline: number = Date.now() + CALL_BUDGET_MS,
    /** Retry a hung first model once, only when no other provider is left to try. */
    retryHang = true,
  ): Promise<{ ok: true; text: string } | { ok: false; error: LlmError }> {
    const provider = this.providers[name];
    let lastError: LlmError = new LlmError("model_not_found", "no models configured");

    // Each model gets one attempt, plus one quick retry after a hang: free tiers sometimes
    // stall on a single request that succeeds at once when sent again.
    const attempts = this.config.providers[name].models.flatMap((model, i) =>
      i === 0 ? [model, model] : [model],
    );
    for (let a = 0; a < attempts.length; a++) {
      const model = attempts[a]!;
      const isRetry = a === 1 && attempts[0] === model;
      if (isRetry && (lastError.kind !== "network" || !retryHang)) continue;
      const left = deadline - Date.now();
      if (left < 1500) {
        lastError = new LlmError("network", "out of time for this request");
        break;
      }
      const started = Date.now();
      try {
        const res = await provider.generate(key.apiKey, {
          ...base,
          model,
          timeoutMs: Math.min(base.timeoutMs ?? ATTEMPT_TIMEOUT_MS, left),
        });
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
          message: error.message,
        });
        lastError = error;
        // Key-level problems end this provider; a model-level one tries its next model.
        if (!MODEL_LEVEL_ERRORS.has(error.kind)) break;
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
    message?: string;
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
        errorMessage: e.message ? e.message.slice(0, 300) : null,
      });
    } catch {
      // Usage logging must never break a call.
    }
  }
}
