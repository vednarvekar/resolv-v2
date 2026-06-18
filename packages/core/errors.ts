// ============================================================
// resolv — core/errors.ts
// ============================================================

/** Thrown by a Provider implementation when the underlying API call fails. */
export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly providerName: string,
    public readonly statusCode?: number
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

/** Thrown when a tool is invoked with input that fails schema validation. */
export class ToolInputError extends Error {
  constructor(
    message: string,
    public readonly toolName: string
  ) {
    super(message);
    this.name = "ToolInputError";
  }
}

/** Thrown when the agent loop hits its turn/tool-call safety cap. */
export class AgentLoopLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentLoopLimitError";
  }
}

/** Thrown when a requested provider/model name isn't registered. */
export class UnknownProviderError extends Error {
  constructor(providerName: string) {
    super(`Unknown provider: "${providerName}". Check RESOLV_PROVIDER or available providers.`);
    this.name = "UnknownProviderError";
  }
}