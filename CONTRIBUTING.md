# Contributing to ToadAid Context Core

Thanks for helping improve ToadAid Context Core.

The project has one architectural rule that should remain obvious in every contribution:

> **Context is disposable. Memory is governed. Evidence is exact. Authority is external.**

## Before you change code

Please understand the host/core boundary:

- Context Core may classify, bound, index, retrieve, serialize, and measure already-produced context.
- Exact evidence must remain exact.
- Durable memory authority remains external.
- Models, tools, permissions, network access, wallets, trades, git writes, and other side effects remain host-owned.
- Provider-specific message formatting belongs in host adapters, not the core.

A change that weakens those boundaries needs explicit design discussion before implementation.

## Development

Requirements:

- Node.js 20 or newer.
- No runtime npm dependencies are currently required.

Run the complete suite:

```bash
npm test
```

Run the packet demo:

```bash
node bin/demo.mjs
```

Run the provider-neutral tool-output example:

```bash
node examples/tool-output-ingress.mjs
```

## Pull requests

Keep pull requests narrow and explain:

- what behavior changes;
- what remains intentionally unchanged;
- which authority boundary is relevant;
- how exact evidence and provenance are preserved;
- which tests prove the change;
- whether public API or serialized output changes.

Add or update deterministic tests for behavior changes. Avoid hidden clocks, model calls, network calls, or external services in core tests unless a future module explicitly defines that boundary.

## Retrieval and telemetry changes

For retrieval changes, preserve documented admission rules, metadata isolation, byte budgets, deterministic ranking semantics, and integrity failure behavior unless the pull request explicitly changes the public contract.

For telemetry changes, measure concrete bytes and receipts. Do not introduce token, cost, or savings claims that are not grounded in a named measurement adapter.

## Documentation

Update README/API documentation when public behavior changes. Examples should be runnable and should not imply authority that Context Core does not possess.

## Reporting security issues

Do not open a public issue containing exploit details. Follow [SECURITY.md](SECURITY.md).
