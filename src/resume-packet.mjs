import {
  ContextBudgetExceeded,
  ContextCoreError,
} from "./types.mjs";
import { ContextEventKind } from "./session-events.mjs";

const serializedBytes = value =>
  Buffer.byteLength(
    JSON.stringify(value),
    "utf8"
  );

function stabilizeUsedBytes(packet) {
  let usedBytes = 0;

  for (let attempt = 0; attempt < 16; attempt += 1) {
    const candidate = {
      ...packet,
      usedBytes,
    };
    const measured =
      serializedBytes(candidate);

    if (measured === usedBytes) {
      return candidate;
    }

    usedBytes = measured;
  }

  throw new ContextCoreError(
    "resume packet usedBytes did not stabilize"
  );
}

function requireJournal(journal) {
  if (
    !journal ||
    typeof journal.getSessionHead !==
      "function" ||
    typeof journal.listSession !==
      "function"
  ) {
    throw new ContextCoreError(
      "journal must expose getSessionHead() and listSession()"
    );
  }
}

function positiveInteger(
  value,
  label,
  minimum = 1
) {
  if (
    !Number.isInteger(value) ||
    value < minimum
  ) {
    throw new ContextCoreError(
      `${label} must be an integer >= ${minimum}`
    );
  }

  return value;
}

function normalizedStatus(event) {
  const value =
    event?.data?.status;

  if (
    typeof value !== "string" ||
    value.trim().length === 0
  ) {
    return "open";
  }

  return value
    .trim()
    .normalize("NFKC")
    .toLowerCase();
}

function lifecycleKey(event) {
  const value =
    event?.data?.lifecycleKey;

  if (
    typeof value === "string" &&
    value.trim().length > 0
  ) {
    return value;
  }

  return event.eventId;
}

function resolveLifecycle(
  events,
  kind,
  closedStatuses
) {
  const latestByKey = new Map();

  for (const event of events) {
    if (event.kind !== kind) continue;

    latestByKey.set(
      lifecycleKey(event),
      event
    );
  }

  return [...latestByKey.values()]
    .filter(
      event =>
        !closedStatuses.has(
          normalizedStatus(event)
        )
    )
    .sort(
      (a, b) =>
        b.importance -
          a.importance ||
        b.sequence -
          a.sequence ||
        a.eventId.localeCompare(
          b.eventId
        )
    );
}

function latestEvent(events, kind) {
  for (
    let index = events.length - 1;
    index >= 0;
    index -= 1
  ) {
    if (events[index].kind === kind) {
      return events[index];
    }
  }

  return null;
}

function recentEvents(
  events,
  kind,
  limit
) {
  const output = [];

  for (
    let index = events.length - 1;
    index >= 0 &&
      output.length < limit;
    index -= 1
  ) {
    if (events[index].kind === kind) {
      output.push(events[index]);
    }
  }

  return output;
}

function activeFiles(
  events,
  limit
) {
  const output = [];
  const seen = new Set();

  for (
    let index = events.length - 1;
    index >= 0 &&
      output.length < limit;
    index -= 1
  ) {
    const event = events[index];

    if (
      event.kind !==
        ContextEventKind.FILE_READ &&
      event.kind !==
        ContextEventKind.FILE_EDIT
    ) {
      continue;
    }

    const path =
      event?.data?.path;

    if (
      typeof path !== "string" ||
      path.length === 0 ||
      seen.has(path)
    ) {
      continue;
    }

    seen.add(path);

    output.push(
      Object.freeze({
        path,
        eventId: event.eventId,
        sequence: event.sequence,
        kind: event.kind,
        timestamp: event.timestamp,
      })
    );
  }

  return output;
}

function renderEvent(event) {
  return Object.freeze({
    eventId: event.eventId,
    sequence: event.sequence,
    kind: event.kind,
    timestamp: event.timestamp,
    source: event.source,
    project: event.project,
    repo: event.repo,
    attribution: event.attribution,
    importance: event.importance,
    text: event.text,
    tags: event.tags,
    rawRef: event.rawRef,
    memoryRefs: event.memoryRefs,
    data: event.data,
  });
}

function evidenceFor(event) {
  return event.exactEvidence.map(
    evidence =>
      Object.freeze({
        eventId: event.eventId,
        sequence: event.sequence,
        label: evidence.label,
        value: evidence.value,
      })
  );
}

function snapshotReference(head) {
  return Object.freeze({
    sessionId: head.sessionId,
    lastSequence:
      head.lastSequence,
    lastDigest:
      head.lastDigest,
  });
}

function eventReference(event) {
  return Object.freeze({
    eventId: event.eventId,
    sequence: event.sequence,
    eventDigest:
      event.eventDigest,
    kind: event.kind,
  });
}

function exactEvidenceReference(
  event,
  evidence
) {
  return Object.freeze({
    eventId: event.eventId,
    sequence: event.sequence,
    eventDigest:
      event.eventDigest,
    label: evidence.label,
  });
}

function buildOmissionManifest(
  events,
  head,
  {
    bodyAlwaysInlineEventIds,
    evidenceAlwaysInlineEventIds,
  }
) {
  const eventRefs = [];
  const evidenceRefs = [];

  for (const event of events) {
    if (
      !bodyAlwaysInlineEventIds.has(
        event.eventId
      )
    ) {
      eventRefs.push(
        eventReference(event)
      );
    }

    if (
      evidenceAlwaysInlineEventIds.has(
        event.eventId
      )
    ) {
      continue;
    }

    for (
      const evidence of
      event.exactEvidence
    ) {
      evidenceRefs.push(
        exactEvidenceReference(
          event,
          evidence
        )
      );
    }
  }

  return {
    snapshot:
      snapshotReference(head),
    events: eventRefs,
    exactEvidence:
      evidenceRefs,
  };
}

function admitEventFromManifest(
  manifest,
  event,
  {
    includeEvidence,
  }
) {
  return {
    ...manifest,
    events:
      manifest.events.filter(
        reference =>
          reference.eventId !==
          event.eventId
      ),
    exactEvidence:
      includeEvidence
        ? manifest.exactEvidence
            .filter(
              reference =>
                reference.eventId !==
                event.eventId
            )
        : manifest.exactEvidence,
  };
}

function buildReferences(events) {
  const output = [];
  const seen = new Set();

  for (
    let index = events.length - 1;
    index >= 0;
    index -= 1
  ) {
    const event = events[index];

    if (event.rawRef) {
      const key =
        `raw\0${event.rawRef}`;

      if (!seen.has(key)) {
        seen.add(key);
        output.push(
          Object.freeze({
            type: "raw",
            ref: event.rawRef,
            eventId: event.eventId,
            sequence: event.sequence,
            kind: event.kind,
          })
        );
      }
    }

    for (
      const memoryRef of
      event.memoryRefs
    ) {
      const key =
        `memory\0${memoryRef}`;

      if (!seen.has(key)) {
        seen.add(key);
        output.push(
          Object.freeze({
            type: "memory",
            ref: memoryRef,
            eventId: event.eventId,
            sequence: event.sequence,
            kind: event.kind,
          })
        );
      }
    }
  }

  return output;
}

function withEventEvidence(
  packet,
  event
) {
  const evidence =
    evidenceFor(event);

  return {
    packet: {
      ...packet,
      exactEvidence: [
        ...packet.exactEvidence,
        ...evidence,
      ],
      omitted: {
        ...packet.omitted,
        exactEvidence:
          packet.omitted
            .exactEvidence -
          evidence.length,
      },
    },
    evidenceCount:
      evidence.length,
  };
}

function tryScalarEvent(
  packet,
  section,
  event,
  maxBytes
) {
  if (!event) return packet;

  const withEvidence =
    withEventEvidence(
      {
        ...packet,
        [section]:
          renderEvent(event),
        omitted: {
          ...packet.omitted,
          [section]:
            packet.omitted[section] -
            1,
        },
      },
      event
    ).packet;

  const finalized =
    stabilizeUsedBytes(
      withEvidence
    );

  if (
    serializedBytes(finalized) <=
    maxBytes
  ) {
    return finalized;
  }

  return packet;
}

function requireScalarEvent(
  packet,
  section,
  event,
  maxBytes
) {
  if (!event) return packet;

  const candidate =
    tryScalarEvent(
      packet,
      section,
      event,
      maxBytes
    );

  if (
    candidate[section] === null
  ) {
    const evidenceBytes =
      evidenceFor(event)
        .reduce(
          (total, item) =>
            total +
            serializedBytes(item),
          0
        );

    throw new ContextBudgetExceeded(
      `resume packet cannot fit mandatory ${section} and its exact evidence within ${maxBytes} bytes; evidenceBytes=${evidenceBytes}`
    );
  }

  return candidate;
}

function tryEventList(
  packet,
  section,
  events,
  maxBytes,
  {
    includeEvidence = true,
  } = {}
) {
  let current = packet;

  for (const event of events) {
    const evidence =
      includeEvidence
        ? evidenceFor(event)
        : [];

    const candidate =
      stabilizeUsedBytes({
        ...current,
        [section]: [
          ...current[section],
          renderEvent(event),
        ],
        exactEvidence: [
          ...current.exactEvidence,
          ...evidence,
        ],
        omissionManifest:
          admitEventFromManifest(
            current.omissionManifest,
            event,
            {
              includeEvidence,
            }
          ),
        omitted: {
          ...current.omitted,
          [section]:
            current.omitted[section] -
            1,
          exactEvidence:
            current.omitted
              .exactEvidence -
            evidence.length,
        },
      });

    if (
      serializedBytes(candidate) <=
      maxBytes
    ) {
      current = candidate;
    }
  }

  return current;
}

function requireEventEvidence(
  packet,
  events,
  maxBytes,
  label
) {
  let current = packet;

  for (const event of events) {
    const evidence =
      evidenceFor(event);

    if (evidence.length === 0) {
      continue;
    }

    const candidate =
      stabilizeUsedBytes({
        ...current,
        exactEvidence: [
          ...current.exactEvidence,
          ...evidence,
        ],
        omitted: {
          ...current.omitted,
          exactEvidence:
            current.omitted
              .exactEvidence -
            evidence.length,
        },
      });

    const measured =
      serializedBytes(candidate);

    if (measured > maxBytes) {
      const evidenceBytes =
        evidence.reduce(
          (total, item) =>
            total +
            serializedBytes(item),
          0
        );

      throw new ContextBudgetExceeded(
        `resume packet cannot fit mandatory ${label} exact evidence within ${maxBytes} bytes; eventId=${event.eventId}; evidenceBytes=${evidenceBytes}`
      );
    }

    current = candidate;
  }

  return current;
}

function tryPlainList(
  packet,
  section,
  items,
  maxBytes
) {
  let current = packet;

  for (const item of items) {
    const candidate =
      stabilizeUsedBytes({
        ...current,
        [section]: [
          ...current[section],
          item,
        ],
        omitted: {
          ...current.omitted,
          [section]:
            current.omitted[section] -
            1,
        },
      });

    if (
      serializedBytes(candidate) <=
      maxBytes
    ) {
      current = candidate;
    }
  }

  return current;
}

function evidenceCount(events) {
  return events.reduce(
    (total, event) =>
      total +
      event.exactEvidence.length,
    0
  );
}

function deepFreeze(value) {
  if (
    value === null ||
    typeof value !== "object" ||
    Object.isFrozen(value)
  ) {
    return value;
  }

  for (
    const child of
    Object.values(value)
  ) {
    deepFreeze(child);
  }

  return Object.freeze(value);
}

export function buildResumePacket(
  journal,
  sessionId,
  {
    maxBytes = 8192,
    maxDecisions = 6,
    maxConstraints = 6,
    maxOpenErrors = 8,
    maxOpenTasks = 10,
    maxActiveFiles = 12,
    maxReferences = 16,
  } = {}
) {
  requireJournal(journal);

  positiveInteger(
    maxBytes,
    "maxBytes",
    512
  );
  positiveInteger(
    maxDecisions,
    "maxDecisions"
  );
  positiveInteger(
    maxConstraints,
    "maxConstraints"
  );
  positiveInteger(
    maxOpenErrors,
    "maxOpenErrors"
  );
  positiveInteger(
    maxOpenTasks,
    "maxOpenTasks"
  );
  positiveInteger(
    maxActiveFiles,
    "maxActiveFiles"
  );
  positiveInteger(
    maxReferences,
    "maxReferences"
  );

  const head =
    journal.getSessionHead(
      sessionId
    );

  const events =
    journal.listSession(
      sessionId,
      {
        limit: Math.max(
          1,
          head.eventCount
        ),
      }
    );

  const currentObjective =
    latestEvent(
      events,
      ContextEventKind.OBJECTIVE
    );

  const gitState =
    latestEvent(
      events,
      ContextEventKind.GIT_STATE
    );

  const allUnresolvedErrors =
    resolveLifecycle(
      events,
      ContextEventKind.ERROR,
      new Set([
        "resolved",
        "closed",
      ])
    );

  const unresolvedErrors =
    allUnresolvedErrors.slice(
      0,
      maxOpenErrors
    );

  const allOpenTasks =
    resolveLifecycle(
      events,
      ContextEventKind.TASK,
      new Set([
        "done",
        "completed",
        "closed",
        "cancelled",
      ])
    );

  const openTasks =
    allOpenTasks.slice(
      0,
      maxOpenTasks
    );

  const allRecentDecisions =
    recentEvents(
      events,
      ContextEventKind.DECISION,
      Math.max(1, head.eventCount)
    );

  const recentDecisions =
    allRecentDecisions.slice(
      0,
      maxDecisions
    );

  const allActiveConstraints =
    resolveLifecycle(
      events,
      ContextEventKind.CONSTRAINT,
      new Set([
        "resolved",
        "closed",
        "superseded",
        "cancelled",
      ])
    );

  const constraints =
    allActiveConstraints.slice(
      0,
      maxConstraints
    );

  const allFiles =
    activeFiles(
      events,
      Math.max(1, head.eventCount)
    );

  const files =
    allFiles.slice(
      0,
      maxActiveFiles
    );

  const allReferences =
    buildReferences(events);

  const references =
    allReferences.slice(
      0,
      maxReferences
    );

  const mandatoryActiveEvidenceEvents = [
    ...allUnresolvedErrors,
    ...allOpenTasks,
    ...allActiveConstraints,
  ];

  const bodyAlwaysInlineEventIds =
    new Set(
      [
        currentObjective,
        gitState,
      ]
        .filter(Boolean)
        .map(
          event => event.eventId
        )
    );

  const evidenceAlwaysInlineEventIds =
    new Set([
      ...bodyAlwaysInlineEventIds,
      ...mandatoryActiveEvidenceEvents
        .map(
          event => event.eventId
        ),
    ]);

  const omissionManifest =
    buildOmissionManifest(
      events,
      head,
      {
        bodyAlwaysInlineEventIds,
        evidenceAlwaysInlineEventIds,
      }
    );

  let packet =
    stabilizeUsedBytes({
      version: 1,
      sessionId:
        head.sessionId,
      budgetBytes: maxBytes,
      usedBytes: 0,
      sourceHead: {
        eventCount:
          head.eventCount,
        lastSequence:
          head.lastSequence,
        lastEventId:
          head.lastEventId,
        lastDigest:
          head.lastDigest,
      },
      currentObjective: null,
      gitState: null,
      unresolvedErrors: [],
      recentDecisions: [],
      openTasks: [],
      constraints: [],
      activeFiles: [],
      references: [],
      exactEvidence: [],
      omissionManifest,
      omitted: {
        currentObjective:
          currentObjective
            ? 1
            : 0,
        gitState:
          gitState
            ? 1
            : 0,
        unresolvedErrors:
          allUnresolvedErrors.length,
        recentDecisions:
          allRecentDecisions.length,
        openTasks:
          allOpenTasks.length,
        constraints:
          allActiveConstraints.length,
        activeFiles:
          allFiles.length,
        references:
          allReferences.length,
        exactEvidence:
          evidenceCount(
            events
          ),
      },
    });

  if (
    serializedBytes(packet) >
    maxBytes
  ) {
    throw new ContextBudgetExceeded(
      `resume packet envelope plus omission recovery truth requires ${serializedBytes(packet)} bytes but budget is ${maxBytes}`
    );
  }

  packet =
    requireScalarEvent(
      packet,
      "currentObjective",
      currentObjective,
      maxBytes
    );

  packet =
    requireScalarEvent(
      packet,
      "gitState",
      gitState,
      maxBytes
    );

  packet =
    requireEventEvidence(
      packet,
      mandatoryActiveEvidenceEvents,
      maxBytes,
      "active continuity"
    );

  packet =
    tryEventList(
      packet,
      "unresolvedErrors",
      unresolvedErrors,
      maxBytes,
      {
        includeEvidence: false,
      }
    );

  packet =
    tryEventList(
      packet,
      "recentDecisions",
      recentDecisions,
      maxBytes
    );

  packet =
    tryEventList(
      packet,
      "openTasks",
      openTasks,
      maxBytes,
      {
        includeEvidence: false,
      }
    );

  packet =
    tryEventList(
      packet,
      "constraints",
      constraints,
      maxBytes,
      {
        includeEvidence: false,
      }
    );

  packet =
    tryPlainList(
      packet,
      "activeFiles",
      files,
      maxBytes
    );

  packet =
    tryPlainList(
      packet,
      "references",
      references,
      maxBytes
    );

  packet =
    stabilizeUsedBytes(
      packet
    );

  const measured =
    serializedBytes(packet);

  if (measured > maxBytes) {
    throw new ContextBudgetExceeded(
      `resume packet exceeded budget (${measured} > ${maxBytes})`
    );
  }

  if (
    packet.usedBytes !==
    measured
  ) {
    throw new ContextCoreError(
      "resume packet usedBytes invariant failed"
    );
  }

  if (
    packet.omitted.exactEvidence !==
    packet.omissionManifest
      .exactEvidence.length
  ) {
    throw new ContextCoreError(
      "resume packet exact-evidence omission identity invariant failed"
    );
  }

  if (
    packet.omissionManifest
      .snapshot.sessionId !==
        packet.sessionId ||
    packet.omissionManifest
      .snapshot.lastSequence !==
        packet.sourceHead.lastSequence ||
    packet.omissionManifest
      .snapshot.lastDigest !==
        packet.sourceHead.lastDigest
  ) {
    throw new ContextCoreError(
      "resume packet omission snapshot binding invariant failed"
    );
  }

  return deepFreeze(packet);
}
