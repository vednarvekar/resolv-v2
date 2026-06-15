export interface RepoFile {
  absolutePath: string;
  relativePath: string;
  extension: string;
  language: string;
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

export interface ExportInfo {
  name: string;
  type: string;
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

export interface DNAProfile {
  files: RepoFile[];
  imports: Record<string, ImportInfo[]>;
  exports: Record<string, ExportInfo[]>;
  functions: FunctionInfo[];
  helpers: HelperUsage[];
  callGraph: CallGraphNode[];
}