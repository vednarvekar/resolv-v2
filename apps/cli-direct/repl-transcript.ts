import chalk from "chalk";

import { AgentEventBus } from "../../packages/core/events.js";

const RESPONSE_INDENT = "  ";
const THINKING_FRAMES = ["·", "⋅", "•", "⋅"];
const MIN_RESPONSE_WIDTH = 24;
const PATH_TOKEN_RE =
  /(?<![A-Za-z0-9_])(?:\.{1,2}\/)?(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.[A-Za-z0-9]+(?::\d+(?::\d+)?)?/g;

function truncate(text: string, maxLength = 28): string {
  const compact = text.trim().replace(/\s+/g, " ");
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function shortPath(value: unknown): string {
  const text = truncate(String(value ?? ""), 32);
  const parts = text.split(/[\\/]/);
  return parts[parts.length - 1] ?? text;
}

function shortQuoted(value: unknown): string {
  const text = truncate(String(value ?? ""), 24);
  return chalk.cyan(`"${text}"`);
}

export function formatAssistantSegment(segment: string): string {
  return segment
    .split(/(`[^`]+`)/g)
    .map((part) => {
      if (part.startsWith("`") && part.endsWith("`") && part.length > 1) {
        return chalk.cyan(part);
      }
      return part.replace(PATH_TOKEN_RE, (match) => chalk.cyan.bold(match));
    })
    .join("");
}

export function describeToolCall(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case "read_file":
      return `reading ${chalk.cyan(shortPath(input.path ?? "."))}`;
    case "write_file":
      return `writing ${chalk.cyan(shortPath(input.path ?? "."))}`;
    case "list_directory":
      return `listing ${chalk.cyan(shortPath(input.path ?? "."))}`;
    case "grep_codebase":
      return `searching ${shortQuoted(input.pattern ?? "")}${input.file_glob ? ` in ${chalk.cyan(shortPath(input.file_glob))}` : ""}`;
    case "scan_repo_dna":
      return "scanning repo";
    case "run_tests":
      return `tests${input.command ? `: ${shortQuoted(input.command)}` : ""}`;
    case "fetch_github_issue":
      return `fetching ${chalk.cyan(extractIssueRef(String(input.url ?? "")))}`;
    case "search_web":
      return `searching ${shortQuoted(input.query ?? "")}`;
    default:
      return `running ${chalk.cyan(toolName)}`;
  }
}

function extractIssueRef(url: string): string {
  const match = url.match(/\/issues\/(\d+)(?:[/?#].*)?$/);
  if (match?.[1]) return `issue #${match[1]}`;
  return truncate(url.replace(/^https?:\/\//, ""), 28);
}

export function attachReplTranscript(events: AgentEventBus): void {
  let responseStarted = false;
  let responseEndsWithNewline = true;
  let responseLineStart = true;
  let responseLineHasContent = false;
  let responseLineColumns = 0;
  let responseInCodeBlock = false;
  let thinkingTimer: ReturnType<typeof setInterval> | undefined;
  let thinkingFrame = 0;
  let thinkingVisible = false;
  let thinkingMessage = "thinking";

  const clearThinking = () => {
    if (thinkingTimer) {
      clearInterval(thinkingTimer);
      thinkingTimer = undefined;
    }
    if (thinkingVisible) {
      process.stdout.write("\r\x1b[K");
      thinkingVisible = false;
    }
  };

  const writeInsight = (message: string) => {
    process.stdout.write(chalk.dim(`${RESPONSE_INDENT}${message}\n`));
  };

  const renderThinking = () => {
    process.stdout.write(`\r${chalk.dim(`${RESPONSE_INDENT}${thinkingMessage} ${THINKING_FRAMES[thinkingFrame]}`)}\x1b[K`);
  };

  const startThinking = (message = "thinking") => {
    clearThinking();
    thinkingMessage = message;
    thinkingFrame = 0;
    thinkingVisible = true;
    renderThinking();
    thinkingTimer = setInterval(() => {
      thinkingFrame = (thinkingFrame + 1) % THINKING_FRAMES.length;
      renderThinking();
    }, 250);
  };

  const responseTextWidth = () => Math.max(MIN_RESPONSE_WIDTH, (process.stdout.columns ?? 100) - RESPONSE_INDENT.length);

  const writeResponseSegment = (segment: string, formatter: (value: string) => string) => {
    let remaining = segment;
    while (remaining.length > 0) {
      if (responseLineStart) {
        process.stdout.write(RESPONSE_INDENT);
        responseLineStart = false;
      }

      const available = responseTextWidth() - responseLineColumns;
      if (available <= 0) {
        process.stdout.write("\n");
        responseLineStart = true;
        responseLineColumns = 0;
        remaining = remaining.replace(/^ /, "");
        continue;
      }

      if (remaining.length <= available) {
        process.stdout.write(formatter(remaining));
        responseLineColumns += remaining.length;
        responseLineHasContent = true;
        break;
      }

      const window = remaining.slice(0, available + 1);
      const whitespaceIndex = Math.max(window.lastIndexOf(" "), window.lastIndexOf("\t"));
      const wrapAt = whitespaceIndex > 0 ? whitespaceIndex : available;
      const chunk = remaining.slice(0, wrapAt);
      process.stdout.write(formatter(chunk));
      responseLineColumns += chunk.length;
      responseLineHasContent = true;
      process.stdout.write("\n");
      responseLineStart = true;
      responseLineColumns = 0;
      remaining = remaining.slice(wrapAt).replace(/^[ \t]/, "");
    }
  };

  const writeResponseText = (text: string) => {
    const segments = text.split(/(\n)/);
    for (const segment of segments) {
      if (segment.length === 0) continue;
      if (segment === "\n") {
        if (!responseLineHasContent) {
          process.stdout.write(`${RESPONSE_INDENT}\n`);
        } else {
          process.stdout.write("\n");
        }
        responseLineStart = true;
        responseLineHasContent = false;
        responseLineColumns = 0;
        continue;
      }
      if (segment.trimStart().startsWith("```")) {
        writeResponseSegment(segment, chalk.magenta);
        responseInCodeBlock = !responseInCodeBlock;
      } else if (responseInCodeBlock) {
        writeResponseSegment(segment, chalk.cyan);
      } else {
        writeResponseSegment(segment, formatAssistantSegment);
      }
    }
  };

  const outputPreview = (value: string, maxLength = 400) => {
    const trimmed = value.trim();
    if (trimmed.length <= maxLength) return trimmed;
    return `${trimmed.slice(0, maxLength).trimEnd()}\n... output truncated`;
  };

  const beginResponse = () => {
    if (!responseStarted) {
      responseStarted = true;
      responseEndsWithNewline = true;
      responseLineStart = true;
      responseLineHasContent = false;
      responseLineColumns = 0;
      responseInCodeBlock = false;
      clearThinking();
      process.stdout.write(chalk.hex("#7c3aed").bold("\n── LLM response ───────────────────────────────────────────────\n"));
    }
  };

  events.on((event) => {
    switch (event.type) {
      case "model_start":
        responseStarted = false;
        responseEndsWithNewline = true;
        startThinking("thinking");
        break;
      case "provider_retry":
        clearThinking();
        writeInsight(`retry ${event.attempt}/${event.maxAttempts}: ${truncate(event.message, 20)}`);
        break;
      case "text_delta":
        beginResponse();
        writeResponseText(event.text);
        responseEndsWithNewline = event.text.endsWith("\n");
        break;
      case "tool_call_start":
        clearThinking();
        if (responseStarted && !responseEndsWithNewline) process.stdout.write("\n");
        responseStarted = false;
        responseEndsWithNewline = true;
        responseLineStart = true;
        responseLineHasContent = false;
        responseLineColumns = 0;
        responseInCodeBlock = false;
        writeInsight(describeToolCall(event.toolName, event.input));
        break;
      case "tool_call_end": {
        const status = event.isError ? chalk.red("✗") : chalk.green("✓");
        process.stdout.write(chalk.dim(`${RESPONSE_INDENT}${status} ${event.toolName}\n`));
        const output = outputPreview(event.output);
        if (event.isError && output) {
          process.stdout.write(output.split("\n").map((line) => `  ${line}`).join("\n") + "\n");
        }
        responseStarted = false;
        responseEndsWithNewline = true;
        responseLineStart = true;
        responseLineColumns = 0;
        break;
      }
      case "error":
        clearThinking();
        responseStarted = false;
        responseEndsWithNewline = true;
        responseLineStart = true;
        responseLineHasContent = false;
        responseLineColumns = 0;
        responseInCodeBlock = false;
        process.stdout.write(chalk.red(`\nError: ${event.message}\n`));
        break;
      case "turn_end":
        clearThinking();
        if (responseStarted && !responseEndsWithNewline) {
          process.stdout.write("\n");
          responseEndsWithNewline = true;
        }
        responseLineStart = true;
        responseLineHasContent = false;
        responseLineColumns = 0;
        responseInCodeBlock = false;
        process.stdout.write("\n");
        break;
    }
  });
}
