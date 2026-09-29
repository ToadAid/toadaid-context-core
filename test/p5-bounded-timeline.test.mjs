import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BOUNDED_TIMELINE_SCHEMA_VERSION,
  BoundedTimelineError,
  contextCoreCapabilities,
  queryBoundedTimelineV1,
} from "../src/index.mjs";

const id = digit => digit.repeat(64);
const event = (knownAt, digit, { observedAt = knownAt, occurredAt = knownAt } = {}) => ({
  eventId: id(digit),
  knownAt,
  observedAt,
  occurredAt,
});
const healthy = sourceRows => ({ sourceRows, corruptRows: 0, invalidRows: 0 });

function expectInvalid(fn, pattern) {
  assert.throws(
    fn,
    error =>
      error instanceof BoundedTimelineError &&
      error.code === "INVALID_BOUNDED_TIMELINE_QUERY" &&
      (pattern === undefined || pattern.test(error.message))
  );
}

test("bounded timeline preserves donor BETWEEN, RECENT pagination, and cap truth", () => {
  const values = [event(300, "3"), event(100, "1"), event(200, "2")];
  const between = queryBoundedTimelineV1(
    values,
    { kind: "BETWEEN", fromMs: 100, toMs: 200, limit: 10 },
    healthy(3)
  );
  assert.equal(between.schemaVersion, BOUNDED_TIMELINE_SCHEMA_VERSION);
  assert.equal(between.artifact, "BoundedTimelineResultV1");
  assert.equal(between.status, "COMPLETE");
  assert.deepEqual(between.events.map(row => row.knownAt), [100, 200]);
  assert.equal(between.matchedCount, 2);
  assert.equal(between.truncated, false);
  assert.equal(between.authorityGranted, false);

  const first = queryBoundedTimelineV1(values, { kind: "RECENT", limit: 2 }, healthy(3));
  assert.equal(first.status, "TRUNCATED");
  assert.deepEqual(first.events.map(row => row.knownAt), [200, 300]);
  assert.deepEqual(first.nextCursor, { eventId: first.events[0].eventId, sourceRows: 3 });

  const second = queryBoundedTimelineV1(
    values,
    { kind: "RECENT", limit: 2, cursor: first.nextCursor },
    healthy(3)
  );
  assert.equal(second.status, "COMPLETE");
  assert.deepEqual(second.events.map(row => row.knownAt), [100]);
  assert.equal(second.nextCursor, null);
});

test("source snapshot continuation fails closed on append or backdated append", () => {
  const firstThree = [event(100, "1"), event(200, "2"), event(300, "3")];
  const first = queryBoundedTimelineV1(firstThree, { kind: "RECENT", limit: 2 }, healthy(3));
  const appended = queryBoundedTimelineV1(
    [...firstThree, event(400, "4")],
    { kind: "RECENT", limit: 2, cursor: first.nextCursor },
    healthy(4)
  );
  assert.deepEqual(
    {
      status: appended.status,
      continuation: appended.continuation,
      returnedCount: appended.returnedCount,
      nextCursor: appended.nextCursor,
      events: appended.events,
    },
    {
      status: "INCOMPLETE",
      continuation: "SOURCE_CHANGED",
      returnedCount: 0,
      nextCursor: null,
      events: [],
    }
  );

  const forward = queryBoundedTimelineV1(
    firstThree,
    { kind: "BETWEEN", fromMs: 0, toMs: 1000, limit: 2 },
    healthy(3)
  );
  const backdated = queryBoundedTimelineV1(
    [...firstThree, event(150, "4")],
    { kind: "BETWEEN", fromMs: 0, toMs: 1000, limit: 2, cursor: forward.nextCursor },
    healthy(4)
  );
  assert.equal(backdated.status, "INCOMPLETE");
  assert.equal(backdated.continuation, "SOURCE_CHANGED");
  assert.deepEqual(backdated.events, []);
});

test("LATEST_BEFORE is strict and RELATIVE_TO_ANCHOR is inclusive at the anchor", () => {
  const values = [event(100, "1"), event(150, "2"), event(200, "3"), event(210, "4"), event(300, "5")];
  const latest = queryBoundedTimelineV1(values, { kind: "LATEST_BEFORE", beforeMs: 300 }, healthy(5));
  assert.deepEqual(latest.events.map(row => row.knownAt), [210]);
  const relative = queryBoundedTimelineV1(
    values,
    { kind: "RELATIVE_TO_ANCHOR", anchorMs: 200, lookbackMs: 60, limit: 10 },
    healthy(5)
  );
  assert.deepEqual(relative.events.map(row => row.knownAt), [150, 200]);
});

test("INCOMPLETE outranks truncation and UNAVAILABLE never invents empty complete history", () => {
  const incomplete = queryBoundedTimelineV1(
    [event(100, "1"), event(200, "2")],
    { kind: "RECENT", limit: 1 },
    { sourceRows: 4, corruptRows: 1, invalidRows: 1 }
  );
  assert.equal(incomplete.status, "INCOMPLETE");
  assert.equal(incomplete.truncated, true);

  const unavailable = queryBoundedTimelineV1(
    [],
    { kind: "RECENT", limit: 10 },
    { sourceRows: 0, corruptRows: 0, invalidRows: 0, unavailableReason: "read failed" }
  );
  assert.equal(unavailable.status, "UNAVAILABLE");
  assert.deepEqual(unavailable.events, []);
  assert.equal(unavailable.matchedCount, 0);
});

test("canonical ordering matches knownAt, observedAt, occurredAt, eventId donor law", () => {
  const values = [
    event(100, "4", { observedAt: 100, occurredAt: null }),
    event(100, "3", { observedAt: 100, occurredAt: 90 }),
    event(100, "2", { observedAt: 90, occurredAt: 80 }),
    event(100, "1", { observedAt: 90, occurredAt: 80 }),
  ];
  const result = queryBoundedTimelineV1(
    values,
    { kind: "BETWEEN", fromMs: 0, toMs: 200, limit: 10 },
    healthy(4)
  );
  assert.deepEqual(result.events.map(row => row.eventId), [id("1"), id("2"), id("3"), id("4")]);
});

test("cursor must belong to the matched bounded timeline", () => {
  const outside = event(50, "1");
  expectInvalid(
    () => queryBoundedTimelineV1(
      [outside, event(200, "2")],
      {
        kind: "BETWEEN",
        fromMs: 100,
        toMs: 300,
        limit: 1,
        cursor: { eventId: outside.eventId, sourceRows: 2 },
      },
      healthy(2)
    ),
    /cursor eventId is absent/
  );
});

test("exact public shapes refuse accessors, symbols, hidden fields, and coercion without invoking getters", () => {
  let getterInvoked = false;
  const hostileEvent = { eventId: id("1"), observedAt: 1, occurredAt: 1 };
  Object.defineProperty(hostileEvent, "knownAt", {
    enumerable: true,
    get() {
      getterInvoked = true;
      return 1;
    },
  });
  expectInvalid(
    () => queryBoundedTimelineV1([hostileEvent], { kind: "RECENT", limit: 1 }, healthy(1)),
    /enumerable data property/
  );
  assert.equal(getterInvoked, false);

  const symbolQuery = { kind: "RECENT", limit: 1 };
  symbolQuery[Symbol("extra")] = true;
  expectInvalid(() => queryBoundedTimelineV1([], symbolQuery, healthy(0)), /symbol keys/);

  const hiddenIntegrity = { sourceRows: 0, corruptRows: 0, invalidRows: 0 };
  Object.defineProperty(hiddenIntegrity, "hidden", { enumerable: false, value: true });
  expectInvalid(
    () => queryBoundedTimelineV1([], { kind: "RECENT", limit: 1 }, hiddenIntegrity),
    /must contain exactly/
  );

  let coerced = false;
  const disguised = { valueOf() { coerced = true; return 1; } };
  expectInvalid(
    () => queryBoundedTimelineV1([], { kind: "RECENT", limit: disguised }, healthy(0)),
    /limit must be an integer/
  );
  assert.equal(coerced, false);
});

test("canonical outputs are frozen copies and input objects are not reused", () => {
  const sourceEvent = event(100, "1");
  const query = { kind: "RECENT", limit: 1 };
  const integrity = healthy(1);
  const result = queryBoundedTimelineV1([sourceEvent], query, integrity);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.query), true);
  assert.equal(Object.isFrozen(result.source), true);
  assert.equal(Object.isFrozen(result.events), true);
  assert.equal(Object.isFrozen(result.events[0]), true);
  assert.notEqual(result.query, query);
  assert.notEqual(result.source, integrity);
  assert.notEqual(result.events[0], sourceEvent);
});

test("shared bounded timeline is capability-neutral and has no clock, I/O, persistence, or execution seam", () => {
  const source = readFileSync(new URL("../src/bounded-timeline.mjs", import.meta.url), "utf8");
  for (const forbidden of [
    "node:fs",
    "node:child_process",
    "fetch(",
    "Date.now",
    "process.",
    "wallet",
    "trade",
    "execute",
    "append",
    "writeFile",
  ]) {
    assert.equal(source.includes(forbidden), false, `unexpected bounded-timeline capability: ${forbidden}`);
  }
  const capabilities = contextCoreCapabilities();
  assert.equal(capabilities.modelCalls, false);
  assert.equal(capabilities.networkAccess, false);
  assert.equal(capabilities.walletAccess, false);
  assert.equal(capabilities.tradeExecution, false);
  assert.equal(capabilities.authorityGrants, false);
});
