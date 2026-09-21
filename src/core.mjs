import { randomUUID } from "node:crypto";
import { ContextClass } from "./types.mjs";
import { classifyInput } from "./classify.mjs";
import { deterministicReduce, boundedWorkingContext } from "./reduce.mjs";

export class ContextCore {
  constructor({ store, bulkLimit = 1600, workingLimit = 2200 } = {}) {
    if (!store) throw new Error("ContextCore requires a content store");
    this.store = store;
    this.bulkLimit = bulkLimit;
    this.workingLimit = workingLimit;
  }

  ingest({ content = "", classification, label = null, metadata = {} } = {}) {
    const cls = classifyInput({ content, classification, metadata });
    const itemId = randomUUID();

    if (cls === ContextClass.DURABLE_MEMORY_REFERENCE) {
      const ref = metadata.memoryRef ?? metadata.ref;
      if (!ref) throw new Error("DURABLE_MEMORY_REFERENCE requires metadata.memoryRef or metadata.ref");
      return Object.freeze({
        itemId,
        label,
        classification: cls,
        bytesIn: 0,
        bytesOut: Buffer.byteLength(String(ref), "utf8"),
        rawRef: null,
        modelView: String(ref),
        lossless: true,
        metadata: Object.freeze({ ...metadata }),
      });
    }

    const text = String(content);
    const rawRef = this.store.put(text);

    if (cls === ContextClass.EXACT_EVIDENCE) {
      return Object.freeze({
        itemId,
        label,
        classification: cls,
        bytesIn: rawRef.bytes,
        bytesOut: rawRef.bytes,
        rawRef,
        modelView: text,
        lossless: true,
        metadata: Object.freeze({ ...metadata }),
      });
    }

    if (cls === ContextClass.WORKING_CONTEXT) {
      const reduced = boundedWorkingContext(text, { maxBytes: this.workingLimit });
      return Object.freeze({
        itemId,
        label,
        classification: cls,
        bytesIn: rawRef.bytes,
        bytesOut: Buffer.byteLength(reduced.text, "utf8"),
        rawRef,
        modelView: reduced.text,
        lossless: reduced.lossless,
        reduction: reduced.method,
        metadata: Object.freeze({ ...metadata }),
      });
    }

    const reduced = deterministicReduce(text, { maxBytes: this.bulkLimit });
    return Object.freeze({
      itemId,
      label,
      classification: cls,
      bytesIn: rawRef.bytes,
      bytesOut: Buffer.byteLength(reduced.text, "utf8"),
      rawRef,
      modelView: reduced.text,
      lossless: false,
      reduction: reduced.method,
      metadata: Object.freeze({ ...metadata }),
    });
  }
}
