import { diff3Merge } from "node-diff3";

/** Line-based diff3. Returns merged text, or null when hunks genuinely overlap. */
export function tryDiff3(base: string, local: string, remote: string): string | null {
  const regions = diff3Merge(local.split("\n"), base.split("\n"), remote.split("\n"), {
    excludeFalseConflicts: true,
  });
  const out: string[] = [];
  for (const region of regions) {
    if ("ok" in region && region.ok) out.push(...region.ok);
    else return null; // real conflict — caller falls back to LWW + conflict file
  }
  return out.join("\n");
}
