# North Star — one governed pressure substrate

> **Context is disposable. Memory is governed. Evidence is exact. Authority is external.**

This document states where Context Core is going and why the borders are
drawn where they are. It is a direction statement, not a feature list: every
lane below is judged by whether it moves the substrate toward this shape
without ever widening its authority.

## The one-sentence north star

**One governed pressure substrate, beneath every ToadAid agent, with
proof-carrying receipts on every model-bound byte, restart-safe sessions, and
memory that stays external forever.**

## The pillars

### 1. One substrate, every agent

There is exactly one context layer, and every agent consumes the same one:
Trading Desk, Mirror, Living Agent, Frog-to-Toad, and whatever comes next.
The layer is provider-neutral (it never calls a model SDK) and host-neutral
(it never touches tools, permissions, wallets, trades, git, or the network).
What changes per agent is a thin P5 adapter — what changes per provider is
nothing, because provider message formatting stays outside Context Core.

The alternative — every agent growing its own truncation, summarization, and
compaction heuristics — is how context management quietly forks into N
half-audited authorities. One substrate, audited once, consumed everywhere.

### 2. Receipts on every model-bound byte

Every byte that crosses into model context can be accounted for in exact
UTF-8 bytes, digest-bound, with no counterfactuals:

- `contextBytes` re-measured from the exact model-bound text, not estimated;
- `bytesAvoided = rawBytes - contextBytes`, an identity, not a claim;
- inline ingress has `bytesAvoided == 0` by law — if nothing was diverted,
  nothing was saved, and the honest number is zero;
- `receiptDigest` binds the whole receipt; `sourceContentDigest` binds the
  raw truth separately from the model-bound payload.

There is no `tokensSaved`, no cost estimate, no hardcoded savings percentage.
Telemetry reports observed facts. A savings report that cannot survive an
audit is not savings, it is marketing.

### 3. Restart-safe sessions

A long-running agent's session state survives the process that created it:

- a durable session event journal, keyed by session, replayed on boot;
- a bounded deterministic `ResumePacket` that carries exactly the head the
  host needs (session head + omission manifests), not a re-rendered guess;
- a one-shot continuity handoff that hosts inject after restart, sized by
  budget, never persisted by the consumer as new state.

Downtime must not cost the agent its working context, and recovery must not
cost the model its budget.

### 4. Memory stays external — forever

`DURABLE_MEMORY_REFERENCE` is a pointer to a governed memory system, not a
storage class of this substrate. Durable memory is never lexically indexed;
retrieval never substitutes for governed memory; principal truth is never
created here. The P3 governed-memory bridge (read-only, provenance-bound)
lands **last**, deliberately, because its law is the guardrail the whole
substrate leans on.

### 5. Zero execution authority

Classify, store, reduce, retrieve, packetize, measure — nothing else. No
trades, no wallets, no approvals, no network, no scheduling, no identity.
Every capability the core declares says so machine-readably. A context
optimizer that acquires side effects is an execution system wearing a
context layer's clothes; this substrate never becomes that.

## The first proven consumer

The numbers below come from the Trading Desk's production run (alpha,
single-principal desk, receipts from ~3 days of live lanes, September 2026):

- **Vendor pin + provenance ritual**: the desk consumes the package as a
  pinned tarball with a `PROVENANCE.txt` (source commit, tree hash, artifact
  SHA-256, `authority_change: NONE`) on every refresh. A substrate meant to
  be trusted under other components must be able to prove what it is.
- **Flag-gated rollout**: everything defaults off; the routing flag was
  flipped only after the byte-identical lane was proven with the flag off.
- **Live ingress receipts**: 504 receipts — 475 inline (which avoid exactly
  nothing, by law) and 29 deferred; 6.45 MB raw → 6.16 MB model-bound;
  **289,703 bytes avoided, measured**. The numbers are small because most
  tool results are small. That is the honest shape of early savings, and the
  receipts say so rather than inflating.
- **Restart safety live**: one-shot bounded handoffs (~3.5 KB) injected on
  every restart; deterministic autocompact boundaries instead of count-only
  heuristics.
- **The pressure lesson**: the desk's recall db grew to 109 MB in ~3 days of
  which **548 KB was continuity content** — the per-term recall index cost
  ~180× the material it indexed (long composite source keys, no pruning API,
  FTS entries that do not cascade). The desk shipped a keep-floor
  evict-oldest sweeper in its own retention lane (109 → 35 MB, recall
  verified after the sweep). The substrate-side takeaways are recorded:
  retention primitives, shorter source keys, and FTS cascade hygiene are
  candidate future substrate work — desk-side maintenance must never become
  a requirement to use the substrate safely.

## What this lane is not

- Not a memory system. `DURABLE_MEMORY_REFERENCE` points out; nothing here
  creates principal truth.
- Not a tokenizer, cost model, or savings estimator.
- Not an execution system. Zero authority is not a phase; it is the border.
- Not a provider. Message formatting and API clients live in the host.

## Roadmap position

- **Next: P4 — MCP/provider adapters.** The multiplier: one served substrate
  behind MCP means every adapter-built host (Mirror, Living Agent,
  Frog-to-Toad, future agents) inherits classification, diversion,
  receipts, and restart-safe sessions without code changes.
- **Then: P3 — governed-memory bridge, last.** Read-only, provenance-bound,
  temporal/as-of-bound. Its law is the guardrail: retrieval never replaces
  governed memory.
- **Project adapters (P5)** stay thin on purpose: the substrate must never
  grow an opinion about any single agent's business logic.
