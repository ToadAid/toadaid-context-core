import { createHash } from "node:crypto";

import {
  ContextCoreError,
} from "./types.mjs";

function parseReference(reference) {
  let parsed = reference;

  if (typeof reference === "string") {
    try {
      parsed = JSON.parse(reference);
    } catch {
      throw new ContextCoreError(
        "context reference string must contain valid JSON"
      );
    }
  }

  if (
    parsed === null ||
    typeof parsed !== "object" ||
    Array.isArray(parsed)
  ) {
    throw new ContextCoreError(
      "context reference must be an object or JSON string"
    );
  }

  if (
    parsed.version !== 1 ||
    parsed.kind !== "CONTEXT_REFERENCE"
  ) {
    throw new ContextCoreError(
      "context reference must be version 1 CONTEXT_REFERENCE"
    );
  }

  if (
    typeof parsed.sourceId !== "string" ||
    parsed.sourceId.length === 0
  ) {
    throw new ContextCoreError(
      "context reference sourceId must be a non-empty string"
    );
  }

  if (
    typeof parsed.contentDigest !== "string" ||
    !/^[0-9a-f]{64}$/.test(
      parsed.contentDigest
    )
  ) {
    throw new ContextCoreError(
      "context reference contentDigest must be a lowercase sha256 hex digest"
    );
  }

  if (
    typeof parsed.classification !== "string" ||
    parsed.classification.length === 0
  ) {
    throw new ContextCoreError(
      "context reference classification must be a non-empty string"
    );
  }

  if (
    !Number.isSafeInteger(parsed.rawBytes) ||
    parsed.rawBytes < 0
  ) {
    throw new ContextCoreError(
      "context reference rawBytes must be a non-negative safe integer"
    );
  }

  return parsed;
}

/**
 * Resolve one previously emitted CONTEXT_REFERENCE back to the exact
 * already-produced source bytes.
 *
 * The caller/runtime explicitly invokes this operation. Context Core never
 * fetches a tool, model, network resource, journal, wallet, or host authority.
 * Reinjection into model context remains a host decision.
 */
export function resolveContextReference({
  retrieval,
  reference,
} = {}) {
  if (
    !retrieval ||
    typeof retrieval.resolveSourceReference !==
      "function"
  ) {
    throw new ContextCoreError(
      "retrieval.resolveSourceReference is required"
    );
  }

  const parsed =
    parseReference(reference);

  const resolved =
    retrieval.resolveSourceReference({
      sourceId: parsed.sourceId,
      contentDigest:
        parsed.contentDigest,
    });

  if (
    resolved.classification !==
    parsed.classification
  ) {
    throw new ContextCoreError(
      `context reference classification mismatch for ${parsed.sourceId}`
    );
  }

  if (
    resolved.bytes !==
    parsed.rawBytes
  ) {
    throw new ContextCoreError(
      `context reference raw byte mismatch for ${parsed.sourceId}`
    );
  }

  return resolved;
}

function rangeSha256(value) {
  return createHash("sha256")
    .update(value)
    .digest("hex");
}

function isUtf8ContinuationByte(value) {
  return (value & 0xc0) === 0x80;
}

/**
 * Resolve a bounded, UTF-8-safe byte range from a CONTEXT_REFERENCE.
 *
 * The complete source is first verified through resolveContextReference(...).
 * This only narrows what a host may return to model-facing context.
 */
export function resolveContextReferenceRange({
  retrieval,
  reference,
  startByte = 0,
  maxBytes = 64 * 1024,
} = {}) {
  if (!Number.isSafeInteger(startByte) || startByte < 0) {
    throw new ContextCoreError(
      "context reference range startByte must be a non-negative safe integer"
    );
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new ContextCoreError(
      "context reference range maxBytes must be a positive safe integer"
    );
  }

  const resolved = resolveContextReference({
    retrieval,
    reference,
  });
  const source = Buffer.from(resolved.content, "utf8");

  if (startByte >= source.length) {
    throw new ContextCoreError(
      `context reference range startByte must be below source byte length ${source.length}`
    );
  }
  if (startByte > 0 && isUtf8ContinuationByte(source[startByte])) {
    throw new ContextCoreError(
      "context reference range startByte splits a UTF-8 code point"
    );
  }

  let endByte = Math.min(
    source.length,
    startByte + maxBytes
  );

  if (endByte < source.length) {
    while (
      endByte > startByte &&
      isUtf8ContinuationByte(source[endByte])
    ) {
      endByte -= 1;
    }
  }

  if (endByte <= startByte) {
    throw new ContextCoreError(
      "context reference range maxBytes is too small for the next UTF-8 code point"
    );
  }

  const returned = source.subarray(
    startByte,
    endByte
  );
  const content = returned.toString("utf8");

  if (!Buffer.from(content, "utf8").equals(returned)) {
    throw new ContextCoreError(
      "context reference range is not valid UTF-8"
    );
  }

  return Object.freeze({
    version: 1,
    kind: "RESOLVED_SOURCE_REFERENCE_RANGE",
    sourceId: resolved.sourceId,
    classification: resolved.classification,
    sourceContentDigest: resolved.contentDigest,
    sourceBytes: resolved.bytes,
    startByte,
    endByte,
    returnedBytes: returned.byteLength,
    returnedContentDigest:
      rangeSha256(content),
    content,
    complete:
      endByte === resolved.bytes,
    metadata: resolved.metadata,
  });
}
