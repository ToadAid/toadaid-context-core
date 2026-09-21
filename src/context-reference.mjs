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
