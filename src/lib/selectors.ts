import type { Abi, AbiFunction, PublicClient, Address, Hex } from "viem";
import { toFunctionSelector } from "viem";

const OPENCHAIN_API =
  "https://api.openchain.xyz/signature-database/v1/lookup";

/**
 * Extract 4-byte function selectors from deployed bytecode by scanning for
 * PUSH4 (0x63) opcodes that are commonly used in the Solidity dispatcher.
 */
export function extractSelectors(bytecode: Hex): string[] {
  const code = bytecode.startsWith("0x") ? bytecode.slice(2) : bytecode;
  const seen = new Set<string>();

  for (let i = 0; i < code.length - 10; i += 2) {
    if (code[i] === "6" && code[i + 1] === "3") {
      const sel = "0x" + code.slice(i + 2, i + 10);
      if (/^0x[0-9a-fA-F]{8}$/.test(sel)) seen.add(sel.toLowerCase());
    }
  }
  return [...seen];
}

/**
 * Look up function signatures on OpenChain (4byte.directory successor).
 * Returns a map of selector -> text signature, e.g. "0x70a08231" -> "balanceOf(address)".
 */
async function lookupSignatures(
  selectors: string[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (selectors.length === 0) return result;

  const batchSize = 150;
  for (let i = 0; i < selectors.length; i += batchSize) {
    const batch = selectors.slice(i, i + batchSize);
    const url = `${OPENCHAIN_API}?function=${batch.join(",")}&filter=true`;
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const json = await res.json();
      const fns = json?.result?.function ?? {};
      for (const [sel, matches] of Object.entries(fns)) {
        if (Array.isArray(matches) && matches.length > 0) {
          result.set(sel.toLowerCase(), (matches[0] as { name: string }).name);
        }
      }
    } catch {
      // openchain unavailable, skip
    }
  }
  return result;
}

/**
 * Parse a text signature like "transfer(address,uint256)" into an AbiFunction.
 */
function parseTextSignature(sig: string): AbiFunction | null {
  const match = sig.match(/^(\w+)\(([^)]*)\)$/);
  if (!match) return null;

  const name = match[1];
  const paramsStr = match[2];
  const inputs =
    paramsStr === ""
      ? []
      : paramsStr.split(",").map((type, idx) => ({
          name: `arg${idx}`,
          type: type.trim(),
        }));

  return {
    type: "function" as const,
    name,
    inputs,
    outputs: [],
    stateMutability: "nonpayable" as const,
  };
}

/**
 * Build a best-effort ABI from on-chain bytecode by extracting selectors
 * and resolving them via OpenChain.
 */
export async function buildAbiFromBytecode(
  client: PublicClient,
  address: Address,
): Promise<{ abi: Abi; resolved: number; total: number } | null> {
  const bytecode = await client.getCode({ address });
  if (!bytecode || bytecode === "0x") return null;

  const selectors = extractSelectors(bytecode);
  if (selectors.length === 0) return null;

  const signatures = await lookupSignatures(selectors);
  const fns: AbiFunction[] = [];

  for (const [, sig] of signatures) {
    const parsed = parseTextSignature(sig);
    if (parsed) fns.push(parsed);
  }

  if (fns.length === 0) return null;
  return { abi: fns as unknown as Abi, resolved: fns.length, total: selectors.length };
}

/**
 * Heuristically detect read (view) functions in a reconstructed ABI by
 * staticcalling each zero-argument function: if `eth_call` returns data
 * without reverting, it's almost certainly a getter. State-changing calls are
 * unaffected (eth_call never persists), so a misclassification is harmless.
 *
 * Only zero-arg functions can be probed (we don't know valid args for others).
 */
export async function probeViewFunctions(
  client: PublicClient,
  address: Address,
  abi: Abi,
): Promise<Abi> {
  const candidates = (abi as AbiFunction[]).filter(
    (f) =>
      f.type === "function" &&
      (f.inputs?.length ?? 0) === 0 &&
      f.stateMutability !== "view" &&
      f.stateMutability !== "pure" &&
      f.stateMutability !== "payable",
  );
  if (candidates.length === 0) return abi;

  const viewSelectors = new Set<string>();
  await Promise.all(
    candidates.slice(0, 40).map(async (f) => {
      let selector: Hex;
      try {
        selector = toFunctionSelector(f);
      } catch {
        return;
      }
      try {
        const { data } = await client.call({ to: address, data: selector });
        if (data && data !== "0x") viewSelectors.add(selector.toLowerCase());
      } catch {
        // reverts or non-readable: leave classification untouched
      }
    }),
  );

  if (viewSelectors.size === 0) return abi;

  return abi.map((item) => {
    if (item.type === "function" && ((item as AbiFunction).inputs?.length ?? 0) === 0) {
      try {
        if (viewSelectors.has(toFunctionSelector(item as AbiFunction).toLowerCase())) {
          return { ...item, stateMutability: "view" as const };
        }
      } catch {
        /* keep original */
      }
    }
    return item;
  }) as Abi;
}

/** Resolve a single 4-byte selector to candidate text signatures via OpenChain. */
export async function lookupSelectorSignatures(selector: string): Promise<string[]> {
  const sel = selector.toLowerCase();
  try {
    const url = `${OPENCHAIN_API}?function=${sel}&filter=true`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const json = await res.json();
    const fns = json?.result?.function ?? {};
    const matches = fns[sel] ?? fns[selector] ?? [];
    return Array.isArray(matches)
      ? matches.map((m: { name: string }) => m.name)
      : [];
  } catch {
    return [];
  }
}
