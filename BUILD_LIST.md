# ToadAid Context Core — BUILD LIST

> Context is disposable. Memory is governed. Evidence is exact. Authority is external.

This file is the canonical forward build list for `ToadAid/toadaid-context-core`.

Clean-room rule: external projects may inform concepts and test ideas, but source code is not transplanted.

## Completed foundation

- [x] **P3B-P1 — Pre-context diversion**
  - Route already-produced oversized context before model ingress.
  - Preserve exact evidence and governed-memory references inline.
  - Index eligible bulk material and emit a bounded `CONTEXT_REFERENCE`.
  - Measure actual UTF-8 bytes; make no fictional token-savings claim.

- [x] **P3B-P2 — Structure-aware deterministic chunking**
  - Markdown heading-aware chunking.
  - Fenced code remains structural code across oversized splits.
  - Exact source reconstruction.
  - Integrity-bind chunk mode and structure labels.

- [x] **P3B-P3 — Explainable tiered lexical recall**
  - Recall order: `EXACT -> IDENTIFIER -> MORPHOLOGY -> SUBSTRING`.
  - Structured identifiers match across naming styles.
  - Substring admission requires a real contiguous identifier substring.
  - `matchKind` explains why a result was admitted.
  - Recall scan remains bounded.

## Active lane

- [x] **P3B-P4 — Proof-carrying context telemetry**
  - [x] **P3B-P4-P1 — Ingress byte receipt**
    - Produce a deterministic receipt from `prepareContextIngress(...)`.
    - Re-measure `contextBytes` from the actual model-bound payload.
    - Bind the exact model-bound payload with `contextDigest`, separately from raw-source `sourceContentDigest`.
    - Require `bytesAvoided = rawBytes - contextBytes`.
    - For deferred ingress, bind the receipt to the retrieval `sourceRef`, source content digest, ordered chunk count, chunk byte total, and chunk digests through an integrity digest.
    - For inline ingress, prove `rawBytes == contextBytes` and `bytesAvoided == 0`.
    - Optional caller-supplied event ID / observation timestamp; no hidden clock.
    - No tokenizer estimate and no `tokensSaved` field.
    - No model, network, shell, wallet, git-write, durable-memory, or execution authority.

  - [x] **P3B-P4-P2 — Retrieval debit receipt**
    - Measure the exact UTF-8 bytes of the serialized retrieval response actually returned.
    - Require measured response bytes to equal the retrieval response's stabilized `usedBytes`.
    - Bind the query, recall mode, bounded response, source/chunk provenance, metadata, scores/match kinds, and returned chunk contents through integrity digests.
    - Recompute every returned chunk digest from `sourceId + NUL + chunkIndex + NUL + content`; reject chunk-ID/content drift.
    - A real zero-result retrieval still debits its nonzero response-envelope bytes.
    - A receipt cannot exist without a concrete retrieval response.
    - No token estimate, cost estimate, savings percentage, or net-savings claim yet.

  - [x] **P3B-P4-P3 — Net-savings ledger + aggregation invariants**
    - Session ledgers consume proof-carrying P4-P1 ingress receipts and P4-P2 retrieval-debit receipts.
    - `grossBytesAvoided` credits only `DEFERRED` ingress; `INLINE` ingress always contributes zero credit.
    - `retrievalBytes` is the exact sum of concrete retrieval-debit receipt bytes.
    - `netBytesAvoided = max(grossBytesAvoided - retrievalBytes, 0)`.
    - `netBytesAdded = max(retrievalBytes - grossBytesAvoided, 0)` so negative net can never masquerade as savings.
    - Duplicate ingress, retrieval, or child-ledger digests fail closed across the full hierarchy.
    - Aggregate ledgers carry transitive leaf receipt-digest provenance so sibling ledgers cannot double-count the same proof under different scope IDs.
    - Aggregation hierarchy is strict: `SESSION -> PROJECT -> GLOBAL`.
    - Project/global totals are recomputed from child gross/debit totals, not trusted child net labels.
    - `NO DIVERSION = NO SAVINGS CREDIT`.
    - No token estimate, cost estimate, or savings percentage.

  - [x] **P3B-P4-P4 — Honest reporting surface**
    - Build one evidence-bound byte report for `SESSION`, `PROJECT`, or `GLOBAL` ledgers.
    - Re-derive `observedRawBytes` and `ingressContextBytes` from the exact ingress receipts bound by the ledger.
    - Re-derive `retrievalBytes` from the exact retrieval-debit receipts bound by the ledger.
    - Require the supplied receipt-digest order to match the ledger exactly, including transitive leaf provenance for aggregate ledgers.
    - Cross-check gross/debit/net arithmetic against the P4-P3 ledger before a report can exist.
    - Report `netBytesAdded` separately; never present a negative value as savings.
    - Bind scope, byte totals, ledger digest, receipt digests, child-ledger digests, and metric semantics into `reportDigest`.
    - Verification requires the exact canonical report field set; unknown, missing, or unbound fields fail closed.
    - `retrievalBytes` means serialized retrieval-response bytes returned to the caller; it is not proof of model-input insertion.
    - This provider-neutral cut emits no token fields because no named tokenizer measurement adapter is wired.
    - No hardcoded percentages, bytes/4 token fiction, or cost-savings estimate.

## Next capability cuts

- [x] **P3B-P5 — Retrieval Quality Lab**
  - Run the real `PersistentLexicalIndex` against a source-controlled reproducible corpus and adversarial cases.
  - Score source-level relevance after retrieving the controlled corpus chunk set and deduplicating chunk hits by first source occurrence.
  - Prevent duplicate chunks from one source from crowding other sources out before source-level scoring.
  - Measure Precision@k, Recall@k, MRR, nDCG@k, and false-positive rate@k with explicit formulas.
  - Publish tagged `TYPO` and `CROSS_STYLE_IDENTIFIER` quality slices without inventing a pass threshold.
  - Prove `EXACT_EVIDENCE` remains byte-identical inline and cannot leak into fuzzy retrieval.
  - Publish corpus ID/version/provenance plus canonical corpus digest with every result.
  - Keep compression/context-efficiency metrics completely separate from retrieval-quality metrics.
  - Deterministic evaluation only: no hidden clock, model call, network, shell, wallet, git-write, or durable-memory authority.

- [x] **P3B-P6 — Trustworthy continuity under pressure**
  - Produce one final continuity artifact whose exact serialized bytes are bounded, whose active mandatory evidence is complete, and whose omissions are deterministically recoverable—or fail closed.
  - Keep enforcement inside continuity construction; telemetry observes but does not authorize or enforce.
  - Keep retrieval semantic changes, fuzzy search, embeddings, model summaries, policy DSLs, and optimization engines outside this lane.

  - [x] **P3B-P6-P1 — Active continuity projection**
    - Build the active continuity candidate set before section caps or total-byte pressure are applied.
    - Define current objective/repository state, unresolved blocking errors, open immediate tasks, and active constraints using deterministic lifecycle truth.
    - Add the minimum constraint lifecycle/supersession semantics required to distinguish active constraints from historical ones; do not treat “most recent N” as active-state truth.
    - Perform a global exact-evidence census across every journal event kind before ordinary event selection.
    - Active mandatory exact evidence remains inline byte-for-byte and can never be silently omitted, summarized, truncated, or replaced by fuzzy retrieval.
    - Count exact evidence from every journal event kind before ordinary section selection; evidence outside the mandatory active projection remains explicit omission truth in P6-P1.
    - Keep historical exact-evidence omission recovery out of P6-P1; P6-P2 must replace that omission truth with exact snapshot-bound journal references before recoverability is claimed.
    - Keep the projection bound to the verified journal snapshot/head and preserve restart determinism.
    - No model, network, shell, wallet, trade, git-write, durable-memory-write, or authority-grant capability.

  - [x] **P3B-P6-P2 — Snapshot-bound omission recovery**
    - Replace anonymous omission counts with deterministic omission identities bound to the verified journal snapshot.
    - Make omitted historical events recoverable through exact journal-native references such as session ID, event ID, sequence, and event digest.
    - Preserve references required to recover omitted material before optional inline history.
    - Identify omitted retrieval queries explicitly instead of reporting only a count.
    - Never claim recoverability for an omission that cannot be integrity-bound to a verified source.

  - [x] **P3B-P6-P3 — Transport-final serialized boundary**
    - Make the handoff own one authoritative total UTF-8 byte ceiling.
    - Serialize the final compact transport artifact inside Context Core and return the exact measured bytes/string.
    - Require `usedBytes == UTF8_BYTES(finalSerializedHandoff) <= totalMaxBytes`.
    - Drop optional retrieval first, then recoverable historical inline material, while preserving the active mandatory projection and omission-recovery manifest.
    - Fail closed when mandatory active state/evidence plus recovery truth cannot fit.
    - Verify deterministic transport bytes across restart and preserve zero execution authority.

- [x] **P3B-P7 — Integrity-bound derived recall acceleration**
  - Persist versioned IDENTIFIER / MORPHOLOGY / SUBSTRING projections per canonical chunk.
  - Bind each projection to exact source/chunk identity, chunk digest, canonical serialized projection bytes, and projection digest.
  - Rebuild only missing derived rows from canonical chunk truth; malformed, version-drifted, digest-mismatched, or semantically forged rows fail closed.
  - Feed the unchanged P3B-P3 scorer from persisted projections, preserving `EXACT -> IDENTIFIER -> MORPHOLOGY -> SUBSTRING`, `matchKind`, BM25 ranking, metadata isolation, response byte budgets, and bounded scan law.
  - Derived recall state remains rebuildable acceleration only; it never becomes canonical source truth or weakens admission rules.

- [x] **P3B-P8 — Indexed candidate-bounded tiered recall**
  - [x] **P3B-P8-P1 — Integrity-bound candidate postings**
    - Materialize normalized EXACT / IDENTIFIER / MORPHOLOGY / SUBSTRING_FRAGMENT postings from canonical P7 projection truth.
    - Bind every candidate manifest to the exact chunk digest and P7 projection digest.
    - Rebuild only a wholly missing manifest/posting set from canonical truth; partial loss, tampering, version drift, or semantic forgery fails closed.
    - Add a deterministic SQLite lookup index over `(lane, term, chunk_id)` for the next bounded-candidate execution cut.
    - Keep existing tiered search and BM25 corpus statistics unchanged in P8-P1; no candidate-only scoring shortcut is permitted.
    - Preserve exact search, tier order, `matchKind`, metadata isolation, response byte budgets, and zero authority.
  - [x] **P3B-P8-P2 — Candidate-bounded scorer integration**
    - Use indexed postings to discover a bounded candidate set without materializing every stored chunk.
    - Compute exact metadata-scoped corpus statistics for EXACT / IDENTIFIER / MORPHOLOGY while preserving the existing scorer as the ranking oracle.
    - Bind the live retrieval view to a SQLite mutation epoch over source/chunk/projection/candidate tables so post-open external drift fails closed before candidate discovery or corpus-stat use; unrelated shared-database tables do not invalidate recall.
    - Keep SUBSTRING fragment postings as a candidate superset and re-run canonical substring eligibility before its lane statistics/scoring.
    - Prove byte-for-byte public result equivalence to the full-corpus scorer on controlled valid stores, including metadata-scoped ranking.
    - Make `maxRecallScanChunks` bound actually materialized/verified candidate chunks rather than total stored history; over-bound candidate work refuses instead of truncating.
    - Keep exact-search FTS integrity behavior and Context Core's zero-authority boundary unchanged.

- [x] **P3C — Real tool-output routing**
  - [x] **P3C-P1 — Provider-neutral tool-output ingress adapter**
    - Accept already-produced textual tool output plus explicit tool name/call identity; never execute the tool.
    - Bind tool provenance plus the exact textual output digest into deterministic source identity and retrieval metadata before any diversion, so identical call/output pairs are stable while divergent bytes cannot share one source identity.
    - Delegate classification, exact-evidence protection, byte-benefit checks, indexing, and bounded reference construction to the canonical `prepareContextIngress(...)` path instead of inventing parallel routing semantics.
    - Return the exact `modelText` selected for model ingress plus a proof-carrying ingress receipt; `bytesAvoided` remains measured UTF-8 byte truth.
    - Refuse non-string content so host-owned structured result data cannot be silently stringified, stored, or substituted for the host callback.
    - Preserve zero model/network/shell/wallet/trade/git-write/durable-memory/authority capability.
  - [x] **P3C-P2 — Live host adoption**
    - Adopt `prepareToolOutputIngress(...)` in at least one real host tool-result path before model ingress (Trading Desk first).
    - Keep the host's structured tool result authoritative and separate; only the textual model-bound view passes through Context Core.
    - Require explicit exact-evidence classification for write/trade/authority-sensitive result text that must remain byte-identical inline.
    - Feed savings accounting only from the returned canonical ingress receipt.
    - Prove end-to-end retrieval of omitted tool-output detail, bounded model text, host-data preservation, and zero authority expansion.
    - Live adoption proof: `ToadAid/trading-desk` PR #260 merged as squash `07cf453d9b3094caf81b3988de655d96bd20658b`; exact consumer delta was 8 paths, Context Core focused verification passed 22/22, TypeScript passed, and the final combined Trading Desk suite passed 4177/4177.
    - The live host routes successful textual tool results through `prepareToolOutputIngress(...)` before provider and durable-thread ingress while trusted structured `result.data` remains host-owned and zero authority is preserved.

## Public release hardening

- [x] **R1 — Public repository foundation**
  - Add an MIT license consistent with ToadAid's existing open-source software convention.
  - Add security reporting, contribution, and community-conduct guidance.
  - Add a changelog for public-contract milestones.
  - Add a human + coding-agent installation guide for reviewed local/file integration.
  - Remove the obsolete current-tree `docs/research-notes.md` before public release.
  - Complete package repository/homepage/issues/license metadata while keeping `private: true`.
  - Link installation and public governance surfaces from the README.
  - Run a high-confidence full-history secret/sensitive-filename preflight before the cut; final visibility gating must rerun history review.
  - Make no repository-visibility change and publish no npm package in R1.

- [ ] **R2 — Final public visibility gate**
  - Re-run full-history and current-tree credential/sensitive-material review.
  - Explicitly inspect Git history for `docs/research-notes.md`: deleting it from the current tree does not remove historical copies. If historical publication is unacceptable, use a clean-history public-release strategy rather than a casual history rewrite or force push.
  - Review GitHub Actions and repository settings for safe public operation.
  - Verify README, license, security policy, contribution guidance, examples, package metadata, and changelog from a fresh clone.
  - Verify the complete deterministic suite from the exact candidate head.
  - Keep npm publication separate from repository visibility; `private: true` remains until an explicit package-release decision.
  - Change repository visibility only under explicit operator approval after the final gate passes.

## Separate future module — not Context Core

- [ ] **P4 — Governed Exec Capsule**
  - Adopt the useful “think in code” pattern without giving Context Core execution authority.
  - Explicit filesystem mounts.
  - Network OFF by default.
  - Environment allowlist.
  - CPU / memory / wall-clock / output limits.
  - Runtime/executable allowlist.
  - No wallet authority.
  - No trade authority.
  - No implicit git-write authority.
  - Immutable execution receipt.
  - Capability grants remain external and typed.

## Non-negotiable Context Core authority boundary

`contextCoreCapabilities()` remains false for:

- model calls
- arbitrary code execution
- shell execution
- network access
- authority grants
- durable memory writes
- wallet access
- trade execution
- git writes

Ceremony supports the product; it is not the product. Each cut should deliver a real capability with bounded tests and exact evidence.
