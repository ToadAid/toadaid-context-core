# P3B-P2 — Structure-aware chunking

## Purpose

Improve lexical retrieval for Markdown-like material without changing the exact
raw bytes stored by Context Core.

This is a clean-room ToadAid capability. The design takes the general idea that
document structure can improve chunk quality and retrieval ranking; no
third-party source code is copied.

## Chunk modes

Lexical sources accept:

- `chunkMode: "plain"` — existing deterministic line/byte chunking;
- `chunkMode: "markdown"` — heading-aware, fenced-code-aware chunking.

The default remains `"plain"` for compatibility.

## Markdown laws

- ATX headings (`#` through `######`) outside fenced code begin a new chunk
  boundary;
- fenced blocks are isolated from surrounding prose for lexical structure;
- a fenced block using backticks or tildes stays atomic when the entire block
  fits within `maxChunkBytes`;
- if one fenced block itself exceeds the hard byte cap, the byte cap wins and
  the block is deterministically split, but every continuation retains
  `structure_kind = "fence"` so code lines cannot gain heading weight;
- concatenating chunk `content` always reconstructs the source exactly;
- every emitted chunk obeys the hard byte cap.

## Search weighting

Raw chunk content is never rewritten or duplicated.

For `chunkMode: "markdown"`, heading tokens are duplicated only in the derived
lexical token projection used for BM25 scoring. The deterministic heading
weight is 3x total term frequency.

Persistent storage records `chunk_mode` and `structure_kind`. Both structural
labels are covered by deterministic integrity commitments before they may affect
lexical projection or BM25 ranking. Integrity checks then recompute the same
weighted lexical projection from exact raw chunk bytes plus those verified
labels. A source ID cannot be reused with a different chunk mode.

Legacy pre-P3B-P2 stores may be upgraded only through the canonical
`plain` / `text` defaults. A structured row lacking a structural integrity
commitment fails closed rather than being silently blessed during migration.

## P3B-P1 ingress integration

`prepareContextIngress(...)` accepts optional `chunkMode`, so oversized
Markdown-like material can be diverted before model context while still
receiving structure-aware indexing.

## Authority boundary

P3B-P2 adds no model call, shell/code execution, network access, wallet/trade
authority, git write, approval authority, or governed durable-memory write.
