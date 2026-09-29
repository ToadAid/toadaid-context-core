import test from "node:test";
import assert from "node:assert/strict";
import {
  readFileSync,
} from "node:fs";

import {
  TemporalShapeError,
  contextCoreCapabilities,
  validateTemporalEventTime,
  validateTemporalInstant,
  validateTemporalValidity,
} from "../src/index.mjs";

function expectCode(fn, code) {
  assert.throws(
    fn,
    error =>
      error instanceof
        TemporalShapeError &&
      error.code === code
  );
}

test(
  "temporal instants preserve explicit KNOWN and UNKNOWN without coercion",
  () => {
    assert.deepEqual(
      validateTemporalInstant({
        kind: "KNOWN",
        at: 1_700_000_000_000,
      }),
      {
        kind: "KNOWN",
        at: 1_700_000_000_000,
      }
    );
    assert.deepEqual(
      validateTemporalInstant({
        kind: "UNKNOWN",
      }),
      { kind: "UNKNOWN" }
    );

    for (const at of [
      -1,
      Number.MAX_SAFE_INTEGER + 1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      "1700000000000",
      true,
    ]) {
      expectCode(
        () =>
          validateTemporalInstant({
            kind: "KNOWN",
            at,
          }),
        "INVALID_TEMPORAL_INSTANT"
      );
    }

    let coerced = false;
    const disguised = {
      toString() {
        coerced = true;
        return "1700000000000";
      },
    };
    expectCode(
      () =>
        validateTemporalInstant({
          kind: "KNOWN",
          at: disguised,
        }),
      "INVALID_TEMPORAL_INSTANT"
    );
    assert.equal(coerced, false);
  }
);

test(
  "exact temporal shapes refuse accessors, symbol keys, and hidden fields without invoking getters",
  () => {
    let kindGetterInvoked = false;
    const accessorKind = {};
    Object.defineProperties(
      accessorKind,
      {
        kind: {
          enumerable: true,
          get() {
            kindGetterInvoked = true;
            return "KNOWN";
          },
        },
        at: {
          enumerable: true,
          value: 101,
        },
      }
    );

    expectCode(
      () =>
        validateTemporalInstant(
          accessorKind
        ),
      "INVALID_TEMPORAL_INSTANT"
    );
    assert.equal(
      kindGetterInvoked,
      false
    );

    let atGetterInvoked = false;
    const accessorAt = {
      kind: "KNOWN",
    };
    Object.defineProperty(
      accessorAt,
      "at",
      {
        enumerable: true,
        get() {
          atGetterInvoked = true;
          return 101;
        },
      }
    );

    expectCode(
      () =>
        validateTemporalInstant(
          accessorAt
        ),
      "INVALID_TEMPORAL_INSTANT"
    );
    assert.equal(
      atGetterInvoked,
      false
    );

    const hiddenExtra = {
      kind: "KNOWN",
      at: 101,
    };
    Object.defineProperty(
      hiddenExtra,
      "hidden",
      {
        enumerable: false,
        value: true,
      }
    );
    expectCode(
      () =>
        validateTemporalInstant(
          hiddenExtra
        ),
      "INVALID_TEMPORAL_INSTANT"
    );

    const symbolExtra = {
      kind: "POINT",
      at: 101,
    };
    symbolExtra[
      Symbol("extra")
    ] = true;
    expectCode(
      () =>
        validateTemporalEventTime(
          symbolExtra
        ),
      "INVALID_TEMPORAL_EVENT_TIME"
    );

    const hiddenRequired = {
      kind: "POINT",
    };
    Object.defineProperty(
      hiddenRequired,
      "at",
      {
        enumerable: false,
        value: 101,
      }
    );
    expectCode(
      () =>
        validateTemporalValidity(
          hiddenRequired
        ),
      "INVALID_TEMPORAL_VALIDITY"
    );
  }
);

test(
  "event time accepts only exact POINT, INTERVAL, or UNKNOWN shapes",
  () => {
    assert.deepEqual(
      validateTemporalEventTime({
        kind: "POINT",
        at: 101,
      }),
      { kind: "POINT", at: 101 }
    );
    assert.deepEqual(
      validateTemporalEventTime({
        kind: "INTERVAL",
        startAt: 101,
        endAt: 202,
      }),
      {
        kind: "INTERVAL",
        startAt: 101,
        endAt: 202,
      }
    );
    assert.deepEqual(
      validateTemporalEventTime({
        kind: "INTERVAL",
        startAt: 101,
        endAt: null,
      }),
      {
        kind: "INTERVAL",
        startAt: 101,
        endAt: null,
      }
    );
    assert.deepEqual(
      validateTemporalEventTime({
        kind: "UNKNOWN",
      }),
      { kind: "UNKNOWN" }
    );

    for (const malformed of [
      {
        kind: "INTERVAL",
        startAt: 202,
        endAt: 101,
      },
      { kind: "POINT" },
      {
        kind: "POINT",
        at: 101,
        extra: true,
      },
      null,
      [],
    ]) {
      expectCode(
        () =>
          validateTemporalEventTime(
            malformed
          ),
        "INVALID_TEMPORAL_EVENT_TIME"
      );
    }
  }
);

test(
  "validity remains a point/interval shape rather than UNKNOWN or freshness policy",
  () => {
    assert.deepEqual(
      validateTemporalValidity({
        kind: "POINT",
        at: 303,
      }),
      { kind: "POINT", at: 303 }
    );
    assert.deepEqual(
      validateTemporalValidity({
        kind: "INTERVAL",
        startAt: 303,
        endAt: null,
      }),
      {
        kind: "INTERVAL",
        startAt: 303,
        endAt: null,
      }
    );

    for (const malformed of [
      { kind: "UNKNOWN" },
      {
        kind: "INTERVAL",
        startAt: 304,
        endAt: 303,
      },
      {
        kind: "POINT",
        at: 303,
        maxAgeMs: 60_000,
      },
      {},
    ]) {
      expectCode(
        () =>
          validateTemporalValidity(
            malformed
          ),
        "INVALID_TEMPORAL_VALIDITY"
      );
    }
  }
);

test(
  "validated values are canonical frozen copies and deterministic",
  () => {
    const input = {
      kind: "INTERVAL",
      startAt: 7,
      endAt: 9,
    };
    const first =
      validateTemporalEventTime(input);
    const second =
      validateTemporalEventTime({
        endAt: 9,
        kind: "INTERVAL",
        startAt: 7,
      });

    assert.notEqual(first, input);
    assert.equal(
      Object.isFrozen(first),
      true
    );
    assert.deepEqual(first, second);
    assert.equal(
      JSON.stringify(first),
      JSON.stringify(second)
    );

    input.startAt = 0;
    assert.equal(first.startAt, 7);
    assert.throws(
      () => {
        first.startAt = 0;
      },
      TypeError
    );
  }
);

test(
  "representative Trading Desk temporal vectors retain exactly their existing meaning",
  () => {
    const vectors = {
      receiptKnown: {
        kind: "KNOWN",
        at: 1_726_000_000_020,
      },
      recordingUnknown: {
        kind: "UNKNOWN",
      },
      eventUnknown: {
        kind: "UNKNOWN",
      },
      observationPoint: {
        kind: "POINT",
        at: 1_726_000_000_000,
      },
      validityPoint: {
        kind: "POINT",
        at: 1_726_000_000_000,
      },
      openEvent: {
        kind: "INTERVAL",
        startAt: 1_726_000_000_000,
        endAt: null,
      },
    };

    assert.deepEqual(
      validateTemporalInstant(
        vectors.receiptKnown
      ),
      vectors.receiptKnown
    );
    assert.deepEqual(
      validateTemporalInstant(
        vectors.recordingUnknown
      ),
      vectors.recordingUnknown
    );
    assert.deepEqual(
      validateTemporalEventTime(
        vectors.eventUnknown
      ),
      vectors.eventUnknown
    );
    assert.deepEqual(
      validateTemporalEventTime(
        vectors.observationPoint
      ),
      vectors.observationPoint
    );
    assert.deepEqual(
      validateTemporalEventTime(
        vectors.openEvent
      ),
      vectors.openEvent
    );
    assert.deepEqual(
      validateTemporalValidity(
        vectors.validityPoint
      ),
      vectors.validityPoint
    );
  }
);

test(
  "the temporal module has no clock, I/O, freshness, or authority capability",
  () => {
    const source = readFileSync(
      new URL(
        "../src/temporal.mjs",
        import.meta.url
      ),
      "utf8"
    );

    for (const forbidden of [
      "Date.now",
      "new Date",
      "performance.now",
      "node:fs",
      "node:http",
      "node:https",
      "fetch(",
      "maxAgeMs",
      "sourceFreshness",
      "authorityGranted",
    ]) {
      assert.equal(
        source.includes(forbidden),
        false,
        `unexpected temporal capability: ${forbidden}`
      );
    }

    const capabilities =
      contextCoreCapabilities();
    assert.equal(
      capabilities.modelCalls,
      false
    );
    assert.equal(
      capabilities.networkAccess,
      false
    );
    assert.equal(
      capabilities.walletAccess,
      false
    );
    assert.equal(
      capabilities.tradeExecution,
      false
    );
    assert.equal(
      capabilities.authorityGrants,
      false
    );
  }
);

test(
  "public package self-reference exposes the temporal runtime contract",
  async () => {
    const api = await import(
      "@toadaid/context-core"
    );

    assert.equal(
      api.validateTemporalInstant,
      validateTemporalInstant
    );
    assert.equal(
      api.validateTemporalEventTime,
      validateTemporalEventTime
    );
    assert.equal(
      api.validateTemporalValidity,
      validateTemporalValidity
    );
    assert.equal(
      api.TemporalShapeError,
      TemporalShapeError
    );

    const declarations = readFileSync(
      new URL(
        "../src/index.d.ts",
        import.meta.url
      ),
      "utf8"
    );
    for (const name of [
      "TemporalInstant",
      "TemporalEventTime",
      "TemporalValidity",
      "TemporalShapeError",
      "validateTemporalInstant",
      "validateTemporalEventTime",
      "validateTemporalValidity",
    ]) {
      assert.match(
        declarations,
        new RegExp(`\\b${name}\\b`),
        `missing public declaration ${name}`
      );
    }
  }
);
