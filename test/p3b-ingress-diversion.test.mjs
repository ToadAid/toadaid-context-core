import test from "node:test";
import assert from "node:assert/strict";

import {
  ContextClass,
  PersistentLexicalIndex,
  prepareContextIngress,
} from "../src/index.mjs";

test("small working context stays byte-identical inline", () => {
  const content = "small principal-visible working context";
  const result = prepareContextIngress({
    sourceId: "small-working",
    content,
    classification: ContextClass.WORKING_CONTEXT,
    maxInlineBytes: 4096,
  });
  assert.equal(result.mode, "INLINE");
  assert.equal(result.reason, "WITHIN_INLINE_BUDGET");
  assert.equal(result.contextText, content);
  assert.equal(result.rawBytes, Buffer.byteLength(content));
  assert.equal(result.contextBytes, result.rawBytes);
  assert.equal(result.bytesAvoided, 0);
  assert.equal(result.sourceRef, null);
});

test("oversized exact evidence is never truncated or diverted", () => {
  const content = "EXACT-SHA-".repeat(1000);
  const retrieval = {
    addSource() {
      throw new Error("exact evidence must not be indexed");
    },
  };
  const result = prepareContextIngress({
    retrieval,
    sourceId: "exact-proof",
    content,
    classification: ContextClass.EXACT_EVIDENCE,
    maxInlineBytes: 128,
    previewBytes: 16,
  });
  assert.equal(result.mode, "INLINE");
  assert.equal(result.reason, "EXACT_EVIDENCE_MUST_REMAIN_EXACT");
  assert.equal(result.contextText, content);
  assert.equal(result.bytesAvoided, 0);
});

test("durable memory references stay inline", () => {
  const content = "memory://governed/ref/".repeat(500);
  const result = prepareContextIngress({
    sourceId: "memory-ref",
    content,
    classification: ContextClass.DURABLE_MEMORY_REFERENCE,
    maxInlineBytes: 64,
  });
  assert.equal(result.mode, "INLINE");
  assert.equal(result.reason, "DURABLE_MEMORY_REFERENCE_STAYS_INLINE");
  assert.equal(result.contextText, content);
});

test("oversized bulk material is indexed and omitted detail stays retrievable", () => {
  const retrieval = new PersistentLexicalIndex({ path: ":memory:" });
  try {
    const tailMarker = "TAILNEEDLE-ORCHID-947";
    const content = ["bulk tool output header", "x".repeat(9000), tailMarker].join("\n");
    const result = prepareContextIngress({
      retrieval,
      sourceId: "tool-output:bulk-947",
      content,
      classification: ContextClass.BULK_MATERIAL,
      metadata: { sessionId: "frog-947", sourceKind: "tool-result" },
      maxInlineBytes: 1024,
      previewBytes: 256,
    });
    assert.equal(result.mode, "DEFERRED");
    assert.equal(result.reason, "OVER_INLINE_BUDGET_INDEXED");
    assert.ok(result.sourceRef);
    assert.ok(result.contextBytes < result.rawBytes);
    assert.equal(result.bytesAvoided, result.rawBytes - result.contextBytes);
    assert.equal(result.contextBytes, Buffer.byteLength(result.contextText, "utf8"));
    assert.doesNotMatch(result.contextText, /TAILNEEDLE/);
    const parsed = JSON.parse(result.contextText);
    assert.equal(parsed.kind, "CONTEXT_REFERENCE");
    assert.equal(parsed.sourceId, "tool-output:bulk-947");
    assert.equal(parsed.previewTruncated, true);
    const recovered = retrieval.search("TAILNEEDLE ORCHID 947", {
      maxResults: 4,
      maxBytes: 4096,
      match: "all",
      metadataEquals: { sessionId: "frog-947" },
    });
    assert.ok(recovered.results.some(item => item.content.includes(tailMarker)));
  } finally {
    retrieval.close();
  }
});

test("preview byte cap never splits a Unicode code point", () => {
  const retrieval = new PersistentLexicalIndex({ path: ":memory:" });
  try {
    const content = "A".repeat(5000) + "🐸" + "B".repeat(5000);
    const result = prepareContextIngress({
      retrieval,
      sourceId: "unicode-preview",
      content,
      classification: ContextClass.BULK_MATERIAL,
      maxInlineBytes: 32,
      previewBytes: 5002,
    });
    assert.equal(result.mode, "DEFERRED");
    const preview = JSON.parse(result.contextText).preview;
    const last = preview.charCodeAt(preview.length - 1);
    assert.equal(last >= 0xd800 && last <= 0xdbff, false);
    assert.ok(Buffer.byteLength(preview, "utf8") <= 5002);
  } finally {
    retrieval.close();
  }
});

test("diversion reports measured bytes and no token-savings fiction", () => {
  const retrieval = new PersistentLexicalIndex({ path: ":memory:" });
  try {
    const content = "metric material ".repeat(1000);
    const result = prepareContextIngress({
      retrieval,
      sourceId: "metric-source",
      content,
      classification: ContextClass.RETRIEVABLE_KNOWLEDGE,
      maxInlineBytes: 128,
      previewBytes: 64,
    });
    assert.equal(result.mode, "DEFERRED");
    assert.equal(result.rawBytes, Buffer.byteLength(content, "utf8"));
    assert.equal(result.contextBytes, Buffer.byteLength(result.contextText, "utf8"));
    assert.equal(result.bytesAvoided, result.rawBytes - result.contextBytes);
    assert.equal("tokensSaved" in result, false);
  } finally {
    retrieval.close();
  }
});
