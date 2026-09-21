# P2A Retrieval Contract

P2A adds searchable context without giving Context Core execution or authority.

## P2A-P1

This cut defines retrieval semantics before persistence:

```text
indexable non-exact material
          |
          v
 deterministic chunking
          |
          v
 lexical tokenization
          |
          v
 BM25 ranking
          |
          v
 serialized byte budget
          |
          v
 bounded retrieval result
```

Indexable classes:

- `WORKING_CONTEXT`
- `BULK_MATERIAL`
- `RETRIEVABLE_KNOWLEDGE`

Admission always delegates to the canonical P1 `classifyInput()` policy. Callers cannot bypass protected classification merely by omitting the `classification` field.

Refused from lexical indexing:

- `EXACT_EVIDENCE`
- `DURABLE_MEMORY_REFERENCE`

Exact evidence remains on the P1 lossless path and must never be replaced by a fuzzy search result. Durable memory remains governed externally.

Determinism:

- chunk IDs bind source ID, chunk order, and SHA-256 content
- identical source re-add is idempotent
- source ID rebinding to different content fails closed
- NFKC Unicode lexical tokenization
- default `match: "all"`
- fixed BM25 defaults (`k1=1.2`, `b=0.75`)
- deterministic tie breaking
- serialized result byte budgets

Authority remains zero: no model calls, shell/code execution, provider coupling, durable-memory writes, wallet/trade authority, or git-write authority.

## P2A-P2

Bind this contract to local SQLite/FTS5 persistence without changing retrieval semantics.

## P2A-P2 — persistent SQLite / FTS5 substrate

P2A-P2 binds the P2A-P1 retrieval contract to local persistent storage.

```text
canonical classification
          |
          v
 deterministic chunks
          |
          +----------------------+
          |                      |
          v                      v
   SQLite source/chunk      FTS5 token index
      persistence           candidate lookup
          |                      |
          +----------+-----------+
                     |
                     v
             P2A-P1 BM25 math
                     |
                     v
          serialized byte budget
```

Persistence rules:

- no npm/native dependency is added
- `node:sqlite` is feature-detected at runtime
- package-wide Node `>=20` compatibility remains intact
- persistent retrieval requires a runtime with usable `node:sqlite` and FTS5
- source IDs remain immutable bindings to content digests
- close/reopen must preserve retrieval results
- FTS5 stores encoded canonical lexical tokens rather than raw text tokens
- candidate chunks are re-scored with the same P2A-P1 BM25 formula
- chunk content integrity is verified before a result is returned
- persisted token derivation and token counts are recomputed from chunk content before ranking
- FTS5 row membership and encoded lexical text are verified against canonical chunk content before search
- `EXACT_EVIDENCE` and `DURABLE_MEMORY_REFERENCE` remain refused from lexical indexing

SQLite is a persistence and candidate-retrieval mechanism only. It receives no execution, model, memory, wallet, trade, or git authority.
