import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ContextCoreError } from "./types.mjs";

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export class ContentStore {
  constructor(root) {
    this.root = root;
    this.rawDir = join(root, "raw");
    mkdirSync(this.rawDir, { recursive: true });
  }

  put(content) {
    return this.putIdempotent(content);
  }

  putIdempotent(content) {
    const text = String(content);
    const digest = sha256(text);
    const path = join(this.rawDir, `${digest}.txt`);
    try {
      writeFileSync(path, text, { encoding: "utf8", flag: "wx" });
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const existing = readFileSync(path, "utf8");
      if (sha256(existing) !== digest || existing !== text) {
        throw new ContextCoreError(`content-address collision/integrity failure for ${digest}`);
      }
    }
    return this.#finalizeRef(digest, text, path);
  }

  #finalizeRef(digest, text, path) {
    return Object.freeze({
      algorithm: "sha256",
      digest,
      bytes: Buffer.byteLength(text, "utf8"),
      path,
    });
  }

  get(ref) {
    if (!ref || ref.algorithm !== "sha256" || !ref.digest || !ref.path) {
      throw new ContextCoreError("invalid content reference");
    }
    const text = readFileSync(ref.path, "utf8");
    const digest = sha256(text);
    if (digest !== ref.digest) {
      throw new ContextCoreError(`stored content integrity mismatch: expected ${ref.digest}, found ${digest}`);
    }
    return text;
  }
}
