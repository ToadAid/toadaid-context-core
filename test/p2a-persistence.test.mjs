import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

import {
  ContextClass,
  LexicalIndex,
  PersistentLexicalIndex,
} from "../src/index.mjs";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite");

function sandbox() {
  const root = mkdtempSync(
    join(tmpdir(), "toadaid-context-p2a-p2-")
  );
  return {
    root,
    dbPath: join(root, "retrieval.sqlite"),
  };
}

function corpus(index) {
  index.addSource({
    sourceId: "alpha",
    content:
      "oracle stale oracle stale oracle price stale",
    metadata: { project: "desk" },
  });

  index.addSource({
    sourceId: "beta",
    content:
      "oracle price note alpha beta gamma delta epsilon zeta stale",
    metadata: { project: "desk" },
  });

  index.addSource({
    sourceId: "unicode",
    content:
      "ETH_Usd café liquidity route healthy",
    classification:
      ContextClass.RETRIEVABLE_KNOWLEDGE,
    metadata: { project: "mirror" },
  });
}

test(
  "persistent retrieval matches in-memory P2A-P1 semantics",
  () => {
    const { root, dbPath } = sandbox();
    const memory = new LexicalIndex();
    const persistent = new PersistentLexicalIndex({
      path: dbPath,
    });

    corpus(memory);
    corpus(persistent);

    assert.deepEqual(
      persistent.search("oracle stale"),
      memory.search("oracle stale")
    );

    assert.deepEqual(
      persistent.search("oracle price", {
        match: "any",
        maxBytes: 1200,
      }),
      memory.search("oracle price", {
        match: "any",
        maxBytes: 1200,
      })
    );

    persistent.close();
    rmSync(root, { recursive: true, force: true });
  }
);

test(
  "persistent retrieval survives close and reopen",
  () => {
    const { root, dbPath } = sandbox();

    const first = new PersistentLexicalIndex({
      path: dbPath,
    });
    corpus(first);

    const before = first.search("oracle stale");
    first.close();

    const second = new PersistentLexicalIndex({
      path: dbPath,
    });
    const after = second.search("oracle stale");

    assert.deepEqual(after, before);

    const ref = second.addSource({
      sourceId: "alpha",
      content:
        "oracle stale oracle stale oracle price stale",
      metadata: { ignoredOnIdempotentRead: true },
    });

    assert.equal(ref.sourceId, "alpha");
    assert.equal(ref.chunkCount, 1);

    second.close();
    rmSync(root, { recursive: true, force: true });
  }
);

test(
  "persistent source identity cannot be rebound after restart",
  () => {
    const { root, dbPath } = sandbox();

    const first = new PersistentLexicalIndex({
      path: dbPath,
    });

    first.addSource({
      sourceId: "stable",
      content: "canonical material",
    });
    first.close();

    const second = new PersistentLexicalIndex({
      path: dbPath,
    });

    assert.throws(
      () =>
        second.addSource({
          sourceId: "stable",
          content: "different material",
        }),
      /already refers to different content/
    );

    second.close();
    rmSync(root, { recursive: true, force: true });
  }
);

test(
  "persistent admission preserves protected-class refusal",
  () => {
    const { root, dbPath } = sandbox();
    const index = new PersistentLexicalIndex({
      path: dbPath,
    });

    assert.throws(
      () =>
        index.addSource({
          sourceId: "authority",
          content: "principal approved merge",
          metadata: {
            kind: "authority_decision",
          },
        }),
      /EXACT_EVIDENCE is not eligible/
    );

    assert.throws(
      () =>
        index.addSource({
          sourceId: "memory",
          metadata: {
            memoryRef:
              "mirror://recall/packet/42",
          },
        }),
      /DURABLE_MEMORY_REFERENCE is not eligible/
    );

    index.close();
    rmSync(root, { recursive: true, force: true });
  }
);

test(
  "FTS token encoding preserves canonical Unicode token identity",
  () => {
    const { root, dbPath } = sandbox();
    const index = new PersistentLexicalIndex({
      path: dbPath,
    });

    index.addSource({
      sourceId: "joined",
      content: "ETH_Usd café route",
    });

    index.addSource({
      sourceId: "split",
      content: "ETH USD cafe route",
    });

    const joined = index.search("eth_usd café");

    assert.equal(joined.totalCandidates, 1);
    assert.equal(
      joined.results[0].sourceId,
      "joined"
    );

    index.close();
    rmSync(root, { recursive: true, force: true });
  }
);

test(
  "persistent retrieval obeys serialized byte budget",
  () => {
    const { root, dbPath } = sandbox();
    const index = new PersistentLexicalIndex({
      path: dbPath,
    });

    for (let i = 0; i < 10; i += 1) {
      index.addSource({
        sourceId: `src-${i}`,
        content:
          `signal alpha ${"detail ".repeat(30)} ${i}`,
      });
    }

    const result = index.search("signal alpha", {
      maxResults: 10,
      maxBytes: 900,
    });

    assert.ok(
      Buffer.byteLength(
        JSON.stringify(result),
        "utf8"
      ) <= 900
    );

    assert.equal(
      result.usedBytes,
      Buffer.byteLength(
        JSON.stringify(result),
        "utf8"
      )
    );

    assert.ok(result.omittedResults > 0);

    index.close();
    rmSync(root, { recursive: true, force: true });
  }
);

test(
  "stored chunk tampering fails closed",
  () => {
    const { root, dbPath } = sandbox();

    const index = new PersistentLexicalIndex({
      path: dbPath,
    });

    index.addSource({
      sourceId: "tamper",
      content: "oracle stale evidence",
    });
    index.close();

    const db = new DatabaseSync(dbPath);
    db.prepare(`
      UPDATE chunks
      SET content = ?
      WHERE source_id = ?
    `).run(
      "oracle stale tampered",
      "tamper"
    );
    db.close();

    assert.throws(
      () =>
        new PersistentLexicalIndex({
          path: dbPath,
        }),
      /stored chunk integrity mismatch/
    );
    rmSync(root, { recursive: true, force: true });
  }
);

test(
  "stored token derivation tampering fails closed",
  () => {
    const { root, dbPath } = sandbox();

    const index = new PersistentLexicalIndex({
      path: dbPath,
    });

    index.addSource({
      sourceId: "token-tamper",
      content: "oracle stale evidence",
    });
    index.close();

    const db = new DatabaseSync(dbPath);
    db.prepare(`
      UPDATE chunks
      SET tokens_json = ?, token_count = ?
      WHERE source_id = ?
    `).run(
      JSON.stringify(["oracle", "fake", "evidence"]),
      3,
      "token-tamper"
    );
    db.close();

    assert.throws(
      () =>
        new PersistentLexicalIndex({
          path: dbPath,
        }),
      /stored token integrity mismatch/
    );
    rmSync(root, { recursive: true, force: true });
  }
);

test(
  "stored token count tampering fails closed",
  () => {
    const { root, dbPath } = sandbox();

    const index = new PersistentLexicalIndex({
      path: dbPath,
    });

    index.addSource({
      sourceId: "count-tamper",
      content: "oracle stale evidence",
    });
    index.close();

    const db = new DatabaseSync(dbPath);
    db.prepare(`
      UPDATE chunks
      SET token_count = ?
      WHERE source_id = ?
    `).run(
      999,
      "count-tamper"
    );
    db.close();

    assert.throws(
      () =>
        new PersistentLexicalIndex({
          path: dbPath,
        }),
      /stored token count mismatch/
    );
    rmSync(root, { recursive: true, force: true });
  }
);

test(
  "FTS lexical drift that would hide a candidate fails closed",
  () => {
    const { root, dbPath } = sandbox();

    const index = new PersistentLexicalIndex({
      path: dbPath,
    });

    index.addSource({
      sourceId: "fts-drift",
      content: "oracle stale evidence",
    });
    index.close();

    const db = new DatabaseSync(dbPath);
    db.prepare(`
      UPDATE chunks_fts
      SET lexical_text = ?
      WHERE chunk_id = ?
    `).run(
      "",
      "fts-drift:0:" +
        db.prepare(`
          SELECT substr(digest, 1, 16) AS suffix
          FROM chunks
          WHERE source_id = ?
        `).get("fts-drift").suffix
    );
    db.close();

    const reopened = new PersistentLexicalIndex({
      path: dbPath,
    });

    assert.throws(
      () => reopened.search("oracle"),
      /FTS index integrity mismatch/
    );

    reopened.close();
    rmSync(root, { recursive: true, force: true });
  }
);

test(
  "missing FTS candidate row fails closed",
  () => {
    const { root, dbPath } = sandbox();

    const index = new PersistentLexicalIndex({
      path: dbPath,
    });

    index.addSource({
      sourceId: "fts-missing",
      content: "oracle stale evidence",
    });
    index.close();

    const db = new DatabaseSync(dbPath);
    const row = db.prepare(`
      SELECT chunk_id
      FROM chunks
      WHERE source_id = ?
    `).get("fts-missing");

    db.prepare(`
      DELETE FROM chunks_fts
      WHERE chunk_id = ?
    `).run(row.chunk_id);
    db.close();

    const reopened = new PersistentLexicalIndex({
      path: dbPath,
    });

    assert.throws(
      () => reopened.search("oracle"),
      /FTS index integrity mismatch/
    );

    reopened.close();
    rmSync(root, { recursive: true, force: true });
  }
);
