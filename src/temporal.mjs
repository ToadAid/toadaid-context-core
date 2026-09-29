import {
  ContextCoreError,
} from "./types.mjs";

export class TemporalShapeError extends ContextCoreError {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "TemporalShapeError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new TemporalShapeError(
    code,
    message
  );
}

function record(value, label, code) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (
      Object.getPrototypeOf(value) !==
        Object.prototype &&
      Object.getPrototypeOf(value) !==
        null
    )
  ) {
    fail(
      code,
      `${label} must be a plain object`
    );
  }

  return value;
}

function exactDataFields(
  value,
  expected,
  label,
  code
) {
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.some(
      key => typeof key !== "string"
    )
  ) {
    fail(
      code,
      `${label} has unknown or missing fields`
    );
  }

  const actual = [...ownKeys].sort();
  const wanted = [...expected].sort();

  if (
    actual.length !== wanted.length ||
    actual.some(
      (key, index) =>
        key !== wanted[index]
    )
  ) {
    fail(
      code,
      `${label} has unknown or missing fields`
    );
  }

  const fields = Object.create(null);
  for (const key of expected) {
    const descriptor =
      Object.getOwnPropertyDescriptor(
        value,
        key
      );

    if (
      descriptor === undefined ||
      descriptor.enumerable !== true ||
      !Object.prototype.hasOwnProperty.call(
        descriptor,
        "value"
      )
    ) {
      fail(
        code,
        `${label}.${key} must be an enumerable data property`
      );
    }

    fields[key] = descriptor.value;
  }

  return fields;
}

function dataProperty(
  value,
  key,
  label,
  code
) {
  const descriptor =
    Object.getOwnPropertyDescriptor(
      value,
      key
    );

  if (
    descriptor === undefined ||
    descriptor.enumerable !== true ||
    !Object.prototype.hasOwnProperty.call(
      descriptor,
      "value"
    )
  ) {
    fail(
      code,
      `${label}.${key} must be an enumerable data property`
    );
  }

  return descriptor.value;
}

function timestamp(value, label, code) {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    fail(
      code,
      `${label} must be a non-negative safe integer`
    );
  }

  return value;
}

function interval(value, label, code) {
  const fields = exactDataFields(
    value,
    ["kind", "startAt", "endAt"],
    label,
    code
  );

  const startAt = timestamp(
    fields.startAt,
    `${label}.startAt`,
    code
  );
  const endAt = fields.endAt === null
    ? null
    : timestamp(
      fields.endAt,
      `${label}.endAt`,
      code
    );

  if (
    endAt !== null &&
    startAt > endAt
  ) {
    fail(
      code,
      `${label}.startAt cannot be after endAt`
    );
  }

  return Object.freeze({
    kind: "INTERVAL",
    startAt,
    endAt,
  });
}

/**
 * Validate one explicit instant without consulting a clock or inventing a
 * fallback. UNKNOWN remains a distinct canonical value.
 */
export function validateTemporalInstant(
  value
) {
  const code =
    "INVALID_TEMPORAL_INSTANT";
  const candidate = record(
    value,
    "temporal instant",
    code
  );

  const kind = dataProperty(
    candidate,
    "kind",
    "temporal instant",
    code
  );

  if (kind === "UNKNOWN") {
    exactDataFields(
      candidate,
      ["kind"],
      "temporal instant",
      code
    );
    return Object.freeze({
      kind: "UNKNOWN",
    });
  }

  if (kind !== "KNOWN") {
    fail(
      code,
      "temporal instant kind is unsupported"
    );
  }

  const fields = exactDataFields(
    candidate,
    ["kind", "at"],
    "temporal instant",
    code
  );
  return Object.freeze({
    kind: "KNOWN",
    at: timestamp(
      fields.at,
      "temporal instant.at",
      code
    ),
  });
}

/**
 * Validate when an event occurred. This shape does not imply observation,
 * receipt, recording, freshness, or authority semantics.
 */
export function validateTemporalEventTime(
  value
) {
  const code =
    "INVALID_TEMPORAL_EVENT_TIME";
  const candidate = record(
    value,
    "temporal event time",
    code
  );

  const kind = dataProperty(
    candidate,
    "kind",
    "temporal event time",
    code
  );

  if (kind === "UNKNOWN") {
    exactDataFields(
      candidate,
      ["kind"],
      "temporal event time",
      code
    );
    return Object.freeze({
      kind: "UNKNOWN",
    });
  }

  if (kind === "POINT") {
    const fields = exactDataFields(
      candidate,
      ["kind", "at"],
      "temporal event time",
      code
    );
    return Object.freeze({
      kind: "POINT",
      at: timestamp(
        fields.at,
        "temporal event time.at",
        code
      ),
    });
  }

  if (kind === "INTERVAL") {
    return interval(
      candidate,
      "temporal event time",
      code
    );
  }

  fail(
    code,
    "temporal event time kind is unsupported"
  );
}

/**
 * Validate a declared point or closed/open-ended interval. Validity is only a
 * temporal shape: it is not a freshness, TTL, currentness, or staleness rule.
 */
export function validateTemporalValidity(
  value
) {
  const code =
    "INVALID_TEMPORAL_VALIDITY";
  const candidate = record(
    value,
    "temporal validity",
    code
  );

  const kind = dataProperty(
    candidate,
    "kind",
    "temporal validity",
    code
  );

  if (kind === "POINT") {
    const fields = exactDataFields(
      candidate,
      ["kind", "at"],
      "temporal validity",
      code
    );
    return Object.freeze({
      kind: "POINT",
      at: timestamp(
        fields.at,
        "temporal validity.at",
        code
      ),
    });
  }

  if (kind === "INTERVAL") {
    return interval(
      candidate,
      "temporal validity",
      code
    );
  }

  fail(
    code,
    "temporal validity kind is unsupported"
  );
}
