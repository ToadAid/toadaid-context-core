import test from "node:test";
import assert from "node:assert/strict";

import {
  ContextClass,
  PersistentLexicalIndex,
  buildContextIngressReceipt,
  buildContextRetrievalDebitReceipt,
  buildContextSessionSavingsLedger,
  aggregateContextSavingsLedgers,
  buildContextSavingsReport,
  prepareContextIngress,
  verifyContextIngressReceipt,
  verifyContextRetrievalDebitReceipt,
  verifyContextSavingsLedger,
  verifyContextSavingsReport,
} from "../src/index.mjs";

test("inline ingress receipt proves zero avoided bytes", () => {
  const content = "small exact working payload";
  const ingress = prepareContextIngress({
    sourceId: "telemetry:inline",
    content,
    classification: ContextClass.WORKING_CONTEXT,
    maxInlineBytes: 4096,
  });

  const receipt = buildContextIngressReceipt(
    ingress,
    {
      eventId: "event:inline:1",
      observedAt: "2026-09-19T05:00:00Z",
    }
  );

  assert.equal(
    receipt.kind,
    "CONTEXT_INGRESS_RECEIPT"
  );
  assert.equal(receipt.mode, "INLINE");
  assert.equal(receipt.rawBytes, receipt.contextBytes);
  assert.equal(receipt.bytesAvoided, 0);
  assert.equal(
    receipt.sourceContentDigest,
    ingress.sourceContentDigest
  );
  assert.equal(
    receipt.contextDigest,
    ingress.contextDigest
  );
  assert.equal(
    receipt.sourceContentDigest,
    receipt.contextDigest
  );
  assert.equal(receipt.chunkCount, 0);
  assert.equal(receipt.sourceRefDigest, null);
  assert.equal(
    verifyContextIngressReceipt(ingress, receipt),
    true
  );
  assert.equal("tokensSaved" in receipt, false);
  assert.equal("tokenEstimate" in receipt, false);
});

test("deferred ingress receipt binds exact retrieval source reference", () => {
  const retrieval =
    new PersistentLexicalIndex({ path: ":memory:" });

  try {
    const content =
      "large telemetry material ".repeat(800);

    const ingress = prepareContextIngress({
      retrieval,
      sourceId: "telemetry:deferred",
      content,
      classification:
        ContextClass.RETRIEVABLE_KNOWLEDGE,
      metadata: {
        sessionId: "frog-p4",
        sourceKind: "tool-result",
      },
      maxInlineBytes: 128,
      previewBytes: 64,
      maxChunkBytes: 512,
    });

    const receipt =
      buildContextIngressReceipt(ingress);

    assert.equal(receipt.mode, "DEFERRED");
    assert.ok(receipt.bytesAvoided > 0);
    assert.equal(
      receipt.chunkCount,
      ingress.sourceRef.chunkCount
    );
    assert.match(
      receipt.sourceRefDigest,
      /^[a-f0-9]{64}$/
    );
    assert.equal(
      receipt.sourceContentDigest,
      ingress.sourceRef.contentDigest
    );
    assert.equal(
      receipt.sourceContentDigest,
      ingress.sourceContentDigest
    );
    assert.equal(
      receipt.contextDigest,
      ingress.contextDigest
    );
    assert.notEqual(
      receipt.contextDigest,
      receipt.sourceContentDigest
    );
    assert.equal(
      ingress.sourceRef.chunks.reduce(
        (sum, chunk) => sum + chunk.bytes,
        0
      ),
      receipt.rawBytes
    );
    assert.equal(
      verifyContextIngressReceipt(
        ingress,
        receipt
      ),
      true
    );
  } finally {
    retrieval.close();
  }
});

test("receipt builder rejects forged savings arithmetic", () => {
  const ingress = prepareContextIngress({
    sourceId: "telemetry:forged",
    content: "small payload",
    classification:
      ContextClass.WORKING_CONTEXT,
    maxInlineBytes: 4096,
  });

  assert.throws(
    () =>
      buildContextIngressReceipt({
        ...ingress,
        bytesAvoided: 1,
      }),
    /ingress byte accounting mismatch/
  );
});

test("receipt builder rejects equal-byte model-payload drift", () => {
  const retrieval =
    new PersistentLexicalIndex({ path: ":memory:" });

  try {
    const ingress = prepareContextIngress({
      retrieval,
      sourceId: "telemetry:equal-byte-drift",
      content: "bulk payload ".repeat(2000),
      classification:
        ContextClass.BULK_MATERIAL,
      maxInlineBytes: 64,
      previewBytes: 32,
      maxChunkBytes: 256,
    });

    const parsed = JSON.parse(
      ingress.contextText
    );
    const originalPreview = parsed.preview;
    assert.ok(originalPreview.length > 0);

    parsed.preview =
      `${originalPreview.slice(0, -1)}${
        originalPreview.endsWith("X")
          ? "Y"
          : "X"
      }`;

    const driftedText = JSON.stringify(parsed);

    assert.equal(
      Buffer.byteLength(driftedText, "utf8"),
      ingress.contextBytes
    );

    assert.throws(
      () =>
        buildContextIngressReceipt({
          ...ingress,
          contextText: driftedText,
        }),
      /ingress context digest mismatch/
    );
  } finally {
    retrieval.close();
  }
});

test("deferred receipt rejects a rehashed reference that lies about source truth", async () => {
  const retrieval =
    new PersistentLexicalIndex({ path: ":memory:" });

  try {
    const ingress = prepareContextIngress({
      retrieval,
      sourceId: "telemetry:reference-lie",
      content: "retrievable truth ".repeat(1800),
      classification:
        ContextClass.RETRIEVABLE_KNOWLEDGE,
      maxInlineBytes: 64,
      previewBytes: 24,
      maxChunkBytes: 256,
    });

    const parsed = JSON.parse(
      ingress.contextText
    );
    parsed.contentDigest = "0".repeat(64);
    const forgedContextText =
      JSON.stringify(parsed);

    const { createHash } =
      await import("node:crypto");
    const forgedContextDigest =
      createHash("sha256")
        .update(
          forgedContextText,
          "utf8"
        )
        .digest("hex");
    const forgedContextBytes =
      Buffer.byteLength(
        forgedContextText,
        "utf8"
      );

    assert.throws(
      () =>
        buildContextIngressReceipt({
          ...ingress,
          contextText:
            forgedContextText,
          contextBytes:
            forgedContextBytes,
          bytesAvoided:
            ingress.rawBytes -
            forgedContextBytes,
          contextDigest:
            forgedContextDigest,
        }),
      /deferred context reference binding mismatch/
    );
  } finally {
    retrieval.close();
  }
});

test("receipt builder remeasures the actual model-bound payload", () => {
  const ingress = prepareContextIngress({
    sourceId: "telemetry:context-drift",
    content: "small payload",
    classification:
      ContextClass.WORKING_CONTEXT,
    maxInlineBytes: 4096,
  });

  assert.throws(
    () =>
      buildContextIngressReceipt({
        ...ingress,
        contextText:
          `${ingress.contextText}-drift`,
      }),
    /ingress context byte measurement mismatch/
  );
});

test("deferred receipt rejects sourceRef chunk-order drift", () => {
  const retrieval =
    new PersistentLexicalIndex({ path: ":memory:" });

  try {
    const ingress = prepareContextIngress({
      retrieval,
      sourceId: "telemetry:chunk-order",
      content: "chunk order truth ".repeat(2200),
      classification:
        ContextClass.BULK_MATERIAL,
      maxInlineBytes: 64,
      previewBytes: 24,
      maxChunkBytes: 256,
    });

    assert.ok(
      ingress.sourceRef.chunks.length > 1
    );

    const chunks = [
      ...ingress.sourceRef.chunks,
    ].reverse();

    assert.throws(
      () =>
        buildContextIngressReceipt({
          ...ingress,
          sourceRef: {
            ...ingress.sourceRef,
            chunks,
          },
        }),
      /sourceRef chunk ordering mismatch/
    );
  } finally {
    retrieval.close();
  }
});

test("deferred receipt rejects sourceRef byte-total drift", () => {
  const retrieval =
    new PersistentLexicalIndex({ path: ":memory:" });

  try {
    const ingress = prepareContextIngress({
      retrieval,
      sourceId: "telemetry:source-drift",
      content: "bulk ".repeat(3000),
      classification:
        ContextClass.BULK_MATERIAL,
      maxInlineBytes: 64,
      previewBytes: 16,
      maxChunkBytes: 256,
    });

    const chunks =
      ingress.sourceRef.chunks.map(
        (chunk, index) =>
          index === 0
            ? { ...chunk, bytes: chunk.bytes + 1 }
            : chunk
      );

    assert.throws(
      () =>
        buildContextIngressReceipt({
          ...ingress,
          sourceRef: {
            ...ingress.sourceRef,
            chunks,
          },
        }),
      /deferred sourceRef byte total mismatch/
    );
  } finally {
    retrieval.close();
  }
});

test("receipt verification fails closed after receipt drift", () => {
  const ingress = prepareContextIngress({
    sourceId: "telemetry:receipt-drift",
    content: "small payload",
    classification:
      ContextClass.WORKING_CONTEXT,
    maxInlineBytes: 4096,
  });

  const receipt =
    buildContextIngressReceipt(ingress);

  assert.throws(
    () =>
      verifyContextIngressReceipt(
        ingress,
        {
          ...receipt,
          bytesAvoided: 999,
        }
      ),
    /context ingress receipt verification failed/
  );
});


test("retrieval debit receipt measures exact serialized returned bytes", () => {
  const retrieval =
    new PersistentLexicalIndex({ path: ":memory:" });

  try {
    retrieval.addSource({
      sourceId: "debit:exact",
      content:
        "retrieval debit receipt exact payload",
      classification:
        ContextClass.RETRIEVABLE_KNOWLEDGE,
    });

    const response =
      retrieval.search("retrieval debit", {
        maxResults: 4,
        maxBytes: 2048,
      });

    const receipt =
      buildContextRetrievalDebitReceipt(
        response,
        {
          eventId: "retrieval:event:1",
          observedAt:
            "2026-09-19T05:40:00Z",
        }
      );

    assert.equal(
      receipt.kind,
      "CONTEXT_RETRIEVAL_DEBIT_RECEIPT"
    );
    assert.equal(
      receipt.returnedBytes,
      Buffer.byteLength(
        JSON.stringify(response),
        "utf8"
      )
    );
    assert.equal(
      receipt.returnedBytes,
      response.usedBytes
    );
    assert.equal(receipt.resultCount, 1);
    assert.equal(receipt.recall, "exact");
    assert.match(
      receipt.responseDigest,
      /^[a-f0-9]{64}$/
    );
    assert.match(
      receipt.resultSetDigest,
      /^[a-f0-9]{64}$/
    );
    assert.equal(
      verifyContextRetrievalDebitReceipt(
        response,
        receipt
      ),
      true
    );
    assert.equal(
      "tokensRetrieved" in receipt,
      false
    );
    assert.equal(
      "costEstimate" in receipt,
      false
    );
  } finally {
    retrieval.close();
  }
});

test("tiered retrieval debit binds recall mode and derived match provenance", () => {
  const retrieval =
    new PersistentLexicalIndex({ path: ":memory:" });

  try {
    retrieval.addSource({
      sourceId: "debit:tiered",
      content: "buildResumePacket",
      classification:
        ContextClass.WORKING_CONTEXT,
    });

    const response =
      retrieval.search(
        "build_resume_packet",
        {
          recall: "tiered",
          maxResults: 4,
          maxBytes: 2048,
        }
      );

    assert.equal(
      response.results[0].matchKind,
      "IDENTIFIER"
    );

    const receipt =
      buildContextRetrievalDebitReceipt(
        response
      );

    assert.equal(
      receipt.recall,
      "tiered"
    );
    assert.equal(
      receipt.resultCount,
      1
    );
    assert.equal(
      verifyContextRetrievalDebitReceipt(
        response,
        receipt
      ),
      true
    );
  } finally {
    retrieval.close();
  }
});

test("zero-result retrieval still debits its nonzero response envelope", () => {
  const retrieval =
    new PersistentLexicalIndex({ path: ":memory:" });

  try {
    retrieval.addSource({
      sourceId: "debit:zero",
      content: "alpha beta gamma",
      classification:
        ContextClass.RETRIEVABLE_KNOWLEDGE,
    });

    const response =
      retrieval.search(
        "definitely_not_present",
        {
          maxBytes: 1024,
        }
      );

    assert.equal(response.results.length, 0);

    const receipt =
      buildContextRetrievalDebitReceipt(
        response
      );

    assert.equal(receipt.resultCount, 0);
    assert.ok(receipt.returnedBytes > 0);
    assert.equal(
      receipt.returnedBytes,
      response.usedBytes
    );
  } finally {
    retrieval.close();
  }
});

test("retrieval debit rejects forged usedBytes even when content is untouched", () => {
  const retrieval =
    new PersistentLexicalIndex({ path: ":memory:" });

  try {
    retrieval.addSource({
      sourceId: "debit:used-bytes",
      content: "measured retrieval bytes",
      classification:
        ContextClass.RETRIEVABLE_KNOWLEDGE,
    });

    const response =
      retrieval.search("retrieval", {
        maxBytes: 2048,
      });

    assert.throws(
      () =>
        buildContextRetrievalDebitReceipt({
          ...response,
          usedBytes:
            response.usedBytes + 1,
        }),
      /retrieval response byte measurement mismatch/
    );
  } finally {
    retrieval.close();
  }
});

test("retrieval debit rejects returned chunk content drift even after response bytes are restabilized", () => {
  const retrieval =
    new PersistentLexicalIndex({ path: ":memory:" });

  try {
    retrieval.addSource({
      sourceId: "debit:chunk-drift",
      content:
        "immutable returned retrieval chunk",
      classification:
        ContextClass.RETRIEVABLE_KNOWLEDGE,
    });

    const response =
      retrieval.search("retrieval", {
        maxBytes: 2048,
      });

    const original =
      response.results[0].content;
    const drifted =
      `${original.slice(0, -1)}${
        original.endsWith("X")
          ? "Y"
          : "X"
      }`;

    const forged = {
      ...response,
      results: [
        {
          ...response.results[0],
          content: drifted,
        },
      ],
      usedBytes: 0,
    };

    for (let i = 0; i < 8; i += 1) {
      const measured =
        Buffer.byteLength(
          JSON.stringify(forged),
          "utf8"
        );
      if (measured === forged.usedBytes) {
        break;
      }
      forged.usedBytes = measured;
    }

    assert.throws(
      () =>
        buildContextRetrievalDebitReceipt(
          forged
        ),
      /retrieval result chunk digest mismatch/
    );
  } finally {
    retrieval.close();
  }
});

test("retrieval debit verification fails closed after receipt drift", () => {
  const retrieval =
    new PersistentLexicalIndex({ path: ":memory:" });

  try {
    retrieval.addSource({
      sourceId: "debit:receipt-drift",
      content: "receipt drift retrieval",
      classification:
        ContextClass.RETRIEVABLE_KNOWLEDGE,
    });

    const response =
      retrieval.search("retrieval", {
        maxBytes: 2048,
      });

    const receipt =
      buildContextRetrievalDebitReceipt(
        response
      );

    assert.throws(
      () =>
        verifyContextRetrievalDebitReceipt(
          response,
          {
            ...receipt,
            returnedBytes:
              receipt.returnedBytes + 1,
          }
        ),
      /context retrieval debit receipt verification failed/
    );
  } finally {
    retrieval.close();
  }
});


function buildLedgerDeferredFixture({
  sourceId = "ledger:deferred",
  content = "ledger proof ".repeat(600),
  query = "ledger",
} = {}) {
  const retrieval =
    new PersistentLexicalIndex({ path: ":memory:" });

  const ingress =
    prepareContextIngress({
      retrieval,
      sourceId,
      content,
      classification:
        ContextClass.RETRIEVABLE_KNOWLEDGE,
      maxInlineBytes: 128,
      previewBytes: 24,
      maxChunkBytes: 512,
    });

  const ingressReceipt =
    buildContextIngressReceipt(ingress);

  const response =
    retrieval.search(query, {
      maxResults: 1,
      maxBytes: 1024,
    });

  const retrievalReceipt =
    buildContextRetrievalDebitReceipt(response);

  return {
    retrieval,
    ingressReceipt,
    retrievalReceipt,
  };
}

test("session savings ledger subtracts exact retrieval debit from deferred ingress credit", () => {
  const fixture = buildLedgerDeferredFixture();

  try {
    const ledger =
      buildContextSessionSavingsLedger({
        scopeId: "session:one",
        ingressReceipts: [fixture.ingressReceipt],
        retrievalReceipts: [fixture.retrievalReceipt],
      });

    assert.equal(
      ledger.grossBytesAvoided,
      fixture.ingressReceipt.bytesAvoided
    );
    assert.equal(
      ledger.retrievalBytes,
      fixture.retrievalReceipt.returnedBytes
    );
    assert.equal(
      ledger.netBytesAvoided,
      Math.max(
        fixture.ingressReceipt.bytesAvoided -
          fixture.retrievalReceipt.returnedBytes,
        0
      )
    );
    assert.equal(
      ledger.netBytesAdded,
      Math.max(
        fixture.retrievalReceipt.returnedBytes -
          fixture.ingressReceipt.bytesAvoided,
        0
      )
    );
    assert.equal(verifyContextSavingsLedger(ledger), true);
    assert.equal("tokensSaved" in ledger, false);
    assert.equal("savingsPercent" in ledger, false);
  } finally {
    fixture.retrieval.close();
  }
});

test("NO DIVERSION means inline ingress contributes zero savings credit", () => {
  const ingress =
    prepareContextIngress({
      sourceId: "ledger:inline",
      content: "small inline context",
      classification:
        ContextClass.WORKING_CONTEXT,
      maxInlineBytes: 4096,
    });

  const ingressReceipt =
    buildContextIngressReceipt(ingress);

  const ledger =
    buildContextSessionSavingsLedger({
      scopeId: "session:inline",
      ingressReceipts: [ingressReceipt],
    });

  assert.equal(ingressReceipt.mode, "INLINE");
  assert.equal(ledger.grossBytesAvoided, 0);
  assert.equal(ledger.netBytesAvoided, 0);
  assert.equal(ledger.netBytesAdded, 0);
});

test("retrieval over debit is reported as added bytes, never negative savings", () => {
  const retrieval =
    new PersistentLexicalIndex({ path: ":memory:" });

  try {
    retrieval.addSource({
      sourceId: "ledger:over-debit",
      content:
        "retrieval envelope with no credited diversion",
      classification:
        ContextClass.RETRIEVABLE_KNOWLEDGE,
    });

    const debit =
      buildContextRetrievalDebitReceipt(
        retrieval.search("retrieval", {
          maxBytes: 2048,
        })
      );

    const ledger =
      buildContextSessionSavingsLedger({
        scopeId: "session:over-debit",
        retrievalReceipts: [debit],
      });

    assert.equal(ledger.grossBytesAvoided, 0);
    assert.equal(ledger.netBytesAvoided, 0);
    assert.equal(
      ledger.netBytesAdded,
      debit.returnedBytes
    );
  } finally {
    retrieval.close();
  }
});

test("session ledger rejects duplicate ingress credit receipts", () => {
  const fixture =
    buildLedgerDeferredFixture({
      sourceId: "ledger:duplicate-ingress",
    });

  try {
    assert.throws(
      () =>
        buildContextSessionSavingsLedger({
          scopeId: "session:dup-ingress",
          ingressReceipts: [
            fixture.ingressReceipt,
            fixture.ingressReceipt,
          ],
        }),
      /duplicate digest/
    );
  } finally {
    fixture.retrieval.close();
  }
});

test("session ledger rejects duplicate retrieval debit receipts", () => {
  const fixture =
    buildLedgerDeferredFixture({
      sourceId: "ledger:duplicate-debit",
    });

  try {
    assert.throws(
      () =>
        buildContextSessionSavingsLedger({
          scopeId: "session:dup-debit",
          retrievalReceipts: [
            fixture.retrievalReceipt,
            fixture.retrievalReceipt,
          ],
        }),
      /duplicate digest/
    );
  } finally {
    fixture.retrieval.close();
  }
});

test("session ledger fails closed on ingress receipt drift", () => {
  const fixture =
    buildLedgerDeferredFixture({
      sourceId: "ledger:ingress-drift",
    });

  try {
    assert.throws(
      () =>
        buildContextSessionSavingsLedger({
          scopeId: "session:drift",
          ingressReceipts: [
            {
              ...fixture.ingressReceipt,
              bytesAvoided:
                fixture.ingressReceipt.bytesAvoided - 1,
            },
          ],
        }),
      /byte accounting mismatch|receipt digest mismatch/
    );
  } finally {
    fixture.retrieval.close();
  }
});

test("project and global aggregation recompute exact gross and debit totals", () => {
  const a =
    buildLedgerDeferredFixture({
      sourceId: "ledger:aggregate:a",
      content: "alpha ledger ".repeat(500),
      query: "alpha",
    });
  const b =
    buildLedgerDeferredFixture({
      sourceId: "ledger:aggregate:b",
      content: "beta ledger ".repeat(450),
      query: "beta",
    });

  try {
    const sessionA =
      buildContextSessionSavingsLedger({
        scopeId: "session:a",
        ingressReceipts: [a.ingressReceipt],
        retrievalReceipts: [a.retrievalReceipt],
      });
    const sessionB =
      buildContextSessionSavingsLedger({
        scopeId: "session:b",
        ingressReceipts: [b.ingressReceipt],
        retrievalReceipts: [b.retrievalReceipt],
      });

    const project =
      aggregateContextSavingsLedgers({
        scopeType: "PROJECT",
        scopeId: "project:one",
        childLedgers: [sessionA, sessionB],
      });

    assert.equal(
      project.grossBytesAvoided,
      sessionA.grossBytesAvoided +
        sessionB.grossBytesAvoided
    );
    assert.equal(
      project.retrievalBytes,
      sessionA.retrievalBytes +
        sessionB.retrievalBytes
    );

    for (const child of [sessionA, sessionB]) {
      assert.ok(
        child.grossBytesAvoided <=
          project.grossBytesAvoided
      );
      assert.ok(
        child.retrievalBytes <=
          project.retrievalBytes
      );
    }

    const global =
      aggregateContextSavingsLedgers({
        scopeType: "GLOBAL",
        scopeId: "global",
        childLedgers: [project],
      });

    assert.equal(
      global.grossBytesAvoided,
      project.grossBytesAvoided
    );
    assert.equal(
      global.retrievalBytes,
      project.retrievalBytes
    );
    assert.equal(
      verifyContextSavingsLedger(global),
      true
    );
  } finally {
    a.retrieval.close();
    b.retrieval.close();
  }
});

test("aggregation hierarchy refuses invalid child scope types", () => {
  const session =
    buildContextSessionSavingsLedger({
      scopeId: "session:hierarchy",
    });

  assert.throws(
    () =>
      aggregateContextSavingsLedgers({
        scopeType: "GLOBAL",
        scopeId: "global:bad",
        childLedgers: [session],
      }),
    /requires PROJECT children/
  );

  const project =
    aggregateContextSavingsLedgers({
      scopeType: "PROJECT",
      scopeId: "project:empty",
      childLedgers: [session],
    });

  assert.throws(
    () =>
      aggregateContextSavingsLedgers({
        scopeType: "PROJECT",
        scopeId: "project:bad",
        childLedgers: [project],
      }),
    /requires SESSION children/
  );
});

test("aggregate ledger rejects duplicate child ledger digests", () => {
  const session =
    buildContextSessionSavingsLedger({
      scopeId: "session:duplicate-child",
    });

  assert.throws(
    () =>
      aggregateContextSavingsLedgers({
        scopeType: "PROJECT",
        scopeId: "project:duplicate-child",
        childLedgers: [session, session],
      }),
    /duplicate digest/
  );
});

test("ledger verification fails closed after net-accounting drift", () => {
  const fixture =
    buildLedgerDeferredFixture({
      sourceId: "ledger:verify-drift",
    });

  try {
    const ledger =
      buildContextSessionSavingsLedger({
        scopeId: "session:verify-drift",
        ingressReceipts: [fixture.ingressReceipt],
        retrievalReceipts: [fixture.retrievalReceipt],
      });

    assert.throws(
      () =>
        verifyContextSavingsLedger({
          ...ledger,
          netBytesAvoided:
            ledger.netBytesAvoided + 1,
        }),
      /net accounting mismatch|ledger digest mismatch/
    );
  } finally {
    fixture.retrieval.close();
  }
});


test("project aggregation rejects the same ingress proof across distinct session ledgers", () => {
  const fixture =
    buildLedgerDeferredFixture({
      sourceId: "ledger:cross-session-ingress",
    });

  try {
    const sessionA =
      buildContextSessionSavingsLedger({
        scopeId: "session:cross-a",
        ingressReceipts: [
          fixture.ingressReceipt,
        ],
      });

    const sessionB =
      buildContextSessionSavingsLedger({
        scopeId: "session:cross-b",
        ingressReceipts: [
          fixture.ingressReceipt,
        ],
      });

    assert.notEqual(
      sessionA.ledgerDigest,
      sessionB.ledgerDigest
    );

    assert.throws(
      () =>
        aggregateContextSavingsLedgers({
          scopeType: "PROJECT",
          scopeId: "project:cross-ingress",
          childLedgers: [
            sessionA,
            sessionB,
          ],
        }),
      /aggregate ingress receipt digest contains a duplicate digest/
    );
  } finally {
    fixture.retrieval.close();
  }
});

test("project aggregation rejects the same retrieval debit across distinct session ledgers", () => {
  const fixture =
    buildLedgerDeferredFixture({
      sourceId: "ledger:cross-session-debit",
    });

  try {
    const sessionA =
      buildContextSessionSavingsLedger({
        scopeId: "session:debit-a",
        retrievalReceipts: [
          fixture.retrievalReceipt,
        ],
      });

    const sessionB =
      buildContextSessionSavingsLedger({
        scopeId: "session:debit-b",
        retrievalReceipts: [
          fixture.retrievalReceipt,
        ],
      });

    assert.notEqual(
      sessionA.ledgerDigest,
      sessionB.ledgerDigest
    );

    assert.throws(
      () =>
        aggregateContextSavingsLedgers({
          scopeType: "PROJECT",
          scopeId: "project:cross-debit",
          childLedgers: [
            sessionA,
            sessionB,
          ],
        }),
      /aggregate retrieval receipt digest contains a duplicate digest/
    );
  } finally {
    fixture.retrieval.close();
  }
});

test("global aggregation rejects duplicate leaf proofs hidden in distinct project ledgers", () => {
  const fixture =
    buildLedgerDeferredFixture({
      sourceId: "ledger:cross-project",
    });

  try {
    const sessionA =
      buildContextSessionSavingsLedger({
        scopeId: "session:project-a",
        ingressReceipts: [
          fixture.ingressReceipt,
        ],
      });

    const sessionB =
      buildContextSessionSavingsLedger({
        scopeId: "session:project-b",
        ingressReceipts: [
          fixture.ingressReceipt,
        ],
      });

    const projectA =
      aggregateContextSavingsLedgers({
        scopeType: "PROJECT",
        scopeId: "project:a",
        childLedgers: [sessionA],
      });

    const projectB =
      aggregateContextSavingsLedgers({
        scopeType: "PROJECT",
        scopeId: "project:b",
        childLedgers: [sessionB],
      });

    assert.deepEqual(
      projectA.ingressReceiptDigests,
      [fixture.ingressReceipt.receiptDigest]
    );

    assert.deepEqual(
      projectB.ingressReceiptDigests,
      [fixture.ingressReceipt.receiptDigest]
    );

    assert.throws(
      () =>
        aggregateContextSavingsLedgers({
          scopeType: "GLOBAL",
          scopeId: "global:cross-project",
          childLedgers: [
            projectA,
            projectB,
          ],
        }),
      /aggregate ingress receipt digest contains a duplicate digest/
    );
  } finally {
    fixture.retrieval.close();
  }
});


test("honest savings report re-derives exact session byte truth", () => {
  const fixture =
    buildLedgerDeferredFixture({
      sourceId: "report:session",
      content: "honest report ".repeat(700),
      query: "honest",
    });

  try {
    const ledger =
      buildContextSessionSavingsLedger({
        scopeId: "session:report",
        ingressReceipts: [
          fixture.ingressReceipt,
        ],
        retrievalReceipts: [
          fixture.retrievalReceipt,
        ],
      });

    const report =
      buildContextSavingsReport(
        {
          ledger,
          ingressReceipts: [
            fixture.ingressReceipt,
          ],
          retrievalReceipts: [
            fixture.retrievalReceipt,
          ],
        },
        {
          eventId: "report:event:1",
          observedAt: "2026-09-19T12:00:00Z",
        }
      );

    assert.equal(
      report.observedRawBytes,
      fixture.ingressReceipt.rawBytes
    );
    assert.equal(
      report.ingressContextBytes,
      fixture.ingressReceipt.contextBytes
    );
    assert.equal(
      report.retrievalBytes,
      fixture.retrievalReceipt.returnedBytes
    );
    assert.equal(
      report.grossBytesAvoided,
      ledger.grossBytesAvoided
    );
    assert.equal(
      report.netBytesAvoided,
      ledger.netBytesAvoided
    );
    assert.equal(
      report.netBytesAdded,
      ledger.netBytesAdded
    );
    assert.equal(
      report.ledgerDigest,
      ledger.ledgerDigest
    );
    assert.equal(
      report.unit,
      "UTF8_BYTES"
    );
    assert.equal(
      report.claimBoundary,
      "BYTE_ACCOUNTING_ONLY"
    );
    assert.equal(
      report.retrievalBasis,
      "SERIALIZED_RESPONSE_RETURNED_TO_CALLER"
    );
    assert.equal(
      verifyContextSavingsReport(report),
      true
    );
  } finally {
    fixture.retrieval.close();
  }
});

test("aggregate savings report requires and re-derives transitive leaf receipt truth", () => {
  const a =
    buildLedgerDeferredFixture({
      sourceId: "report:aggregate:a",
      content: "alpha report ".repeat(600),
      query: "alpha",
    });
  const b =
    buildLedgerDeferredFixture({
      sourceId: "report:aggregate:b",
      content: "beta report ".repeat(550),
      query: "beta",
    });

  try {
    const sessionA =
      buildContextSessionSavingsLedger({
        scopeId: "session:report:a",
        ingressReceipts: [
          a.ingressReceipt,
        ],
        retrievalReceipts: [
          a.retrievalReceipt,
        ],
      });

    const sessionB =
      buildContextSessionSavingsLedger({
        scopeId: "session:report:b",
        ingressReceipts: [
          b.ingressReceipt,
        ],
        retrievalReceipts: [
          b.retrievalReceipt,
        ],
      });

    const project =
      aggregateContextSavingsLedgers({
        scopeType: "PROJECT",
        scopeId: "project:report",
        childLedgers: [
          sessionA,
          sessionB,
        ],
      });

    const projectReport =
      buildContextSavingsReport({
        ledger: project,
        ingressReceipts: [
          a.ingressReceipt,
          b.ingressReceipt,
        ],
        retrievalReceipts: [
          a.retrievalReceipt,
          b.retrievalReceipt,
        ],
      });

    assert.equal(
      projectReport.observedRawBytes,
      a.ingressReceipt.rawBytes +
        b.ingressReceipt.rawBytes
    );
    assert.equal(
      projectReport.ingressContextBytes,
      a.ingressReceipt.contextBytes +
        b.ingressReceipt.contextBytes
    );
    assert.deepEqual(
      projectReport.ingressReceiptDigests,
      project.ingressReceiptDigests
    );
    assert.deepEqual(
      projectReport.retrievalReceiptDigests,
      project.retrievalReceiptDigests
    );
    assert.deepEqual(
      projectReport.childLedgerDigests,
      project.childLedgerDigests
    );

    const global =
      aggregateContextSavingsLedgers({
        scopeType: "GLOBAL",
        scopeId: "global:report",
        childLedgers: [project],
      });

    const globalReport =
      buildContextSavingsReport({
        ledger: global,
        ingressReceipts: [
          a.ingressReceipt,
          b.ingressReceipt,
        ],
        retrievalReceipts: [
          a.retrievalReceipt,
          b.retrievalReceipt,
        ],
      });

    assert.equal(
      globalReport.scopeType,
      "GLOBAL"
    );
    assert.equal(
      globalReport.observedRawBytes,
      projectReport.observedRawBytes
    );
    assert.equal(
      globalReport.retrievalBytes,
      projectReport.retrievalBytes
    );
  } finally {
    a.retrieval.close();
    b.retrieval.close();
  }
});

test("honest savings report rejects missing or reordered receipt provenance", () => {
  const a =
    buildLedgerDeferredFixture({
      sourceId: "report:order:a",
      content: "order alpha ".repeat(500),
      query: "alpha",
    });
  const b =
    buildLedgerDeferredFixture({
      sourceId: "report:order:b",
      content: "order beta ".repeat(500),
      query: "beta",
    });

  try {
    const sessionA =
      buildContextSessionSavingsLedger({
        scopeId: "session:order:a",
        ingressReceipts: [a.ingressReceipt],
        retrievalReceipts: [a.retrievalReceipt],
      });
    const sessionB =
      buildContextSessionSavingsLedger({
        scopeId: "session:order:b",
        ingressReceipts: [b.ingressReceipt],
        retrievalReceipts: [b.retrievalReceipt],
      });

    const project =
      aggregateContextSavingsLedgers({
        scopeType: "PROJECT",
        scopeId: "project:order",
        childLedgers: [
          sessionA,
          sessionB,
        ],
      });

    assert.throws(
      () =>
        buildContextSavingsReport({
          ledger: project,
          ingressReceipts: [
            a.ingressReceipt,
          ],
          retrievalReceipts: [
            a.retrievalReceipt,
            b.retrievalReceipt,
          ],
        }),
      /ingress provenance mismatch/
    );

    assert.throws(
      () =>
        buildContextSavingsReport({
          ledger: project,
          ingressReceipts: [
            b.ingressReceipt,
            a.ingressReceipt,
          ],
          retrievalReceipts: [
            a.retrievalReceipt,
            b.retrievalReceipt,
          ],
        }),
      /ingress provenance mismatch/
    );
  } finally {
    a.retrieval.close();
    b.retrieval.close();
  }
});

test("retrieval-only report labels added bytes instead of negative savings", () => {
  const retrieval =
    new PersistentLexicalIndex({ path: ":memory:" });

  try {
    retrieval.addSource({
      sourceId: "report:retrieval-only",
      content:
        "retrieval only honest reporting surface",
      classification:
        ContextClass.RETRIEVABLE_KNOWLEDGE,
    });

    const debit =
      buildContextRetrievalDebitReceipt(
        retrieval.search("retrieval", {
          maxBytes: 2048,
        })
      );

    const ledger =
      buildContextSessionSavingsLedger({
        scopeId: "session:retrieval-only-report",
        retrievalReceipts: [debit],
      });

    const report =
      buildContextSavingsReport({
        ledger,
        retrievalReceipts: [debit],
      });

    assert.equal(
      report.observedRawBytes,
      0
    );
    assert.equal(
      report.ingressContextBytes,
      0
    );
    assert.equal(
      report.grossBytesAvoided,
      0
    );
    assert.equal(
      report.netBytesAvoided,
      0
    );
    assert.equal(
      report.netBytesAdded,
      debit.returnedBytes
    );
    assert.equal(
      report.status,
      "ADDED_BYTES"
    );
  } finally {
    retrieval.close();
  }
});

test("honest savings report emits no token percentage cost or model-input savings fiction", () => {
  const ledger =
    buildContextSessionSavingsLedger({
      scopeId: "session:no-fiction",
    });

  const report =
    buildContextSavingsReport({
      ledger,
    });

  for (const forbidden of [
    "tokens",
    "tokenCount",
    "tokensSaved",
    "savingsPercent",
    "percentSaved",
    "costSaved",
    "costEstimate",
    "modelInputBytes",
    "modelInputSavings",
  ]) {
    assert.equal(
      forbidden in report,
      false,
      `${forbidden} must not exist`
    );
  }

  assert.equal(
    report.claimBoundary,
    "BYTE_ACCOUNTING_ONLY"
  );
  assert.equal(
    report.retrievalBasis,
    "SERIALIZED_RESPONSE_RETURNED_TO_CALLER"
  );
});

test("honest savings report uses no hidden clock and preserves optional caller metadata", () => {
  const ledger =
    buildContextSessionSavingsLedger({
      scopeId: "session:report-metadata",
    });

  const plain =
    buildContextSavingsReport({
      ledger,
    });

  assert.equal(plain.eventId, null);
  assert.equal(plain.observedAt, null);

  const explicit =
    buildContextSavingsReport(
      { ledger },
      {
        eventId: "report:event:explicit",
        observedAt: "2026-09-19T12:34:56Z",
      }
    );

  assert.equal(
    explicit.eventId,
    "report:event:explicit"
  );
  assert.equal(
    explicit.observedAt,
    "2026-09-19T12:34:56Z"
  );
});

test("honest savings report fails closed when receipt byte truth drifts", () => {
  const fixture =
    buildLedgerDeferredFixture({
      sourceId: "report:receipt-drift",
    });

  try {
    const ledger =
      buildContextSessionSavingsLedger({
        scopeId: "session:report-drift",
        ingressReceipts: [
          fixture.ingressReceipt,
        ],
      });

    assert.throws(
      () =>
        buildContextSavingsReport({
          ledger,
          ingressReceipts: [
            {
              ...fixture.ingressReceipt,
              contextBytes:
                fixture.ingressReceipt.contextBytes + 1,
            },
          ],
        }),
      /byte accounting mismatch|receipt digest mismatch/
    );
  } finally {
    fixture.retrieval.close();
  }
});

test("honest savings report verification fails closed after report drift", () => {
  const ledger =
    buildContextSessionSavingsLedger({
      scopeId: "session:report-verify-drift",
    });

  const report =
    buildContextSavingsReport({
      ledger,
    });

  assert.throws(
    () =>
      verifyContextSavingsReport({
        ...report,
        observedRawBytes:
          report.observedRawBytes + 1,
      }),
    /gross byte accounting mismatch|report digest mismatch/
  );
});


test("verified honest report rejects appended unbound token percentage cost and unknown fields", () => {
  const ledger =
    buildContextSessionSavingsLedger({
      scopeId: "session:strict-report-schema",
    });

  const report =
    buildContextSavingsReport({
      ledger,
    });

  for (const [field, value] of [
    ["tokensSaved", 999999],
    ["savingsPercent", 98],
    ["costSaved", 12.34],
    ["modelInputBytes", 1234],
    ["unboundNarrative", "trust me"],
  ]) {
    assert.throws(
      () =>
        verifyContextSavingsReport({
          ...report,
          [field]: value,
        }),
      /unknown, missing, or unbound fields/
    );
  }
});

test("verified honest report rejects missing canonical fields even with original digest", () => {
  const ledger =
    buildContextSessionSavingsLedger({
      scopeId: "session:strict-report-missing",
    });

  const report =
    buildContextSavingsReport({
      ledger,
    });

  const {
    retrievalBasis: _retrievalBasis,
    ...missingField
  } = report;

  assert.throws(
    () =>
      verifyContextSavingsReport(
        missingField
      ),
    /unknown, missing, or unbound fields/
  );
});
