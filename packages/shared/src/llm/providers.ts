import {
  LlmError,
  type LlmProvider,
  type LlmRequest,
  type LlmResponse,
  type ProviderName,
} from "./types";

// Per model, unless the router passes less (its time budget for the whole call is nearly
// used). A user is waiting on most calls, and a slow model is skipped for the next one.
const TIMEOUT_MS = 12_000;

/** Parses "30s", "1.5s", "2m59.56s", "1h2m" or plain seconds. */
export function parseDuration(value: string | null | undefined): number | null {
  if (!value) return null;
  const v = value.trim();
  if (/^\d+(\.\d+)?$/.test(v)) return Number(v) * 1000;
  let ms = 0;
  let matched = false;
  for (const [, n, unit] of v.matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/g)) {
    matched = true;
    const x = Number(n);
    ms += unit === "h" ? x * 3_600_000 : unit === "m" ? x * 60_000 : unit === "s" ? x * 1000 : x;
  }
  return matched ? ms : null;
}

/** Next midnight in US Pacific time, when Google's daily free quotas reset (approx. 08:00 UTC). */
export function nextPacificMidnight(now: Date): Date {
  const reset = new Date(now);
  reset.setUTCHours(8, 0, 0, 0);
  if (reset <= now) reset.setUTCDate(reset.getUTCDate() + 1);
  return reset;
}

async function post(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs: number = TIMEOUT_MS,
): Promise<Response> {
  try {
    return await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(Math.max(1000, timeoutMs)),
    });
  } catch (e) {
    throw new LlmError("network", e instanceof Error ? e.message : "network error");
  }
}

function errorFromStatus(status: number, body: string, retryAt?: Date): LlmError {
  const short = body.slice(0, 300);
  if (status === 401 || status === 403) return new LlmError("auth", short);
  if (status === 404) return new LlmError("model_not_found", short);
  if (status === 429) return new LlmError("rate_limit", short, retryAt);
  if (status >= 500) return new LlmError("server", short);
  return new LlmError("bad_request", short);
}

// ---------------------------------------------------------------- Gemini

export const gemini: LlmProvider = {
  name: "gemini",
  async generate(apiKey, req) {
    const res = await post(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(req.model)}:generateContent`,
      { "x-goog-api-key": apiKey },
      {
        ...(req.system ? { systemInstruction: { parts: [{ text: req.system }] } } : {}),
        contents: [{ role: "user", parts: [{ text: req.prompt }] }],
        generationConfig: {
          temperature: req.temperature,
          maxOutputTokens: req.maxOutputTokens,
          ...(req.json ? { responseMimeType: "application/json" } : {}),
        },
      },
      req.timeoutMs,
    );
    const body = await res.text();
    if (!res.ok) {
      if (res.status === 400 && body.includes("API key not valid"))
        throw new LlmError("auth", body.slice(0, 300));
      if (res.status === 400 && body.includes("User location is not supported")) {
        throw new LlmError("auth", "Gemini is not available from this server's location");
      }
      if (res.status === 429) {
        const daily = /PerDay|per day/i.test(body);
        const delay = parseDuration(body.match(/"retryDelay":\s*"([^"]+)"/)?.[1]);
        const retryAt = daily
          ? nextPacificMidnight(new Date())
          : new Date(Date.now() + (delay ?? 60_000));
        throw new LlmError(daily ? "quota" : "rate_limit", body.slice(0, 300), retryAt);
      }
      throw errorFromStatus(res.status, body);
    }
    const data = JSON.parse(body) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };
    const text = (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
    if (!text) throw new LlmError("server", "Gemini returned no text");
    return {
      text,
      inputTokens: data.usageMetadata?.promptTokenCount ?? null,
      outputTokens: data.usageMetadata?.candidatesTokenCount ?? null,
    };
  },
};

// ---------------------------------------------------------------- OpenAI-compatible (Groq, OpenRouter)

function openAiCompatible(
  name: ProviderName,
  baseUrl: string,
  opts: { jsonMode: boolean; extraHeaders?: Record<string, string> },
): LlmProvider {
  return {
    name,
    async generate(apiKey: string, req: LlmRequest): Promise<LlmResponse> {
      const res = await post(
        `${baseUrl}/chat/completions`,
        { Authorization: `Bearer ${apiKey}`, ...opts.extraHeaders },
        {
          model: req.model,
          messages: [
            ...(req.system ? [{ role: "system", content: req.system }] : []),
            { role: "user", content: req.prompt },
          ],
          temperature: req.temperature,
          max_tokens: req.maxOutputTokens,
          ...(req.json && opts.jsonMode ? { response_format: { type: "json_object" } } : {}),
        },
        req.timeoutMs,
      );
      const body = await res.text();
      if (!res.ok) {
        const wait =
          parseDuration(res.headers.get("retry-after")) ??
          parseDuration(res.headers.get("x-ratelimit-reset-requests")) ??
          parseDuration(res.headers.get("x-ratelimit-reset-tokens"));
        const daily = /per day|daily|free-models-per-day/i.test(body);
        if (res.status === 429 && daily) {
          throw new LlmError("quota", body.slice(0, 300), new Date(Date.now() + 6 * 3_600_000));
        }
        // OpenRouter reports unknown models as 400 "not a valid model ID".
        if (/not a valid model|model_not_found|does not exist/i.test(body)) {
          throw new LlmError("model_not_found", body.slice(0, 300));
        }
        throw errorFromStatus(res.status, body, new Date(Date.now() + (wait ?? 60_000)));
      }
      const data = JSON.parse(body) as {
        choices?: { message?: { content?: string } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
        error?: { message?: string };
      };
      if (data.error) throw new LlmError("server", data.error.message ?? "provider error");
      const text = data.choices?.[0]?.message?.content ?? "";
      if (!text) throw new LlmError("server", `${name} returned no text`);
      return {
        text,
        inputTokens: data.usage?.prompt_tokens ?? null,
        outputTokens: data.usage?.completion_tokens ?? null,
      };
    },
  };
}

export const groq = openAiCompatible("groq", "https://api.groq.com/openai/v1", { jsonMode: true });

// Free OpenRouter models differ in JSON-mode support, so JSON is requested in the prompt only.
export const openrouter = openAiCompatible("openrouter", "https://openrouter.ai/api/v1", {
  jsonMode: false,
  extraHeaders: { "X-Title": "JobBuddy" },
});

// ---------------------------------------------------------------- Anthropic (paid, off by default)

export const anthropic: LlmProvider = {
  name: "anthropic",
  async generate(apiKey, req) {
    const res = await post(
      "https://api.anthropic.com/v1/messages",
      { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      {
        model: req.model,
        max_tokens: req.maxOutputTokens,
        temperature: req.temperature,
        ...(req.system ? { system: req.system } : {}),
        messages: [{ role: "user", content: req.prompt }],
      },
      req.timeoutMs,
    );
    const body = await res.text();
    if (!res.ok) {
      const wait = parseDuration(res.headers.get("retry-after"));
      throw errorFromStatus(res.status, body, new Date(Date.now() + (wait ?? 60_000)));
    }
    const data = JSON.parse(body) as {
      content?: { type: string; text?: string }[];
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const text = (data.content ?? [])
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("");
    if (!text) throw new LlmError("server", "Anthropic returned no text");
    return {
      text,
      inputTokens: data.usage?.input_tokens ?? null,
      outputTokens: data.usage?.output_tokens ?? null,
    };
  },
};

export const PROVIDERS: Record<ProviderName, LlmProvider> = { gemini, groq, openrouter, anthropic };
