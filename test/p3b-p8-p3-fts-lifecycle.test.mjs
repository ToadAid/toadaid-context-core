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
  PersistentLexicalIndex,
} from "../src/index.mjs";

function withDb(t, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "context-core-fts-lifecycle-"));
  const dbPath = path.join(root, "context.sqlite");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return fn(dbPath);
}

function add(index, sourceId, content, maxChunkBytes = 2048) {
  return index.addSource({
    sourceId,
    content,
    classification: ContextClass.RETRIEVABLE_KNOWLEDGE,
    maxChunkBytes,
  });
}

function snapshot(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const tables = [
      "sources",
      "chunks",
      "recall_projections",
      "recall_candidate_manifests",
      "recall_candidate_terms",
    ];
    return {
      canonical: Object.fromEntries(tables.map(table => [
        table,
        db.prepare(`SELECT * FROM ${table} ORDER BY rowid ASC`).all(),
      ])),
      fts: db.prepare(`
        SELECT rowid, chunk_id, lexical_text
        FROM chunks_fts
        ORDER BY rowid ASC
      `).all(),
    };
  } finally {
    db.close();
  }
}

function rowsForSource(dbPath, sourceId) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return db.prepare(`
      SELECT f.rowid, f.chunk_id, f.lexical_text
      FROM chunks_fts AS f
      JOIN chunks AS c ON c.chunk_id = f.chunk_id
      WHERE c.source_id = ?
      ORDER BY f.rowid ASC
    `).all(sourceId);
  } finally {
    db.close();
  }
}

test("Core-owned deletion validates source identity before opening a transaction", t => withDb(t, dbPath => {
  const index = new PersistentLexicalIndex({ path: dbPath });
  add(index, "survivor", "surviving evidence");
  const before = snapshot(dbPath);

  for (const sourceId of [undefined, null, "", 0]) {
    assert.throws(
      () => index.deleteSource(sourceId),
      /sourceId must be a non-empty string/
    );
  }

  assert.deepEqual(snapshot(dbPath), before);
  assert.equal(index.search("surviving evidence").results[0].sourceId, "survivor");
  index.close();
}));

test("Core-owned deletion atomically removes every FTS row for a multi-chunk source", t => withDb(t, dbPath => {
  const index = new PersistentLexicalIndex({ path: dbPath });
  const target = add(index, "target", "alpha beta gamma delta ".repeat(80), 96);
  add(index, "survivor", "surviving evidence remains searchable");
  assert.ok(target.chunkCount > 1);

  const survivorBefore = rowsForSource(dbPath, "survivor");
  const report = index.deleteSource("target");

  assert.deepEqual(report, {
    sourceId: "target",
    sourceDeleted: true,
    chunksRemoved: target.chunkCount,
    ftsRowsRemoved: target.chunkCount,
  });
  assert.deepEqual(rowsForSource(dbPath, "survivor"), survivorBefore);
  assert.equal(index.search("surviving evidence").results[0].sourceId, "survivor");
  index.close();

  const reopened = new PersistentLexicalIndex({ path: dbPath });
  try {
    assert.equal(reopened.search("surviving evidence").results[0].sourceId, "survivor");
    assert.equal(reopened.search("alpha beta gamma delta").results.length, 0);
  } finally {
    reopened.close();
  }
}));

for (const [label, corrupt, pattern] of [
  ["missing FTS row", db => db.prepare("DELETE FROM chunks_fts WHERE rowid = (SELECT min(rowid) FROM chunks_fts)").run(), /row count differs/],
  ["duplicate FTS row", db => db.exec("INSERT INTO chunks_fts(chunk_id, lexical_text) SELECT chunk_id, lexical_text FROM chunks_fts ORDER BY rowid ASC LIMIT 1"), /row count differs/],
  ["altered lexical payload", db => db.prepare("UPDATE chunks_fts SET lexical_text = lexical_text || ? WHERE rowid = (SELECT min(rowid) FROM chunks_fts)").run(" forged"), /FTS index integrity mismatch for/],
]) {
  test(`Core-owned deletion refuses a pre-existing ${label}`, t => withDb(t, dbPath => {
    let index = new PersistentLexicalIndex({ path: dbPath });
    add(index, "target", "target evidence");
    add(index, "survivor", "survivor evidence");
    index.close();

    const db = new DatabaseSync(dbPath);
    corrupt(db);
    db.close();
    const before = snapshot(dbPath);

    index = new PersistentLexicalIndex({ path: dbPath });
    try {
      assert.throws(() => index.deleteSource("target"), pattern);
    } finally {
      index.close();
    }
    assert.deepEqual(snapshot(dbPath), before);
  }));
}

test("ordinary search still refuses an orphan FTS row", t => withDb(t, dbPath => {
  let index = new PersistentLexicalIndex({ path: dbPath });
  add(index, "canonical", "canonical evidence");
  index.close();

  const db = new DatabaseSync(dbPath);
  db.prepare("INSERT INTO chunks_fts(chunk_id, lexical_text) VALUES (?, ?)")
    .run("orphan:0", "t6f727068616e");
  db.close();

  index = new PersistentLexicalIndex({ path: dbPath });
  try {
    assert.throws(() => index.search("canonical"), /row count differs/);
  } finally {
    index.close();
  }
}));

test("Core-owned deletion rolls back FTS removal when canonical deletion fails", t => withDb(t, dbPath => {
  let index = new PersistentLexicalIndex({ path: dbPath });
  add(index, "target", "target evidence ".repeat(40), 96);
  add(index, "survivor", "survivor evidence");
  index.close();

  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TRIGGER forced_source_delete_failure
    BEFORE DELETE ON sources
    WHEN OLD.source_id = 'target'
    BEGIN
      SELECT RAISE(ABORT, 'forced source deletion failure');
    END
  `);
  db.close();
  const before = snapshot(dbPath);

  index = new PersistentLexicalIndex({ path: dbPath });
  try {
    assert.throws(() => index.deleteSource("target"), /forced source deletion failure/);
    assert.equal(index.search("target evidence").results[0].sourceId, "target");
  } finally {
    index.close();
  }
  assert.deepEqual(snapshot(dbPath), before);
}));

test("explicit orphan maintenance removes only provable derived FTS orphans", t => withDb(t, dbPath => {
  let index = new PersistentLexicalIndex({ path: dbPath });
  add(index, "evicted", "historical derived rows ".repeat(30), 96);
  add(index, "canonical", "healthy canonical evidence");
  index.close();

  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON");
  const orphanCount = Number(db.prepare(`
    SELECT count(*) AS n
    FROM chunks
    WHERE source_id = 'evicted'
  `).get().n);
  db.prepare("DELETE FROM sources WHERE source_id = ?").run("evicted");
  db.close();

  const before = snapshot(dbPath);
  const canonicalBefore = before.canonical;
  const healthyFtsBefore = rowsForSource(dbPath, "canonical");

  index = new PersistentLexicalIndex({ path: dbPath });
  const report = index.repairOrphanFtsRows();
  assert.deepEqual(report, {
    orphanRowsRemoved: orphanCount,
    canonicalChunkRows: 1,
    ftsRows: 1,
    orphanRowsRemaining: 0,
  });
  assert.deepEqual(snapshot(dbPath).canonical, canonicalBefore);
  assert.deepEqual(rowsForSource(dbPath, "canonical"), healthyFtsBefore);
  assert.equal(index.search("healthy canonical").results[0].sourceId, "canonical");
  assert.deepEqual(index.repairOrphanFtsRows(), {
    orphanRowsRemoved: 0,
    canonicalChunkRows: 1,
    ftsRows: 1,
    orphanRowsRemaining: 0,
  });
  index.close();

  const reopened = new PersistentLexicalIndex({ path: dbPath });
  try {
    assert.equal(reopened.search("healthy canonical").results[0].sourceId, "canonical");
  } finally {
    reopened.close();
  }
}));

test("orphan maintenance rolls back when strict verification finds canonical FTS damage", t => withDb(t, dbPath => {
  let index = new PersistentLexicalIndex({ path: dbPath });
  add(index, "canonical", "healthy canonical evidence");
  index.close();

  const db = new DatabaseSync(dbPath);
  db.prepare("DELETE FROM chunks_fts WHERE rowid = (SELECT min(rowid) FROM chunks_fts)").run();
  db.prepare("INSERT INTO chunks_fts(chunk_id, lexical_text) VALUES (?, ?)")
    .run("orphan:0", "t6f727068616e");
  db.close();
  const before = snapshot(dbPath);

  index = new PersistentLexicalIndex({ path: dbPath });
  try {
    assert.throws(() => index.repairOrphanFtsRows(), /row count differs/);
  } finally {
    index.close();
  }
  assert.deepEqual(snapshot(dbPath), before);
}));
