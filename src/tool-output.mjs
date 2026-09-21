import { createHash } from "node:crypto";

import { prepareContextIngress } from "./ingress.mjs";
import { buildContextIngressReceipt } from "./telemetry.mjs";
import { ContextCoreError } from "./types.mjs";

const sha256 = value =>
  createHash("sha256")
    .update(String(value), "utf8")
    .digest("hex");

function nonEmptyString(name, value) {
  if (
    typeof value !== "string" ||
    value.length === 0
  ) {
    throw new ContextCoreError(
      `${name} must be a non-empty string`
    );
  }

  return value;
}

function bindToolMetadata(
  metadata,
  {
    toolName,
    toolCallId,
  }
) {
  if (
    metadata === null ||
    typeof metadata !== "object" ||
    Array.isArray(metadata)
  ) {
    throw new ContextCoreError(
      "metadata must be an object"
    );
  }

  const bindings = {
    sourceKind: "tool-result",
    toolName,
    toolCallId,
  };

  for (
    const [key, value]
    of Object.entries(bindings)
  ) {
    if (
      Object.prototype.hasOwnProperty.call(
        metadata,
        key
      ) &&
      !Object.is(
        metadata[key],
        value
      )
    ) {
      throw new ContextCoreError(
        `metadata ${key} conflicts with canonical tool-output provenance`
      );
    }
  }

  return Object.freeze({
    ...metadata,
    ...bindings,
  });
}

function toolSourceId(
  toolName,
  toolCallId,
  sourceContentDigest
) {
  const identity =
    JSON.stringify({
      version: 1,
      toolName,
      toolCallId,
      sourceContentDigest,
    });

  return `tool-output:${sha256(identity)}`;
}

/**
 * Route textual output from an already-completed host tool call
 * before that text enters model context.
 *
 * This function does not execute tools and intentionally does not
 * accept host-owned structured result data. The host retains that
 * data separately; only `content` is eligible for model ingress.
 */
export function prepareToolOutputIngress({
  retrieval,
  toolName,
  toolCallId,
  content,
  classification,
  metadata = {},
  maxInlineBytes = 4096,
  previewBytes = 768,
  maxChunkBytes = 2048,
  chunkMode = "plain",
  eventId,
  observedAt,
} = {}) {
  const canonicalToolName =
    nonEmptyString(
      "toolName",
      toolName
    );

  const canonicalToolCallId =
    nonEmptyString(
      "toolCallId",
      toolCallId
    );

  if (typeof content !== "string") {
    throw new ContextCoreError(
      "content must be a string containing the exact model-bound tool output"
    );
  }

  const sourceContentDigest =
    sha256(content);

  const sourceId =
    toolSourceId(
      canonicalToolName,
      canonicalToolCallId,
      sourceContentDigest
    );

  const boundMetadata =
    bindToolMetadata(
      metadata,
      {
        toolName:
          canonicalToolName,
        toolCallId:
          canonicalToolCallId,
      }
    );

  const ingress =
    prepareContextIngress({
      retrieval,
      sourceId,
      content,
      classification,
      metadata: boundMetadata,
      maxInlineBytes,
      previewBytes,
      maxChunkBytes,
      chunkMode,
    });

  const receipt =
    buildContextIngressReceipt(
      ingress,
      {
        eventId,
        observedAt,
      }
    );

  return Object.freeze({
    version: 1,
    kind: "TOOL_OUTPUT_INGRESS",
    toolName:
      canonicalToolName,
    toolCallId:
      canonicalToolCallId,
    sourceId,
    classification:
      ingress.classification,
    mode:
      ingress.mode,
    reason:
      ingress.reason,
    modelText:
      ingress.contextText,
    rawBytes:
      ingress.rawBytes,
    modelBytes:
      ingress.contextBytes,
    bytesAvoided:
      ingress.bytesAvoided,
    ingress,
    receipt,
  });
}
