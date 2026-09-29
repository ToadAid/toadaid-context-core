import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  TemporalAnchorError,
  buildTemporalIntegrityAnchorV1,
  civilShift,
  contextCoreCapabilities,
  dayKeyInTz,
  localDayStartMs,
  relativeDateKey,
} from "../src/index.mjs";

const TZ = "America/New_York";
const now = Date.parse("2026-09-29T16:00:00Z");

function external(overrides = {}) {
  return {
    source: "CHAIN_BLOCK_TIMESTAMP:base",
    referenceTimeMs: now - 1_000,
    observedAtMs: now - 1_000,
    maxAgeMs: 5_000,
    maxDriftMs: 2_000,
    ...overrides,
  };
}

function expectCode(fn, code) {
  assert.throws(
    fn,
    error =>
      error instanceof TemporalAnchorError &&
      error.code === code
  );
}

test("explicit clock + timezone builds canonical civil-date anchor without reading runtime time", () => {
  const anchor = buildTemporalIntegrityAnchorV1({
    timezone: TZ,
    nowMs: now,
  });

  assert.deepEqual(
    {
      schemaVersion: anchor.schemaVersion,
      nowMs: anchor.nowMs,
      observedAtMs: anchor.observedAtMs,
      timezone: anchor.timezone,
      localDate: anchor.localDate,
      source: anchor.source,
      evidenceState: anchor.evidenceState,
      todayKey: anchor.todayKey,
      yesterdayKey: anchor.yesterdayKey,
      tomorrowKey: anchor.tomorrowKey,
    },
    {
      schemaVersion: "TEMPORAL_ANCHOR_V1",
      nowMs: now,
      observedAtMs: now,
      timezone: TZ,
      localDate: "2026-09-29",
      source: "SYSTEM_WALL_CLOCK",
      evidenceState: "LOCAL_ONLY",
      todayKey: "2026-09-29",
      yesterdayKey: "2026-09-28",
      tomorrowKey: "2026-09-30",
    }
  );
  assert.equal(Object.isFrozen(anchor), true);
});

test("external evidence preserves donor consistent stale drift and future-observation classifications", () => {
  assert.equal(
    buildTemporalIntegrityAnchorV1({
      timezone: TZ,
      nowMs: now,
      externalEvidence: external(),
    }).evidenceState,
    "EXTERNAL_CONSISTENT"
  );

  assert.equal(
    buildTemporalIntegrityAnchorV1({
      timezone: TZ,
      nowMs: now,
      externalEvidence: external({
        observedAtMs: now - 10_000,
        referenceTimeMs: now - 10_000,
      }),
    }).evidenceState,
    "EXTERNAL_STALE"
  );

  assert.equal(
    buildTemporalIntegrityAnchorV1({
      timezone: TZ,
      nowMs: now,
      externalEvidence: external({
        referenceTimeMs: now - 20_000,
      }),
    }).evidenceState,
    "CLOCK_DRIFT"
  );

  assert.equal(
    buildTemporalIntegrityAnchorV1({
      timezone: TZ,
      nowMs: now,
      externalEvidence: external({
        observedAtMs: now + 1_000,
        referenceTimeMs: now + 1_000,
      }),
    }).evidenceState,
    "CLOCK_DRIFT"
  );
});

test("backward wall clock outranks valid external evidence while malformed evidence still fails closed first", () => {
  const backward = buildTemporalIntegrityAnchorV1({
    timezone: TZ,
    nowMs: now,
    previousNowMs: now + 5_000,
    externalEvidence: external(),
  });
  assert.equal(backward.evidenceState, "BACKWARD_WALL_CLOCK");

  expectCode(
    () =>
      buildTemporalIntegrityAnchorV1({
        timezone: TZ,
        nowMs: now,
        previousNowMs: now + 5_000,
        externalEvidence: {
          ...external(),
          source: "",
        },
      }),
    "TEMPORAL_INVALID_EXTERNAL_SOURCE"
  );
});

test("civil-date helpers preserve timezone and DST-safe donor semantics", () => {
  const beforeDst = Date.parse("2026-03-08T16:00:00Z");

  assert.equal(dayKeyInTz(TZ, beforeDst), "2026-03-08");
  assert.equal(civilShift("2026-03-08", 1), "2026-03-09");
  assert.equal(relativeDateKey(TZ, beforeDst, -1), "2026-03-07");

  const start = localDayStartMs(TZ, beforeDst);
  assert.equal(dayKeyInTz(TZ, start), "2026-03-08");
});

test("invalid timezone epoch and external numeric policy fail closed", () => {
  expectCode(
    () =>
      buildTemporalIntegrityAnchorV1({
        timezone: "Not/AZone",
        nowMs: now,
      }),
    "TEMPORAL_INVALID_TIMEZONE"
  );

  expectCode(
    () =>
      buildTemporalIntegrityAnchorV1({
        timezone: TZ,
        nowMs: Number.NaN,
      }),
    "TEMPORAL_INVALID_EPOCH"
  );

  expectCode(
    () =>
      buildTemporalIntegrityAnchorV1({
        timezone: TZ,
        nowMs: now,
        externalEvidence: external({
          maxAgeMs: -1,
        }),
      }),
    "TEMPORAL_INVALID_EXTERNAL_MAX_AGE"
  );
});

test("exact anchor inputs refuse getters symbols hidden extras and coercion without invoking caller code", () => {
  let getterInvoked = false;
  const hostile = {
    timezone: TZ,
  };
  Object.defineProperty(hostile, "nowMs", {
    enumerable: true,
    get() {
      getterInvoked = true;
      return now;
    },
  });

  expectCode(
    () => buildTemporalIntegrityAnchorV1(hostile),
    "TEMPORAL_INVALID_SHAPE"
  );
  assert.equal(getterInvoked, false);

  const symbolInput = {
    timezone: TZ,
    nowMs: now,
  };
  symbolInput[Symbol("extra")] = true;
  expectCode(
    () => buildTemporalIntegrityAnchorV1(symbolInput),
    "TEMPORAL_INVALID_SHAPE"
  );

  const hidden = {
    timezone: TZ,
    nowMs: now,
  };
  Object.defineProperty(hidden, "hidden", {
    enumerable: false,
    value: true,
  });
  expectCode(
    () => buildTemporalIntegrityAnchorV1(hidden),
    "TEMPORAL_INVALID_SHAPE"
  );

  let coerced = false;
  const disguised = {
    valueOf() {
      coerced = true;
      return now;
    },
  };
  expectCode(
    () =>
      buildTemporalIntegrityAnchorV1({
        timezone: TZ,
        nowMs: disguised,
      }),
    "TEMPORAL_INVALID_EPOCH"
  );
  assert.equal(coerced, false);
});

test("external evidence is copied and frozen rather than retaining caller object", () => {
  const supplied = external();
  const anchor = buildTemporalIntegrityAnchorV1({
    timezone: TZ,
    nowMs: now,
    externalEvidence: supplied,
  });

  assert.notEqual(anchor.externalEvidence, supplied);
  assert.equal(Object.isFrozen(anchor.externalEvidence), true);
});

test("shared temporal anchor has no clock acquisition process state I-O prompt or execution seam", () => {
  const source = readFileSync(
    new URL("../src/temporal-anchor.mjs", import.meta.url),
    "utf8"
  );

  for (const forbidden of [
    "Date.now",
    "process.",
    "node:fs",
    "node:child_process",
    "fetch(",
    "Config",
    "systemPrompt",
    "## NOW",
    "wallet",
    "trade",
    "execute",
    "append",
    "writeFile",
  ]) {
    assert.equal(
      source.includes(forbidden),
      false,
      `unexpected temporal-anchor capability: ${forbidden}`
    );
  }

  const capabilities = contextCoreCapabilities();
  assert.equal(capabilities.modelCalls, false);
  assert.equal(capabilities.networkAccess, false);
  assert.equal(capabilities.walletAccess, false);
  assert.equal(capabilities.tradeExecution, false);
  assert.equal(capabilities.authorityGrants, false);
});
