import test from "node:test";
import assert from "node:assert/strict";

import {
  runToolOutputIngressExample,
} from "../examples/tool-output-ingress.mjs";

test("P3C-P2 public integration example proves the provider-neutral host boundary", () => {
  const result = runToolOutputIngressExample();

  assert.equal(
    result.readonlyToolOutput.mode,
    "DEFERRED",
  );
  assert.equal(
    result.readonlyToolOutput.referenceKind,
    "CONTEXT_REFERENCE",
  );
  assert.ok(
    result.readonlyToolOutput.bytesAvoided > 0,
  );
  assert.ok(
    result.readonlyToolOutput.modelBytes <
      result.readonlyToolOutput.rawBytes,
  );
  assert.equal(
    result.readonlyToolOutput.omittedDetailRecovered,
    true,
  );

  assert.equal(
    result.exactEvidence.mode,
    "INLINE",
  );
  assert.equal(
    result.exactEvidence.byteIdentical,
    true,
  );
  assert.equal(
    result.exactEvidence.bytesAvoided,
    0,
  );

  assert.equal(
    result.hostStructuredData.preserved,
    true,
  );
  assert.equal(
    result.hostStructuredData.path,
    "src/agent.mjs",
  );

  for (const [capability, enabled] of
    Object.entries(result.capabilities)) {
    assert.equal(
      enabled,
      false,
      `${capability} must remain outside Context Core`,
    );
  }
});
