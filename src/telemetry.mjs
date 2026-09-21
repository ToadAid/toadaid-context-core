import { createHash } from "node:crypto";

import { ContextCoreError } from "./types.mjs";

const bytes = text =>
  Buffer.byteLength(String(text ?? ""), "utf8");

const sha256 = text =>
  createHash("sha256")
    .update(String(text ?? ""), "utf8")
    .digest("hex");

function assertNonNegativeInteger(name, value) {
  if (!Number.isInteger(value) || value < 0) {
    throw new ContextCoreError(
      `${name} must be a non-negative integer`
    );
  }
}

function assertSha256(name, value) {
  if (
    typeof value !== "string" ||
    !/^[a-f0-9]{64}$/.test(value)
  ) {
    throw new ContextCoreError(
      `${name} must be a lowercase SHA-256 hex digest`
    );
  }
}

function optionalString(name, value) {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string" || value.length === 0) {
    throw new ContextCoreError(
      `${name} must be null or a non-empty string`
    );
  }
  return value;
}

function projectSourceRef(sourceRef) {
  if (!sourceRef || typeof sourceRef !== "object") {
    throw new ContextCoreError(
      "deferred ingress requires a sourceRef"
    );
  }

  if (!Array.isArray(sourceRef.chunks)) {
    throw new ContextCoreError(
      "sourceRef.chunks must be an array"
    );
  }

  assertNonNegativeInteger(
    "sourceRef.chunkCount",
    sourceRef.chunkCount
  );

  if (sourceRef.chunkCount !== sourceRef.chunks.length) {
    throw new ContextCoreError(
      "sourceRef chunk count mismatch"
    );
  }

  if (
    typeof sourceRef.sourceId !== "string" ||
    sourceRef.sourceId.length === 0
  ) {
    throw new ContextCoreError(
      "sourceRef.sourceId is invalid"
    );
  }

  assertSha256(
    "sourceRef.contentDigest",
    sourceRef.contentDigest
  );

  const chunks = sourceRef.chunks.map((chunk, index) => {
    if (!chunk || typeof chunk !== "object") {
      throw new ContextCoreError(
        "sourceRef chunk must be an object"
      );
    }

    if (
      typeof chunk.chunkId !== "string" ||
      chunk.chunkId.length === 0 ||
      typeof chunk.digest !== "string" ||
      chunk.digest.length === 0
    ) {
      throw new ContextCoreError(
        "sourceRef chunk identity is invalid"
      );
    }

    assertNonNegativeInteger(
      "sourceRef chunkIndex",
      chunk.chunkIndex
    );
    assertNonNegativeInteger(
      "sourceRef chunk bytes",
      chunk.bytes
    );
    assertSha256(
      "sourceRef chunk digest",
      chunk.digest
    );

    if (chunk.chunkIndex !== index) {
      throw new ContextCoreError(
        "sourceRef chunk ordering mismatch"
      );
    }

    return {
      chunkId: chunk.chunkId,
      chunkIndex: chunk.chunkIndex,
      digest: chunk.digest,
      bytes: chunk.bytes,
    };
  });

  return {
    sourceId: sourceRef.sourceId,
    classification: sourceRef.classification,
    contentDigest: sourceRef.contentDigest,
    chunkCount: sourceRef.chunkCount,
    chunks,
  };
}

function receiptProjection(receipt) {
  return {
    version: receipt.version,
    kind: receipt.kind,
    eventId: receipt.eventId ?? null,
    observedAt: receipt.observedAt ?? null,
    sourceId: receipt.sourceId,
    classification: receipt.classification,
    mode: receipt.mode,
    reason: receipt.reason,
    sourceContentDigest:
      receipt.sourceContentDigest,
    contextDigest: receipt.contextDigest,
    rawBytes: receipt.rawBytes,
    contextBytes: receipt.contextBytes,
    bytesAvoided: receipt.bytesAvoided,
    chunkCount: receipt.chunkCount,
    sourceRefDigest: receipt.sourceRefDigest,
    receiptDigest: receipt.receiptDigest,
  };
}

function validateIngressResult(result) {
  if (!result || typeof result !== "object") {
    throw new ContextCoreError(
      "ingress result must be an object"
    );
  }

  if (
    typeof result.sourceId !== "string" ||
    result.sourceId.length === 0
  ) {
    throw new ContextCoreError(
      "ingress result sourceId is invalid"
    );
  }

  if (
    result.mode !== "INLINE" &&
    result.mode !== "DEFERRED"
  ) {
    throw new ContextCoreError(
      "ingress result mode is invalid"
    );
  }

  if (typeof result.contextText !== "string") {
    throw new ContextCoreError(
      "ingress result contextText must be a string"
    );
  }

  assertSha256(
    "ingress sourceContentDigest",
    result.sourceContentDigest
  );
  assertSha256(
    "ingress contextDigest",
    result.contextDigest
  );

  assertNonNegativeInteger(
    "ingress rawBytes",
    result.rawBytes
  );
  assertNonNegativeInteger(
    "ingress contextBytes",
    result.contextBytes
  );
  assertNonNegativeInteger(
    "ingress bytesAvoided",
    result.bytesAvoided
  );

  const measuredContextBytes =
    bytes(result.contextText);

  if (measuredContextBytes !== result.contextBytes) {
    throw new ContextCoreError(
      "ingress context byte measurement mismatch"
    );
  }

  const measuredContextDigest =
    sha256(result.contextText);

  if (measuredContextDigest !== result.contextDigest) {
    throw new ContextCoreError(
      "ingress context digest mismatch"
    );
  }

  if (
    result.bytesAvoided !==
    result.rawBytes - result.contextBytes
  ) {
    throw new ContextCoreError(
      "ingress byte accounting mismatch"
    );
  }

  if (result.mode === "INLINE") {
    if (result.sourceRef !== null) {
      throw new ContextCoreError(
        "inline ingress must not carry a sourceRef"
      );
    }

    if (
      result.rawBytes !== result.contextBytes ||
      result.bytesAvoided !== 0
    ) {
      throw new ContextCoreError(
        "inline ingress cannot claim avoided bytes"
      );
    }

    if (
      result.sourceContentDigest !==
      result.contextDigest
    ) {
      throw new ContextCoreError(
        "inline source/context digest mismatch"
      );
    }

    return {
      sourceContentDigest:
        result.sourceContentDigest,
      contextDigest: result.contextDigest,
      chunkCount: 0,
      sourceRefDigest: null,
    };
  }

  const sourceProjection =
    projectSourceRef(result.sourceRef);

  if (
    sourceProjection.sourceId !== result.sourceId
  ) {
    throw new ContextCoreError(
      "deferred sourceRef sourceId mismatch"
    );
  }

  if (
    sourceProjection.classification !==
    result.classification
  ) {
    throw new ContextCoreError(
      "deferred sourceRef classification mismatch"
    );
  }

  if (
    sourceProjection.contentDigest !==
    result.sourceContentDigest
  ) {
    throw new ContextCoreError(
      "deferred source content digest mismatch"
    );
  }

  let contextReference;
  try {
    contextReference = JSON.parse(
      result.contextText
    );
  } catch {
    throw new ContextCoreError(
      "deferred context reference JSON is invalid"
    );
  }

  if (
    contextReference?.version !== 1 ||
    contextReference?.kind !==
      "CONTEXT_REFERENCE" ||
    contextReference?.sourceId !==
      result.sourceId ||
    contextReference?.classification !==
      result.classification ||
    contextReference?.contentDigest !==
      result.sourceContentDigest ||
    contextReference?.rawBytes !==
      result.rawBytes
  ) {
    throw new ContextCoreError(
      "deferred context reference binding mismatch"
    );
  }

  const sourceBytes =
    sourceProjection.chunks.reduce(
      (sum, chunk) => sum + chunk.bytes,
      0
    );

  if (sourceBytes !== result.rawBytes) {
    throw new ContextCoreError(
      "deferred sourceRef byte total mismatch"
    );
  }

  return {
    sourceContentDigest:
      result.sourceContentDigest,
    contextDigest: result.contextDigest,
    chunkCount: sourceProjection.chunkCount,
    sourceRefDigest:
      sha256(JSON.stringify(sourceProjection)),
  };
}

export function buildContextIngressReceipt(
  result,
  {
    eventId = null,
    observedAt = null,
  } = {}
) {
  const normalizedEventId =
    optionalString("eventId", eventId);
  const normalizedObservedAt =
    optionalString("observedAt", observedAt);

  const proof = validateIngressResult(result);

  const payload = {
    version: 1,
    kind: "CONTEXT_INGRESS_RECEIPT",
    eventId: normalizedEventId,
    observedAt: normalizedObservedAt,
    sourceId: result.sourceId,
    classification: result.classification,
    mode: result.mode,
    reason: result.reason,
    sourceContentDigest:
      proof.sourceContentDigest,
    contextDigest: proof.contextDigest,
    rawBytes: result.rawBytes,
    contextBytes: result.contextBytes,
    bytesAvoided: result.bytesAvoided,
    chunkCount: proof.chunkCount,
    sourceRefDigest: proof.sourceRefDigest,
  };

  return Object.freeze({
    ...payload,
    receiptDigest:
      sha256(JSON.stringify(payload)),
  });
}

export function verifyContextIngressReceipt(
  result,
  receipt
) {
  if (!receipt || typeof receipt !== "object") {
    throw new ContextCoreError(
      "context ingress receipt must be an object"
    );
  }

  const rebuilt = buildContextIngressReceipt(
    result,
    {
      eventId: receipt.eventId ?? null,
      observedAt: receipt.observedAt ?? null,
    }
  );

  const expected =
    JSON.stringify(receiptProjection(rebuilt));
  const actual =
    JSON.stringify(receiptProjection(receipt));

  if (actual !== expected) {
    throw new ContextCoreError(
      "context ingress receipt verification failed"
    );
  }

  return true;
}


function retrievalResultProjection(result) {
  if (!result || typeof result !== "object") {
    throw new ContextCoreError(
      "retrieval result must be an object"
    );
  }

  if (
    typeof result.sourceId !== "string" ||
    result.sourceId.length === 0 ||
    typeof result.chunkId !== "string" ||
    result.chunkId.length === 0 ||
    typeof result.content !== "string"
  ) {
    throw new ContextCoreError(
      "retrieval result identity/content is invalid"
    );
  }

  assertNonNegativeInteger(
    "retrieval result chunkIndex",
    result.chunkIndex
  );
  assertSha256(
    "retrieval result contentDigest",
    result.contentDigest
  );

  const expectedDigest =
    sha256(
      `${result.sourceId}\0${result.chunkIndex}\0${result.content}`
    );

  if (expectedDigest !== result.contentDigest) {
    throw new ContextCoreError(
      "retrieval result chunk digest mismatch"
    );
  }

  const expectedChunkId =
    `${result.sourceId}:${result.chunkIndex}:${expectedDigest.slice(0, 16)}`;

  if (expectedChunkId !== result.chunkId) {
    throw new ContextCoreError(
      "retrieval result chunkId mismatch"
    );
  }

  const metadata =
    result.metadata &&
    typeof result.metadata === "object" &&
    !Array.isArray(result.metadata)
      ? result.metadata
      : {};

  return {
    sourceId: result.sourceId,
    chunkId: result.chunkId,
    chunkIndex: result.chunkIndex,
    classification: result.classification,
    contentDigest: result.contentDigest,
    contentBytes: bytes(result.content),
    metadataDigest:
      sha256(JSON.stringify(metadata)),
    score:
      typeof result.score === "number"
        ? result.score
        : null,
    matchKind:
      typeof result.matchKind === "string"
        ? result.matchKind
        : null,
  };
}

function retrievalReceiptProjection(receipt) {
  return {
    version: receipt.version,
    kind: receipt.kind,
    eventId: receipt.eventId ?? null,
    observedAt: receipt.observedAt ?? null,
    query: receipt.query,
    queryDigest: receipt.queryDigest,
    match: receipt.match,
    recall: receipt.recall,
    totalCandidates: receipt.totalCandidates,
    omittedResults: receipt.omittedResults,
    resultCount: receipt.resultCount,
    returnedBytes: receipt.returnedBytes,
    responseDigest: receipt.responseDigest,
    resultSetDigest: receipt.resultSetDigest,
    receiptDigest: receipt.receiptDigest,
  };
}

function validateRetrievalResponse(response) {
  if (!response || typeof response !== "object") {
    throw new ContextCoreError(
      "retrieval response must be an object"
    );
  }

  if (typeof response.query !== "string") {
    throw new ContextCoreError(
      "retrieval response query must be a string"
    );
  }

  if (!Array.isArray(response.terms)) {
    throw new ContextCoreError(
      "retrieval response terms must be an array"
    );
  }

  if (
    response.terms.some(
      term => typeof term !== "string"
    )
  ) {
    throw new ContextCoreError(
      "retrieval response terms must be strings"
    );
  }

  if (
    response.match !== "all" &&
    response.match !== "any"
  ) {
    throw new ContextCoreError(
      "retrieval response match is invalid"
    );
  }

  const recall =
    response.recall === undefined
      ? "exact"
      : response.recall;

  if (
    recall !== "exact" &&
    recall !== "tiered"
  ) {
    throw new ContextCoreError(
      "retrieval response recall is invalid"
    );
  }

  assertNonNegativeInteger(
    "retrieval totalCandidates",
    response.totalCandidates
  );
  assertNonNegativeInteger(
    "retrieval omittedResults",
    response.omittedResults
  );
  assertNonNegativeInteger(
    "retrieval usedBytes",
    response.usedBytes
  );

  if (!Array.isArray(response.results)) {
    throw new ContextCoreError(
      "retrieval response results must be an array"
    );
  }

  if (
    response.totalCandidates !==
    response.results.length +
      response.omittedResults
  ) {
    throw new ContextCoreError(
      "retrieval candidate accounting mismatch"
    );
  }

  const serialized = JSON.stringify(response);
  const returnedBytes = bytes(serialized);

  if (returnedBytes !== response.usedBytes) {
    throw new ContextCoreError(
      "retrieval response byte measurement mismatch"
    );
  }

  const resultProjection =
    response.results.map(
      retrievalResultProjection
    );

  return {
    recall,
    serialized,
    returnedBytes,
    responseDigest: sha256(serialized),
    resultSetDigest:
      sha256(JSON.stringify(resultProjection)),
    resultCount: resultProjection.length,
  };
}

/**
 * Build a deterministic debit receipt for one concrete retrieval response.
 *
 * Debit is the exact UTF-8 size of JSON.stringify(response), including the
 * response envelope even when no results matched.
 */
export function buildContextRetrievalDebitReceipt(
  response,
  {
    eventId = null,
    observedAt = null,
  } = {}
) {
  const normalizedEventId =
    optionalString("eventId", eventId);
  const normalizedObservedAt =
    optionalString("observedAt", observedAt);

  const proof =
    validateRetrievalResponse(response);

  const payload = {
    version: 1,
    kind: "CONTEXT_RETRIEVAL_DEBIT_RECEIPT",
    eventId: normalizedEventId,
    observedAt: normalizedObservedAt,
    query: response.query,
    queryDigest: sha256(response.query),
    match: response.match,
    recall: proof.recall,
    totalCandidates: response.totalCandidates,
    omittedResults: response.omittedResults,
    resultCount: proof.resultCount,
    returnedBytes: proof.returnedBytes,
    responseDigest: proof.responseDigest,
    resultSetDigest: proof.resultSetDigest,
  };

  return Object.freeze({
    ...payload,
    receiptDigest:
      sha256(JSON.stringify(payload)),
  });
}

export function verifyContextRetrievalDebitReceipt(
  response,
  receipt
) {
  if (!receipt || typeof receipt !== "object") {
    throw new ContextCoreError(
      "context retrieval debit receipt must be an object"
    );
  }

  const rebuilt =
    buildContextRetrievalDebitReceipt(
      response,
      {
        eventId: receipt.eventId ?? null,
        observedAt:
          receipt.observedAt ?? null,
      }
    );

  const expected =
    JSON.stringify(
      retrievalReceiptProjection(rebuilt)
    );
  const actual =
    JSON.stringify(
      retrievalReceiptProjection(receipt)
    );

  if (actual !== expected) {
    throw new ContextCoreError(
      "context retrieval debit receipt verification failed"
    );
  }

  return true;
}


function uniqueDigests(label, values) {
  const seen = new Set();
  for (const value of values) {
    assertSha256(label, value);
    if (seen.has(value)) {
      throw new ContextCoreError(`${label} contains a duplicate digest`);
    }
    seen.add(value);
  }
  return [...values];
}

function ingressReceiptPayloadForLedger(receipt) {
  if (!receipt || typeof receipt !== "object" || receipt.version !== 1 ||
      receipt.kind !== "CONTEXT_INGRESS_RECEIPT") {
    throw new ContextCoreError("ledger ingress receipt identity is invalid");
  }
  if (typeof receipt.sourceId !== "string" || receipt.sourceId.length === 0) {
    throw new ContextCoreError("ledger ingress receipt sourceId is invalid");
  }
  if (receipt.mode !== "INLINE" && receipt.mode !== "DEFERRED") {
    throw new ContextCoreError("ledger ingress receipt mode is invalid");
  }

  assertSha256("ledger ingress sourceContentDigest", receipt.sourceContentDigest);
  assertSha256("ledger ingress contextDigest", receipt.contextDigest);
  assertNonNegativeInteger("ledger ingress rawBytes", receipt.rawBytes);
  assertNonNegativeInteger("ledger ingress contextBytes", receipt.contextBytes);
  assertNonNegativeInteger("ledger ingress bytesAvoided", receipt.bytesAvoided);
  assertNonNegativeInteger("ledger ingress chunkCount", receipt.chunkCount);

  if (receipt.bytesAvoided !== receipt.rawBytes - receipt.contextBytes) {
    throw new ContextCoreError("ledger ingress byte accounting mismatch");
  }

  if (receipt.mode === "INLINE") {
    if (receipt.bytesAvoided !== 0 || receipt.rawBytes !== receipt.contextBytes ||
        receipt.chunkCount !== 0 || receipt.sourceRefDigest !== null) {
      throw new ContextCoreError("ledger inline ingress cannot claim savings credit");
    }
  } else {
    if (receipt.bytesAvoided <= 0 || receipt.chunkCount < 1) {
      throw new ContextCoreError("ledger deferred ingress proof is invalid");
    }
    assertSha256("ledger ingress sourceRefDigest", receipt.sourceRefDigest);
  }

  const payload = {
    version: receipt.version,
    kind: receipt.kind,
    eventId: receipt.eventId ?? null,
    observedAt: receipt.observedAt ?? null,
    sourceId: receipt.sourceId,
    classification: receipt.classification,
    mode: receipt.mode,
    reason: receipt.reason,
    sourceContentDigest: receipt.sourceContentDigest,
    contextDigest: receipt.contextDigest,
    rawBytes: receipt.rawBytes,
    contextBytes: receipt.contextBytes,
    bytesAvoided: receipt.bytesAvoided,
    chunkCount: receipt.chunkCount,
    sourceRefDigest: receipt.sourceRefDigest,
  };

  assertSha256("ledger ingress receiptDigest", receipt.receiptDigest);
  if (sha256(JSON.stringify(payload)) !== receipt.receiptDigest) {
    throw new ContextCoreError("ledger ingress receipt digest mismatch");
  }
  return payload;
}

function retrievalReceiptPayloadForLedger(receipt) {
  if (!receipt || typeof receipt !== "object" || receipt.version !== 1 ||
      receipt.kind !== "CONTEXT_RETRIEVAL_DEBIT_RECEIPT") {
    throw new ContextCoreError("ledger retrieval receipt identity is invalid");
  }
  if (typeof receipt.query !== "string") {
    throw new ContextCoreError("ledger retrieval query is invalid");
  }

  assertSha256("ledger retrieval queryDigest", receipt.queryDigest);
  if (sha256(receipt.query) !== receipt.queryDigest) {
    throw new ContextCoreError("ledger retrieval query digest mismatch");
  }
  if (receipt.match !== "all" && receipt.match !== "any") {
    throw new ContextCoreError("ledger retrieval match is invalid");
  }
  if (receipt.recall !== "exact" && receipt.recall !== "tiered") {
    throw new ContextCoreError("ledger retrieval recall is invalid");
  }

  assertNonNegativeInteger("ledger retrieval totalCandidates", receipt.totalCandidates);
  assertNonNegativeInteger("ledger retrieval omittedResults", receipt.omittedResults);
  assertNonNegativeInteger("ledger retrieval resultCount", receipt.resultCount);
  assertNonNegativeInteger("ledger retrieval returnedBytes", receipt.returnedBytes);

  if (receipt.returnedBytes <= 0) {
    throw new ContextCoreError("ledger retrieval debit must be positive");
  }
  if (receipt.totalCandidates !== receipt.resultCount + receipt.omittedResults) {
    throw new ContextCoreError("ledger retrieval candidate accounting mismatch");
  }

  assertSha256("ledger retrieval responseDigest", receipt.responseDigest);
  assertSha256("ledger retrieval resultSetDigest", receipt.resultSetDigest);

  const payload = {
    version: receipt.version,
    kind: receipt.kind,
    eventId: receipt.eventId ?? null,
    observedAt: receipt.observedAt ?? null,
    query: receipt.query,
    queryDigest: receipt.queryDigest,
    match: receipt.match,
    recall: receipt.recall,
    totalCandidates: receipt.totalCandidates,
    omittedResults: receipt.omittedResults,
    resultCount: receipt.resultCount,
    returnedBytes: receipt.returnedBytes,
    responseDigest: receipt.responseDigest,
    resultSetDigest: receipt.resultSetDigest,
  };

  assertSha256("ledger retrieval receiptDigest", receipt.receiptDigest);
  if (sha256(JSON.stringify(payload)) !== receipt.receiptDigest) {
    throw new ContextCoreError("ledger retrieval receipt digest mismatch");
  }
  return payload;
}

function savingsSplit(grossBytesAvoided, retrievalBytes) {
  assertNonNegativeInteger("ledger grossBytesAvoided", grossBytesAvoided);
  assertNonNegativeInteger("ledger retrievalBytes", retrievalBytes);
  const delta = grossBytesAvoided - retrievalBytes;
  return {
    netBytesAvoided: Math.max(delta, 0),
    netBytesAdded: Math.max(-delta, 0),
  };
}

function contextSavingsLedgerPayload(ledger) {
  return {
    version: ledger.version,
    kind: ledger.kind,
    scopeType: ledger.scopeType,
    scopeId: ledger.scopeId,
    eventId: ledger.eventId ?? null,
    observedAt: ledger.observedAt ?? null,
    aggregation: ledger.aggregation,
    ingressReceiptCount: ledger.ingressReceiptCount,
    retrievalReceiptCount: ledger.retrievalReceiptCount,
    childLedgerCount: ledger.childLedgerCount,
    grossBytesAvoided: ledger.grossBytesAvoided,
    retrievalBytes: ledger.retrievalBytes,
    netBytesAvoided: ledger.netBytesAvoided,
    netBytesAdded: ledger.netBytesAdded,
    ingressReceiptDigests: [...ledger.ingressReceiptDigests],
    retrievalReceiptDigests: [...ledger.retrievalReceiptDigests],
    childLedgerDigests: [...ledger.childLedgerDigests],
  };
}


function validateContextSavingsLedger(ledger) {
  if (!ledger || typeof ledger !== "object" || ledger.version !== 1 ||
      ledger.kind !== "CONTEXT_SAVINGS_LEDGER") {
    throw new ContextCoreError("context savings ledger identity is invalid");
  }
  if (!["SESSION", "PROJECT", "GLOBAL"].includes(ledger.scopeType)) {
    throw new ContextCoreError("context savings ledger scopeType is invalid");
  }
  if (typeof ledger.scopeId !== "string" || ledger.scopeId.length === 0) {
    throw new ContextCoreError("context savings ledger scopeId is invalid");
  }
  if (ledger.aggregation !== "RECEIPTS" &&
      ledger.aggregation !== "CHILD_LEDGERS") {
    throw new ContextCoreError("context savings ledger aggregation is invalid");
  }

  for (const [name, value] of [
    ["ingressReceiptCount", ledger.ingressReceiptCount],
    ["retrievalReceiptCount", ledger.retrievalReceiptCount],
    ["childLedgerCount", ledger.childLedgerCount],
    ["grossBytesAvoided", ledger.grossBytesAvoided],
    ["retrievalBytes", ledger.retrievalBytes],
    ["netBytesAvoided", ledger.netBytesAvoided],
    ["netBytesAdded", ledger.netBytesAdded],
  ]) {
    assertNonNegativeInteger(`context savings ledger ${name}`, value);
  }

  if (!Array.isArray(ledger.ingressReceiptDigests) ||
      !Array.isArray(ledger.retrievalReceiptDigests) ||
      !Array.isArray(ledger.childLedgerDigests)) {
    throw new ContextCoreError("context savings ledger digest sets must be arrays");
  }

  uniqueDigests(
    "context savings ledger ingressReceiptDigests",
    ledger.ingressReceiptDigests
  );
  uniqueDigests(
    "context savings ledger retrievalReceiptDigests",
    ledger.retrievalReceiptDigests
  );
  uniqueDigests(
    "context savings ledger childLedgerDigests",
    ledger.childLedgerDigests
  );

  if (ledger.ingressReceiptCount !== ledger.ingressReceiptDigests.length ||
      ledger.retrievalReceiptCount !== ledger.retrievalReceiptDigests.length ||
      ledger.childLedgerCount !== ledger.childLedgerDigests.length) {
    throw new ContextCoreError("context savings ledger count/digest mismatch");
  }

  if (ledger.aggregation === "RECEIPTS" &&
      (ledger.scopeType !== "SESSION" || ledger.childLedgerCount !== 0)) {
    throw new ContextCoreError("receipt aggregation is session-only");
  }

  if (
    ledger.aggregation === "CHILD_LEDGERS" &&
    ledger.scopeType === "SESSION"
  ) {
    throw new ContextCoreError(
      "session ledger cannot aggregate child ledgers"
    );
  }

  const split = savingsSplit(
    ledger.grossBytesAvoided,
    ledger.retrievalBytes
  );

  if (ledger.netBytesAvoided !== split.netBytesAvoided ||
      ledger.netBytesAdded !== split.netBytesAdded) {
    throw new ContextCoreError("context savings ledger net accounting mismatch");
  }

  if (ledger.netBytesAvoided > 0 && ledger.netBytesAdded > 0) {
    throw new ContextCoreError(
      "context savings ledger cannot report savings and added bytes simultaneously"
    );
  }

  assertSha256("context savings ledger ledgerDigest", ledger.ledgerDigest);
  const payload = contextSavingsLedgerPayload(ledger);
  if (sha256(JSON.stringify(payload)) !== ledger.ledgerDigest) {
    throw new ContextCoreError("context savings ledger digest mismatch");
  }
  return payload;
}

export function buildContextSessionSavingsLedger(
  {
    scopeId,
    ingressReceipts = [],
    retrievalReceipts = [],
  },
  {
    eventId = null,
    observedAt = null,
  } = {}
) {
  if (typeof scopeId !== "string" || scopeId.length === 0) {
    throw new ContextCoreError(
      "session savings ledger scopeId must be a non-empty string"
    );
  }
  if (!Array.isArray(ingressReceipts) ||
      !Array.isArray(retrievalReceipts)) {
    throw new ContextCoreError(
      "session savings ledger receipts must be arrays"
    );
  }

  const normalizedEventId = optionalString("eventId", eventId);
  const normalizedObservedAt = optionalString("observedAt", observedAt);

  const ingressProjections = ingressReceipts.map(receipt => ({
    receipt,
    payload: ingressReceiptPayloadForLedger(receipt),
  }));
  const retrievalProjections = retrievalReceipts.map(receipt => ({
    receipt,
    payload: retrievalReceiptPayloadForLedger(receipt),
  }));

  const ingressReceiptDigests = uniqueDigests(
    "session ingress receipt digest",
    ingressProjections.map(item => item.receipt.receiptDigest)
  );
  const retrievalReceiptDigests = uniqueDigests(
    "session retrieval receipt digest",
    retrievalProjections.map(item => item.receipt.receiptDigest)
  );

  const grossBytesAvoided = ingressProjections.reduce(
    (sum, item) =>
      sum + (item.payload.mode === "DEFERRED" ? item.payload.bytesAvoided : 0),
    0
  );
  const retrievalBytes = retrievalProjections.reduce(
    (sum, item) => sum + item.payload.returnedBytes,
    0
  );
  const split = savingsSplit(grossBytesAvoided, retrievalBytes);

  const payload = {
    version: 1,
    kind: "CONTEXT_SAVINGS_LEDGER",
    scopeType: "SESSION",
    scopeId,
    eventId: normalizedEventId,
    observedAt: normalizedObservedAt,
    aggregation: "RECEIPTS",
    ingressReceiptCount: ingressReceiptDigests.length,
    retrievalReceiptCount: retrievalReceiptDigests.length,
    childLedgerCount: 0,
    grossBytesAvoided,
    retrievalBytes,
    netBytesAvoided: split.netBytesAvoided,
    netBytesAdded: split.netBytesAdded,
    ingressReceiptDigests,
    retrievalReceiptDigests,
    childLedgerDigests: [],
  };

  return Object.freeze({
    ...payload,
    ingressReceiptDigests: Object.freeze([...ingressReceiptDigests]),
    retrievalReceiptDigests: Object.freeze([...retrievalReceiptDigests]),
    childLedgerDigests: Object.freeze([]),
    ledgerDigest: sha256(JSON.stringify(payload)),
  });
}

export function aggregateContextSavingsLedgers(
  {
    scopeType,
    scopeId,
    childLedgers = [],
  },
  {
    eventId = null,
    observedAt = null,
  } = {}
) {
  if (scopeType !== "PROJECT" && scopeType !== "GLOBAL") {
    throw new ContextCoreError(
      "aggregate savings ledger scopeType must be PROJECT or GLOBAL"
    );
  }
  if (typeof scopeId !== "string" || scopeId.length === 0) {
    throw new ContextCoreError(
      "aggregate savings ledger scopeId must be a non-empty string"
    );
  }
  if (!Array.isArray(childLedgers)) {
    throw new ContextCoreError(
      "aggregate savings ledger childLedgers must be an array"
    );
  }

  const expectedChildType =
    scopeType === "PROJECT" ? "SESSION" : "PROJECT";

  const validated = childLedgers.map(child => {
    validateContextSavingsLedger(child);
    if (child.scopeType !== expectedChildType) {
      throw new ContextCoreError(
        `aggregate ${scopeType} ledger requires ${expectedChildType} children`
      );
    }
    return child;
  });

  const childLedgerDigests = uniqueDigests(
    "aggregate child ledger digest",
    validated.map(child => child.ledgerDigest)
  );

  const ingressReceiptDigests = uniqueDigests(
    "aggregate ingress receipt digest",
    validated.flatMap(
      child => child.ingressReceiptDigests
    )
  );

  const retrievalReceiptDigests = uniqueDigests(
    "aggregate retrieval receipt digest",
    validated.flatMap(
      child => child.retrievalReceiptDigests
    )
  );

  const grossBytesAvoided = validated.reduce(
    (sum, child) => sum + child.grossBytesAvoided,
    0
  );
  const retrievalBytes = validated.reduce(
    (sum, child) => sum + child.retrievalBytes,
    0
  );

  for (const child of validated) {
    if (child.grossBytesAvoided > grossBytesAvoided ||
        child.retrievalBytes > retrievalBytes) {
      throw new ContextCoreError("aggregate savings ledger part exceeds whole");
    }
  }

  const split = savingsSplit(grossBytesAvoided, retrievalBytes);
  const normalizedEventId = optionalString("eventId", eventId);
  const normalizedObservedAt = optionalString("observedAt", observedAt);

  const payload = {
    version: 1,
    kind: "CONTEXT_SAVINGS_LEDGER",
    scopeType,
    scopeId,
    eventId: normalizedEventId,
    observedAt: normalizedObservedAt,
    aggregation: "CHILD_LEDGERS",
    ingressReceiptCount:
      ingressReceiptDigests.length,
    retrievalReceiptCount:
      retrievalReceiptDigests.length,
    childLedgerCount: childLedgerDigests.length,
    grossBytesAvoided,
    retrievalBytes,
    netBytesAvoided: split.netBytesAvoided,
    netBytesAdded: split.netBytesAdded,
    ingressReceiptDigests,
    retrievalReceiptDigests,
    childLedgerDigests,
  };

  return Object.freeze({
    ...payload,
    ingressReceiptDigests:
      Object.freeze([...ingressReceiptDigests]),
    retrievalReceiptDigests:
      Object.freeze([...retrievalReceiptDigests]),
    childLedgerDigests:
      Object.freeze([...childLedgerDigests]),
    ledgerDigest: sha256(JSON.stringify(payload)),
  });
}

export function verifyContextSavingsLedger(ledger) {
  validateContextSavingsLedger(ledger);
  return true;
}


function sameDigestSequence(left, right) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function sumSafeBytes(name, values) {
  let total = 0;

  for (const value of values) {
    assertNonNegativeInteger(name, value);
    total += value;

    if (!Number.isSafeInteger(total)) {
      throw new ContextCoreError(
        `${name} exceeds JavaScript safe integer range`
      );
    }
  }

  return total;
}

function savingsReportStatus(
  netBytesAvoided,
  netBytesAdded
) {
  if (netBytesAvoided > 0) {
    return "SAVINGS";
  }

  if (netBytesAdded > 0) {
    return "ADDED_BYTES";
  }

  return "NEUTRAL";
}

function contextSavingsReportPayload(report) {
  return {
    version: report.version,
    kind: report.kind,
    scopeType: report.scopeType,
    scopeId: report.scopeId,
    eventId: report.eventId ?? null,
    observedAt: report.observedAt ?? null,
    aggregation: report.aggregation,
    status: report.status,
    unit: report.unit,
    ingressBasis: report.ingressBasis,
    retrievalBasis: report.retrievalBasis,
    netBasis: report.netBasis,
    claimBoundary: report.claimBoundary,
    ingressReceiptCount:
      report.ingressReceiptCount,
    retrievalReceiptCount:
      report.retrievalReceiptCount,
    childLedgerCount:
      report.childLedgerCount,
    observedRawBytes:
      report.observedRawBytes,
    ingressContextBytes:
      report.ingressContextBytes,
    retrievalBytes:
      report.retrievalBytes,
    grossBytesAvoided:
      report.grossBytesAvoided,
    netBytesAvoided:
      report.netBytesAvoided,
    netBytesAdded:
      report.netBytesAdded,
    ledgerDigest:
      report.ledgerDigest,
    ingressReceiptDigests:
      [...report.ingressReceiptDigests],
    retrievalReceiptDigests:
      [...report.retrievalReceiptDigests],
    childLedgerDigests:
      [...report.childLedgerDigests],
  };
}

const CONTEXT_SAVINGS_REPORT_KEYS = Object.freeze([
  "version",
  "kind",
  "scopeType",
  "scopeId",
  "eventId",
  "observedAt",
  "aggregation",
  "status",
  "unit",
  "ingressBasis",
  "retrievalBasis",
  "netBasis",
  "claimBoundary",
  "ingressReceiptCount",
  "retrievalReceiptCount",
  "childLedgerCount",
  "observedRawBytes",
  "ingressContextBytes",
  "retrievalBytes",
  "grossBytesAvoided",
  "netBytesAvoided",
  "netBytesAdded",
  "ledgerDigest",
  "ingressReceiptDigests",
  "retrievalReceiptDigests",
  "childLedgerDigests",
  "reportDigest",
]);

function assertExactContextSavingsReportKeys(report) {
  const actual = Object.keys(report).sort();
  const expected =
    [...CONTEXT_SAVINGS_REPORT_KEYS].sort();

  if (
    actual.length !== expected.length ||
    actual.some(
      (key, index) => key !== expected[index]
    )
  ) {
    throw new ContextCoreError(
      "context savings report contains unknown, missing, or unbound fields"
    );
  }
}

function validateContextSavingsReport(report) {
  if (
    !report ||
    typeof report !== "object" ||
    report.version !== 1 ||
    report.kind !== "CONTEXT_SAVINGS_REPORT"
  ) {
    throw new ContextCoreError(
      "context savings report identity is invalid"
    );
  }

  assertExactContextSavingsReportKeys(report);

  if (
    !["SESSION", "PROJECT", "GLOBAL"].includes(
      report.scopeType
    )
  ) {
    throw new ContextCoreError(
      "context savings report scopeType is invalid"
    );
  }

  if (
    typeof report.scopeId !== "string" ||
    report.scopeId.length === 0
  ) {
    throw new ContextCoreError(
      "context savings report scopeId is invalid"
    );
  }

  if (
    report.aggregation !== "RECEIPTS" &&
    report.aggregation !== "CHILD_LEDGERS"
  ) {
    throw new ContextCoreError(
      "context savings report aggregation is invalid"
    );
  }

  if (
    report.scopeType === "SESSION" &&
    report.aggregation !== "RECEIPTS"
  ) {
    throw new ContextCoreError(
      "session savings report must use receipt aggregation"
    );
  }

  if (
    report.scopeType !== "SESSION" &&
    report.aggregation !== "CHILD_LEDGERS"
  ) {
    throw new ContextCoreError(
      "aggregate savings report must use child-ledger aggregation"
    );
  }

  if (report.unit !== "UTF8_BYTES") {
    throw new ContextCoreError(
      "context savings report unit is invalid"
    );
  }

  if (
    report.ingressBasis !==
      "PROOF_CARRYING_INGRESS_RECEIPTS" ||
    report.retrievalBasis !==
      "SERIALIZED_RESPONSE_RETURNED_TO_CALLER" ||
    report.netBasis !==
      "GROSS_DIVERSION_MINUS_RETRIEVAL_RESPONSE_DEBIT" ||
    report.claimBoundary !==
      "BYTE_ACCOUNTING_ONLY"
  ) {
    throw new ContextCoreError(
      "context savings report metric basis is invalid"
    );
  }

  for (const [name, value] of [
    ["ingressReceiptCount", report.ingressReceiptCount],
    ["retrievalReceiptCount", report.retrievalReceiptCount],
    ["childLedgerCount", report.childLedgerCount],
    ["observedRawBytes", report.observedRawBytes],
    ["ingressContextBytes", report.ingressContextBytes],
    ["retrievalBytes", report.retrievalBytes],
    ["grossBytesAvoided", report.grossBytesAvoided],
    ["netBytesAvoided", report.netBytesAvoided],
    ["netBytesAdded", report.netBytesAdded],
  ]) {
    assertNonNegativeInteger(
      `context savings report ${name}`,
      value
    );

    if (!Number.isSafeInteger(value)) {
      throw new ContextCoreError(
        `context savings report ${name} exceeds JavaScript safe integer range`
      );
    }
  }

  if (
    !Array.isArray(report.ingressReceiptDigests) ||
    !Array.isArray(report.retrievalReceiptDigests) ||
    !Array.isArray(report.childLedgerDigests)
  ) {
    throw new ContextCoreError(
      "context savings report digest sets must be arrays"
    );
  }

  uniqueDigests(
    "context savings report ingressReceiptDigests",
    report.ingressReceiptDigests
  );
  uniqueDigests(
    "context savings report retrievalReceiptDigests",
    report.retrievalReceiptDigests
  );
  uniqueDigests(
    "context savings report childLedgerDigests",
    report.childLedgerDigests
  );

  if (
    report.ingressReceiptCount !==
      report.ingressReceiptDigests.length ||
    report.retrievalReceiptCount !==
      report.retrievalReceiptDigests.length ||
    report.childLedgerCount !==
      report.childLedgerDigests.length
  ) {
    throw new ContextCoreError(
      "context savings report count/digest mismatch"
    );
  }

  if (
    report.observedRawBytes <
    report.ingressContextBytes
  ) {
    throw new ContextCoreError(
      "context savings report context bytes exceed observed raw bytes"
    );
  }

  if (
    report.grossBytesAvoided !==
    report.observedRawBytes -
      report.ingressContextBytes
  ) {
    throw new ContextCoreError(
      "context savings report gross byte accounting mismatch"
    );
  }

  const split = savingsSplit(
    report.grossBytesAvoided,
    report.retrievalBytes
  );

  if (
    report.netBytesAvoided !==
      split.netBytesAvoided ||
    report.netBytesAdded !==
      split.netBytesAdded
  ) {
    throw new ContextCoreError(
      "context savings report net byte accounting mismatch"
    );
  }

  if (
    report.status !==
    savingsReportStatus(
      report.netBytesAvoided,
      report.netBytesAdded
    )
  ) {
    throw new ContextCoreError(
      "context savings report status mismatch"
    );
  }

  assertSha256(
    "context savings report ledgerDigest",
    report.ledgerDigest
  );
  assertSha256(
    "context savings report reportDigest",
    report.reportDigest
  );

  const payload =
    contextSavingsReportPayload(report);

  if (
    sha256(JSON.stringify(payload)) !==
    report.reportDigest
  ) {
    throw new ContextCoreError(
      "context savings report digest mismatch"
    );
  }

  return payload;
}

export function buildContextSavingsReport(
  {
    ledger,
    ingressReceipts = [],
    retrievalReceipts = [],
  },
  {
    eventId = null,
    observedAt = null,
  } = {}
) {
  validateContextSavingsLedger(ledger);

  if (
    !Array.isArray(ingressReceipts) ||
    !Array.isArray(retrievalReceipts)
  ) {
    throw new ContextCoreError(
      "context savings report receipts must be arrays"
    );
  }

  const ingressPayloads =
    ingressReceipts.map(
      ingressReceiptPayloadForLedger
    );

  const retrievalPayloads =
    retrievalReceipts.map(
      retrievalReceiptPayloadForLedger
    );

  const ingressReceiptDigests =
    uniqueDigests(
      "context savings report ingress receipt digest",
      ingressReceipts.map(
        receipt => receipt.receiptDigest
      )
    );

  const retrievalReceiptDigests =
    uniqueDigests(
      "context savings report retrieval receipt digest",
      retrievalReceipts.map(
        receipt => receipt.receiptDigest
      )
    );

  if (
    !sameDigestSequence(
      ingressReceiptDigests,
      ledger.ingressReceiptDigests
    )
  ) {
    throw new ContextCoreError(
      "context savings report ingress provenance mismatch"
    );
  }

  if (
    !sameDigestSequence(
      retrievalReceiptDigests,
      ledger.retrievalReceiptDigests
    )
  ) {
    throw new ContextCoreError(
      "context savings report retrieval provenance mismatch"
    );
  }

  const observedRawBytes =
    sumSafeBytes(
      "context savings report observed raw bytes",
      ingressPayloads.map(
        receipt => receipt.rawBytes
      )
    );

  const ingressContextBytes =
    sumSafeBytes(
      "context savings report ingress context bytes",
      ingressPayloads.map(
        receipt => receipt.contextBytes
      )
    );

  const grossBytesAvoided =
    sumSafeBytes(
      "context savings report gross bytes avoided",
      ingressPayloads.map(
        receipt =>
          receipt.mode === "DEFERRED"
            ? receipt.bytesAvoided
            : 0
      )
    );

  const retrievalBytes =
    sumSafeBytes(
      "context savings report retrieval bytes",
      retrievalPayloads.map(
        receipt => receipt.returnedBytes
      )
    );

  if (
    grossBytesAvoided !==
    observedRawBytes - ingressContextBytes
  ) {
    throw new ContextCoreError(
      "context savings report ingress byte derivation mismatch"
    );
  }

  if (
    grossBytesAvoided !==
      ledger.grossBytesAvoided ||
    retrievalBytes !==
      ledger.retrievalBytes
  ) {
    throw new ContextCoreError(
      "context savings report ledger byte totals mismatch"
    );
  }

  const split =
    savingsSplit(
      grossBytesAvoided,
      retrievalBytes
    );

  if (
    split.netBytesAvoided !==
      ledger.netBytesAvoided ||
    split.netBytesAdded !==
      ledger.netBytesAdded
  ) {
    throw new ContextCoreError(
      "context savings report ledger net mismatch"
    );
  }

  const normalizedEventId =
    optionalString("eventId", eventId);
  const normalizedObservedAt =
    optionalString("observedAt", observedAt);

  const payload = {
    version: 1,
    kind: "CONTEXT_SAVINGS_REPORT",
    scopeType: ledger.scopeType,
    scopeId: ledger.scopeId,
    eventId: normalizedEventId,
    observedAt: normalizedObservedAt,
    aggregation: ledger.aggregation,
    status:
      savingsReportStatus(
        split.netBytesAvoided,
        split.netBytesAdded
      ),
    unit: "UTF8_BYTES",
    ingressBasis:
      "PROOF_CARRYING_INGRESS_RECEIPTS",
    retrievalBasis:
      "SERIALIZED_RESPONSE_RETURNED_TO_CALLER",
    netBasis:
      "GROSS_DIVERSION_MINUS_RETRIEVAL_RESPONSE_DEBIT",
    claimBoundary: "BYTE_ACCOUNTING_ONLY",
    ingressReceiptCount:
      ingressReceiptDigests.length,
    retrievalReceiptCount:
      retrievalReceiptDigests.length,
    childLedgerCount:
      ledger.childLedgerDigests.length,
    observedRawBytes,
    ingressContextBytes,
    retrievalBytes,
    grossBytesAvoided,
    netBytesAvoided:
      split.netBytesAvoided,
    netBytesAdded:
      split.netBytesAdded,
    ledgerDigest:
      ledger.ledgerDigest,
    ingressReceiptDigests,
    retrievalReceiptDigests,
    childLedgerDigests:
      [...ledger.childLedgerDigests],
  };

  return Object.freeze({
    ...payload,
    ingressReceiptDigests:
      Object.freeze([
        ...payload.ingressReceiptDigests,
      ]),
    retrievalReceiptDigests:
      Object.freeze([
        ...payload.retrievalReceiptDigests,
      ]),
    childLedgerDigests:
      Object.freeze([
        ...payload.childLedgerDigests,
      ]),
    reportDigest:
      sha256(JSON.stringify(payload)),
  });
}

export function verifyContextSavingsReport(report) {
  validateContextSavingsReport(report);
  return true;
}
