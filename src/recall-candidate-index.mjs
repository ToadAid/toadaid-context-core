import { createHash } from "node:crypto";

import { ContextCoreError } from "./types.mjs";

export const RECALL_CANDIDATE_INDEX_VERSION = "P3B-P8-P1-V1";

export const RecallCandidateLane = Object.freeze({
  EXACT: "EXACT",
  IDENTIFIER: "IDENTIFIER",
  MORPHOLOGY: "MORPHOLOGY",
  SUBSTRING_FRAGMENT: "SUBSTRING_FRAGMENT",
});

const HEX_64 = /^[0-9a-f]{64}$/;
const PAYLOAD_KEYS = Object.freeze([
  "version",
  "chunkId",
  "chunkDigest",
  "projectionDigest",
  "exactTokens",
  "identifierTokens",
  "morphologyTokens",
  "substringFragmentTokens",
]);

const sha256 = text => createHash("sha256").update(text, "utf8").digest("hex");
const unique = values => [...new Set(values)];

function assertPlainObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ContextCoreError(`${label} must be an object`);
  }
}

function assertExactKeys(value) {
  const actual = Object.keys(value).sort();
  const expected = [...PAYLOAD_KEYS].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new ContextCoreError("recall candidate index has unknown or missing fields");
  }
}

function assertStringArray(value, label) {
  if (!Array.isArray(value) || value.some(item => typeof item !== "string" || item.length === 0)) {
    throw new ContextCoreError(`${label} must be an array of non-empty strings`);
  }
  if (new Set(value).size !== value.length) {
    throw new ContextCoreError(`${label} must not contain duplicates`);
  }
}

function canonicalPayload(value) {
  return {
    version: value.version,
    chunkId: value.chunkId,
    chunkDigest: value.chunkDigest,
    projectionDigest: value.projectionDigest,
    exactTokens: [...value.exactTokens],
    identifierTokens: [...value.identifierTokens],
    morphologyTokens: [...value.morphologyTokens],
    substringFragmentTokens: [...value.substringFragmentTokens],
  };
}

function validatePayload(value) {
  assertPlainObject(value, "recall candidate index");
  assertExactKeys(value);
  if (value.version !== RECALL_CANDIDATE_INDEX_VERSION) {
    throw new ContextCoreError(`unsupported recall candidate index version ${String(value.version)}`);
  }
  if (typeof value.chunkId !== "string" || value.chunkId.length === 0) {
    throw new ContextCoreError("recall candidate index chunkId must be a non-empty string");
  }
  for (const [label, digest] of [["chunkDigest", value.chunkDigest], ["projectionDigest", value.projectionDigest]]) {
    if (typeof digest !== "string" || !HEX_64.test(digest)) {
      throw new ContextCoreError(`recall candidate index ${label} must be lowercase sha256 hex`);
    }
  }
  assertStringArray(value.exactTokens, "exactTokens");
  assertStringArray(value.identifierTokens, "identifierTokens");
  assertStringArray(value.morphologyTokens, "morphologyTokens");
  assertStringArray(value.substringFragmentTokens, "substringFragmentTokens");
  return canonicalPayload(value);
}

function postingsForPayload(payload, candidateDigest) {
  const rows = [];
  for (const [lane, terms] of [
    [RecallCandidateLane.EXACT, payload.exactTokens],
    [RecallCandidateLane.IDENTIFIER, payload.identifierTokens],
    [RecallCandidateLane.MORPHOLOGY, payload.morphologyTokens],
    [RecallCandidateLane.SUBSTRING_FRAGMENT, payload.substringFragmentTokens],
  ]) {
    for (const term of terms) {
      rows.push(Object.freeze({ chunkId: payload.chunkId, lane, term, candidateDigest }));
    }
  }
  rows.sort((a, b) => a.lane.localeCompare(b.lane) || a.term.localeCompare(b.term) || a.chunkId.localeCompare(b.chunkId));
  return Object.freeze(rows);
}

function freezeIndex(payload, serialized, candidateDigest) {
  return Object.freeze({
    ...payload,
    exactTokens: Object.freeze([...payload.exactTokens]),
    identifierTokens: Object.freeze([...payload.identifierTokens]),
    morphologyTokens: Object.freeze([...payload.morphologyTokens]),
    substringFragmentTokens: Object.freeze([...payload.substringFragmentTokens]),
    serialized,
    candidateDigest,
    postings: postingsForPayload(payload, candidateDigest),
  });
}

export function buildRecallCandidateIndex({ chunkId, chunkDigest, projectionDigest, exactTokens, derivedRecall }) {
  assertPlainObject(derivedRecall, "derivedRecall");
  const canonicalExact = unique([...exactTokens]);
  const payload = validatePayload({
    version: RECALL_CANDIDATE_INDEX_VERSION,
    chunkId,
    chunkDigest,
    projectionDigest,
    exactTokens: canonicalExact,
    identifierTokens: unique([...canonicalExact, ...derivedRecall.identifierTokens]),
    morphologyTokens: unique([...derivedRecall.morphologyTokens]),
    substringFragmentTokens: unique([...derivedRecall.fragmentTokens]),
  });
  const serialized = JSON.stringify(payload);
  const candidateDigest = sha256(serialized);
  return freezeIndex(payload, serialized, candidateDigest);
}

export function decodeRecallCandidateIndex({ serialized, candidateDigest, expectedChunkId, expectedChunkDigest, expectedProjectionDigest }) {
  if (typeof serialized !== "string") {
    throw new ContextCoreError("stored recall candidate index JSON is missing");
  }
  if (typeof candidateDigest !== "string" || !HEX_64.test(candidateDigest)) {
    throw new ContextCoreError("stored recall candidate index digest is invalid");
  }
  let parsed;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new ContextCoreError("stored recall candidate index JSON is invalid");
  }
  const payload = validatePayload(parsed);
  const canonical = JSON.stringify(payload);
  const measuredDigest = sha256(canonical);
  if (canonical !== serialized) {
    throw new ContextCoreError("stored recall candidate index serialization is non-canonical");
  }
  if (measuredDigest !== candidateDigest) {
    throw new ContextCoreError("stored recall candidate index integrity mismatch");
  }
  for (const [label, expected, actual] of [
    ["chunkId", expectedChunkId, payload.chunkId],
    ["chunkDigest", expectedChunkDigest, payload.chunkDigest],
    ["projectionDigest", expectedProjectionDigest, payload.projectionDigest],
  ]) {
    if (expected !== undefined && !Object.is(expected, actual)) {
      throw new ContextCoreError(`stored recall candidate index ${label} binding mismatch`);
    }
  }
  return freezeIndex(payload, canonical, measuredDigest);
}
