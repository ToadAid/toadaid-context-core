# P3B-P6-P2 — Snapshot-bound omission recovery

P6-P2 replaces anonymous-only omission truth with deterministic recovery
identities.

The existing numeric `omitted` counters remain as compact compatibility
summaries. They are no longer the only source of omission truth.

P6-P2 does not implement the transport-final serialized artifact. That remains
P6-P3.

## Journal snapshot binding

Every ResumePacket omission manifest carries one verified journal snapshot:

- `sessionId`
- `lastSequence`
- `lastDigest`

Every omitted event body carries an exact journal event reference:

- `eventId`
- `sequence`
- `eventDigest`
- `kind`

Every omitted exact-evidence item carries:

- `eventId`
- `sequence`
- `eventDigest`
- `label`

The event digest binds the complete stored event, including the exact-evidence
value. The evidence label identifies the exact item inside that event.

## Read-only recovery

`PersistentSessionJournal.resolveEventReference(snapshot, reference)`:

1. verifies the current session chain;
2. verifies that the declared historical snapshot head still exists with the
   declared digest;
3. verifies the referenced event identity and digest;
4. returns the exact stored event.

A later append does not invalidate an older verified snapshot reference because
the journal is append-only. Rebinding the snapshot digest, event ID, sequence,
or event digest fails closed.

Reference resolution is read-only. It grants no model, shell, network, memory,
wallet, trade, Git, or other execution authority.

## Pressure law

The omission manifest is present before optional event bodies are admitted.

This means recovery truth receives budget before optional inline history.

When an optional event body is successfully admitted, its event omission
reference is removed. When that admission also carries exact evidence, the
corresponding exact-evidence omission identities are removed as well.

If the packet cannot fit its mandatory anchors, active mandatory evidence, and
omission recovery truth, packet construction fails closed. P6-P2 does not fall
back to anonymous omission counts.

## Retrieval-query omissions

Continuity handoffs preserve the existing numeric
`omittedRetrievalQueries` summary and add exact
`omittedRetrievalQueryItems`.

Each query identity carries:

- its original zero-based request index;
- its exact query string.

The index makes duplicate query strings distinguishable.

Successful retrieval admission removes that exact query identity. A query that
does not fit remains explicit. If the handoff cannot fit the ResumePacket plus
the query omission identities, construction fails closed.

## Deferred boundary

P6-P3 still owns:

- the final compact transport artifact;
- one authoritative total UTF-8 byte ceiling;
- final drop order across optional retrieval and recoverable history;
- final serialized-byte equality proof.
