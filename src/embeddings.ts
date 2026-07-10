/**
 * Local embeddings via transformers.js (ONNX, fully offline after first
 * model download). E5 models expect "query: " / "passage: " prefixes.
 */

export const EMBED_DIM = 384;

type Embedder = (texts: string[]) => Promise<Float32Array[]>;

let embedderPromise: Promise<Embedder | null> | null = null;

export function isSemanticDisabled(): boolean {
  return process.env.VORTEX_NOTES_NO_SEMANTIC === "1";
}

async function loadEmbedder(model: string): Promise<Embedder | null> {
  try {
    const { pipeline } = await import("@huggingface/transformers");
    console.error(`[vortex-notes] loading embedding model ${model} (first run downloads ~120MB)...`);
    const extractor = await pipeline("feature-extraction", model, { dtype: "q8" });
    console.error(`[vortex-notes] embedding model ready`);
    return async (texts: string[]) => {
      const output = await extractor(texts, { pooling: "mean", normalize: true });
      const data = output.data as Float32Array;
      const dim = data.length / texts.length;
      const rows: Float32Array[] = [];
      for (let i = 0; i < texts.length; i++) {
        rows.push(new Float32Array(data.subarray(i * dim, (i + 1) * dim)));
      }
      return rows;
    };
  } catch (err) {
    console.error(`[vortex-notes] semantic search unavailable (${(err as Error).message}); using keyword search only`);
    return null;
  }
}

function getEmbedder(model: string): Promise<Embedder | null> {
  if (isSemanticDisabled()) return Promise.resolve(null);
  embedderPromise ??= loadEmbedder(model);
  return embedderPromise;
}

export async function embedPassages(model: string, texts: string[]): Promise<Float32Array[] | null> {
  const embed = await getEmbedder(model);
  if (!embed) return null;
  return embed(texts.map((t) => "passage: " + t));
}

export async function embedQuery(model: string, text: string): Promise<Float32Array | null> {
  const embed = await getEmbedder(model);
  if (!embed) return null;
  const [vec] = await embed(["query: " + text]);
  return vec;
}
