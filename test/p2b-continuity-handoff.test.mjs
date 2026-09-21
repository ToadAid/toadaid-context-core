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
  buildContinuityHandoff,
  ContextBudgetExceeded,
  ContextEventKind,
  PersistentLexicalIndex,
  PersistentSessionJournal,
} from "../src/index.mjs";

const require =
  createRequire(import.meta.url);
const { DatabaseSync } =
  require("node:sqlite");

function sandbox() {
  const root =
    mkdtempSync(
      join(
        tmpdir(),
        "toadaid-context-p2b-p3-"
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
    kind,
    timestamp,
    text,
    data = {},
    importance = 50,
    exactEvidence,
    rawRef,
    memoryRefs,
    dedupeKey,
  }
) {
  return journal.append({
    sessionId: "continuity-a",
    kind,
    timestamp,
    source: "adapter:test",
    project: "context-core",
    repo:
      "ToadAid/toadaid-context-core",
    attribution: "principal",
    importance,
    text,
    data,
    exactEvidence,
    rawRef,
    memoryRefs,
    dedupeKey,
  });
}

function seedSession(
  journal,
  retrieval
) {
  append(journal, {
    kind:
      ContextEventKind.OBJECTIVE,
    timestamp:
      "2026-09-18T20:00:00Z",
    text:
      "Prove restart continuity without replaying the full session.",
    importance: 100,
    exactEvidence: [
      {
        label: "base_sha",
        value:
          "1afb4f5d0ce731081ea05413e2d46aefbeab01a8",
      },
    ],
    dedupeKey:
      "objective-current",
  });

  append(journal, {
    kind:
      ContextEventKind.GIT_STATE,
    timestamp:
      "2026-09-18T20:01:00Z",
    text:
      "main at merged P2B-P2",
    data: {
      branch: "main",
      head:
        "1afb4f5d0ce731081ea05413e2d46aefbeab01a8",
      tree:
        "10cc8b3cf75808fca2dac75a08ccfad654ee2270",
      clean: true,
    },
    exactEvidence: [
      {
        label: "HEAD",
        value:
          "1afb4f5d0ce731081ea05413e2d46aefbeab01a8",
      },
    ],
    dedupeKey:
      "git-state-current",
  });

  append(journal, {
    kind:
      ContextEventKind.DECISION,
    timestamp:
      "2026-09-18T20:02:00Z",
    text:
      "Use retrieval for deep detail instead of replaying history.",
    importance: 90,
    rawRef:
      "retrieval://continuity-detail",
    dedupeKey:
      "decision-retrieval",
  });

  for (
    let index = 0;
    index < 10;
    index += 1
  ) {
    append(journal, {
      kind:
        ContextEventKind.DECISION,
      timestamp:
        `2026-09-18T20:${String(index + 10).padStart(2, "0")}:00Z`,
      text:
        `Recent bounded decision ${index}.`,
      importance:
        60 + index,
      dedupeKey:
        `recent-decision-${index}`,
    });
  }

  append(journal, {
    kind:
      ContextEventKind.TASK,
    timestamp:
      "2026-09-18T20:30:00Z",
    text:
      "Continue with the recovered marker after restart.",
    data: {
      lifecycleKey:
        "continuity-task",
      status: "open",
    },
    importance: 95,
    dedupeKey:
      "continuity-task-open",
  });

  retrieval.addSource({
    sourceId:
      "continuity-detail",
    content:
      "The continuity marker is ORCHID-742. The next implementation file is src/continuity-handoff.mjs. Preserve the same objective after restart.",
    metadata: {
      sessionId:
        "continuity-a",
      purpose:
        "omitted-detail",
    },
  });

  retrieval.addSource({
    sourceId:
      "distractor",
    content:
      "Unrelated liquidity routing notes for a different project.",
    metadata: {
      purpose:
        "distractor",
    },
  });

  retrieval.addSource({
    sourceId:
      "foreign-session-match",
    content:
      "continuity marker continuity marker continuity marker FOREIGN-SESSION-999",
    metadata: {
      sessionId:
        "continuity-b",
      purpose:
        "cross-session-proof",
    },
  });
}

test(
  "context-loss restart rebuilds the same objective and retrieves omitted detail",
  () => {
    const { root, dbPath } =
      sandbox();

    const journal =
      new PersistentSessionJournal({
        path: dbPath,
      });

    const retrieval =
      new PersistentLexicalIndex({
        path: dbPath,
      });

    seedSession(
      journal,
      retrieval
    );

    journal.close();
    retrieval.close();

    const restartedJournal =
      new PersistentSessionJournal({
        path: dbPath,
      });

    const restartedRetrieval =
      new PersistentLexicalIndex({
        path: dbPath,
      });

    const handoff =
      buildContinuityHandoff(
        {
          journal:
            restartedJournal,
          retrieval:
            restartedRetrieval,
          sessionId:
            "continuity-a",
          retrievalQueries: [
            "continuity marker",
          ],
        },
        {
          totalMaxBytes: 7000,
          resumeMaxBytes: 4200,
          retrievalMaxBytes: 1600,
          resumeOptions: {
            maxDecisions: 2,
          },
        }
      );

    assert.equal(
      handoff.resumePacket
        .currentObjective.text,
      "Prove restart continuity without replaying the full session."
    );

    assert.equal(
      handoff.resumePacket
        .gitState.data.head,
      "1afb4f5d0ce731081ea05413e2d46aefbeab01a8"
    );

    assert.ok(
      handoff.resumePacket
        .omitted.recentDecisions > 0
    );

    assert.equal(
      handoff.retrievals.length,
      1
    );

    assert.match(
      handoff.retrievals[0]
        .response.results[0]
        .content,
      /ORCHID-742/
    );

    assert.match(
      handoff.retrievals[0]
        .response.results[0]
        .content,
      /src\/continuity-handoff\.mjs/
    );

    assert.ok(
      handoff.retrievals[0]
        .response.results.every(
          result =>
            result.metadata.sessionId ===
            "continuity-a"
        )
    );

    assert.equal(
      handoff.retrievals[0]
        .response.results.some(
          result =>
            /FOREIGN-SESSION-999/.test(
              result.content
            )
        ),
      false
    );

    restartedJournal.close();
    restartedRetrieval.close();

    rmSync(root, {
      recursive: true,
      force: true,
    });
  }
);

test(
  "continuity handoff is restart deterministic",
  () => {
    const { root, dbPath } =
      sandbox();

    const journal =
      new PersistentSessionJournal({
        path: dbPath,
      });

    const retrieval =
      new PersistentLexicalIndex({
        path: dbPath,
      });

    seedSession(
      journal,
      retrieval
    );

    const before =
      buildContinuityHandoff(
        {
          journal,
          retrieval,
          sessionId:
            "continuity-a",
          retrievalQueries: [
            "continuity marker",
            "implementation file",
          ],
        },
        {
          totalMaxBytes: 9000,
          resumeMaxBytes: 4200,
          retrievalMaxBytes: 1600,
          resumeOptions: {
            maxDecisions: 2,
          },
        }
      );

    journal.close();
    retrieval.close();

    const journalAgain =
      new PersistentSessionJournal({
        path: dbPath,
      });

    const retrievalAgain =
      new PersistentLexicalIndex({
        path: dbPath,
      });

    const after =
      buildContinuityHandoff(
        {
          journal:
            journalAgain,
          retrieval:
            retrievalAgain,
          sessionId:
            "continuity-a",
          retrievalQueries: [
            "continuity marker",
            "implementation file",
          ],
        },
        {
          totalMaxBytes: 9000,
          resumeMaxBytes: 4200,
          retrievalMaxBytes: 1600,
          resumeOptions: {
            maxDecisions: 2,
          },
        }
      );

    assert.deepEqual(
      after,
      before
    );

    journalAgain.close();
    retrievalAgain.close();

    rmSync(root, {
      recursive: true,
      force: true,
    });
  }
);

test(
  "combined continuity handoff reports actual serialized bytes",
  () => {
    const { root, dbPath } =
      sandbox();

    const journal =
      new PersistentSessionJournal({
        path: dbPath,
      });

    const retrieval =
      new PersistentLexicalIndex({
        path: dbPath,
      });

    seedSession(
      journal,
      retrieval
    );

    const handoff =
      buildContinuityHandoff(
        {
          journal,
          retrieval,
          sessionId:
            "continuity-a",
          retrievalQueries: [
            "continuity marker",
          ],
        },
        {
          totalMaxBytes: 7000,
          resumeMaxBytes: 4200,
          retrievalMaxBytes: 1600,
          resumeOptions: {
            maxDecisions: 2,
          },
        }
      );

    const measured =
      Buffer.byteLength(
        JSON.stringify(handoff),
        "utf8"
      );

    assert.equal(
      handoff.usedBytes,
      measured
    );

    assert.ok(
      measured <= 7000
    );

    journal.close();
    retrieval.close();

    rmSync(root, {
      recursive: true,
      force: true,
    });
  }
);

test(
  "retrieval responses are whole-or-omitted under total handoff pressure",
  () => {
    const { root, dbPath } =
      sandbox();

    const journal =
      new PersistentSessionJournal({
        path: dbPath,
      });

    const retrieval =
      new PersistentLexicalIndex({
        path: dbPath,
      });

    seedSession(
      journal,
      retrieval
    );

    const resumeOnly =
      buildContinuityHandoff(
        {
          journal,
          retrieval,
          sessionId:
            "continuity-a",
          retrievalQueries: [],
        },
        {
          totalMaxBytes: 9000,
          resumeMaxBytes: 4200,
          retrievalMaxBytes: 1600,
          resumeOptions: {
            maxDecisions: 1,
          },
        }
      );

    const constrainedBudget =
      resumeOnly.usedBytes + 256;

    const handoff =
      buildContinuityHandoff(
        {
          journal,
          retrieval,
          sessionId:
            "continuity-a",
          retrievalQueries: [
            "continuity marker",
          ],
        },
        {
          totalMaxBytes:
            constrainedBudget,
          resumeMaxBytes: 4200,
          retrievalMaxBytes: 1600,
          resumeOptions: {
            maxDecisions: 1,
          },
        }
      );

    assert.equal(
      handoff.retrievals.length,
      0
    );

    assert.equal(
      handoff
        .omittedRetrievalQueries,
      1
    );

    assert.equal(
      handoff.resumePacket
        .currentObjective.text,
      "Prove restart continuity without replaying the full session."
    );

    journal.close();
    retrieval.close();

    rmSync(root, {
      recursive: true,
      force: true,
    });
  }
);

test(
  "mandatory ResumePacket fails closed if the total handoff cannot carry it",
  () => {
    const { root, dbPath } =
      sandbox();

    const journal =
      new PersistentSessionJournal({
        path: dbPath,
      });

    const retrieval =
      new PersistentLexicalIndex({
        path: dbPath,
      });

    append(journal, {
      kind:
        ContextEventKind.OBJECTIVE,
      timestamp:
        "2026-09-18T22:00:00Z",
      text:
        "Large exact evidence must survive.",
      exactEvidence: [
        {
          label: "receipt",
          value:
            "E".repeat(1600),
        },
      ],
      dedupeKey:
        "large-objective",
    });

    assert.throws(
      () =>
        buildContinuityHandoff(
          {
            journal,
            retrieval,
            sessionId:
              "continuity-a",
          },
          {
            resumeMaxBytes: 3000,
            totalMaxBytes: 1200,
          }
        ),
      ContextBudgetExceeded
    );

    journal.close();
    retrieval.close();

    rmSync(root, {
      recursive: true,
      force: true,
    });
  }
);

test(
  "retrieval integrity failure aborts continuity handoff",
  () => {
    const { root, dbPath } =
      sandbox();

    const journal =
      new PersistentSessionJournal({
        path: dbPath,
      });

    const retrieval =
      new PersistentLexicalIndex({
        path: dbPath,
      });

    seedSession(
      journal,
      retrieval
    );

    retrieval.close();

    const db =
      new DatabaseSync(dbPath);

    db.prepare(`
      UPDATE chunks_fts
      SET lexical_text = ?
      WHERE chunk_id IN (
        SELECT chunk_id
        FROM chunks
        WHERE source_id = ?
      )
    `).run(
      "",
      "continuity-detail"
    );

    db.close();

    const reopenedRetrieval =
      new PersistentLexicalIndex({
        path: dbPath,
      });

    assert.throws(
      () =>
        buildContinuityHandoff(
          {
            journal,
            retrieval:
              reopenedRetrieval,
            sessionId:
              "continuity-a",
            retrievalQueries: [
              "continuity marker",
            ],
          }
        ),
      /FTS index integrity mismatch/
    );

    journal.close();
    reopenedRetrieval.close();

    rmSync(root, {
      recursive: true,
      force: true,
    });
  }
);

test(
  "continuity handoff does not auto-dereference raw or durable-memory references",
  () => {
    const { root, dbPath } =
      sandbox();

    const journal =
      new PersistentSessionJournal({
        path: dbPath,
      });

    const retrieval =
      new PersistentLexicalIndex({
        path: dbPath,
      });

    append(journal, {
      kind:
        ContextEventKind.OBJECTIVE,
      timestamp:
        "2026-09-18T23:00:00Z",
      text:
        "Keep external references external.",
      rawRef:
        "raw://private/detail",
      memoryRefs: [
        "mirror://recall/99",
      ],
      dedupeKey:
        "external-boundary",
    });

    const handoff =
      buildContinuityHandoff(
        {
          journal,
          retrieval,
          sessionId:
            "continuity-a",
          retrievalQueries: [],
        }
      );

    assert.equal(
      handoff.retrievals.length,
      0
    );

    assert.ok(
      handoff.resumePacket
        .references.some(
          item =>
            item.ref ===
            "raw://private/detail"
        )
    );

    assert.ok(
      handoff.resumePacket
        .references.some(
          item =>
            item.ref ===
            "mirror://recall/99"
        )
    );

    journal.close();
    retrieval.close();

    rmSync(root, {
      recursive: true,
      force: true,
    });
  }
);

test(
  "retrieval queries are explicit and invalid empty queries are refused",
  () => {
    const { root, dbPath } =
      sandbox();

    const journal =
      new PersistentSessionJournal({
        path: dbPath,
      });

    const retrieval =
      new PersistentLexicalIndex({
        path: dbPath,
      });

    append(journal, {
      kind:
        ContextEventKind.OBJECTIVE,
      timestamp:
        "2026-09-19T00:00:00Z",
      text:
        "Explicit retrieval query proof.",
      dedupeKey:
        "explicit-query-objective",
    });

    assert.throws(
      () =>
        buildContinuityHandoff(
          {
            journal,
            retrieval,
            sessionId:
              "continuity-a",
            retrievalQueries: [
              "   ",
            ],
          }
        ),
      /must be a non-empty string/
    );

    journal.close();
    retrieval.close();

    rmSync(root, {
      recursive: true,
      force: true,
    });
  }
);


test(
  "continuity retrieval refuses cross-session lexical bleed",
  () => {
    const { root, dbPath } =
      sandbox();

    const journal =
      new PersistentSessionJournal({
        path: dbPath,
      });

    const retrieval =
      new PersistentLexicalIndex({
        path: dbPath,
      });

    append(journal, {
      kind:
        ContextEventKind.OBJECTIVE,
      timestamp:
        "2026-09-19T00:10:00Z",
      text:
        "Keep continuity retrieval session-bound.",
      dedupeKey:
        "isolation-objective",
    });

    retrieval.addSource({
      sourceId:
        "session-a-local",
      content:
        "continuity marker LOCAL-SESSION-111",
      metadata: {
        sessionId:
          "continuity-a",
      },
    });

    retrieval.addSource({
      sourceId:
        "session-b-foreign",
      content:
        "continuity marker continuity marker continuity marker FOREIGN-SESSION-999",
      metadata: {
        sessionId:
          "continuity-b",
      },
    });

    const unrestricted =
      retrieval.search(
        "continuity marker",
        {
          maxResults: 8,
          maxBytes: 3000,
        }
      );

    assert.ok(
      unrestricted.results.some(
        result =>
          /FOREIGN-SESSION-999/.test(
            result.content
          )
      )
    );

    const handoff =
      buildContinuityHandoff(
        {
          journal,
          retrieval,
          sessionId:
            "continuity-a",
          retrievalQueries: [
            "continuity marker",
          ],
        },
        {
          totalMaxBytes: 5000,
          resumeMaxBytes: 2500,
          retrievalMaxBytes: 1800,
          retrievalMaxResults: 8,
        }
      );

    const results =
      handoff.retrievals[0]
        .response.results;

    assert.equal(
      results.length,
      1
    );

    assert.match(
      results[0].content,
      /LOCAL-SESSION-111/
    );

    assert.equal(
      results.some(
        result =>
          /FOREIGN-SESSION-999/.test(
            result.content
          )
      ),
      false
    );

    assert.equal(
      results[0].metadata.sessionId,
      "continuity-a"
    );

    journal.close();
    retrieval.close();

    rmSync(root, {
      recursive: true,
      force: true,
    });
  }
);

test(
  "persistent retrieval metadata equality filter is optional and exact",
  () => {
    const { root, dbPath } =
      sandbox();

    const retrieval =
      new PersistentLexicalIndex({
        path: dbPath,
      });

    retrieval.addSource({
      sourceId:
        "scope-a",
      content:
        "shared continuity marker alpha",
      metadata: {
        sessionId: "a",
        active: true,
      },
    });

    retrieval.addSource({
      sourceId:
        "scope-b",
      content:
        "shared continuity marker beta",
      metadata: {
        sessionId: "b",
        active: true,
      },
    });

    const all =
      retrieval.search(
        "shared continuity",
        {
          maxResults: 8,
          maxBytes: 3000,
        }
      );

    assert.equal(
      all.results.length,
      2
    );

    const scoped =
      retrieval.search(
        "shared continuity",
        {
          maxResults: 8,
          maxBytes: 3000,
          metadataEquals: {
            sessionId: "a",
            active: true,
          },
        }
      );

    assert.equal(
      scoped.results.length,
      1
    );
    assert.equal(
      scoped.results[0]
        .metadata.sessionId,
      "a"
    );

    retrieval.close();

    rmSync(root, {
      recursive: true,
      force: true,
    });
  }
);


test(
  "metadata relabel tampering fails before session isolation can be bypassed",
  () => {
    const { root, dbPath } =
      sandbox();

    const journal =
      new PersistentSessionJournal({
        path: dbPath,
      });

    const retrieval =
      new PersistentLexicalIndex({
        path: dbPath,
      });

    append(journal, {
      kind:
        ContextEventKind.OBJECTIVE,
      timestamp:
        "2026-09-19T00:20:00Z",
      text:
        "Reject persisted metadata relabeling.",
      dedupeKey:
        "metadata-tamper-objective",
    });

    retrieval.addSource({
      sourceId:
        "foreign-metadata-source",
      content:
        "continuity marker FOREIGN-METADATA-777",
      metadata: {
        sessionId:
          "continuity-b",
      },
    });

    retrieval.close();

    const db =
      new DatabaseSync(dbPath);

    db.prepare(`
      UPDATE sources
      SET metadata_json = ?
      WHERE source_id = ?
    `).run(
      JSON.stringify({
        sessionId:
          "continuity-a",
      }),
      "foreign-metadata-source"
    );

    db.close();

    const reopened =
      new PersistentLexicalIndex({
        path: dbPath,
      });

    assert.throws(
      () =>
        buildContinuityHandoff(
          {
            journal,
            retrieval:
              reopened,
            sessionId:
              "continuity-a",
            retrievalQueries: [
              "continuity marker",
            ],
          }
        ),
      /stored metadata integrity mismatch/
    );

    journal.close();
    reopened.close();

    rmSync(root, {
      recursive: true,
      force: true,
    });
  }
);

test(
  "scoped retrieval refuses legacy metadata without an integrity digest",
  () => {
    const { root, dbPath } =
      sandbox();

    const retrieval =
      new PersistentLexicalIndex({
        path: dbPath,
      });

    retrieval.addSource({
      sourceId:
        "legacy-unbound-metadata",
      content:
        "legacy continuity marker",
      metadata: {
        sessionId:
          "continuity-a",
      },
    });

    retrieval.close();

    const db =
      new DatabaseSync(dbPath);

    db.prepare(`
      UPDATE sources
      SET metadata_digest = NULL
      WHERE source_id = ?
    `).run(
      "legacy-unbound-metadata"
    );

    db.close();

    const reopened =
      new PersistentLexicalIndex({
        path: dbPath,
      });

    assert.throws(
      () =>
        reopened.search(
          "legacy continuity",
          {
            maxResults: 8,
            maxBytes: 3000,
            metadataEquals: {
              sessionId:
                "continuity-a",
            },
          }
        ),
      /stored metadata integrity unavailable/
    );

    const unscoped =
      reopened.search(
        "legacy continuity",
        {
          maxResults: 8,
          maxBytes: 3000,
        }
      );

    assert.equal(
      unscoped.results.length,
      1
    );

    reopened.close();

    rmSync(root, {
      recursive: true,
      force: true,
    });
  }
);
