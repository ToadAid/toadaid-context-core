import test from "node:test";
import assert from "node:assert/strict";

import {
  ContextClass,
  PersistentLexicalIndex,
  buildContextReferenceRecoveryDebitReceipt,
  buildContextSavingsReport,
  buildContextSessionSavingsLedger,
  prepareToolOutputIngress,
  resolveContextReference,
  verifyContextReferenceRecoveryDebitReceipt,
  verifyContextSavingsLedger,
  verifyContextSavingsReport,
} from "../src/index.mjs";

test(
  "exact deferred recovery pays back measured bytes into the existing savings ledger",
  () => {
    const retrieval =
      new PersistentLexicalIndex({
        path: ":memory:",
      });

    try {
      const content =
        [
          "frog-runtime-snapshot\n",
          ...Array.from(
            { length: 180 },
            (_, index) =>
              `row=${index} price=${2500 + index} evidence=exact-${index}\n`
          ),
        ].join("");

      const routed =
        prepareToolOutputIngress({
          retrieval,
          toolName: "market_news",
          toolCallId:
            "frog-session:run-7:call-3",
          content,
          classification:
            ContextClass.BULK_MATERIAL,
          metadata: {
            sessionId: "frog-session",
            provenanceClass: "TOOL_OUTPUT",
          },
          maxInlineBytes: 256,
          previewBytes: 96,
          maxChunkBytes: 256,
        });

      assert.equal(
        routed.mode,
        "DEFERRED"
      );

      const exact =
        resolveContextReference({
          retrieval,
          reference:
            routed.modelText,
        });

      // Merely resolving does not manufacture a context debit.
      assert.equal(
        "receipt" in exact,
        false
      );

      const debit =
        buildContextReferenceRecoveryDebitReceipt(
          exact,
          {
            eventId:
              "frog-session:recovery:1",
            observedAt:
              "2026-09-21T13:30:00Z",
          }
        );

      assert.equal(
        debit.kind,
        "CONTEXT_REFERENCE_RECOVERY_DEBIT_RECEIPT"
      );
      assert.equal(
        debit.sourceId,
        routed.sourceId
      );
      assert.equal(
        debit.sourceContentDigest,
        routed.ingress.sourceContentDigest
      );
      assert.equal(
        debit.returnedContentDigest,
        routed.ingress.sourceContentDigest
      );
      assert.equal(
        debit.returnedBytes,
        routed.rawBytes
      );
      assert.equal(
        verifyContextReferenceRecoveryDebitReceipt(
          exact,
          debit
        ),
        true
      );

      const ledger =
        buildContextSessionSavingsLedger({
          scopeId:
            "frog-session",
          ingressReceipts: [
            routed.receipt,
          ],
          retrievalReceipts: [
            debit,
          ],
        });

      assert.equal(
        ledger.grossBytesAvoided,
        routed.bytesAvoided
      );
      assert.equal(
        ledger.retrievalBytes,
        routed.rawBytes
      );

      // Full exact recovery after diversion is not fictional savings:
      // raw-model credit minus raw recovery debit == model-reference overhead.
      assert.equal(
        ledger.netBytesAvoided,
        0
      );
      assert.equal(
        ledger.netBytesAdded,
        routed.modelBytes
      );
      assert.equal(
        verifyContextSavingsLedger(
          ledger
        ),
        true
      );

      const report =
        buildContextSavingsReport({
          ledger,
          ingressReceipts: [
            routed.receipt,
          ],
          retrievalReceipts: [
            debit,
          ],
        });

      assert.equal(
        report.status,
        "ADDED_BYTES"
      );
      assert.equal(
        report.retrievalBytes,
        routed.rawBytes
      );
      assert.equal(
        report.netBytesAdded,
        routed.modelBytes
      );
      assert.equal(
        report.retrievalBasis,
        "PROOF_CARRYING_CONTEXT_RETURN_DEBITS"
      );
      assert.equal(
        report.netBasis,
        "GROSS_DIVERSION_MINUS_CONTEXT_RETURN_DEBIT"
      );
      assert.equal(
        verifyContextSavingsReport(
          report
        ),
        true
      );
    } finally {
      retrieval.close();
    }
  }
);

test(
  "reference recovery debit fails closed on recovered-content or receipt drift",
  () => {
    const retrieval =
      new PersistentLexicalIndex({
        path: ":memory:",
      });

    try {
      const routed =
        prepareToolOutputIngress({
          retrieval,
          toolName: "journal_read",
          toolCallId:
            "frog-session:run-8:call-2",
          content:
            "historical exact recovery ".repeat(500),
          classification:
            ContextClass.RETRIEVABLE_KNOWLEDGE,
          metadata: {
            sessionId: "frog-session",
          },
          maxInlineBytes: 128,
          previewBytes: 48,
          maxChunkBytes: 256,
        });

      const exact =
        resolveContextReference({
          retrieval,
          reference:
            routed.modelText,
        });

      const debit =
        buildContextReferenceRecoveryDebitReceipt(
          exact
        );

      assert.throws(
        () =>
          buildContextReferenceRecoveryDebitReceipt({
            ...exact,
            content:
              `${exact.content}drift`,
          }),
        /byte measurement mismatch|content digest mismatch/
      );

      assert.throws(
        () =>
          verifyContextReferenceRecoveryDebitReceipt(
            exact,
            {
              ...debit,
              returnedBytes:
                debit.returnedBytes + 1,
            }
          ),
        /verification failed/
      );

      assert.throws(
        () =>
          buildContextSessionSavingsLedger({
            scopeId:
              "frog-session:tamper",
            retrievalReceipts: [
              {
                ...debit,
                returnedContentDigest:
                  "0".repeat(64),
              },
            ],
          }),
        /content digest mismatch|receipt digest mismatch/
      );
    } finally {
      retrieval.close();
    }
  }
);
