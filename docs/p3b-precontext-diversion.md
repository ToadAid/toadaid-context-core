# P3B-P1 — Pre-context diversion

## Purpose

Prevent oversized bulk or retrievable information from entering model context
when exact raw bytes can instead remain searchable in Context Core and be
retrieved on demand.

This is a clean-room ToadAid capability. No third-party source code is copied.

## Public API

`prepareContextIngress(...)`

The caller supplies already-produced content plus a lexical `addSource` seam.
Context Core does not execute the tool that produced the content.

## Routing law

- payloads within `maxInlineBytes` remain byte-identical inline;
- `EXACT_EVIDENCE` always remains byte-identical inline;
- `DURABLE_MEMORY_REFERENCE` stays inline and is never copied into retrieval as
  a substitute governed-memory layer;
- oversized `WORKING_CONTEXT`, `BULK_MATERIAL`, and
  `RETRIEVABLE_KNOWLEDGE` may be persisted to lexical retrieval;
- the replacement is bounded JSON carrying source identity, classification,
  content digest, raw byte size, and an exact-prefix preview;
- diversion is skipped if the replacement would not reduce UTF-8 bytes.

## Metrics

Only directly measured UTF-8 bytes are reported: `rawBytes`, `contextBytes`,
and `bytesAvoided`. No token-savings claim is made.

## Authority boundary

No model call, arbitrary code/shell execution, network access, wallet/trade
access, git write, approval authority, or durable governed-memory write is
added.
