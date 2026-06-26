import type { Abi, PublicClient, Address } from "viem";
import { isAddress, getAddress } from "viem";
import { EXPLORER_API, EXPLORER_DIRECT_API, ACTIVE_NETWORK } from "../config/chain";
import { buildAbiFromBytecode, probeViewFunctions } from "./selectors";
import { detectProxy, type ProxyInfo } from "./proxy";

async function tryExplorerAbi(address: string): Promise<Abi | null> {
  const urls = [
    `${EXPLORER_API}/contract?module=contract&action=getabi&address=${address}`,
    `${EXPLORER_DIRECT_API}/api?module=contract&action=getabi&address=${address}`,
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const text = await res.text();
      if (text.includes("<!DOCTYPE") || text.includes("<html")) continue;
      const json = JSON.parse(text);
      if (json.status === "1" && json.result) {
        const parsed = typeof json.result === "string" ? JSON.parse(json.result) : json.result;
        if (Array.isArray(parsed)) return parsed as Abi;
      }
    } catch {
      // try next
    }
  }
  return null;
}

async function trySourcifyAbi(address: string): Promise<Abi | null> {
  let checksummed: string;
  try {
    checksummed = getAddress(address);
  } catch {
    return null;
  }
  const chainId = ACTIVE_NETWORK.chainId;
  const urls = [
    `https://repo.sourcify.dev/contracts/full_match/${chainId}/${checksummed}/metadata.json`,
    `https://repo.sourcify.dev/contracts/partial_match/${chainId}/${checksummed}/metadata.json`,
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const json = await res.json();
      const abi = json?.output?.abi;
      if (Array.isArray(abi)) return abi as Abi;
    } catch {
      // try next match type
    }
  }
  return null;
}

export type FetchAbiResult = {
  abi: Abi | null;
  verified: boolean;
  partial?: boolean;
  resolvedCount?: number;
  totalSelectors?: number;
  error?: string;
  proxy?: ProxyInfo;
};

/** Resolve an ABI for a single concrete address (no proxy following). */
async function fetchAbiForAddress(
  address: string,
  client: PublicClient,
): Promise<FetchAbiResult> {
  // Resolve from bytecode and from verified sources (explorer + Sourcify) at once.
  const [bytecodeResult, explorerAbi, sourcifyAbi] = await Promise.all([
    buildAbiFromBytecode(client, address as Address).catch(() => null),
    tryExplorerAbi(address),
    trySourcifyAbi(address),
  ]);

  const verifiedAbi = explorerAbi ?? sourcifyAbi;
  if (verifiedAbi) {
    return { abi: verifiedAbi, verified: true };
  }

  if (bytecodeResult) {
    // Unverified: signatures carry no mutability, so probe zero-arg getters.
    const abi = await probeViewFunctions(client, address as Address, bytecodeResult.abi).catch(
      () => bytecodeResult.abi,
    );
    return {
      abi,
      verified: false,
      partial: true,
      resolvedCount: bytecodeResult.resolved,
      totalSelectors: bytecodeResult.total,
      error: `Resolved ${bytecodeResult.resolved}/${bytecodeResult.total} functions from bytecode. Read functions are detected heuristically — paste the full ABI for exact types.`,
    };
  }

  return {
    abi: null,
    verified: false,
    error: "No bytecode found at this address. Paste the ABI manually below.",
  };
}

export async function fetchAbi(
  address: string,
  client?: PublicClient,
): Promise<FetchAbiResult> {
  if (!client || !isAddress(address)) {
    return { abi: null, verified: false, error: "Invalid address." };
  }

  // If this is a proxy, resolve the ABI from the implementation so the real
  // functions show up (calls still target the proxy address).
  const proxy = await detectProxy(client, address as Address).catch(() => null);
  const target = proxy?.implementation ?? address;

  const res = await fetchAbiForAddress(target, client);
  return proxy ? { ...res, proxy } : res;
}

export function parseAbiJson(raw: string): Abi {
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error("ABI must be a JSON array");
  return parsed as Abi;
}

/** Pull an ABI array out of parsed JSON: a bare array, or an artifact/solc output with an `abi` field. */
function coerceAbi(parsed: unknown): Abi | null {
  if (Array.isArray(parsed)) return parsed as Abi;
  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj.abi)) return obj.abi as Abi;
    const output = obj.output;
    if (output && typeof output === "object" && Array.isArray((output as Record<string, unknown>).abi)) {
      return (output as Record<string, unknown>).abi as Abi;
    }
  }
  return null;
}

/**
 * Parse an ABI from arbitrary JSON text — accepts a bare ABI array, or a
 * Hardhat/Foundry build artifact (or solc output) containing an `abi` field.
 */
export function extractAbiFromJsonText(text: string): Abi {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("File is not valid JSON.");
  }
  const abi = coerceAbi(parsed);
  if (!abi) {
    throw new Error("No ABI found — expected an ABI array or an artifact with an `abi` field.");
  }
  return abi;
}

import type { AbiFunction as ViemAbiFunction } from "viem";

export type AbiFunction = ViemAbiFunction;

export function extractFunctions(abi: Abi): AbiFunction[] {
  return abi.filter(
    (item): item is AbiFunction => "type" in item && item.type === "function",
  );
}

export function isReadFunction(fn: AbiFunction): boolean {
  return fn.stateMutability === "view" || fn.stateMutability === "pure";
}

export function fnKey(fn: AbiFunction): string {
  return `${fn.name}(${fn.inputs.map((i) => i.type).join(",")})`;
}
