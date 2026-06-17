import fs from "node:fs";
import path from "node:path";
import { getEmbeddings, cosineSimilarity } from "./embeddings.js";
import type { DNAProfile, FunctionInfo } from "../dna/types.js";

export interface IndexedChunk {
  /** file-level chunk or function-level chunk */
  kind: "file" | "function";
  relativePath: string;
  /** function name when kind === "function" */
  symbolName?: string;
  /** short text actually embedded — a summary, not the raw file */
  summaryText: string;
  embedding: number[];
}

export interface SemanticIndex {
  chunks: IndexedChunk[];
}

const MAX_FILE_CHARS_FOR_SUMMARY = 1200;
const MAX_FUNCTIONS_TO_INDEX = 400; // cost control on huge repos
const MAX_FILES_TO_INDEX = 300;

/** Builds a short text summary per file (first N chars) — cheap stand-in for a real doc embedding. */
function summarizeFile(repoRoot: string, relativePath: string): string | null {
  try {
    const content = fs.readFileSync(path.resolve(repoRoot, relativePath), "utf-8");
    const header = `File: ${relativePath}\n${content.slice(0, MAX_FILE_CHARS_FOR_SUMMARY)}`;
    return header;
  } catch {
    return null;
  }
}

function summarizeFunction(fn: FunctionInfo): string {
  return `Function ${fn.name} in ${fn.file}. Params: ${fn.params.join(", ") || "(none)"}. ${fn.async ? "async. " : ""}${fn.lines} lines.`;
}

/**
 * Builds a semantic index over the repo: one chunk per file (capped) and one
 * chunk per function (capped). This is intentionally a flat in-memory array —
 * at the scale of a single repo (hundreds to low thousands of chunks),
 * brute-force cosine similarity is faster to build and reason about than
 * standing up a vector database, and avoids adding infra dependencies.
 */
export async function buildSemanticIndex(
  dna: DNAProfile,
  apiKey: string
): Promise<SemanticIndex> {
  const fileChunks: { relativePath: string; summaryText: string }[] = [];

  for (const file of dna.files.slice(0, MAX_FILES_TO_INDEX)) {
    if (file.language === "unknown") continue;
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

  const embeddings = await getEmbeddings(allTexts, { apiKey });

  const chunks: IndexedChunk[] = [];
  let cursor = 0;

  for (const fc of fileChunks) {
    chunks.push({
      kind: "file",
      relativePath: fc.relativePath,
      summaryText: fc.summaryText,
      embedding: embeddings[cursor]!,
    });
    cursor++;
  }

  for (const fnc of functionChunks) {
    chunks.push({
      kind: "function",
      relativePath: fnc.relativePath,
      symbolName: fnc.symbolName,
      summaryText: fnc.summaryText,
      embedding: embeddings[cursor]!,
    });
    cursor++;
  }

  return { chunks };
}

export interface SemanticMatch {
  chunk: IndexedChunk;
  score: number;
}

/** Ranks indexed chunks by cosine similarity to the query embedding. */
export async function semanticSearch(
  index: SemanticIndex,
  query: string,
  apiKey: string,
  topK = 10
): Promise<SemanticMatch[]> {
  if (index.chunks.length === 0) return [];

  const [queryEmbedding] = await getEmbeddings([query], { apiKey });
  if (!queryEmbedding) return [];

  const scored = index.chunks.map((chunk) => ({
    chunk,
    score: cosineSimilarity(queryEmbedding, chunk.embedding),
  }));

  return scored.sort((a, b) => b.score - a.score).slice(0, topK);
}
