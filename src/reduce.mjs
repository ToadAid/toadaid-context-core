const SIGNAL = /\b(error|fail(?:ed|ure)?|warn(?:ing)?|panic|exception|passed?|success)\b/i;

function clipUtf8(text, maxBytes) {
  const source = String(text);
  if (Buffer.byteLength(source, "utf8") <= maxBytes) return source;
  let out = "";
  for (const ch of source) {
    if (Buffer.byteLength(out + ch, "utf8") > maxBytes) break;
    out += ch;
  }
  return out;
}

function structuredSummary(parsed) {
  if (Array.isArray(parsed)) {
    return `json=array length=${parsed.length}`;
  }
  if (parsed && typeof parsed === "object") {
    const keys = Object.keys(parsed);
    const shown = keys.slice(0, 20).join(",");
    const suffix = keys.length > 20 ? `,+${keys.length - 20} more` : "";
    return `json=object keys=${keys.length} [${shown}${suffix}]`;
  }
  return `json=${typeof parsed} value=${JSON.stringify(parsed)}`;
}

export function deterministicReduce(content, { maxBytes = 1600 } = {}) {
  const text = String(content);
  const bytes = Buffer.byteLength(text, "utf8");

  try {
    const parsed = JSON.parse(text);
    const summary = `${structuredSummary(parsed)}; raw_bytes=${bytes}`;
    return {
      method: "json-structure-v1",
      text: clipUtf8(summary, maxBytes),
      lossless: false,
    };
  } catch {
    // plain-text path
  }

  const lines = text.split(/\r?\n/);
  const nonEmpty = lines.filter(line => line.trim().length > 0);
  const signals = nonEmpty.filter(line => SIGNAL.test(line)).slice(0, 8);
  const first = nonEmpty.slice(0, 3);
  const last = nonEmpty.slice(-3);

  const parts = [
    `text lines=${lines.length} nonempty=${nonEmpty.length} raw_bytes=${bytes}`,
  ];
  if (signals.length) {
    parts.push("signals:", ...signals.map(line => `! ${line}`));
  }
  if (first.length) {
    parts.push("first:", ...first.map(line => `> ${line}`));
  }
  if (last.length) {
    parts.push("last:", ...last.map(line => `< ${line}`));
  }

  return {
    method: "text-signals-head-tail-v1",
    text: clipUtf8(parts.join("\n"), maxBytes),
    lossless: false,
  };
}

export function boundedWorkingContext(content, { maxBytes = 2200 } = {}) {
  const text = String(content);
  if (Buffer.byteLength(text, "utf8") <= maxBytes) {
    return { method: "direct-v1", text, lossless: true };
  }

  const marker = "\n...[working context clipped; raw reference retained]...\n";
  const markerBytes = Buffer.byteLength(marker, "utf8");
  const half = Math.max(0, Math.floor((maxBytes - markerBytes) / 2));
  const head = clipUtf8(text, half);

  let tail = "";
  const chars = [...text];
  for (let i = chars.length - 1; i >= 0; i--) {
    const next = chars[i] + tail;
    if (Buffer.byteLength(next, "utf8") > half) break;
    tail = next;
  }

  return {
    method: "working-head-tail-v1",
    text: head + marker + tail,
    lossless: false,
  };
}
