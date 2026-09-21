# P3B-P6-P3 — Transport-final serialized boundary

P6-P3 makes the final continuity transport string the authoritative model-bound
artifact.

`buildContinuityHandoff()` remains the structured compatibility surface.
`buildContinuityTransport()` is the transport-final boundary.

## Authoritative byte law

The transport returns:

- `serialized`: the exact JSON string intended to cross the host/model boundary;
- `usedBytes`: `Buffer.byteLength(serialized, "utf8")`;
- `budgetBytes`: the authoritative total transport ceiling.

The invariant is:

`usedBytes == UTF8_BYTES(serialized) <= budgetBytes`

The wrapper metadata is not recursively embedded inside `serialized`. The
serialized string is the artifact being measured.

No character-count or bytes/4 proxy is used.

## Deterministic pressure order

The transport construction order is:

1. preserve the ResumePacket mandatory state, active mandatory exact evidence,
   and P6-P2 omission-recovery manifest;
2. if the outer handoff cannot fit, rebuild the ResumePacket under a smaller
   truthful byte budget so recoverable inline history is omitted rather than
   recovery truth;
3. only after the mandatory baseline fits, attempt optional retrieval
   admission;
4. retrievals that do not fit remain explicit query omissions;
5. fail closed if mandatory state/evidence plus recovery truth cannot fit.

This means optional retrieval is the first material not admitted under total
handoff pressure. Recoverable historical inline material is the next reduction
surface. Recovery identities are never sacrificed to make optional payload fit.

## Determinism

There is no hidden timestamp or clock input in transport construction.

Given the same verified journal snapshot, retrieval state, queries, and options,
the exact serialized bytes are restart deterministic.

## UTF-8 truth

The ceiling is measured with Node `Buffer.byteLength(..., "utf8")`.

Multibyte CJK and emoji content therefore consumes its real UTF-8 byte count and
cannot bypass the ceiling through JavaScript string-length accounting.

## Authority boundary

P6-P3 adds serialization and budgeting only.

It adds no:

- model call;
- arbitrary code execution;
- shell execution;
- network access;
- authority grant;
- durable-memory write;
- wallet access;
- trade execution;
- Git-write authority.

P3C still owns the first real ToadAid tool-output routing integration.
