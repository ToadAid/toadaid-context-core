import { createHash } from "node:crypto";
import { classifyInput } from "./classify.mjs";
import {
  ContextBudgetExceeded,
  ContextClass,
  ContextCoreError,
} from "./types.mjs";
import {
  buildRecallProjection,
  scoreTieredRecallDocuments,
  tokenizeLexicalBase,
} from "./recall.mjs";

const INDEXABLE = new Set([
  ContextClass.WORKING_CONTEXT,
  ContextClass.BULK_MATERIAL,
  ContextClass.RETRIEVABLE_KNOWLEDGE,
]);

const sha256 = text =>
  createHash("sha256").update(text, "utf8").digest("hex");

const bytes = text => Buffer.byteLength(text, "utf8");

export function tokenizeLexical(text) {
  return tokenizeLexicalBase(text);
}

function splitLongPiece(piece, limit) {
  const out = [];
  let current = "";
  for (const char of piece) {
    if (current && bytes(current + char) > limit) {
      out.push(current);
      current = char;
    } else {
      current += char;
    }
  }
  if (current) out.push(current);
  return out;
}

const VALID_CHUNK_MODES = new Set(["plain", "markdown"]);
const MARKDOWN_HEADING_WEIGHT = 3;

export function normalizeChunkMode(chunkMode = "plain") {
  if (!VALID_CHUNK_MODES.has(chunkMode)) {
    throw new ContextCoreError(
      'chunkMode must be "plain" or "markdown"'
    );
  }
  return chunkMode;
}

function linesPreserveNewlines(text) {
  return text.split("\n").map((line, index, all) =>
    index < all.length - 1 ? `${line}\n` : line
  );
}

function fenceMarker(line) {
  const bare = line.endsWith("\n") ? line.slice(0, -1) : line;
  const trimmed = bare.trimStart();
  const indent = bare.length - trimmed.length;
  if (indent > 3) return undefined;

  const char = trimmed[0];
  if (char !== "`" && char !== "~") return undefined;

  let length = 0;
  while (trimmed[length] === char) length += 1;
  if (length < 3) return undefined;

  return Object.freeze({ char, length });
}

function closesFence(line, fence) {
  const bare = line.endsWith("\n") ? line.slice(0, -1) : line;
  const trimmed = bare.trimStart();
  const indent = bare.length - trimmed.length;
  if (indent > 3 || trimmed[0] !== fence.char) return false;

  let length = 0;
  while (trimmed[length] === fence.char) length += 1;
  if (length < fence.length) return false;

  return trimmed.slice(length).trim() === "";
}

function markdownHeadingText(line) {
  const bare = line.endsWith("\n") ? line.slice(0, -1) : line;
  const match = bare.match(/^ {0,3}#{1,6}(?:[ \t]+|$)(.*)$/);
  if (!match) return undefined;

  return match[1]
    .replace(/[ \t]+#+[ \t]*$/, "")
    .trim();
}

function markdownHeadingTokens(content) {
  const tokens = [];
  let fence;

  for (const line of linesPreserveNewlines(String(content ?? ""))) {
    if (fence) {
      if (closesFence(line, fence)) fence = undefined;
      continue;
    }

    const marker = fenceMarker(line);
    if (marker) {
      fence = marker;
      continue;
    }

    const heading = markdownHeadingText(line);
    if (heading !== undefined) {
      tokens.push(...tokenizeLexical(heading));
    }
  }

  return tokens;
}

export function lexicalTokensForChunk(
  content,
  {
    chunkMode = "plain",
    structureKind = "text",
  } = {}
) {
  const resolvedChunkMode = normalizeChunkMode(chunkMode);
  const base = tokenizeLexical(content);

  if (
    resolvedChunkMode !== "markdown" ||
    structureKind === "fence"
  ) {
    return base;
  }

  const headingTokens = markdownHeadingTokens(content);
  const weighted = [...base];

  for (let copy = 1; copy < MARKDOWN_HEADING_WEIGHT; copy += 1) {
    weighted.push(...headingTokens);
  }

  return weighted;
}

function makeChunk(
  sourceId,
  chunkIndex,
  content,
  structureKind = "text"
) {
  const digest = sha256(`${sourceId}\0${chunkIndex}\0${content}`);
  return Object.freeze({
    chunkId: `${sourceId}:${chunkIndex}:${digest.slice(0, 16)}`,
    sourceId,
    chunkIndex,
    digest,
    bytes: bytes(content),
    content,
    structureKind,
  });
}

export function chunkMarkdownDeterministic(
  content,
  { sourceId = "source", maxChunkBytes = 2048 } = {}
) {
  if (!Number.isInteger(maxChunkBytes) || maxChunkBytes < 64) {
    throw new ContextCoreError("maxChunkBytes must be an integer >= 64");
  }

  const text = String(content ?? "");
  if (!text) return Object.freeze([]);

  const lines = linesPreserveNewlines(text);
  const chunks = [];
  let current = "";

  const flush = () => {
    if (!current) return;
    chunks.push(makeChunk(sourceId, chunks.length, current));
    current = "";
  };

  const addPiece = piece => {
    if (bytes(piece) > maxChunkBytes) {
      for (const split of splitLongPiece(piece, maxChunkBytes)) {
        addPiece(split);
      }
      return;
    }

    if (!current || bytes(current + piece) <= maxChunkBytes) {
      current += piece;
      return;
    }

    flush();
    current = piece;
  };

  const addAtomicFence = block => {
    // Fenced code receives its own chunk(s). This preserves lexical fence state
    // independently of surrounding prose while leaving raw bytes untouched.
    flush();

    if (bytes(block) <= maxChunkBytes) {
      chunks.push(
        makeChunk(
          sourceId,
          chunks.length,
          block,
          "fence"
        )
      );
      return;
    }

    // Hard byte bound is stronger than fence atomicity. Every oversized fence
    // fragment remains explicitly tagged as fence content so a continuation
    // fragment cannot promote code lines such as "# fake heading".
    for (const split of splitLongPiece(block, maxChunkBytes)) {
      chunks.push(
        makeChunk(
          sourceId,
          chunks.length,
          split,
          "fence"
        )
      );
    }
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    const heading = markdownHeadingText(line);
    if (heading !== undefined) {
      flush();
      addPiece(line);
      continue;
    }

    const marker = fenceMarker(line);
    if (marker) {
      let block = line;

      while (index + 1 < lines.length) {
        index += 1;
        const next = lines[index];
        block += next;
        if (closesFence(next, marker)) break;
      }

      addAtomicFence(block);
      continue;
    }

    addPiece(line);
  }

  flush();

  if (chunks.map(chunk => chunk.content).join("") !== text) {
    throw new ContextCoreError(
      "markdown chunk reconstruction mismatch"
    );
  }

  if (chunks.some(chunk => chunk.bytes > maxChunkBytes)) {
    throw new ContextCoreError(
      "markdown chunk exceeds maxChunkBytes"
    );
  }

  return Object.freeze(chunks);
}

export function chunkTextDeterministic(
  content,
  { sourceId = "source", maxChunkBytes = 2048 } = {}
) {
  if (!Number.isInteger(maxChunkBytes) || maxChunkBytes < 64) {
    throw new ContextCoreError("maxChunkBytes must be an integer >= 64");
  }

  const text = String(content ?? "");
  if (!text) return Object.freeze([]);

  const lines = text.split("\n").map((line, i, all) =>
    i < all.length - 1 ? `${line}\n` : line
  );
  const pieces = lines.flatMap(line =>
    bytes(line) <= maxChunkBytes
      ? [line]
      : splitLongPiece(line, maxChunkBytes)
  );

  const chunks = [];
  let current = "";

  const flush = () => {
    if (!current) return;
    const chunkIndex = chunks.length;
    const digest = sha256(`${sourceId}\0${chunkIndex}\0${current}`);
    chunks.push(Object.freeze({
      chunkId: `${sourceId}:${chunkIndex}:${digest.slice(0, 16)}`,
      sourceId,
      chunkIndex,
      digest,
      bytes: bytes(current),
      content: current,
    }));
    current = "";
  };

  for (const piece of pieces) {
    if (!current || bytes(current + piece) <= maxChunkBytes) {
      current += piece;
    } else {
      flush();
      current = piece;
    }
  }
  flush();

  return Object.freeze(chunks);
}

const frequencies = tokens => {
  const map = new Map();
  for (const token of tokens) {
    map.set(token, (map.get(token) ?? 0) + 1);
  }
  return map;
};

const jsonBytes = value => bytes(JSON.stringify(value));

function stabilizeUsedBytes(value) {
  let used = 0;
  for (let i = 0; i < 8; i += 1) {
    const candidate = { ...value, usedBytes: used };
    const measured = jsonBytes(candidate);
    if (measured === used) return candidate;
    used = measured;
  }
  return { ...value, usedBytes: jsonBytes({ ...value, usedBytes: used }) };
}

export class LexicalIndex {
  constructor({ k1 = 1.2, b = 0.75 } = {}) {
    if (!(k1 > 0)) throw new ContextCoreError("k1 must be > 0");
    if (!(b >= 0 && b <= 1)) {
      throw new ContextCoreError("b must be between 0 and 1");
    }
    this.k1 = k1;
    this.b = b;
    this.sources = new Map();
    this.documents = new Map();
  }

  addSource({
    sourceId,
    content,
    classification,
    metadata = {},
    maxChunkBytes = 2048,
    chunkMode = "plain",
  }) {
    if (!sourceId || typeof sourceId !== "string") {
      throw new ContextCoreError("sourceId must be a non-empty string");
    }
    const text = String(content ?? "");
    const resolvedClassification = classifyInput({
      content: text,
      classification,
      metadata,
    });
    const resolvedChunkMode = normalizeChunkMode(chunkMode);

    if (!INDEXABLE.has(resolvedClassification)) {
      throw new ContextCoreError(
        `classification ${resolvedClassification} is not eligible for lexical indexing`
      );
    }

    const contentDigest = sha256(text);
    const prior = this.sources.get(sourceId);

    if (prior) {
      if (prior.contentDigest !== contentDigest) {
        throw new ContextCoreError(
          `sourceId ${sourceId} already refers to different content`
        );
      }
      if (prior.chunkMode !== resolvedChunkMode) {
        throw new ContextCoreError(
          `sourceId ${sourceId} already uses chunkMode ${prior.chunkMode}`
        );
      }
      return prior.publicRef;
    }

    const chunks =
      resolvedChunkMode === "markdown"
        ? chunkMarkdownDeterministic(text, {
            sourceId,
            maxChunkBytes,
          })
        : chunkTextDeterministic(text, {
            sourceId,
            maxChunkBytes,
          });

    for (const chunk of chunks) {
      const tokens = lexicalTokensForChunk(chunk.content, {
        chunkMode: resolvedChunkMode,
        structureKind: chunk.structureKind ?? "text",
      });
      this.documents.set(chunk.chunkId, {
        ...chunk,
        classification: resolvedClassification,
        metadata: { ...metadata },
        length: tokens.length,
        tf: frequencies(tokens),
        recall: buildRecallProjection(
          chunk.content,
          { exactTokens: tokens }
        ),
      });
    }

    const publicRef = Object.freeze({
      sourceId,
      classification: resolvedClassification,
      contentDigest,
      chunkCount: chunks.length,
      chunks: Object.freeze(chunks.map(chunk => Object.freeze({
        chunkId: chunk.chunkId,
        chunkIndex: chunk.chunkIndex,
        digest: chunk.digest,
        bytes: chunk.bytes,
      }))),
    });

    this.sources.set(sourceId, {
      contentDigest,
      chunkMode: resolvedChunkMode,
      publicRef,
    });
    return publicRef;
  }

  search(
    query,
    {
      maxResults = 8,
      maxBytes = 4096,
      match = "all",
      recall = "exact",
      maxRecallScanChunks = 4096,
    } = {}
  ) {
    if (!Number.isInteger(maxResults) || maxResults < 1) {
      throw new ContextCoreError("maxResults must be an integer >= 1");
    }
    if (!Number.isInteger(maxBytes) || maxBytes < 128) {
      throw new ContextCoreError("maxBytes must be an integer >= 128");
    }
    if (!["all", "any"].includes(match)) {
      throw new ContextCoreError('match must be "all" or "any"');
    }
    if (!["exact", "tiered"].includes(recall)) {
      throw new ContextCoreError(
        'recall must be "exact" or "tiered"'
      );
    }
    if (
      !Number.isInteger(maxRecallScanChunks) ||
      maxRecallScanChunks < 1
    ) {
      throw new ContextCoreError(
        "maxRecallScanChunks must be an integer >= 1"
      );
    }

    if (recall === "tiered") {
      const docs = [...this.documents.values()];

      if (docs.length > maxRecallScanChunks) {
        throw new ContextCoreError(
          `tiered recall scan requires ${docs.length} chunks, exceeding maxRecallScanChunks ${maxRecallScanChunks}`
        );
      }

      const documents = docs.map(doc => ({
        exactTokens: [
          ...doc.tf.entries()
        ].flatMap(
          ([token, count]) =>
            Array.from(
              { length: count },
              () => token
            )
        ),
        recall: doc.recall,
        result: {
          sourceId: doc.sourceId,
          chunkId: doc.chunkId,
          chunkIndex: doc.chunkIndex,
          classification: doc.classification,
          content: doc.content,
          contentDigest: doc.digest,
          metadata: { ...doc.metadata },
        },
      }));

      const tiered =
        scoreTieredRecallDocuments({
          documents,
          query,
          match,
          k1: this.k1,
          b: this.b,
        });

      let response = stabilizeUsedBytes({
        query: String(query ?? ""),
        terms: [...tiered.plan.exactTerms],
        match,
        recall: "tiered",
        totalCandidates: tiered.results.length,
        omittedResults: tiered.results.length,
        results: [],
      });

      if (jsonBytes(response) > maxBytes) {
        throw new ContextBudgetExceeded(
          "retrieval envelope exceeds maxBytes"
        );
      }

      for (const candidate of tiered.results) {
        if (response.results.length >= maxResults) break;

        const next = stabilizeUsedBytes({
          ...response,
          results: [...response.results, candidate],
          omittedResults:
            tiered.results.length -
            response.results.length -
            1,
        });

        if (jsonBytes(next) <= maxBytes) response = next;
      }

      response = stabilizeUsedBytes({
        ...response,
        omittedResults:
          tiered.results.length -
          response.results.length,
      });

      if (jsonBytes(response) > maxBytes) {
        throw new ContextBudgetExceeded(
          "retrieval response exceeds maxBytes"
        );
      }

      return Object.freeze({
        ...response,
        terms: Object.freeze([...response.terms]),
        results: Object.freeze(
          response.results.map(Object.freeze)
        ),
      });
    }

    const terms = [...new Set(tokenizeLexical(query))];
    const docs = [...this.documents.values()];
    const n = docs.length;
    const avgLength = n
      ? docs.reduce((sum, doc) => sum + doc.length, 0) / n
      : 0;

    const df = new Map(
      terms.map(term => [
        term,
        docs.filter(doc => (doc.tf.get(term) ?? 0) > 0).length,
      ])
    );

    const scored = [];
    for (const doc of docs) {
      const present = terms.filter(term => (doc.tf.get(term) ?? 0) > 0);
      const eligible =
        terms.length > 0 &&
        (match === "all"
          ? present.length === terms.length
          : present.length > 0);
      if (!eligible) continue;

      let score = 0;
      for (const term of present) {
        const tf = doc.tf.get(term);
        const dft = df.get(term);
        const idf = Math.log(1 + (n - dft + 0.5) / (dft + 0.5));
        const denominator =
          tf +
          this.k1 *
            (1 - this.b + this.b * (avgLength ? doc.length / avgLength : 0));
        score += idf * ((tf * (this.k1 + 1)) / denominator);
      }

      scored.push({
        sourceId: doc.sourceId,
        chunkId: doc.chunkId,
        chunkIndex: doc.chunkIndex,
        classification: doc.classification,
        score: Number(score.toFixed(12)),
        content: doc.content,
        contentDigest: doc.digest,
        metadata: { ...doc.metadata },
      });
    }

    scored.sort(
      (a, b) =>
        b.score - a.score ||
        a.sourceId.localeCompare(b.sourceId) ||
        a.chunkIndex - b.chunkIndex ||
        a.chunkId.localeCompare(b.chunkId)
    );

    let response = stabilizeUsedBytes({
      query: String(query ?? ""),
      terms,
      match,
      totalCandidates: scored.length,
      omittedResults: scored.length,
      results: [],
    });

    if (jsonBytes(response) > maxBytes) {
      throw new ContextBudgetExceeded(
        "retrieval envelope exceeds maxBytes"
      );
    }

    for (const candidate of scored) {
      if (response.results.length >= maxResults) break;

      const next = stabilizeUsedBytes({
        ...response,
        results: [...response.results, candidate],
        omittedResults: scored.length - response.results.length - 1,
      });

      if (jsonBytes(next) <= maxBytes) response = next;
    }

    response = stabilizeUsedBytes({
      ...response,
      omittedResults: scored.length - response.results.length,
    });

    if (jsonBytes(response) > maxBytes) {
      throw new ContextBudgetExceeded(
        "retrieval response exceeds maxBytes"
      );
    }

    return Object.freeze({
      ...response,
      terms: Object.freeze([...response.terms]),
      results: Object.freeze(response.results.map(Object.freeze)),
    });
  }
}
