import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

import { classifyInput } from "./classify.mjs";
import {
  chunkMarkdownDeterministic,
  chunkTextDeterministic,
  lexicalTokensForChunk,
  normalizeChunkMode,
  tokenizeLexical,
} from "./retrieval.mjs";
import {
  ContextBudgetExceeded,
  ContextClass,
  ContextCoreError,
} from "./types.mjs";
import {
  buildRecallQueryPlan,
  RecallMatchKind,
  scoreTieredRecallDocuments,
} from "./recall.mjs";
import {
  buildDerivedRecallProjection,
  decodeDerivedRecallProjection,
  DERIVED_RECALL_PROJECTION_VERSION,
} from "./derived-recall.mjs";
import {
  buildRecallCandidateIndex,
  decodeRecallCandidateIndex,
  RECALL_CANDIDATE_INDEX_VERSION,
  RecallCandidateLane,
} from "./recall-candidate-index.mjs";

const require = createRequire(import.meta.url);

const INDEXABLE = new Set([
  ContextClass.WORKING_CONTEXT,
  ContextClass.BULK_MATERIAL,
  ContextClass.RETRIEVABLE_KNOWLEDGE,
]);

const sha256 = text =>
  createHash("sha256").update(text, "utf8").digest("hex");

const bytes = text => Buffer.byteLength(text, "utf8");

function indexPolicyDigest(sourceId, maxChunkBytes, chunkMode) {
  return sha256(
    `${sourceId}\0${maxChunkBytes}\0${chunkMode}`
  );
}

function chunkStructureDigest(
  sourceId,
  chunkIndex,
  structureKind
) {
  return sha256(
    `${sourceId}\0${chunkIndex}\0${structureKind}`
  );
}

const jsonBytes = value => bytes(JSON.stringify(value));

function stabilizeUsedBytes(value) {
  let used = 0;

  for (let i = 0; i < 8; i += 1) {
    const candidate = { ...value, usedBytes: used };
    const measured = jsonBytes(candidate);
    if (measured === used) return candidate;
    used = measured;
  }

  return {
    ...value,
    usedBytes: jsonBytes({ ...value, usedBytes: used }),
  };
}

function databaseSyncClass() {
  try {
    const sqlite = require("node:sqlite");
    if (typeof sqlite.DatabaseSync !== "function") {
      throw new Error("DatabaseSync unavailable");
    }
    return sqlite.DatabaseSync;
  } catch (error) {
    throw new ContextCoreError(
      `persistent retrieval requires usable node:sqlite: ${error.message}`
    );
  }
}

function encodeToken(token) {
  return `t${Buffer.from(token, "utf8").toString("hex")}`;
}

function ftsQuery(terms, match) {
  const separator = match === "all" ? " AND " : " OR ";
  return terms.map(term => `"${encodeToken(term)}"`).join(separator);
}

function frequencies(tokens) {
  const map = new Map();
  for (const token of tokens) {
    map.set(token, (map.get(token) ?? 0) + 1);
  }
  return map;
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch {
    throw new ContextCoreError(`stored ${label} JSON is invalid`);
  }
}

export class PersistentLexicalIndex {
  constructor({ path, k1 = 1.2, b = 0.75 } = {}) {
    if (!path || typeof path !== "string") {
      throw new ContextCoreError("path must be a non-empty string");
    }
    if (!(k1 > 0)) throw new ContextCoreError("k1 must be > 0");
    if (!(b >= 0 && b <= 1)) {
      throw new ContextCoreError("b must be between 0 and 1");
    }

    if (path !== ":memory:") {
      mkdirSync(dirname(resolve(path)), { recursive: true });
    }

    const DatabaseSync = databaseSyncClass();

    this.path = path;
    this.k1 = k1;
    this.b = b;
    this.db = new DatabaseSync(path);

    try {
      this.#initializeSchema();
      this.#initializeDerivedRecallIndex();
      this.#initializeRecallCandidateIndex();
      this.recallIntegrityEpoch =
        this.#currentRecallIntegrityEpoch();
    } catch (error) {
      try {
        this.db.close();
      } catch {}
      throw new ContextCoreError(
        `persistent retrieval initialization failed: ${error.message}`
      );
    }
  }

  #initializeSchema() {
    this.db.exec(`
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS sources (
        source_id TEXT PRIMARY KEY,
        classification TEXT NOT NULL,
        content_digest TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        metadata_digest TEXT,
        max_chunk_bytes INTEGER NOT NULL,
        chunk_mode TEXT NOT NULL DEFAULT 'plain',
        index_policy_digest TEXT
      );

      CREATE TABLE IF NOT EXISTS chunks (
        chunk_id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        digest TEXT NOT NULL,
        bytes INTEGER NOT NULL,
        content TEXT NOT NULL,
        token_count INTEGER NOT NULL,
        tokens_json TEXT NOT NULL,
        structure_kind TEXT NOT NULL DEFAULT 'text',
        structure_digest TEXT,
        FOREIGN KEY(source_id) REFERENCES sources(source_id) ON DELETE CASCADE,
        UNIQUE(source_id, chunk_index)
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
        chunk_id UNINDEXED,
        lexical_text
      );

      CREATE TABLE IF NOT EXISTS recall_projections (
        chunk_id TEXT PRIMARY KEY,
        projection_version TEXT NOT NULL,
        chunk_digest TEXT NOT NULL,
        projection_json TEXT NOT NULL,
        projection_digest TEXT NOT NULL,
        FOREIGN KEY(chunk_id) REFERENCES chunks(chunk_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS recall_candidate_manifests (
        chunk_id TEXT PRIMARY KEY,
        candidate_version TEXT NOT NULL,
        chunk_digest TEXT NOT NULL,
        projection_digest TEXT NOT NULL,
        candidate_json TEXT NOT NULL,
        candidate_digest TEXT NOT NULL,
        FOREIGN KEY(chunk_id) REFERENCES chunks(chunk_id) ON DELETE CASCADE,
        FOREIGN KEY(chunk_id) REFERENCES recall_projections(chunk_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS recall_candidate_terms (
        chunk_id TEXT NOT NULL,
        lane TEXT NOT NULL,
        term TEXT NOT NULL,
        candidate_digest TEXT NOT NULL,
        PRIMARY KEY(chunk_id, lane, term),
        FOREIGN KEY(chunk_id) REFERENCES recall_candidate_manifests(chunk_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_recall_candidate_terms_lookup
      ON recall_candidate_terms(lane, term, chunk_id);

      CREATE TABLE IF NOT EXISTS recall_integrity_epoch (
        singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
        version INTEGER NOT NULL
      );

      INSERT OR IGNORE INTO recall_integrity_epoch(singleton, version)
      VALUES (1, 0);

      CREATE TRIGGER IF NOT EXISTS recall_integrity_sources_insert
      AFTER INSERT ON sources
      BEGIN
        UPDATE recall_integrity_epoch
        SET version = version + 1
        WHERE singleton = 1;
      END;

      CREATE TRIGGER IF NOT EXISTS recall_integrity_sources_update
      AFTER UPDATE ON sources
      BEGIN
        UPDATE recall_integrity_epoch
        SET version = version + 1
        WHERE singleton = 1;
      END;

      CREATE TRIGGER IF NOT EXISTS recall_integrity_sources_delete
      AFTER DELETE ON sources
      BEGIN
        UPDATE recall_integrity_epoch
        SET version = version + 1
        WHERE singleton = 1;
      END;

      CREATE TRIGGER IF NOT EXISTS recall_integrity_chunks_insert
      AFTER INSERT ON chunks
      BEGIN
        UPDATE recall_integrity_epoch
        SET version = version + 1
        WHERE singleton = 1;
      END;

      CREATE TRIGGER IF NOT EXISTS recall_integrity_chunks_update
      AFTER UPDATE ON chunks
      BEGIN
        UPDATE recall_integrity_epoch
        SET version = version + 1
        WHERE singleton = 1;
      END;

      CREATE TRIGGER IF NOT EXISTS recall_integrity_chunks_delete
      AFTER DELETE ON chunks
      BEGIN
        UPDATE recall_integrity_epoch
        SET version = version + 1
        WHERE singleton = 1;
      END;

      CREATE TRIGGER IF NOT EXISTS recall_integrity_recall_projections_insert
      AFTER INSERT ON recall_projections
      BEGIN
        UPDATE recall_integrity_epoch
        SET version = version + 1
        WHERE singleton = 1;
      END;

      CREATE TRIGGER IF NOT EXISTS recall_integrity_recall_projections_update
      AFTER UPDATE ON recall_projections
      BEGIN
        UPDATE recall_integrity_epoch
        SET version = version + 1
        WHERE singleton = 1;
      END;

      CREATE TRIGGER IF NOT EXISTS recall_integrity_recall_projections_delete
      AFTER DELETE ON recall_projections
      BEGIN
        UPDATE recall_integrity_epoch
        SET version = version + 1
        WHERE singleton = 1;
      END;

      CREATE TRIGGER IF NOT EXISTS recall_integrity_recall_candidate_manifests_insert
      AFTER INSERT ON recall_candidate_manifests
      BEGIN
        UPDATE recall_integrity_epoch
        SET version = version + 1
        WHERE singleton = 1;
      END;

      CREATE TRIGGER IF NOT EXISTS recall_integrity_recall_candidate_manifests_update
      AFTER UPDATE ON recall_candidate_manifests
      BEGIN
        UPDATE recall_integrity_epoch
        SET version = version + 1
        WHERE singleton = 1;
      END;

      CREATE TRIGGER IF NOT EXISTS recall_integrity_recall_candidate_manifests_delete
      AFTER DELETE ON recall_candidate_manifests
      BEGIN
        UPDATE recall_integrity_epoch
        SET version = version + 1
        WHERE singleton = 1;
      END;

      CREATE TRIGGER IF NOT EXISTS recall_integrity_recall_candidate_terms_insert
      AFTER INSERT ON recall_candidate_terms
      BEGIN
        UPDATE recall_integrity_epoch
        SET version = version + 1
        WHERE singleton = 1;
      END;

      CREATE TRIGGER IF NOT EXISTS recall_integrity_recall_candidate_terms_update
      AFTER UPDATE ON recall_candidate_terms
      BEGIN
        UPDATE recall_integrity_epoch
        SET version = version + 1
        WHERE singleton = 1;
      END;

      CREATE TRIGGER IF NOT EXISTS recall_integrity_recall_candidate_terms_delete
      AFTER DELETE ON recall_candidate_terms
      BEGIN
        UPDATE recall_integrity_epoch
        SET version = version + 1
        WHERE singleton = 1;
      END;
    `);

    const sourceColumns = this.db
      .prepare("PRAGMA table_info(sources)")
      .all();

    if (
      !sourceColumns.some(
        column =>
          column.name ===
          "metadata_digest"
      )
    ) {
      this.db.exec(
        "ALTER TABLE sources ADD COLUMN metadata_digest TEXT"
      );
    }

    if (
      !sourceColumns.some(
        column => column.name === "chunk_mode"
      )
    ) {
      this.db.exec(
        "ALTER TABLE sources ADD COLUMN chunk_mode TEXT NOT NULL DEFAULT 'plain'"
      );
    }

    const chunkColumns = this.db
      .prepare("PRAGMA table_info(chunks)")
      .all();

    if (
      !chunkColumns.some(
        column => column.name === "structure_kind"
      )
    ) {
      this.db.exec(
        "ALTER TABLE chunks ADD COLUMN structure_kind TEXT NOT NULL DEFAULT 'text'"
      );
    }

    if (
      !sourceColumns.some(
        column => column.name === "index_policy_digest"
      )
    ) {
      this.db.exec(
        "ALTER TABLE sources ADD COLUMN index_policy_digest TEXT"
      );
    }

    if (
      !chunkColumns.some(
        column => column.name === "structure_digest"
      )
    ) {
      this.db.exec(
        "ALTER TABLE chunks ADD COLUMN structure_digest TEXT"
      );
    }

    // Canonical pre-P3B-P2 databases have no structural labels at all.
    // After the default-column migrations above they are provably plain/text,
    // so those rows can receive integrity commitments. Any non-default
    // structured row without a prior commitment is refused instead of blessed.
    const legacySources = this.db
      .prepare(`
        SELECT
          source_id,
          max_chunk_bytes,
          chunk_mode
        FROM sources
        WHERE index_policy_digest IS NULL
        ORDER BY source_id ASC
      `)
      .all();

    const updateSourcePolicy = this.db.prepare(`
      UPDATE sources
      SET index_policy_digest = ?
      WHERE source_id = ?
    `);

    for (const source of legacySources) {
      if (source.chunk_mode !== "plain") {
        throw new ContextCoreError(
          `stored index policy integrity unavailable for structured source ${source.source_id}`
        );
      }

      updateSourcePolicy.run(
        indexPolicyDigest(
          source.source_id,
          Number(source.max_chunk_bytes),
          source.chunk_mode
        ),
        source.source_id
      );
    }

    const legacyChunks = this.db
      .prepare(`
        SELECT
          c.chunk_id,
          c.source_id,
          c.chunk_index,
          c.structure_kind,
          s.chunk_mode
        FROM chunks AS c
        JOIN sources AS s
          ON s.source_id = c.source_id
        WHERE c.structure_digest IS NULL
        ORDER BY c.chunk_id ASC
      `)
      .all();

    const updateChunkStructure = this.db.prepare(`
      UPDATE chunks
      SET structure_digest = ?
      WHERE chunk_id = ?
    `);

    for (const chunk of legacyChunks) {
      if (
        chunk.chunk_mode !== "plain" ||
        chunk.structure_kind !== "text"
      ) {
        throw new ContextCoreError(
          `stored chunk structure integrity unavailable for ${chunk.chunk_id}`
        );
      }

      updateChunkStructure.run(
        chunkStructureDigest(
          chunk.source_id,
          Number(chunk.chunk_index),
          chunk.structure_kind
        ),
        chunk.chunk_id
      );
    }
  }

  #initializeDerivedRecallIndex() {
    const rows = this.db
      .prepare(`
        SELECT
          c.chunk_id,
          c.source_id,
          c.chunk_index,
          c.digest,
          c.content,
          c.tokens_json,
          c.token_count,
          c.structure_kind,
          s.chunk_mode,
          rp.projection_version,
          rp.chunk_digest AS projection_chunk_digest,
          rp.projection_json,
          rp.projection_digest
        FROM chunks AS c
        JOIN sources AS s
          ON s.source_id = c.source_id
        LEFT JOIN recall_projections AS rp
          ON rp.chunk_id = c.chunk_id
        ORDER BY
          c.source_id ASC,
          c.chunk_index ASC,
          c.chunk_id ASC
      `)
      .all();

    const insertProjection = this.db.prepare(`
      INSERT INTO recall_projections(
        chunk_id,
        projection_version,
        chunk_digest,
        projection_json,
        projection_digest
      ) VALUES (?, ?, ?, ?, ?)
    `);

    for (const row of rows) {
      const storedTokens =
        parseJson(row.tokens_json, "tokens");

      const canonicalTokens =
        lexicalTokensForChunk(row.content, {
          chunkMode: row.chunk_mode,
          structureKind: row.structure_kind,
        });

      const expectedChunkDigest = sha256(
        `${row.source_id}\0${row.chunk_index}\0${row.content}`
      );

      if (expectedChunkDigest !== row.digest) {
        throw new ContextCoreError(
          `stored chunk integrity mismatch for ${row.chunk_id}`
        );
      }

      if (
        !Array.isArray(storedTokens) ||
        storedTokens.length !== canonicalTokens.length ||
        storedTokens.some(
          (token, index) =>
            token !== canonicalTokens[index]
        )
      ) {
        throw new ContextCoreError(
          `stored token integrity mismatch for ${row.chunk_id}`
        );
      }

      if (
        Number(row.token_count) !== canonicalTokens.length
      ) {
        throw new ContextCoreError(
          `stored token count mismatch for ${row.chunk_id}`
        );
      }

      const expected =
        buildDerivedRecallProjection({
          sourceId: row.source_id,
          chunkId: row.chunk_id,
          chunkIndex: Number(row.chunk_index),
          chunkDigest: row.digest,
          content: row.content,
          exactTokens: canonicalTokens,
        });

      if (row.projection_json === null) {
        insertProjection.run(
          row.chunk_id,
          DERIVED_RECALL_PROJECTION_VERSION,
          row.digest,
          expected.serialized,
          expected.projectionDigest
        );
        continue;
      }

      if (
        row.projection_version !==
          DERIVED_RECALL_PROJECTION_VERSION
      ) {
        throw new ContextCoreError(
          `stored derived recall projection version mismatch for ${row.chunk_id}`
        );
      }

      if (row.projection_chunk_digest !== row.digest) {
        throw new ContextCoreError(
          `stored derived recall projection chunk digest mismatch for ${row.chunk_id}`
        );
      }

      const decoded =
        decodeDerivedRecallProjection({
          serialized: row.projection_json,
          projectionDigest:
            row.projection_digest,
          expectedSourceId: row.source_id,
          expectedChunkId: row.chunk_id,
          expectedChunkIndex:
            Number(row.chunk_index),
          expectedChunkDigest: row.digest,
        });

      if (
        decoded.projectionDigest !==
        expected.projectionDigest
      ) {
        throw new ContextCoreError(
          `stored derived recall projection semantic mismatch for ${row.chunk_id}`
        );
      }
    }
  }


  #initializeRecallCandidateIndex() {
    const rows = this.db.prepare(`
      SELECT
        c.chunk_id,
        c.source_id,
        c.chunk_index,
        c.digest,
        c.tokens_json,
        rp.projection_json,
        rp.projection_digest,
        m.candidate_version,
        m.chunk_digest AS candidate_chunk_digest,
        m.projection_digest AS candidate_projection_digest,
        m.candidate_json,
        m.candidate_digest
      FROM chunks AS c
      JOIN recall_projections AS rp
        ON rp.chunk_id = c.chunk_id
      LEFT JOIN recall_candidate_manifests AS m
        ON m.chunk_id = c.chunk_id
      ORDER BY c.source_id ASC, c.chunk_index ASC, c.chunk_id ASC
    `).all();

    const insertManifest = this.db.prepare(`
      INSERT INTO recall_candidate_manifests(
        chunk_id, candidate_version, chunk_digest, projection_digest, candidate_json, candidate_digest
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);
    const insertTerm = this.db.prepare(`
      INSERT INTO recall_candidate_terms(chunk_id, lane, term, candidate_digest)
      VALUES (?, ?, ?, ?)
    `);
    const selectTerms = this.db.prepare(`
      SELECT chunk_id, lane, term, candidate_digest
      FROM recall_candidate_terms
      WHERE chunk_id = ?
      ORDER BY lane ASC, term ASC, chunk_id ASC
    `);

    for (const row of rows) {
      const exactTokens = parseJson(row.tokens_json, "tokens");
      const derivedRecall = decodeDerivedRecallProjection({
        serialized: row.projection_json,
        projectionDigest: row.projection_digest,
        expectedSourceId: row.source_id,
        expectedChunkId: row.chunk_id,
        expectedChunkIndex: Number(row.chunk_index),
        expectedChunkDigest: row.digest,
      });
      const expected = buildRecallCandidateIndex({
        chunkId: row.chunk_id,
        chunkDigest: row.digest,
        projectionDigest: row.projection_digest,
        exactTokens,
        derivedRecall,
      });

      if (row.candidate_json === null) {
        this.db.exec("BEGIN IMMEDIATE");
        try {
          insertManifest.run(
            row.chunk_id,
            RECALL_CANDIDATE_INDEX_VERSION,
            row.digest,
            row.projection_digest,
            expected.serialized,
            expected.candidateDigest
          );
          for (const posting of expected.postings) {
            insertTerm.run(posting.chunkId, posting.lane, posting.term, posting.candidateDigest);
          }
          this.db.exec("COMMIT");
        } catch (error) {
          try { this.db.exec("ROLLBACK"); } catch {}
          throw error;
        }
        continue;
      }

      if (row.candidate_version !== RECALL_CANDIDATE_INDEX_VERSION) {
        throw new ContextCoreError(`stored recall candidate index version mismatch for ${row.chunk_id}`);
      }
      if (row.candidate_chunk_digest !== row.digest) {
        throw new ContextCoreError(`stored recall candidate index chunk digest mismatch for ${row.chunk_id}`);
      }
      if (row.candidate_projection_digest !== row.projection_digest) {
        throw new ContextCoreError(`stored recall candidate index projection digest mismatch for ${row.chunk_id}`);
      }

      const decoded = decodeRecallCandidateIndex({
        serialized: row.candidate_json,
        candidateDigest: row.candidate_digest,
        expectedChunkId: row.chunk_id,
        expectedChunkDigest: row.digest,
        expectedProjectionDigest: row.projection_digest,
      });
      if (decoded.candidateDigest !== expected.candidateDigest) {
        throw new ContextCoreError(`stored recall candidate index semantic mismatch for ${row.chunk_id}`);
      }

      const actualTerms = selectTerms.all(row.chunk_id);
      const expectedTerms = expected.postings.map(posting => ({
        chunk_id: posting.chunkId,
        lane: posting.lane,
        term: posting.term,
        candidate_digest: posting.candidateDigest,
      }));
      if (
        actualTerms.length !== expectedTerms.length ||
        actualTerms.some((actual, index) => {
          const wanted = expectedTerms[index];
          return actual.chunk_id !== wanted.chunk_id || actual.lane !== wanted.lane || actual.term !== wanted.term || actual.candidate_digest !== wanted.candidate_digest;
        })
      ) {
        throw new ContextCoreError(`stored recall candidate term integrity mismatch for ${row.chunk_id}`);
      }
    }
  }


  #currentRecallIntegrityEpoch() {
    const row = this.db
      .prepare(`
        SELECT version
        FROM recall_integrity_epoch
        WHERE singleton = 1
      `)
      .get();

    const version =
      Number(row?.version);

    if (
      !Number.isSafeInteger(version) ||
      version < 0
    ) {
      throw new ContextCoreError(
        "stored recall integrity epoch is invalid"
      );
    }

    return version;
  }

  #assertRecallIntegrityEpoch() {
    const current =
      this.#currentRecallIntegrityEpoch();

    if (
      current !==
      this.recallIntegrityEpoch
    ) {
      throw new ContextCoreError(
        "persistent retrieval integrity epoch changed outside this index; reopen required"
      );
    }
  }

  #acceptRecallIntegrityEpoch() {
    this.recallIntegrityEpoch =
      this.#currentRecallIntegrityEpoch();
  }

  close() {
    this.db.close();
  }

  #publicRef(sourceId) {
    const source = this.db
      .prepare(`
        SELECT
          source_id,
          classification,
          content_digest,
          max_chunk_bytes,
          chunk_mode,
          index_policy_digest
        FROM sources
        WHERE source_id = ?
      `)
      .get(sourceId);

    if (!source) {
      throw new ContextCoreError(`source ${sourceId} is missing`);
    }

    const expectedPolicyDigest = indexPolicyDigest(
      source.source_id,
      Number(source.max_chunk_bytes),
      source.chunk_mode
    );

    if (
      source.index_policy_digest === null ||
      source.index_policy_digest !== expectedPolicyDigest
    ) {
      throw new ContextCoreError(
        `stored index policy integrity mismatch for ${sourceId}`
      );
    }

    const chunks = this.db
      .prepare(`
        SELECT
          chunk_id,
          chunk_index,
          digest,
          bytes,
          content,
          structure_kind,
          structure_digest
        FROM chunks
        WHERE source_id = ?
        ORDER BY chunk_index ASC
      `)
      .all(sourceId);

    const reconstructed = chunks.map(chunk => chunk.content).join("");
    const reconstructedDigest = sha256(reconstructed);

    if (reconstructedDigest !== source.content_digest) {
      throw new ContextCoreError(
        `stored source integrity mismatch for ${sourceId}`
      );
    }

    for (const chunk of chunks) {
      const expected = sha256(
        `${sourceId}\0${chunk.chunk_index}\0${chunk.content}`
      );
      if (expected !== chunk.digest) {
        throw new ContextCoreError(
          `stored chunk integrity mismatch for ${chunk.chunk_id}`
        );
      }

      const expectedStructureDigest =
        chunkStructureDigest(
          sourceId,
          Number(chunk.chunk_index),
          chunk.structure_kind
        );

      if (
        chunk.structure_digest === null ||
        chunk.structure_digest !==
          expectedStructureDigest
      ) {
        throw new ContextCoreError(
          `stored chunk structure integrity mismatch for ${chunk.chunk_id}`
        );
      }
    }

    return Object.freeze({
      sourceId: source.source_id,
      classification: source.classification,
      contentDigest: source.content_digest,
      chunkCount: chunks.length,
      chunks: Object.freeze(
        chunks.map(chunk =>
          Object.freeze({
            chunkId: chunk.chunk_id,
            chunkIndex: Number(chunk.chunk_index),
            digest: chunk.digest,
            bytes: Number(chunk.bytes),
          })
        )
      ),
    });
  }

  addSource({
    sourceId,
    content,
    classification,
    metadata = {},
    maxChunkBytes = 2048,
    chunkMode = "plain",
  }) {
    this.#assertRecallIntegrityEpoch();

    if (!sourceId || typeof sourceId !== "string") {
      throw new ContextCoreError("sourceId must be a non-empty string");
    }

    const text = String(content ?? "");
    const resolvedClassification = classifyInput({
      content: text,
      classification,
      metadata,
    });
    const resolvedChunkMode = normalizeChunkMode(chunkMode);

    if (!INDEXABLE.has(resolvedClassification)) {
      throw new ContextCoreError(
        `classification ${resolvedClassification} is not eligible for lexical indexing`
      );
    }

    const contentDigest = sha256(text);
    const metadataJson =
      JSON.stringify(metadata);
    const metadataDigest =
      sha256(metadataJson);

    const prior = this.db
      .prepare(`
        SELECT
          content_digest,
          metadata_json,
          metadata_digest,
          max_chunk_bytes,
          chunk_mode,
          index_policy_digest
        FROM sources
        WHERE source_id = ?
      `)
      .get(sourceId);

    if (prior) {
      if (prior.content_digest !== contentDigest) {
        throw new ContextCoreError(
          `sourceId ${sourceId} already refers to different content`
        );
      }

      if (
        prior.metadata_digest !== null &&
        sha256(prior.metadata_json) !==
          prior.metadata_digest
      ) {
        throw new ContextCoreError(
          `stored metadata integrity mismatch for ${sourceId}`
        );
      }

      if (prior.metadata_digest === null) {
        this.db
          .prepare(`
            UPDATE sources
            SET metadata_digest = ?
            WHERE source_id = ?
          `)
          .run(
            sha256(prior.metadata_json),
            sourceId
          );
      }

      const expectedPriorPolicyDigest =
        indexPolicyDigest(
          sourceId,
          Number(prior.max_chunk_bytes),
          prior.chunk_mode
        );

      if (
        prior.index_policy_digest === null ||
        prior.index_policy_digest !==
          expectedPriorPolicyDigest
      ) {
        throw new ContextCoreError(
          `stored index policy integrity mismatch for ${sourceId}`
        );
      }

      if (prior.chunk_mode !== resolvedChunkMode) {
        throw new ContextCoreError(
          `sourceId ${sourceId} already uses chunkMode ${prior.chunk_mode}`
        );
      }

      this.#acceptRecallIntegrityEpoch();
      return this.#publicRef(sourceId);
    }

    const chunks =
      resolvedChunkMode === "markdown"
        ? chunkMarkdownDeterministic(text, {
            sourceId,
            maxChunkBytes,
          })
        : chunkTextDeterministic(text, {
            sourceId,
            maxChunkBytes,
          });

    const insertSource = this.db.prepare(`
      INSERT INTO sources(
        source_id,
        classification,
        content_digest,
        metadata_json,
        metadata_digest,
        max_chunk_bytes,
        chunk_mode,
        index_policy_digest
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertChunk = this.db.prepare(`
      INSERT INTO chunks(
        chunk_id,
        source_id,
        chunk_index,
        digest,
        bytes,
        content,
        token_count,
        tokens_json,
        structure_kind,
        structure_digest
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertFts = this.db.prepare(`
      INSERT INTO chunks_fts(chunk_id, lexical_text)
      VALUES (?, ?)
    `);

    const insertRecallProjection = this.db.prepare(`
      INSERT INTO recall_projections(
        chunk_id,
        projection_version,
        chunk_digest,
        projection_json,
        projection_digest
      ) VALUES (?, ?, ?, ?, ?)
    `);

    const insertRecallCandidateManifest = this.db.prepare(`
      INSERT INTO recall_candidate_manifests(
        chunk_id, candidate_version, chunk_digest, projection_digest, candidate_json, candidate_digest
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);
    const insertRecallCandidateTerm = this.db.prepare(`
      INSERT INTO recall_candidate_terms(chunk_id, lane, term, candidate_digest)
      VALUES (?, ?, ?, ?)
    `);

    this.db.exec("BEGIN IMMEDIATE");

    try {
      insertSource.run(
        sourceId,
        resolvedClassification,
        contentDigest,
        metadataJson,
        metadataDigest,
        maxChunkBytes,
        resolvedChunkMode,
        indexPolicyDigest(
          sourceId,
          maxChunkBytes,
          resolvedChunkMode
        )
      );

      for (const chunk of chunks) {
        const structureKind =
          chunk.structureKind ?? "text";
        const tokens = lexicalTokensForChunk(chunk.content, {
          chunkMode: resolvedChunkMode,
          structureKind,
        });
        const encodedTokens = tokens.map(encodeToken);

        insertChunk.run(
          chunk.chunkId,
          sourceId,
          chunk.chunkIndex,
          chunk.digest,
          chunk.bytes,
          chunk.content,
          tokens.length,
          JSON.stringify(tokens),
          structureKind,
          chunkStructureDigest(
            sourceId,
            chunk.chunkIndex,
            structureKind
          )
        );

        insertFts.run(
          chunk.chunkId,
          encodedTokens.join(" ")
        );

        const derivedRecall =
          buildDerivedRecallProjection({
            sourceId,
            chunkId: chunk.chunkId,
            chunkIndex: chunk.chunkIndex,
            chunkDigest: chunk.digest,
            content: chunk.content,
            exactTokens: tokens,
          });

        insertRecallProjection.run(
          chunk.chunkId,
          DERIVED_RECALL_PROJECTION_VERSION,
          chunk.digest,
          derivedRecall.serialized,
          derivedRecall.projectionDigest
        );

        const recallCandidate = buildRecallCandidateIndex({
          chunkId: chunk.chunkId,
          chunkDigest: chunk.digest,
          projectionDigest: derivedRecall.projectionDigest,
          exactTokens: tokens,
          derivedRecall,
        });

        insertRecallCandidateManifest.run(
          chunk.chunkId,
          RECALL_CANDIDATE_INDEX_VERSION,
          chunk.digest,
          derivedRecall.projectionDigest,
          recallCandidate.serialized,
          recallCandidate.candidateDigest
        );

        for (const posting of recallCandidate.postings) {
          insertRecallCandidateTerm.run(
            posting.chunkId,
            posting.lane,
            posting.term,
            posting.candidateDigest
          );
        }
      }

      this.db.exec("COMMIT");
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {}
      throw error;
    }

    this.#acceptRecallIntegrityEpoch();
    return this.#publicRef(sourceId);
  }

  #verifyFtsIntegrity() {
    const chunks = this.db
      .prepare(`
        SELECT
          c.chunk_id,
          c.source_id,
          c.chunk_index,
          c.content,
          c.structure_kind,
          c.structure_digest,
          s.max_chunk_bytes,
          s.chunk_mode,
          s.index_policy_digest
        FROM chunks AS c
        JOIN sources AS s
          ON s.source_id = c.source_id
        ORDER BY c.chunk_id ASC
      `)
      .all();

    const ftsRows = this.db
      .prepare(`
        SELECT chunk_id, lexical_text
        FROM chunks_fts
        ORDER BY rowid ASC
      `)
      .all();

    if (ftsRows.length !== chunks.length) {
      throw new ContextCoreError(
        "FTS index integrity mismatch: row count differs from chunk count"
      );
    }

    const ftsByChunk = new Map();

    for (const row of ftsRows) {
      if (ftsByChunk.has(row.chunk_id)) {
        throw new ContextCoreError(
          `FTS index integrity mismatch: duplicate row for ${row.chunk_id}`
        );
      }
      ftsByChunk.set(row.chunk_id, row.lexical_text);
    }

    for (const chunk of chunks) {
      if (!ftsByChunk.has(chunk.chunk_id)) {
        throw new ContextCoreError(
          `FTS index integrity mismatch: missing row for ${chunk.chunk_id}`
        );
      }

      const expectedPolicyDigest =
        indexPolicyDigest(
          chunk.source_id,
          Number(chunk.max_chunk_bytes),
          chunk.chunk_mode
        );

      if (
        chunk.index_policy_digest === null ||
        chunk.index_policy_digest !==
          expectedPolicyDigest
      ) {
        throw new ContextCoreError(
          `stored index policy integrity mismatch for ${chunk.source_id}`
        );
      }

      const expectedStructureDigest =
        chunkStructureDigest(
          chunk.source_id,
          Number(chunk.chunk_index),
          chunk.structure_kind
        );

      if (
        chunk.structure_digest === null ||
        chunk.structure_digest !==
          expectedStructureDigest
      ) {
        throw new ContextCoreError(
          `stored chunk structure integrity mismatch for ${chunk.chunk_id}`
        );
      }

      const expectedLexicalText =
        lexicalTokensForChunk(chunk.content, {
          chunkMode: chunk.chunk_mode,
          structureKind: chunk.structure_kind,
        })
          .map(encodeToken)
          .join(" ");

      if (ftsByChunk.get(chunk.chunk_id) !== expectedLexicalText) {
        throw new ContextCoreError(
          `FTS index integrity mismatch for ${chunk.chunk_id}`
        );
      }
    }
  }

  #candidateRows(terms, match) {
    if (terms.length === 0) return [];

    const query = ftsQuery(terms, match);

    return this.db
      .prepare(`
        SELECT
          c.chunk_id,
          c.source_id,
          c.chunk_index,
          c.digest,
          c.content,
          c.token_count,
          c.tokens_json,
          c.structure_kind,
          s.classification,
          s.metadata_json,
          s.metadata_digest,
          s.chunk_mode
        FROM chunks_fts
        JOIN chunks AS c
          ON c.chunk_id = chunks_fts.chunk_id
        JOIN sources AS s
          ON s.source_id = c.source_id
        WHERE chunks_fts MATCH ?
      `)
      .all(query);
  }

  #documentFrequency(term) {
    const row = this.db
      .prepare(`
        SELECT count(*) AS n
        FROM chunks_fts
        WHERE chunks_fts MATCH ?
      `)
      .get(`"${encodeToken(term)}"`);

    return Number(row.n);
  }

  #prepareRecallScope(metadataEntries) {
    this.db.exec(`
      CREATE TEMP TABLE IF NOT EXISTS recall_scope_sources (
        source_id TEXT PRIMARY KEY
      );
      DELETE FROM recall_scope_sources;
    `);

    const insertScope = this.db.prepare(`
      INSERT INTO recall_scope_sources(source_id)
      VALUES (?)
    `);

    const rows = this.db
      .prepare(`
        SELECT
          source_id,
          classification,
          metadata_json,
          metadata_digest,
          max_chunk_bytes,
          chunk_mode,
          index_policy_digest
        FROM sources
        ORDER BY source_id ASC
      `)
      .all();

    const scope = new Map();

    for (const row of rows) {
      if (
        row.metadata_digest !== null &&
        sha256(row.metadata_json) !==
          row.metadata_digest
      ) {
        throw new ContextCoreError(
          `stored metadata integrity mismatch for ${row.source_id}`
        );
      }

      if (
        metadataEntries.length > 0 &&
        row.metadata_digest === null
      ) {
        throw new ContextCoreError(
          `stored metadata integrity unavailable for scoped source ${row.source_id}`
        );
      }

      const expectedPolicyDigest =
        indexPolicyDigest(
          row.source_id,
          Number(row.max_chunk_bytes),
          row.chunk_mode
        );

      if (
        row.index_policy_digest === null ||
        row.index_policy_digest !==
          expectedPolicyDigest
      ) {
        throw new ContextCoreError(
          `stored index policy integrity mismatch for ${row.source_id}`
        );
      }

      const metadata =
        parseJson(
          row.metadata_json,
          "metadata"
        );

      const included =
        metadataEntries.length === 0 ||
        metadataEntries.every(
          ([key, value]) =>
            Object.prototype.hasOwnProperty.call(
              metadata,
              key
            ) &&
            Object.is(metadata[key], value)
        );

      if (!included) continue;

      insertScope.run(row.source_id);

      scope.set(
        row.source_id,
        Object.freeze({
          classification:
            row.classification,
          metadata,
          metadataJson:
            row.metadata_json,
          maxChunkBytes:
            Number(row.max_chunk_bytes),
          chunkMode:
            row.chunk_mode,
          indexPolicyDigest:
            row.index_policy_digest,
        })
      );
    }

    return scope;
  }

  #candidateIdsForLane(
    lane,
    terms,
    match,
    limit
  ) {
    if (terms.length === 0) return [];

    const uniqueTerms =
      [...new Set(terms)];

    const placeholders =
      uniqueTerms
        .map(() => "?")
        .join(", ");

    const having =
      match === "all"
        ? "HAVING count(DISTINCT t.term) = ?"
        : "";

    const sql = `
      SELECT t.chunk_id
      FROM recall_candidate_terms AS t
      JOIN recall_candidate_manifests AS m
        ON m.chunk_id = t.chunk_id
       AND m.candidate_digest =
         t.candidate_digest
      JOIN chunks AS c
        ON c.chunk_id = t.chunk_id
      JOIN recall_scope_sources AS scope
        ON scope.source_id = c.source_id
      WHERE
        t.lane = ?
        AND t.term IN (${placeholders})
      GROUP BY t.chunk_id
      ${having}
      ORDER BY t.chunk_id ASC
      LIMIT ?
    `;

    const args = [
      lane,
      ...uniqueTerms,
    ];

    if (match === "all") {
      args.push(uniqueTerms.length);
    }

    args.push(limit);

    return this.db
      .prepare(sql)
      .all(...args)
      .map(row => row.chunk_id);
  }

  #installBoundedRecallCandidates(
    plan,
    match,
    maxRecallScanChunks
  ) {
    const laneQueries = [
      [
        RecallCandidateLane.EXACT,
        plan.exactTerms,
      ],
      [
        RecallCandidateLane.IDENTIFIER,
        plan.identifierTerms,
      ],
      [
        RecallCandidateLane.MORPHOLOGY,
        plan.morphologyTerms,
      ],
      [
        RecallCandidateLane.SUBSTRING_FRAGMENT,
        plan.fragmentTerms,
      ],
    ];

    const candidateIds = new Set();

    for (const [lane, terms] of laneQueries) {
      const ids =
        this.#candidateIdsForLane(
          lane,
          terms,
          match,
          maxRecallScanChunks + 1
        );

      if (
        ids.length >
        maxRecallScanChunks
      ) {
        throw new ContextCoreError(
          `tiered recall candidate work exceeds maxRecallScanChunks ${maxRecallScanChunks}`
        );
      }

      for (const chunkId of ids) {
        candidateIds.add(chunkId);

        if (
          candidateIds.size >
          maxRecallScanChunks
        ) {
          throw new ContextCoreError(
            `tiered recall candidate work exceeds maxRecallScanChunks ${maxRecallScanChunks}`
          );
        }
      }
    }

    this.db.exec(`
      CREATE TEMP TABLE IF NOT EXISTS recall_query_candidates (
        chunk_id TEXT PRIMARY KEY
      );
      DELETE FROM recall_query_candidates;
    `);

    const insertCandidate =
      this.db.prepare(`
        INSERT INTO recall_query_candidates(
          chunk_id
        ) VALUES (?)
      `);

    for (const chunkId of candidateIds) {
      insertCandidate.run(chunkId);
    }

    return candidateIds.size;
  }

  #laneCorpusStats(lane, terms) {
    const countRow = this.db
      .prepare(`
        SELECT count(*) AS n
        FROM chunks AS c
        JOIN recall_scope_sources AS scope
          ON scope.source_id = c.source_id
      `)
      .get();

    const documentCount =
      Number(countRow.n);

    let totalLength;

    if (lane === RecallCandidateLane.EXACT) {
      const row = this.db
        .prepare(`
          SELECT
            COALESCE(
              sum(c.token_count),
              0
            ) AS total_length
          FROM chunks AS c
          JOIN recall_scope_sources AS scope
            ON scope.source_id =
              c.source_id
        `)
        .get();

      totalLength =
        Number(row.total_length);
    } else {
      const row = this.db
        .prepare(`
          SELECT
            COALESCE(
              sum(
                COALESCE(
                  lane_counts.term_count,
                  0
                )
              ),
              0
            ) AS total_length
          FROM chunks AS c
          JOIN recall_scope_sources AS scope
            ON scope.source_id =
              c.source_id
          LEFT JOIN (
            SELECT
              t.chunk_id,
              count(*) AS term_count
            FROM recall_candidate_terms AS t
            JOIN recall_candidate_manifests AS m
              ON m.chunk_id = t.chunk_id
             AND m.candidate_digest =
               t.candidate_digest
            WHERE t.lane = ?
            GROUP BY t.chunk_id
          ) AS lane_counts
            ON lane_counts.chunk_id =
              c.chunk_id
        `)
        .get(lane);

      totalLength =
        Number(row.total_length);
    }

    const documentFrequency =
      new Map(
        terms.map(term => [term, 0])
      );

    if (terms.length > 0) {
      const uniqueTerms =
        [...new Set(terms)];

      const placeholders =
        uniqueTerms
          .map(() => "?")
          .join(", ");

      const rows = this.db
        .prepare(`
          SELECT
            t.term,
            count(DISTINCT t.chunk_id)
              AS n
          FROM recall_candidate_terms AS t
          JOIN recall_candidate_manifests AS m
            ON m.chunk_id = t.chunk_id
           AND m.candidate_digest =
             t.candidate_digest
          JOIN chunks AS c
            ON c.chunk_id = t.chunk_id
          JOIN recall_scope_sources AS scope
            ON scope.source_id =
              c.source_id
          WHERE
            t.lane = ?
            AND t.term IN (${placeholders})
          GROUP BY t.term
        `)
        .all(
          lane,
          ...uniqueTerms
        );

      for (const row of rows) {
        documentFrequency.set(
          row.term,
          Number(row.n)
        );
      }
    }

    return Object.freeze({
      documentCount,
      averageLength:
        documentCount === 0
          ? 0
          : totalLength /
            documentCount,
      documentFrequency,
    });
  }

  #loadRecallCandidateDocuments(scope) {
    const rows = this.db
      .prepare(`
        SELECT
          c.chunk_id,
          c.source_id,
          c.chunk_index,
          c.digest,
          c.content,
          c.token_count,
          c.tokens_json,
          c.structure_kind,
          c.structure_digest,
          s.classification,
          s.metadata_json,
          s.max_chunk_bytes,
          s.chunk_mode,
          s.index_policy_digest,
          rp.projection_version,
          rp.chunk_digest AS projection_chunk_digest,
          rp.projection_json,
          rp.projection_digest,
          m.candidate_version,
          m.chunk_digest AS candidate_chunk_digest,
          m.projection_digest AS candidate_projection_digest,
          m.candidate_json,
          m.candidate_digest
        FROM recall_query_candidates AS q
        JOIN chunks AS c
          ON c.chunk_id = q.chunk_id
        JOIN sources AS s
          ON s.source_id = c.source_id
        JOIN recall_projections AS rp
          ON rp.chunk_id = c.chunk_id
        JOIN recall_candidate_manifests AS m
          ON m.chunk_id = c.chunk_id
        ORDER BY
          c.source_id ASC,
          c.chunk_index ASC,
          c.chunk_id ASC
      `)
      .all();

    const selectTerms =
      this.db.prepare(`
        SELECT
          chunk_id,
          lane,
          term,
          candidate_digest
        FROM recall_candidate_terms
        WHERE chunk_id = ?
        ORDER BY
          lane ASC,
          term ASC,
          chunk_id ASC
      `);

    const documents = [];

    for (const row of rows) {
      const scoped =
        scope.get(row.source_id);

      if (!scoped) {
        throw new ContextCoreError(
          `tiered recall candidate escaped metadata scope for ${row.chunk_id}`
        );
      }

      if (
        row.metadata_json !==
        scoped.metadataJson ||
        row.classification !==
        scoped.classification
      ) {
        throw new ContextCoreError(
          `stored source scope drift for ${row.source_id}`
        );
      }

      const expectedPolicyDigest =
        indexPolicyDigest(
          row.source_id,
          Number(row.max_chunk_bytes),
          row.chunk_mode
        );

      if (
        row.index_policy_digest === null ||
        row.index_policy_digest !==
          expectedPolicyDigest
      ) {
        throw new ContextCoreError(
          `stored index policy integrity mismatch for ${row.source_id}`
        );
      }

      const expectedStructureDigest =
        chunkStructureDigest(
          row.source_id,
          Number(row.chunk_index),
          row.structure_kind
        );

      if (
        row.structure_digest === null ||
        row.structure_digest !==
          expectedStructureDigest
      ) {
        throw new ContextCoreError(
          `stored chunk structure integrity mismatch for ${row.chunk_id}`
        );
      }

      const canonicalTokens =
        lexicalTokensForChunk(
          row.content,
          {
            chunkMode:
              row.chunk_mode,
            structureKind:
              row.structure_kind,
          }
        );

      const storedTokens =
        parseJson(
          row.tokens_json,
          "tokens"
        );

      const expectedDigest =
        sha256(
          `${row.source_id}\0${row.chunk_index}\0${row.content}`
        );

      if (
        expectedDigest !== row.digest
      ) {
        throw new ContextCoreError(
          `stored chunk integrity mismatch for ${row.chunk_id}`
        );
      }

      if (
        !Array.isArray(storedTokens) ||
        storedTokens.length !==
          canonicalTokens.length ||
        storedTokens.some(
          (token, index) =>
            token !==
            canonicalTokens[index]
        )
      ) {
        throw new ContextCoreError(
          `stored token integrity mismatch for ${row.chunk_id}`
        );
      }

      if (
        Number(row.token_count) !==
        canonicalTokens.length
      ) {
        throw new ContextCoreError(
          `stored token count mismatch for ${row.chunk_id}`
        );
      }

      if (
        row.projection_version !==
        DERIVED_RECALL_PROJECTION_VERSION
      ) {
        throw new ContextCoreError(
          `stored derived recall projection version mismatch for ${row.chunk_id}`
        );
      }

      if (
        row.projection_chunk_digest !==
        row.digest
      ) {
        throw new ContextCoreError(
          `stored derived recall projection chunk digest mismatch for ${row.chunk_id}`
        );
      }

      const expectedProjection =
        buildDerivedRecallProjection({
          sourceId: row.source_id,
          chunkId: row.chunk_id,
          chunkIndex:
            Number(row.chunk_index),
          chunkDigest: row.digest,
          content: row.content,
          exactTokens:
            canonicalTokens,
        });

      const derivedRecall =
        decodeDerivedRecallProjection({
          serialized:
            row.projection_json,
          projectionDigest:
            row.projection_digest,
          expectedSourceId:
            row.source_id,
          expectedChunkId:
            row.chunk_id,
          expectedChunkIndex:
            Number(row.chunk_index),
          expectedChunkDigest:
            row.digest,
        });

      if (
        derivedRecall.projectionDigest !==
        expectedProjection.projectionDigest
      ) {
        throw new ContextCoreError(
          `stored derived recall projection semantic mismatch for ${row.chunk_id}`
        );
      }

      if (
        row.candidate_version !==
        RECALL_CANDIDATE_INDEX_VERSION
      ) {
        throw new ContextCoreError(
          `stored recall candidate index version mismatch for ${row.chunk_id}`
        );
      }

      if (
        row.candidate_chunk_digest !==
        row.digest
      ) {
        throw new ContextCoreError(
          `stored recall candidate index chunk digest mismatch for ${row.chunk_id}`
        );
      }

      if (
        row.candidate_projection_digest !==
        row.projection_digest
      ) {
        throw new ContextCoreError(
          `stored recall candidate index projection digest mismatch for ${row.chunk_id}`
        );
      }

      const expectedCandidate =
        buildRecallCandidateIndex({
          chunkId: row.chunk_id,
          chunkDigest: row.digest,
          projectionDigest:
            expectedProjection.projectionDigest,
          exactTokens:
            canonicalTokens,
          derivedRecall:
            expectedProjection,
        });

      const decodedCandidate =
        decodeRecallCandidateIndex({
          serialized:
            row.candidate_json,
          candidateDigest:
            row.candidate_digest,
          expectedChunkId:
            row.chunk_id,
          expectedChunkDigest:
            row.digest,
          expectedProjectionDigest:
            row.projection_digest,
        });

      if (
        decodedCandidate.candidateDigest !==
        expectedCandidate.candidateDigest
      ) {
        throw new ContextCoreError(
          `stored recall candidate index semantic mismatch for ${row.chunk_id}`
        );
      }

      const actualTerms =
        selectTerms.all(
          row.chunk_id
        );

      const expectedTerms =
        expectedCandidate.postings.map(
          posting => ({
            chunk_id:
              posting.chunkId,
            lane:
              posting.lane,
            term:
              posting.term,
            candidate_digest:
              posting.candidateDigest,
          })
        );

      if (
        actualTerms.length !==
          expectedTerms.length ||
        actualTerms.some(
          (actual, index) => {
            const wanted =
              expectedTerms[index];

            return (
              actual.chunk_id !==
                wanted.chunk_id ||
              actual.lane !==
                wanted.lane ||
              actual.term !==
                wanted.term ||
              actual.candidate_digest !==
                wanted.candidate_digest
            );
          }
        )
      ) {
        throw new ContextCoreError(
          `stored recall candidate term integrity mismatch for ${row.chunk_id}`
        );
      }

      documents.push({
        exactTokens:
          canonicalTokens,
        recall: {
          identifierTokens:
            expectedProjection.identifierTokens,
          morphologyTokens:
            expectedProjection.morphologyTokens,
          substringValues:
            expectedProjection.substringValues,
          fragmentTokens:
            expectedProjection.fragmentTokens,
        },
        result: {
          sourceId:
            row.source_id,
          chunkId:
            row.chunk_id,
          chunkIndex:
            Number(row.chunk_index),
          classification:
            row.classification,
          content:
            row.content,
          contentDigest:
            row.digest,
          metadata: {
            ...scoped.metadata,
          },
        },
      });
    }

    return documents;
  }

  #searchTieredRecall(
    query,
    {
      maxResults,
      maxBytes,
      match,
      metadataEntries,
      maxRecallScanChunks,
    }
  ) {
    const plan =
      buildRecallQueryPlan(query);

    const scope =
      this.#prepareRecallScope(
        metadataEntries
      );

    this.#installBoundedRecallCandidates(
      plan,
      match,
      maxRecallScanChunks
    );

    const documents =
      this.#loadRecallCandidateDocuments(
        scope
      );

    const corpusStatsByLane = {
      [RecallMatchKind.EXACT]:
        this.#laneCorpusStats(
          RecallCandidateLane.EXACT,
          plan.exactTerms
        ),
      [RecallMatchKind.IDENTIFIER]:
        this.#laneCorpusStats(
          RecallCandidateLane.IDENTIFIER,
          plan.identifierTerms
        ),
      [RecallMatchKind.MORPHOLOGY]:
        this.#laneCorpusStats(
          RecallCandidateLane.MORPHOLOGY,
          plan.morphologyTerms
        ),
    };

    const tiered =
      scoreTieredRecallDocuments({
        documents,
        query,
        match,
        k1: this.k1,
        b: this.b,
        corpusStatsByLane,
      });

    let response = stabilizeUsedBytes({
      query: String(query ?? ""),
      terms: [...tiered.plan.exactTerms],
      match,
      recall: "tiered",
      totalCandidates:
        tiered.results.length,
      omittedResults:
        tiered.results.length,
      results: [],
    });

    if (jsonBytes(response) > maxBytes) {
      throw new ContextBudgetExceeded(
        "retrieval envelope exceeds maxBytes"
      );
    }

    for (const candidate of tiered.results) {
      if (
        response.results.length >=
        maxResults
      ) {
        break;
      }

      const next = stabilizeUsedBytes({
        ...response,
        results: [
          ...response.results,
          candidate,
        ],
        omittedResults:
          tiered.results.length -
          response.results.length -
          1,
      });

      if (jsonBytes(next) <= maxBytes) {
        response = next;
      }
    }

    response = stabilizeUsedBytes({
      ...response,
      omittedResults:
        tiered.results.length -
        response.results.length,
    });

    if (jsonBytes(response) > maxBytes) {
      throw new ContextBudgetExceeded(
        "retrieval response exceeds maxBytes"
      );
    }

    return Object.freeze({
      ...response,
      terms:
        Object.freeze(
          [...response.terms]
        ),
      results:
        Object.freeze(
          response.results.map(
            Object.freeze
          )
        ),
    });
  }

  search(
    query,
    {
      maxResults = 8,
      maxBytes = 4096,
      match = "all",
      metadataEquals,
      recall = "exact",
      maxRecallScanChunks = 4096,
    } = {}
  ) {
    if (!Number.isInteger(maxResults) || maxResults < 1) {
      throw new ContextCoreError("maxResults must be an integer >= 1");
    }
    if (!Number.isInteger(maxBytes) || maxBytes < 128) {
      throw new ContextCoreError("maxBytes must be an integer >= 128");
    }
    if (!["all", "any"].includes(match)) {
      throw new ContextCoreError('match must be "all" or "any"');
    }
    if (!["exact", "tiered"].includes(recall)) {
      throw new ContextCoreError(
        'recall must be "exact" or "tiered"'
      );
    }
    if (
      !Number.isInteger(maxRecallScanChunks) ||
      maxRecallScanChunks < 1
    ) {
      throw new ContextCoreError(
        "maxRecallScanChunks must be an integer >= 1"
      );
    }

    if (
      metadataEquals !== undefined &&
      (
        metadataEquals === null ||
        typeof metadataEquals !== "object" ||
        Array.isArray(metadataEquals)
      )
    ) {
      throw new ContextCoreError(
        "metadataEquals must be an object when provided"
      );
    }

    const metadataEntries = metadataEquals
      ? Object.entries(metadataEquals)
      : [];

    for (const [key, value] of metadataEntries) {
      if (!key) {
        throw new ContextCoreError(
          "metadataEquals keys must be non-empty strings"
        );
      }

      if (
        value !== null &&
        !["string", "number", "boolean"].includes(typeof value)
      ) {
        throw new ContextCoreError(
          "metadataEquals values must be string, number, boolean, or null"
        );
      }

      if (
        typeof value === "number" &&
        !Number.isFinite(value)
      ) {
        throw new ContextCoreError(
          "metadataEquals numeric values must be finite"
        );
      }
    }

    this.#assertRecallIntegrityEpoch();

    if (recall === "tiered") {
      return this.#searchTieredRecall(
        query,
        {
          maxResults,
          maxBytes,
          match,
          metadataEntries,
          maxRecallScanChunks,
        }
      );
    }

    this.#verifyFtsIntegrity();

    const terms = [...new Set(tokenizeLexical(query))];

    const stats = this.db
      .prepare(`
        SELECT
          count(*) AS n,
          coalesce(avg(token_count), 0) AS avg_length
        FROM chunks
      `)
      .get();

    const n = Number(stats.n);
    const avgLength = Number(stats.avg_length);
    const df = new Map(
      terms.map(term => [term, this.#documentFrequency(term)])
    );

    const rows = this.#candidateRows(terms, match);
    const scored = [];

    for (const row of rows) {
      const storedTokens = parseJson(row.tokens_json, "tokens");
      const metadata = parseJson(row.metadata_json, "metadata");

      if (
        row.metadata_digest !== null &&
        sha256(row.metadata_json) !==
          row.metadata_digest
      ) {
        throw new ContextCoreError(
          `stored metadata integrity mismatch for ${row.source_id}`
        );
      }

      if (
        metadataEntries.length > 0 &&
        row.metadata_digest === null
      ) {
        throw new ContextCoreError(
          `stored metadata integrity unavailable for scoped source ${row.source_id}`
        );
      }

      if (
        metadataEntries.length > 0 &&
        !metadataEntries.every(
          ([key, value]) =>
            Object.prototype.hasOwnProperty.call(metadata, key) &&
            Object.is(metadata[key], value)
        )
      ) {
        continue;
      }

      const canonicalTokens =
        lexicalTokensForChunk(row.content, {
          chunkMode: row.chunk_mode,
          structureKind: row.structure_kind,
        });

      const expectedDigest = sha256(
        `${row.source_id}\0${row.chunk_index}\0${row.content}`
      );

      if (expectedDigest !== row.digest) {
        throw new ContextCoreError(
          `stored chunk integrity mismatch for ${row.chunk_id}`
        );
      }

      if (
        !Array.isArray(storedTokens) ||
        storedTokens.length !== canonicalTokens.length ||
        storedTokens.some(
          (token, index) => token !== canonicalTokens[index]
        )
      ) {
        throw new ContextCoreError(
          `stored token integrity mismatch for ${row.chunk_id}`
        );
      }

      if (Number(row.token_count) !== canonicalTokens.length) {
        throw new ContextCoreError(
          `stored token count mismatch for ${row.chunk_id}`
        );
      }

      const tf = frequencies(canonicalTokens);

      const present = terms.filter(
        term => (tf.get(term) ?? 0) > 0
      );

      const eligible =
        terms.length > 0 &&
        (match === "all"
          ? present.length === terms.length
          : present.length > 0);

      if (!eligible) {
        throw new ContextCoreError(
          `FTS candidate/token contract mismatch for ${row.chunk_id}`
        );
      }

      let score = 0;

      for (const term of present) {
        const termFrequency = tf.get(term);
        const documentFrequency = df.get(term);
        const idf = Math.log(
          1 +
            (n - documentFrequency + 0.5) /
              (documentFrequency + 0.5)
        );

        const denominator =
          termFrequency +
          this.k1 *
            (
              1 -
              this.b +
              this.b *
                (avgLength
                  ? Number(row.token_count) / avgLength
                  : 0)
            );

        score +=
          idf *
          (
            (termFrequency * (this.k1 + 1)) /
            denominator
          );
      }

      scored.push({
        sourceId: row.source_id,
        chunkId: row.chunk_id,
        chunkIndex: Number(row.chunk_index),
        classification: row.classification,
        score: Number(score.toFixed(12)),
        content: row.content,
        contentDigest: row.digest,
        metadata,
      });
    }

    scored.sort(
      (a, b) =>
        b.score - a.score ||
        a.sourceId.localeCompare(b.sourceId) ||
        a.chunkIndex - b.chunkIndex ||
        a.chunkId.localeCompare(b.chunkId)
    );

    let response = stabilizeUsedBytes({
      query: String(query ?? ""),
      terms,
      match,
      totalCandidates: scored.length,
      omittedResults: scored.length,
      results: [],
    });

    if (jsonBytes(response) > maxBytes) {
      throw new ContextBudgetExceeded(
        "retrieval envelope exceeds maxBytes"
      );
    }

    for (const candidate of scored) {
      if (response.results.length >= maxResults) break;

      const next = stabilizeUsedBytes({
        ...response,
        results: [...response.results, candidate],
        omittedResults:
          scored.length - response.results.length - 1,
      });

      if (jsonBytes(next) <= maxBytes) {
        response = next;
      }
    }

    response = stabilizeUsedBytes({
      ...response,
      omittedResults:
        scored.length - response.results.length,
    });

    if (jsonBytes(response) > maxBytes) {
      throw new ContextBudgetExceeded(
        "retrieval response exceeds maxBytes"
      );
    }

    return Object.freeze({
      ...response,
      terms: Object.freeze([...response.terms]),
      results: Object.freeze(
        response.results.map(Object.freeze)
      ),
    });
  }
}
