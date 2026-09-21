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
  contextCoreCapabilities,
} from "../src/index.mjs";
import {
  buildRecallCandidateIndex,
  decodeRecallCandidateIndex,
  RECALL_CANDIDATE_INDEX_VERSION,
  RecallCandidateLane,
} from "../src/recall-candidate-index.mjs";

function add(index, sourceId, content) {
  return index.addSource({
    sourceId,
    content,
    classification: ContextClass.RETRIEVABLE_KNOWLEDGE,
  });
}

function withDb(t, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "context-core-p8-p1-"));
  const dbPath = path.join(root, "context.sqlite");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return fn(dbPath);
}

const postingKey = posting => JSON.stringify([
  posting.chunk_id ?? posting.chunkId,
  posting.lane,
  posting.term,
  posting.candidate_digest ?? posting.candidateDigest,
]);

function seedUnicodeCandidateDatabase(dbPath) {
  const index = new PersistentLexicalIndex({ path: dbPath });
  add(index, "unicode-candidate", "zebra éclair ångström");
  index.close();
}

test("P8-P1 generated posting order is deterministic and locale-independent", () => {
  const candidate = buildRecallCandidateIndex({
    chunkId: "unicode:0",
    chunkDigest: "0".repeat(64),
    projectionDigest: "1".repeat(64),
    exactTokens: ["éclair", "zebra", "ångström"],
    derivedRecall: {
      identifierTokens: [],
      morphologyTokens: [],
      fragmentTokens: [],
    },
  });

  assert.deepEqual(
    candidate.postings
      .filter(posting => posting.lane === RecallCandidateLane.EXACT)
      .map(posting => posting.term),
    ["zebra", "ångström", "éclair"]
  );
});

test("P8-P1 reopens Unicode postings by exact set despite SQLite and locale ordering differences", t => withDb(t, dbPath => {
  seedUnicodeCandidateDatabase(dbPath);

  const db = new DatabaseSync(dbPath);
  const binding = db.prepare(`
    SELECT
      m.candidate_json,
      m.candidate_digest,
      c.chunk_id,
      c.digest AS chunk_digest,
      rp.projection_digest
    FROM recall_candidate_manifests AS m
    JOIN chunks AS c ON c.chunk_id = m.chunk_id
    JOIN recall_projections AS rp ON rp.chunk_id = m.chunk_id
  `).get();
  const expected = decodeRecallCandidateIndex({
    serialized: binding.candidate_json,
    candidateDigest: binding.candidate_digest,
    expectedChunkId: binding.chunk_id,
    expectedChunkDigest: binding.chunk_digest,
    expectedProjectionDigest: binding.projection_digest,
  }).postings;
  const sqliteOrdered = db.prepare(`
    SELECT chunk_id, lane, term, candidate_digest
    FROM recall_candidate_terms
    ORDER BY lane ASC, term ASC, chunk_id ASC
  `).all();
  const localeOrdered = [...sqliteOrdered].sort((left, right) =>
    left.lane.localeCompare(right.lane) ||
    left.term.localeCompare(right.term) ||
    left.chunk_id.localeCompare(right.chunk_id)
  );

  assert.notDeepEqual(
    sqliteOrdered.map(postingKey),
    localeOrdered.map(postingKey)
  );
  assert.equal(sqliteOrdered.length, expected.length);
  assert.deepEqual(
    new Set(sqliteOrdered.map(postingKey)),
    new Set(expected.map(postingKey))
  );
  db.close();

  const reopened = new PersistentLexicalIndex({ path: dbPath });
  try {
    assert.equal(
      reopened.search("éclair", { recall: "tiered" }).results[0].sourceId,
      "unicode-candidate"
    );
  } finally {
    reopened.close();
  }
}));

for (const [label, mutate] of [
  ["deleted", db => db.prepare(`
    DELETE FROM recall_candidate_terms
    WHERE rowid = (SELECT rowid FROM recall_candidate_terms LIMIT 1)
  `).run()],
  ["extra", db => {
    const row = db.prepare(`
      SELECT chunk_id, candidate_digest
      FROM recall_candidate_terms
      LIMIT 1
    `).get();
    db.prepare(`
      INSERT INTO recall_candidate_terms(chunk_id, lane, term, candidate_digest)
      VALUES (?, ?, ?, ?)
    `).run(row.chunk_id, RecallCandidateLane.EXACT, "unexpected", row.candidate_digest);
  }],
  ["candidate_digest changed", db => db.prepare(`
    UPDATE recall_candidate_terms
    SET candidate_digest = ?
    WHERE rowid = (SELECT rowid FROM recall_candidate_terms LIMIT 1)
  `).run("f".repeat(64))],
  ["lane changed", db => db.prepare(`
    UPDATE recall_candidate_terms
    SET lane = ?
    WHERE rowid = (SELECT rowid FROM recall_candidate_terms LIMIT 1)
  `).run("ALTERED_LANE")],
  ["term changed", db => db.prepare(`
    UPDATE recall_candidate_terms
    SET term = term || ?
    WHERE rowid = (SELECT rowid FROM recall_candidate_terms LIMIT 1)
  `).run("-altered")],
]) {
  test(`P8-P1 refuses Unicode candidate posting when one tuple is ${label}`, t => withDb(t, dbPath => {
    seedUnicodeCandidateDatabase(dbPath);
    const db = new DatabaseSync(dbPath);
    mutate(db);
    db.close();

    assert.throws(
      () => new PersistentLexicalIndex({ path: dbPath }),
      /recall candidate term integrity mismatch/
    );
  }));
}

test("P8-P1 persists integrity-bound normalized recall candidate postings", t => withDb(t, dbPath => {
  const index = new PersistentLexicalIndex({ path: dbPath });
  add(index, "candidate", "buildResumePacket workers are running loadContextContinuityPacket");
  index.close();

  const db = new DatabaseSync(dbPath);
  const manifest = db.prepare(`
    SELECT candidate_version, chunk_digest, projection_digest, candidate_json, candidate_digest
    FROM recall_candidate_manifests
  `).get();
  assert.equal(manifest.candidate_version, RECALL_CANDIDATE_INDEX_VERSION);
  assert.match(manifest.chunk_digest, /^[0-9a-f]{64}$/);
  assert.match(manifest.projection_digest, /^[0-9a-f]{64}$/);
  assert.match(manifest.candidate_digest, /^[0-9a-f]{64}$/);

  const payload = JSON.parse(manifest.candidate_json);
  assert.ok(payload.identifierTokens.includes("resume"));
  assert.ok(payload.morphologyTokens.includes("run"));
  assert.ok(payload.substringFragmentTokens.length > 0);

  const indexed = db.prepare(`
    SELECT DISTINCT c.source_id, t.lane, t.term
    FROM recall_candidate_terms AS t
    JOIN chunks AS c ON c.chunk_id = t.chunk_id
    WHERE (t.lane = ? AND t.term = ?) OR (t.lane = ? AND t.term = ?)
    ORDER BY t.lane ASC, t.term ASC
  `).all(
    RecallCandidateLane.IDENTIFIER, "resume",
    RecallCandidateLane.MORPHOLOGY, "run"
  );
  assert.deepEqual(indexed.map(row => [row.source_id, row.lane, row.term]), [
    ["candidate", RecallCandidateLane.IDENTIFIER, "resume"],
    ["candidate", RecallCandidateLane.MORPHOLOGY, "run"],
  ]);
  db.close();
}));

test("P8-P1 rebuilds a wholly missing candidate manifest and postings from canonical P7 truth", t => withDb(t, dbPath => {
  let index = new PersistentLexicalIndex({ path: dbPath });
  add(index, "rebuild", "buildResumePacket");
  index.close();

  const db = new DatabaseSync(dbPath);
  db.exec("DELETE FROM recall_candidate_manifests");
  assert.equal(Number(db.prepare("SELECT count(*) AS n FROM recall_candidate_manifests").get().n), 0);
  assert.equal(Number(db.prepare("SELECT count(*) AS n FROM recall_candidate_terms").get().n), 0);
  db.close();

  index = new PersistentLexicalIndex({ path: dbPath });
  index.close();

  const verify = new DatabaseSync(dbPath);
  assert.equal(Number(verify.prepare("SELECT count(*) AS n FROM recall_candidate_manifests").get().n), 1);
  assert.ok(Number(verify.prepare("SELECT count(*) AS n FROM recall_candidate_terms").get().n) > 0);
  verify.close();
}));

test("P8-P1 refuses partial candidate posting loss instead of silently rebuilding it", t => withDb(t, dbPath => {
  let index = new PersistentLexicalIndex({ path: dbPath });
  add(index, "partial-loss", "buildResumePacket");
  index.close();

  const db = new DatabaseSync(dbPath);
  db.prepare(`
    DELETE FROM recall_candidate_terms
    WHERE rowid = (SELECT rowid FROM recall_candidate_terms ORDER BY rowid ASC LIMIT 1)
  `).run();
  db.close();

  assert.throws(
    () => new PersistentLexicalIndex({ path: dbPath }),
    /recall candidate term integrity mismatch/
  );
}));

test("P8-P1 refuses a semantically forged candidate manifest even with a recomputed digest", t => withDb(t, dbPath => {
  let index = new PersistentLexicalIndex({ path: dbPath });
  add(index, "semantic-forge", "buildResumePacket");
  index.close();

  const db = new DatabaseSync(dbPath);
  const row = db.prepare("SELECT chunk_id, candidate_json FROM recall_candidate_manifests").get();
  const payload = JSON.parse(row.candidate_json);
  payload.identifierTokens = ["wrong"];
  const serialized = JSON.stringify(payload);
  const digest = createHash("sha256").update(serialized, "utf8").digest("hex");
  db.prepare(`
    UPDATE recall_candidate_manifests
    SET candidate_json = ?, candidate_digest = ?
    WHERE chunk_id = ?
  `).run(serialized, digest, row.chunk_id);
  db.close();

  assert.throws(
    () => new PersistentLexicalIndex({ path: dbPath }),
    /recall candidate index semantic mismatch/
  );
}));

test("P8-P1 leaves tiered recall public semantics and authority unchanged", () => {
  const index = new PersistentLexicalIndex({ path: ":memory:" });
  try {
    add(index, "exact", "resume");
    add(index, "identifier", "buildResumePacket");
    add(index, "morphology", "workers are running");
    add(index, "substring", "loadContextContinuityPacket");

    assert.deepEqual(
      index.search("resume", { recall: "tiered" }).results.map(item => [item.sourceId, item.matchKind]),
      [["exact", "EXACT"], ["identifier", "IDENTIFIER"]]
    );
    assert.equal(index.search("runs", { recall: "tiered" }).results[0].matchKind, "MORPHOLOGY");
    assert.equal(index.search("continu", { recall: "tiered" }).results[0].matchKind, "SUBSTRING");

    const caps = contextCoreCapabilities();
    for (const key of [
      "modelCalls", "arbitraryCodeExecution", "shellExecution", "networkAccess",
      "authorityGrants", "durableMemoryWrites", "walletAccess", "tradeExecution", "gitWrite",
    ]) {
      assert.equal(caps[key], false);
    }
  } finally {
    index.close();
  }
});
