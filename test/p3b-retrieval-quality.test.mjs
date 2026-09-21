import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  evaluateRetrievalQuality,
} from "../src/index.mjs";

const fixtureUrl =
  new URL(
    "./fixtures/retrieval-quality-v1.json",
    import.meta.url
  );

function loadCorpus() {
  return JSON.parse(
    fs.readFileSync(
      fixtureUrl,
      "utf8"
    )
  );
}

function assertRatio(name, value) {
  assert.equal(
    Number.isFinite(value),
    true,
    `${name} must be finite`
  );
  assert.equal(
    value >= 0 && value <= 1,
    true,
    `${name} must be within [0,1]`
  );
}

test("retrieval quality corpus produces a deterministic provenance-bound report", () => {
  const corpus = loadCorpus();
  const first =
    evaluateRetrievalQuality(corpus);
  const second =
    evaluateRetrievalQuality(corpus);

  assert.deepEqual(first, second);
  assert.equal(
    first.kind,
    "RETRIEVAL_QUALITY_REPORT"
  );
  assert.equal(
    first.corpusId,
    corpus.corpusId
  );
  assert.equal(
    first.corpusVersion,
    corpus.corpusVersion
  );
  assert.equal(
    first.provenance.origin,
    corpus.provenance.origin
  );
  assert.match(
    first.corpusDigest,
    /^[0-9a-f]{64}$/
  );
  assert.match(
    first.reportDigest,
    /^[0-9a-f]{64}$/
  );
});

test("retrieval quality lab measures bounded source-level ranking metrics", () => {
  const report =
    evaluateRetrievalQuality(
      loadCorpus()
    );

  assert.equal(
    report.aggregate.caseCount,
    report.cases.length
  );

  for (const [name, value] of [
    [
      "meanPrecisionAtK",
      report.aggregate.meanPrecisionAtK,
    ],
    [
      "meanRecallAtK",
      report.aggregate.meanRecallAtK,
    ],
    ["mrr", report.aggregate.mrr],
    [
      "meanNdcgAtK",
      report.aggregate.meanNdcgAtK,
    ],
    [
      "meanFalsePositiveRateAtK",
      report.aggregate
        .meanFalsePositiveRateAtK,
    ],
  ]) {
    assertRatio(name, value);
  }

  for (const item of report.cases) {
    assertRatio(
      `${item.caseId}:precisionAtK`,
      item.precisionAtK
    );
    assertRatio(
      `${item.caseId}:recallAtK`,
      item.recallAtK
    );
    assertRatio(
      `${item.caseId}:reciprocalRank`,
      item.reciprocalRank
    );
    assertRatio(
      `${item.caseId}:ndcgAtK`,
      item.ndcgAtK
    );
    assertRatio(
      `${item.caseId}:falsePositiveRateAtK`,
      item.falsePositiveRateAtK
    );

    assert.equal(
      item.topKSourceIds.length <=
        item.k,
      true
    );

    assert.equal(
      new Set(
        item.rankedSourceIds
      ).size,
      item.rankedSourceIds.length,
      "source ranking must be deduplicated"
    );
  }
});

test("quality lab publishes typo and cross-style identifier slices without inventing a pass threshold", () => {
  const report =
    evaluateRetrievalQuality(
      loadCorpus()
    );

  assert.equal(
    report.slices.typo.caseCount,
    2
  );
  assert.equal(
    report.slices.crossStyleIdentifier
      .caseCount,
    2
  );

  assertRatio(
    "typo meanRecallAtK",
    report.slices.typo
      .meanRecallAtK
  );
  assertRatio(
    "cross-style meanRecallAtK",
    report.slices
      .crossStyleIdentifier
      .meanRecallAtK
  );
});

test("quality lab proves exact evidence remains byte-identical inline and unavailable as fuzzy retrieval material", () => {
  const report =
    evaluateRetrievalQuality(
      loadCorpus()
    );

  const exact =
    report.exactEvidencePreservation;

  assert.equal(exact.caseCount, 1);
  assert.equal(exact.passed, 1);
  assert.equal(exact.failed, 0);
  assert.equal(exact.passRate, 1);
  assert.equal(
    exact.details[0].byteIdentical,
    true
  );
  assert.equal(
    exact.details[0]
      .fuzzyRetrievalLeak,
    false
  );
});

test("quality report excludes compression context-efficiency token and cost metrics", () => {
  const report =
    evaluateRetrievalQuality(
      loadCorpus()
    );

  const serialized =
    JSON.stringify(report);

  for (const forbidden of [
    "\"bytesAvoided\"",
    "\"retrievalBytes\"",
    "\"netBytesAvoided\"",
    "\"netBytesAdded\"",
    "\"tokensSaved\"",
    "\"costSaved\"",
    "\"savingsPercent\"",
  ]) {
    assert.equal(
      serialized.includes(forbidden),
      false,
      `${forbidden} must stay outside quality report`
    );
  }

  assert.equal(
    report.metricsBasis
      .efficiencyMetrics,
    "EXCLUDED"
  );
});

test("quality corpus rejects unknown relevance labels and corpus content drift changes its digest", () => {
  const corpus = loadCorpus();

  assert.throws(
    () =>
      evaluateRetrievalQuality({
        ...corpus,
        cases: [
          {
            ...corpus.cases[0],
            relevantSourceIds: [
              "doc:does-not-exist",
            ],
          },
          ...corpus.cases.slice(1),
        ],
      }),
    /unknown source/
  );

  const baseline =
    evaluateRetrievalQuality(
      corpus
    );

  const drifted =
    evaluateRetrievalQuality({
      ...corpus,
      sources:
        corpus.sources.map(
          (source, index) =>
            index === 0
              ? {
                  ...source,
                  content:
                    `${source.content} drift`,
                }
              : source
        ),
    });

  assert.notEqual(
    baseline.corpusDigest,
    drifted.corpusDigest
  );
  assert.notEqual(
    baseline.reportDigest,
    drifted.reportDigest
  );
});


test("source-level scoring cannot be crowded out by duplicate chunks from one source", () => {
  const noisy =
    [
      "needle signal ".repeat(10),
      "needle signal ".repeat(10),
      "needle signal ".repeat(10),
      "needle signal ".repeat(10),
    ].join("\n\n");

  const corpus = {
    schemaVersion: 1,
    corpusId: "source-ranking-crowding",
    corpusVersion: "1.0.0",
    provenance: {
      origin: "SYNTHETIC_MULTI_CHUNK_ADVERSARY",
    },
    sources: [
      {
        sourceId: "doc:many-chunks",
        content: noisy,
        classification:
          "RETRIEVABLE_KNOWLEDGE",
        maxChunkBytes: 96,
      },
      {
        sourceId: "doc:second-source",
        content:
          "needle signal relevant secondary source",
        classification:
          "RETRIEVABLE_KNOWLEDGE",
      },
      {
        sourceId: "doc:irrelevant",
        content:
          "lotus pond garden reflection",
        classification:
          "RETRIEVABLE_KNOWLEDGE",
      },
    ],
    cases: [
      {
        caseId: "multi-chunk-crowding",
        query: "needle signal",
        relevantSourceIds: [
          "doc:many-chunks",
          "doc:second-source",
        ],
        k: 2,
        recall: "exact",
        match: "all",
        tags: ["ADVERSARIAL"],
      },
    ],
    exactEvidenceCases: [
      {
        caseId: "exact-crowding-canary",
        sourceId: "exact:crowding-canary",
        content:
          "EXACT_CROWDING_CANARY must remain exact.",
        query: "EXACT_CROWDING_CANARY",
      },
    ],
  };

  const report =
    evaluateRetrievalQuality(corpus);

  const result = report.cases[0];

  assert.deepEqual(
    new Set(result.topKSourceIds),
    new Set([
      "doc:many-chunks",
      "doc:second-source",
    ])
  );
  assert.equal(
    result.recallAtK,
    1
  );
  assert.equal(
    result.precisionAtK,
    1
  );
  assert.equal(
    result.rankedSourceIds.length >= 2,
    true
  );
});
