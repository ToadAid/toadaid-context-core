import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

import {
  ContextBudgetExceeded,
  ContextCoreError,
} from "./types.mjs";

const require = createRequire(import.meta.url);

export const ContextEventKind = Object.freeze({
  OBJECTIVE: "OBJECTIVE",
  DECISION: "DECISION",
  ERROR: "ERROR",
  FILE_READ: "FILE_READ",
  FILE_EDIT: "FILE_EDIT",
  GIT_STATE: "GIT_STATE",
  CONSTRAINT: "CONSTRAINT",
  TASK: "TASK",
  EXTERNAL_REF: "EXTERNAL_REF",
});

const VALID_EVENT_KINDS = new Set(
  Object.values(ContextEventKind)
);

const sha256 = text =>
  createHash("sha256")
    .update(text, "utf8")
    .digest("hex");

const utf8Bytes = text =>
  Buffer.byteLength(text, "utf8");

function databaseSyncClass() {
  try {
    const sqlite = require("node:sqlite");
    if (typeof sqlite.DatabaseSync !== "function") {
      throw new Error("DatabaseSync unavailable");
    }
    return sqlite.DatabaseSync;
  } catch (error) {
    throw new ContextCoreError(
      `session event journal requires usable node:sqlite: ${error.message}`
    );
  }
}

function canonicalize(value, seen = new Set()) {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new ContextCoreError(
        "event data numbers must be finite"
      );
    }
    return value;
  }

  if (typeof value === "undefined") {
    throw new ContextCoreError(
      "event data cannot contain undefined"
    );
  }

  if (typeof value !== "object") {
    throw new ContextCoreError(
      "event data must be JSON-compatible"
    );
  }

  if (seen.has(value)) {
    throw new ContextCoreError(
      "event data cannot contain cycles"
    );
  }

  seen.add(value);

  try {
    if (Array.isArray(value)) {
      return value.map(item =>
        canonicalize(item, seen)
      );
    }

    const prototype = Object.getPrototypeOf(value);
    if (
      prototype !== Object.prototype &&
      prototype !== null
    ) {
      throw new ContextCoreError(
        "event data objects must be plain objects"
      );
    }

    const output = {};

    for (const key of Object.keys(value).sort()) {
      output[key] = canonicalize(
        value[key],
        seen
      );
    }

    return output;
  } finally {
    seen.delete(value);
  }
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function requireString(value, label) {
  if (
    typeof value !== "string" ||
    value.trim().length === 0
  ) {
    throw new ContextCoreError(
      `${label} must be a non-empty string`
    );
  }

  return value;
}

function optionalString(value, label) {
  if (value === undefined || value === null) {
    return null;
  }

  return requireString(value, label);
}

function normalizeTimestamp(value) {
  requireString(value, "timestamp");

  const milliseconds = Date.parse(value);

  if (!Number.isFinite(milliseconds)) {
    throw new ContextCoreError(
      "timestamp must be a valid date-time"
    );
  }

  return new Date(milliseconds).toISOString();
}

function normalizeTags(tags = []) {
  if (!Array.isArray(tags)) {
    throw new ContextCoreError(
      "tags must be an array"
    );
  }

  const normalized = tags.map((tag, index) =>
    requireString(tag, `tags[${index}]`)
      .trim()
      .normalize("NFKC")
      .toLowerCase()
  );

  return Object.freeze(
    [...new Set(normalized)].sort()
  );
}

function normalizeMemoryRefs(memoryRefs = []) {
  if (!Array.isArray(memoryRefs)) {
    throw new ContextCoreError(
      "memoryRefs must be an array"
    );
  }

  const normalized = memoryRefs.map(
    (memoryRef, index) =>
      requireString(
        memoryRef,
        `memoryRefs[${index}]`
      )
  );

  return Object.freeze(
    [...new Set(normalized)].sort()
  );
}

function normalizeExactEvidence(
  exactEvidence = []
) {
  if (!Array.isArray(exactEvidence)) {
    throw new ContextCoreError(
      "exactEvidence must be an array"
    );
  }

  const labels = new Set();

  return Object.freeze(
    exactEvidence.map((entry, index) => {
      if (
        !entry ||
        typeof entry !== "object" ||
        Array.isArray(entry)
      ) {
        throw new ContextCoreError(
          `exactEvidence[${index}] must be an object`
        );
      }

      const label = requireString(
        entry.label,
        `exactEvidence[${index}].label`
      );

      if (labels.has(label)) {
        throw new ContextCoreError(
          `duplicate exact evidence label ${label}`
        );
      }

      labels.add(label);

      if (typeof entry.value !== "string") {
        throw new ContextCoreError(
          `exactEvidence[${index}].value must be a string`
        );
      }

      return Object.freeze({
        label,
        value: entry.value,
      });
    })
  );
}

function normalizeImportance(value = 50) {
  if (
    !Number.isInteger(value) ||
    value < 0 ||
    value > 100
  ) {
    throw new ContextCoreError(
      "importance must be an integer from 0 to 100"
    );
  }

  return value;
}

function normalizeBaseEvent(input) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input)
  ) {
    throw new ContextCoreError(
      "event input must be an object"
    );
  }

  const kind = requireString(
    input.kind,
    "kind"
  );

  if (!VALID_EVENT_KINDS.has(kind)) {
    throw new ContextCoreError(
      `unsupported context event kind ${kind}`
    );
  }

  return Object.freeze({
    schemaVersion: 1,
    sessionId: requireString(
      input.sessionId,
      "sessionId"
    ),
    kind,
    timestamp: normalizeTimestamp(
      input.timestamp
    ),
    source: requireString(
      input.source,
      "source"
    ),
    project: optionalString(
      input.project,
      "project"
    ),
    repo: optionalString(
      input.repo,
      "repo"
    ),
    attribution: optionalString(
      input.attribution,
      "attribution"
    ),
    importance: normalizeImportance(
      input.importance
    ),
    text: requireString(
      input.text,
      "text"
    ),
    tags: normalizeTags(input.tags),
    rawRef: optionalString(
      input.rawRef,
      "rawRef"
    ),
    memoryRefs: normalizeMemoryRefs(
      input.memoryRefs
    ),
    exactEvidence: normalizeExactEvidence(
      input.exactEvidence
    ),
    data: canonicalize(
      input.data ?? {}
    ),
    dedupeKey: optionalString(
      input.dedupeKey,
      "dedupeKey"
    ),
  });
}

function eventDigestPayload(event) {
  const {
    eventId: _eventId,
    eventDigest: _eventDigest,
    ...payload
  } = event;

  return payload;
}

function deepFreeze(value) {
  if (
    value === null ||
    typeof value !== "object" ||
    Object.isFrozen(value)
  ) {
    return value;
  }

  for (const child of Object.values(value)) {
    deepFreeze(child);
  }

  return Object.freeze(value);
}

function parseEventJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    throw new ContextCoreError(
      "stored context event JSON is invalid"
    );
  }
}

export class PersistentSessionJournal {
  constructor({
    path,
    maxEventBytes = 8192,
  } = {}) {
    if (!path || typeof path !== "string") {
      throw new ContextCoreError(
        "path must be a non-empty string"
      );
    }

    if (
      !Number.isInteger(maxEventBytes) ||
      maxEventBytes < 512
    ) {
      throw new ContextCoreError(
        "maxEventBytes must be an integer >= 512"
      );
    }

    if (path !== ":memory:") {
      mkdirSync(
        dirname(resolve(path)),
        { recursive: true }
      );
    }

    const DatabaseSync =
      databaseSyncClass();

    this.path = path;
    this.maxEventBytes = maxEventBytes;
    this.db = new DatabaseSync(path);

    try {
      this.#initializeSchema();
    } catch (error) {
      try {
        this.db.close();
      } catch {}

      throw new ContextCoreError(
        `session event journal initialization failed: ${error.message}`
      );
    }
  }

  #initializeSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS context_events (
        session_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        event_id TEXT NOT NULL UNIQUE,
        dedupe_key TEXT,
        input_digest TEXT NOT NULL,
        kind TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        event_digest TEXT NOT NULL,
        event_json TEXT NOT NULL,
        event_bytes INTEGER NOT NULL,
        PRIMARY KEY(session_id, sequence),
        UNIQUE(session_id, dedupe_key)
      );

      CREATE INDEX IF NOT EXISTS idx_context_events_session_kind
        ON context_events(session_id, kind, sequence);

      CREATE TABLE IF NOT EXISTS context_session_heads (
        session_id TEXT PRIMARY KEY,
        event_count INTEGER NOT NULL,
        last_sequence INTEGER NOT NULL,
        last_event_id TEXT NOT NULL,
        last_digest TEXT NOT NULL
      );
    `);
  }

  close() {
    this.db.close();
  }

  #verifySessionIntegrity(sessionId) {
    const head = this.db
      .prepare(`
        SELECT
          event_count,
          last_sequence,
          last_event_id,
          last_digest
        FROM context_session_heads
        WHERE session_id = ?
      `)
      .get(sessionId);

    const rows = this.db
      .prepare(`
        SELECT
          sequence,
          event_id,
          event_digest,
          event_json,
          event_bytes
        FROM context_events
        WHERE session_id = ?
        ORDER BY sequence ASC
      `)
      .all(sessionId);

    if (!head) {
      if (rows.length !== 0) {
        throw new ContextCoreError(
          `session head missing for ${sessionId}`
        );
      }

      return Object.freeze({
        sessionId,
        eventCount: 0,
        lastSequence: 0,
        lastEventId: null,
        lastDigest: null,
      });
    }

    if (
      Number(head.event_count) !==
      rows.length
    ) {
      throw new ContextCoreError(
        `session event count integrity mismatch for ${sessionId}`
      );
    }

    let previousDigest = null;
    let expectedSequence = 1;
    let lastEvent = null;

    for (const row of rows) {
      if (
        Number(row.sequence) !==
        expectedSequence
      ) {
        throw new ContextCoreError(
          `session sequence integrity mismatch for ${sessionId}`
        );
      }

      const event =
        parseEventJson(row.event_json);
      const canonical =
        canonicalJson(event);

      if (canonical !== row.event_json) {
        throw new ContextCoreError(
          `stored event canonicalization mismatch for ${row.event_id}`
        );
      }

      if (
        utf8Bytes(row.event_json) !==
        Number(row.event_bytes)
      ) {
        throw new ContextCoreError(
          `stored event byte count mismatch for ${row.event_id}`
        );
      }

      if (
        event.sessionId !== sessionId ||
        event.sequence !== expectedSequence ||
        event.eventId !== row.event_id ||
        event.eventDigest !==
          row.event_digest
      ) {
        throw new ContextCoreError(
          `stored event identity mismatch for ${row.event_id}`
        );
      }

      if (
        event.prevDigest !==
        previousDigest
      ) {
        throw new ContextCoreError(
          `session hash chain mismatch for ${row.event_id}`
        );
      }

      const recomputedDigest = sha256(
        canonicalJson(
          eventDigestPayload(event)
        )
      );

      if (
        recomputedDigest !==
          event.eventDigest ||
        recomputedDigest !==
          row.event_digest
      ) {
        throw new ContextCoreError(
          `stored event digest mismatch for ${row.event_id}`
        );
      }

      const expectedEventId =
        `${sessionId}:${expectedSequence}:${recomputedDigest.slice(0, 16)}`;

      if (
        expectedEventId !==
        event.eventId
      ) {
        throw new ContextCoreError(
          `stored event id mismatch for ${row.event_id}`
        );
      }

      previousDigest =
        recomputedDigest;
      expectedSequence += 1;
      lastEvent = event;
    }

    if (
      Number(head.last_sequence) !==
        rows.length ||
      head.last_event_id !==
        lastEvent.eventId ||
      head.last_digest !==
        lastEvent.eventDigest
    ) {
      throw new ContextCoreError(
        `session head integrity mismatch for ${sessionId}`
      );
    }

    return Object.freeze({
      sessionId,
      eventCount: rows.length,
      lastSequence: rows.length,
      lastEventId: lastEvent.eventId,
      lastDigest: lastEvent.eventDigest,
    });
  }

  getSessionHead(sessionId) {
    const normalizedSessionId =
      requireString(
        sessionId,
        "sessionId"
      );

    return this.#verifySessionIntegrity(
      normalizedSessionId
    );
  }

  resolveEventReference(
    snapshot,
    reference
  ) {
    if (
      !snapshot ||
      typeof snapshot !== "object" ||
      Array.isArray(snapshot)
    ) {
      throw new ContextCoreError(
        "snapshot must be an object"
      );
    }

    if (
      !reference ||
      typeof reference !== "object" ||
      Array.isArray(reference)
    ) {
      throw new ContextCoreError(
        "event reference must be an object"
      );
    }

    const sessionId =
      requireString(
        snapshot.sessionId,
        "snapshot.sessionId"
      );

    if (
      !Number.isInteger(
        snapshot.lastSequence
      ) ||
      snapshot.lastSequence < 1
    ) {
      throw new ContextCoreError(
        "snapshot.lastSequence must be an integer >= 1"
      );
    }

    const snapshotLastDigest =
      requireString(
        snapshot.lastDigest,
        "snapshot.lastDigest"
      );

    if (
      !Number.isInteger(
        reference.sequence
      ) ||
      reference.sequence < 1 ||
      reference.sequence >
        snapshot.lastSequence
    ) {
      throw new ContextCoreError(
        "event reference sequence is outside snapshot"
      );
    }

    const eventId =
      requireString(
        reference.eventId,
        "reference.eventId"
      );
    const eventDigest =
      requireString(
        reference.eventDigest,
        "reference.eventDigest"
      );

    this.#verifySessionIntegrity(
      sessionId
    );

    const snapshotRow = this.db
      .prepare(`
        SELECT event_digest
        FROM context_events
        WHERE
          session_id = ? AND
          sequence = ?
      `)
      .get(
        sessionId,
        snapshot.lastSequence
      );

    if (
      !snapshotRow ||
      snapshotRow.event_digest !==
        snapshotLastDigest
    ) {
      throw new ContextCoreError(
        "snapshot reference binding mismatch"
      );
    }

    const row = this.db
      .prepare(`
        SELECT
          event_id,
          event_digest,
          event_json
        FROM context_events
        WHERE
          session_id = ? AND
          sequence = ?
      `)
      .get(
        sessionId,
        reference.sequence
      );

    if (
      !row ||
      row.event_id !== eventId ||
      row.event_digest !== eventDigest
    ) {
      throw new ContextCoreError(
        "event reference binding mismatch"
      );
    }

    const event =
      parseEventJson(
        row.event_json
      );

    if (
      Object.prototype.hasOwnProperty.call(
        reference,
        "kind"
      ) &&
      reference.kind !== event.kind
    ) {
      throw new ContextCoreError(
        "event reference kind binding mismatch"
      );
    }

    return deepFreeze(event);
  }

  append(input) {
    const base =
      normalizeBaseEvent(input);
    const inputDigest = sha256(
      canonicalJson(base)
    );

    this.db.exec("BEGIN IMMEDIATE");

    try {
      const head =
        this.#verifySessionIntegrity(
          base.sessionId
        );

      if (base.dedupeKey) {
        const prior = this.db
          .prepare(`
            SELECT
              input_digest,
              event_json
            FROM context_events
            WHERE
              session_id = ? AND
              dedupe_key = ?
          `)
          .get(
            base.sessionId,
            base.dedupeKey
          );

        if (prior) {
          if (
            prior.input_digest !==
            inputDigest
          ) {
            throw new ContextCoreError(
              `dedupeKey ${base.dedupeKey} already refers to different event content`
            );
          }

          const event = deepFreeze(
            parseEventJson(
              prior.event_json
            )
          );

          this.db.exec("COMMIT");
          return event;
        }
      }

      const sequence =
        head.lastSequence + 1;
      const withChain = {
        ...base,
        sequence,
        prevDigest:
          head.lastDigest,
      };

      const eventDigest = sha256(
        canonicalJson(withChain)
      );

      const eventId =
        `${base.sessionId}:${sequence}:${eventDigest.slice(0, 16)}`;

      const event = {
        ...withChain,
        eventId,
        eventDigest,
      };

      const eventJson =
        canonicalJson(event);
      const eventBytes =
        utf8Bytes(eventJson);

      if (
        eventBytes >
        this.maxEventBytes
      ) {
        throw new ContextBudgetExceeded(
          `context event exceeds maxEventBytes: ${eventBytes} > ${this.maxEventBytes}`
        );
      }

      this.db
        .prepare(`
          INSERT INTO context_events(
            session_id,
            sequence,
            event_id,
            dedupe_key,
            input_digest,
            kind,
            timestamp,
            event_digest,
            event_json,
            event_bytes
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          base.sessionId,
          sequence,
          eventId,
          base.dedupeKey,
          inputDigest,
          base.kind,
          base.timestamp,
          eventDigest,
          eventJson,
          eventBytes
        );

      this.db
        .prepare(`
          INSERT INTO context_session_heads(
            session_id,
            event_count,
            last_sequence,
            last_event_id,
            last_digest
          ) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(session_id) DO UPDATE SET
            event_count = excluded.event_count,
            last_sequence = excluded.last_sequence,
            last_event_id = excluded.last_event_id,
            last_digest = excluded.last_digest
        `)
        .run(
          base.sessionId,
          sequence,
          sequence,
          eventId,
          eventDigest
        );

      this.db.exec("COMMIT");

      return deepFreeze(
        parseEventJson(eventJson)
      );
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {}

      throw error;
    }
  }

  listSession(
    sessionId,
    {
      kinds,
      limit = 100,
      newestFirst = false,
    } = {}
  ) {
    const normalizedSessionId =
      requireString(
        sessionId,
        "sessionId"
      );

    if (
      !Number.isInteger(limit) ||
      limit < 1
    ) {
      throw new ContextCoreError(
        "limit must be an integer >= 1"
      );
    }

    let kindSet = null;

    if (kinds !== undefined) {
      if (
        !Array.isArray(kinds) ||
        kinds.length === 0
      ) {
        throw new ContextCoreError(
          "kinds must be a non-empty array when provided"
        );
      }

      kindSet = new Set();

      for (const kind of kinds) {
        if (
          !VALID_EVENT_KINDS.has(
            kind
          )
        ) {
          throw new ContextCoreError(
            `unsupported context event kind ${kind}`
          );
        }

        kindSet.add(kind);
      }
    }

    this.#verifySessionIntegrity(
      normalizedSessionId
    );

    const rows = this.db
      .prepare(`
        SELECT event_json
        FROM context_events
        WHERE session_id = ?
        ORDER BY sequence ASC
      `)
      .all(normalizedSessionId);

    let events = rows.map(row =>
      parseEventJson(
        row.event_json
      )
    );

    if (kindSet) {
      events = events.filter(event =>
        kindSet.has(event.kind)
      );
    }

    if (newestFirst) {
      events.reverse();
    }

    return Object.freeze(
      events
        .slice(0, limit)
        .map(event =>
          deepFreeze(event)
        )
    );
  }
}
