const ASCII_WORD = /^[a-z]+$/;
const MAX_IDENTIFIER_CHARS = 96;
const MIN_FRAGMENT_QUERY_CHARS = 4;
const FRAGMENT_WIDTH = 3;

export const RecallMatchKind = Object.freeze({
  EXACT: "EXACT",
  IDENTIFIER: "IDENTIFIER",
  MORPHOLOGY: "MORPHOLOGY",
  SUBSTRING: "SUBSTRING",
});

export function tokenizeLexicalBase(text) {
  return (
    String(text ?? "")
      .normalize("NFKC")
      .toLowerCase()
      .match(/[\p{L}\p{N}_]+/gu) ?? []
  );
}

const unique = values => [...new Set(values)];

function splitStructuredIdentifier(unit) {
  const normalized = String(unit ?? "").normalize("NFKC");

  const withBoundaries = normalized
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z])([0-9])/g, "$1 $2")
    .replace(/([0-9])([A-Za-z])/g, "$1 $2")
    .replace(/_+/g, " ");

  const parts = withBoundaries
    .split(/\s+/u)
    .flatMap(part => tokenizeLexicalBase(part))
    .filter(Boolean);

  const structured =
    normalized.includes("_") ||
    parts.length > 1;

  if (!structured) {
    return Object.freeze({
      parts: Object.freeze([]),
      collapsed: "",
      compoundTerm: "",
    });
  }

  const compoundTerm =
    tokenizeLexicalBase(normalized)[0] ?? "";

  return Object.freeze({
    parts: Object.freeze(parts),
    collapsed: parts.join("").slice(0, MAX_IDENTIFIER_CHARS),
    compoundTerm,
  });
}

function structuredIdentifiers(text) {
  const units =
    String(text ?? "")
      .normalize("NFKC")
      .match(/[\p{L}\p{N}_]+/gu) ?? [];

  const parts = [];
  const collapsed = [];
  const compoundTerms = [];

  for (const unit of units) {
    const split = splitStructuredIdentifier(unit);
    parts.push(...split.parts);
    if (split.collapsed) collapsed.push(split.collapsed);
    if (split.compoundTerm) {
      compoundTerms.push(split.compoundTerm);
    }
  }

  return Object.freeze({
    parts: Object.freeze(unique(parts)),
    collapsed: Object.freeze(unique(collapsed)),
    compoundTerms: Object.freeze(unique(compoundTerms)),
  });
}

function isConsonant(char) {
  return /^[a-z]$/.test(char) && !"aeiou".includes(char);
}

function hasVowel(text) {
  return /[aeiou]/.test(text);
}

function normalizeVerbStem(stem) {
  if (stem.length < 2) return stem;

  const last = stem.at(-1);
  const previous = stem.at(-2);

  if (
    last === previous &&
    isConsonant(last)
  ) {
    return stem.slice(0, -1);
  }

  if (
    stem.endsWith("at") ||
    stem.endsWith("bl") ||
    stem.endsWith("iz")
  ) {
    return `${stem}e`;
  }

  if (
    stem.length >= 3 &&
    isConsonant(stem.at(-1)) &&
    "aeiou".includes(stem.at(-2)) &&
    isConsonant(stem.at(-3)) &&
    !["w", "x", "y"].includes(stem.at(-1))
  ) {
    return `${stem}e`;
  }

  return stem;
}

const IRREGULAR = new Map([
  ["ran", "run"],
  ["gone", "go"],
  ["went", "go"],
  ["indices", "index"],
  ["indexes", "index"],
]);

export function morphologyKey(token) {
  const value =
    String(token ?? "")
      .normalize("NFKC")
      .toLowerCase();

  if (!ASCII_WORD.test(value) || value.length < 3) {
    return value;
  }

  if (IRREGULAR.has(value)) {
    return IRREGULAR.get(value);
  }

  if (value.endsWith("ies") && value.length > 4) {
    return `${value.slice(0, -3)}y`;
  }

  if (
    value.endsWith("ing") &&
    value.length > 5
  ) {
    const stem = value.slice(0, -3);
    if (hasVowel(stem)) return normalizeVerbStem(stem);
  }

  if (
    value.endsWith("ed") &&
    value.length > 4
  ) {
    const stem = value.slice(0, -2);
    if (hasVowel(stem)) return normalizeVerbStem(stem);
  }

  if (
    value.endsWith("es") &&
    value.length > 4
  ) {
    if (/(?:ches|shes|sses|xes|zes)$/.test(value)) {
      return value.slice(0, -2);
    }
    return value.slice(0, -1);
  }

  if (
    value.endsWith("s") &&
    value.length > 3 &&
    !/(?:ss|us|is)$/.test(value)
  ) {
    return value.slice(0, -1);
  }

  return value;
}

function trigrams(value) {
  const normalized =
    String(value ?? "")
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "")
      .slice(0, MAX_IDENTIFIER_CHARS);

  if (normalized.length < FRAGMENT_WIDTH) {
    return [];
  }

  const out = [];
  for (
    let index = 0;
    index <= normalized.length - FRAGMENT_WIDTH;
    index += 1
  ) {
    out.push(
      normalized.slice(
        index,
        index + FRAGMENT_WIDTH
      )
    );
  }
  return unique(out);
}

export function buildRecallProjection(
  content,
  { exactTokens = tokenizeLexicalBase(content) } = {}
) {
  const identifiers = structuredIdentifiers(content);

  const morphologyTokens = unique(
    [
      ...exactTokens,
      ...identifiers.parts,
    ]
      .map(morphologyKey)
      .filter(Boolean)
  );

  const substringValues = unique([
    ...identifiers.parts,
    ...identifiers.collapsed,
  ]);

  const fragmentTokens = unique(
    substringValues.flatMap(trigrams)
  );

  return Object.freeze({
    identifierTokens: identifiers.parts,
    morphologyTokens:
      Object.freeze(morphologyTokens),
    substringValues:
      Object.freeze(substringValues),
    fragmentTokens:
      Object.freeze(fragmentTokens),
  });
}

export function buildRecallQueryPlan(query) {
  const exactTerms =
    unique(tokenizeLexicalBase(query));
  const structured =
    structuredIdentifiers(query);

  const structuredCompoundTerms =
    new Set(structured.compoundTerms);

  const identifierTerms =
    unique([
      ...exactTerms.filter(
        term =>
          !structuredCompoundTerms.has(term)
      ),
      ...structured.parts,
    ]);

  const morphologyTerms =
    unique(
      identifierTerms
        .map(morphologyKey)
        .filter(Boolean)
    );

  const substringTerms =
    unique(
      exactTerms
        .map(term => term.replace(/_+/g, ""))
        .filter(
          term =>
            [...term].length >=
            MIN_FRAGMENT_QUERY_CHARS
        )
    );

  const fragmentTerms =
    unique(
      substringTerms.flatMap(trigrams)
    );

  return Object.freeze({
    exactTerms: Object.freeze(exactTerms),
    identifierTerms:
      Object.freeze(identifierTerms),
    morphologyTerms:
      Object.freeze(morphologyTerms),
    substringTerms:
      Object.freeze(substringTerms),
    fragmentTerms:
      Object.freeze(fragmentTerms),
  });
}

function frequencies(tokens) {
  const map = new Map();
  for (const token of tokens) {
    map.set(token, (map.get(token) ?? 0) + 1);
  }
  return map;
}

function eligiblePresent(tf, terms, match) {
  const present = terms.filter(
    term => (tf.get(term) ?? 0) > 0
  );

  const eligible =
    terms.length > 0 &&
    (
      match === "all"
        ? present.length === terms.length
        : present.length > 0
    );

  return { present, eligible };
}

function substringEligible(values, terms, match) {
  const matched = terms.filter(
    term =>
      values.some(value => value.includes(term))
  );

  return (
    terms.length > 0 &&
    (
      match === "all"
        ? matched.length === terms.length
        : matched.length > 0
    )
  );
}

function scoreSubstringLane({
  documents,
  substringTerms,
  fragmentTerms,
  match,
  k1,
  b,
}) {
  if (
    substringTerms.length === 0 ||
    fragmentTerms.length === 0
  ) {
    return [];
  }

  const eligibleDocuments =
    documents.filter(document =>
      substringEligible(
        document.recall.substringValues,
        substringTerms,
        match
      )
    );

  if (eligibleDocuments.length === 0) {
    return [];
  }

  return scoreLane({
    documents: eligibleDocuments,
    terms: fragmentTerms,
    tokenSelector:
      document =>
        document.recall.fragmentTokens,
    match,
    k1,
    b,
    matchKind:
      RecallMatchKind.SUBSTRING,
    lanePriority: 3,
  });
}

function scoreLane({
  documents,
  terms,
  tokenSelector,
  match,
  k1,
  b,
  matchKind,
  lanePriority,
  corpusStats,
}) {
  if (terms.length === 0) return [];

  const prepared = documents.map(document => {
    const tokens = tokenSelector(document);
    return {
      document,
      tokens,
      tf: frequencies(tokens),
    };
  });

  const n =
    corpusStats === undefined
      ? prepared.length
      : Number(corpusStats.documentCount);

  const avgLength =
    corpusStats === undefined
      ? (
          n === 0
            ? 0
            : prepared.reduce(
                (sum, item) =>
                  sum + item.tokens.length,
                0
              ) / n
        )
      : Number(corpusStats.averageLength);

  const df =
    corpusStats === undefined
      ? new Map(
          terms.map(term => [
            term,
            prepared.filter(
              item =>
                (item.tf.get(term) ?? 0) > 0
            ).length,
          ])
        )
      : corpusStats.documentFrequency;

  const results = [];

  for (const item of prepared) {
    const { present, eligible } =
      eligiblePresent(
        item.tf,
        terms,
        match
      );

    if (!eligible) continue;

    let score = 0;

    for (const term of present) {
      const tf = item.tf.get(term);
      const dft = Number(df.get(term) ?? 0);
      const idf = Math.log(
        1 +
          (n - dft + 0.5) /
            (dft + 0.5)
      );

      const denominator =
        tf +
        k1 *
          (
            1 -
            b +
            b *
              (
                avgLength
                  ? item.tokens.length /
                    avgLength
                  : 0
              )
          );

      score +=
        idf *
        (
          (tf * (k1 + 1)) /
          denominator
        );
    }

    results.push({
      ...item.document.result,
      score: Number(score.toFixed(12)),
      matchKind,
      lanePriority,
    });
  }

  return results;
}

export function scoreTieredRecallDocuments({
  documents,
  query,
  match = "all",
  k1 = 1.2,
  b = 0.75,
  corpusStatsByLane = {},
}) {
  const plan = buildRecallQueryPlan(query);
  const lanes = [
    {
      matchKind: RecallMatchKind.EXACT,
      lanePriority: 0,
      terms: plan.exactTerms,
      tokenSelector:
        document => document.exactTokens,
    },
    {
      matchKind:
        RecallMatchKind.IDENTIFIER,
      lanePriority: 1,
      terms: plan.identifierTerms,
      tokenSelector:
        document =>
          unique([
            ...document.exactTokens,
            ...document.recall.identifierTokens,
          ]),
    },
    {
      matchKind:
        RecallMatchKind.MORPHOLOGY,
      lanePriority: 2,
      terms: plan.morphologyTerms,
      tokenSelector:
        document =>
          document.recall.morphologyTokens,
    },
  ];

  const byChunk = new Map();

  for (const lane of lanes) {
    for (
      const candidate of scoreLane({
        documents,
        terms: lane.terms,
        tokenSelector:
          lane.tokenSelector,
        match,
        k1,
        b,
        matchKind:
          lane.matchKind,
        lanePriority:
          lane.lanePriority,
        corpusStats:
          corpusStatsByLane[
            lane.matchKind
          ],
      })
    ) {
      if (!byChunk.has(candidate.chunkId)) {
        byChunk.set(
          candidate.chunkId,
          candidate
        );
      }
    }
  }

  for (
    const candidate of scoreSubstringLane({
      documents,
      substringTerms: plan.substringTerms,
      fragmentTerms: plan.fragmentTerms,
      match,
      k1,
      b,
    })
  ) {
    if (!byChunk.has(candidate.chunkId)) {
      byChunk.set(
        candidate.chunkId,
        candidate
      );
    }
  }

  const results = [...byChunk.values()];

  results.sort(
    (a, b) =>
      a.lanePriority -
        b.lanePriority ||
      b.score - a.score ||
      a.sourceId.localeCompare(
        b.sourceId
      ) ||
      a.chunkIndex -
        b.chunkIndex ||
      a.chunkId.localeCompare(
        b.chunkId
      )
  );

  return Object.freeze({
    plan,
    results: Object.freeze(
      results.map(candidate => {
        const {
          lanePriority,
          ...publicCandidate
        } = candidate;
        return Object.freeze(
          publicCandidate
        );
      })
    ),
  });
}
