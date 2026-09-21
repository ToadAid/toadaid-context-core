# P3B-P7 — Integrity-bound derived recall acceleration

P3B-P7 accelerates the existing P3B-P3 tiered lexical recall without changing its admission or ranking semantics.

## What is persisted

For every canonical chunk, `PersistentLexicalIndex` persists one versioned derived projection containing:

- structured-identifier tokens,
- conservative morphology tokens,
- structured substring values,
- substring fragment tokens.

The row is bound to:

- the exact canonical `chunk_id`,
- source ID,
- chunk index,
- canonical chunk digest,
- projection version,
- canonical serialized projection digest.

Missing derived rows are rebuildable from canonical chunk truth. Existing malformed, mismatched, version-drifted, or semantically forged rows fail closed.

## Search law

The existing P3B-P3 scorer remains authoritative:

`EXACT -> IDENTIFIER -> MORPHOLOGY -> SUBSTRING`

`matchKind`, lane priority, BM25 math, metadata isolation, response byte budgets, and bounded scan behavior do not change.

P7 only replaces repeated per-query reconstruction of identifier/morphology/substring projections with verified persisted derived projections.

## Authority

The derived projection is an acceleration structure only.

It grants no:

- model-call authority,
- network access,
- shell/code execution,
- durable-memory authority,
- wallet or trade authority,
- git-write authority,
- authority grants.

Canonical source/chunk truth remains outside the derived projection. The projection may be rebuilt; it may never weaken recall admission rules or become source truth.
