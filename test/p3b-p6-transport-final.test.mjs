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
  buildContinuityTransport,
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
        "toadaid-context-p6-p3-"
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
    sessionId = "p6-p3",
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
      "adapter:p6-p3-test",
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

function retrievalWithSize(size) {
  return {
    search(query) {
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
              "R".repeat(size),
            contentDigest:
              "d".repeat(64),
            metadata: {
              sessionId: "p6-p3",
            },
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
    },
  };
}

test("transport returns the exact authoritative serialized handoff bytes", () => {
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
        "2026-09-20T03:00:00Z",
      text:
        "Make final transport bytes authoritative.",
      dedupeKey: "objective",
    });

    append(journal, {
      kind:
        ContextEventKind.GIT_STATE,
      timestamp:
        "2026-09-20T03:01:00Z",
      text:
        "P6-P3 branch is clean.",
      data: {
        head:
          "77d7a2c4ec3cbea4bb25f8a842b47d71d31e5e6a",
      },
      dedupeKey: "git",
    });

    const transport =
      buildContinuityTransport(
        {
          journal,
          retrieval:
            retrievalWithSize(64),
          sessionId: "p6-p3",
          retrievalQueries: [
            "transport truth",
          ],
        },
        {
          totalMaxBytes: 5000,
          resumeMaxBytes: 3000,
          retrievalMaxBytes: 1000,
        }
      );

    const measured =
      Buffer.byteLength(
        transport.serialized,
        "utf8"
      );

    const parsed =
      JSON.parse(
        transport.serialized
      );

    assert.equal(
      transport.kind,
      "CONTINUITY_TRANSPORT"
    );
    assert.equal(
      transport.mediaType,
      "application/json"
    );
    assert.equal(
      transport.encoding,
      "utf-8"
    );
    assert.equal(
      transport.usedBytes,
      measured
    );
    assert.equal(
      parsed.usedBytes,
      measured
    );
    assert.equal(
      parsed.budgetBytes,
      5000
    );
    assert.ok(measured <= 5000);
    assert.equal(
      JSON.stringify(parsed),
      transport.serialized
    );
  } finally {
    journal.close();
    rmSync(root, {
      recursive: true,
      force: true,
    });
  }
});

test("transport ceiling counts real UTF-8 bytes for multibyte continuity content", () => {
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
        "2026-09-20T03:10:00Z",
      text:
        `多字节🐸continuity-${"界🐸".repeat(120)}`,
      dedupeKey: "objective",
    });

    const transport =
      buildContinuityTransport(
        {
          journal,
          retrieval:
            retrievalWithSize(8),
          sessionId: "p6-p3",
          retrievalQueries: [],
        },
        {
          totalMaxBytes: 5000,
          resumeMaxBytes: 4200,
        }
      );

    assert.equal(
      transport.usedBytes,
      Buffer.byteLength(
        transport.serialized,
        "utf8"
      )
    );
    assert.ok(
      transport.usedBytes >
      transport.serialized.length
    );
    assert.ok(
      transport.usedBytes <=
      transport.budgetBytes
    );
  } finally {
    journal.close();
    rmSync(root, {
      recursive: true,
      force: true,
    });
  }
});

test("total pressure omits retrieval before reducing recoverable historical inline material", () => {
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
        "2026-09-20T03:20:00Z",
      text:
        "Preserve recovery truth under final transport pressure.",
      dedupeKey: "objective",
    });

    for (
      let index = 0;
      index < 8;
      index += 1
    ) {
      append(journal, {
        kind:
          ContextEventKind.DECISION,
        timestamp:
          `2026-09-20T03:${String(index + 21).padStart(2, "0")}:00Z`,
        text:
          `Recoverable decision ${index} ${"history ".repeat(70)}`,
        importance:
          60 + index,
        dedupeKey:
          `decision-${index}`,
      });
    }

    const retrieval =
      retrievalWithSize(1800);

    const generous =
      buildContinuityHandoff(
        {
          journal,
          retrieval,
          sessionId: "p6-p3",
          retrievalQueries: [],
        },
        {
          totalMaxBytes: 12000,
          resumeMaxBytes: 8000,
          resumeOptions: {
            maxDecisions: 8,
          },
        }
      );

    assert.ok(
      generous.resumePacket
        .recentDecisions.length > 1
    );

    const tightBudget =
      Math.max(
        1024,
        generous.usedBytes - 600
      );

    const tight =
      buildContinuityHandoff(
        {
          journal,
          retrieval,
          sessionId: "p6-p3",
          retrievalQueries: [
            "transport pressure",
          ],
        },
        {
          totalMaxBytes:
            tightBudget,
          resumeMaxBytes: 8000,
          retrievalMaxBytes: 2200,
          resumeOptions: {
            maxDecisions: 8,
          },
        }
      );

    assert.equal(
      tight.retrievals.length,
      0
    );
    assert.equal(
      tight.omittedRetrievalQueries,
      1
    );
    assert.ok(
      tight.resumePacket
        .recentDecisions.length <
      generous.resumePacket
        .recentDecisions.length
    );
    assert.ok(
      tight.resumePacket
        .omissionManifest.events
        .length > 0
    );
    assert.ok(
      tight.usedBytes <=
      tightBudget
    );
  } finally {
    journal.close();
    rmSync(root, {
      recursive: true,
      force: true,
    });
  }
});

test("pressure attribution does not blame query identities when mandatory continuity already cannot fit", () => {
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
        "2026-09-20T03:35:00Z",
      text:
        "Mandatory continuity pressure must be attributed to its real cause.",
      exactEvidence: [
        {
          label: "proof",
          value:
            "M".repeat(1400),
        },
      ],
      dedupeKey: "objective",
    });

    const packet =
      buildResumePacket(
        journal,
        "p6-p3",
        {
          maxBytes: 5000,
        }
      );

    const constrainedTotal =
      Math.max(
        1024,
        packet.usedBytes + 64
      );

    assert.throws(
      () =>
        buildContinuityHandoff(
          {
            journal,
            retrieval:
              retrievalWithSize(16),
            sessionId: "p6-p3",
            retrievalQueries: [],
          },
          {
            totalMaxBytes:
              constrainedTotal,
            resumeMaxBytes: 5000,
          }
        ),
      error =>
        error instanceof
          ContextBudgetExceeded
    );

    assert.throws(
      () =>
        buildContinuityHandoff(
          {
            journal,
            retrieval:
              retrievalWithSize(16),
            sessionId: "p6-p3",
            retrievalQueries: [
              "present but not causal",
            ],
          },
          {
            totalMaxBytes:
              constrainedTotal,
            resumeMaxBytes: 5000,
          }
        ),
      error =>
        error instanceof
          ContextBudgetExceeded &&
        !/retrieval omission identities/.test(
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

test("transport bytes are restart deterministic", () => {
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
        "2026-09-20T03:40:00Z",
      text:
        "Restart must preserve final transport bytes.",
      dedupeKey: "objective",
    });

    append(journal, {
      kind:
        ContextEventKind.DECISION,
      timestamp:
        "2026-09-20T03:41:00Z",
      text:
        "Historical continuity remains deterministic.",
      dedupeKey: "decision",
    });

    const options = {
      totalMaxBytes: 5000,
      resumeMaxBytes: 3000,
      retrievalMaxBytes: 1000,
    };

    const input = {
      journal,
      retrieval:
        retrievalWithSize(128),
      sessionId: "p6-p3",
      retrievalQueries: [
        "restart bytes",
      ],
    };

    const before =
      buildContinuityTransport(
        input,
        options
      );

    journal.close();

    journal =
      new PersistentSessionJournal({
        path: dbPath,
      });

    const after =
      buildContinuityTransport(
        {
          ...input,
          journal,
        },
        options
      );

    assert.deepEqual(
      after,
      before
    );
    assert.equal(
      after.serialized,
      before.serialized
    );
  } finally {
    journal.close();
    rmSync(root, {
      recursive: true,
      force: true,
    });
  }
});

test("transport fails closed when mandatory continuity plus recovery truth cannot fit", () => {
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
        "2026-09-20T03:50:00Z",
      text:
        "Mandatory exact evidence cannot disappear.",
      exactEvidence: [
        {
          label: "proof",
          value:
            "E".repeat(2400),
        },
      ],
      dedupeKey: "objective",
    });

    assert.throws(
      () =>
        buildContinuityTransport(
          {
            journal,
            retrieval:
              retrievalWithSize(16),
            sessionId: "p6-p3",
            retrievalQueries: [],
          },
          {
            totalMaxBytes: 1200,
            resumeMaxBytes: 3000,
          }
        ),
      error =>
        error instanceof
        ContextBudgetExceeded
    );
  } finally {
    journal.close();
    rmSync(root, {
      recursive: true,
      force: true,
    });
  }
});
