// apps/tui/slash-commands/registry.ts
// Single source of truth for all slash commands.

export interface SlashCommand {
  name: string;
  description: string;
  usage?: string;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    name: "/config",
    description: "Show or change settings",
    usage: "/config [change|key|github|test|retries]",
  },
  {
    name: "/provider",
    description: "Switch AI provider interactively",
    usage: "/provider [name]",
  },
  {
    name: "/model",
    description: "Switch model for current provider",
    usage: "/model [model-name]",
  },
  {
    name: "/dna",
    description: "Scan repo DNA, save to .resolv/analysis.json",
  },
  {
    name: "/sessions",
    description: "List recent chat sessions",
  },
  {
    name: "/resume",
    description: "Resume a previous chat session by ID",
    usage: "/resume <session-id>",
  },
  {
    name: "/new",
    description: "Start a fresh chat session (saves current first)",
  },
  {
    name: "/history",
    description: "Show message count and current session ID",
  },
  {
    name: "/help",
    description: "Show all commands",
  },
  {
    name: "/clear",
    description: "Clear screen",
  },
  {
    name: "/exit",
    description: "Exit resolv (session auto-saved)",
  },
];

export const COMMAND_NAMES = SLASH_COMMANDS.map((c) => c.name);

export function completeCommand(partial: string): [string[], string] {
  if (!partial.startsWith("/")) return [[], partial];
  const hits = COMMAND_NAMES.filter((c) => c.startsWith(partial));
  return [hits.length > 0 ? hits : COMMAND_NAMES, partial];
}