import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ContextClass,
  PersistentLexicalIndex,
  prepareToolOutputIngress,
  resolveContextReference,
} from "../src/index.mjs";

function fixture() {
  return [
    "market-news-snapshot\n",
    ...Array.from(
      { length: 220 },
      (_, index) =>
        `row=${index} price=${2400 + index} source=fixture exact-line-${index}\n`
    ),
  ].join("");
}

test(
  "deferred tool output resolves byte-identically from its CONTEXT_REFERENCE after reopen",
  () => {
    const root =
      mkdtempSync(
        join(
          tmpdir(),
          "toadaid-context-reference-"
        )
      );
    const path =
      join(root, "retrieval.sqlite");
    const content = fixture();

    let retrieval =
      new PersistentLexicalIndex({
        path,
      });

    try {
      const routed =
        prepareToolOutputIngress({
          retrieval,
          toolName: "market_news",
          toolCallId:
            "session-a:run-1:call-7",
          content,
          classification:
            ContextClass.BULK_MATERIAL,
          metadata: {
            sessionId: "session-a",
            provenanceClass:
              "TOOL_OUTPUT",
          },
          maxInlineBytes: 256,
          previewBytes: 96,
          maxChunkBytes: 256,
        });

      assert.equal(
        routed.mode,
        "DEFERRED"
      );

      const marker =
        JSON.parse(routed.modelText);

      assert.equal(
        marker.kind,
        "CONTEXT_REFERENCE"
      );
      assert.equal(
        marker.sourceId,
        routed.sourceId
      );

      const resolvedLive =
        resolveContextReference({
          retrieval,
          reference:
            routed.modelText,
        });

      assert.equal(
        resolvedLive.content,
        content
      );
      assert.equal(
        Buffer.byteLength(
          resolvedLive.content,
          "utf8"
        ),
        resolvedLive.bytes
      );
      assert.equal(
        resolvedLive.contentDigest,
        marker.contentDigest
      );
      assert.equal(
        resolvedLive.metadata.sourceKind,
        "tool-result"
      );
      assert.equal(
        resolvedLive.metadata.toolName,
        "market_news"
      );
      assert.equal(
        resolvedLive.metadata.toolCallId,
        "session-a:run-1:call-7"
      );

      const exactIdentity = {
        sourceId: marker.sourceId,
        contentDigest:
          marker.contentDigest,
      };

      retrieval.close();

      retrieval =
        new PersistentLexicalIndex({
          path,
        });

      const resolvedAfterReopen =
        retrieval.resolveSourceReference(
          exactIdentity
        );

      assert.equal(
        resolvedAfterReopen.content,
        content
      );
      assert.equal(
        resolvedAfterReopen.contentDigest,
        marker.contentDigest
      );

      assert.throws(
        () =>
          retrieval.resolveSourceReference({
            ...exactIdentity,
            contentDigest:
              "0".repeat(64),
          }),
        /content digest mismatch/
      );

      assert.throws(
        () =>
          resolveContextReference({
            retrieval,
            reference: {
              ...marker,
              rawBytes:
                marker.rawBytes + 1,
            },
          }),
        /raw byte mismatch/
      );

      assert.throws(
        () =>
          resolveContextReference({
            retrieval,
            reference: {
              ...marker,
              classification:
                ContextClass.WORKING_CONTEXT,
            },
          }),
        /classification mismatch/
      );
    } finally {
      try {
        retrieval.close();
      } catch {}
      rmSync(
        root,
        {
          recursive: true,
          force: true,
        }
      );
    }
  }
);
