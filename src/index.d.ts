export const ContextClass: Readonly<{
  EXACT_EVIDENCE: "EXACT_EVIDENCE";
  WORKING_CONTEXT: "WORKING_CONTEXT";
  BULK_MATERIAL: "BULK_MATERIAL";
  RETRIEVABLE_KNOWLEDGE: "RETRIEVABLE_KNOWLEDGE";
  DURABLE_MEMORY_REFERENCE: "DURABLE_MEMORY_REFERENCE";
}>;

export type ContextClassValue =
  (typeof ContextClass)[keyof typeof ContextClass];

export class ContextBudgetExceeded extends Error {}

export const ContextEventKind: Readonly<{
  OBJECTIVE: "OBJECTIVE";
  DECISION: "DECISION";
  ERROR: "ERROR";
  FILE_READ: "FILE_READ";
  FILE_EDIT: "FILE_EDIT";
  GIT_STATE: "GIT_STATE";
  CONSTRAINT: "CONSTRAINT";
  TASK: "TASK";
  EXTERNAL_REF: "EXTERNAL_REF";
}>;

export type ContextEventKindValue =
  (typeof ContextEventKind)[keyof typeof ContextEventKind];

export type JsonPrimitive =
  | string
  | number
  | boolean
  | null;

export type JsonValue =
  | JsonPrimitive
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export type ExactEvidence = Readonly<{
  label: string;
  value: string;
}>;

export type ContextEventInput = Readonly<{
  sessionId: string;
  kind: ContextEventKindValue;
  timestamp: string;
  source: string;
  project?: string | null;
  repo?: string | null;
  attribution?: string | null;
  importance?: number;
  text: string;
  tags?: readonly string[];
  rawRef?: string | null;
  memoryRefs?: readonly string[];
  exactEvidence?: readonly ExactEvidence[];
  data?: JsonValue;
  dedupeKey?: string | null;
}>;

export type ContextEvent = Readonly<{
  schemaVersion: 1;
  sessionId: string;
  sequence: number;
  eventId: string;
  kind: ContextEventKindValue;
  timestamp: string;
  source: string;
  project: string | null;
  repo: string | null;
  attribution: string | null;
  importance: number;
  text: string;
  tags: readonly string[];
  rawRef: string | null;
  memoryRefs: readonly string[];
  exactEvidence: readonly ExactEvidence[];
  data: JsonValue;
  dedupeKey: string | null;
  prevDigest: string | null;
  eventDigest: string;
}>;

export type SessionHead = Readonly<{
  sessionId: string;
  eventCount: number;
  lastSequence: number;
  lastEventId: string | null;
  lastDigest: string | null;
}>;

export type SessionSnapshotReference = Readonly<{
  sessionId: string;
  lastSequence: number;
  lastDigest: string | null;
}>;

export type SessionEventIdentityReference = Readonly<{
  eventId: string;
  sequence: number;
  eventDigest: string;
}>;

export type SessionEventReference =
  SessionEventIdentityReference &
  Readonly<{
    kind: ContextEventKindValue;
  }>;

export type SessionExactEvidenceReference =
  SessionEventIdentityReference &
  Readonly<{
    label: string;
  }>;

export class PersistentSessionJournal {
  constructor(options: {
    path: string;
    maxEventBytes?: number;
  });
  readonly path: string;
  readonly maxEventBytes: number;
  append(input: ContextEventInput): ContextEvent;
  getSessionHead(sessionId: string): SessionHead;
  resolveEventReference(
    snapshot: SessionSnapshotReference,
    reference:
      SessionEventIdentityReference &
      Readonly<{
        kind?: ContextEventKindValue;
      }>
  ): ContextEvent;
  listSession(
    sessionId: string,
    options?: {
      kinds?: readonly ContextEventKindValue[];
      limit?: number;
    }
  ): readonly ContextEvent[];
  close(): void;
}

export type LexicalSourceInput = Readonly<{
  sourceId: string;
  content: string;
  classification?: ContextClassValue;
  metadata?: Record<string, JsonValue>;
  maxChunkBytes?: number;
  chunkMode?: "plain" | "markdown";
}>;

export type LexicalSourceRef = Readonly<{
  sourceId: string;
  classification: ContextClassValue;
  contentDigest: string;
  chunkCount: number;
  chunks: readonly Readonly<{
    chunkId: string;
    chunkIndex: number;
    digest: string;
    bytes: number;
  }>[];
}>;

export type LexicalSearchResult = Readonly<{
  sourceId: string;
  chunkId: string;
  chunkIndex: number;
  classification: ContextClassValue;
  score: number;
  content: string;
  contentDigest: string;
  metadata: Record<string, JsonValue>;
  matchKind?:
    | "EXACT"
    | "IDENTIFIER"
    | "MORPHOLOGY"
    | "SUBSTRING";
}>;

export type LexicalSearchResponse = Readonly<{
  query: string;
  terms: readonly string[];
  match: "all" | "any";
  recall?: "tiered";
  totalCandidates: number;
  omittedResults: number;
  results: readonly LexicalSearchResult[];
  usedBytes: number;
}>;

export class PersistentLexicalIndex {
  constructor(options: {
    path: string;
    k1?: number;
    b?: number;
  });
  readonly path: string;
  readonly k1: number;
  readonly b: number;
  addSource(input: LexicalSourceInput): LexicalSourceRef;
  search(
    query: string,
    options?: {
      maxResults?: number;
      maxBytes?: number;
      match?: "all" | "any";
      recall?: "exact" | "tiered";
      maxRecallScanChunks?: number;
      metadataEquals?: Record<
        string,
        string | number | boolean | null
      >;
    }
  ): LexicalSearchResponse;
  close(): void;
}

export type ResumeOmissionManifest = Readonly<{
  snapshot: SessionSnapshotReference;
  events: readonly SessionEventReference[];
  exactEvidence:
    readonly SessionExactEvidenceReference[];
}>;

export type ResumeEvent = Readonly<{
  eventId: string;
  sequence: number;
  kind: ContextEventKindValue;
  timestamp: string;
  source: string;
  project: string | null;
  repo: string | null;
  attribution: string | null;
  importance: number;
  text: string;
  tags: readonly string[];
  rawRef: string | null;
  memoryRefs: readonly string[];
  data: JsonValue;
}>;

export type ResumeActiveFile = Readonly<{
  path: string;
  eventId: string;
  sequence: number;
  kind: "FILE_READ" | "FILE_EDIT";
  timestamp: string;
}>;

export type ResumeReference = Readonly<{
  type: "raw" | "memory";
  ref: string;
  eventId: string;
  sequence: number;
  kind: ContextEventKindValue;
}>;

export type ResumeExactEvidence = Readonly<{
  eventId: string;
  sequence: number;
  label: string;
  value: string;
}>;

export type ResumeOmittedCounts = Readonly<{
  currentObjective: number;
  gitState: number;
  unresolvedErrors: number;
  recentDecisions: number;
  openTasks: number;
  constraints: number;
  activeFiles: number;
  references: number;
  exactEvidence: number;
}>;

export type ResumePacket = Readonly<{
  version: 1;
  sessionId: string;
  budgetBytes: number;
  usedBytes: number;
  sourceHead: Readonly<{
    eventCount: number;
    lastSequence: number;
    lastEventId: string | null;
    lastDigest: string | null;
  }>;
  currentObjective: ResumeEvent | null;
  gitState: ResumeEvent | null;
  unresolvedErrors: readonly ResumeEvent[];
  recentDecisions: readonly ResumeEvent[];
  openTasks: readonly ResumeEvent[];
  constraints: readonly ResumeEvent[];
  activeFiles: readonly ResumeActiveFile[];
  references: readonly ResumeReference[];
  exactEvidence: readonly ResumeExactEvidence[];
  omissionManifest: ResumeOmissionManifest;
  omitted: ResumeOmittedCounts;
}>;

export type ResumePacketOptions = Readonly<{
  maxBytes?: number;
  maxDecisions?: number;
  maxConstraints?: number;
  maxOpenErrors?: number;
  maxOpenTasks?: number;
  maxActiveFiles?: number;
  maxReferences?: number;
}>;

export function buildResumePacket(
  journal: Pick<
    PersistentSessionJournal,
    "getSessionHead" | "listSession"
  >,
  sessionId: string,
  options?: ResumePacketOptions
): ResumePacket;

export type ContinuityRetrieval = Readonly<{
  queryIndex: number;
  query: string;
  response: LexicalSearchResponse;
}>;

export type ContinuityOmittedQuery = Readonly<{
  index: number;
  query: string;
}>;

export type ContinuityHandoff = Readonly<{
  version: 1;
  sessionId: string;
  budgetBytes: number;
  usedBytes: number;
  resumePacket: ResumePacket;
  retrievals: readonly ContinuityRetrieval[];
  omittedRetrievalQueries: number;
  omittedRetrievalQueryItems:
    readonly ContinuityOmittedQuery[];
}>;

export type ContinuityTransport = Readonly<{
  version: 1;
  kind: "CONTINUITY_TRANSPORT";
  mediaType: "application/json";
  encoding: "utf-8";
  budgetBytes: number;
  usedBytes: number;
  serialized: string;
}>;

export type ContextIngressResult = Readonly<{
  version: 1;
  mode: "INLINE" | "DEFERRED";
  reason:
    | "WITHIN_INLINE_BUDGET"
    | "EXACT_EVIDENCE_MUST_REMAIN_EXACT"
    | "DURABLE_MEMORY_REFERENCE_STAYS_INLINE"
    | "CLASSIFICATION_NOT_INDEXABLE"
    | "DIVERSION_NOT_BYTE_BENEFICIAL"
    | "OVER_INLINE_BUDGET_INDEXED";
  sourceId: string;
  classification: ContextClassValue;
  sourceContentDigest: string;
  contextDigest: string;
  rawBytes: number;
  contextBytes: number;
  bytesAvoided: number;
  contextText: string;
  sourceRef: LexicalSourceRef | null;
}>;

export function prepareContextIngress(
  input?: Readonly<{
    retrieval?: Pick<
      PersistentLexicalIndex,
      "addSource"
    >;
    sourceId: string;
    content: string;
    classification?: ContextClassValue;
    metadata?: Record<string, JsonValue>;
    maxInlineBytes?: number;
    previewBytes?: number;
    maxChunkBytes?: number;
    chunkMode?: "plain" | "markdown";
  }>
): ContextIngressResult;

export type ToolOutputIngressResult = Readonly<{
  version: 1;
  kind: "TOOL_OUTPUT_INGRESS";
  toolName: string;
  toolCallId: string;
  sourceId: string;
  classification: ContextClassValue;
  mode: "INLINE" | "DEFERRED";
  reason: ContextIngressResult["reason"];
  modelText: string;
  rawBytes: number;
  modelBytes: number;
  bytesAvoided: number;
  ingress: ContextIngressResult;
  receipt: ContextIngressReceipt;
}>;

export function prepareToolOutputIngress(
  input?: Readonly<{
    retrieval?: Pick<
      PersistentLexicalIndex,
      "addSource"
    >;
    toolName: string;
    toolCallId: string;
    content: string;
    classification?: ContextClassValue;
    metadata?: Record<string, JsonValue>;
    maxInlineBytes?: number;
    previewBytes?: number;
    maxChunkBytes?: number;
    chunkMode?: "plain" | "markdown";
    eventId?: string | null;
    observedAt?: string | null;
  }>
): ToolOutputIngressResult;

export type ContextIngressReceipt = Readonly<{
  version: 1;
  kind: "CONTEXT_INGRESS_RECEIPT";
  eventId: string | null;
  observedAt: string | null;
  sourceId: string;
  classification: ContextClassValue;
  mode: "INLINE" | "DEFERRED";
  reason: ContextIngressResult["reason"];
  sourceContentDigest: string;
  contextDigest: string;
  rawBytes: number;
  contextBytes: number;
  bytesAvoided: number;
  chunkCount: number;
  sourceRefDigest: string | null;
  receiptDigest: string;
}>;

export function buildContextIngressReceipt(
  result: ContextIngressResult,
  options?: Readonly<{
    eventId?: string | null;
    observedAt?: string | null;
  }>
): ContextIngressReceipt;

export function verifyContextIngressReceipt(
  result: ContextIngressResult,
  receipt: ContextIngressReceipt
): true;

export type ContextRetrievalDebitReceipt = Readonly<{
  version: 1;
  kind: "CONTEXT_RETRIEVAL_DEBIT_RECEIPT";
  eventId: string | null;
  observedAt: string | null;
  query: string;
  queryDigest: string;
  match: "all" | "any";
  recall: "exact" | "tiered";
  totalCandidates: number;
  omittedResults: number;
  resultCount: number;
  returnedBytes: number;
  responseDigest: string;
  resultSetDigest: string;
  receiptDigest: string;
}>;

export function buildContextRetrievalDebitReceipt(
  response: LexicalSearchResponse,
  options?: Readonly<{
    eventId?: string | null;
    observedAt?: string | null;
  }>
): ContextRetrievalDebitReceipt;

export function verifyContextRetrievalDebitReceipt(
  response: LexicalSearchResponse,
  receipt: ContextRetrievalDebitReceipt
): true;

export type ContextSavingsLedger = Readonly<{
  version: 1;
  kind: "CONTEXT_SAVINGS_LEDGER";
  scopeType: "SESSION" | "PROJECT" | "GLOBAL";
  scopeId: string;
  eventId: string | null;
  observedAt: string | null;
  aggregation: "RECEIPTS" | "CHILD_LEDGERS";
  ingressReceiptCount: number;
  retrievalReceiptCount: number;
  childLedgerCount: number;
  grossBytesAvoided: number;
  retrievalBytes: number;
  netBytesAvoided: number;
  netBytesAdded: number;
  ingressReceiptDigests: readonly string[];
  retrievalReceiptDigests: readonly string[];
  childLedgerDigests: readonly string[];
  ledgerDigest: string;
}>;

export function buildContextSessionSavingsLedger(
  input: Readonly<{
    scopeId: string;
    ingressReceipts?: readonly ContextIngressReceipt[];
    retrievalReceipts?: readonly ContextRetrievalDebitReceipt[];
  }>,
  options?: Readonly<{
    eventId?: string | null;
    observedAt?: string | null;
  }>
): ContextSavingsLedger;

export function aggregateContextSavingsLedgers(
  input: Readonly<{
    scopeType: "PROJECT" | "GLOBAL";
    scopeId: string;
    childLedgers?: readonly ContextSavingsLedger[];
  }>,
  options?: Readonly<{
    eventId?: string | null;
    observedAt?: string | null;
  }>
): ContextSavingsLedger;

export function verifyContextSavingsLedger(
  ledger: ContextSavingsLedger
): true;

export type ContextSavingsReport = Readonly<{
  version: 1;
  kind: "CONTEXT_SAVINGS_REPORT";
  scopeType: "SESSION" | "PROJECT" | "GLOBAL";
  scopeId: string;
  eventId: string | null;
  observedAt: string | null;
  aggregation: "RECEIPTS" | "CHILD_LEDGERS";
  status: "SAVINGS" | "ADDED_BYTES" | "NEUTRAL";
  unit: "UTF8_BYTES";
  ingressBasis: "PROOF_CARRYING_INGRESS_RECEIPTS";
  retrievalBasis: "SERIALIZED_RESPONSE_RETURNED_TO_CALLER";
  netBasis: "GROSS_DIVERSION_MINUS_RETRIEVAL_RESPONSE_DEBIT";
  claimBoundary: "BYTE_ACCOUNTING_ONLY";
  ingressReceiptCount: number;
  retrievalReceiptCount: number;
  childLedgerCount: number;
  observedRawBytes: number;
  ingressContextBytes: number;
  retrievalBytes: number;
  grossBytesAvoided: number;
  netBytesAvoided: number;
  netBytesAdded: number;
  ledgerDigest: string;
  ingressReceiptDigests: readonly string[];
  retrievalReceiptDigests: readonly string[];
  childLedgerDigests: readonly string[];
  reportDigest: string;
}>;

export function buildContextSavingsReport(
  input: Readonly<{
    ledger: ContextSavingsLedger;
    ingressReceipts?: readonly ContextIngressReceipt[];
    retrievalReceipts?: readonly ContextRetrievalDebitReceipt[];
  }>,
  options?: Readonly<{
    eventId?: string | null;
    observedAt?: string | null;
  }>
): ContextSavingsReport;

export function verifyContextSavingsReport(
  report: ContextSavingsReport
): true;

export type RetrievalQualityCorpus = Readonly<{
  schemaVersion: 1;
  corpusId: string;
  corpusVersion: string;
  provenance: Readonly<Record<string, JsonValue>>;
  sources: readonly Readonly<{
    sourceId: string;
    content: string;
    classification?: ContextClassValue;
    metadata?: Record<string, JsonValue>;
    maxChunkBytes?: number;
    chunkMode?: "plain" | "markdown";
  }>[];
  cases: readonly Readonly<{
    caseId: string;
    query: string;
    relevantSourceIds: readonly string[];
    k: number;
    recall?: "exact" | "tiered";
    match?: "all" | "any";
    maxBytes?: number;
    metadataEquals?: Record<
      string,
      string | number | boolean | null
    >;
    tags?: readonly string[];
  }>[];
  exactEvidenceCases: readonly Readonly<{
    caseId: string;
    sourceId: string;
    content: string;
    query: string;
    maxInlineBytes?: number;
    previewBytes?: number;
  }>[];
}>;

export type RetrievalQualityCaseResult = Readonly<{
  caseId: string;
  query: string;
  k: number;
  recall: "exact" | "tiered";
  match: "all" | "any";
  tags: readonly string[];
  relevantSourceIds: readonly string[];
  rankedSourceIds: readonly string[];
  topKSourceIds: readonly string[];
  matchKinds: Readonly<Record<string, string>>;
  precisionAtK: number;
  recallAtK: number;
  reciprocalRank: number;
  ndcgAtK: number;
  falsePositiveRateAtK: number;
}>;

export type RetrievalQualityAggregate = Readonly<{
  caseCount: number;
  meanPrecisionAtK: number;
  meanRecallAtK: number;
  mrr: number;
  meanNdcgAtK: number;
  meanFalsePositiveRateAtK: number;
}>;

export type RetrievalQualityReport = Readonly<{
  version: 1;
  kind: "RETRIEVAL_QUALITY_REPORT";
  evaluatorVersion: "1";
  corpusId: string;
  corpusVersion: string;
  corpusDigest: string;
  provenance: Readonly<Record<string, JsonValue>>;
  metricsBasis: Readonly<{
    relevanceUnit: "SOURCE_ID";
    chunkHandling: "FIRST_SOURCE_HIT_WINS";
    precisionAtK: string;
    recallAtK: string;
    mrr: string;
    ndcgAtK: string;
    falsePositiveRateAtK: string;
    efficiencyMetrics: "EXCLUDED";
  }>;
  aggregate: RetrievalQualityAggregate;
  slices: Readonly<{
    typo: RetrievalQualityAggregate;
    crossStyleIdentifier: RetrievalQualityAggregate;
  }>;
  exactEvidencePreservation: Readonly<{
    caseCount: number;
    passed: number;
    failed: number;
    passRate: number;
    details: readonly Readonly<{
      caseId: string;
      sourceId: string;
      byteIdentical: boolean;
      fuzzyRetrievalLeak: boolean;
      passed: boolean;
    }>[];
  }>;
  cases: readonly RetrievalQualityCaseResult[];
  reportDigest: string;
}>;

export function evaluateRetrievalQuality(
  corpus: RetrievalQualityCorpus
): RetrievalQualityReport;

export function prepareContextIngress(
  input: Readonly<{
    retrieval?: Pick<PersistentLexicalIndex, "addSource">;
    sourceId: string;
    content: string;
    classification?: ContextClassValue;
    metadata?: Record<string, JsonValue>;
    maxInlineBytes?: number;
    previewBytes?: number;
    maxChunkBytes?: number;
    chunkMode?: "plain" | "markdown";
  }>
): ContextIngressResult;

export function buildContinuityHandoff(
  input: Readonly<{
    journal: Pick<
      PersistentSessionJournal,
      "getSessionHead" | "listSession"
    >;
    retrieval: Pick<PersistentLexicalIndex, "search">;
    sessionId: string;
    retrievalQueries?: readonly string[];
  }>,
  options?: Readonly<{
    totalMaxBytes?: number;
    resumeMaxBytes?: number;
    retrievalMaxBytes?: number;
    retrievalMaxResults?: number;
    retrievalMatch?: "all" | "any";
    resumeOptions?: Readonly<Record<string, number>>;
  }>
): ContinuityHandoff;

export function buildContinuityTransport(
  input: Readonly<{
    journal: Pick<
      PersistentSessionJournal,
      "getSessionHead" | "listSession"
    >;
    retrieval: Pick<PersistentLexicalIndex, "search">;
    sessionId: string;
    retrievalQueries?: readonly string[];
  }>,
  options?: Readonly<{
    totalMaxBytes?: number;
    resumeMaxBytes?: number;
    retrievalMaxBytes?: number;
    retrievalMaxResults?: number;
    retrievalMatch?: "all" | "any";
    resumeOptions?: Readonly<Record<string, number>>;
  }>
): ContinuityTransport;

export type ContextMetadata = Readonly<
  Record<string, JsonValue>
>;

export type ContentReference = Readonly<{
  algorithm: "sha256";
  digest: string;
  bytes: number;
  path: string;
}>;

export type ContextItem = Readonly<{
  itemId: string;
  label: string | null;
  classification: ContextClassValue;
  bytesIn: number;
  bytesOut: number;
  rawRef: ContentReference | null;
  modelView: string;
  lossless: boolean;
  reduction?:
    | "direct-v1"
    | "working-head-tail-v1"
    | "json-structure-v1"
    | "text-signals-head-tail-v1";
  metadata: ContextMetadata;
}>;

export type ContextPacketItem = Readonly<{
  itemId: string;
  label: string | null;
  classification: ContextClassValue;
  payload: string;
  lossless: boolean;
  rawRef: Readonly<{
    algorithm: "sha256";
    digest: string;
    bytes: number;
  }> | null;
}>;

export type ContextPacket = Readonly<{
  version: 1;
  budgetBytes: number;
  usedBytes: number;
  omittedNonExactItems: number;
  items: readonly ContextPacketItem[];
}>;

export type ContextCoreCapabilities = Readonly<{
  modelCalls: false;
  arbitraryCodeExecution: false;
  shellExecution: false;
  networkAccess: false;
  authorityGrants: false;
  durableMemoryWrites: false;
  walletAccess: false;
  tradeExecution: false;
  gitWrite: false;
}>;

export type LexicalChunk = Readonly<{
  chunkId: string;
  sourceId: string;
  chunkIndex: number;
  digest: string;
  bytes: number;
  content: string;
  structureKind?: "text" | "fence";
}>;

export type LexicalSearchOptions = Readonly<{
  maxResults?: number;
  maxBytes?: number;
  match?: "all" | "any";
  recall?: "exact" | "tiered";
  maxRecallScanChunks?: number;
}>;

export function classifyInput(
  input?: Readonly<{
    content?: string;
    classification?: ContextClassValue;
    metadata?: ContextMetadata;
  }>
): ContextClassValue;

export class ContentStore {
  constructor(root: string);
  root: string;
  rawDir: string;
  put(content: string): ContentReference;
  putIdempotent(content: string): ContentReference;
  get(ref: ContentReference): string;
}

export class ContextCore {
  constructor(options: {
    store: Pick<ContentStore, "put">;
    bulkLimit?: number;
    workingLimit?: number;
  });
  store: Pick<ContentStore, "put">;
  bulkLimit: number;
  workingLimit: number;
  ingest(
    input?: Readonly<{
      content?: string;
      classification?: ContextClassValue;
      label?: string | null;
      metadata?: ContextMetadata;
    }>
  ): ContextItem;
}

export function buildContextPacket(
  items: readonly ContextItem[],
  options?: Readonly<{
    budgetBytes?: number;
  }>
): ContextPacket;

export function contextCoreCapabilities():
  ContextCoreCapabilities;

export class LexicalIndex {
  constructor(options?: {
    k1?: number;
    b?: number;
  });
  readonly k1: number;
  readonly b: number;
  addSource(input: LexicalSourceInput): LexicalSourceRef;
  search(
    query: string,
    options?: LexicalSearchOptions
  ): LexicalSearchResponse;
}

export function chunkMarkdownDeterministic(
  content: string,
  options?: Readonly<{
    sourceId?: string;
    maxChunkBytes?: number;
  }>
): readonly LexicalChunk[];

export function chunkTextDeterministic(
  content: string,
  options?: Readonly<{
    sourceId?: string;
    maxChunkBytes?: number;
  }>
): readonly LexicalChunk[];

export function tokenizeLexical(
  input: string
): readonly string[];
