import fs from "node:fs";
import path from "node:path";
import type { ImportInfo, DependencyInfo } from "../types.js";

function readPackageJson(repoRoot: string): {
  deps: Record<string, string>;
  devDeps: Record<string, string>;
} {
  const pkgPath = path.join(repoRoot, "package.json");
  if (!fs.existsSync(pkgPath)) return { deps: {}, devDeps: {} };

  try {
    const raw = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    return { deps: raw.dependencies ?? {}, devDeps: raw.devDependencies ?? {} };
  } catch {
    return { deps: {}, devDeps: {} };
  }
}

function packageName(importSource: string): string {
  if (importSource.startsWith("@")) return importSource.split("/").slice(0, 2).join("/");
  return importSource.split("/")[0] ?? importSource;
}

export function analyzeDependencies(
  imports: Record<string, ImportInfo[]>,
  repoRoot: string
): DependencyInfo[] {
  const { deps, devDeps } = readPackageJson(repoRoot);
  const allDeps = { ...deps, ...devDeps };

  const usageCounts = new Map<string, number>(Object.keys(allDeps).map((k) => [k, 0]));

  for (const fileImports of Object.values(imports)) {
    for (const imp of fileImports) {
      if (!imp.isExternal) continue;
      const pkg = packageName(imp.source);
      if (usageCounts.has(pkg)) {
        usageCounts.set(pkg, (usageCounts.get(pkg) ?? 0) + 1);
      }
    }
  }

  const results: DependencyInfo[] = Object.entries(allDeps).map(([name, version]) => ({
    name,
    version,
    isDev: name in devDeps,
    usageCount: usageCounts.get(name) ?? 0,
  }));

  return results.sort((a, b) => b.usageCount - a.usageCount);
}

/** Dependencies declared in package.json but never imported anywhere — dead weight / unused. */
export function getUnusedDependencies(deps: DependencyInfo[]): DependencyInfo[] {
  return deps.filter((d) => d.usageCount === 0);
}