import chalk from "chalk";

import { AgentEventBus } from "../../packages/core/events.js";

const RESPONSE_INDENT = "  ";
const THINKING_FRAMES = ["·", "⋅", "•", "⋅"];
const MIN_RESPONSE_WIDTH = 24;
const CODE_BLOCK_LANGUAGE_RE = /^```[a-zA-Z0-9_-]*$/;
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

function formatMarkdownInline(text: string): string {
  let output = text;
  output = output.replace(/\*\*(.+?)\*\*/g, (_, value: string) => chalk.bold(value));
  output = output.replace(/_(.+?)_/g, (_, value: string) => chalk.italic(value));
  output = output.replace(/\[(.+?)\]\((.+?)\)/g, (_, label: string, url: string) => `${chalk.cyan(label)} ${chalk.dim(`(${url})`)}`);
  output = formatAssistantSegment(output);
  return output;
}

function renderMarkdownLine(line: string): string {
  const trimmed = line.trim();
  if (!trimmed) return "";

  const heading = trimmed.match(/^(#{1,6})\s+(.*)$/);
  if (heading) {
    const [, hashes = "", rawTitle = ""] = heading;
    const level = hashes.length;
    const title = formatMarkdownInline(rawTitle);
    if (level === 1) return chalk.hex("#9b7bff").bold(title);
    if (level === 2) return chalk.hex("#b18cff").bold(title);
    return chalk.whiteBright.bold(title);
  }

  const bullet = trimmed.match(/^[-*]\s+(.*)$/);
  if (bullet) {
    return `${chalk.hex("#9b7bff")("•")} ${formatMarkdownInline(bullet[1] ?? "")}`;
  }

  const ordered = trimmed.match(/^\d+\.\s+(.*)$/);
  if (ordered) {
    const [, content = ""] = ordered;
    const number = trimmed.match(/^(\d+)\./)?.[1] ?? "1";
    return `${chalk.hex("#9b7bff")(`${number}.`)} ${formatMarkdownInline(content)}`;
  }

  const quote = trimmed.match(/^>\s+(.*)$/);
  if (quote) {
    return chalk.dim(`│ ${formatMarkdownInline(quote[1] ?? "")}`);
  }

  return formatMarkdownInline(line);
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
    case "git_status":
      return "checking git status";
    case "git_diff":
      return `checking git diff${input.staged ? " (staged)" : ""}`;
    case "git_branches":
      return "listing git branches";
    case "fetch_github_issue":
      return `fetching ${chalk.cyan(extractIssueRef(String(input.url ?? "")))}`;
    case "search_web":
      return `searching ${shortQuoted(input.query ?? "")}`;
    case "apply_fix":
      return "applying code changes";
    case "open_pull_request":
      return "pushing branch and opening PR";
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
  let pendingInlineText = "";

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
    process.stdout.write(chalk.whiteBright(`${RESPONSE_INDENT}${message}\n`));
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
      const trimmed = segment.trimStart();
      if (CODE_BLOCK_LANGUAGE_RE.test(trimmed)) {
        writeResponseSegment(segment, chalk.magenta);
        responseInCodeBlock = !responseInCodeBlock;
      } else if (responseInCodeBlock) {
        writeResponseSegment(segment, chalk.cyan);
      } else {
        writeResponseSegment(segment, renderMarkdownLine);
      }
    }
  };

  const flushPendingInlineText = (force = false) => {
    if (!pendingInlineText) return;

    const newlineIdx = pendingInlineText.lastIndexOf("\n");
    if (newlineIdx >= 0) {
      const completeLines = pendingInlineText.slice(0, newlineIdx + 1);
      pendingInlineText = pendingInlineText.slice(newlineIdx + 1);
      writeResponseText(completeLines);
    }

    if (!pendingInlineText) return;

    if (force) {
      writeResponseText(pendingInlineText);
      pendingInlineText = "";
      return;
    }

    let splitAt = -1;
    for (let i = pendingInlineText.length - 1; i >= 0; i--) {
      const ch = pendingInlineText[i];
      if (ch === " " || ch === "\t") {
        splitAt = i;
        break;
      }
    }

    if (splitAt > 0) {
      writeResponseText(pendingInlineText.slice(0, splitAt + 1));
      pendingInlineText = pendingInlineText.slice(splitAt + 1);
      return;
    }

    if (pendingInlineText.length > 48) {
      writeResponseText(pendingInlineText);
      pendingInlineText = "";
    }
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
      process.stdout.write(chalk.hex("#9b7bff").bold("\n── LLM response ───────────────────────────────────────────────\n"));
    }
  };

  const previewOutput = (value: string, maxLines = 4, maxChars = 220) => {
    const lines = value.trim().split("\n");
    const slice = lines.slice(0, maxLines).map((line) => line.slice(0, maxChars));
    if (lines.length > maxLines) slice.push("... output truncated");
    return slice.join("\n");
  };

  const colorizeToolOutputLine = (line: string): string => {
    if (line.startsWith("+ ")) return chalk.greenBright(`+ ${line.slice(2)}`);
    if (line.startsWith("- ")) return chalk.redBright(`- ${line.slice(2)}`);
    if (line.startsWith("Updated: ")) return chalk.whiteBright(line);
    return chalk.gray(line);
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
        flushPendingInlineText(true);
        writeInsight(`retry ${event.attempt}/${event.maxAttempts}: ${truncate(event.message, 20)}`);
        break;
      case "text_delta":
        beginResponse();
        pendingInlineText += event.text;
        flushPendingInlineText(false);
        responseEndsWithNewline = event.text.endsWith("\n");
        break;
      case "tool_call_start":
        clearThinking();
        flushPendingInlineText(true);
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
        process.stdout.write(chalk.whiteBright(`${RESPONSE_INDENT}${status} ${chalk.bold(event.toolName)}\n`));
        const output = previewOutput(event.output);
        if (output) {
          process.stdout.write(output.split("\n").map((line) => `${RESPONSE_INDENT}${colorizeToolOutputLine(line)}`).join("\n") + "\n");
        }
        process.stdout.write("\n");
        responseStarted = false;
        responseEndsWithNewline = true;
        responseLineStart = true;
        responseLineColumns = 0;
        break;
      }
      case "error":
        clearThinking();
        flushPendingInlineText(true);
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
        flushPendingInlineText(true);
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
