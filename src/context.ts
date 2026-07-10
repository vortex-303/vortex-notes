import { Indexer } from "./indexer.js";
import { search } from "./search.js";

/**
 * Build a compact context bundle for a topic: full content of the top-matching
 * notes plus one hop of [[wikilinks]] (outgoing and backlinks) as pointers.
 */
export async function buildContext(indexer: Indexer, topic: string, maxNotes = 4): Promise<string> {
  const vault = indexer.vault;
  const hits = await search(indexer, topic, 12);

  const primaries: string[] = [];
  for (const h of hits) {
    if (!primaries.includes(h.path)) primaries.push(h.path);
    if (primaries.length >= maxNotes) break;
  }
  if (!primaries.length) return `No notes found for "${topic}".`;

  // Wikilink targets are titles or basenames; build a resolver over the vault.
  const all = indexer.db.prepare("SELECT path, title FROM notes").all() as {
    path: string;
    title: string;
  }[];
  const byKey = new Map<string, string>();
  for (const n of all) {
    byKey.set(n.title.toLowerCase(), n.path);
    const base = (n.path.split("/").pop() ?? "").replace(/\.md$/, "").toLowerCase();
    byKey.set(base, n.path);
  }

  const primarySet = new Set(primaries);
  const related = new Set<string>();
  const linkRows = indexer.db.prepare("SELECT from_path, target FROM links").all() as {
    from_path: string;
    target: string;
  }[];
  for (const l of linkRows) {
    const to = byKey.get(l.target.toLowerCase());
    if (primarySet.has(l.from_path) && to && !primarySet.has(to)) related.add(to); // outgoing
    if (to && primarySet.has(to) && !primarySet.has(l.from_path)) related.add(l.from_path); // backlink
  }

  const parts: string[] = [`Context for: ${topic}`];
  for (const p of primaries) {
    const note = vault.readNote(p);
    const body =
      note.body.length > 2500
        ? note.body.slice(0, 2500) + "\n…(truncated — use read_note for the rest)"
        : note.body;
    parts.push(`\n===== ${p} — ${note.title} =====\n${body.trim()}`);
  }
  if (related.size) {
    const firstChunk = indexer.db.prepare(
      "SELECT text FROM chunks WHERE path=? ORDER BY pos LIMIT 1"
    );
    parts.push(`\n===== Linked notes (one hop; use read_note for full content) =====`);
    for (const p of [...related].slice(0, 6)) {
      const title = all.find((n) => n.path === p)?.title ?? p;
      const snippet = ((firstChunk.get(p) as { text: string } | undefined)?.text ?? "")
        .replace(/\s+/g, " ")
        .slice(0, 180);
      parts.push(`- ${p} — ${title}${snippet ? `: ${snippet}` : ""}`);
    }
  }
  return parts.join("\n");
}
