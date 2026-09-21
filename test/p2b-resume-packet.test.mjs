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
  buildResumePacket,
  ContextBudgetExceeded,
  ContextEventKind,
  PersistentSessionJournal,
} from "../src/index.mjs";

const require =
  createRequire(
    import.meta.url
  );
const { DatabaseSync } =
  require("node:sqlite");

function sandbox() {
  const root =
    mkdtempSync(
      join(
        tmpdir(),
        "toadaid-context-p2b-p2-"
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

function append(
  journal,
  {
    sessionId = "resume-a",
    kind,
    timestamp,
    text,
    importance = 50,
    data = {},
    rawRef,
    memoryRefs,
    exactEvidence,
    dedupeKey,
    project = "context-core",
    repo =
      "ToadAid/toadaid-context-core",
  }
) {
  return journal.append({
    sessionId,
    kind,
    timestamp,
    source: "adapter:test",
    project,
    repo,
    attribution: "principal",
    importance,
    text,
    data,
    rawRef,
    memoryRefs,
    exactEvidence,
    dedupeKey,
  });
}

function buildScenario(journal) {
  append(journal, {
    kind:
      ContextEventKind.OBJECTIVE,
    timestamp:
      "2026-09-18T19:30:00Z",
    text:
      "Old objective that must be superseded.",
    dedupeKey:
      "objective-old",
  });

  append(journal, {
    kind:
      ContextEventKind.OBJECTIVE,
    timestamp:
      "2026-09-18T19:31:00Z",
    text:
      "Build bounded deterministic resume packets.",
    importance: 100,
    exactEvidence: [
      {
        label: "base_sha",
        value:
          "981deb7409cd5c202d8449f4bc608734428adc9a",
      },
      {
        label: "operator-note",
        value:
          "line one\n第二行\n",
      },
    ],
    rawRef:
      "raw://resume-a/objective",
    memoryRefs: [
      "mirror://recall/packet/42",
    ],
    dedupeKey:
      "objective-current",
  });

  append(journal, {
    kind:
      ContextEventKind.GIT_STATE,
    timestamp:
      "2026-09-18T19:32:00Z",
    text:
      "main at P2B-P1 merge",
    data: {
      branch: "main",
      head:
        "981deb7409cd5c202d8449f4bc608734428adc9a",
      tree:
        "58acb408f27f5769f71e4e66f024cdb0bc1e2606",
      clean: true,
    },
    exactEvidence: [
      {
        label: "HEAD",
        value:
          "981deb7409cd5c202d8449f4bc608734428adc9a",
      },
      {
        label: "tree",
        value:
          "58acb408f27f5769f71e4e66f024cdb0bc1e2606",
      },
    ],
    dedupeKey:
      "git-state-1",
  });

  append(journal, {
    kind:
      ContextEventKind.ERROR,
    timestamp:
      "2026-09-18T19:33:00Z",
    text:
      "Old error was open.",
    importance: 80,
    data: {
      lifecycleKey:
        "budget-error",
      status: "open",
    },
    dedupeKey:
      "error-open",
  });

  append(journal, {
    kind:
      ContextEventKind.ERROR,
    timestamp:
      "2026-09-18T19:34:00Z",
    text:
      "Budget error resolved.",
    importance: 80,
    data: {
      lifecycleKey:
        "budget-error",
      status: "resolved",
    },
    dedupeKey:
      "error-resolved",
  });

  append(journal, {
    kind:
      ContextEventKind.ERROR,
    timestamp:
      "2026-09-18T19:35:00Z",
    text:
      "FTS candidate drift still needs repair.",
    importance: 95,
    data: {
      lifecycleKey:
        "fts-drift",
      status: "open",
    },
    exactEvidence: [
      {
        label: "error-code",
        value: "CTX_FTS_DRIFT",
      },
    ],
    dedupeKey:
      "error-fts",
  });

  append(journal, {
    kind:
      ContextEventKind.TASK,
    timestamp:
      "2026-09-18T19:36:00Z",
    text:
      "Old task completed.",
    data: {
      lifecycleKey:
        "task-old",
      status: "done",
    },
    dedupeKey:
      "task-old",
  });

  append(journal, {
    kind:
      ContextEventKind.TASK,
    timestamp:
      "2026-09-18T19:37:00Z",
    text:
      "Build compaction resume proof.",
    importance: 90,
    data: {
      lifecycleKey:
        "task-resume-proof",
      status: "open",
    },
    dedupeKey:
      "task-resume-proof",
  });

  append(journal, {
    kind:
      ContextEventKind.DECISION,
    timestamp:
      "2026-09-18T19:38:00Z",
    text:
      "Never summarize exact evidence.",
    importance: 100,
    dedupeKey:
      "decision-exact",
  });

  append(journal, {
    kind:
      ContextEventKind.DECISION,
    timestamp:
      "2026-09-18T19:39:00Z",
    text:
      "Use deterministic state reconstruction.",
    importance: 95,
    dedupeKey:
      "decision-deterministic",
  });

  append(journal, {
    kind:
      ContextEventKind.CONSTRAINT,
    timestamp:
      "2026-09-18T19:40:00Z",
    text:
      "Context Core has zero execution authority.",
    importance: 100,
    dedupeKey:
      "constraint-authority",
  });

  append(journal, {
    kind:
      ContextEventKind.FILE_EDIT,
    timestamp:
      "2026-09-18T19:41:00Z",
    text:
      "Edited session event journal.",
    data: {
      path:
        "src/session-events.mjs",
    },
    dedupeKey:
      "file-edit-session",
  });

  append(journal, {
    kind:
      ContextEventKind.FILE_READ,
    timestamp:
      "2026-09-18T19:42:00Z",
    text:
      "Read packet builder.",
    data: {
      path: "src/packet.mjs",
    },
    dedupeKey:
      "file-read-packet",
  });

  append(journal, {
    kind:
      ContextEventKind.FILE_EDIT,
    timestamp:
      "2026-09-18T19:43:00Z",
    text:
      "Edited session event journal again.",
    data: {
      path:
        "src/session-events.mjs",
    },
    dedupeKey:
      "file-edit-session-2",
  });

  append(journal, {
    kind:
      ContextEventKind.EXTERNAL_REF,
    timestamp:
      "2026-09-18T19:44:00Z",
    text:
      "External research reference.",
    rawRef:
      "raw://context-mode/research",
    memoryRefs: [
      "mirror://recall/packet/42",
      "living://continuity/7",
    ],
    dedupeKey:
      "external-ref-1",
  });
}

test(
  "resume packet reconstructs current deterministic state",
  () => {
    const { root, dbPath } =
      sandbox();

    const journal =
      new PersistentSessionJournal({
        path: dbPath,
      });

    buildScenario(journal);

    const packet =
      buildResumePacket(
        journal,
        "resume-a",
        {
          maxBytes: 12000,
        }
      );

    assert.equal(
      packet.currentObjective.text,
      "Build bounded deterministic resume packets."
    );

    assert.equal(
      packet.gitState.data.branch,
      "main"
    );

    assert.deepEqual(
      packet.unresolvedErrors.map(
        event => event.text
      ),
      [
        "FTS candidate drift still needs repair.",
      ]
    );

    assert.deepEqual(
      packet.openTasks.map(
        event => event.text
      ),
      [
        "Build compaction resume proof.",
      ]
    );

    assert.deepEqual(
      packet.recentDecisions.map(
        event => event.text
      ),
      [
        "Use deterministic state reconstruction.",
        "Never summarize exact evidence.",
      ]
    );

    assert.deepEqual(
      packet.constraints.map(
        event => event.text
      ),
      [
        "Context Core has zero execution authority.",
      ]
    );

    assert.deepEqual(
      packet.activeFiles.map(
        item => item.path
      ),
      [
        "src/session-events.mjs",
        "src/packet.mjs",
      ]
    );

    assert.equal(
      packet.sourceHead.eventCount,
      15
    );

    journal.close();
    rmSync(root, {
      recursive: true,
      force: true,
    });
  }
);

test(
  "resume exact evidence remains byte-perfect and separate from prose facts",
  () => {
    const { root, dbPath } =
      sandbox();

    const journal =
      new PersistentSessionJournal({
        path: dbPath,
      });

    buildScenario(journal);

    const packet =
      buildResumePacket(
        journal,
        "resume-a",
        {
          maxBytes: 12000,
        }
      );

    const note =
      packet.exactEvidence.find(
        evidence =>
          evidence.label ===
          "operator-note"
      );

    assert.equal(
      note.value,
      "line one\n第二行\n"
    );

    const head =
      packet.exactEvidence.find(
        evidence =>
          evidence.label === "HEAD"
      );

    assert.equal(
      head.value,
      "981deb7409cd5c202d8449f4bc608734428adc9a"
    );

    assert.equal(
      Object.prototype.hasOwnProperty.call(
        packet.currentObjective,
        "exactEvidence"
      ),
      false
    );

    journal.close();
    rmSync(root, {
      recursive: true,
      force: true,
    });
  }
);

test(
  "resume lifecycle uses latest event per explicit lifecycle key",
  () => {
    const { root, dbPath } =
      sandbox();

    const journal =
      new PersistentSessionJournal({
        path: dbPath,
      });

    append(journal, {
      kind:
        ContextEventKind.OBJECTIVE,
      timestamp:
        "2026-09-18T20:00:00Z",
      text: "Lifecycle proof.",
      dedupeKey:
        "objective-lifecycle",
    });

    append(journal, {
      kind:
        ContextEventKind.TASK,
      timestamp:
        "2026-09-18T20:01:00Z",
      text: "Task opened.",
      data: {
        lifecycleKey: "task-a",
        status: "open",
      },
      dedupeKey:
        "task-a-open",
    });

    append(journal, {
      kind:
        ContextEventKind.TASK,
      timestamp:
        "2026-09-18T20:02:00Z",
      text: "Task completed.",
      data: {
        lifecycleKey: "task-a",
        status: "completed",
      },
      dedupeKey:
        "task-a-complete",
    });

    append(journal, {
      kind:
        ContextEventKind.TASK,
      timestamp:
        "2026-09-18T20:03:00Z",
      text: "Independent task.",
      data: {
        status: "open",
      },
      dedupeKey:
        "task-independent",
    });

    const packet =
      buildResumePacket(
        journal,
        "resume-a"
      );

    assert.deepEqual(
      packet.openTasks.map(
        event => event.text
      ),
      ["Independent task."]
    );

    journal.close();
    rmSync(root, {
      recursive: true,
      force: true,
    });
  }
);

test(
  "resume packet is restart deterministic",
  () => {
    const { root, dbPath } =
      sandbox();

    const first =
      new PersistentSessionJournal({
        path: dbPath,
      });

    buildScenario(first);

    const before =
      buildResumePacket(
        first,
        "resume-a",
        {
          maxBytes: 12000,
        }
      );

    first.close();

    const second =
      new PersistentSessionJournal({
        path: dbPath,
      });

    const after =
      buildResumePacket(
        second,
        "resume-a",
        {
          maxBytes: 12000,
        }
      );

    assert.deepEqual(
      after,
      before
    );

    second.close();
    rmSync(root, {
      recursive: true,
      force: true,
    });
  }
);

test(
  "resume packet measures actual serialized bytes and reports omissions",
  () => {
    const { root, dbPath } =
      sandbox();

    const journal =
      new PersistentSessionJournal({
        path: dbPath,
      });

    append(journal, {
      kind:
        ContextEventKind.OBJECTIVE,
      timestamp:
        "2026-09-18T21:00:00Z",
      text:
        "Keep the resume packet bounded.",
      dedupeKey:
        "objective-budget",
    });

    for (
      let index = 0;
      index < 20;
      index += 1
    ) {
      append(journal, {
        kind:
          ContextEventKind.DECISION,
        timestamp:
          `2026-09-18T21:${String(index + 1).padStart(2, "0")}:00Z`,
        text:
          `Decision ${index} ${"detail ".repeat(20)}`,
        dedupeKey:
          `decision-budget-${index}`,
      });
    }

    const packet =
      buildResumePacket(
        journal,
        "resume-a",
        {
          maxBytes: 6000,
          maxDecisions: 20,
        }
      );

    const measured =
      Buffer.byteLength(
        JSON.stringify(packet),
        "utf8"
      );

    assert.equal(
      packet.usedBytes,
      measured
    );
    assert.ok(
      measured <= 6000
    );
    assert.ok(
      packet.omitted
        .recentDecisions > 0
    );

    journal.close();
    rmSync(root, {
      recursive: true,
      force: true,
    });
  }
);

test(
  "mandatory objective exact evidence fails closed when it cannot fit",
  () => {
    const { root, dbPath } =
      sandbox();

    const journal =
      new PersistentSessionJournal({
        path: dbPath,
      });

    append(journal, {
      kind:
        ContextEventKind.OBJECTIVE,
      timestamp:
        "2026-09-18T22:00:00Z",
      text: "Exact evidence pressure.",
      exactEvidence: [
        {
          label: "receipt",
          value:
            "R".repeat(1600),
        },
      ],
      dedupeKey:
        "objective-evidence-pressure",
    });

    assert.throws(
      () =>
        buildResumePacket(
          journal,
          "resume-a",
          {
            maxBytes: 900,
          }
        ),
      ContextBudgetExceeded
    );

    journal.close();
    rmSync(root, {
      recursive: true,
      force: true,
    });
  }
);

test(
  "mandatory git state exact evidence fails closed instead of being truncated",
  () => {
    const { root, dbPath } =
      sandbox();

    const journal =
      new PersistentSessionJournal({
        path: dbPath,
      });

    append(journal, {
      kind:
        ContextEventKind.OBJECTIVE,
      timestamp:
        "2026-09-18T22:10:00Z",
      text: "Git anchor proof.",
      dedupeKey:
        "objective-git-anchor",
    });

    append(journal, {
      kind:
        ContextEventKind.GIT_STATE,
      timestamp:
        "2026-09-18T22:11:00Z",
      text: "Git state with large proof.",
      exactEvidence: [
        {
          label: "git-proof",
          value:
            "G".repeat(1600),
        },
      ],
      dedupeKey:
        "git-anchor-large",
    });

    assert.throws(
      () =>
        buildResumePacket(
          journal,
          "resume-a",
          {
            maxBytes: 1100,
          }
        ),
      ContextBudgetExceeded
    );

    journal.close();
    rmSync(root, {
      recursive: true,
      force: true,
    });
  }
);

test(
  "resume references are deterministic, deduplicated, and bounded",
  () => {
    const { root, dbPath } =
      sandbox();

    const journal =
      new PersistentSessionJournal({
        path: dbPath,
      });

    append(journal, {
      kind:
        ContextEventKind.OBJECTIVE,
      timestamp:
        "2026-09-18T23:00:00Z",
      text:
        "Reference reconstruction.",
      rawRef:
        "raw://shared",
      memoryRefs: [
        "memory://a",
      ],
      dedupeKey:
        "objective-ref",
    });

    append(journal, {
      kind:
        ContextEventKind.EXTERNAL_REF,
      timestamp:
        "2026-09-18T23:01:00Z",
      text: "Shared references.",
      rawRef:
        "raw://shared",
      memoryRefs: [
        "memory://a",
        "memory://b",
      ],
      dedupeKey:
        "external-ref",
    });

    const packet =
      buildResumePacket(
        journal,
        "resume-a",
        {
          maxBytes: 4000,
          maxReferences: 2,
        }
      );

    assert.deepEqual(
      packet.references.map(
        item =>
          `${item.type}:${item.ref}`
      ),
      [
        "raw:raw://shared",
        "memory:memory://a",
      ]
    );

    assert.equal(
      packet.omitted.references,
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
  "empty verified session yields a valid bounded packet",
  () => {
    const { root, dbPath } =
      sandbox();

    const journal =
      new PersistentSessionJournal({
        path: dbPath,
      });

    const packet =
      buildResumePacket(
        journal,
        "empty-session"
      );

    assert.equal(
      packet.sourceHead.eventCount,
      0
    );
    assert.equal(
      packet.currentObjective,
      null
    );
    assert.equal(
      packet.gitState,
      null
    );
    assert.deepEqual(
      packet.unresolvedErrors,
      []
    );
    assert.equal(
      packet.usedBytes,
      Buffer.byteLength(
        JSON.stringify(packet),
        "utf8"
      )
    );

    journal.close();
    rmSync(root, {
      recursive: true,
      force: true,
    });
  }
);

test(
  "tampered journal fails before resume material is returned",
  () => {
    const { root, dbPath } =
      sandbox();

    const journal =
      new PersistentSessionJournal({
        path: dbPath,
      });

    append(journal, {
      kind:
        ContextEventKind.OBJECTIVE,
      timestamp:
        "2026-09-19T00:00:00Z",
      text:
        "Tamper proof objective.",
      dedupeKey:
        "objective-tamper",
    });

    journal.close();

    const db =
      new DatabaseSync(dbPath);

    const row = db.prepare(`
      SELECT event_json
      FROM context_events
      WHERE session_id = ?
    `).get("resume-a");

    const event =
      JSON.parse(row.event_json);

    event.text =
      "tampered objective";

    db.prepare(`
      UPDATE context_events
      SET event_json = ?
      WHERE session_id = ?
    `).run(
      JSON.stringify(event),
      "resume-a"
    );

    db.close();

    const reopened =
      new PersistentSessionJournal({
        path: dbPath,
      });

    assert.throws(
      () =>
        buildResumePacket(
          reopened,
          "resume-a"
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
  "configured section caps remain visible in omission truth",
  () => {
    const { root, dbPath } =
      sandbox();

    const journal =
      new PersistentSessionJournal({
        path: dbPath,
      });

    append(journal, {
      kind:
        ContextEventKind.OBJECTIVE,
      timestamp:
        "2026-09-19T00:10:00Z",
      text:
        "Prove pre-cap omission accounting.",
      dedupeKey:
        "objective-cap-truth",
    });

    append(journal, {
      kind:
        ContextEventKind.DECISION,
      timestamp:
        "2026-09-19T00:11:00Z",
      text: "Decision one.",
      exactEvidence: [
        {
          label: "decision-one-proof",
          value: "proof-one",
        },
      ],
      dedupeKey:
        "decision-cap-1",
    });

    append(journal, {
      kind:
        ContextEventKind.DECISION,
      timestamp:
        "2026-09-19T00:12:00Z",
      text: "Decision two.",
      exactEvidence: [
        {
          label: "decision-two-proof",
          value: "proof-two",
        },
      ],
      dedupeKey:
        "decision-cap-2",
    });

    append(journal, {
      kind:
        ContextEventKind.DECISION,
      timestamp:
        "2026-09-19T00:13:00Z",
      text: "Decision three.",
      dedupeKey:
        "decision-cap-3",
    });

    const packet =
      buildResumePacket(
        journal,
        "resume-a",
        {
          maxBytes: 6000,
          maxDecisions: 1,
        }
      );

    assert.deepEqual(
      packet.recentDecisions.map(
        event => event.text
      ),
      ["Decision three."]
    );

    assert.equal(
      packet.omitted.recentDecisions,
      2
    );

    assert.equal(
      packet.omitted.exactEvidence,
      2
    );

    journal.close();
    rmSync(root, {
      recursive: true,
      force: true,
    });
  }
);
