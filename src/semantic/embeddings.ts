const NIM_EMBEDDING_ENDPOINT = "https://integrate.api.nvidia.com/v1/embeddings";

/**
 * NVIDIA NIM exposes NV-Embed / E5-style embedding models through the same
 * OpenAI-compatible surface as chat completions. We batch requests since the
 * endpoint accepts an array of inputs per call.
 */
export interface EmbeddingOptions {
  apiKey: string;
  model?: string;
}

const DEFAULT_EMBEDDING_MODEL = "nvidia/nv-embedqa-e5-v5";
const MAX_BATCH_SIZE = 32;

export async function getEmbeddings(
  texts: string[],
  options: EmbeddingOptions
): Promise<number[][]> {
  const model = options.model ?? DEFAULT_EMBEDDING_MODEL;
  const results: number[][] = [];

  for (let i = 0; i < texts.length; i += MAX_BATCH_SIZE) {
    const batch = texts.slice(i, i + MAX_BATCH_SIZE);

    const response = await fetch(NIM_EMBEDDING_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        model,
        input: batch,
        input_type: "passage",
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`NVIDIA NIM embedding request failed: ${response.status} ${errText}`);
    }

    const data = (await response.json()) as {
      data?: { embedding: number[]; index: number }[];
    };

    const sorted = (data.data ?? []).sort((a, b) => a.index - b.index);
    for (const item of sorted) results.push(item.embedding);
  }

  return results;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }

  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
