# P3B-P4 — Proof-carrying context telemetry

## Doctrine

Telemetry reports observed facts. It does not invent counterfactuals.

The first cut, P3B-P4-P1, adds a deterministic ingress receipt over the existing `prepareContextIngress(...)` result.

## P3B-P4-P1 guarantees

For every receipt:

- `contextBytes` is re-measured from the exact `contextText` that is bound for model context.
- `contextDigest` binds those exact model-bound bytes.
- `sourceContentDigest` separately binds the raw source truth.
- `bytesAvoided` must equal `rawBytes - contextBytes`.
- Inline ingress must have `rawBytes == contextBytes` and `bytesAvoided == 0`.
- Deferred ingress must carry a retrieval `sourceRef`.
- The deferred source's chunk byte total must equal `rawBytes`.
- The deferred context reference must agree with the source ID, classification, raw byte count, and source content digest.
- The receipt binds the source content digest, exact model-payload digest, chunk count, ordered chunk IDs, chunk indices, chunk digests, and chunk byte sizes through explicit fields plus `sourceRefDigest`.
- `receiptDigest` binds the complete receipt payload.
- Caller-supplied `eventId` and `observedAt` are optional. Context Core does not silently consult a clock.
- There is no `tokensSaved`, token estimate, cost estimate, or hardcoded savings percentage.

The digest model matches the existing Context Core integrity model: it detects drift/corruption and binds derived state to exact source state. It is not a keyed authenticity signature.

## Explicit non-goals for P3B-P4-P1

This cut does not yet:

- debit bytes retrieved later;
- aggregate session/project/global savings;
- report net savings;
- estimate tokens;
- call a tokenizer;
- alter retrieval ranking;
- alter ingress classification;
- grant any execution authority.

Those belong to later P3B-P4 subcuts.

## Authority boundary

P3B-P4-P1 does not add model calls, arbitrary code execution, shell execution, network access, durable memory writes, wallet access, trade execution, git writes, or authority grants.


## P3B-P4-P2 — Retrieval debit receipt

A retrieval debit receipt measures the exact serialized response bytes that
would be returned to the caller:

`returnedBytes = UTF8(JSON.stringify(response))`

The response's stabilized `usedBytes` must equal that independent
re-measurement.

The receipt binds:

- the exact query and `queryDigest`;
- `match` and resolved recall mode (`exact` or `tiered`);
- total/omitted/result counts;
- the complete serialized response through `responseDigest`;
- ordered returned-result provenance through `resultSetDigest`;
- source ID, chunk ID, chunk index, classification, metadata digest, score,
  and `matchKind` where present;
- the byte length and digest of every returned chunk content.

For every returned chunk, Context Core recomputes:

`SHA256(sourceId + "\0" + chunkIndex + "\0" + content)`

and requires both `contentDigest` and `chunkId` to agree.

A zero-result retrieval is still a real debit when its response envelope is
returned. It therefore has `resultCount = 0` but `returnedBytes > 0`.

This cut does not claim that a retrieval response was injected into any
particular model call. It proves the concrete response supplied to the receipt
builder and its exact serialized debit. Session/net accounting belongs to
P3B-P4-P3.

P3B-P4-P2 still emits no token estimate, cost estimate, savings percentage, or
net-savings claim and adds no execution authority.


## P3B-P4-P3 — Net-savings ledger

P3B-P4-P3 composes P4-P1 ingress receipts and P4-P2 retrieval-debit receipts
without adding model, network, shell, storage, wallet, trade, or git authority.

A session ledger uses:

`grossBytesAvoided = sum(DEFERRED ingressReceipt.bytesAvoided)`

Inline ingress contributes exactly zero credit:

`NO DIVERSION = NO SAVINGS CREDIT`

Retrieval is always a debit:

`retrievalBytes = sum(retrievalReceipt.returnedBytes)`

The ledger never represents a negative number as savings:

`netBytesAvoided = max(grossBytesAvoided - retrievalBytes, 0)`

`netBytesAdded = max(retrievalBytes - grossBytesAvoided, 0)`

Only one of `netBytesAvoided` or `netBytesAdded` may be positive.

Every consumed receipt must have internally consistent byte arithmetic and a
valid self-bound receipt digest. Duplicate ingress or retrieval receipt digests
fail closed so the same proof cannot be counted twice inside one session ledger.

Aggregation is explicit and hierarchical:

`SESSION -> PROJECT -> GLOBAL`

Project ledgers accept only session children. Global ledgers accept only project
children. Duplicate child-ledger digests fail closed. Aggregate ledgers also
carry the transitive ingress/retrieval receipt-digest provenance of their
children. Any repeated leaf receipt digest across sibling sessions or projects
fails closed, even when the child ledger digests differ because their scope IDs
differ. Aggregate gross and debit totals are recomputed from child gross/debit
totals; child net labels are not summed or trusted as the aggregate result.

The ledger digest binds its scope, counts, gross/debit/net totals, and the exact
ordered digest sets it consumed. This is integrity binding, not a signature or
external authenticity claim.

P3B-P4-P3 still emits no token estimate, cost estimate, or savings percentage.


## P3B-P4-P4 — Honest reporting surface

P3B-P4-P4 exposes a compact evidence-bound byte report without inventing a
token, percentage, cost, or model-input-savings story.

`buildContextSavingsReport(...)` accepts a verified P4-P3 ledger plus the exact
ingress and retrieval-debit receipts whose ordered digests the ledger carries.
This is true for every supported scope:

- `SESSION`: provide that session's receipts.
- `PROJECT`: provide the transitive leaf receipts carried by the project ledger.
- `GLOBAL`: provide the transitive leaf receipts carried by the global ledger.

A report cannot exist if the supplied receipt-digest sequence differs from the
ledger, including missing or reordered receipts.

The report re-derives these exact UTF-8 byte fields:

- `observedRawBytes`: sum of the bound ingress receipt `rawBytes`.
- `ingressContextBytes`: sum of the bound ingress receipt `contextBytes`.
- `retrievalBytes`: sum of bound retrieval receipt `returnedBytes`.
- `grossBytesAvoided`: `observedRawBytes - ingressContextBytes`.
- `netBytesAvoided`: `max(grossBytesAvoided - retrievalBytes, 0)`.
- `netBytesAdded`: `max(retrievalBytes - grossBytesAvoided, 0)`.

The derived gross, debit, and net values must match the P4-P3 ledger exactly.

Metric semantics are explicit in every report:

- `unit = UTF8_BYTES`
- `ingressBasis = PROOF_CARRYING_INGRESS_RECEIPTS`
- `retrievalBasis = SERIALIZED_RESPONSE_RETURNED_TO_CALLER`
- `netBasis = GROSS_DIVERSION_MINUS_RETRIEVAL_RESPONSE_DEBIT`
- `claimBoundary = BYTE_ACCOUNTING_ONLY`

`retrievalBytes` therefore means exactly what P4-P2 proved: bytes in the
serialized retrieval response returned to the caller. It does **not** prove
that those bytes were inserted into a particular model invocation.

This provider-neutral Context Core cut does not have a named tokenizer
measurement adapter, so it emits no token fields at all. It also emits no
savings percentage, bytes/4 token approximation, cost estimate, or cost-savings
claim.

`reportDigest` integrity-binds the report scope, metric semantics, byte totals,
P4-P3 `ledgerDigest`, leaf receipt digests, and child-ledger digests. As with
the prior telemetry digests, this is deterministic integrity binding, not a
signature or external signer-authenticity claim.

`verifyContextSavingsReport(...)` first requires the exact canonical report
field set, so unknown, missing, or unbound fields fail closed. This prevents a
caller from appending an unsigned token, percentage, cost, model-input, or other
claim to an otherwise valid report while retaining verification success. It
then checks the report's internal arithmetic and self-bound digest. Construction
with `buildContextSavingsReport(...)` is the operation that additionally
cross-checks the report against the supplied ledger and proof-carrying receipts.
