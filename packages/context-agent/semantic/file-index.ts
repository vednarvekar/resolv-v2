// packages/context-agent/semantic/file-index.ts
// Builds an in-memory semantic index over the repo for similarity search.
// Uses provider embeddings; falls back gracefully when unavailable.

import fs from "node:fs";
import path from "node:path";
import { cosineSimilarity } from "./embeddings.js";
import type { DNAProfile, FunctionInfo } from "../../dna/types.js";
import type { Provider } from "../../providers/provider.js";

export interface IndexedChunk {
  kind: "file" | "function";
  relativePath: string;
  symbolName?: string;
  summaryText: string;
  embedding: number[];
}

export interface SemanticIndex {
  chunks: IndexedChunk[];
}

const MAX_FILE_CHARS = 1200;
const MAX_FUNCTIONS_TO_INDEX = 300;
const MAX_FILES_TO_INDEX = 200;

function summarizeFile(repoRoot: string, relativePath: string): string | null {
  try {
    const content = fs.readFileSync(path.resolve(repoRoot, relativePath), "utf-8");
    return `File: ${relativePath}\n${content.slice(0, MAX_FILE_CHARS)}`;
  } catch {
    return null;
  }
}

function summarizeFunction(fn: FunctionInfo): string {
  return `Function ${fn.name} in ${fn.file}. Params: ${fn.params.join(", ") || "(none)"}. ${fn.async ? "async. " : ""}${fn.lines} lines.`;
}

export async function buildSemanticIndex(dna: DNAProfile, provider: Provider): Promise<SemanticIndex> {
  const fileChunks: { relativePath: string; summaryText: string }[] = [];

  for (const file of dna.files.slice(0, MAX_FILES_TO_INDEX)) {
    const summary = summarizeFile(dna.repoRoot, file.relativePath);
    if (summary) fileChunks.push({ relativePath: file.relativePath, summaryText: summary });
  }

  const functionChunks = dna.functions.slice(0, MAX_FUNCTIONS_TO_INDEX).map((fn) => ({
    relativePath: fn.file,
    symbolName: fn.name,
    summaryText: summarizeFunction(fn),
  }));

  const allTexts = [
    ...fileChunks.map((c) => c.summaryText),
    ...functionChunks.map((c) => c.summaryText),
  ];

  if (allTexts.length === 0) return { chunks: [] };

  const embeddings = await provider.embed(allTexts);
  const chunks: IndexedChunk[] = [];
  let cursor = 0;

  for (const fc of fileChunks) {
    chunks.push({ kind: "file", relativePath: fc.relativePath, summaryText: fc.summaryText, embedding: embeddings[cursor]! });
    cursor++;
  }
  for (const fnc of functionChunks) {
    chunks.push({ kind: "function", relativePath: fnc.relativePath, symbolName: fnc.symbolName, summaryText: fnc.summaryText, embedding: embeddings[cursor]! });
    cursor++;
  }

  return { chunks };
}

export interface SemanticMatch {
  chunk: IndexedChunk;
  score: number;
}

export async function semanticSearch(
  index: SemanticIndex,
  query: string,
  provider: Provider,
  topK = 10
): Promise<SemanticMatch[]> {
  if (index.chunks.length === 0) return [];
  const [queryEmbedding] = await provider.embed([query]);
  if (!queryEmbedding) return [];

  return index.chunks
    .map((chunk) => ({ chunk, score: cosineSimilarity(queryEmbedding, chunk.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}