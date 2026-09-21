import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite");

import {
  ContextClass,
  LexicalIndex,
  PersistentLexicalIndex,
} from "../src/index.mjs";

function add(index, sourceId, content, metadata = {}) {
  return index.addSource({
    sourceId,
    content,
    classification:
      ContextClass.RETRIEVABLE_KNOWLEDGE,
    metadata,
  });
}

test("exact search remains the unchanged default surface", () => {
  const index = new LexicalIndex();
  add(index, "exact-default", "alpha beta gamma");

  const result = index.search("alpha");

  assert.equal(result.results.length, 1);
  assert.equal("recall" in result, false);
  assert.equal("matchKind" in result.results[0], false);
});

test("tiered recall keeps exact matches ahead of every derived lane", () => {
  const index = new LexicalIndex();

  add(index, "exact", "resume");
  add(index, "identifier", "buildResumePacket");

  const result = index.search("resume", {
    recall: "tiered",
  });

  assert.equal(result.recall, "tiered");
  assert.equal(result.results.length, 2);
  assert.equal(result.results[0].sourceId, "exact");
  assert.equal(result.results[0].matchKind, "EXACT");
  assert.equal(result.results[1].sourceId, "identifier");
  assert.equal(result.results[1].matchKind, "IDENTIFIER");
});

test("identifier recall finds camelCase and snake_case segments", () => {
  const index = new LexicalIndex();

  add(index, "camel", "call buildResumePacket after restore");
  add(index, "snake", "call build_resume_packet after restore");

  const result = index.search("resume", {
    recall: "tiered",
  });

  assert.deepEqual(
    result.results.map(item => item.matchKind),
    ["IDENTIFIER", "IDENTIFIER"]
  );
  assert.deepEqual(
    result.results.map(item => item.sourceId).sort(),
    ["camel", "snake"]
  );
});

test("full snake_case query matches equivalent camelCase identifier", () => {
  const index = new LexicalIndex();

  add(index, "camel", "buildResumePacket");

  const result = index.search(
    "build_resume_packet",
    {
      recall: "tiered",
      match: "all",
    }
  );

  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].sourceId, "camel");
  assert.equal(result.results[0].matchKind, "IDENTIFIER");
});

test("full camelCase query matches equivalent snake_case identifier", () => {
  const index = new LexicalIndex();

  add(index, "snake", "build_resume_packet");

  const result = index.search(
    "buildResumePacket",
    {
      recall: "tiered",
      match: "all",
    }
  );

  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].sourceId, "snake");
  assert.equal(result.results[0].matchKind, "IDENTIFIER");
});

test("mixed ordinary terms and cross-style identifier parts preserve all semantics", () => {
  const index = new LexicalIndex();

  add(
    index,
    "complete",
    "urgent buildResumePacket"
  );
  add(
    index,
    "missing-ordinary",
    "buildResumePacket"
  );

  const result = index.search(
    "urgent build_resume_packet",
    {
      recall: "tiered",
      match: "all",
    }
  );

  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].sourceId, "complete");
  assert.equal(result.results[0].matchKind, "IDENTIFIER");
});

test("conservative morphology links running and runs through one derived key", () => {
  const index = new LexicalIndex();

  add(index, "runner", "workers are running safely");

  const result = index.search("runs", {
    recall: "tiered",
  });

  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].sourceId, "runner");
  assert.equal(result.results[0].matchKind, "MORPHOLOGY");
});

test("substring fallback is restricted to structured identifiers", () => {
  const index = new LexicalIndex();

  add(index, "structured", "loadContextContinuityPacket");
  add(index, "ordinary", "continuity appears only as ordinary prose");

  const result = index.search("continu", {
    recall: "tiered",
  });

  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].sourceId, "structured");
  assert.equal(result.results[0].matchKind, "SUBSTRING");
});

test("substring fallback cannot stitch trigrams across separate identifiers", () => {
  const index = new LexicalIndex();

  add(
    index,
    "fragment-stitch",
    "connectValue textPacket"
  );

  const result = index.search("context", {
    recall: "tiered",
  });

  assert.equal(result.results.length, 0);
});

test("substring fallback supports normalized partial structured queries", () => {
  const index = new LexicalIndex();

  add(
    index,
    "camel",
    "buildResumePacket"
  );

  const result = index.search(
    "resume_pack",
    {
      recall: "tiered",
      match: "all",
    }
  );

  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].sourceId, "camel");
  assert.equal(result.results[0].matchKind, "SUBSTRING");
});

test("multi-term all semantics remain strict inside derived recall", () => {
  const index = new LexicalIndex();

  add(index, "complete", "buildResumePacket restoreSessionState");
  add(index, "partial", "buildResumePacket only");

  const result = index.search(
    "resume session",
    {
      recall: "tiered",
      match: "all",
    }
  );

  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].sourceId, "complete");
  assert.equal(result.results[0].matchKind, "IDENTIFIER");
});

test("persistent tiered recall matches in-memory results across reopen", () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "context-core-tiered-")
  );
  const dbPath = path.join(root, "context.sqlite");
  const memory = new LexicalIndex();
  let persistent;

  try {
    persistent =
      new PersistentLexicalIndex({ path: dbPath });

    const docs = [
      ["exact", "resume"],
      ["identifier", "buildResumePacket"],
      ["morphology", "workers are running"],
      ["substring", "loadContextContinuityPacket"],
    ];

    for (const [sourceId, content] of docs) {
      add(memory, sourceId, content, {
        sessionId: "tiered",
      });
      add(persistent, sourceId, content, {
        sessionId: "tiered",
      });
    }

    for (const query of ["resume", "runs", "continu"]) {
      const expected =
        memory
          .search(query, {
            recall: "tiered",
          })
          .results
          .map(item => [
            item.sourceId,
            item.matchKind,
          ]);

      const actual =
        persistent
          .search(query, {
            recall: "tiered",
            metadataEquals: {
              sessionId: "tiered",
            },
          })
          .results
          .map(item => [
            item.sourceId,
            item.matchKind,
          ]);

      assert.deepEqual(actual, expected);
    }

    persistent.close();
    persistent = undefined;

    persistent =
      new PersistentLexicalIndex({ path: dbPath });

    const reopened =
      persistent.search("continu", {
        recall: "tiered",
        metadataEquals: {
          sessionId: "tiered",
        },
      });

    assert.equal(
      reopened.results[0].matchKind,
      "SUBSTRING"
    );
  } finally {
    try {
      persistent?.close();
    } catch {}
    fs.rmSync(root, {
      recursive: true,
      force: true,
    });
  }
});

test("persistent tiered recall keeps metadata isolation exact", () => {
  const index =
    new PersistentLexicalIndex({
      path: ":memory:",
    });

  try {
    add(index, "session-a", "buildResumePacket", {
      sessionId: "a",
    });
    add(index, "session-b", "buildResumePacket", {
      sessionId: "b",
    });

    const result =
      index.search("resume", {
        recall: "tiered",
        metadataEquals: {
          sessionId: "a",
        },
      });

    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].sourceId, "session-a");
  } finally {
    index.close();
  }
});

test("persistent tiered recall bounds relevant candidate work rather than total stored history", () => {
  const index =
    new PersistentLexicalIndex({
      path: ":memory:",
    });

  try {
    add(index, "one", "buildResumePacket");
    add(index, "two", "restoreSessionState");

    const result =
      index.search("resume", {
        recall: "tiered",
        maxRecallScanChunks: 1,
      });

    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].sourceId, "one");
    assert.equal(
      result.results[0].matchKind,
      "IDENTIFIER"
    );
  } finally {
    index.close();
  }
});

test("persistent tiered recall uses the candidate index while exact search still fails closed on FTS corruption", () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "context-core-tiered-candidate-vs-fts-")
  );
  const dbPath = path.join(root, "context.sqlite");
  let index;

  try {
    index = new PersistentLexicalIndex({ path: dbPath });
    add(index, "one", "buildResumePacket");
    add(index, "two", "restoreSessionState");
    index.close();
    index = undefined;

    const db = new DatabaseSync(dbPath);
    db.prepare(`
      DELETE FROM chunks_fts
      WHERE chunk_id = (
        SELECT chunk_id
        FROM chunks
        WHERE source_id = 'two'
        LIMIT 1
      )
    `).run();
    db.close();

    index = new PersistentLexicalIndex({ path: dbPath });

    const tiered =
      index.search("resume", {
        recall: "tiered",
        maxRecallScanChunks: 1,
      });

    assert.equal(tiered.results.length, 1);
    assert.equal(tiered.results[0].sourceId, "one");

    assert.throws(
      () => index.search("resume"),
      /FTS index integrity mismatch/
    );
  } finally {
    try {
      index?.close();
    } catch {}
    fs.rmSync(root, {
      recursive: true,
      force: true,
    });
  }
});

test("tiered recall still obeys serialized response byte budgets", () => {
  const index = new LexicalIndex();

  add(
    index,
    "identifier",
    `buildResumePacket ${"x".repeat(1000)}`
  );

  const result = index.search("resume", {
    recall: "tiered",
    maxBytes: 512,
  });

  const encoded =
    Buffer.byteLength(
      JSON.stringify(result),
      "utf8"
    );

  assert.ok(encoded <= 512);
  assert.equal(result.usedBytes, encoded);
});
