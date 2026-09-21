#!/usr/bin/env node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ContentStore,
  ContextCore,
  ContextClass,
  buildContextPacket,
} from "../src/index.mjs";

const root = mkdtempSync(join(tmpdir(), "toadaid-context-demo-"));

try {
  const store = new ContentStore(root);
  const core = new ContextCore({ store });

  const head = core.ingest({
    content: "6c353a6ce2d50d29e87dbe47cb7b36b1c957ef68",
    classification: ContextClass.EXACT_EVIDENCE,
    label: "canonical main HEAD",
    metadata: { kind: "commit_sha", evidence: true },
  });

  const log = Array.from({ length: 500 }, (_, i) =>
    i === 417 ? "FAIL tests/liquidity.test.mjs: expected guarded quote" : `PASS test-${i}`
  ).join("\n");

  const bulk = core.ingest({
    content: log,
    classification: ContextClass.BULK_MATERIAL,
    label: "test output",
  });

  const packet = buildContextPacket([head, bulk], { budgetBytes: 5000 });
  console.log(JSON.stringify(packet, null, 2));
} finally {
  rmSync(root, { recursive: true, force: true });
}
