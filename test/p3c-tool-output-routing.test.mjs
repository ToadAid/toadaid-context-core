import test from "node:test";
import assert from "node:assert/strict";

import {
  ContextClass,
  PersistentLexicalIndex,
  contextCoreCapabilities,
  prepareToolOutputIngress,
  verifyContextIngressReceipt,
} from "../src/index.mjs";

test("P3C-P1 routes a real oversized textual tool result through canonical ingress and keeps omitted detail retrievable", () => {
  const retrieval =
    new PersistentLexicalIndex({
      path: ":memory:",
    });

  try {
    const tail =
      "TOOL-TAIL-NEEDLE-314159";

    const content = [
      "filesystem read output",
      "x".repeat(9000),
      tail,
    ].join("\n");

    const routed =
      prepareToolOutputIngress({
        retrieval,
        toolName:
          "workspace_read",
        toolCallId:
          "call-read-314159",
        content,
        metadata: {
          sessionId:
            "frog-p3c",
        },
        maxInlineBytes: 1024,
        previewBytes: 192,
        eventId:
          "evt-tool-314159",
        observedAt:
          "2026-09-20T18:00:00Z",
      });

    assert.equal(
      routed.kind,
      "TOOL_OUTPUT_INGRESS"
    );
    assert.equal(
      routed.mode,
      "DEFERRED"
    );
    assert.equal(
      routed.ingress.reason,
      "OVER_INLINE_BUDGET_INDEXED"
    );
    assert.equal(
      routed.modelText,
      routed.ingress.contextText
    );
    assert.equal(
      routed.modelBytes,
      Buffer.byteLength(
        routed.modelText,
        "utf8"
      )
    );
    assert.equal(
      routed.bytesAvoided,
      routed.rawBytes -
        routed.modelBytes
    );
    assert.doesNotMatch(
      routed.modelText,
      /TOOL-TAIL-NEEDLE/
    );

    assert.equal(
      verifyContextIngressReceipt(
        routed.ingress,
        routed.receipt
      ),
      true
    );
    assert.equal(
      routed.receipt.bytesAvoided,
      routed.bytesAvoided
    );

    const parsed =
      JSON.parse(
        routed.modelText
      );

    assert.equal(
      parsed.kind,
      "CONTEXT_REFERENCE"
    );
    assert.equal(
      parsed.sourceId,
      routed.sourceId
    );

    const recovered =
      retrieval.search(
        "TOOL TAIL NEEDLE 314159",
        {
          maxResults: 4,
          maxBytes: 4096,
          metadataEquals: {
            sessionId:
              "frog-p3c",
            sourceKind:
              "tool-result",
            toolName:
              "workspace_read",
            toolCallId:
              "call-read-314159",
          },
        }
      );

    assert.ok(
      recovered.results.some(
        item =>
          item.content.includes(
            tail
          )
      )
    );
  } finally {
    retrieval.close();
  }
});

test("P3C-P1 keeps oversized exact-evidence tool output byte-identical inline and gives it zero savings credit", () => {
  const content =
    "MERGE-SHA-EXACT-".repeat(1000);

  const retrieval = {
    addSource() {
      throw new Error(
        "exact evidence must never be indexed"
      );
    },
  };

  const routed =
    prepareToolOutputIngress({
      retrieval,
      toolName:
        "github_merge",
      toolCallId:
        "merge-call-21",
      content,
      classification:
        ContextClass.EXACT_EVIDENCE,
      maxInlineBytes: 64,
      previewBytes: 16,
    });

  assert.equal(
    routed.mode,
    "INLINE"
  );
  assert.equal(
    routed.reason,
    "EXACT_EVIDENCE_MUST_REMAIN_EXACT"
  );
  assert.equal(
    routed.modelText,
    content
  );
  assert.equal(
    routed.modelBytes,
    routed.rawBytes
  );
  assert.equal(
    routed.bytesAvoided,
    0
  );
  assert.equal(
    routed.receipt.bytesAvoided,
    0
  );
  assert.equal(
    routed.ingress.sourceRef,
    null
  );
});

test("P3C-P1 small tool output stays inline and cannot manufacture savings credit", () => {
  const content =
    "status: healthy";

  const routed =
    prepareToolOutputIngress({
      toolName:
        "doctor",
      toolCallId:
        "doctor-1",
      content,
      maxInlineBytes: 4096,
    });

  assert.equal(
    routed.mode,
    "INLINE"
  );
  assert.equal(
    routed.reason,
    "WITHIN_INLINE_BUDGET"
  );
  assert.equal(
    routed.modelText,
    content
  );
  assert.equal(
    routed.bytesAvoided,
    0
  );
  assert.equal(
    routed.receipt.bytesAvoided,
    0
  );
});

test("P3C-P1 refuses structured host data instead of silently stringifying it into model context", () => {
  assert.throws(
    () =>
      prepareToolOutputIngress({
        toolName:
          "portfolio_snapshot",
        toolCallId:
          "portfolio-1",
        content: {
          trusted:
            "host-owned-data",
        },
      }),
    /content must be a string containing the exact model-bound tool output/
  );
});

test("P3C-P1 refuses caller attempts to rebind canonical tool provenance metadata", () => {
  assert.throws(
    () =>
      prepareToolOutputIngress({
        toolName:
          "workspace_read",
        toolCallId:
          "call-1",
        content:
          "hello",
        metadata: {
          toolName:
            "different_tool",
        },
      }),
    /metadata toolName conflicts with canonical tool-output provenance/
  );

  assert.throws(
    () =>
      prepareToolOutputIngress({
        toolName:
          "workspace_read",
        toolCallId:
          "call-1",
        content:
          "hello",
        metadata: {
          sourceKind:
            "something-else",
        },
      }),
    /metadata sourceKind conflicts with canonical tool-output provenance/
  );
});

test("P3C-P1 tool-output source identity binds both call identity and exact textual output", () => {
  const retrieval =
    new PersistentLexicalIndex({
      path: ":memory:",
    });

  try {
    const firstContent =
      "first content ".repeat(700);

    const first =
      prepareToolOutputIngress({
        retrieval,
        toolName:
          "workspace_read",
        toolCallId:
          "stable-call",
        content:
          firstContent,
        maxInlineBytes: 64,
        previewBytes: 16,
      });

    const same =
      prepareToolOutputIngress({
        retrieval,
        toolName:
          "workspace_read",
        toolCallId:
          "stable-call",
        content:
          firstContent,
        maxInlineBytes: 64,
        previewBytes: 16,
      });

    const different =
      prepareToolOutputIngress({
        retrieval,
        toolName:
          "workspace_read",
        toolCallId:
          "stable-call",
        content:
          "different content ".repeat(700),
        maxInlineBytes: 64,
        previewBytes: 16,
      });

    assert.equal(
      first.sourceId,
      same.sourceId
    );

    assert.equal(
      first.ingress.sourceContentDigest,
      same.ingress.sourceContentDigest
    );

    assert.notEqual(
      first.ingress.sourceContentDigest,
      different.ingress.sourceContentDigest
    );

    assert.notEqual(
      first.sourceId,
      different.sourceId
    );
  } finally {
    retrieval.close();
  }
});

test("P3C-P1 inline output cannot share one source identity across different bytes", () => {
  const first =
    prepareToolOutputIngress({
      toolName:
        "doctor",
      toolCallId:
        "same-inline-call",
      content:
        "status: healthy",
      maxInlineBytes: 4096,
    });

  const second =
    prepareToolOutputIngress({
      toolName:
        "doctor",
      toolCallId:
        "same-inline-call",
      content:
        "status: compromised",
      maxInlineBytes: 4096,
    });

  assert.notEqual(
    first.ingress.sourceContentDigest,
    second.ingress.sourceContentDigest
  );

  assert.notEqual(
    first.sourceId,
    second.sourceId
  );
});

test("P3C-P1 remains a zero-authority context adapter", () => {
  const caps =
    contextCoreCapabilities();

  for (const key of [
    "modelCalls",
    "arbitraryCodeExecution",
    "shellExecution",
    "networkAccess",
    "authorityGrants",
    "durableMemoryWrites",
    "walletAccess",
    "tradeExecution",
    "gitWrite",
  ]) {
    assert.equal(
      caps[key],
      false
    );
  }
});
