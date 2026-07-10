# Vortex Notes — Status

**Phase 0 core: BUILT & VERIFIED (2026-07-10).** See PLAN.md for phases; full product
strategy artifact: https://claude.ai/code/artifact/0b58a836-a787-450f-ac70-84ff821074f4

## What works (verified, not just typechecked)
- `vortex-notes init/index/search/mcp` CLI
- MCP server over stdio, 7 tools, e2e-tested with the MCP SDK client
  (write → read → surgical edit → search → daily → recent_activity)
- Read-only mode blocks writes (tested)
- Hybrid search: FTS5 BM25 + sqlite-vec (multilingual-e5-small, q8, via
  transformers.js), RRF fusion, max 2 chunks/note
- Cross-lingual verified live: EN query "breaded meat with cheese" → Spanish
  milanesas note ranked #1; pure-semantic "why email cannot be sent from the
  VPS" → SMTP/port-25 note ranked #1 (zero keyword overlap)
- File watcher reindexes on change (chokidar, 400ms debounce)
- 10/10 tests (`npm test` after `npm run build`; embeddings disabled in tests
  via VORTEX_NOTES_NO_SEMANTIC=1 so CI never downloads the model)

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

## Next (Phase 0 finish → launch)
1. `build_context(topic)` tool (follow [[wikilinks]] from search hits)
2. `remember(fact, supersedes)` tool
3. GitHub repo vortex-303/vortex-notes (private until launch), npm publish
4. OpenClaw skill + demo GIF + Show HN draft
5. Then Phase 1: E2EE sync + web app (see PLAN.md)
