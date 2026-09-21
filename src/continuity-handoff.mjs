import {
  ContextBudgetExceeded,
  ContextCoreError,
} from "./types.mjs";
import { buildResumePacket } from "./resume-packet.mjs";

const serializedText = value =>
  JSON.stringify(value);

const utf8Bytes = text =>
  Buffer.byteLength(
    text,
    "utf8"
  );

const serializedBytes = value =>
  utf8Bytes(
    serializedText(value)
  );

function stabilizeUsedBytes(value) {
  let usedBytes = 0;

  for (
    let attempt = 0;
    attempt < 16;
    attempt += 1
  ) {
    const candidate = {
      ...value,
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
    "continuity handoff usedBytes did not stabilize"
  );
}

function positiveInteger(
  value,
  label,
  minimum
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

function requireSearchable(retrieval) {
  if (
    !retrieval ||
    typeof retrieval.search !==
      "function"
  ) {
    throw new ContextCoreError(
      "retrieval must expose search()"
    );
  }
}

function normalizeQueries(
  retrievalQueries
) {
  if (!Array.isArray(retrievalQueries)) {
    throw new ContextCoreError(
      "retrievalQueries must be an array"
    );
  }

  return retrievalQueries.map(
    (query, index) => {
      if (
        typeof query !== "string" ||
        query.trim().length === 0
      ) {
        throw new ContextCoreError(
          `retrievalQueries[${index}] must be a non-empty string`
        );
      }

      return query;
    }
  );
}

function queryIdentity(
  query,
  index
) {
  return Object.freeze({
    index,
    query,
  });
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

function baseHandoff(
  resumePacket,
  queries,
  totalMaxBytes
) {
  return stabilizeUsedBytes({
    version: 1,
    sessionId:
      resumePacket.sessionId,
    budgetBytes:
      totalMaxBytes,
    usedBytes: 0,
    resumePacket,
    retrievals: [],
    omittedRetrievalQueries:
      queries.length,
    omittedRetrievalQueryItems:
      queries.map(
        (query, index) =>
          queryIdentity(
            query,
            index
          )
      ),
  });
}

function throwOuterBudgetFailure(
  {
    journal,
    sessionId,
    queries,
  },
  {
    totalMaxBytes,
    resumeMaxBytes,
    resumeOptions,
  }
) {
  if (queries.length > 0) {
    try {
      buildResumeBoundToTotal(
        {
          journal,
          sessionId,
          queries: [],
        },
        {
          totalMaxBytes,
          resumeMaxBytes,
          resumeOptions,
        }
      );
    } catch (error) {
      if (
        error instanceof
        ContextBudgetExceeded
      ) {
        throw new ContextBudgetExceeded(
          `continuity handoff cannot fit mandatory ResumePacket and omission recovery truth within ${totalMaxBytes} bytes`
        );
      }

      throw error;
    }

    throw new ContextBudgetExceeded(
      `continuity handoff cannot fit mandatory ResumePacket and retrieval omission identities within ${totalMaxBytes} bytes`
    );
  }

  throw new ContextBudgetExceeded(
    `continuity handoff cannot fit mandatory ResumePacket and omission recovery truth within ${totalMaxBytes} bytes`
  );
}

function buildResumeBoundToTotal(
  {
    journal,
    sessionId,
    queries,
  },
  {
    totalMaxBytes,
    resumeMaxBytes,
    resumeOptions,
  }
) {
  let resumeBudget =
    Math.min(
      resumeMaxBytes,
      totalMaxBytes
    );
  let compactingForOuterBudget =
    false;

  for (
    let attempt = 0;
    attempt < 32;
    attempt += 1
  ) {
    let resumePacket;

    try {
      resumePacket =
        buildResumePacket(
          journal,
          sessionId,
          {
            ...resumeOptions,
            maxBytes:
              resumeBudget,
          }
        );
    } catch (error) {
      if (
        compactingForOuterBudget &&
        error instanceof
          ContextBudgetExceeded
      ) {
        throwOuterBudgetFailure(
          {
            journal,
            sessionId,
            queries,
          },
          {
            totalMaxBytes,
            resumeMaxBytes,
            resumeOptions,
          }
        );
      }

      throw error;
    }

    const handoff =
      baseHandoff(
        resumePacket,
        queries,
        totalMaxBytes
      );

    const measured =
      serializedBytes(handoff);

    if (
      measured <=
      totalMaxBytes
    ) {
      return {
        resumePacket,
        handoff,
      };
    }

    if (resumeBudget <= 512) {
      throwOuterBudgetFailure(
        {
          journal,
          sessionId,
          queries,
        },
        {
          totalMaxBytes,
          resumeMaxBytes,
          resumeOptions,
        }
      );
    }

    const overflow =
      measured -
      totalMaxBytes;

    const nextBudget =
      Math.max(
        512,
        Math.min(
          resumeBudget - 1,
          resumePacket.usedBytes -
            overflow -
            1
        )
      );

    compactingForOuterBudget =
      true;
    resumeBudget =
      nextBudget;
  }

  throw new ContextCoreError(
    "continuity handoff resume compaction did not converge"
  );
}

export function buildContinuityHandoff(
  {
    journal,
    retrieval,
    sessionId,
    retrievalQueries = [],
  },
  {
    totalMaxBytes = 12288,
    resumeMaxBytes = 6144,
    retrievalMaxBytes = 3072,
    retrievalMaxResults = 4,
    retrievalMatch = "all",
    resumeOptions = {},
  } = {}
) {
  requireSearchable(retrieval);

  positiveInteger(
    totalMaxBytes,
    "totalMaxBytes",
    1024
  );
  positiveInteger(
    resumeMaxBytes,
    "resumeMaxBytes",
    512
  );
  positiveInteger(
    retrievalMaxBytes,
    "retrievalMaxBytes",
    128
  );
  positiveInteger(
    retrievalMaxResults,
    "retrievalMaxResults",
    1
  );

  if (
    !["all", "any"].includes(
      retrievalMatch
    )
  ) {
    throw new ContextCoreError(
      'retrievalMatch must be "all" or "any"'
    );
  }

  const queries =
    normalizeQueries(
      retrievalQueries
    );

  let {
    resumePacket,
    handoff,
  } =
    buildResumeBoundToTotal(
      {
        journal,
        sessionId,
        queries,
      },
      {
        totalMaxBytes,
        resumeMaxBytes,
        resumeOptions,
      }
    );

  for (
    const [
      queryIndex,
      query,
    ] of queries.entries()
  ) {
    const response =
      retrieval.search(
        query,
        {
          maxResults:
            retrievalMaxResults,
          maxBytes:
            retrievalMaxBytes,
          match:
            retrievalMatch,
          metadataEquals: {
            sessionId:
              resumePacket.sessionId,
          },
        }
      );

    const candidate =
      stabilizeUsedBytes({
        ...handoff,
        retrievals: [
          ...handoff.retrievals,
          Object.freeze({
            queryIndex,
            query,
            response,
          }),
        ],
        omittedRetrievalQueryItems:
          handoff
            .omittedRetrievalQueryItems
            .filter(
              item =>
                item.index !==
                queryIndex
            ),
        omittedRetrievalQueries:
          handoff
            .omittedRetrievalQueryItems
            .length -
          1,
      });

    if (
      serializedBytes(candidate) <=
      totalMaxBytes
    ) {
      handoff = candidate;
    }
  }

  handoff =
    stabilizeUsedBytes({
      ...handoff,
      omittedRetrievalQueries:
        handoff
          .omittedRetrievalQueryItems
          .length,
    });

  const measured =
    serializedBytes(handoff);

  if (
    measured >
    totalMaxBytes
  ) {
    throw new ContextBudgetExceeded(
      `continuity handoff exceeded budget (${measured} > ${totalMaxBytes})`
    );
  }

  if (
    handoff.usedBytes !==
    measured
  ) {
    throw new ContextCoreError(
      "continuity handoff usedBytes invariant failed"
    );
  }

  if (
    handoff.omittedRetrievalQueries !==
    handoff
      .omittedRetrievalQueryItems
      .length
  ) {
    throw new ContextCoreError(
      "continuity handoff omitted query identity invariant failed"
    );
  }

  return deepFreeze(handoff);
}

export function buildContinuityTransport(
  input,
  options = {}
) {
  const handoff =
    buildContinuityHandoff(
      input,
      options
    );

  const serialized =
    serializedText(handoff);

  const usedBytes =
    utf8Bytes(serialized);

  if (
    handoff.usedBytes !==
    usedBytes
  ) {
    throw new ContextCoreError(
      "continuity transport serialized byte identity invariant failed"
    );
  }

  if (
    usedBytes >
    handoff.budgetBytes
  ) {
    throw new ContextBudgetExceeded(
      `continuity transport exceeded budget (${usedBytes} > ${handoff.budgetBytes})`
    );
  }

  return Object.freeze({
    version: 1,
    kind:
      "CONTINUITY_TRANSPORT",
    mediaType:
      "application/json",
    encoding:
      "utf-8",
    budgetBytes:
      handoff.budgetBytes,
    usedBytes,
    serialized,
  });
}
