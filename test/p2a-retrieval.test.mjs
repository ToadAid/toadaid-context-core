import test from "node:test";
import assert from "node:assert/strict";

import {
  ContextBudgetExceeded,
  ContextClass,
  LexicalIndex,
  chunkTextDeterministic,
  tokenizeLexical,
} from "../src/index.mjs";

test("tokenization is deterministic and Unicode-aware", () => {
  assert.deepEqual(
    tokenizeLexical("Price ETH_Usd — café 42 PRICE"),
    ["price", "eth_usd", "café", "42", "price"]
  );
});

test("chunking is stable and byte bounded", () => {
  const content = `${"alpha ".repeat(40)}\n${"beta ".repeat(40)}\n`;
  const a = chunkTextDeterministic(content, {
    sourceId: "source-A",
    maxChunkBytes: 128,
  });
  const b = chunkTextDeterministic(content, {
    sourceId: "source-A",
    maxChunkBytes: 128,
  });
  assert.deepEqual(a, b);
  assert.ok(a.length > 1);
  assert.ok(a.every(chunk => chunk.bytes <= 128));
});

test("default retrieval requires all query terms", () => {
  const index = new LexicalIndex();
  index.addSource({
    sourceId: "full",
    content: "liquidity quote failed adapter retry",
  });
  index.addSource({
    sourceId: "partial",
    content: "liquidity healthy",
  });
  const result = index.search("liquidity failed");
  assert.equal(result.totalCandidates, 1);
  assert.equal(result.results[0].sourceId, "full");
});

test("BM25 ranks denser relevant material first", () => {
  const index = new LexicalIndex();
  index.addSource({
    sourceId: "dense",
    content: "oracle stale oracle stale oracle price stale",
  });
  index.addSource({
    sourceId: "sparse",
    content: "oracle price note alpha beta gamma delta epsilon zeta stale",
  });
  const result = index.search("oracle stale");
  assert.equal(result.results.length, 2);
  assert.equal(result.results[0].sourceId, "dense");
  assert.ok(result.results[0].score > result.results[1].score);
});

test("serialized retrieval result obeys byte budget", () => {
  const index = new LexicalIndex();
  for (let i = 0; i < 10; i += 1) {
    index.addSource({
      sourceId: `src-${i}`,
      content: `signal alpha ${"detail ".repeat(30)} ${i}`,
    });
  }
  const result = index.search("signal alpha", {
    maxResults: 10,
    maxBytes: 900,
  });
  assert.ok(Buffer.byteLength(JSON.stringify(result), "utf8") <= 900);
  assert.equal(
    result.usedBytes,
    Buffer.byteLength(JSON.stringify(result), "utf8")
  );
  assert.ok(result.omittedResults > 0);
});

test("source identity is idempotent and cannot be rebound", () => {
  const index = new LexicalIndex();
  const first = index.addSource({
    sourceId: "stable",
    content: "canonical searchable material",
  });
  const second = index.addSource({
    sourceId: "stable",
    content: "canonical searchable material",
  });
  assert.deepEqual(first, second);
  assert.throws(
    () =>
      index.addSource({
        sourceId: "stable",
        content: "different material",
      }),
    /already refers to different content/
  );
});

test("exact evidence and durable memory are not fuzzy substitutes", () => {
  const index = new LexicalIndex();
  assert.throws(
    () =>
      index.addSource({
        sourceId: "proof",
        classification: ContextClass.EXACT_EVIDENCE,
        content: "HEAD=abc123",
      }),
    /not eligible for lexical indexing/
  );
  assert.throws(
    () =>
      index.addSource({
        sourceId: "memory",
        classification: ContextClass.DURABLE_MEMORY_REFERENCE,
        content: "mirror://recall/42",
      }),
    /not eligible for lexical indexing/
  );
});

test("retrieval fails closed if the envelope cannot fit", () => {
  const index = new LexicalIndex();
  index.addSource({ sourceId: "x", content: "alpha beta gamma" });
  assert.throws(
    () =>
      index.search(
        "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda",
        { maxBytes: 128 }
      ),
    ContextBudgetExceeded
  );
});

test("canonical classifier blocks implicit exact evidence admission", () => {
  const index = new LexicalIndex();

  assert.throws(
    () =>
      index.addSource({
        sourceId: "authority",
        content: "principal approved merge",
        metadata: { kind: "authority_decision" },
      }),
    /EXACT_EVIDENCE is not eligible for lexical indexing/
  );
});

test("canonical classifier blocks implicit durable memory admission", () => {
  const index = new LexicalIndex();

  assert.throws(
    () =>
      index.addSource({
        sourceId: "memory-ref",
        content: "",
        metadata: {
          memoryRef: "mirror://recall/packet/42",
          provenance: "PRINCIPAL_DECLARED",
        },
      }),
    /DURABLE_MEMORY_REFERENCE is not eligible for lexical indexing/
  );
});

test("omitted ordinary classification resolves through canonical policy", () => {
  const index = new LexicalIndex();
  const ref = index.addSource({
    sourceId: "ordinary",
    content: "working retrieval material",
  });

  assert.equal(ref.classification, ContextClass.WORKING_CONTEXT);
});
