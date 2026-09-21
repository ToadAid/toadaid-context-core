# 🐸 ToadAid Context Core

**Provider-neutral context infrastructure for agents.**

> **Context is disposable. Memory is governed. Evidence is exact. Authority is external.**

ToadAid Context Core helps long-running agents keep model-facing context bounded without turning context management into an execution authority.

It sits between an **agent host** and the text that host sends to a model. The host still owns tools, permissions, durable memory, wallets, trades, git, network access, and every other side effect.

Context Core owns a narrower job:

- classify context before model ingress;
- keep exact evidence exact;
- divert large retrievable material out of the immediate prompt when doing so is actually byte-beneficial;
- preserve omitted detail in integrity-bound retrieval;
- build bounded continuity handoffs;
- measure context savings in exact UTF-8 bytes;
- return proof-carrying receipts;
- never acquire execution authority in the process.

## Status

Context Core is currently **alpha**. The APIs are real and exercised by ToadAid agents, but they may still evolve before a stable public release.

The package is provider-neutral by design. It does not call a model SDK. A host can place it beneath OpenAI/Codex, Anthropic/Claude, Gemini, GLM, Kimi, local runtimes, or another provider as long as the host can decide what textual context is sent to that model.

Provider-specific message formatting remains outside Context Core.

## Why it exists

Agent context pressure creates a bad tradeoff if handled carelessly:

- keep everything inline and the model context becomes noisy and expensive;
- truncate aggressively and important evidence disappears;
- summarize authority-sensitive material and exact truth can be altered;
- give the context layer tool authority and a memory optimization component quietly becomes an execution system.

ToadAid Context Core takes a different path.

```text
                         HOST AUTHORITY
              tools / policy / memory / wallets / git
                              │
                    already-produced result
                              │
              ┌───────────────┴────────────────┐
              │                                │
        textual model view              structured host data
              │                                │
              ▼                                └────► stays with host
      ToadAid Context Core
              │
       classify + measure
              │
        ┌─────┴─────┐
        │           │
      INLINE     DEFERRED
        │           │
        │        bounded reference
        │           │
        └─────┬─────┘
              ▼
        model-facing context

   omitted detail ─────► integrity-bound retrieval
```

The core can decide **what representation of already-produced text belongs in model context**. It cannot decide whether a tool may run in the first place.

## The five context classes

| Class | Meaning |
| --- | --- |
| `EXACT_EVIDENCE` | SHAs, receipts, transaction hashes, approval/authority records, constitutional bindings, or other bytes that must remain exact. |
| `WORKING_CONTEXT` | Current objective, files, errors, tasks, and active working state. |
| `BULK_MATERIAL` | Large logs, diffs, tool output, web/MCP responses, and other high-volume material. |
| `RETRIEVABLE_KNOWLEDGE` | Material intended to live outside immediate context and be recovered through bounded retrieval. |
| `DURABLE_MEMORY_REFERENCE` | A reference into a separate governed memory system. Context Core does not become that memory authority. |

## What the core provides today

### Exact-evidence preservation

`EXACT_EVIDENCE` is never summarized or truncated by the ingress path. If exact bytes cannot fit an external model budget, the caller must handle that truth explicitly rather than silently mutating it.

### Deterministic context diversion

`prepareContextIngress(...)` decides whether text remains `INLINE` or becomes `DEFERRED`. Diversion receives savings credit only when the bounded model-facing reference is actually smaller than the source text.

### Real tool-output routing

`prepareToolOutputIngress(...)` is the provider-neutral host adapter for already-produced textual tool output.

It binds:

- tool name;
- host-supplied tool-call identity;
- exact textual output digest;
- canonical tool provenance metadata;
- selected model-facing text;
- measured raw/model bytes;
- a proof-carrying ingress receipt.

It **refuses non-string content**. Trusted structured tool data stays on the host rail instead of being silently stringified into model context.

### Persistent lexical retrieval

`PersistentLexicalIndex` provides bounded exact and tiered recall with:

```text
EXACT → IDENTIFIER → MORPHOLOGY → SUBSTRING
```

Candidate discovery is indexed and bounded. Public scoring behavior remains integrity-bound to canonical source/chunk truth.

### Continuity under pressure

`PersistentSessionJournal`, `buildResumePacket(...)`, `buildContinuityHandoff(...)`, and `buildContinuityTransport(...)` preserve active state, exact evidence, omission identities, and recoverability under a final serialized byte ceiling.

### Proof-carrying telemetry

Context Core measures **UTF-8 bytes**, not fictional token estimates.

Ingress receipts, retrieval-debit receipts, savings ledgers, and reports distinguish:

- raw bytes observed;
- bytes actually sent in the ingress representation;
- retrieval response bytes;
- gross bytes avoided;
- net bytes avoided;
- net bytes added.

No diversion means no savings credit.

### Retrieval Quality Lab

The deterministic quality harness measures source-level retrieval quality using Precision@k, Recall@k, MRR, nDCG@k, and false-positive rate while keeping efficiency metrics separate from retrieval-quality claims.

## Quick start

Requires **Node.js 20+**.

```bash
git clone https://github.com/ToadAid/toadaid-context-core.git
cd toadaid-context-core

npm test
node bin/demo.mjs
node examples/tool-output-ingress.mjs
```

The current core has no runtime npm dependencies, so a source checkout can run the test/demo surfaces directly.

## Minimal host integration

The host executes the tool. Context Core only receives the textual view **after** execution.

```js
import {
  ContextClass,
  PersistentLexicalIndex,
  prepareToolOutputIngress,
  verifyContextIngressReceipt,
} from "@toadaid/context-core";

const retrieval = new PersistentLexicalIndex({
  path: "./context-core.sqlite",
});

// Your host executes the tool. Context Core never does this.
const hostResult = await host.executeTool(call);

const routed = prepareToolOutputIngress({
  retrieval,
  toolName: call.name,
  toolCallId: `${sessionId}:${runId}:${call.id}`,
  content: hostResult.text,
  metadata: {
    sessionId,
    runId,
  },
});

verifyContextIngressReceipt(
  routed.ingress,
  routed.receipt,
);

// Only the selected textual view enters model context.
messages.push({
  role: "tool",
  content: routed.modelText,
});

// Structured data remains host-owned and separate.
consumeTrustedHostData(hostResult.data);
```

If a write/trade/authority-sensitive result must remain byte-identical, the **host** should say so explicitly:

```js
const routed = prepareToolOutputIngress({
  retrieval,
  toolName: call.name,
  toolCallId: `${sessionId}:${runId}:${call.id}`,
  content: hostResult.text,
  classification: ContextClass.EXACT_EVIDENCE,
});
```

That output remains inline and receives zero fictional savings credit.

## Recovering deferred detail

A deferred tool result returns a bounded `CONTEXT_REFERENCE`. The reference carries the stable `sourceId` plus the exact `contentDigest`; the omitted bytes stay in integrity-bound retrieval under canonical provenance metadata.

When the agent/runtime needs **that exact omitted source**, the host can explicitly resolve the reference:

```js
import {
  resolveContextReference,
} from "@toadaid/context-core";

const exact = resolveContextReference({
  retrieval,
  reference: routed.modelText,
});

// Host decides whether/how to re-inject exact.content.
// Context Core does not invoke a tool or push it into a model.
```

Resolution is read-only, digest-verified, restart-safe with `PersistentLexicalIndex`, and returns the exact original source bytes plus stored provenance metadata. A changed digest, classification, byte count, or missing source fails closed.

Resolution alone does **not** claim that recovered bytes re-entered model context. If the host actually returns those exact recovered bytes to the model, it can mint a proof-carrying debit at that boundary:

```js
import {
  buildContextReferenceRecoveryDebitReceipt,
  verifyContextReferenceRecoveryDebitReceipt,
} from "@toadaid/context-core";

const debit =
  buildContextReferenceRecoveryDebitReceipt(exact);

verifyContextReferenceRecoveryDebitReceipt(
  exact,
  debit,
);
```

That debit is accepted by the existing session savings ledger alongside semantic retrieval debits. This closes the accounting loop: diversion receives measured credit; later exact recovery receives measured payback. A host that only inspects recovered bytes and does not re-inject them should not mint the debit.

For bounded semantic recall across deferred material, use lexical retrieval:

```js
const recovered = retrieval.search(
  "the detail I need",
  {
    recall: "tiered",
    maxResults: 6,
    maxBytes: 4096,
    metadataEquals: {
      sessionId,
      sourceKind: "tool-result",
      toolName: call.name,
      toolCallId: `${sessionId}:${runId}:${call.id}`,
    },
  },
);
```

The runnable example in [`examples/tool-output-ingress.mjs`](examples/tool-output-ingress.mjs) demonstrates this complete boundary with no model or network call.

## Host/Core contract

A safe host integration follows these rules:

1. **Host executes.** Context Core never invokes the tool.
2. **Host separates text from trusted structured data.** Only the textual model view is routed.
3. **Host binds stable call identity.** Include enough host scope to prevent unrelated runs from reusing an identity accidentally.
4. **Host marks exact evidence explicitly when policy requires it.** Context Core preserves that classification; it does not invent execution policy.
5. **Core returns model text + receipt.** The host sends `modelText` to its model/provider surface.
6. **Deferred detail remains retrievable.** The host may request omitted material later under bounded retrieval.
7. **Receipts measure bytes, not authority.** Telemetry observes context behavior; it grants nothing.
8. **Side effects stay external.** Wallet, trade, shell, git, network, durable-memory, and permission decisions remain outside the core.

## Zero-authority boundary

`contextCoreCapabilities()` deliberately reports all of the following as `false`:

| Capability | Context Core |
| --- | :---: |
| Model calls | ❌ |
| Arbitrary code execution | ❌ |
| Shell execution | ❌ |
| Network access | ❌ |
| Authority grants | ❌ |
| Durable-memory writes | ❌ |
| Wallet access | ❌ |
| Trade execution | ❌ |
| Git writes | ❌ |

This boundary is part of the architecture, not a temporary limitation.

## Public API highlights

The package currently exposes the major surfaces below:

```text
prepareContextIngress
prepareToolOutputIngress
PersistentLexicalIndex
PersistentSessionJournal
buildResumePacket
buildContinuityHandoff
buildContinuityTransport
buildContextIngressReceipt
buildContextRetrievalDebitReceipt
buildContextSessionSavingsLedger
aggregateContextSavingsLedgers
buildContextSavingsReport
evaluateRetrievalQuality
contextCoreCapabilities
```

See [`src/index.d.ts`](src/index.d.ts) for the current typed contract.

## Using it before package publication

The repository is currently an alpha source package rather than a published npm release. Hosts can integrate it through a local/file dependency or a reviewed vendored artifact.

Example local dependency:

```json
{
  "dependencies": {
    "@toadaid/context-core": "file:../toadaid-context-core"
  }
}
```

ToadAid Trading Desk is the first live host adoption: its successful tool-result text passes through `prepareToolOutputIngress(...)` before provider and durable-thread ingress, while trusted structured tool data remains host-owned.

## Development

Run the complete suite:

```bash
npm test
```

Run the original packet demo:

```bash
node bin/demo.mjs
```

Run the provider-neutral tool-output example:

```bash
node examples/tool-output-ingress.mjs
```

The forward capability plan and closure evidence live in [`BUILD_LIST.md`](BUILD_LIST.md).

## Installation

See [INSTALL.md](INSTALL.md) for local/source installation, verification, host wiring, and a copy/paste prompt that can be handed to a coding agent to perform the integration.

## Security

Please report security issues through the private process in [SECURITY.md](SECURITY.md). Do not publish exploit details or credentials in public issues.

## Contributing

Contributions are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md).

Changes should preserve the core doctrine: exact evidence stays exact, governed memory remains external, and execution authority stays with the host.

## License

ToadAid Context Core is licensed under the [MIT License](LICENSE).

## Design law

Context Core is not the agent. It is not the model. It is not the wallet. It is not the execution engine. It is not the durable-memory authority.

It is the bounded, evidence-preserving context layer between those systems.

> **Bring your own agent. Bring your own model. Keep authority where it belongs.**
