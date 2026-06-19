export type Language = "typescript" | "javascript" | "python" | "unknown";

export interface RepoFile {
  absolutePath: string;
  relativePath: string;
  extension: string;
  language: Language;
  sizeBytes: number;
  lineCount: number;
}

export interface FunctionInfo {
  name: string;
  kind: "function" | "method" | "arrow";
  params: string[];
  async: boolean;
  lines: number;
  file: string;
}

export interface FunctionAnalysis {
  functions: FunctionInfo[];
  stats: {
    totalFunctions: number;
    avgFunctionSize: number;
    asyncPercentage: number;
    commonParamNames: string[];
  };
}

export interface ExportInfo {
  name: string;
  type: "function" | "class" | "interface" | "constant" | "unknown";
  isDefault: boolean;
}

export interface ImportInfo {
  source: string;
  symbols: string[];
  isExternal: boolean;
}

export interface HelperUsage {
  name: string;
  usages: number;
  files: string[];
}

export interface CallGraphNode {
  functionName: string;
  calls: string[];
}

export interface ArchitectureFlow {
  file: string;
  layer: "route" | "controller" | "service" | "repository" | "unknown";
  imports: string[];
  calls: string[];
}

export interface ArchitectureInfo {
  routes: ArchitectureFlow[];
  controllers: ArchitectureFlow[];
  services: ArchitectureFlow[];
  repositories: ArchitectureFlow[];
}

export interface NamingStats {
  camelCase: number;
  snake_case: number;
  PascalCase: number;
  SCREAMING_SNAKE: number;
  dominantStyle: "camelCase" | "snake_case" | "PascalCase" | "SCREAMING_SNAKE" | "mixed";
}

export interface ErrorPattern {
  file: string;
  style: "try-catch" | "promise-catch" | "result-type" | "callback-err" | "none";
  customExceptionNames: string[];
}

export interface AsyncPattern {
  file: string;
  usesAsyncAwait: boolean;
  usesPromiseChain: boolean;
  usesCallbacks: boolean;
  dominantStyle: "async-await" | "promise-chain" | "callbacks" | "mixed";
}

export interface DependencyInfo {
  name: string;
  version: string;
  isDev: boolean;
  usageCount: number;
}

export interface FolderNode {
  name: string;
  path: string;
  children: FolderNode[];
  fileCount: number;
}

/** The single, final aggregated DNA object passed to the planner + prompt builder */
export interface DNAProfile {
  repoRoot: string;
  scannedAt: string;
  files: RepoFile[];
  imports: Record<string, ImportInfo[]>;
  exports: Record<string, ExportInfo[]>;
  functions: FunctionInfo[];
  functionStats: FunctionAnalysis["stats"];
  helpers: HelperUsage[];
  callGraph: CallGraphNode[];
  architecture: ArchitectureInfo;
  naming: NamingStats;
  errorPatterns: ErrorPattern[];
  asyncPatterns: AsyncPattern[];
  dependencies: DependencyInfo[];
  structure: FolderNode;
}
