import { LlmError, type LlmProvider, type LlmRequest, type ProviderName } from "./types";

type Step = string | LlmError | ((req: LlmRequest) => string);

/** Scripted provider for tests: returns (or throws) the queued steps in order and records requests. */
export class FakeProvider implements LlmProvider {
  readonly requests: (LlmRequest & { apiKey: string })[] = [];
  private readonly steps: Step[];

  constructor(
    readonly name: ProviderName,
    steps: Step[] = [],
  ) {
    this.steps = [...steps];
  }

  queue(...steps: Step[]) {
    this.steps.push(...steps);
    return this;
  }

  async generate(apiKey: string, req: LlmRequest) {
    this.requests.push({ ...req, apiKey });
    const step = this.steps.shift();
    if (step === undefined) throw new Error(`FakeProvider ${this.name}: no step queued`);
    if (step instanceof LlmError) throw step;
    const text = typeof step === "function" ? step(req) : step;
    return { text, inputTokens: 10, outputTokens: 5 };
  }
}
