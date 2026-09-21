import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
import {
  DERIVED_RECALL_PROJECTION_VERSION,
} from "../src/derived-recall.mjs";

function add(index, sourceId, content) {
  return index.addSource({
    sourceId,
    content,
    classification:
      ContextClass.RETRIEVABLE_KNOWLEDGE,
  });
}

function withDb(t, fn) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "context-core-p7-")
  );
  const dbPath = path.join(root, "context.sqlite");

  t.after(() => {
    fs.rmSync(root, {
      recursive: true,
      force: true,
    });
  });

  return fn(dbPath);
}

test("P7 persists identifier/morphology/substring projections and reuses them across reopen", t =>
  withDb(t, dbPath => {
    let index =
      new PersistentLexicalIndex({ path: dbPath });

    add(
      index,
      "derived",
      "buildResumePacket workers are running loadContextContinuityPacket"
    );

    assert.equal(
      index.search("resume", { recall: "tiered" })
        .results[0].matchKind,
      "IDENTIFIER"
    );
    assert.equal(
      index.search("runs", { recall: "tiered" })
        .results[0].matchKind,
      "MORPHOLOGY"
    );
    assert.equal(
      index.search("continu", { recall: "tiered" })
        .results[0].matchKind,
      "SUBSTRING"
    );

    index.close();

    const db = new DatabaseSync(dbPath);
    const row = db.prepare(`
      SELECT
        projection_version,
        chunk_digest,
        projection_json,
        projection_digest
      FROM recall_projections
    `).get();
    db.close();

    assert.equal(
      row.projection_version,
      DERIVED_RECALL_PROJECTION_VERSION
    );
    assert.match(row.chunk_digest, /^[0-9a-f]{64}$/);
    assert.match(
      row.projection_digest,
      /^[0-9a-f]{64}$/
    );

    const payload = JSON.parse(row.projection_json);
    assert.ok(
      payload.identifierTokens.includes("resume")
    );
    assert.ok(
      payload.morphologyTokens.includes("run")
    );
    assert.ok(
      payload.substringValues.some(value =>
        value.includes("contextcontinuity")
      )
    );
    assert.ok(payload.fragmentTokens.length > 0);

    index =
      new PersistentLexicalIndex({ path: dbPath });

    assert.equal(
      index.search("continu", { recall: "tiered" })
        .results[0].matchKind,
      "SUBSTRING"
    );

    index.close();
  })
);

test("P7 rebuilds a missing derived row from canonical chunk truth", t =>
  withDb(t, dbPath => {
    let index =
      new PersistentLexicalIndex({ path: dbPath });
    add(index, "rebuild", "buildResumePacket");
    index.close();

    const db = new DatabaseSync(dbPath);
    db.exec("DELETE FROM recall_projections");
    assert.equal(
      Number(
        db.prepare(
          "SELECT count(*) AS n FROM recall_projections"
        ).get().n
      ),
      0
    );
    db.close();

    index =
      new PersistentLexicalIndex({ path: dbPath });

    assert.equal(
      index.search("resume", { recall: "tiered" })
        .results[0].matchKind,
      "IDENTIFIER"
    );

    index.close();

    const verify = new DatabaseSync(dbPath);
    assert.equal(
      Number(
        verify.prepare(
          "SELECT count(*) AS n FROM recall_projections"
        ).get().n
      ),
      1
    );
    verify.close();
  })
);

test("P7 refuses projection JSON/digest tampering", t =>
  withDb(t, dbPath => {
    let index =
      new PersistentLexicalIndex({ path: dbPath });
    add(index, "tamper", "buildResumePacket");
    index.close();

    const db = new DatabaseSync(dbPath);
    const row = db.prepare(`
      SELECT chunk_id, projection_json
      FROM recall_projections
    `).get();

    const payload = JSON.parse(row.projection_json);
    payload.identifierTokens = ["wrong"];

    db.prepare(`
      UPDATE recall_projections
      SET projection_json = ?
      WHERE chunk_id = ?
    `).run(
      JSON.stringify(payload),
      row.chunk_id
    );
    db.close();

    assert.throws(
      () =>
        new PersistentLexicalIndex({
          path: dbPath,
        }),
      /derived recall projection integrity mismatch/
    );
  })
);

test("P7 refuses semantically forged projection even when its digest is recomputed", t =>
  withDb(t, dbPath => {
    let index =
      new PersistentLexicalIndex({ path: dbPath });
    add(index, "semantic-forge", "buildResumePacket");
    index.close();

    const db = new DatabaseSync(dbPath);
    const row = db.prepare(`
      SELECT chunk_id, projection_json
      FROM recall_projections
    `).get();

    const payload = JSON.parse(row.projection_json);
    payload.identifierTokens = ["wrong"];
    const serialized = JSON.stringify(payload);
    const digest = createHash("sha256")
      .update(serialized, "utf8")
      .digest("hex");

    db.prepare(`
      UPDATE recall_projections
      SET projection_json = ?, projection_digest = ?
      WHERE chunk_id = ?
    `).run(serialized, digest, row.chunk_id);
    db.close();

    assert.throws(
      () =>
        new PersistentLexicalIndex({
          path: dbPath,
        }),
      /derived recall projection semantic mismatch/
    );
  })
);

test("P7 refuses a stored projection version mismatch", t =>
  withDb(t, dbPath => {
    let index =
      new PersistentLexicalIndex({ path: dbPath });
    add(index, "version", "buildResumePacket");
    index.close();

    const db = new DatabaseSync(dbPath);
    db.exec(`
      UPDATE recall_projections
      SET projection_version = 'P3B-P7-V999'
    `);
    db.close();

    assert.throws(
      () =>
        new PersistentLexicalIndex({
          path: dbPath,
        }),
      /derived recall projection version mismatch/
    );
  })
);

test("P7 leaves exact search public semantics unchanged", () => {
  const index =
    new PersistentLexicalIndex({
      path: ":memory:",
    });

  try {
    add(index, "exact", "alpha beta gamma");

    const result = index.search("alpha");

    assert.equal(result.results.length, 1);
    assert.equal("recall" in result, false);
    assert.equal(
      "matchKind" in result.results[0],
      false
    );
  } finally {
    index.close();
  }
});
