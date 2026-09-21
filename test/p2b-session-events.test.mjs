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
  ContextBudgetExceeded,
  ContextEventKind,
  PersistentLexicalIndex,
  PersistentSessionJournal,
} from "../src/index.mjs";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite");

function sandbox() {
  const root = mkdtempSync(
    join(
      tmpdir(),
      "toadaid-context-p2b-p1-"
    )
  );

  return {
    root,
    dbPath: join(
      root,
      "context.sqlite"
    ),
  };
}

function objectiveInput(
  overrides = {}
) {
  return {
    sessionId: "session-a",
    kind: ContextEventKind.OBJECTIVE,
    timestamp:
      "2026-09-18T19:20:00.000Z",
    source: "adapter:test",
    project: "context-core",
    repo:
      "ToadAid/toadaid-context-core",
    attribution: "principal",
    importance: 90,
    text:
      "Build restart-safe session continuity.",
    tags: [
      "P2B",
      "continuity",
      "p2b",
    ],
    rawRef:
      "raw://session-a/objective/1",
    memoryRefs: [
      "mirror://recall/packet/42",
    ],
    exactEvidence: [
      {
        label: "head",
        value:
          "8f8d64975d382683ce4d4ea0af8d1aace1c953ca",
      },
      {
        label: "operator-note",
        value: "line one\n第二行\n",
      },
    ],
    data: {
      lane: "P2B-P1",
      authority: false,
    },
    dedupeKey:
      "principal-objective-1",
    ...overrides,
  };
}

test(
  "session events preserve exact evidence byte-for-byte",
  () => {
    const { root, dbPath } =
      sandbox();
    const journal =
      new PersistentSessionJournal({
        path: dbPath,
      });

    const event =
      journal.append(
        objectiveInput()
      );

    assert.equal(event.sequence, 1);
    assert.equal(
      event.prevDigest,
      null
    );
    assert.equal(
      event.kind,
      ContextEventKind.OBJECTIVE
    );
    assert.deepEqual(
      event.tags,
      ["continuity", "p2b"]
    );
    assert.equal(
      event.exactEvidence[0].value,
      "8f8d64975d382683ce4d4ea0af8d1aace1c953ca"
    );
    assert.equal(
      event.exactEvidence[1].value,
      "line one\n第二行\n"
    );
    assert.deepEqual(
      event.memoryRefs,
      ["mirror://recall/packet/42"]
    );
    assert.match(
      event.eventId,
      /^session-a:1:[0-9a-f]{16}$/
    );
    assert.match(
      event.eventDigest,
      /^[0-9a-f]{64}$/
    );

    journal.close();
    rmSync(root, {
      recursive: true,
      force: true,
    });
  }
);

test(
  "journal survives close and reopen with an intact chain",
  () => {
    const { root, dbPath } =
      sandbox();

    const first =
      new PersistentSessionJournal({
        path: dbPath,
      });

    const one = first.append(
      objectiveInput()
    );

    const two = first.append({
      sessionId: "session-a",
      kind:
        ContextEventKind.DECISION,
      timestamp:
        "2026-09-18T19:21:00Z",
      source: "adapter:test",
      text:
        "Keep exact evidence separate from fuzzy retrieval.",
      importance: 100,
      dedupeKey: "decision-1",
    });

    assert.equal(
      two.prevDigest,
      one.eventDigest
    );

    first.close();

    const second =
      new PersistentSessionJournal({
        path: dbPath,
      });

    const head =
      second.getSessionHead(
        "session-a"
      );

    assert.equal(
      head.eventCount,
      2
    );
    assert.equal(
      head.lastSequence,
      2
    );
    assert.equal(
      head.lastEventId,
      two.eventId
    );
    assert.equal(
      head.lastDigest,
      two.eventDigest
    );

    const events =
      second.listSession(
        "session-a"
      );

    assert.deepEqual(
      events.map(event =>
        event.eventId
      ),
      [one.eventId, two.eventId]
    );

    second.close();
    rmSync(root, {
      recursive: true,
      force: true,
    });
  }
);

test(
  "dedupe keys make hook retries idempotent and cannot be rebound",
  () => {
    const { root, dbPath } =
      sandbox();
    const journal =
      new PersistentSessionJournal({
        path: dbPath,
      });

    const input =
      objectiveInput();

    const first =
      journal.append(input);
    const second =
      journal.append(input);

    assert.equal(
      second.eventId,
      first.eventId
    );
    assert.equal(
      journal.getSessionHead(
        "session-a"
      ).eventCount,
      1
    );

    assert.throws(
      () =>
        journal.append(
          objectiveInput({
            text:
              "Different objective under same hook identity.",
          })
        ),
      /dedupeKey .* already refers to different event content/
    );

    assert.equal(
      journal.getSessionHead(
        "session-a"
      ).eventCount,
      1
    );

    journal.close();
    rmSync(root, {
      recursive: true,
      force: true,
    });
  }
);

test(
  "sessions maintain independent monotonic chains",
  () => {
    const { root, dbPath } =
      sandbox();
    const journal =
      new PersistentSessionJournal({
        path: dbPath,
      });

    const a = journal.append(
      objectiveInput()
    );

    const b = journal.append(
      objectiveInput({
        sessionId: "session-b",
        dedupeKey:
          "principal-objective-b",
      })
    );

    assert.equal(a.sequence, 1);
    assert.equal(b.sequence, 1);
    assert.equal(
      a.prevDigest,
      null
    );
    assert.equal(
      b.prevDigest,
      null
    );

    assert.equal(
      journal.getSessionHead(
        "session-a"
      ).eventCount,
      1
    );
    assert.equal(
      journal.getSessionHead(
        "session-b"
      ).eventCount,
      1
    );

    journal.close();
    rmSync(root, {
      recursive: true,
      force: true,
    });
  }
);

test(
  "event journal rejects oversized raw-like payloads without partial append",
  () => {
    const { root, dbPath } =
      sandbox();
    const journal =
      new PersistentSessionJournal({
        path: dbPath,
        maxEventBytes: 1024,
      });

    assert.throws(
      () =>
        journal.append(
          objectiveInput({
            text:
              "x".repeat(5000),
          })
        ),
      ContextBudgetExceeded
    );

    assert.equal(
      journal.getSessionHead(
        "session-a"
      ).eventCount,
      0
    );

    journal.close();
    rmSync(root, {
      recursive: true,
      force: true,
    });
  }
);

test(
  "event JSON tampering fails closed",
  () => {
    const { root, dbPath } =
      sandbox();

    const journal =
      new PersistentSessionJournal({
        path: dbPath,
      });

    journal.append(
      objectiveInput()
    );
    journal.close();

    const db =
      new DatabaseSync(dbPath);

    const row = db.prepare(`
      SELECT event_json
      FROM context_events
      WHERE session_id = ?
    `).get("session-a");

    const event =
      JSON.parse(row.event_json);
    event.text =
      "tampered event text";

    db.prepare(`
      UPDATE context_events
      SET event_json = ?
      WHERE session_id = ?
    `).run(
      JSON.stringify(event),
      "session-a"
    );

    db.close();

    const reopened =
      new PersistentSessionJournal({
        path: dbPath,
      });

    assert.throws(
      () =>
        reopened.listSession(
          "session-a"
        ),
      /stored event .* mismatch/
    );

    reopened.close();
    rmSync(root, {
      recursive: true,
      force: true,
    });
  }
);

test(
  "event deletion is detected by durable session head",
  () => {
    const { root, dbPath } =
      sandbox();

    const journal =
      new PersistentSessionJournal({
        path: dbPath,
      });

    journal.append(
      objectiveInput()
    );

    journal.append({
      sessionId: "session-a",
      kind: ContextEventKind.TASK,
      timestamp:
        "2026-09-18T19:22:00Z",
      source: "adapter:test",
      text:
        "Build bounded resume packet.",
      dedupeKey: "task-1",
    });

    journal.close();

    const db =
      new DatabaseSync(dbPath);

    db.prepare(`
      DELETE FROM context_events
      WHERE
        session_id = ? AND
        sequence = ?
    `).run(
      "session-a",
      2
    );

    db.close();

    const reopened =
      new PersistentSessionJournal({
        path: dbPath,
      });

    assert.throws(
      () =>
        reopened.getSessionHead(
          "session-a"
        ),
      /session event count integrity mismatch/
    );

    reopened.close();
    rmSync(root, {
      recursive: true,
      force: true,
    });
  }
);

test(
  "filtered session listing stays integrity-checked and deterministic",
  () => {
    const { root, dbPath } =
      sandbox();
    const journal =
      new PersistentSessionJournal({
        path: dbPath,
      });

    journal.append(
      objectiveInput()
    );

    journal.append({
      sessionId: "session-a",
      kind:
        ContextEventKind.FILE_EDIT,
      timestamp:
        "2026-09-18T19:23:00Z",
      source: "adapter:test",
      text:
        "Edited src/session-events.mjs",
      data: {
        path:
          "src/session-events.mjs",
      },
      dedupeKey: "edit-1",
    });

    journal.append({
      sessionId: "session-a",
      kind:
        ContextEventKind.ERROR,
      timestamp:
        "2026-09-18T19:24:00Z",
      source: "adapter:test",
      text:
        "Resume packet exceeded budget.",
      importance: 95,
      dedupeKey: "error-1",
    });

    const filtered =
      journal.listSession(
        "session-a",
        {
          kinds: [
            ContextEventKind.ERROR,
            ContextEventKind.FILE_EDIT,
          ],
          newestFirst: true,
          limit: 2,
        }
      );

    assert.deepEqual(
      filtered.map(event =>
        event.kind
      ),
      [
        ContextEventKind.ERROR,
        ContextEventKind.FILE_EDIT,
      ]
    );

    journal.close();
    rmSync(root, {
      recursive: true,
      force: true,
    });
  }
);

test(
  "session journal and persistent lexical index can share one SQLite file",
  () => {
    const { root, dbPath } =
      sandbox();

    const lexical =
      new PersistentLexicalIndex({
        path: dbPath,
      });

    lexical.addSource({
      sourceId: "knowledge-1",
      content:
        "context continuity retrieval",
    });

    const journal =
      new PersistentSessionJournal({
        path: dbPath,
      });

    journal.append(
      objectiveInput()
    );

    assert.equal(
      lexical.search(
        "context continuity"
      ).totalCandidates,
      1
    );

    assert.equal(
      journal.getSessionHead(
        "session-a"
      ).eventCount,
      1
    );

    journal.close();
    lexical.close();

    const lexicalAgain =
      new PersistentLexicalIndex({
        path: dbPath,
      });
    const journalAgain =
      new PersistentSessionJournal({
        path: dbPath,
      });

    assert.equal(
      lexicalAgain.search(
        "context continuity"
      ).totalCandidates,
      1
    );
    assert.equal(
      journalAgain.listSession(
        "session-a"
      ).length,
      1
    );

    journalAgain.close();
    lexicalAgain.close();
    rmSync(root, {
      recursive: true,
      force: true,
    });
  }
);

test(
  "journal exposes no mutation or execution authority",
  () => {
    const { root, dbPath } =
      sandbox();
    const journal =
      new PersistentSessionJournal({
        path: dbPath,
      });

    assert.equal(
      journal.update,
      undefined
    );
    assert.equal(
      journal.delete,
      undefined
    );
    assert.equal(
      journal.execute,
      undefined
    );
    assert.equal(
      journal.writeMemory,
      undefined
    );

    journal.close();
    rmSync(root, {
      recursive: true,
      force: true,
    });
  }
);
