import { createHash } from "node:crypto";

import { classifyInput } from "./classify.mjs";
import {
  ContextClass,
  ContextCoreError,
} from "./types.mjs";

const INDEXABLE = new Set([
  ContextClass.WORKING_CONTEXT,
  ContextClass.BULK_MATERIAL,
  ContextClass.RETRIEVABLE_KNOWLEDGE,
]);

const bytes = text => Buffer.byteLength(String(text ?? ""), "utf8");
const sha256 = text => createHash("sha256").update(String(text ?? ""), "utf8").digest("hex");

function assertIntegerBudget(name, value, minimum) {
  if (!Number.isInteger(value) || value < minimum) {
    throw new ContextCoreError(`${name} must be an integer >= ${minimum}`);
  }
}

function prefixByBytes(text, maxBytes) {
  if (maxBytes <= 0) return "";
  if (bytes(text) <= maxBytes) return text;
  let out = "";
  let used = 0;
  for (const char of text) {
    const charBytes = bytes(char);
    if (used + charBytes > maxBytes) break;
    out += char;
    used += charBytes;
  }
  return out;
}

function inlineResult({ sourceId, classification, content, rawBytes, reason }) {
  const sourceContentDigest = sha256(content);
  return Object.freeze({
    version: 1,
    mode: "INLINE",
    reason,
    sourceId,
    classification,
    sourceContentDigest,
    contextDigest: sourceContentDigest,
    rawBytes,
    contextBytes: rawBytes,
    bytesAvoided: 0,
    contextText: content,
    sourceRef: null,
  });
}

/**
 * Route already-produced information before model ingress.
 * No tools/models/network/shell are executed here.
 */
export function prepareContextIngress({
  retrieval,
  sourceId,
  content,
  classification,
  metadata = {},
  maxInlineBytes = 4096,
  previewBytes = 768,
  maxChunkBytes = 2048,
  chunkMode = "plain",
} = {}) {
  if (!sourceId || typeof sourceId !== "string") {
    throw new ContextCoreError("sourceId must be a non-empty string");
  }

  assertIntegerBudget("maxInlineBytes", maxInlineBytes, 0);
  assertIntegerBudget("previewBytes", previewBytes, 0);
  assertIntegerBudget("maxChunkBytes", maxChunkBytes, 64);

  const text = String(content ?? "");
  const resolvedClassification = classifyInput({ content: text, classification, metadata });
  const rawBytes = bytes(text);

  if (rawBytes <= maxInlineBytes) {
    return inlineResult({
      sourceId,
      classification: resolvedClassification,
      content: text,
      rawBytes,
      reason: "WITHIN_INLINE_BUDGET",
    });
  }

  if (resolvedClassification === ContextClass.EXACT_EVIDENCE) {
    return inlineResult({
      sourceId,
      classification: resolvedClassification,
      content: text,
      rawBytes,
      reason: "EXACT_EVIDENCE_MUST_REMAIN_EXACT",
    });
  }

  if (resolvedClassification === ContextClass.DURABLE_MEMORY_REFERENCE) {
    return inlineResult({
      sourceId,
      classification: resolvedClassification,
      content: text,
      rawBytes,
      reason: "DURABLE_MEMORY_REFERENCE_STAYS_INLINE",
    });
  }

  if (!INDEXABLE.has(resolvedClassification)) {
    return inlineResult({
      sourceId,
      classification: resolvedClassification,
      content: text,
      rawBytes,
      reason: "CLASSIFICATION_NOT_INDEXABLE",
    });
  }

  if (!retrieval || typeof retrieval.addSource !== "function") {
    throw new ContextCoreError("retrieval.addSource is required for diversion");
  }

  const preview = prefixByBytes(text, previewBytes);
  const contentDigest = sha256(text);
  const contextText = JSON.stringify({
    version: 1,
    kind: "CONTEXT_REFERENCE",
    sourceId,
    classification: resolvedClassification,
    contentDigest,
    rawBytes,
    preview,
    previewTruncated: bytes(preview) < rawBytes,
  });
  const contextBytes = bytes(contextText);

  if (contextBytes >= rawBytes) {
    return inlineResult({
      sourceId,
      classification: resolvedClassification,
      content: text,
      rawBytes,
      reason: "DIVERSION_NOT_BYTE_BENEFICIAL",
    });
  }

  const sourceRef = retrieval.addSource({
    sourceId,
    content: text,
    classification: resolvedClassification,
    metadata,
    maxChunkBytes,
    chunkMode,
  });

  if (sourceRef.contentDigest !== contentDigest) {
    throw new ContextCoreError(`retrieval digest mismatch for ${sourceId}`);
  }

  return Object.freeze({
    version: 1,
    mode: "DEFERRED",
    reason: "OVER_INLINE_BUDGET_INDEXED",
    sourceId,
    classification: resolvedClassification,
    sourceContentDigest: contentDigest,
    contextDigest: sha256(contextText),
    rawBytes,
    contextBytes,
    bytesAvoided: rawBytes - contextBytes,
    contextText,
    sourceRef,
  });
}
