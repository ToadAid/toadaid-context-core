import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ContextClass,
  ContextBudgetExceeded,
  ContentStore,
  ContextCore,
  buildContextPacket,
  classifyInput,
  contextCoreCapabilities,
} from "../src/index.mjs";

function sandbox() {
  const root = mkdtempSync(join(tmpdir(), "toadaid-context-p1-"));
  const store = new ContentStore(root);
  const core = new ContextCore({ store, bulkLimit: 900, workingLimit: 1000 });
  return { root, store, core };
}

test("EXACT_EVIDENCE reaches the model view byte-for-byte unchanged", () => {
  const { root, core } = sandbox();
  const payload = "HEAD\t6c353a6ce2d50d29e87dbe47cb7b36b1c957ef68\nstatus\tclean\n";
  const item = core.ingest({
    content: payload,
    classification: ContextClass.EXACT_EVIDENCE,
    metadata: { kind: "receipt" },
  });
  assert.equal(item.modelView, payload);
  assert.equal(item.lossless, true);
  assert.equal(item.bytesIn, item.bytesOut);
  rmSync(root, { recursive: true, force: true });
});

test("bulk material is content-addressed and model view is smaller", () => {
  const { root, store, core } = sandbox();
  const payload = Array.from({ length: 1000 }, (_, i) =>
    i === 777 ? "ERROR liquidity quote failed at adapter" : `PASS case-${i}`
  ).join("\n");
  const item = core.ingest({
    content: payload,
    classification: ContextClass.BULK_MATERIAL,
  });
  assert.ok(item.rawRef.digest.length === 64);
  assert.equal(store.get(item.rawRef), payload);
  assert.ok(item.bytesOut < item.bytesIn);
  assert.match(item.modelView, /ERROR liquidity quote failed/);
  rmSync(root, { recursive: true, force: true });
});

test("stored raw material fails closed on integrity mismatch", () => {
  const { root, store } = sandbox();
  const ref = store.put("canonical raw material");
  writeFileSync(ref.path, "tampered");
  assert.throws(() => store.get(ref), /integrity mismatch/);
  rmSync(root, { recursive: true, force: true });
});

test("packet builder never truncates exact evidence", () => {
  const { root, core } = sandbox();
  const exactPayload = "receipt:" + "x".repeat(700);
  const exact = core.ingest({
    content: exactPayload,
    classification: ContextClass.EXACT_EVIDENCE,
  });
  const small = core.ingest({
    content: "working note",
    classification: ContextClass.WORKING_CONTEXT,
  });
  const packet = buildContextPacket([exact, small], { budgetBytes: 2000 });
  const exactOut = packet.items.find(i => i.classification === ContextClass.EXACT_EVIDENCE);
  assert.equal(exactOut.payload, exactPayload);
  rmSync(root, { recursive: true, force: true });
});

test("packet builder fails closed when exact evidence alone exceeds budget", () => {
  const { root, core } = sandbox();
  const exact = core.ingest({
    content: "E".repeat(3000),
    classification: ContextClass.EXACT_EVIDENCE,
  });
  assert.throws(
    () => buildContextPacket([exact], { budgetBytes: 1000 }),
    ContextBudgetExceeded
  );
  rmSync(root, { recursive: true, force: true });
});

test("non-exact packet items may be omitted to preserve budget", () => {
  const { root, core } = sandbox();
  const exact = core.ingest({
    content: "HEAD=abc123",
    classification: ContextClass.EXACT_EVIDENCE,
  });
  const bulk = core.ingest({
    content: "WARN x\n".repeat(2000),
    classification: ContextClass.BULK_MATERIAL,
  });
  const packet = buildContextPacket([exact, bulk], { budgetBytes: 700 });
  assert.equal(packet.items[0].payload, "HEAD=abc123");
  assert.equal(packet.omittedNonExactItems, 1);
  assert.ok(Buffer.byteLength(JSON.stringify(packet), "utf8") <= 700);
  assert.equal(packet.usedBytes, Buffer.byteLength(JSON.stringify(packet), "utf8"));
  rmSync(root, { recursive: true, force: true });
});

test("durable memory stays an external reference and is not stored as raw content", () => {
  const { root, core } = sandbox();
  const item = core.ingest({
    classification: ContextClass.DURABLE_MEMORY_REFERENCE,
    metadata: {
      memoryRef: "mirror://recall/packet/42",
      provenance: "PRINCIPAL_DECLARED",
      asOf: "2026-09-18T00:00:00Z",
    },
  });
  assert.equal(item.rawRef, null);
  assert.equal(item.modelView, "mirror://recall/packet/42");
  assert.equal(item.metadata.provenance, "PRINCIPAL_DECLARED");
  rmSync(root, { recursive: true, force: true });
});

test("explicit classification wins over size heuristics", () => {
  const cls = classifyInput({
    content: "x".repeat(10000),
    classification: ContextClass.WORKING_CONTEXT,
  });
  assert.equal(cls, ContextClass.WORKING_CONTEXT);
});

test("structured authority metadata classifies as exact evidence", () => {
  const cls = classifyInput({
    content: "principal approved merge",
    metadata: { kind: "authority_decision" },
  });
  assert.equal(cls, ContextClass.EXACT_EVIDENCE);
});

test("a large log containing a SHA-like string is not promoted to exact evidence by content alone", () => {
  const content = ("PASS 0123456789abcdef0123456789abcdef01234567\n").repeat(200);
  const cls = classifyInput({ content });
  assert.equal(cls, ContextClass.BULK_MATERIAL);
});

test("Context Core declares zero execution and authority capability", () => {
  const caps = contextCoreCapabilities();
  assert.equal(caps.modelCalls, false);
  assert.equal(caps.arbitraryCodeExecution, false);
  assert.equal(caps.shellExecution, false);
  assert.equal(caps.authorityGrants, false);
  assert.equal(caps.durableMemoryWrites, false);
  assert.equal(caps.walletAccess, false);
  assert.equal(caps.tradeExecution, false);
  assert.equal(caps.gitWrite, false);
});
