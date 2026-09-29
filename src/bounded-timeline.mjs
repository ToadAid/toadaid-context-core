import { ContextCoreError } from "./types.mjs";

export const BOUNDED_TIMELINE_SCHEMA_VERSION = 1;

export class BoundedTimelineError extends ContextCoreError {
  constructor(message) {
    super(`INVALID_BOUNDED_TIMELINE_QUERY: ${message}`);
    this.name = "BoundedTimelineError";
    this.code = "INVALID_BOUNDED_TIMELINE_QUERY";
  }
}

const EVENT_ID = /^[a-f0-9]{64}$/;

function fail(message) {
  throw new BoundedTimelineError(message);
}

function plainRecord(value, label) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`${label} must be a plain object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail(`${label} must be a plain object`);
  }
  return value;
}

function dataValue(value, key, label) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (
    descriptor === undefined ||
    descriptor.enumerable !== true ||
    !Object.prototype.hasOwnProperty.call(descriptor, "value")
  ) {
    fail(`${label}.${key} must be an enumerable data property`);
  }
  return descriptor.value;
}

function exactDataRecord(value, expected, label) {
  const record = plainRecord(value, label);
  const actual = Reflect.ownKeys(record);
  if (actual.some(key => typeof key !== "string")) {
    fail(`${label} must not contain symbol keys`);
  }
  const actualStrings = actual.slice().sort();
  const wanted = [...expected].sort();
  if (
    actualStrings.length !== wanted.length ||
    actualStrings.some((key, index) => key !== wanted[index])
  ) {
    fail(`${label} must contain exactly: ${wanted.join(", ")}`);
  }
  const result = Object.create(null);
  for (const key of expected) {
    result[key] = dataValue(record, key, label);
  }
  return result;
}

function hasOwn(value, key) {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.prototype.hasOwnProperty.call(value, key)
  );
}

function safeTime(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(`${label} must be a non-negative safe integer`);
  }
  return value;
}

function safeLimit(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 50) {
    fail("limit must be an integer in [1,50]");
  }
  return value;
}

function safeEventId(value, label) {
  if (typeof value !== "string" || !EVENT_ID.test(value)) {
    fail(`${label} must be lowercase SHA-256 hex`);
  }
  return value;
}

function normalizeCursor(value) {
  if (value === undefined) return undefined;
  const parsed = exactDataRecord(value, ["eventId", "sourceRows"], "cursor");
  return Object.freeze({
    eventId: safeEventId(parsed.eventId, "cursor.eventId"),
    sourceRows: safeTime(parsed.sourceRows, "cursor.sourceRows"),
  });
}

function normalizeQuery(value) {
  const record = plainRecord(value, "query");
  const kind = dataValue(record, "kind", "query");

  if (kind === "RECENT") {
    const parsed = exactDataRecord(
      record,
      hasOwn(record, "cursor") ? ["kind", "limit", "cursor"] : ["kind", "limit"],
      "query"
    );
    const cursor = normalizeCursor(parsed.cursor);
    return Object.freeze({
      kind: "RECENT",
      limit: safeLimit(parsed.limit),
      ...(cursor === undefined ? {} : { cursor }),
    });
  }

  if (kind === "BETWEEN") {
    const parsed = exactDataRecord(
      record,
      hasOwn(record, "cursor")
        ? ["kind", "fromMs", "toMs", "limit", "cursor"]
        : ["kind", "fromMs", "toMs", "limit"],
      "query"
    );
    const fromMs = safeTime(parsed.fromMs, "fromMs");
    const toMs = safeTime(parsed.toMs, "toMs");
    if (fromMs > toMs) fail("fromMs cannot be greater than toMs");
    const cursor = normalizeCursor(parsed.cursor);
    return Object.freeze({
      kind: "BETWEEN",
      fromMs,
      toMs,
      limit: safeLimit(parsed.limit),
      ...(cursor === undefined ? {} : { cursor }),
    });
  }

  if (kind === "LATEST_BEFORE") {
    const parsed = exactDataRecord(record, ["kind", "beforeMs"], "query");
    return Object.freeze({
      kind: "LATEST_BEFORE",
      beforeMs: safeTime(parsed.beforeMs, "beforeMs"),
    });
  }

  if (kind === "RELATIVE_TO_ANCHOR") {
    const parsed = exactDataRecord(
      record,
      hasOwn(record, "cursor")
        ? ["kind", "anchorMs", "lookbackMs", "limit", "cursor"]
        : ["kind", "anchorMs", "lookbackMs", "limit"],
      "query"
    );
    const anchorMs = safeTime(parsed.anchorMs, "anchorMs");
    const lookbackMs = safeTime(parsed.lookbackMs, "lookbackMs");
    if (lookbackMs < 1) fail("lookbackMs must be positive");
    if (lookbackMs > anchorMs) fail("lookbackMs cannot reach before epoch zero");
    const cursor = normalizeCursor(parsed.cursor);
    return Object.freeze({
      kind: "RELATIVE_TO_ANCHOR",
      anchorMs,
      lookbackMs,
      limit: safeLimit(parsed.limit),
      ...(cursor === undefined ? {} : { cursor }),
    });
  }

  fail("query.kind is unsupported");
}

function normalizeIntegrity(value) {
  const record = plainRecord(value, "source integrity");
  const expected = hasOwn(record, "unavailableReason")
    ? ["sourceRows", "corruptRows", "invalidRows", "unavailableReason"]
    : ["sourceRows", "corruptRows", "invalidRows"];
  const parsed = exactDataRecord(record, expected, "source integrity");
  const sourceRows = safeTime(parsed.sourceRows, "sourceRows");
  const corruptRows = safeTime(parsed.corruptRows, "corruptRows");
  const invalidRows = safeTime(parsed.invalidRows, "invalidRows");
  let unavailableReason;
  if (parsed.unavailableReason !== undefined) {
    if (
      typeof parsed.unavailableReason !== "string" ||
      parsed.unavailableReason.trim() === ""
    ) {
      fail("unavailableReason must be non-empty when present");
    }
    unavailableReason = parsed.unavailableReason;
  }
  return Object.freeze({
    sourceRows,
    corruptRows,
    invalidRows,
    ...(unavailableReason === undefined ? {} : { unavailableReason }),
  });
}

function normalizeEvent(value) {
  const parsed = exactDataRecord(
    value,
    ["eventId", "knownAt", "observedAt", "occurredAt"],
    "timeline event"
  );
  return Object.freeze({
    eventId: safeEventId(parsed.eventId, "event.eventId"),
    knownAt: safeTime(parsed.knownAt, "event.knownAt"),
    observedAt: safeTime(parsed.observedAt, "event.observedAt"),
    occurredAt:
      parsed.occurredAt === null
        ? null
        : safeTime(parsed.occurredAt, "event.occurredAt"),
  });
}

function compareEvents(left, right) {
  if (left.knownAt !== right.knownAt) return left.knownAt - right.knownAt;
  if (left.observedAt !== right.observedAt) return left.observedAt - right.observedAt;
  const leftOccurred = left.occurredAt ?? Number.MAX_SAFE_INTEGER;
  const rightOccurred = right.occurredAt ?? Number.MAX_SAFE_INTEGER;
  if (leftOccurred !== rightOccurred) return leftOccurred - rightOccurred;
  return left.eventId.localeCompare(right.eventId);
}

function canonicalEvents(values) {
  if (!Array.isArray(values)) fail("events must be an array");
  const events = values.map(normalizeEvent).sort(compareEvents);
  const ids = events.map(event => event.eventId);
  if (new Set(ids).size !== ids.length) {
    fail("events contain duplicate eventId values");
  }
  return events;
}

function cursorIndex(matched, cursorEventId) {
  const index = matched.findIndex(event => event.eventId === cursorEventId);
  if (index < 0) fail("cursor eventId is absent from the matched timeline");
  return index;
}

function pageForward(matched, limit, sourceRows, cursor) {
  const start = cursor === undefined ? 0 : cursorIndex(matched, cursor.eventId) + 1;
  const events = matched.slice(start, start + limit);
  const truncated = start + events.length < matched.length;
  return {
    events,
    truncated,
    nextCursor:
      truncated && events.length > 0
        ? Object.freeze({ eventId: events.at(-1).eventId, sourceRows })
        : null,
  };
}

function pageRecent(matched, limit, sourceRows, cursor) {
  const end = cursor === undefined ? matched.length : cursorIndex(matched, cursor.eventId);
  const start = Math.max(0, end - limit);
  const events = matched.slice(start, end);
  const truncated = start > 0;
  return {
    events,
    truncated,
    nextCursor:
      truncated && events.length > 0
        ? Object.freeze({ eventId: events[0].eventId, sourceRows })
        : null,
  };
}

function statusFor(source, truncated) {
  if (source.unavailableReason !== undefined) return "UNAVAILABLE";
  if (source.corruptRows > 0 || source.invalidRows > 0) return "INCOMPLETE";
  if (truncated) return "TRUNCATED";
  return "COMPLETE";
}

/**
 * Provider-neutral bounded timeline reconstruction.
 *
 * Callers first project richer domain events into exact temporal coordinates.
 * This primitive owns deterministic ordering, bounded selection, source-bound
 * continuation cursors, and completeness classification only. It performs no
 * I/O, reads no clock, persists nothing, and grants no execution authority.
 */
export function queryBoundedTimelineV1(values, queryValue, integrityValue) {
  const query = normalizeQuery(queryValue);
  const source = normalizeIntegrity(integrityValue);

  if (source.unavailableReason !== undefined) {
    return Object.freeze({
      schemaVersion: BOUNDED_TIMELINE_SCHEMA_VERSION,
      artifact: "BoundedTimelineResultV1",
      status: "UNAVAILABLE",
      query,
      source,
      matchedCount: 0,
      returnedCount: 0,
      truncated: false,
      nextCursor: null,
      continuation: "STABLE",
      events: Object.freeze([]),
      authorityGranted: false,
    });
  }

  if (
    query.kind !== "LATEST_BEFORE" &&
    query.cursor !== undefined &&
    query.cursor.sourceRows !== source.sourceRows
  ) {
    return Object.freeze({
      schemaVersion: BOUNDED_TIMELINE_SCHEMA_VERSION,
      artifact: "BoundedTimelineResultV1",
      status: "INCOMPLETE",
      query,
      source,
      matchedCount: 0,
      returnedCount: 0,
      truncated: false,
      nextCursor: null,
      continuation: "SOURCE_CHANGED",
      events: Object.freeze([]),
      authorityGranted: false,
    });
  }

  const events = canonicalEvents(values);
  let matched;
  let page;

  if (query.kind === "RECENT") {
    matched = events;
    page = pageRecent(matched, query.limit, source.sourceRows, query.cursor);
  } else if (query.kind === "BETWEEN") {
    matched = events.filter(
      event => event.knownAt >= query.fromMs && event.knownAt <= query.toMs
    );
    page = pageForward(matched, query.limit, source.sourceRows, query.cursor);
  } else if (query.kind === "LATEST_BEFORE") {
    matched = events.filter(event => event.knownAt < query.beforeMs);
    const latest = matched.at(-1);
    page = {
      events: latest === undefined ? [] : [latest],
      truncated: false,
      nextCursor: null,
    };
  } else {
    const fromMs = query.anchorMs - query.lookbackMs;
    matched = events.filter(
      event => event.knownAt >= fromMs && event.knownAt <= query.anchorMs
    );
    page = pageForward(matched, query.limit, source.sourceRows, query.cursor);
  }

  const frozenEvents = Object.freeze([...page.events]);
  return Object.freeze({
    schemaVersion: BOUNDED_TIMELINE_SCHEMA_VERSION,
    artifact: "BoundedTimelineResultV1",
    status: statusFor(source, page.truncated),
    query,
    source,
    matchedCount: matched.length,
    returnedCount: frozenEvents.length,
    truncated: page.truncated,
    nextCursor: page.nextCursor,
    continuation: "STABLE",
    events: frozenEvents,
    authorityGranted: false,
  });
}
