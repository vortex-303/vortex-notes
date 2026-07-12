/** Pure text helpers shared by node and browser code — no fs, no deps. */

export function titleFromPath(rel: string, body?: string): string {
  const h1 = body?.match(/^#\s+(.+)$/m);
  if (h1) return h1[1].trim();
  const base = rel.split("/").pop() ?? rel;
  return base.replace(/\.md$/, "");
}

export function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "note"
  );
}

/** Split raw file text into frontmatter block (if any) and body. */
export function splitFrontmatter(raw: string): { frontmatter: string | null; body: string } {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { frontmatter: null, body: raw };
  return { frontmatter: m[1], body: raw.slice(m[0].length) };
}

/** Best-effort title from raw file text (frontmatter title > first h1 > basename). */
export function titleFromRaw(rel: string, raw: string): string {
  const { frontmatter, body } = splitFrontmatter(raw);
  const fmTitle = frontmatter?.match(/^title:\s*['"]?(.+?)['"]?\s*$/m);
  if (fmTitle) return fmTitle[1].trim();
  return titleFromPath(rel, body);
}
