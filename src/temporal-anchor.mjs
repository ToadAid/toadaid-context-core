import {
  ContextCoreError,
} from "./types.mjs";

const MAX_EPOCH_MS =
  8_640_000_000_000_000;

export const TEMPORAL_ANCHOR_SCHEMA_VERSION =
  "TEMPORAL_ANCHOR_V1";
export const TEMPORAL_SOURCE_SYSTEM_WALL_CLOCK =
  "SYSTEM_WALL_CLOCK";

export class TemporalAnchorError extends ContextCoreError {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "TemporalAnchorError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new TemporalAnchorError(code, message);
}

function plainRecord(value, label) {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    fail("TEMPORAL_INVALID_SHAPE", `${label} must be a plain object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (
    prototype !== Object.prototype &&
    prototype !== null
  ) {
    fail("TEMPORAL_INVALID_SHAPE", `${label} must be a plain object`);
  }
  return value;
}

function exactDataRecord(value, required, optional, label) {
  const record = plainRecord(value, label);
  const ownKeys = Reflect.ownKeys(record);
  if (ownKeys.some(key => typeof key !== "string")) {
    fail("TEMPORAL_INVALID_SHAPE", `${label} must not contain symbol keys`);
  }

  const allowed = new Set([...required, ...optional]);
  for (const key of ownKeys) {
    if (!allowed.has(key)) {
      fail("TEMPORAL_INVALID_SHAPE", `${label} contains unsupported field: ${key}`);
    }
  }

  const out = Object.create(null);
  for (const key of required) {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (
      descriptor === undefined ||
      descriptor.enumerable !== true ||
      !Object.prototype.hasOwnProperty.call(descriptor, "value")
    ) {
      fail("TEMPORAL_INVALID_SHAPE", `${label}.${key} must be an enumerable data property`);
    }
    out[key] = descriptor.value;
  }

  for (const key of optional) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) {
      continue;
    }
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (
      descriptor.enumerable !== true ||
      !Object.prototype.hasOwnProperty.call(descriptor, "value")
    ) {
      fail("TEMPORAL_INVALID_SHAPE", `${label}.${key} must be an enumerable data property`);
    }
    out[key] = descriptor.value;
  }

  return out;
}

function assertEpochMs(label, value) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    Math.abs(value) > MAX_EPOCH_MS
  ) {
    fail("TEMPORAL_INVALID_EPOCH", label);
  }
  return value;
}

function assertTimezone(tz) {
  if (
    typeof tz !== "string" ||
    tz.trim() === ""
  ) {
    fail("TEMPORAL_INVALID_TIMEZONE", "timezone must be non-empty");
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(0);
  } catch {
    fail("TEMPORAL_INVALID_TIMEZONE", tz);
  }
  return tz;
}

function normalizeExternalEvidence(value) {
  if (value === undefined) return undefined;

  const parsed = exactDataRecord(
    value,
    ["source", "referenceTimeMs", "observedAtMs", "maxAgeMs", "maxDriftMs"],
    [],
    "externalEvidence"
  );

  if (
    typeof parsed.source !== "string" ||
    parsed.source.trim() === ""
  ) {
    fail("TEMPORAL_INVALID_EXTERNAL_SOURCE", "externalEvidence.source");
  }

  const referenceTimeMs = assertEpochMs(
    "external.referenceTimeMs",
    parsed.referenceTimeMs
  );
  const observedAtMs = assertEpochMs(
    "external.observedAtMs",
    parsed.observedAtMs
  );

  if (
    typeof parsed.maxAgeMs !== "number" ||
    !Number.isFinite(parsed.maxAgeMs) ||
    parsed.maxAgeMs < 0
  ) {
    fail("TEMPORAL_INVALID_EXTERNAL_MAX_AGE", "externalEvidence.maxAgeMs");
  }

  if (
    typeof parsed.maxDriftMs !== "number" ||
    !Number.isFinite(parsed.maxDriftMs) ||
    parsed.maxDriftMs < 0
  ) {
    fail("TEMPORAL_INVALID_EXTERNAL_MAX_DRIFT", "externalEvidence.maxDriftMs");
  }

  return Object.freeze({
    source: parsed.source,
    referenceTimeMs,
    observedAtMs,
    maxAgeMs: parsed.maxAgeMs,
    maxDriftMs: parsed.maxDriftMs,
  });
}

export function dayKeyInTz(tzValue, atMsValue) {
  const tz = assertTimezone(tzValue);
  const atMs = assertEpochMs("dayKeyInTz.atMs", atMsValue);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(atMs));
}

function tzOffsetMs(tz, atMs) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(atMs));

  const get = type =>
    Number(parts.find(part => part.type === type)?.value ?? 0);

  const wall = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second")
  );

  return wall - atMs;
}

export function localDayStartMs(tzValue, atMsValue) {
  const tz = assertTimezone(tzValue);
  const atMs = assertEpochMs("localDayStartMs.atMs", atMsValue);
  const key = dayKeyInTz(tz, atMs);
  const [y, m, d] = key.split("-").map(Number);
  const utcMidnight = Date.UTC(y, (m ?? 1) - 1, d ?? 1);
  let start = utcMidnight - tzOffsetMs(tz, utcMidnight);
  start = utcMidnight - tzOffsetMs(tz, start);
  return start;
}

export function civilShift(key, days) {
  if (
    typeof key !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(key) ||
    !Number.isInteger(days)
  ) {
    fail("TEMPORAL_INVALID_CIVIL_SHIFT", "civil date or day shift");
  }
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export function relativeDateKey(tz, atMs, dayOffset) {
  if (!Number.isInteger(dayOffset)) {
    fail("TEMPORAL_INVALID_DAY_OFFSET", "dayOffset");
  }
  return civilShift(dayKeyInTz(tz, atMs), dayOffset);
}

function classifyEvidence(nowMs, previousNowMs, externalEvidence) {
  if (
    previousNowMs !== undefined &&
    nowMs < previousNowMs
  ) {
    return Object.freeze({
      evidenceState: "BACKWARD_WALL_CLOCK",
    });
  }

  if (externalEvidence === undefined) {
    return Object.freeze({
      evidenceState: "LOCAL_ONLY",
    });
  }

  const ageMs = nowMs - externalEvidence.observedAtMs;
  const driftMs =
    externalEvidence.referenceTimeMs -
    externalEvidence.observedAtMs;

  if (ageMs < 0) {
    return Object.freeze({
      evidenceState: "CLOCK_DRIFT",
      driftMs,
    });
  }

  if (ageMs > externalEvidence.maxAgeMs) {
    return Object.freeze({
      evidenceState: "EXTERNAL_STALE",
      driftMs,
    });
  }

  if (Math.abs(driftMs) > externalEvidence.maxDriftMs) {
    return Object.freeze({
      evidenceState: "CLOCK_DRIFT",
      driftMs,
    });
  }

  return Object.freeze({
    evidenceState: "EXTERNAL_CONSISTENT",
    driftMs,
  });
}

/**
 * Provider-neutral temporal integrity anchor.
 *
 * The caller supplies the clock instant and timezone. Core does not read the
 * wall clock, retain process state, perform I/O, or render model prompt prose.
 */
export function buildTemporalIntegrityAnchorV1(value) {
  const parsed = exactDataRecord(
    value,
    ["timezone", "nowMs"],
    ["observedAtMs", "previousNowMs", "externalEvidence"],
    "temporal anchor input"
  );

  const timezone = assertTimezone(parsed.timezone);
  const nowMs = assertEpochMs("nowMs", parsed.nowMs);
  const observedAtMs =
    parsed.observedAtMs === undefined
      ? nowMs
      : assertEpochMs("observedAtMs", parsed.observedAtMs);
  const previousNowMs =
    parsed.previousNowMs === undefined
      ? undefined
      : assertEpochMs("previousNowMs", parsed.previousNowMs);

  // Validate optional external evidence before the higher-priority backward
  // wall-clock classification so malformed evidence still fails closed.
  const externalEvidence = normalizeExternalEvidence(parsed.externalEvidence);

  const todayKey = dayKeyInTz(timezone, nowMs);
  const yesterdayKey = civilShift(todayKey, -1);
  const tomorrowKey = civilShift(todayKey, 1);
  const classification = classifyEvidence(
    nowMs,
    previousNowMs,
    externalEvidence
  );

  return Object.freeze({
    schemaVersion: TEMPORAL_ANCHOR_SCHEMA_VERSION,
    nowMs,
    observedAtMs,
    timezone,
    localDate: todayKey,
    source: TEMPORAL_SOURCE_SYSTEM_WALL_CLOCK,
    evidenceState: classification.evidenceState,
    ...(previousNowMs === undefined ? {} : { previousNowMs }),
    ...(externalEvidence === undefined ? {} : { externalEvidence }),
    ...(classification.driftMs === undefined
      ? {}
      : { driftMs: classification.driftMs }),
    todayKey,
    yesterdayKey,
    tomorrowKey,
  });
}
