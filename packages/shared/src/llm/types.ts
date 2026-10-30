export type ProviderName = "gemini" | "groq" | "cerebras" | "mistral" | "openrouter" | "anthropic";

export type LlmRequest = {
  model: string;
  system?: string;
  prompt: string;
  /** Ask the provider for a JSON object where it supports that. */
  json: boolean;
  temperature: number;
  maxOutputTokens: number;
  /** Time left for this request (the router's budget for the whole call). */
  timeoutMs?: number;
};

export type LlmResponse = {
  text: string;
  inputTokens: number | null;
  outputTokens: number | null;
};

export type LlmErrorKind =
  | "rate_limit" // slow down; the provider cools down until retryAt
  | "quota" // out of free quota; cools down until retryAt
  | "auth" // bad or revoked key
  | "model_not_found" // try the provider's next model
  | "bad_request"
  | "server"
  | "network";

export class LlmError extends Error {
  constructor(
    readonly kind: LlmErrorKind,
    message: string,
    readonly retryAt?: Date,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

export interface LlmProvider {
  readonly name: ProviderName;
  generate(apiKey: string, req: LlmRequest): Promise<LlmResponse>;
}

export type ProviderKey = {
  provider: ProviderName;
  /** The stored key's id when a user has several keys for one provider. */
  id?: string;
  apiKey: string;
  /** Provider is cooling down (rate limit or quota) until this time. */
  coolingUntil: Date | null;
};

/** Where the router gets a user's keys and records provider trouble. */
export interface KeyStore {
  getKeys(userId: string): Promise<ProviderKey[]>;
  markCoolingDown(
    userId: string,
    provider: ProviderName,
    until: Date,
    error: string,
    keyId?: string,
  ): Promise<void>;
  markBroken(userId: string, provider: ProviderName, error: string, keyId?: string): Promise<void>;
}

export type LlmCallLog = {
  userId: string;
  task: string;
  provider: ProviderName;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number;
  ok: boolean;
  errorKind: LlmErrorKind | null;
  /** The provider's error text, for diagnosis. Never prompt or response content. */
  errorMessage: string | null;
};

/** Usage logging (no prompt content) and "needs fixing" events. */
export interface LlmSinks {
  logCall(entry: LlmCallLog): Promise<void>;
  needsFixing(userId: string, message: string): Promise<void>;
}

/** Personal details replaced with placeholders before sending, restored afterwards. */
export type PersonalInfo = {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  /** Fixed answers. These must never reach a model. */
  fixedAnswers?: string[];
};
