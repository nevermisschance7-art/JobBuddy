import "server-only";

export type AiProvider = "gemini" | "groq" | "cerebras" | "mistral" | "openrouter";
export const AI_PROVIDERS: AiProvider[] = ["gemini", "groq", "cerebras", "mistral", "openrouter"];
/** Keys one person can keep per provider (several free accounts add up). */
export const MAX_KEYS_PER_PROVIDER = 5;

/** A tiny authenticated call per provider. Returns an error message, or null when the key works. */
export async function validateAiKey(provider: AiProvider, key: string): Promise<string | null> {
  const request = {
    gemini: () =>
      fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", {
        headers: { "x-goog-api-key": key },
        signal: AbortSignal.timeout(15_000),
      }),
    groq: () =>
      fetch("https://api.groq.com/openai/v1/models", {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(15_000),
      }),
    cerebras: () =>
      fetch("https://api.cerebras.ai/v1/models", {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(15_000),
      }),
    mistral: () =>
      fetch("https://api.mistral.ai/v1/models", {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(15_000),
      }),
    openrouter: () =>
      fetch("https://openrouter.ai/api/v1/key", {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(15_000),
      }),
  }[provider];

  let res: Response;
  try {
    res = await request();
  } catch {
    return "Couldn't reach the provider. Try again in a minute.";
  }
  if (res.ok) return null;

  const body = await res.text().catch(() => "");
  if (body.includes("User location is not supported")) {
    return "Google blocks Gemini from this server's location. The key may still be fine.";
  }
  if (res.status === 401 || res.status === 403 || res.status === 400) {
    return "That key didn't work. Check you copied all of it.";
  }
  if (res.status === 429) return "The provider says this key is over its limit right now.";
  return `The provider returned an error (${res.status}). Try again later.`;
}
