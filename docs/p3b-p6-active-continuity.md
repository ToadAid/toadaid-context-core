# P3B-P6-P1 — Active continuity projection

P6-P1 makes active continuity truth independent of section caps.

It does not yet implement omission recovery or the final transport serializer.
Those remain P6-P2 and P6-P3.

## Active lifecycle projection

`ERROR`, `TASK`, and `CONSTRAINT` events use the same deterministic lifecycle
shape:

- `data.lifecycleKey` is the stable logical identity;
- if no lifecycle key exists, `eventId` remains the identity;
- the latest event for each lifecycle key defines current state;
- unknown or absent statuses remain active rather than silently closing state.

Closed status sets are:

- errors: `resolved`, `closed`;
- tasks: `done`, `completed`, `closed`, `cancelled`;
- constraints: `resolved`, `closed`, `superseded`, `cancelled`.

A newer open constraint with the same lifecycle key replaces the older value.
A newer closed/superseded constraint removes that logical constraint from the
active projection.

`maxOpenErrors`, `maxOpenTasks`, and `maxConstraints` limit inline event bodies.
They do not define which logical events are active.

## Active mandatory exact evidence

Before capped ERROR/TASK/CONSTRAINT bodies are admitted, Context Core collects
exact evidence from the complete active lifecycle projection.

Therefore a section cap cannot make active mandatory evidence disappear.

The latest objective and git state remain mandatory scalar anchors and continue
to admit their exact evidence through the existing fail-closed scalar path.

If the packet cannot fit active mandatory exact evidence, construction fails
closed even when the owning ordinary event body would otherwise be omitted by a
section cap or byte pressure.

## Global evidence census

`omitted.exactEvidence` begins from exact evidence attached to every event in the
verified journal snapshot, including evidence attached to:

- decisions;
- file reads;
- file edits;
- external references;
- closed/historical lifecycle events.

P6-P1 does not claim those historical omissions are recoverable. It only makes
the omission truth complete.

P6-P2 must replace historical omission-only truth with exact snapshot-bound
journal references before recoverability may be claimed.

## Determinism and authority

The projection is derived entirely from the verified journal snapshot using
stable lifecycle keys, importance, sequence, and event ID ordering.

No clock, model call, network call, shell execution, durable-memory write,
wallet access, trade execution, git mutation, or authority grant is added.
