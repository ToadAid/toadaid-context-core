import { ContextClass, ContextBudgetExceeded } from "./types.mjs";

function serializedBytes(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function renderItem(item) {
  return {
    itemId: item.itemId,
    label: item.label,
    classification: item.classification,
    payload: item.modelView,
    lossless: item.lossless,
    rawRef: item.rawRef
      ? {
          algorithm: item.rawRef.algorithm,
          digest: item.rawRef.digest,
          bytes: item.rawRef.bytes,
        }
      : null,
  };
}

function finalizePacket({ budgetBytes, omittedNonExactItems, items }) {
  let usedBytes = 0;
  let packet;
  // usedBytes is itself serialized, so iterate until the byte count stabilizes.
  for (let i = 0; i < 8; i++) {
    packet = {
      version: 1,
      budgetBytes,
      usedBytes,
      omittedNonExactItems,
      items,
    };
    const next = serializedBytes(packet);
    if (next === usedBytes) break;
    usedBytes = next;
  }
  packet = {
    version: 1,
    budgetBytes,
    usedBytes,
    omittedNonExactItems,
    items,
  };
  return { packet, usedBytes: serializedBytes(packet) };
}

export function buildContextPacket(items, { budgetBytes = 8192 } = {}) {
  const exact = items.filter(i => i.classification === ContextClass.EXACT_EVIDENCE);
  const nonExact = items.filter(i => i.classification !== ContextClass.EXACT_EVIDENCE);

  const selected = exact.map(renderItem);
  let omitted = nonExact.length;

  let current = finalizePacket({
    budgetBytes,
    omittedNonExactItems: omitted,
    items: selected,
  });

  if (current.usedBytes > budgetBytes) {
    throw new ContextBudgetExceeded(
      `exact evidence packet requires ${current.usedBytes} bytes but packet budget is ${budgetBytes}; refusing to truncate evidence`
    );
  }

  for (const item of nonExact) {
    const candidateItems = [...selected, renderItem(item)];
    const candidate = finalizePacket({
      budgetBytes,
      omittedNonExactItems: omitted - 1,
      items: candidateItems,
    });

    if (candidate.usedBytes <= budgetBytes) {
      selected.push(candidateItems[candidateItems.length - 1]);
      omitted -= 1;
      current = candidate;
    }
  }

  const final = finalizePacket({
    budgetBytes,
    omittedNonExactItems: omitted,
    items: selected,
  });

  if (final.usedBytes > budgetBytes) {
    // Defensive invariant: this should be unreachable.
    throw new ContextBudgetExceeded(
      `packet construction exceeded budget (${final.usedBytes} > ${budgetBytes})`
    );
  }

  return Object.freeze(final.packet);
}
