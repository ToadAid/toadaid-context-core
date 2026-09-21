import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test(
  "package self-reference resolves the public Context Core API",
  async () => {
    const api =
      await import(
        "@toadaid/context-core"
      );

    for (const name of [
      "ContextEventKind",
      "PersistentSessionJournal",
      "PersistentLexicalIndex",
      "buildResumePacket",
      "buildContinuityHandoff",
      "prepareContextIngress",
      "prepareToolOutputIngress",
      "chunkMarkdownDeterministic",
    ]) {
      assert.ok(
        name in api,
        `missing package export ${name}`
      );
    }
  }
);

test(
  "consumer import can build a real restart continuity handoff",
  async () => {
    const api =
      await import(
        "@toadaid/context-core"
      );

    const root =
      mkdtempSync(
        join(
          tmpdir(),
          "toadaid-context-package-"
        )
      );
    const dbPath =
      join(root, "context.sqlite");

    const journal =
      new api.PersistentSessionJournal({
        path: dbPath,
      });

    const retrieval =
      new api.PersistentLexicalIndex({
        path: dbPath,
      });

    journal.append({
      sessionId: "consumer-a",
      kind:
        api.ContextEventKind.OBJECTIVE,
      timestamp:
        "2026-09-18T22:00:00Z",
      source:
        "adapter:package-test",
      project:
        "trading-desk",
      repo:
        "ToadAid/trading-desk",
      attribution:
        "principal",
      importance: 100,
      text:
        "Continue the same Trading Desk objective after restart.",
      dedupeKey:
        "consumer-objective",
    });

    retrieval.addSource({
      sourceId:
        "consumer-detail",
      content:
        "package surface marker TRADING-FROG-321",
      metadata: {
        sessionId:
          "consumer-a",
      },
    });

    journal.close();
    retrieval.close();

    const reopenedJournal =
      new api.PersistentSessionJournal({
        path: dbPath,
      });

    const reopenedRetrieval =
      new api.PersistentLexicalIndex({
        path: dbPath,
      });

    const handoff =
      api.buildContinuityHandoff(
        {
          journal:
            reopenedJournal,
          retrieval:
            reopenedRetrieval,
          sessionId:
            "consumer-a",
          retrievalQueries: [
            "package surface",
          ],
        },
        {
          totalMaxBytes: 5000,
          resumeMaxBytes: 2500,
          retrievalMaxBytes: 1500,
        }
      );

    assert.equal(
      handoff.sessionId,
      "consumer-a"
    );

    assert.equal(
      handoff.resumePacket
        .currentObjective.text,
      "Continue the same Trading Desk objective after restart."
    );

    assert.match(
      handoff.retrievals[0]
        .response.results[0]
        .content,
      /TRADING-FROG-321/
    );

    reopenedJournal.close();
    reopenedRetrieval.close();

    rmSync(root, {
      recursive: true,
      force: true,
    });
  }
);

test(
  "package metadata binds runtime and type entrypoints",
  () => {
    const pkg =
      JSON.parse(
        readFileSync(
          new URL(
            "../package.json",
            import.meta.url
          ),
          "utf8"
        )
      );

    assert.equal(
      pkg.main,
      "./src/index.mjs"
    );
    assert.equal(
      pkg.types,
      "./src/index.d.ts"
    );
    assert.equal(
      pkg.exports["."].types,
      "./src/index.d.ts"
    );
    assert.equal(
      pkg.exports["."].import,
      "./src/index.mjs"
    );
  }
);
