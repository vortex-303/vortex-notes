import { Indexer } from "./indexer.js";
import { embedQuery, isSemanticDisabled } from "./embeddings.js";

export interface SearchResult {
  path: string;
  title: string;
  heading: string;
  snippet: string;
  score: number;
}

const RRF_K = 60;

/**
 * Hybrid search: FTS5 (BM25) + vector similarity, fused with Reciprocal
 * Rank Fusion. Falls back to keyword-only when embeddings are unavailable.
 */
export async function search(
  indexer: Indexer,
  query: string,
  limit = 8,
  mode: "hybrid" | "keyword" = "hybrid"
): Promise<SearchResult[]> {
  const db = indexer.db;
  const fetchN = Math.max(limit * 4, 24);

  // --- keyword leg ---
  const ftsQuery = toFtsQuery(db, query);
  let keywordRows: { id: number }[] = [];
  if (ftsQuery) {
    try {
      keywordRows = db
        .prepare(
          `SELECT rowid AS id FROM fts_chunks WHERE fts_chunks MATCH ? ORDER BY bm25(fts_chunks) LIMIT ?`
        )
        .all(ftsQuery, fetchN) as { id: number }[];
    } catch {
      keywordRows = [];
    }
  }

  // --- vector leg ---
  let vectorRows: { id: number }[] = [];
  if (mode === "hybrid" && indexer.hasVectors && !isSemanticDisabled()) {
    const vec = await embedQuery(indexer.vault.config().embedModel, query);
    if (vec) {
      vectorRows = db
        .prepare(
          `SELECT rowid AS id FROM vec_chunks WHERE embedding MATCH ? AND k = ? ORDER BY distance`
        )
        .all(Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength), fetchN) as { id: number }[];
    }
  }

  // --- fuse ---
  const scores = new Map<number, number>();
  for (const [rank, row] of keywordRows.entries()) {
    scores.set(row.id, (scores.get(row.id) ?? 0) + 1 / (RRF_K + rank + 1));
  }
  for (const [rank, row] of vectorRows.entries()) {
    scores.set(row.id, (scores.get(row.id) ?? 0) + 1 / (RRF_K + rank + 1));
  }

  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  const getChunk = db.prepare(
    `SELECT c.path, c.heading, c.text, n.title FROM chunks c JOIN notes n ON n.path = c.path WHERE c.id = ?`
  );

  const results: SearchResult[] = [];
  const seenPerNote = new Map<string, number>();
  for (const [id, score] of ranked) {
    const row = getChunk.get(id) as
      | { path: string; heading: string; text: string; title: string }
      | undefined;
    if (!row) continue;
    // At most 2 chunks per note so one long note can't crowd out the rest.
    const seen = seenPerNote.get(row.path) ?? 0;
    if (seen >= 2) continue;
    seenPerNote.set(row.path, seen + 1);
    results.push({
      path: row.path,
      title: row.title,
      heading: row.heading,
      snippet: row.text.length > 280 ? row.text.slice(0, 280) + "…" : row.text,
      score: Math.round(score * 10000) / 10000,
    });
    if (results.length >= limit) break;
  }
  return results;
}

// Function words for the dominant vault languages. Generic terms that slip
// through (other languages, jargon) are caught by the document-frequency
// filter below once the vault is big enough for DF to mean anything.
const STOPWORDS = new Set(
  (
    "the a an and or not of to in on at for with from by as is are was were be been it its this that these those there here what which who how why when i you he she we they my your our their me him her us them do does did done can could will would should must about into over under again more most some such no nor only own same so than too very just also " +
    "el la los las un una unos unas y o de del al en con por para sin sobre es son era eran fue ser estar esta este estos estas eso esa aquello que quien como cuando donde porque si no mas muy tambien pero su sus mi mis tu tus lo le les nos me te se ya hay " +
    "o a os as um uma uns umas e ou de do da dos das no na nos nas em com por para sem sobre que quem como quando onde porque se nao mais muito tambem mas seu sua seus suas meu minha isso isto aquilo ja ha " +
    "le la les un une des et ou de du au aux en dans sur pour par avec sans que qui quoi comment quand pourquoi si ne pas plus tres aussi mais son sa ses mon ma mes ce cette ces cela il elle ils elles nous vous je tu on est sont etait etaient etre y a " +
    "der die das ein eine einen einem und oder von zu in auf an fur mit ohne uber unter ist sind war waren sein diese dieser dieses was wer wie wann wo warum wenn nicht mehr sehr auch aber sein seine ihr ihre ich du er sie wir es im am um den dem des"
  ).split(/\s+/)
);

/**
 * Turn free text into a safe FTS5 OR-query of quoted terms, dropping function
 * words and terms that appear in a large share of chunks — either would let a
 * meaningless keyword match outrank real semantic hits during rank fusion.
 */
function toFtsQuery(db: import("better-sqlite3").Database, query: string): string {
  const raw = [
    ...new Set(
      query
        .split(/\s+/)
        .map((t) => t.replace(/["'()*^]/g, "").trim())
        .filter((t) => t.length > 1)
    ),
  ];
  const content = raw.filter((t) => !STOPWORDS.has(t.toLowerCase()));
  const terms = (content.length ? content : raw).slice(0, 12);
  if (!terms.length) return "";

  const total = (db.prepare("SELECT count(*) AS n FROM chunks").get() as { n: number }).n;
  const dfStmt = db.prepare("SELECT count(*) AS n FROM fts_chunks WHERE fts_chunks MATCH ?");
  const maxDf = Math.max(1, Math.floor(total * 0.25));
  const selective = terms.filter((t) => {
    try {
      return (dfStmt.get(`"${t}"`) as { n: number }).n <= maxDf;
    } catch {
      return false;
    }
  });
  const kept = selective.length ? selective : terms;
  return kept.map((t) => `"${t}"`).join(" OR ");
}
