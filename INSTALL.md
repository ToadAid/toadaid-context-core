# Installing ToadAid Context Core

ToadAid Context Core is currently an **alpha source package**. The repository may be public before the npm package is published.

For now, install it from a reviewed source checkout or a reviewed local artifact.

> **Context is disposable. Memory is governed. Evidence is exact. Authority is external.**

## Requirements

- Node.js 20 or newer
- Git
- An agent host that owns its own model/provider calls, tools, permissions, durable memory, and side effects

Context Core itself does not call models or execute tools.

## Option A — Local checkout

Clone the repository:

```bash
git clone https://github.com/ToadAid/toadaid-context-core.git
cd toadaid-context-core
npm test
```

Then reference it from your agent host.

Example host `package.json`:

```json
{
  "dependencies": {
    "@toadaid/context-core": "file:../toadaid-context-core"
  }
}
```

From the host repository:

```bash
npm install
```

## Option B — Install from a reviewed local path

If Context Core already exists elsewhere on the machine:

```bash
npm install /absolute/path/to/toadaid-context-core
```

For reproducible production or governed builds, prefer pinning a reviewed commit or vendored artifact rather than silently following a moving working tree.

## Verify the install

From the host repository:

```bash
node --input-type=module <<'NODE'
import {
  contextCoreCapabilities,
  prepareToolOutputIngress,
} from "@toadaid/context-core";

console.log(contextCoreCapabilities());
console.log(typeof prepareToolOutputIngress);
NODE
```

Expected properties:

```text
prepareToolOutputIngress -> function

modelCalls              false
arbitraryCodeExecution  false
shellExecution          false
networkAccess           false
authorityGrants         false
durableMemoryWrites     false
walletAccess            false
tradeExecution          false
gitWrite                false
```

## Minimal tool-output wiring

The host executes the tool first. Context Core only receives the already-produced textual model view.

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

messages.push({
  role: "tool",
  content: routed.modelText,
});

// Keep trusted structured host data on the host rail.
consumeTrustedHostData(hostResult.data);
```

For tool-result text that your host policy requires to remain byte-identical:

```js
const routed = prepareToolOutputIngress({
  retrieval,
  toolName: call.name,
  toolCallId: `${sessionId}:${runId}:${call.id}`,
  content: hostResult.text,
  classification: ContextClass.EXACT_EVIDENCE,
});
```

Context Core does not decide whether a write, trade, shell command, wallet action, permission, or other side effect is allowed. That authority stays with the host.

## Agent-assisted installation

Yes — you can hand the following prompt to a coding agent and let it perform the integration.

The agent should still show you the resulting diff and tests before you merge it.

### Copy/paste installation prompt

```text
Install ToadAid Context Core into this agent host.

Source:
https://github.com/ToadAid/toadaid-context-core

Important architectural law:
- Context Core has ZERO execution authority.
- The host continues to own models, tools, permissions, durable-memory writes, network access, shell execution, wallets, trades, git writes, and all other side effects.
- Context Core only receives already-produced textual context/tool output.
- Trusted structured tool data must remain host-owned and must not be silently stringified into model context.
- Exact evidence that host policy requires byte-identical must be explicitly classified as EXACT_EVIDENCE.
- Do not create a second context-routing system if an existing model/tool ingress seam already exists.

Tasks:
1. Inspect this host repository and identify the real model-context ingress and tool-result ingress seams.
2. Add @toadaid/context-core as a local/file dependency from a reviewed checkout or reviewed vendored artifact. Do not publish or fetch an unreviewed package.
3. Wire already-produced textual tool output through prepareToolOutputIngress(...) before model/provider ingress.
4. Preserve the host's original structured result.data (or equivalent) separately and unchanged.
5. Use a host-scoped stable toolCallId that prevents unrelated sessions/runs from accidentally sharing one identity.
6. Keep write/trade/authority-sensitive result text EXACT_EVIDENCE when host policy requires byte identity.
7. Verify the returned Context Core ingress receipt before consuming modelText.
8. Preserve any existing safe fallback behavior unless removing it is explicitly part of this task.
9. Do not give Context Core any model, network, shell, wallet, trade, git-write, durable-memory-write, or permission-grant capability.
10. Add focused tests proving:
   - oversized readonly output can become a bounded CONTEXT_REFERENCE;
   - omitted detail remains retrievable;
   - EXACT_EVIDENCE remains byte-identical inline;
   - structured host data remains separate;
   - Context Core authority capabilities remain false.
11. Run the host's relevant focused tests, typecheck if applicable, and full test suite.
12. Report the exact changed paths, test results, and any unresolved integration risks.
13. Do not commit, push, open a PR, merge, restart services, or change repository visibility unless I explicitly authorize that ceremony.
```

## Runnable Context Core example

Inside the Context Core repository:

```bash
node examples/tool-output-ingress.mjs
```

This demonstrates the provider-neutral boundary without making a model call or network request.

## Continuity integration

Tool-output routing is only one surface. Context Core also exposes persistent retrieval, session journals, resume packets, omission recovery, continuity handoffs, bounded transport, and proof-carrying telemetry.

Start with the tool-output integration above, then adopt continuity surfaces deliberately according to your host architecture. Do not treat retrieved or resumed context as authority.

## Updating

Before updating a host to a newer Context Core revision:

1. review the Context Core commit or artifact;
2. run the Context Core test suite;
3. update the host dependency binding;
4. run the host's focused integration tests;
5. run the host's full relevant suite;
6. verify the zero-authority boundary still holds.

Do not silently track a moving branch in a governed production integration.

## Uninstalling

Remove the dependency from the host package manifest, reinstall dependencies, and remove the host adapter/wiring that called Context Core.

Context Core does not own the host's durable memory or execution authority, so uninstalling it should not require transferring those authorities elsewhere.
