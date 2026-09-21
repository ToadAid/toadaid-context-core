# Architecture

ToadAid Context Core is a provider-neutral context-pressure and continuity
substrate for host agents.

Its governing rule is:

> **Context is disposable. Memory is governed. Evidence is exact. Authority is external.**

Context Core decides how already-produced textual material can be represented,
indexed, retrieved, and carried across context loss. It does **not** decide what
the host should do, call models, execute tools, grant permissions, or perform
side effects.

## Trust boundary

```text
host agent / application
        |
        | already-produced text + explicit metadata
        v
+--------------------------+
| Context Core             |
|                          |
| classify / ingress       |
| exact-evidence boundary  |
| bounded lexical recall   |
| session journal          |
| continuity handoff       |
| proof-carrying byte      |
| accounting               |
+--------------------------+
        |
        | bounded text, references, receipts,
        | continuity packets, retrieval results
        v
host-owned model / planner / tool loop
```

The host remains sovereign over model calls, planning, tool selection, durable
memory writes, network access, shell execution, wallets, trades, Git writes,
permissions, and every other side effect.

`contextCoreCapabilities()` makes this boundary machine-readable. All execution
and authority capabilities are `false`.

## Data paths

### 1. Classification and exact evidence

Incoming text is classified before reduction or retrieval admission.

- `EXACT_EVIDENCE` is preserved byte-for-byte. It is never silently truncated
  or substituted with fuzzy retrieval.
- `WORKING_CONTEXT` may be bounded while retaining a raw content reference.
- `BULK_MATERIAL` and `RETRIEVABLE_KNOWLEDGE` may be diverted into lexical
  retrieval when policy allows.
- `DURABLE_MEMORY_REFERENCE` remains an external reference. Context Core does
  not dereference or write durable memory on its own.

If mandatory exact evidence cannot fit a declared byte budget, construction
fails closed instead of weakening the evidence.

### 2. Pre-context ingress

`prepareContextIngress()` is the canonical boundary for deciding whether text
stays inline or is deferred into retrieval.

`prepareToolOutputIngress()` is the provider-neutral host integration seam for
textual tool output. Its source identity binds the tool name, tool-call identity,
and exact output bytes. Structured host data is not silently stringified into
model context.

The host keeps authoritative structured results and all execution authority
outside Context Core.

### 3. Retrieval

Context Core provides deterministic chunking and lexical retrieval in both
in-memory and persistent forms.

The persistent index adds integrity-checked storage, metadata-scoped retrieval,
restart continuity, and candidate-bounded tiered recall. Derived identifier,
morphology, and substring lanes broaden recall without changing exact-search
truth or admitting protected evidence classes as fuzzy substitutes.

Retrieval is bounded by explicit result, byte, and candidate-work limits. When
an integrity or work-bound invariant cannot be proven, retrieval refuses rather
than silently degrading.

### 4. Session continuity

`PersistentSessionJournal` records append-only, integrity-bound session events.
`buildResumePacket()` reconstructs bounded current state from verified journal
truth, including objective, Git state, active errors, decisions, tasks,
constraints, files, references, exact evidence, and omission identities.

`buildContinuityHandoff()` combines the resume packet with explicit retrieval
queries. `buildContinuityTransport()` binds the authoritative serialized bytes
that a host can carry across context loss.

Omitted history remains recoverable through snapshot-bound event and evidence
references instead of disappearing behind a summary.

### 5. Evidence and accounting

Context ingress and retrieval can emit verifiable receipts. Session, project,
and global ledgers recompute byte accounting from those proofs.

The accounting claim is deliberately narrow: measured UTF-8 bytes observed,
returned, avoided, or added. Context Core does not invent token, percentage,
cost, or model-efficiency claims that it cannot prove.

## Public module map

| Surface | Responsibility |
| --- | --- |
| `classify.mjs` | Canonical context classification policy |
| `store.mjs` | SHA-256 content-addressed raw text storage with integrity verification |
| `core.mjs` | Core ingestion and deterministic reduction invariants |
| `packet.mjs` | Byte-bounded context packets with exact-evidence fail-closed behavior |
| `retrieval.mjs` | Deterministic chunking, exact lexical search, and tiered in-memory recall |
| `persistent-retrieval.mjs` | Restart-safe integrity-bound persistent lexical retrieval |
| `session-events.mjs` | Append-only integrity-bound session journal |
| `resume-packet.mjs` | Deterministic bounded state reconstruction and omission truth |
| `continuity-handoff.mjs` | Retrieval-aware continuity handoff and authoritative transport |
| `ingress.mjs` | Canonical pre-context inline/deferred admission |
| `tool-output.mjs` | Provider-neutral textual tool-output ingress adapter |
| `telemetry.mjs` | Proof-carrying byte receipts, ledgers, and reports |
| `retrieval-quality.mjs` | Deterministic retrieval-quality evaluation without invented thresholds |
| `capabilities.mjs` | Machine-readable zero-authority capability declaration |

`src/index.mjs` is the supported package entrypoint over these surfaces.

## Persistence and integrity

Persistent retrieval and the session journal use SQLite-backed state. Their
public contracts bind canonical content, source identity, derived retrieval
state, metadata, and session-chain truth strongly enough to detect the tested
tampering and partial-loss cases.

Context Core distinguishes canonical truth from derived acceleration data.
Derived data may be rebuilt only where the contract proves that rebuilding is
safe; ambiguous partial corruption fails closed.

## Provider neutrality

Context Core is not an MCP server and is not coupled to a model vendor. A host
may integrate it with an MCP client/server, desktop agent, CLI agent, local
model, hosted model, or another orchestration layer without moving authority
into Context Core.

The intended host pattern is:

```text
tool executes under host authority
        |
        +--> structured result -----------------> host-only state
        |
        +--> textual output
                 |
                 v
        prepareToolOutputIngress()
                 |
                 +--> INLINE text -------------> model context
                 |
                 +--> DEFERRED preview --------> model context
                         |
                         +----------------------> bounded retrieval on demand
```

## Explicit non-goals

Context Core does not:

- call language models;
- execute arbitrary code or shell commands;
- make network requests;
- own tool permissions or approval policy;
- grant execution authority;
- write governed durable memory by itself;
- access wallets or execute trades;
- write Git state;
- choose a model provider or agent identity;
- automatically dereference external memory references.

Execution belongs outside this package. If ToadAid develops a governed execution
capsule, it remains a separate authority-bearing component that may consume
typed Context Core outputs; it does not turn Context Core itself into an
executor.

## Design test

A useful integration question is:

> If Context Core disappeared, would the host still be the authority that
> decides and performs side effects?

The answer must remain **yes**.
