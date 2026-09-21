import {
  ContextClass,
  VALID_CLASSES,
  InvalidClassificationError,
} from "./types.mjs";

const EXACT_KINDS = new Set([
  "sha",
  "commit_sha",
  "tree_sha",
  "pr_head",
  "merge_sha",
  "transaction_hash",
  "receipt",
  "authority_decision",
  "constitution_binding",
  "signature",
]);

const WORKING_KINDS = new Set([
  "objective",
  "task",
  "current_file",
  "error",
  "failure",
  "decision_pending",
  "worktree_status",
]);

export function classifyInput({ content = "", classification, metadata = {} } = {}) {
  if (classification !== undefined) {
    if (!VALID_CLASSES.has(classification)) {
      throw new InvalidClassificationError(`unknown classification: ${classification}`);
    }
    return classification;
  }

  if (metadata.memoryRef || metadata.kind === "memory_reference") {
    return ContextClass.DURABLE_MEMORY_REFERENCE;
  }

  if (metadata.exact === true || metadata.evidence === true || EXACT_KINDS.has(metadata.kind)) {
    return ContextClass.EXACT_EVIDENCE;
  }

  if (WORKING_KINDS.has(metadata.kind)) {
    return ContextClass.WORKING_CONTEXT;
  }

  const bytes = Buffer.byteLength(String(content), "utf8");
  if (bytes > 4096) {
    return ContextClass.BULK_MATERIAL;
  }

  return ContextClass.WORKING_CONTEXT;
}
