# Vortex Notes — Status

**Phase 0 COMPLETE incl. signature tools (2026-07-10).** See PLAN.md for phases; full
product strategy artifact: https://claude.ai/code/artifact/0b58a836-a787-450f-ac70-84ff821074f4

## What works (verified, not just typechecked)
- `vortex-notes init/index/search/mcp` CLI
- MCP server over stdio, 9 tools, e2e-tested with the MCP SDK client
  (write → read → surgical edit → search → daily → recent → remember/supersede → build_context)
- `remember(fact, topic?, supersedes?)`: dated bullets with `^f-…` ids in
  memory/*.md; supersession = strikethrough + pointer, never deletion;
  supersede by id or distinctive substring; double-supersede rejected
- `build_context(topic)`: top search hits in full (2.5k cap each) + one hop of
  [[wikilinks]] both directions (links table populated at index time)
- Read-only mode blocks writes (tested)
- Hybrid search: FTS5 BM25 + sqlite-vec (multilingual-e5-small, q8, via
  transformers.js), RRF fusion, max 2 chunks/note
- Cross-lingual verified live: EN query "breaded meat with cheese" → Spanish
  milanesas note ranked #1; pure-semantic "why email cannot be sent from the
  VPS" → SMTP/port-25 note ranked #1 (zero keyword overlap)
- File watcher reindexes on change (chokidar, 400ms debounce)
- 13/13 tests (`npm test` after `npm run build`; embeddings disabled in tests
  via VORTEX_NOTES_NO_SEMANTIC=1 so CI never downloads the model)
- Schema migrations: index is a disposable cache — version mismatch drops all
  tables and rebuilds from the vault (verified live v1→v2)

## Hard-won details
- **Keyword-leg pollution**: RRF treats any FTS hit as evidence, so stopwords
  ("with", "de") made junk notes outrank true semantic hits. Fix is layered:
  multilingual stopword set (en/es/pt/fr/de) + document-frequency filter
  (drop terms matching >25% of chunks) in `toFtsQuery` (src/search.ts). DF
  alone fails on tiny vaults — df=1 can't distinguish rare from generic.
- E5 models need "query: " / "passage: " prefixes (src/embeddings.ts).
- MCP stdio: NEVER console.log — stdout is the protocol. All logging stderr.
- sqlite-vec KNN needs `AND k = ?` in the WHERE clause; embeddings bound as
  Buffer over the Float32Array; rowid inserted as BigInt.
- `node --test dist/` (bare dir) fails on this Node — use glob
  `node --test "dist-test/test/*.test.js"`.
- Embedding model: first `index`/`mcp` run downloads ~120MB to HF cache
  (~/.cache/huggingface). Vault index at `.vortex/index.db`, disposable.

## Hard-won details (round 2)
- **Titles weren't searchable** — FTS only indexed chunk text; fixed by using the
  note title as heading context for heading-less chunks (also improves embeddings).
- FTS/vec ghost rows: `DELETE FROM fts_chunks` on an external-content table
  doesn't error but may leave ghosts; results stay correct because the chunk
  join filters them. Schema-bump rebuild clears them periodically.

## Next (launch prep, needs user)
1. GitHub repo vortex-303/vortex-notes (private until launch), npm publish
2. OpenClaw skill + demo GIF + Show HN draft
3. Then Phase 1: E2EE sync + web app (see PLAN.md)
