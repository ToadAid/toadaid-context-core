import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildContinuityHandoff,
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
        "toadaid-context-p6-p2-"
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
    sessionId = "p6-p2",
    kind,
    timestamp,
    text,
    importance = 50,
    data = {},
    exactEvidence,
    dedupeKey,
  }
) {
  return journal.append({
    sessionId,
    kind,
    timestamp,
    source:
      "adapter:p6-p2-test",
    project: "context-core",
    repo:
      "ToadAid/toadaid-context-core",
    attribution: "principal",
    importance,
    text,
    data,
    exactEvidence,
    dedupeKey,
  });
}

function largeResponse(query) {
  const response = {
    query,
    terms: [query],
    match: "all",
    totalCandidates: 1,
    omittedResults: 0,
    results: [
      {
        sourceId: "test",
        chunkId: "test:0",
        chunkIndex: 0,
        classification:
          "RETRIEVABLE_KNOWLEDGE",
        score: 1,
        content:
          "R".repeat(4096),
        contentDigest:
          "d".repeat(64),
        metadata: {},
      },
    ],
    usedBytes: 0,
  };

  response.usedBytes =
    Buffer.byteLength(
      JSON.stringify(response),
      "utf8"
    );

  return Object.freeze(response);
}

test("omitted historical decision and exact evidence carry snapshot-bound recovery identities", () => {
  const { root, dbPath } =
    sandbox();

  const journal =
    new PersistentSessionJournal({
      path: dbPath,
    });

  try {
    append(journal, {
      kind:
        ContextEventKind.OBJECTIVE,
      timestamp:
        "2026-09-20T00:10:00Z",
      text:
        "Prove omission recovery.",
      dedupeKey: "objective",
    });

    const older =
      append(journal, {
        kind:
          ContextEventKind.DECISION,
        timestamp:
          "2026-09-20T00:11:00Z",
        text:
          "Older recoverable decision.",
        exactEvidence: [
          {
            label: "older-proof",
            value:
              "OLDER_EXACT_VALUE",
          },
        ],
        dedupeKey: "decision-old",
      });

    append(journal, {
      kind:
        ContextEventKind.DECISION,
      timestamp:
        "2026-09-20T00:12:00Z",
      text:
        "Newest inline decision.",
      exactEvidence: [
        {
          label: "new-proof",
          value:
            "NEW_EXACT_VALUE",
        },
      ],
      dedupeKey: "decision-new",
    });

    const packet =
      buildResumePacket(
        journal,
        "p6-p2",
        {
          maxBytes: 8192,
          maxDecisions: 1,
        }
      );

    assert.deepEqual(
      packet.recentDecisions.map(
        event => event.text
      ),
      [
        "Newest inline decision.",
      ]
    );

    const eventRef =
      packet.omissionManifest
        .events.find(
          reference =>
            reference.eventId ===
            older.eventId
        );

    assert.ok(eventRef);
    assert.equal(
      eventRef.eventDigest,
      older.eventDigest
    );

    const evidenceRef =
      packet.omissionManifest
        .exactEvidence.find(
          reference =>
            reference.eventId ===
              older.eventId &&
            reference.label ===
              "older-proof"
        );

    assert.ok(evidenceRef);
    assert.equal(
      packet.omitted.exactEvidence,
      packet.omissionManifest
        .exactEvidence.length
    );

    const recovered =
      journal.resolveEventReference(
        packet.omissionManifest
          .snapshot,
        eventRef
      );

    assert.equal(
      recovered.text,
      "Older recoverable decision."
    );
    assert.equal(
      recovered.exactEvidence[0]
        .value,
      "OLDER_EXACT_VALUE"
    );
  } finally {
    journal.close();
    rmSync(root, {
      recursive: true,
      force: true,
    });
  }
});

test("historical snapshot references survive later append but reject snapshot or event rebinding", () => {
  const { root, dbPath } =
    sandbox();

  const journal =
    new PersistentSessionJournal({
      path: dbPath,
    });

  try {
    append(journal, {
      kind:
        ContextEventKind.OBJECTIVE,
      timestamp:
        "2026-09-20T00:20:00Z",
      text:
        "Snapshot proof.",
      dedupeKey: "objective",
    });

    const historical =
      append(journal, {
        kind:
          ContextEventKind.DECISION,
        timestamp:
          "2026-09-20T00:21:00Z",
        text:
          "Recover me later.",
        dedupeKey:
          "historical",
      });

    append(journal, {
      kind:
        ContextEventKind.DECISION,
      timestamp:
        "2026-09-20T00:22:00Z",
      text:
        "Newest inline.",
      dedupeKey: "newest",
    });

    const packet =
      buildResumePacket(
        journal,
        "p6-p2",
        {
          maxBytes: 8192,
          maxDecisions: 1,
        }
      );

    const reference =
      packet.omissionManifest
        .events.find(
          item =>
            item.eventId ===
            historical.eventId
        );

    assert.ok(reference);

    append(journal, {
      kind:
        ContextEventKind.EXTERNAL_REF,
      timestamp:
        "2026-09-20T00:23:00Z",
      text:
        "Later append after snapshot.",
      dedupeKey: "later",
    });

    const recovered =
      journal.resolveEventReference(
        packet.omissionManifest
          .snapshot,
        reference
      );

    assert.equal(
      recovered.eventId,
      historical.eventId
    );

    assert.throws(
      () =>
        journal.resolveEventReference(
          {
            ...packet
              .omissionManifest
              .snapshot,
            lastDigest:
              "f".repeat(64),
          },
          reference
        ),
      /snapshot reference binding mismatch/
    );

    assert.throws(
      () =>
        journal.resolveEventReference(
          packet.omissionManifest
            .snapshot,
          {
            ...reference,
            eventDigest:
              "e".repeat(64),
          }
        ),
      /event reference binding mismatch/
    );

    assert.throws(
      () =>
        journal.resolveEventReference(
          packet.omissionManifest
            .snapshot,
          {
            ...reference,
            kind:
              ContextEventKind.TASK,
          }
        ),
      /event reference kind binding mismatch/
    );
  } finally {
    journal.close();
    rmSync(root, {
      recursive: true,
      force: true,
    });
  }
});

test("section-capped active event body remains recoverable while active exact evidence stays inline", () => {
  const { root, dbPath } =
    sandbox();

  const journal =
    new PersistentSessionJournal({
      path: dbPath,
    });

  try {
    const first =
      append(journal, {
        kind:
          ContextEventKind.CONSTRAINT,
        timestamp:
          "2026-09-20T00:30:00Z",
        text:
          "First active constraint.",
        importance: 100,
        data: {
          lifecycleKey: "first",
          status: "open",
        },
        exactEvidence: [
          {
            label: "first-proof",
            value: "FIRST_PROOF",
          },
        ],
        dedupeKey: "first",
      });

    const second =
      append(journal, {
        kind:
          ContextEventKind.CONSTRAINT,
        timestamp:
          "2026-09-20T00:31:00Z",
        text:
          "Second active constraint.",
        importance: 90,
        data: {
          lifecycleKey: "second",
          status: "open",
        },
        exactEvidence: [
          {
            label:
              "second-proof",
            value:
              "SECOND_PROOF",
          },
        ],
        dedupeKey: "second",
      });

    const packet =
      buildResumePacket(
        journal,
        "p6-p2",
        {
          maxBytes: 8192,
          maxConstraints: 1,
        }
      );

    assert.deepEqual(
      packet.constraints.map(
        item => item.eventId
      ),
      [first.eventId]
    );

    assert.deepEqual(
      new Set(
        packet.exactEvidence.map(
          item => item.value
        )
      ),
      new Set([
        "FIRST_PROOF",
        "SECOND_PROOF",
      ])
    );

    const omittedBody =
      packet.omissionManifest
        .events.find(
          item =>
            item.eventId ===
            second.eventId
        );

    assert.ok(omittedBody);

    assert.equal(
      packet.omissionManifest
        .exactEvidence.some(
          item =>
            item.eventId ===
              first.eventId ||
            item.eventId ===
              second.eventId
        ),
      false
    );

    const recovered =
      journal.resolveEventReference(
        packet.omissionManifest
          .snapshot,
        omittedBody
      );

    assert.equal(
      recovered.text,
      "Second active constraint."
    );
  } finally {
    journal.close();
    rmSync(root, {
      recursive: true,
      force: true,
    });
  }
});

test("omitted retrieval queries are explicit and duplicate-safe by request index", () => {
  const { root, dbPath } =
    sandbox();

  const journal =
    new PersistentSessionJournal({
      path: dbPath,
    });

  try {
    append(journal, {
      kind:
        ContextEventKind.OBJECTIVE,
      timestamp:
        "2026-09-20T00:40:00Z",
      text:
        "Keep duplicate omitted queries distinguishable.",
      dedupeKey: "objective",
    });

    const retrieval = {
      search(query) {
        return largeResponse(query);
      },
    };

    const resumeOnly =
      buildContinuityHandoff(
        {
          journal,
          retrieval,
          sessionId: "p6-p2",
          retrievalQueries: [],
        },
        {
          totalMaxBytes: 4096,
          resumeMaxBytes: 2048,
          retrievalMaxBytes: 1024,
        }
      );

    const handoff =
      buildContinuityHandoff(
        {
          journal,
          retrieval,
          sessionId: "p6-p2",
          retrievalQueries: [
            "same query",
            "same query",
          ],
        },
        {
          totalMaxBytes:
            resumeOnly.usedBytes +
            260,
          resumeMaxBytes: 2048,
          retrievalMaxBytes: 1024,
        }
      );

    assert.equal(
      handoff.retrievals.length,
      0
    );
    assert.equal(
      handoff
        .omittedRetrievalQueries,
      2
    );
    assert.deepEqual(
      handoff
        .omittedRetrievalQueryItems,
      [
        {
          index: 0,
          query: "same query",
        },
        {
          index: 1,
          query: "same query",
        },
      ]
    );
  } finally {
    journal.close();
    rmSync(root, {
      recursive: true,
      force: true,
    });
  }
});

test("retrieval omission identity truth fails closed instead of disappearing under pressure", () => {
  const { root, dbPath } =
    sandbox();

  const journal =
    new PersistentSessionJournal({
      path: dbPath,
    });

  try {
    append(journal, {
      kind:
        ContextEventKind.OBJECTIVE,
      timestamp:
        "2026-09-20T00:50:00Z",
      text:
        "Omission query identity must fit.",
      dedupeKey: "objective",
    });

    const retrieval = {
      search(query) {
        return largeResponse(query);
      },
    };

    const baseline =
      buildContinuityHandoff(
        {
          journal,
          retrieval,
          sessionId:
            "p6-p2",
          retrievalQueries: [],
        },
        {
          totalMaxBytes: 4096,
          resumeMaxBytes: 2048,
          retrievalMaxBytes: 256,
        }
      );

    const constrainedTotal =
      Math.max(
        1024,
        baseline.usedBytes + 64
      );

    assert.throws(
      () =>
        buildContinuityHandoff(
          {
            journal,
            retrieval,
            sessionId:
              "p6-p2",
            retrievalQueries: [
              "Q".repeat(4096),
            ],
          },
          {
            totalMaxBytes:
              constrainedTotal,
            resumeMaxBytes: 2048,
            retrievalMaxBytes: 256,
          }
        ),
      error =>
        error instanceof
          ContextBudgetExceeded &&
        /retrieval omission identities/.test(
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

test("resume omission manifest is deterministic across restart", () => {
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
        "2026-09-20T01:00:00Z",
      text:
        "Restart-safe omission manifest.",
      dedupeKey: "objective",
    });

    append(journal, {
      kind:
        ContextEventKind.DECISION,
      timestamp:
        "2026-09-20T01:01:00Z",
      text:
        "Historical decision.",
      exactEvidence: [
        {
          label: "restart-proof",
          value: "RESTART_EXACT",
        },
      ],
      dedupeKey: "decision-old",
    });

    append(journal, {
      kind:
        ContextEventKind.DECISION,
      timestamp:
        "2026-09-20T01:02:00Z",
      text:
        "Newest decision.",
      dedupeKey: "decision-new",
    });

    const before =
      buildResumePacket(
        journal,
        "p6-p2",
        {
          maxBytes: 8192,
          maxDecisions: 1,
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
        "p6-p2",
        {
          maxBytes: 8192,
          maxDecisions: 1,
        }
      );

    assert.deepEqual(
      after.omissionManifest,
      before.omissionManifest
    );
    assert.deepEqual(after, before);
  } finally {
    journal.close();
    rmSync(root, {
      recursive: true,
      force: true,
    });
  }
});
