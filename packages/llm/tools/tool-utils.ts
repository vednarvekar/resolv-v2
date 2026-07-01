import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const ALWAYS_SKIP = new Set(["node_modules", ".git", "dist", "build", ".next"]);
const DEFAULT_SOURCE_GLOBS = ["*.ts", "*.tsx", "*.js", "*.jsx", "*.py", "*.json", "*.md"];

export function safeResolvePath(repoRoot: string, relativePath: string): string {
  const resolved = path.resolve(repoRoot, relativePath);
  if (!resolved.startsWith(path.resolve(repoRoot))) {
    throw new Error("Path escapes the repository root");
  }
  return resolved;
}

export function readGitignorePatterns(repoRoot: string): Set<string> {
  const gitignorePath = path.join(repoRoot, ".gitignore");
  if (!fs.existsSync(gitignorePath)) return new Set();
  return new Set(
    fs.readFileSync(gitignorePath, "utf-8")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"))
  );
}

export function isIgnored(relativePath: string, gitignorePatterns: Set<string>): boolean {
  const parts = relativePath.split(path.sep);
  for (const pattern of gitignorePatterns) {
    if (parts.some((p) => p === pattern)) return true;
    if (relativePath.includes(pattern)) return true;
  }
  return false;
}

function expandFileGlobs(fileGlob: string): string[] {
  const match = fileGlob.match(/^(.*)\{([^}]+)\}(.*)$/);
  if (!match) return [fileGlob];

  const prefix = match[1] ?? "";
  const variants = match[2] ?? "";
  const suffix = match[3] ?? "";
  return variants.split(",").map((variant) => `${prefix}${variant}${suffix}`);
}

export function searchCodebase(repoRoot: string, pattern: string, fileGlob: string): string {
  const globs = fileGlob ? expandFileGlobs(fileGlob) : DEFAULT_SOURCE_GLOBS;

  try {
    return execFileSync(
      "git",
      ["-C", repoRoot, "grep", "-n", "-i", "-m", "3", pattern, "--", ...globs],
      { encoding: "utf-8", timeout: 10_000 },
    ).trim();
  } catch {
    const includeArgs = globs.flatMap((glob) => ["--include", glob]);
    return execFileSync(
      "grep",
      ["-r", "-n", "-i", "-m", "3", pattern, ...includeArgs, repoRoot],
      { encoding: "utf-8", timeout: 10_000 },
    ).trim();
  }
}

export { ALWAYS_SKIP, DEFAULT_SOURCE_GLOBS };
