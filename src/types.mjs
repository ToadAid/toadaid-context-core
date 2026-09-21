export const ContextClass = Object.freeze({
  EXACT_EVIDENCE: "EXACT_EVIDENCE",
  WORKING_CONTEXT: "WORKING_CONTEXT",
  BULK_MATERIAL: "BULK_MATERIAL",
  RETRIEVABLE_KNOWLEDGE: "RETRIEVABLE_KNOWLEDGE",
  DURABLE_MEMORY_REFERENCE: "DURABLE_MEMORY_REFERENCE",
});

export const VALID_CLASSES = new Set(Object.values(ContextClass));

export class ContextCoreError extends Error {}

export class InvalidClassificationError extends ContextCoreError {}

export class ContextBudgetExceeded extends ContextCoreError {}
