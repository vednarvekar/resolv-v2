import chalk from "chalk";

import { loadAppConfig, loadConfig, isConfigured, PROVIDER_INFO } from "../../config/config.js";
import { createProviderFromEnv } from "../../packages/providers/register.js";
import { AgentSession } from "../../packages/orchestrator-agent/session.js";
import { createLLMTools } from "../../packages/llm/tools/llm-tools.js";
import { ToolRegistry } from "../../packages/orchestrator-agent/tool-registry.js";
import { AgentEventBus } from "../../packages/core/events.js";
import { retryTransientProviderOperation } from "../../packages/providers/retry.js";
import { loadSession, newSessionId } from "../../packages/llm/session/persistence.js";

export interface ReplState {
  config: ReturnType<typeof loadConfig>;
  appConfig: ReturnType<typeof loadAppConfig>;
  providerInfo: typeof PROVIDER_INFO[keyof typeof PROVIDER_INFO];
  activeModel: string;
  provider: ReturnType<typeof createProviderFromEnv>;
  providerConnected: boolean;
  sessionId: string;
  isResuming: boolean;
  session: AgentSession;
  toolRegistry: ToolRegistry;
  events: AgentEventBus;
}

export async function createReplState(resumeId?: string): Promise<ReplState> {
  const config = loadConfig();

  if (!isConfigured(config)) {
    console.log(chalk.yellow("\n  No provider configured. Run: resolv setup\n"));
    process.exit(1);
  }

  const providerInfo = PROVIDER_INFO[config.provider]!;
  const activeModel = config.model ?? providerInfo.defaultModel;
  const provider = createProviderFromEnv(config);
  let providerConnected = true;
  const appConfig = loadAppConfig();

  try {
    await retryTransientProviderOperation(
      () => provider.healthCheck?.(activeModel) ?? Promise.resolve(),
      { retries: 1 },
    );
  } catch (err) {
    providerConnected = false;
    const message = err instanceof Error ? err.message : String(err);
    console.log(chalk.yellow(`\n  Provider connection failed: ${message}`));
    console.log(chalk.dim("  You can still use /provider to switch providers, /model to select another model, or /help for commands.\n"));
  }

  let sessionId = resumeId ?? newSessionId();
  let isResuming = Boolean(resumeId);
  const session = new AgentSession();
  session.setRepoPath(process.cwd());

  if (resumeId) {
    const persisted = loadSession(resumeId);
    if (!persisted) {
      console.log(chalk.red(`\n  Session "${resumeId}" not found.\n`));
      sessionId = newSessionId();
      isResuming = false;
    } else {
      session.restoreHistory(persisted.history);
      console.log(chalk.green(`\n  Resumed session ${resumeId} (${persisted.history.length} messages)\n`));
    }
  }

  const toolRegistry = new ToolRegistry();
  toolRegistry.registerAll(createLLMTools(process.cwd()));

  const events = new AgentEventBus();

  return {
    config,
    appConfig,
    providerInfo,
    activeModel,
    provider,
    providerConnected,
    sessionId,
    isResuming,
    session,
    toolRegistry,
    events,
  };
}
