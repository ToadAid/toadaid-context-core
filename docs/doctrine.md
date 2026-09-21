# Context Core Doctrine v0.1

## Core law

**Context is disposable. Memory is governed. Evidence is exact. Authority is external.**

## Invariants

### C1 — Exact evidence is lossless

An item classified `EXACT_EVIDENCE` must reach a context packet byte-for-byte unchanged.

If the configured packet budget cannot carry the exact evidence, packet construction must fail closed. It must never silently truncate, summarize, hash-only, or replace the evidence.

### C2 — Bulk is not context by default

Large logs, tool outputs, diffs, and structured payloads are stored outside the model-facing packet. The model receives a deterministic bounded reduction plus a content-addressed raw reference.

### C3 — Storage is not memory authority

Context Core may store raw working/bulk material for retrieval, but this does not make that material durable agent memory.

`DURABLE_MEMORY_REFERENCE` points to an external governed memory system. Context Core does not create principal truth, change provenance, or rewrite the referenced memory.

### C4 — Context Core has zero execution authority

Context Core may classify, store, reduce, retrieve, and packetize information.

It cannot:
- execute trades,
- sign transactions,
- merge code,
- grant capabilities,
- mutate wallets,
- mint/deploy,
- create principal declarations,
- decide constitutional authority.

### C5 — Deterministic processing before model summarization

Where structure can be derived deterministically, do so without an LLM.

P1 performs no LLM calls at all.

### C6 — Classification is explicit when stakes are high

Callers may provide an explicit classification. Strong structured metadata may classify exact evidence. Mere appearance of a hash-like string inside a large log does not promote the entire log to exact evidence.

This avoids a large tool response becoming uncompressible simply because it contains a SHA or transaction hash.
