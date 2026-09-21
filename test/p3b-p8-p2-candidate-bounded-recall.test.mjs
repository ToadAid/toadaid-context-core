import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require =
  createRequire(import.meta.url);
const { DatabaseSync } =
  require("node:sqlite");

import {
  ContextClass,
  LexicalIndex,
  PersistentLexicalIndex,
  contextCoreCapabilities,
} from "../src/index.mjs";

function add(
  index,
  sourceId,
  content,
  metadata = {}
) {
  return index.addSource({
    sourceId,
    content,
    classification:
      ContextClass.RETRIEVABLE_KNOWLEDGE,
    metadata,
  });
}

function withDb(t, fn) {
  const root =
    fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "context-core-p8-p2-"
      )
    );

  const dbPath =
    path.join(
      root,
      "context.sqlite"
    );

  t.after(() => {
    fs.rmSync(root, {
      recursive: true,
      force: true,
    });
  });

  return fn(dbPath);
}

function publicBytes(value) {
  return JSON.stringify(value);
}

test("P8-P2 candidate-bounded persistent recall is byte-for-byte equivalent to the full-corpus scorer oracle", t =>
  withDb(t, dbPath => {
    const memory =
      new LexicalIndex();

    const persistent =
      new PersistentLexicalIndex({
        path: dbPath,
      });

    t.after(() => {
      persistent.close();
    });

    const docs = [
      ["exact", "resume"],
      ["identifier", "buildResumePacket"],
      ["snake", "build_resume_packet"],
      ["morphology", "workers are running safely"],
      ["substring", "loadContextContinuityPacket"],
      ["dense", "resume resume restore"],
      ["other", "unrelated alpha beta gamma"],
    ];

    for (
      const [sourceId, content]
      of docs
    ) {
      add(
        memory,
        sourceId,
        content
      );
      add(
        persistent,
        sourceId,
        content
      );
    }

    const cases = [
      ["resume", { match: "all" }],
      ["runs", { match: "all" }],
      ["continu", { match: "all" }],
      ["build_resume_packet", { match: "all" }],
      ["resume packet", { match: "any" }],
    ];

    for (
      const [query, options]
      of cases
    ) {
      const expected =
        memory.search(
          query,
          {
            recall: "tiered",
            maxBytes: 65536,
            maxResults: 100,
            maxRecallScanChunks:
              100,
            ...options,
          }
        );

      const actual =
        persistent.search(
          query,
          {
            recall: "tiered",
            maxBytes: 65536,
            maxResults: 100,
            maxRecallScanChunks:
              100,
            ...options,
          }
        );

      assert.equal(
        publicBytes(actual),
        publicBytes(expected),
        `public bytes drifted for ${query}`
      );
    }
  })
);

test("P8-P2 metadata-scoped corpus statistics preserve byte-equivalent ranking", t =>
  withDb(t, dbPath => {
    const memoryA =
      new LexicalIndex();

    const persistent =
      new PersistentLexicalIndex({
        path: dbPath,
      });

    t.after(() => {
      persistent.close();
    });

    const sessionA = [
      ["a-exact", "resume"],
      ["a-identifier", "buildResumePacket"],
      ["a-dense", "resume resume restore"],
      ["a-noise", "unrelated alpha"],
    ];

    for (
      const [sourceId, content]
      of sessionA
    ) {
      add(
        memoryA,
        sourceId,
        content,
        { sessionId: "a" }
      );

      add(
        persistent,
        sourceId,
        content,
        { sessionId: "a" }
      );
    }

    for (let i = 0; i < 12; i += 1) {
      add(
        persistent,
        `b-${i}`,
        i % 2 === 0
          ? "resume resume resume"
          : "buildResumePacket",
        { sessionId: "b" }
      );
    }

    const expected =
      memoryA.search(
        "resume",
        {
          recall: "tiered",
          maxBytes: 65536,
          maxResults: 100,
          maxRecallScanChunks:
            100,
        }
      );

    const actual =
      persistent.search(
        "resume",
        {
          recall: "tiered",
          metadataEquals: {
            sessionId: "a",
          },
          maxBytes: 65536,
          maxResults: 100,
          maxRecallScanChunks: 4,
        }
      );

    assert.equal(
      publicBytes(actual),
      publicBytes(expected)
    );
  })
);

test("P8-P2 maxRecallScanChunks bounds candidate work rather than total stored history", t =>
  withDb(t, dbPath => {
    const index =
      new PersistentLexicalIndex({
        path: dbPath,
      });

    t.after(() => {
      index.close();
    });

    for (let i = 0; i < 96; i += 1) {
      add(
        index,
        `noise-${i}`,
        `unrelated ledger observation alpha${i}`
      );
    }

    add(
      index,
      "target",
      "buildResumePacket"
    );

    const result =
      index.search(
        "resume",
        {
          recall: "tiered",
          maxRecallScanChunks: 1,
          maxBytes: 65536,
        }
      );

    assert.equal(
      result.results.length,
      1
    );
    assert.equal(
      result.results[0].sourceId,
      "target"
    );
    assert.equal(
      result.results[0].matchKind,
      "IDENTIFIER"
    );
  })
);

test("P8-P2 refuses candidate work above maxRecallScanChunks instead of silently truncating", () => {
  const index =
    new PersistentLexicalIndex({
      path: ":memory:",
    });

  try {
    add(index, "one", "buildResumePacket");
    add(index, "two", "buildResumePacket");
    add(index, "three", "buildResumePacket");

    assert.throws(
      () =>
        index.search(
          "resume",
          {
            recall: "tiered",
            maxRecallScanChunks: 2,
          }
        ),
      /candidate work exceeds maxRecallScanChunks 2/
    );
  } finally {
    index.close();
  }
});

test("P8-P2 substring fragment postings remain a candidate superset and cannot create a stitched false positive", t =>
  withDb(t, dbPath => {
    const index =
      new PersistentLexicalIndex({
        path: dbPath,
      });

    t.after(() => {
      index.close();
    });

    add(
      index,
      "fragment-superset",
      "conValue ontValue nteValue texValue extValue"
    );

    const db =
      new DatabaseSync(dbPath);

    const row =
      db.prepare(`
        SELECT c.chunk_id
        FROM chunks AS c
        WHERE c.source_id =
          'fragment-superset'
      `).get();

    const fragments =
      db.prepare(`
        SELECT term
        FROM recall_candidate_terms
        WHERE
          chunk_id = ?
          AND lane =
            'SUBSTRING_FRAGMENT'
      `)
      .all(row.chunk_id)
      .map(item => item.term);

    db.close();

    for (const term of [
      "con",
      "ont",
      "nte",
      "tex",
      "ext",
    ]) {
      assert.ok(
        fragments.includes(term),
        `missing expected candidate fragment ${term}`
      );
    }

    const result =
      index.search(
        "context",
        {
          recall: "tiered",
          maxRecallScanChunks: 1,
        }
      );

    assert.equal(
      result.results.length,
      0
    );
  })
);

test("P8-P2 leaves exact-search FTS integrity behavior unchanged", t =>
  withDb(t, dbPath => {
    let index =
      new PersistentLexicalIndex({
        path: dbPath,
      });

    add(
      index,
      "exact",
      "alpha beta gamma"
    );

    index.close();

    const db =
      new DatabaseSync(dbPath);

    db.exec(
      "DELETE FROM chunks_fts"
    );

    db.close();

    index =
      new PersistentLexicalIndex({
        path: dbPath,
      });

    t.after(() => {
      index.close();
    });

    assert.throws(
      () =>
        index.search("alpha"),
      /FTS index integrity mismatch/
    );
  })
);

test("P8-P2 preserves the zero-authority boundary", () => {
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


test("P8-P2 refuses post-open partial posting mutation before corpus statistics can be consumed", t =>
  withDb(t, dbPath => {
    const index =
      new PersistentLexicalIndex({
        path: dbPath,
      });

    t.after(() => {
      index.close();
    });

    add(index, "winner", "alpha beta");
    add(index, "partial", "alpha gamma");
    add(index, "noise", "delta epsilon");

    const baseline =
      index.search(
        "alpha beta",
        {
          recall: "tiered",
          match: "all",
          maxRecallScanChunks: 1,
          maxBytes: 65536,
        }
      );

    assert.equal(
      baseline.results.length,
      1
    );

    const db =
      new DatabaseSync(dbPath);

    const partialChunk =
      db.prepare(`
        SELECT chunk_id
        FROM chunks
        WHERE source_id = 'partial'
      `).get().chunk_id;

    db.prepare(`
      DELETE FROM recall_candidate_terms
      WHERE
        chunk_id = ?
        AND lane = 'EXACT'
        AND term = 'alpha'
    `).run(partialChunk);

    db.close();

    assert.throws(
      () =>
        index.search(
          "alpha beta",
          {
            recall: "tiered",
            match: "all",
            maxRecallScanChunks: 1,
            maxBytes: 65536,
          }
        ),
      /integrity epoch changed outside this index/
    );
  })
);

test("P8-P2 refuses post-open non-candidate token-count mutation before exact-lane statistics can be consumed", t =>
  withDb(t, dbPath => {
    const index =
      new PersistentLexicalIndex({
        path: dbPath,
      });

    t.after(() => {
      index.close();
    });

    add(index, "winner", "alpha beta");
    add(
      index,
      "noise",
      "delta epsilon zeta eta theta"
    );

    const baseline =
      index.search(
        "alpha beta",
        {
          recall: "tiered",
          match: "all",
          maxRecallScanChunks: 1,
          maxBytes: 65536,
        }
      );

    assert.equal(
      baseline.results.length,
      1
    );

    const db =
      new DatabaseSync(dbPath);

    db.prepare(`
      UPDATE chunks
      SET token_count =
        token_count + 100
      WHERE source_id = 'noise'
    `).run();

    db.close();

    assert.throws(
      () =>
        index.search(
          "alpha beta",
          {
            recall: "tiered",
            match: "all",
            maxRecallScanChunks: 1,
            maxBytes: 65536,
          }
        ),
      /integrity epoch changed outside this index/
    );
  })
);

test("P8-P2 retrieval integrity epoch ignores unrelated tables in a shared SQLite file", t =>
  withDb(t, dbPath => {
    const index =
      new PersistentLexicalIndex({
        path: dbPath,
      });

    t.after(() => {
      index.close();
    });

    add(index, "winner", "alpha beta");

    const db =
      new DatabaseSync(dbPath);

    db.exec(`
      CREATE TABLE unrelated_journal_probe (
        id INTEGER PRIMARY KEY,
        payload TEXT NOT NULL
      );

      INSERT INTO unrelated_journal_probe(payload)
      VALUES ('journal-write');
    `);

    db.close();

    const result =
      index.search(
        "alpha beta",
        {
          recall: "tiered",
          match: "all",
          maxRecallScanChunks: 1,
          maxBytes: 65536,
        }
      );

    assert.equal(
      result.results.length,
      1
    );
    assert.equal(
      result.results[0].sourceId,
      "winner"
    );
  })
);
