// packages/dna/types.ts
// Lean DNA profile — only what the LLM planner and prompt builder actually need.
// Removed: per-file import maps, raw call graph text, anonymous arrow functions,
// verbose naming identifier counts, per-file architecture flows.
 

export type Language = "typescript" | "javascript" | "python" | "unknown";
 
export interface RepoFile {
  relativePath: string;
  language: Language;
  lineCount: number;
}
 
/** Named, non-anonymous functions only — arrows excluded to kill bloat. */
export interface FunctionInfo {
  name: string;
  kind: "function" | "method";
  params: string[];
  async: boolean;
  lines: number;
  file: string;
}
 
export interface ExportInfo {
  name: string;
  type: "function" | "class" | "interface" | "constant" | "unknown";
  isDefault: boolean;
}
 
/** Helper used in 2+ files or 3+ times — genuinely shared utilities. */
export interface HelperUsage {
  name: string;
  usages: number;
  files: string[];
}
 
export interface ArchitectureInfo {
  routes: string[];
  controllers: string[];
  services: string[];
  repositories: string[];
}
 
export type NamingStyle = "camelCase" | "snake_case" | "PascalCase" | "mixed";
 
export interface ErrorPattern {
  file: string;
  style: "try-catch" | "promise-catch" | "result-type" | "callback-err" | "none";
}
 
export interface AsyncPattern {
  file: string;
  dominantStyle: "async-await" | "promise-chain" | "callbacks" | "mixed";
}
 
export interface DependencyInfo {
  name: string;
  version: string;
  isDev: boolean;
  usageCount: number;
}
 
/** Compact per-file export index — name + type only, no raw AST bloat. */
export type ExportIndex = Record<string, ExportInfo[]>;
 
export interface FunctionStats {
  totalFunctions: number;
  avgFunctionSize: number;
  asyncPercentage: number;
}

/** The single, final aggregated DNA object passed to the planner + prompt builder */
export interface DNAProfile {
  repoRoot: string;
  scannedAt: string;
 
  // file inventory — path + lang + linecount only
  files: RepoFile[];
 
  // exports per file (for cross-file reference)
  exports: ExportIndex;
 
  // named functions only (no anonymous arrows)
  functions: FunctionInfo[];
  functionStats: FunctionStats;
 
  // shared helpers (multi-file usage)
  helpers: HelperUsage[];
 
  // architecture layer classification (file paths only)
  architecture: ArchitectureInfo;
 
  // dominant style per file — just the dominant label, no raw counts
  dominantNaming: NamingStyle;
  dominantAsyncStyle: "async-await" | "promise-chain" | "callbacks" | "mixed";
  dominantErrorStyle: "try-catch" | "promise-catch" | "result-type" | "callback-err" | "none";
 
  // third-party deps with usage counts
  dependencies: DependencyInfo[];
}

// ------------ DEPRECATED FILES CODE ---------------
export interface CallGraphNode {
  functionName: string;
  calls: string[];
}

export interface ImportInfo {
  source: string;
  symbols: string[];
  isExternal: boolean;
}

export interface NamingStats {
  camelCase: number;
  snake_case: number;
  PascalCase: number;
  SCREAMING_SNAKE: number;
  dominantStyle: "camelCase" | "snake_case" | "PascalCase" | "SCREAMING_SNAKE" | "mixed";
}

export interface FolderNode {
  name: string;
  path: string;
  children: FolderNode[];
  fileCount: number;
}