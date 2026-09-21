import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite");

import {
  ContextClass,
  LexicalIndex,
  PersistentLexicalIndex,
  chunkMarkdownDeterministic,
  prepareContextIngress,
} from "../src/index.mjs";
import {
  lexicalTokensForChunk,
} from "../src/retrieval.mjs";

test("markdown headings create deterministic chunk boundaries with exact reconstruction", () => {
  const content = [
    "# Alpha\n",
    "alpha body line\n",
    "alpha second line\n",
    "## Beta\n",
    "beta body line\n",
    "### Gamma\n",
    "gamma body",
  ].join("");

  const chunks = chunkMarkdownDeterministic(content, {
    sourceId: "markdown-boundaries",
    maxChunkBytes: 256,
  });

  assert.equal(chunks.map(chunk => chunk.content).join(""), content);
  assert.ok(chunks.every(chunk => chunk.bytes <= 256));
  assert.equal(chunks[0].content.startsWith("# Alpha\n"), true);
  assert.equal(chunks[1].content.startsWith("## Beta\n"), true);
  assert.equal(chunks[2].content.startsWith("### Gamma\n"), true);

  const again = chunkMarkdownDeterministic(content, {
    sourceId: "markdown-boundaries",
    maxChunkBytes: 256,
  });
  assert.deepEqual(again, chunks);
});

test("fenced code block stays atomic when it fits the hard byte cap", () => {
  const block = [
    "```js\n",
    "# this is code, not a heading\n",
    "const frog = 'toad';\n",
    "```\n",
  ].join("");

  const content = [
    "# Alpha\n",
    "preface preface preface preface\n",
    block,
    "## Beta\n",
    "after\n",
  ].join("");

  const chunks = chunkMarkdownDeterministic(content, {
    sourceId: "markdown-fence",
    maxChunkBytes: 96,
  });

  assert.equal(chunks.map(chunk => chunk.content).join(""), content);
  assert.ok(chunks.every(chunk => chunk.bytes <= 96));
  assert.equal(chunks.filter(chunk => chunk.content.includes("```js")).length, 1);
  assert.equal(chunks.filter(chunk => chunk.content.includes("const frog")).length, 1);

  const codeChunk = chunks.find(chunk => chunk.content.includes("const frog"));
  assert.ok(codeChunk);
  assert.equal(codeChunk.content.includes(block), true);
});

test("oversized fenced block splits deterministically rather than violating byte cap", () => {
  const content = [
    "# Oversized\n",
    "```txt\n",
    "x".repeat(300),
    "\n```\n",
    "tail",
  ].join("");

  const chunks = chunkMarkdownDeterministic(content, {
    sourceId: "oversized-fence",
    maxChunkBytes: 96,
  });

  assert.equal(chunks.map(chunk => chunk.content).join(""), content);
  assert.ok(chunks.length > 2);
  assert.ok(chunks.every(chunk => chunk.bytes <= 96));

  const again = chunkMarkdownDeterministic(content, {
    sourceId: "oversized-fence",
    maxChunkBytes: 96,
  });
  assert.deepEqual(again, chunks);
});

test("oversized fence continuations cannot promote code headings", () => {
  const content = [
    "# Real Heading\n",
    "before\n",
    "```txt\n",
    "x".repeat(140),
    "\n# FAKE-CODE-HEADING\n",
    "y".repeat(140),
    "\n```\n",
    "after\n",
  ].join("");

  const chunks = chunkMarkdownDeterministic(content, {
    sourceId: "oversized-fence-heading",
    maxChunkBytes: 96,
  });

  assert.equal(chunks.map(chunk => chunk.content).join(""), content);

  const fenceChunks = chunks.filter(
    chunk => chunk.structureKind === "fence"
  );
  assert.ok(fenceChunks.length > 1);

  const fakeChunk = fenceChunks.find(
    chunk => chunk.content.includes("FAKE-CODE-HEADING")
  );
  assert.ok(fakeChunk);

  const tokens = lexicalTokensForChunk(fakeChunk.content, {
    chunkMode: "markdown",
    structureKind: fakeChunk.structureKind,
  });

  assert.equal(
    tokens.filter(token => token === "fake").length,
    1
  );
  assert.equal(
    tokens.filter(token => token === "code").length,
    1
  );
  assert.equal(
    tokens.filter(token => token === "heading").length,
    1
  );
});

test("markdown heading terms receive deterministic lexical ranking weight", () => {
  const index = new LexicalIndex();

  index.addSource({
    sourceId: "heading-doc",
    content: "# Liquidity\nplain alpha beta gamma delta\n",
    classification: ContextClass.RETRIEVABLE_KNOWLEDGE,
    chunkMode: "markdown",
  });

  index.addSource({
    sourceId: "body-doc",
    content: "# Other\nliquidity alpha beta gamma delta\n",
    classification: ContextClass.RETRIEVABLE_KNOWLEDGE,
    chunkMode: "markdown",
  });

  const result = index.search("liquidity", {
    maxResults: 4,
    maxBytes: 4096,
  });

  assert.equal(result.results.length, 2);
  assert.equal(result.results[0].sourceId, "heading-doc");
  assert.ok(result.results[0].score > result.results[1].score);
});

test("persistent markdown retrieval matches in-memory weighted ordering across reopen", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "context-core-structured-"));
  const dbPath = path.join(root, "context.sqlite");
  const memory = new LexicalIndex();
  let persistent;

  try {
    const docs = [
      {
        sourceId: "heading-doc",
        content: "# Execution\nplain alpha beta gamma\n",
      },
      {
        sourceId: "body-doc",
        content: "# Other\nexecution alpha beta gamma\n",
      },
    ];

    persistent = new PersistentLexicalIndex({ path: dbPath });

    for (const doc of docs) {
      const input = {
        ...doc,
        classification: ContextClass.RETRIEVABLE_KNOWLEDGE,
        chunkMode: "markdown",
        metadata: { sessionId: "structured-parity" },
      };
      memory.addSource(input);
      persistent.addSource(input);
    }

    const expected = memory
      .search("execution", { maxResults: 4, maxBytes: 4096 })
      .results.map(result => result.sourceId);

    let actual = persistent
      .search("execution", {
        maxResults: 4,
        maxBytes: 4096,
        metadataEquals: { sessionId: "structured-parity" },
      })
      .results.map(result => result.sourceId);

    assert.deepEqual(actual, expected);
    persistent.close();
    persistent = undefined;

    persistent = new PersistentLexicalIndex({ path: dbPath });
    actual = persistent
      .search("execution", {
        maxResults: 4,
        maxBytes: 4096,
        metadataEquals: { sessionId: "structured-parity" },
      })
      .results.map(result => result.sourceId);

    assert.deepEqual(actual, expected);
  } finally {
    try {
      persistent?.close();
    } catch {}
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("source identity cannot silently rebind chunk mode", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "context-core-chunk-mode-"));
  const dbPath = path.join(root, "context.sqlite");
  let index;

  try {
    const content = "# Alpha\nbody\n";
    index = new PersistentLexicalIndex({ path: dbPath });

    index.addSource({
      sourceId: "mode-bound",
      content,
      classification: ContextClass.RETRIEVABLE_KNOWLEDGE,
      chunkMode: "markdown",
    });

    index.close();
    index = new PersistentLexicalIndex({ path: dbPath });

    assert.throws(
      () =>
        index.addSource({
          sourceId: "mode-bound",
          content,
          classification: ContextClass.RETRIEVABLE_KNOWLEDGE,
          chunkMode: "plain",
        }),
      /already uses chunkMode markdown/
    );
  } finally {
    try {
      index?.close();
    } catch {}
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("stored chunk structure relabel tampering fails closed", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "context-core-structure-tamper-"));
  const dbPath = path.join(root, "context.sqlite");
  let index;

  try {
    index = new PersistentLexicalIndex({ path: dbPath });

    index.addSource({
      sourceId: "structure-tamper",
      content: [
        "# Real\n",
        "```txt\n",
        "# code heading\n",
        "```\n",
      ].join(""),
      classification: ContextClass.RETRIEVABLE_KNOWLEDGE,
      chunkMode: "markdown",
    });

    index.close();
    index = undefined;

    const db = new DatabaseSync(dbPath);
    db.prepare(`
      UPDATE chunks
      SET structure_kind = 'text'
      WHERE source_id = ?
        AND structure_kind = 'fence'
    `).run("structure-tamper");
    db.close();

    index = new PersistentLexicalIndex({ path: dbPath });

    assert.throws(
      () =>
        index.search("code heading", {
          maxResults: 4,
          maxBytes: 4096,
        }),
      /stored chunk structure integrity mismatch/
    );
  } finally {
    try {
      index?.close();
    } catch {}
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("stored source chunk-mode relabel tampering fails closed", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "context-core-mode-tamper-"));
  const dbPath = path.join(root, "context.sqlite");
  let index;

  try {
    index = new PersistentLexicalIndex({ path: dbPath });

    index.addSource({
      sourceId: "mode-tamper",
      content: "# Weighted Heading\nbody\n",
      classification: ContextClass.RETRIEVABLE_KNOWLEDGE,
      chunkMode: "markdown",
    });

    index.close();
    index = undefined;

    const db = new DatabaseSync(dbPath);
    db.prepare(`
      UPDATE sources
      SET chunk_mode = 'plain'
      WHERE source_id = ?
    `).run("mode-tamper");
    db.close();

    assert.throws(
      () =>
        new PersistentLexicalIndex({ path: dbPath }),
      /(?:stored token|stored index policy) integrity mismatch/
    );
  } finally {
    try {
      index?.close();
    } catch {}
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("pre-context diversion can opt into markdown structured indexing", () => {
  const index = new PersistentLexicalIndex({ path: ":memory:" });

  try {
    const content = [
      "# Funding Pressure\n",
      "body body body\n",
      "x".repeat(5000),
      "\n## Tail Signal\n",
      "ORCHID-FUNDING-947\n",
    ].join("");

    const result = prepareContextIngress({
      retrieval: index,
      sourceId: "structured-ingress",
      content,
      classification: ContextClass.BULK_MATERIAL,
      metadata: { sessionId: "structured-ingress" },
      maxInlineBytes: 256,
      previewBytes: 64,
      chunkMode: "markdown",
    });

    assert.equal(result.mode, "DEFERRED");

    const recovered = index.search("tail signal orchid funding 947", {
      maxResults: 4,
      maxBytes: 4096,
      match: "all",
      metadataEquals: { sessionId: "structured-ingress" },
    });

    assert.ok(
      recovered.results.some(result =>
        result.content.includes("ORCHID-FUNDING-947")
      )
    );
  } finally {
    index.close();
  }
});
