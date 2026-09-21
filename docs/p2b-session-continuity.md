# P2B — Session Continuity

P2B turns transient agent work into a bounded, restart-safe continuity substrate without turning Context Core into a durable-memory owner or an execution engine.

## P2B-P1 — normalized append-only session event journal

A session event is a compact fact about the work that happened:

```text
OBJECTIVE
DECISION
ERROR
FILE_READ
FILE_EDIT
GIT_STATE
CONSTRAINT
TASK
EXTERNAL_REF
```

Each event carries:

- session identity
- event kind
- normalized timestamp
- source / attribution
- project and repository labels
- importance
- compact working text
- normalized tags
- optional raw external reference
- optional durable-memory references
- optional exact-evidence fields
- small structured data
- optional adapter dedupe key

## Integrity model

Each session is an append-only hash chain:

```text
event 1 digest
      |
      v
event 2 prevDigest + digest
      |
      v
event 3 prevDigest + digest
      |
      v
durable session head
```

The durable head records event count, last sequence, last event ID, and last digest.

Reads verify:

- continuous sequence numbering
- canonical event JSON
- serialized byte count
- event identity
- previous-digest linkage
- event digest
- deterministic event ID
- durable session-head agreement

This detects ordinary row deletion, content tampering, reorder drift, identity drift, and broken hash links before continuity data is returned.

## Idempotent adapter ingestion

Adapters may provide a `dedupeKey`.

Replaying the same key with exactly the same normalized event returns the original event without appending another row.

Reusing the same key for different content fails closed.

This is intended for host hooks and tool adapters that may retry delivery.

## Context-pressure boundary

The event journal is not a raw-output bucket.

Events are byte bounded. Large tool output belongs in content-addressed bulk storage or the retrieval substrate, with the event carrying a compact fact and `rawRef`.

## Exact evidence boundary

Exact evidence is carried separately as `{ label, value }` pairs.

Values are stored and returned byte-for-byte. They are not converted into fuzzy search text in P2B-P1.

Git SHAs, receipt hashes, transaction hashes, authority decisions, and similar exact material remain exact.

## Durable-memory boundary

`memoryRefs` are references only.

Context Core does not write, revise, infer, or own governed durable memory.

## Shared SQLite substrate

`PersistentSessionJournal` can use the same SQLite database file as `PersistentLexicalIndex`.

The tables are separate, but the storage substrate is shared so a host does not need competing persistence stacks.

## What P2B-P1 does not do

P2B-P1 adds no:

- model calls
- LLM summarization
- shell execution
- arbitrary-code execution
- git mutation
- wallet or trading authority
- durable-memory writes
- host-tool interception
- autonomous authority

## Next: P2B-P2

P2B-P2 will construct a bounded `ResumePacket` from verified session events.

The packet will prioritize current objective, recent decisions, unresolved errors, active files, git state, constraints, tasks, and references for deeper retrieval without replaying the full session history.

## P2B-P2 — bounded deterministic ResumePacket

P2B-P2 reconstructs useful working state from the verified P2B-P1 journal without replaying the whole conversation.

```text
verified session journal
        |
        v
deterministic state reconstruction
        |
        +-- latest objective
        +-- latest git state
        +-- unresolved errors
        +-- recent decisions
        +-- open tasks
        +-- recent constraints
        +-- unique active files
        +-- raw / memory references
        +-- exact evidence
        |
        v
serialized byte budget
        |
        v
bounded ResumePacket
```

### Lifecycle law

`ERROR` and `TASK` events may carry:

```json
{
  "lifecycleKey": "stable-logical-identity",
  "status": "open"
}
```

The latest event for each `lifecycleKey` defines current state.

Errors are closed by `resolved` or `closed`.

Tasks are closed by `done`, `completed`, `closed`, or `cancelled`.

If a lifecycle key is absent, the event ID is its own lifecycle identity.

Unknown or absent statuses remain open rather than being silently treated as complete.

### Mandatory anchors

The latest `OBJECTIVE` and latest `GIT_STATE`, when present, are mandatory resume anchors.

Their exact evidence is mandatory with them.

If either anchor plus its exact evidence cannot fit the requested byte budget, resume construction fails closed rather than returning a misleading packet.

### Exact evidence law

Exact evidence is never shortened, rewritten, summarized, or partially copied.

Evidence attached to a state fact is included only when that whole fact is included.

The packet reports omitted fact and exact-evidence counts so omission is observable.

P2B-P2 does not claim that every historical exact-evidence field belongs in every resume packet; it reconstructs current bounded working state.

### Priority law

After mandatory anchors, packet space is allocated deterministically in this order:

1. unresolved errors
2. recent decisions
3. open tasks
4. recent constraints
5. active files
6. raw / durable-memory references

Errors and tasks are ordered by importance, then recency.

Decisions, constraints, files, and references are newest-first.

### Budget truth

`usedBytes` is the actual UTF-8 byte length of serialized packet JSON.

Every section has an explicit omission count.

Configured section caps are part of omission accounting: material excluded by a `max*` cap remains counted as omitted, not silently erased before byte-budget packing.

This means:

```text
[] with omitted=0
```

means there was nothing else to include, while:

```text
[] with omitted>0
```

means material exists outside the current packet budget.

### No summarization authority

Resume construction is deterministic code.

It makes no model call and performs no LLM summarization.

The original compact event text is carried unchanged when selected.

### Retrieval boundary

`rawRef` and `memoryRefs` remain references.

The ResumePacket does not dereference them automatically and does not gain authority over the stores they point to.

A host may use those references or the lexical retrieval substrate to fetch deeper context after resume.

### What remains next

P2B-P3 should prove compaction continuity end-to-end:

```text
long working session
  -> append events
  -> simulate context loss
  -> rebuild ResumePacket
  -> retrieve one omitted detail
  -> continue the same objective correctly
```

That proof should measure actual serialized bytes and continuity accuracy rather than inventing a token-savings multiplier.

## P2B-P3 — context-loss continuity handoff

P2B-P3 wires the verified session journal, bounded ResumePacket, and persistent lexical retrieval into one provider-neutral handoff.

```text
long working session
        |
        v
verified event journal + retrieval store
        |
   context is lost
        |
        v
reopen durable stores
        |
        v
bounded ResumePacket
        |
        +---- explicit retrieval queries from host/provider layer
        |              |
        |              v
        |       bounded lexical results
        |              |
        +--------------+
               |
               v
     bounded ContinuityHandoff
```

### What the handoff proves

The handoff proves that after the model's prior conversational context is absent, Context Core can still provide:

- the same verified current objective
- the same verified git anchor
- unresolved working state
- truthful omissions
- explicitly requested deeper detail from the retrieval substrate
- a real combined serialized byte bound

The end-to-end regression closes and reopens both the journal and lexical index before constructing the handoff.

The proof then retrieves an intentionally omitted continuity detail from persistent retrieval while preserving the same objective.

### Query-authority and session-isolation boundary

Context Core does not invent retrieval queries.

`retrievalQueries` are explicit inputs from the host or provider adapter.

Continuity retrieval is session-bound by default: P2B-P3 calls the lexical index with an exact metadata equality constraint for the resumed `sessionId`.

Persisted source metadata is integrity-bound with a SHA-256 digest. Scoped retrieval verifies that digest before evaluating the `sessionId` constraint.

A lexically stronger chunk from another session is therefore not eligible for the continuity handoff, and changing persisted metadata to relabel that chunk fails closed.

Legacy sources without a metadata digest remain usable by unscoped retrieval, but scoped continuity retrieval refuses them until an integrity baseline has been established.

This prevents a shared persistent index from bleeding one agent/session's working context into another session while keeping query choice outside Context Core.

The underlying lexical `search()` API keeps metadata filtering optional for non-continuity callers.

### Whole-result packing

Each lexical retrieval response is independently bounded by `retrievalMaxBytes`.

The complete retrieval response is then either included whole in the ContinuityHandoff or omitted whole if the total handoff budget cannot carry it.

No retrieval result is truncated by P2B-P3.

`omittedRetrievalQueries` makes that omission observable.

### Total budget truth

The handoff has its own `budgetBytes` and `usedBytes`.

`usedBytes` is the actual serialized UTF-8 byte length of the entire model-visible handoff:

```text
ResumePacket
+ selected retrieval responses
+ handoff envelope
```

The ResumePacket is mandatory. If the total handoff cannot carry the mandatory resume material, construction fails closed.

### Integrity composition

P2B-P3 does not weaken lower-layer checks.

Before continuity material is returned:

- P2B-P1 verifies the session event hash chain and durable session head
- P2B-P2 verifies resume construction and exact-evidence budget law
- P2A-P2 verifies persisted lexical rows, tokens, chunk digests, and FTS integrity
- P2B-P3 verifies the total serialized handoff budget

A retrieval integrity failure aborts the handoff.

### Reference boundary

Raw and durable-memory references remain references.

P2B-P3 does not automatically dereference:

- `rawRef`
- `memoryRefs`

and gains no authority over those stores.

### No model correctness claim

P2B-P3 is a model-free continuity-substrate proof.

It proves that the model can be handed the same objective plus retrieved omitted detail after restart/context loss.

It does not claim that an arbitrary downstream model will reason correctly from that material.

### Next integration lane

After P2B-P3, provider and agent adapters can consume the handoff:

```text
agent/provider adapter
        |
        v
ContextEvent ingestion
        |
        v
ContinuityHandoff on restart/compaction
        |
        v
model context
```

The Core remains provider-neutral and retains zero execution, wallet, git-write, or durable-memory authority.
