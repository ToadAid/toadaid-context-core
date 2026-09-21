#!/usr/bin/env node
import { pathToFileURL } from "node:url";

import {
  ContextClass,
  PersistentLexicalIndex,
  contextCoreCapabilities,
  prepareToolOutputIngress,
  verifyContextIngressReceipt,
} from "../src/index.mjs";

export function runToolOutputIngressExample() {
  const retrieval = new PersistentLexicalIndex({
    path: ":memory:",
  });

  try {
    const needle = "TOADAID-DEMO-NEEDLE-424242";

    // The host owns the real tool result, including trusted structured data.
    // Only result.text is passed into Context Core.
    const hostResult = Object.freeze({
      text: [
        "workspace_read output",
        "x".repeat(9000),
        needle,
      ].join("\n"),
      data: Object.freeze({
        path: "src/agent.mjs",
        trustedByHost: true,
      }),
    });

    const readonlyRoute = prepareToolOutputIngress({
      retrieval,
      toolName: "workspace_read",
      toolCallId: "demo-session:demo-run:provider-call-1",
      content: hostResult.text,
      metadata: {
        sessionId: "demo-session",
        runId: "demo-run",
      },
      maxInlineBytes: 1024,
      previewBytes: 192,
      maxChunkBytes: 2048,
    });

    verifyContextIngressReceipt(
      readonlyRoute.ingress,
      readonlyRoute.receipt,
    );

    const reference = JSON.parse(readonlyRoute.modelText);

    const recovered = retrieval.search(
      "TOADAID DEMO NEEDLE 424242",
      {
        recall: "tiered",
        maxResults: 4,
        maxBytes: 4096,
        metadataEquals: {
          sessionId: "demo-session",
          sourceKind: "tool-result",
          toolName: "workspace_read",
          toolCallId: "demo-session:demo-run:provider-call-1",
        },
      },
    );

    const exactText =
      `approval-receipt:${"A".repeat(5000)}`;

    const exactRoute = prepareToolOutputIngress({
      retrieval,
      toolName: "approval_decision",
      toolCallId: "demo-session:demo-run:approval-1",
      content: exactText,
      classification: ContextClass.EXACT_EVIDENCE,
      maxInlineBytes: 64,
      previewBytes: 16,
    });

    verifyContextIngressReceipt(
      exactRoute.ingress,
      exactRoute.receipt,
    );

    return Object.freeze({
      readonlyToolOutput: Object.freeze({
        mode: readonlyRoute.mode,
        rawBytes: readonlyRoute.rawBytes,
        modelBytes: readonlyRoute.modelBytes,
        bytesAvoided: readonlyRoute.bytesAvoided,
        referenceKind: reference.kind,
        omittedDetailRecovered:
          recovered.results.some((item) =>
            item.content.includes(needle),
          ),
      }),
      exactEvidence: Object.freeze({
        mode: exactRoute.mode,
        byteIdentical: exactRoute.modelText === exactText,
        bytesAvoided: exactRoute.bytesAvoided,
      }),
      hostStructuredData: Object.freeze({
        preserved: hostResult.data.trustedByHost === true,
        path: hostResult.data.path,
      }),
      capabilities: contextCoreCapabilities(),
    });
  } finally {
    retrieval.close();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  console.log(
    JSON.stringify(
      runToolOutputIngressExample(),
      null,
      2,
    ),
  );
}
