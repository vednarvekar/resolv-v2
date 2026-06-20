// apps/tui/slash-commands/registry.ts
// Single source of truth for all slash commands.
// The REPL completer and /help both read from here — no duplication.

export interface SlashCommand {
  name: string;       // e.g. "/config"
  description: string;
  usage?: string;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    name: "/config",
    description: "Show current provider, model, and API key status",
  },
  {
    name: "/dna",
    description: "Scan the current repo's codebase and save analysis to .resolv/analysis.json",
  },
  {
    name: "/provider",
    description: "Switch the active AI provider (anthropic, google, nim, ollama)",
    usage: "/provider <name>",
  },
  {
    name: "/model",
    description: "Switch the active model for the current provider",
    usage: "/model [model-name]",
  },
  {
    name: "/help",
    description: "Show all available commands",
  },
  {
    name: "/clear",
    description: "Clear the terminal screen",
  },
  {
    name: "/exit",
    description: "Exit resolv",
  },
];

export const COMMAND_NAMES = SLASH_COMMANDS.map((c) => c.name);

/** Tab completer: given partial input, return matching command names. */
export function completeCommand(partial: string): [string[], string] {
  if (!partial.startsWith("/")) return [[], partial];
  const hits = COMMAND_NAMES.filter((c) => c.startsWith(partial));
  return [hits.length > 0 ? hits : COMMAND_NAMES, partial];
}