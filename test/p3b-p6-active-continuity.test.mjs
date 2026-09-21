import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildResumePacket,
  ContextBudgetExceeded,
  ContextEventKind,
  PersistentSessionJournal,
} from "../src/index.mjs";

function sandbox() {
  const root =
    mkdtempSync(
      join(
        tmpdir(),
        "toadaid-context-p6-p1-"
      )
    );

  return {
    root,
    dbPath:
      join(
        root,
        "context.sqlite"
      ),
  };
}

function append(
  journal,
  {
    sessionId = "p6-p1",
    kind,
    timestamp,
    text,
    importance = 50,
    data = {},
    rawRef,
    exactEvidence,
    dedupeKey,
  }
) {
  return journal.append({
    sessionId,
    kind,
    timestamp,
    source: "adapter:p6-p1-test",
    project: "context-core",
    repo:
      "ToadAid/toadaid-context-core",
    attribution: "principal",
    importance,
    text,
    data,
    rawRef,
    exactEvidence,
    dedupeKey,
  });
}

test("constraints use deterministic lifecycle truth instead of recent-N truth", () => {
  const { root, dbPath } =
    sandbox();

  const journal =
    new PersistentSessionJournal({
      path: dbPath,
    });

  try {
    append(journal, {
      kind:
        ContextEventKind.CONSTRAINT,
      timestamp:
        "2026-09-19T19:00:00Z",
      text:
        "Old network constraint.",
      data: {
        lifecycleKey: "network",
        status: "open",
      },
      dedupeKey: "constraint-network-old",
    });

    append(journal, {
      kind:
        ContextEventKind.CONSTRAINT,
      timestamp:
        "2026-09-19T19:01:00Z",
      text:
        "Network constraint superseded.",
      data: {
        lifecycleKey: "network",
        status: "superseded",
      },
      dedupeKey: "constraint-network-close",
    });

    append(journal, {
      kind:
        ContextEventKind.CONSTRAINT,
      timestamp:
        "2026-09-19T19:02:00Z",
      text:
        "Authority remains external v1.",
      data: {
        lifecycleKey: "authority",
        status: "open",
      },
      dedupeKey: "constraint-authority-v1",
    });

    append(journal, {
      kind:
        ContextEventKind.CONSTRAINT,
      timestamp:
        "2026-09-19T19:03:00Z",
      text:
        "Authority remains external v2.",
      data: {
        lifecycleKey: "authority",
        status: "open",
      },
      dedupeKey: "constraint-authority-v2",
    });

    append(journal, {
      kind:
        ContextEventKind.CONSTRAINT,
      timestamp:
        "2026-09-19T19:04:00Z",
      text:
        "Unknown status remains active.",
      data: {
        lifecycleKey: "unknown-status",
        status: "future-state",
      },
      dedupeKey: "constraint-unknown",
    });

    const packet =
      buildResumePacket(
        journal,
        "p6-p1",
        {
          maxBytes: 16384,
          maxConstraints: 10,
        }
      );

    assert.deepEqual(
      packet.constraints.map(
        item => item.text
      ),
      [
        "Unknown status remains active.",
        "Authority remains external v2.",
      ]
    );

    assert.equal(
      packet.constraints.some(
        item =>
          item.text ===
          "Old network constraint."
      ),
      false
    );

    assert.equal(
      packet.constraints.some(
        item =>
          item.text ===
          "Authority remains external v1."
      ),
      false
    );
  } finally {
    journal.close();
    rmSync(root, {
      recursive: true,
      force: true,
    });
  }
});

test("section caps cannot hide exact evidence attached to active errors tasks or constraints", () => {
  const { root, dbPath } =
    sandbox();

  const journal =
    new PersistentSessionJournal({
      path: dbPath,
    });

  try {
    const kinds = [
      [
        ContextEventKind.ERROR,
        "error",
      ],
      [
        ContextEventKind.TASK,
        "task",
      ],
      [
        ContextEventKind.CONSTRAINT,
        "constraint",
      ],
    ];

    let minute = 0;
    const expectedValues = [];

    for (const [kind, prefix] of kinds) {
      for (let index = 1; index <= 2; index += 1) {
        const value =
          `${prefix.toUpperCase()}_PROOF_${index}`;

        expectedValues.push(value);

        append(journal, {
          kind,
          timestamp:
            `2026-09-19T20:${String(minute).padStart(2, "0")}:00Z`,
          text:
            `${prefix} ${index}`,
          importance:
            100 - index,
          data: {
            lifecycleKey:
              `${prefix}-${index}`,
            status: "open",
          },
          exactEvidence: [
            {
              label:
                `${prefix}-proof-${index}`,
              value,
            },
          ],
          dedupeKey:
            `${prefix}-${index}`,
        });

        minute += 1;
      }
    }

    const packet =
      buildResumePacket(
        journal,
        "p6-p1",
        {
          maxBytes: 32768,
          maxOpenErrors: 1,
          maxOpenTasks: 1,
          maxConstraints: 1,
        }
      );

    assert.equal(
      packet.unresolvedErrors.length,
      1
    );
    assert.equal(
      packet.openTasks.length,
      1
    );
    assert.equal(
      packet.constraints.length,
      1
    );

    assert.deepEqual(
      new Set(
        packet.exactEvidence.map(
          item => item.value
        )
      ),
      new Set(expectedValues)
    );

    assert.equal(
      packet.omitted.exactEvidence,
      0
    );
  } finally {
    journal.close();
    rmSync(root, {
      recursive: true,
      force: true,
    });
  }
});

test("exact-evidence census covers every journal event kind before ordinary selection", () => {
  const { root, dbPath } =
    sandbox();

  const journal =
    new PersistentSessionJournal({
      path: dbPath,
    });

  try {
    const historical = [
      [
        ContextEventKind.FILE_READ,
        "FILE_READ_PROOF",
        {
          path: "src/a.mjs",
        },
      ],
      [
        ContextEventKind.FILE_EDIT,
        "FILE_EDIT_PROOF",
        {
          path: "src/b.mjs",
        },
      ],
      [
        ContextEventKind.EXTERNAL_REF,
        "EXTERNAL_REF_PROOF",
        {},
      ],
    ];

    let minute = 0;

    for (
      const [
        kind,
        value,
        data,
      ] of historical
    ) {
      append(journal, {
        kind,
        timestamp:
          `2026-09-19T21:0${minute}:00Z`,
        text: value,
        data,
        exactEvidence: [
          {
            label:
              value.toLowerCase(),
            value,
          },
        ],
        dedupeKey:
          `historical-${minute}`,
      });

      minute += 1;
    }

    append(journal, {
      kind:
        ContextEventKind.DECISION,
      timestamp:
        "2026-09-19T21:03:00Z",
      text: "Older decision.",
      exactEvidence: [
        {
          label: "decision-old",
          value: "DECISION_OLD_PROOF",
        },
      ],
      dedupeKey: "decision-old",
    });

    append(journal, {
      kind:
        ContextEventKind.DECISION,
      timestamp:
        "2026-09-19T21:04:00Z",
      text: "Newest decision.",
      exactEvidence: [
        {
          label: "decision-new",
          value: "DECISION_NEW_PROOF",
        },
      ],
      dedupeKey: "decision-new",
    });

    const packet =
      buildResumePacket(
        journal,
        "p6-p1",
        {
          maxBytes: 16384,
          maxDecisions: 1,
        }
      );

    assert.deepEqual(
      packet.exactEvidence.map(
        item => item.value
      ),
      ["DECISION_NEW_PROOF"]
    );

    assert.equal(
      packet.omitted.exactEvidence,
      4
    );
  } finally {
    journal.close();
    rmSync(root, {
      recursive: true,
      force: true,
    });
  }
});

test("mandatory active exact evidence fails closed even when its owner would lose a section cap", () => {
  const { root, dbPath } =
    sandbox();

  const journal =
    new PersistentSessionJournal({
      path: dbPath,
    });

  try {
    append(journal, {
      kind:
        ContextEventKind.CONSTRAINT,
      timestamp:
        "2026-09-19T22:00:00Z",
      text:
        "High-priority compact constraint.",
      importance: 100,
      data: {
        lifecycleKey: "compact",
        status: "open",
      },
      exactEvidence: [
        {
          label: "compact-proof",
          value: "COMPACT_PROOF",
        },
      ],
      dedupeKey: "compact",
    });

    append(journal, {
      kind:
        ContextEventKind.CONSTRAINT,
      timestamp:
        "2026-09-19T22:01:00Z",
      text:
        "Low-priority constraint that would lose maxConstraints=1.",
      importance: 1,
      data: {
        lifecycleKey: "large",
        status: "open",
      },
      exactEvidence: [
        {
          label: "large-proof",
          value: "X".repeat(4096),
        },
      ],
      dedupeKey: "large",
    });

    assert.throws(
      () =>
        buildResumePacket(
          journal,
          "p6-p1",
          {
            maxBytes: 1200,
            maxConstraints: 1,
          }
        ),
      error =>
        error instanceof
          ContextBudgetExceeded &&
        /mandatory active continuity exact evidence/.test(
          error.message
        )
    );
  } finally {
    journal.close();
    rmSync(root, {
      recursive: true,
      force: true,
    });
  }
});

test("active continuity projection stays deterministic across restart", () => {
  const { root, dbPath } =
    sandbox();

  let journal =
    new PersistentSessionJournal({
      path: dbPath,
    });

  try {
    append(journal, {
      kind:
        ContextEventKind.OBJECTIVE,
      timestamp:
        "2026-09-19T23:00:00Z",
      text:
        "Keep P6-P1 deterministic.",
      exactEvidence: [
        {
          label: "objective-proof",
          value: "OBJECTIVE_EXACT",
        },
      ],
      dedupeKey: "objective",
    });

    append(journal, {
      kind:
        ContextEventKind.CONSTRAINT,
      timestamp:
        "2026-09-19T23:01:00Z",
      text:
        "Authority remains external.",
      data: {
        lifecycleKey: "authority",
        status: "open",
      },
      exactEvidence: [
        {
          label: "authority-proof",
          value: "AUTHORITY_EXTERNAL",
        },
      ],
      dedupeKey: "authority",
    });

    append(journal, {
      kind:
        ContextEventKind.TASK,
      timestamp:
        "2026-09-19T23:02:00Z",
      text:
        "Implement active projection.",
      data: {
        lifecycleKey: "p6-task",
        status: "open",
      },
      exactEvidence: [
        {
          label: "task-proof",
          value: "TASK_ACTIVE",
        },
      ],
      dedupeKey: "task",
    });

    const before =
      buildResumePacket(
        journal,
        "p6-p1",
        {
          maxBytes: 16384,
        }
      );

    journal.close();

    journal =
      new PersistentSessionJournal({
        path: dbPath,
      });

    const after =
      buildResumePacket(
        journal,
        "p6-p1",
        {
          maxBytes: 16384,
        }
      );

    assert.deepEqual(
      after,
      before
    );
  } finally {
    journal.close();
    rmSync(root, {
      recursive: true,
      force: true,
    });
  }
});
