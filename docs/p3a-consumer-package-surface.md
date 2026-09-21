# P3A-P1 — Consumer Package Surface

P3A-P1 makes Context Core consumable by real ToadAid agents without copying
implementation files or importing repository-relative internals.

The canonical consumer import is:

```js
import {
  ContextEventKind,
  PersistentSessionJournal,
  PersistentLexicalIndex,
  buildContinuityHandoff,
} from "@toadaid/context-core";
```

## Package boundary

`package.json` now declares:

- `main` → `src/index.mjs`
- `types` → `src/index.d.ts`
- package-root `exports` with separate runtime and type entrypoints

The package remains private. This cut does not publish it and does not change
Context Core authority.

## Consumer contract

The initial declaration surface gives strict TypeScript consumers stable types
for the P2 continuity spine:

- `ContextEventKind`
- `PersistentSessionJournal`
- `PersistentLexicalIndex`
- `buildResumePacket`
- `buildContinuityHandoff`

Older P1/P2A exports remain runtime-public; declarations for those exports stay
conservative until a real consumer requires stronger structural types.

## Real self-consumption proof

The package tests import Context Core by its own package name, not by a
repository-relative source path.

The proof then opens the durable stores, writes a Trading Desk-shaped objective,
closes both stores, reopens them, constructs a bounded `ContinuityHandoff`, and
verifies the objective plus retrieved detail survive the restart.

## Authority boundary

P3A-P1 adds no model call, shell execution, git mutation, wallet/trading
authority, durable-memory write authority, or provider identity.

It is packaging only.

## Next consumer

Trading Desk is the first intended real consumer.

Its current loop already has one injected autocompact seam:

```text
runAgentTurns
    |
    v
deps.autocompact(...)
    |
    v
append new principal turn
```

The next cut wires a Trading Desk adapter to `@toadaid/context-core` at that
loop boundary behind an explicit feature flag, preserving the existing fallback
until the integration proof is complete.
