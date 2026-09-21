import { createHash } from "node:crypto";

import {
  ContextClass,
  ContextCoreError,
} from "./types.mjs";
import {
  PersistentLexicalIndex,
} from "./persistent-retrieval.mjs";
import {
  prepareContextIngress,
} from "./ingress.mjs";

const INDEXABLE_CLASSES = new Set([
  ContextClass.WORKING_CONTEXT,
  ContextClass.BULK_MATERIAL,
  ContextClass.RETRIEVABLE_KNOWLEDGE,
]);

function sha256(text) {
  return createHash("sha256")
    .update(String(text ?? ""), "utf8")
    .digest("hex");
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (value && typeof value === "object") {
    const result = {};

    for (const key of Object.keys(value).sort()) {
      result[key] = canonicalize(value[key]);
    }

    return result;
  }

  return value;
}

function stableJson(value) {
  return JSON.stringify(canonicalize(value));
}

function assertNonEmptyString(name, value) {
  if (typeof value !== "string" || value.length === 0) {
    throw new ContextCoreError(
      `${name} must be a non-empty string`
    );
  }
}

function assertPositiveInteger(name, value) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new ContextCoreError(
      `${name} must be a positive integer`
    );
  }
}

function assertUniqueStrings(name, values) {
  if (!Array.isArray(values)) {
    throw new ContextCoreError(
      `${name} must be an array`
    );
  }

  const seen = new Set();

  for (const value of values) {
    assertNonEmptyString(name, value);

    if (seen.has(value)) {
      throw new ContextCoreError(
        `${name} contains duplicate value ${value}`
      );
    }

    seen.add(value);
  }

  return values;
}

function validateCorpus(corpus) {
  if (
    !corpus ||
    typeof corpus !== "object" ||
    corpus.schemaVersion !== 1
  ) {
    throw new ContextCoreError(
      "retrieval quality corpus identity is invalid"
    );
  }

  assertNonEmptyString(
    "retrieval quality corpusId",
    corpus.corpusId
  );
  assertNonEmptyString(
    "retrieval quality corpusVersion",
    corpus.corpusVersion
  );

  if (
    !corpus.provenance ||
    typeof corpus.provenance !== "object" ||
    Array.isArray(corpus.provenance)
  ) {
    throw new ContextCoreError(
      "retrieval quality provenance must be an object"
    );
  }

  if (!Array.isArray(corpus.sources) || corpus.sources.length === 0) {
    throw new ContextCoreError(
      "retrieval quality corpus requires sources"
    );
  }

  if (!Array.isArray(corpus.cases) || corpus.cases.length === 0) {
    throw new ContextCoreError(
      "retrieval quality corpus requires cases"
    );
  }

  if (
    !Array.isArray(corpus.exactEvidenceCases) ||
    corpus.exactEvidenceCases.length === 0
  ) {
    throw new ContextCoreError(
      "retrieval quality corpus requires exactEvidenceCases"
    );
  }

  const sourceIds =
    assertUniqueStrings(
      "retrieval quality sourceId",
      corpus.sources.map(source => source?.sourceId)
    );

  const sourceIdSet = new Set(sourceIds);

  for (const source of corpus.sources) {
    assertNonEmptyString(
      "retrieval quality source content",
      source.content
    );

    const classification =
      source.classification ??
      ContextClass.RETRIEVABLE_KNOWLEDGE;

    if (!INDEXABLE_CLASSES.has(classification)) {
      throw new ContextCoreError(
        `retrieval quality source ${source.sourceId} is not indexable`
      );
    }
  }

  assertUniqueStrings(
    "retrieval quality caseId",
    corpus.cases.map(item => item?.caseId)
  );

  for (const item of corpus.cases) {
    assertNonEmptyString(
      "retrieval quality query",
      item.query
    );
    assertPositiveInteger(
      "retrieval quality k",
      item.k
    );

    const relevant =
      assertUniqueStrings(
        "retrieval quality relevantSourceIds",
        item.relevantSourceIds
      );

    if (relevant.length === 0) {
      throw new ContextCoreError(
        `retrieval quality case ${item.caseId} requires relevantSourceIds`
      );
    }

    for (const sourceId of relevant) {
      if (!sourceIdSet.has(sourceId)) {
        throw new ContextCoreError(
          `retrieval quality case ${item.caseId} references unknown source ${sourceId}`
        );
      }
    }

    if (
      item.recall !== undefined &&
      item.recall !== "exact" &&
      item.recall !== "tiered"
    ) {
      throw new ContextCoreError(
        `retrieval quality case ${item.caseId} recall is invalid`
      );
    }

    if (
      item.match !== undefined &&
      item.match !== "all" &&
      item.match !== "any"
    ) {
      throw new ContextCoreError(
        `retrieval quality case ${item.caseId} match is invalid`
      );
    }

    assertUniqueStrings(
      "retrieval quality tags",
      item.tags ?? []
    );
  }

  assertUniqueStrings(
    "retrieval quality exact evidence caseId",
    corpus.exactEvidenceCases.map(item => item?.caseId)
  );

  for (const item of corpus.exactEvidenceCases) {
    assertNonEmptyString(
      "retrieval quality exact sourceId",
      item.sourceId
    );
    assertNonEmptyString(
      "retrieval quality exact content",
      item.content
    );
    assertNonEmptyString(
      "retrieval quality exact query",
      item.query
    );

    if (sourceIdSet.has(item.sourceId)) {
      throw new ContextCoreError(
        `exact evidence source ${item.sourceId} collides with indexed source`
      );
    }
  }
}

function dedupeSourceRanking(results) {
  const seen = new Set();
  const ranking = [];
  const matchKinds = {};

  for (const result of results) {
    if (seen.has(result.sourceId)) {
      continue;
    }

    seen.add(result.sourceId);
    ranking.push(result.sourceId);
    matchKinds[result.sourceId] =
      result.matchKind ?? "EXACT";
  }

  return { ranking, matchKinds };
}

function precisionAtK(ranking, relevant, k) {
  let hits = 0;

  for (const sourceId of ranking.slice(0, k)) {
    if (relevant.has(sourceId)) {
      hits += 1;
    }
  }

  return hits / k;
}

function recallAtK(ranking, relevant, k) {
  let hits = 0;

  for (const sourceId of ranking.slice(0, k)) {
    if (relevant.has(sourceId)) {
      hits += 1;
    }
  }

  return hits / relevant.size;
}

function reciprocalRank(ranking, relevant) {
  const index =
    ranking.findIndex(
      sourceId => relevant.has(sourceId)
    );

  return index === -1
    ? 0
    : 1 / (index + 1);
}

function ndcgAtK(ranking, relevant, k) {
  let dcg = 0;

  ranking
    .slice(0, k)
    .forEach((sourceId, index) => {
      if (relevant.has(sourceId)) {
        dcg +=
          1 / Math.log2(index + 2);
      }
    });

  let ideal = 0;

  for (
    let index = 0;
    index < Math.min(k, relevant.size);
    index += 1
  ) {
    ideal +=
      1 / Math.log2(index + 2);
  }

  return ideal === 0
    ? 0
    : dcg / ideal;
}

function falsePositiveRateAtK(
  ranking,
  relevant,
  k,
  sourceCount
) {
  const negatives =
    sourceCount - relevant.size;

  if (negatives <= 0) {
    return 0;
  }

  let falsePositives = 0;

  for (const sourceId of ranking.slice(0, k)) {
    if (!relevant.has(sourceId)) {
      falsePositives += 1;
    }
  }

  return falsePositives / negatives;
}

function mean(values) {
  if (values.length === 0) {
    return 0;
  }

  return (
    values.reduce(
      (total, value) => total + value,
      0
    ) / values.length
  );
}

function aggregateCaseMetrics(cases) {
  return {
    caseCount: cases.length,
    meanPrecisionAtK:
      mean(
        cases.map(
          item => item.precisionAtK
        )
      ),
    meanRecallAtK:
      mean(
        cases.map(
          item => item.recallAtK
        )
      ),
    mrr:
      mean(
        cases.map(
          item => item.reciprocalRank
        )
      ),
    meanNdcgAtK:
      mean(
        cases.map(
          item => item.ndcgAtK
        )
      ),
    meanFalsePositiveRateAtK:
      mean(
        cases.map(
          item =>
            item.falsePositiveRateAtK
        )
      ),
  };
}

function taggedSlice(cases, tag) {
  return aggregateCaseMetrics(
    cases.filter(
      item =>
        item.tags.includes(tag)
    )
  );
}

function evaluateExactEvidence(
  index,
  cases
) {
  const details = [];

  for (const item of cases) {
    const rawBytes =
      Buffer.byteLength(
        item.content,
        "utf8"
      );

    const result =
      prepareContextIngress({
        retrieval: index,
        sourceId: item.sourceId,
        content: item.content,
        classification:
          ContextClass.EXACT_EVIDENCE,
        maxInlineBytes:
          item.maxInlineBytes ?? 1,
        previewBytes:
          item.previewBytes ?? 16,
      });

    const retrieval =
      index.search(
        item.query,
        {
          recall: "tiered",
          match: "any",
          maxResults: 16,
          maxBytes: 65536,
        }
      );

    const leaked =
      retrieval.results.some(
        hit =>
          hit.sourceId === item.sourceId
      );

    const byteIdentical =
      result.mode === "INLINE" &&
      result.contextText === item.content &&
      result.rawBytes === rawBytes &&
      result.contextBytes === rawBytes &&
      result.bytesAvoided === 0 &&
      result.sourceRef === null;

    details.push({
      caseId: item.caseId,
      sourceId: item.sourceId,
      byteIdentical,
      fuzzyRetrievalLeak: leaked,
      passed:
        byteIdentical &&
        leaked === false,
    });
  }

  const passed =
    details.filter(
      item => item.passed
    ).length;

  return {
    caseCount: details.length,
    passed,
    failed: details.length - passed,
    passRate:
      details.length === 0
        ? 0
        : passed / details.length,
    details,
  };
}

function qualityReportPayload(report) {
  return {
    version: report.version,
    kind: report.kind,
    evaluatorVersion:
      report.evaluatorVersion,
    corpusId: report.corpusId,
    corpusVersion:
      report.corpusVersion,
    corpusDigest:
      report.corpusDigest,
    provenance:
      report.provenance,
    metricsBasis:
      report.metricsBasis,
    aggregate:
      report.aggregate,
    slices:
      report.slices,
    exactEvidencePreservation:
      report.exactEvidencePreservation,
    cases:
      report.cases,
  };
}

export function evaluateRetrievalQuality(
  corpus
) {
  validateCorpus(corpus);

  const corpusDigest =
    sha256(stableJson(corpus));

  const index =
    new PersistentLexicalIndex({
      path: ":memory:",
    });

  try {
    let totalChunkCount = 0;

    for (const source of corpus.sources) {
      const ref =
        index.addSource({
          sourceId: source.sourceId,
          content: source.content,
          classification:
            source.classification ??
            ContextClass.RETRIEVABLE_KNOWLEDGE,
          metadata:
            source.metadata ?? {},
          maxChunkBytes:
            source.maxChunkBytes,
          chunkMode:
            source.chunkMode,
        });

      totalChunkCount += ref.chunkCount;
    }

    const cases =
      corpus.cases.map(item => {
        const response =
          index.search(
            item.query,
            {
              maxResults:
                totalChunkCount,
              maxBytes:
                item.maxBytes ??
                65536,
              match:
                item.match ??
                "all",
              recall:
                item.recall ??
                "tiered",
              maxRecallScanChunks:
                totalChunkCount,
              metadataEquals:
                item.metadataEquals,
            }
          );

        const {
          ranking,
          matchKinds,
        } =
          dedupeSourceRanking(
            response.results
          );

        const relevant =
          new Set(
            item.relevantSourceIds
          );

        return {
          caseId: item.caseId,
          query: item.query,
          k: item.k,
          recall:
            item.recall ??
            "tiered",
          match:
            item.match ??
            "all",
          tags:
            [...(item.tags ?? [])],
          relevantSourceIds:
            [...item.relevantSourceIds],
          rankedSourceIds:
            ranking,
          topKSourceIds:
            ranking.slice(
              0,
              item.k
            ),
          matchKinds,
          precisionAtK:
            precisionAtK(
              ranking,
              relevant,
              item.k
            ),
          recallAtK:
            recallAtK(
              ranking,
              relevant,
              item.k
            ),
          reciprocalRank:
            reciprocalRank(
              ranking,
              relevant
            ),
          ndcgAtK:
            ndcgAtK(
              ranking,
              relevant,
              item.k
            ),
          falsePositiveRateAtK:
            falsePositiveRateAtK(
              ranking,
              relevant,
              item.k,
              corpus.sources.length
            ),
        };
      });

    const report = {
      version: 1,
      kind:
        "RETRIEVAL_QUALITY_REPORT",
      evaluatorVersion: "1",
      corpusId: corpus.corpusId,
      corpusVersion:
        corpus.corpusVersion,
      corpusDigest,
      provenance:
        canonicalize(
          corpus.provenance
        ),
      metricsBasis: {
        relevanceUnit:
          "SOURCE_ID",
        chunkHandling:
          "FIRST_SOURCE_HIT_WINS",
        precisionAtK:
          "RELEVANT_SOURCE_HITS_IN_TOP_K_DIVIDED_BY_K",
        recallAtK:
          "RELEVANT_SOURCE_HITS_IN_TOP_K_DIVIDED_BY_RELEVANT_SOURCE_COUNT",
        mrr:
          "MEAN_RECIPROCAL_RANK_OF_FIRST_RELEVANT_SOURCE",
        ndcgAtK:
          "BINARY_SOURCE_RELEVANCE_DCG_OVER_IDEAL_DCG",
        falsePositiveRateAtK:
          "IRRELEVANT_TOP_K_SOURCE_HITS_DIVIDED_BY_NON_RELEVANT_CORPUS_SOURCE_COUNT",
        efficiencyMetrics:
          "EXCLUDED",
      },
      aggregate:
        aggregateCaseMetrics(cases),
      slices: {
        typo:
          taggedSlice(
            cases,
            "TYPO"
          ),
        crossStyleIdentifier:
          taggedSlice(
            cases,
            "CROSS_STYLE_IDENTIFIER"
          ),
      },
      exactEvidencePreservation:
        evaluateExactEvidence(
          index,
          corpus.exactEvidenceCases
        ),
      cases,
    };

    return Object.freeze({
      ...report,
      reportDigest:
        sha256(
          stableJson(
            qualityReportPayload(
              report
            )
          )
        ),
    });
  } finally {
    index.close();
  }
}
