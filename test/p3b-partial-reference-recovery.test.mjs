import test from "node:test";
import assert from "node:assert/strict";

import {
  ContextClass,
  PersistentLexicalIndex,
  prepareContextIngress,
  buildContextIngressReceipt,
  resolveContextReferenceRange,
  buildContextReferencePartialRecoveryDebitReceipt,
  verifyContextReferencePartialRecoveryDebitReceipt,
  buildContextSessionSavingsLedger,
} from "../src/index.mjs";

function deferredFixture(content) {
  const retrieval =
    new PersistentLexicalIndex({
      path: ":memory:",
    });

  const ingress = prepareContextIngress({
    retrieval,
    sourceId:
      "partial-recovery:source",
    content,
    classification:
      ContextClass.BULK_MATERIAL,
    metadata: {
      sessionId: "partial-recovery-session",
      sourceKind: "tool-result",
    },
    maxInlineBytes: 32,
    previewBytes: 16,
    maxChunkBytes: 128,
  });

  assert.equal(ingress.mode, "DEFERRED");
  return {
    retrieval,
    ingress,
    reference:
      JSON.parse(ingress.contextText),
  };
}

test("bounded reference recovery reconstructs exact UTF-8 source with governed partial debits", () => {
  const content =
    ("alpha 🐸 茶 beta γ delta\n").repeat(400);
  const {
    retrieval,
    ingress,
    reference,
  } = deferredFixture(content);

  try {
    const ranges = [];
    const receipts = [];
    let startByte = 0;

    while (true) {
      const range =
        resolveContextReferenceRange({
          retrieval,
          reference,
          startByte,
          maxBytes: 257,
        });

      assert.ok(range.returnedBytes > 0);
      assert.ok(range.returnedBytes <= 257);
      assert.equal(
        range.endByte - range.startByte,
        range.returnedBytes
      );

      const receipt =
        buildContextReferencePartialRecoveryDebitReceipt(
          range,
          {
            eventId:
              `partial:${range.startByte}`,
            observedAt:
              "2026-09-22T17:30:00Z",
          }
        );

      assert.equal(
        verifyContextReferencePartialRecoveryDebitReceipt(
          range,
          receipt
        ),
        true
      );

      ranges.push(range);
      receipts.push(receipt);

      if (range.complete) break;
      startByte = range.endByte;
    }

    assert.equal(
      ranges.map(range => range.content).join(""),
      content
    );

    assert.equal(
      receipts.reduce(
        (sum, receipt) =>
          sum + receipt.returnedBytes,
        0
      ),
      Buffer.byteLength(content, "utf8")
    );

    const ledger =
      buildContextSessionSavingsLedger({
        scopeId:
          "partial-recovery-session",
        ingressReceipts:
          [buildContextIngressReceipt(ingress)],
        retrievalReceipts:
          receipts,
      });

    assert.equal(
      ledger.retrievalReceiptCount,
      receipts.length
    );
    assert.equal(
      ledger.retrievalBytes,
      Buffer.byteLength(content, "utf8")
    );
  } finally {
    retrieval.close();
  }
});

test("bounded reference recovery is UTF-8 range-bound and fail-closed", () => {
  const content =
    "🐸".repeat(400) + "tail";
  const {
    retrieval,
    reference,
  } = deferredFixture(content);

  try {
    const first =
      resolveContextReferenceRange({
        retrieval,
        reference,
        startByte: 0,
        maxBytes: 65,
      });

    assert.ok(first.returnedBytes <= 65);
    assert.equal(first.complete, false);

    assert.throws(
      () =>
        resolveContextReferenceRange({
          retrieval,
          reference,
          startByte: 1,
          maxBytes: 64,
        }),
      /splits a UTF-8 code point/
    );

    assert.throws(
      () =>
        resolveContextReferenceRange({
          retrieval,
          reference,
          startByte: 0,
          maxBytes: 1,
        }),
      /too small for the next UTF-8 code point/
    );

    const receipt =
      buildContextReferencePartialRecoveryDebitReceipt(
        first
      );

    assert.throws(
      () =>
        verifyContextReferencePartialRecoveryDebitReceipt(
          first,
          {
            ...receipt,
            endByte:
              receipt.endByte + 1,
          }
        ),
      /verification failed/
    );

    assert.throws(
      () =>
        verifyContextReferencePartialRecoveryDebitReceipt(
          {
            ...first,
            content:
              `${first.content}x`,
          },
          receipt
        ),
      /content byte measurement mismatch/
    );
  } finally {
    retrieval.close();
  }
});

test("partial receipt keeps whole-source identity distinct from returned-range digest", () => {
  // Large enough that a CONTEXT_REFERENCE is byte-beneficial, so this
  // fixture exercises partial recovery rather than the honest INLINE fallback.
  const content =
    "one two three four five six seven eight nine ".repeat(32);
  const {
    retrieval,
    reference,
  } = deferredFixture(content);

  try {
    const range =
      resolveContextReferenceRange({
        retrieval,
        reference,
        maxBytes: 9,
      });

    const receipt =
      buildContextReferencePartialRecoveryDebitReceipt(
        range
      );

    assert.equal(
      receipt.kind,
      "CONTEXT_REFERENCE_PARTIAL_RECOVERY_DEBIT_RECEIPT"
    );
    assert.equal(
      receipt.sourceContentDigest,
      range.sourceContentDigest
    );
    assert.equal(
      receipt.returnedContentDigest,
      range.returnedContentDigest
    );
    assert.notEqual(
      receipt.sourceContentDigest,
      receipt.returnedContentDigest
    );
  } finally {
    retrieval.close();
  }
});
