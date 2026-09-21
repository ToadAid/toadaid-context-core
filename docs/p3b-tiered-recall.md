# P3B-P3 — Tiered explainable recall

## Purpose

Increase retrieval recall without turning Context Core into an opaque fuzzy
matcher.

P3B-P3 is clean-room designed. Existing exact lexical search stays the default
and keeps its existing response envelope. Broader recall is explicitly enabled
with `recall: "tiered"`.

## Recall order

Tiered search admits each chunk through the strongest matching lane:

1. `EXACT`
2. `IDENTIFIER`
3. `MORPHOLOGY`
4. `SUBSTRING`

A chunk admitted by a stronger lane is never duplicated by a weaker lane.
Ordering is lane-first, then deterministic BM25 score and stable identity
tie-breaks.

Every returned tiered result includes `matchKind`.

## Identifier lane

Structured code identifiers are split deterministically without rewriting raw
content.

Examples:

- `buildResumePacket` -> `build`, `resume`, `packet`
- `build_resume_packet` -> `build`, `resume`, `packet`

A full structured query drops its style-specific compound token from the
identifier lane and keeps the semantic parts. Therefore camelCase and
snake_case forms can match each other under strict `match: "all"`.

Ordinary query words remain exact terms in the identifier lane, so mixed
queries such as `urgent build_resume_packet` still require `urgent` while the
structured identifier is matched by its parts.

## Morphology lane

A deliberately conservative, deterministic English morphology key supports
common inflection recovery such as `running` and `runs` through `run`.

This is not presented as linguistic understanding and uses no model.

## Substring lane

Substring admission requires a real contiguous match inside one structured
identifier value. It cannot stitch query fragments across multiple identifiers.

Bounded 3-character fragments are derived only from structured identifiers and
are used only to rank results after contiguous substring admission. Ordinary
prose does not participate in substring matching.

Query fragments shorter than four characters do not activate the substring
lane. Underscores are removed from the substring query form so partial
snake_case queries can match equivalent camelCase identifiers without
rewriting stored source bytes.

## Persistent safety

P3B-P3 does not add a second persistent fuzzy index yet.

For `PersistentLexicalIndex`, tiered recall:

1. counts stored chunks and refuses immediately if `maxRecallScanChunks` would
   be exceeded;
2. only after that preflight bound passes, runs existing global FTS and
   structural-integrity verification over the bounded store;
3. scans the same bounded exact stored chunks;
4. re-verifies chunk/token/metadata integrity;
5. derives recall projections in memory from verified raw bytes.

It never silently returns a partial fuzzy result set.

This intentionally establishes semantics before adding a future derived FTS
acceleration layer.

## Compatibility

- default `recall: "exact"` behavior is unchanged;
- exact-mode response shape remains unchanged;
- raw source bytes are never rewritten;
- exact evidence and protected durable-memory classes keep their existing
  admission boundaries.

## Authority

P3B-P3 adds no model call, embedding call, shell/code execution, network
access, wallet/trade authority, approval authority, git authority, or governed
durable-memory write.
