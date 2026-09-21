# P3B-P5 — Retrieval Quality Lab

P3B-P5 evaluates whether Context Core retrieval returns the right material,
not whether context diversion saved bytes.

The lab runs the real `PersistentLexicalIndex` against a source-controlled,
versioned corpus. Relevance labels are source IDs. For each case, the evaluator
requests the full controlled corpus chunk set from the chunk-level retrieval
surface before deduplicating by first source occurrence. This prevents duplicate
chunks from one source from consuming the result limit and crowding another
source out before source-level scoring. Multiple chunks from the same source
therefore cannot multiply one document into several relevance hits or hide a
lower-ranked source solely because of chunk multiplicity.

## Report provenance

Every result carries:

- `corpusId`
- `corpusVersion`
- canonical `corpusDigest`
- corpus `provenance`
- `evaluatorVersion`
- deterministic `reportDigest`

The corpus digest hashes a recursively key-sorted JSON representation, so
object-key insertion order does not change corpus identity.

The evaluator uses no hidden clock and no network access.

## Metrics

Each query case declares `k`, a non-empty set of relevant source IDs, retrieval
mode, match semantics, and optional tags.

The report computes:

- **Precision@k** — relevant source hits in top-k divided by `k`.
- **Recall@k** — relevant source hits in top-k divided by relevant source count.
- **MRR** — mean reciprocal rank of the first relevant source.
- **nDCG@k** — binary source relevance DCG divided by ideal DCG.
- **False-positive rate@k** — irrelevant top-k source hits divided by the number
  of non-relevant sources in the corpus.

No quality threshold is baked into the evaluator. A weak score is reported as
measurement, not converted into a fabricated pass.

## Adversarial slices

Source-controlled cases may carry tags. P3B-P5 v1 publishes dedicated aggregate
slices for:

- `TYPO`
- `CROSS_STYLE_IDENTIFIER`

The initial synthetic corpus also contains an adversarial authority query and
an unrelated distractor source.

## Exact-evidence preservation

Exact-evidence cases are evaluated separately from relevance metrics.

Each case is passed through `prepareContextIngress(...)` with classification
`EXACT_EVIDENCE` and an intentionally tiny inline budget. The case passes only
when:

- mode remains `INLINE`;
- model-bound text equals the original content byte-for-byte;
- raw/context byte counts equal the actual UTF-8 source bytes;
- `bytesAvoided == 0`;
- `sourceRef == null`; and
- a tiered lexical query cannot retrieve the protected exact-evidence source.

This proves preservation and non-fuzzy-substitution behavior without pretending
exact evidence is ordinary retrieval material.

## Separation from efficiency telemetry

P3B-P4 and P3B-P5 answer different questions.

P3B-P4 measures exact byte accounting for diversion/retrieval pressure.

P3B-P5 measures relevance quality.

The P3B-P5 report intentionally excludes:

- `bytesAvoided`
- retrieval/context byte accounting
- net byte savings
- token savings
- cost savings
- savings percentages

Quality metrics are therefore never used as a substitute for context-efficiency
metrics, and context-efficiency metrics are never used as a substitute for
retrieval quality.

## Authority

The lab adds no model calls, arbitrary code execution, shell execution, network
access, authority grants, durable-memory writes, wallet access, trade execution,
or git-write authority.
