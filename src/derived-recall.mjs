import { createHash } from "node:crypto";

import { buildRecallProjection } from "./recall.mjs";
import { ContextCoreError } from "./types.mjs";

export const DERIVED_RECALL_PROJECTION_VERSION = "P3B-P7-V1";

const sha256 = text =>
  createHash("sha256").update(text, "utf8").digest("hex");

const HEX_64 = /^[0-9a-f]{64}$/;

const PAYLOAD_KEYS = Object.freeze([
  "version",
  "sourceId",
  "chunkId",
  "chunkIndex",
  "chunkDigest",
  "identifierTokens",
  "morphologyTokens",
  "substringValues",
  "fragmentTokens",
]);

function assertPlainObject(value, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new ContextCoreError(`${label} must be an object`);
  }
}

function assertExactKeys(value) {
  const actual = Object.keys(value).sort();
  const expected = [...PAYLOAD_KEYS].sort();

  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new ContextCoreError(
      "derived recall projection has unknown or missing fields"
    );
  }
}

function assertStringArray(value, label) {
  if (
    !Array.isArray(value) ||
    value.some(
      item => typeof item !== "string" || item.length === 0
    )
  ) {
    throw new ContextCoreError(
      `${label} must be an array of non-empty strings`
    );
  }

  if (new Set(value).size !== value.length) {
    throw new ContextCoreError(
      `${label} must not contain duplicates`
    );
  }
}

function canonicalPayload(value) {
  return {
    version: value.version,
    sourceId: value.sourceId,
    chunkId: value.chunkId,
    chunkIndex: value.chunkIndex,
    chunkDigest: value.chunkDigest,
    identifierTokens: [...value.identifierTokens],
    morphologyTokens: [...value.morphologyTokens],
    substringValues: [...value.substringValues],
    fragmentTokens: [...value.fragmentTokens],
  };
}

function validatePayload(value) {
  assertPlainObject(value, "derived recall projection");
  assertExactKeys(value);

  if (value.version !== DERIVED_RECALL_PROJECTION_VERSION) {
    throw new ContextCoreError(
      `unsupported derived recall projection version ${String(value.version)}`
    );
  }

  for (const [label, item] of [
    ["sourceId", value.sourceId],
    ["chunkId", value.chunkId],
  ]) {
    if (typeof item !== "string" || item.length === 0) {
      throw new ContextCoreError(
        `derived recall projection ${label} must be a non-empty string`
      );
    }
  }

  if (
    !Number.isInteger(value.chunkIndex) ||
    value.chunkIndex < 0
  ) {
    throw new ContextCoreError(
      "derived recall projection chunkIndex must be an integer >= 0"
    );
  }

  if (
    typeof value.chunkDigest !== "string" ||
    !HEX_64.test(value.chunkDigest)
  ) {
    throw new ContextCoreError(
      "derived recall projection chunkDigest must be lowercase sha256 hex"
    );
  }

  assertStringArray(
    value.identifierTokens,
    "identifierTokens"
  );
  assertStringArray(
    value.morphologyTokens,
    "morphologyTokens"
  );
  assertStringArray(
    value.substringValues,
    "substringValues"
  );
  assertStringArray(
    value.fragmentTokens,
    "fragmentTokens"
  );

  return canonicalPayload(value);
}

function freezeProjection(payload, serialized, projectionDigest) {
  return Object.freeze({
    ...payload,
    identifierTokens: Object.freeze(
      [...payload.identifierTokens]
    ),
    morphologyTokens: Object.freeze(
      [...payload.morphologyTokens]
    ),
    substringValues: Object.freeze(
      [...payload.substringValues]
    ),
    fragmentTokens: Object.freeze(
      [...payload.fragmentTokens]
    ),
    serialized,
    projectionDigest,
  });
}

export function buildDerivedRecallProjection({
  sourceId,
  chunkId,
  chunkIndex,
  chunkDigest,
  content,
  exactTokens,
}) {
  const recall = buildRecallProjection(
    content,
    { exactTokens }
  );

  const payload = validatePayload({
    version: DERIVED_RECALL_PROJECTION_VERSION,
    sourceId,
    chunkId,
    chunkIndex,
    chunkDigest,
    identifierTokens: [...recall.identifierTokens],
    morphologyTokens: [...recall.morphologyTokens],
    substringValues: [...recall.substringValues],
    fragmentTokens: [...recall.fragmentTokens],
  });

  const serialized = JSON.stringify(payload);
  const projectionDigest = sha256(serialized);

  return freezeProjection(
    payload,
    serialized,
    projectionDigest
  );
}

export function decodeDerivedRecallProjection({
  serialized,
  projectionDigest,
  expectedSourceId,
  expectedChunkId,
  expectedChunkIndex,
  expectedChunkDigest,
}) {
  if (typeof serialized !== "string") {
    throw new ContextCoreError(
      "stored derived recall projection JSON is missing"
    );
  }

  if (
    typeof projectionDigest !== "string" ||
    !HEX_64.test(projectionDigest)
  ) {
    throw new ContextCoreError(
      "stored derived recall projection digest is invalid"
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new ContextCoreError(
      "stored derived recall projection JSON is invalid"
    );
  }

  const payload = validatePayload(parsed);
  const canonical = JSON.stringify(payload);
  const measuredDigest = sha256(canonical);

  if (canonical !== serialized) {
    throw new ContextCoreError(
      "stored derived recall projection serialization is non-canonical"
    );
  }

  if (measuredDigest !== projectionDigest) {
    throw new ContextCoreError(
      "stored derived recall projection integrity mismatch"
    );
  }

  const bindings = [
    ["sourceId", expectedSourceId, payload.sourceId],
    ["chunkId", expectedChunkId, payload.chunkId],
    ["chunkIndex", expectedChunkIndex, payload.chunkIndex],
    ["chunkDigest", expectedChunkDigest, payload.chunkDigest],
  ];

  for (const [label, expected, actual] of bindings) {
    if (expected !== undefined && !Object.is(expected, actual)) {
      throw new ContextCoreError(
        `stored derived recall projection ${label} binding mismatch`
      );
    }
  }

  return freezeProjection(
    payload,
    canonical,
    measuredDigest
  );
}
