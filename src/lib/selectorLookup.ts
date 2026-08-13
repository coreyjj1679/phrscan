import { toFunctionSelector, type AbiFunction } from "viem";
import {
  getAllAbiEntries,
  getSavedAddresses,
  getSavedContracts,
} from "./storage";
import { lookupSelectorSignatures } from "./selectors";

export type SelectorMatch = {
  selector: string;
  name: string;
  signature: string;
  address: string;
  label?: string;
};

export type SelectorLookupResult = {
  queryKind: "selector" | "signature" | "name";
  computed?: { selector: string; signature: string };
  matches: SelectorMatch[];
  openchain?: string[];
};

function catalog(): SelectorMatch[] {
  const labels = new Map<string, string>();
  for (const a of getSavedAddresses()) {
    labels.set(a.address.toLowerCase(), a.label);
  }
  for (const c of getSavedContracts()) {
    labels.set(c.address.toLowerCase(), c.label);
  }

  const out: SelectorMatch[] = [];
  const seen = new Set<string>();
  for (const entry of getAllAbiEntries()) {
    const label = labels.get(entry.address.toLowerCase());
    for (const item of entry.abi) {
      if (item.type !== "function" || !("name" in item) || !item.name) continue;
      const fn = item as AbiFunction;
      try {
        const selector = toFunctionSelector(fn).toLowerCase();
        const signature = `${fn.name}(${(fn.inputs ?? []).map((i) => i.type).join(",")})`;
        const key = `${selector}:${entry.address.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          selector,
          name: fn.name,
          signature,
          address: entry.address,
          label,
        });
      } catch {
        /* skip functions viem can't select (e.g. solidity tuples it rejects) */
      }
    }
  }
  return out;
}

function normalizeSig(s: string): string {
  return s.toLowerCase().replace(/\s+/g, "");
}

/**
 * Look up a 4-byte selector, a `name(types)` signature, or a function name
 * against saved ABIs. For a typed signature, also computes the selector
 * even if it isn't in the registry.
 */
export async function lookupSelectorQuery(
  raw: string,
): Promise<SelectorLookupResult | null> {
  const q = raw.trim();
  if (!q) return null;
  const all = catalog();

  const selMatch = q.match(/^(?:0x)?([0-9a-fA-F]{8})$/);
  if (selMatch) {
    const selector = `0x${selMatch[1].toLowerCase()}`;
    const matches = all.filter((m) => m.selector === selector);
    const openchain =
      matches.length === 0 ? await lookupSelectorSignatures(selector) : undefined;
    return { queryKind: "selector", matches, openchain };
  }

  if (q.includes("(")) {
    const signature = q.replace(/^function\s+/i, "").trim();
    let computed: { selector: string; signature: string } | undefined;
    try {
      const selector = toFunctionSelector(`function ${signature}`).toLowerCase();
      computed = { selector, signature };
    } catch {
      /* invalid signature text */
    }
    const ql = normalizeSig(signature);
    const matches = all.filter(
      (m) =>
        normalizeSig(m.signature) === ql ||
        (computed !== undefined && m.selector === computed.selector),
    );
    return { queryKind: "signature", computed, matches };
  }

  const ql = q.toLowerCase();
  const matches = all
    .filter(
      (m) => m.name.toLowerCase() === ql || m.name.toLowerCase().includes(ql),
    )
    .sort((a, b) => {
      const ae = a.name.toLowerCase() === ql ? 0 : 1;
      const be = b.name.toLowerCase() === ql ? 0 : 1;
      if (ae !== be) return ae - be;
      return a.signature.localeCompare(b.signature);
    });
  return { queryKind: "name", matches };
}
