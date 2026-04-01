import type { Abi, PublicClient, Address } from "viem";
import { isAddress } from "viem";
import { EXPLORER_API, EXPLORER_DIRECT_API } from "../config/chain";
import { buildAbiFromBytecode } from "./selectors";

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

export type FetchAbiResult = {
  abi: Abi | null;
  verified: boolean;
  partial?: boolean;
  resolvedCount?: number;
  totalSelectors?: number;
  error?: string;
};

export async function fetchAbi(
  address: string,
  client?: PublicClient,
): Promise<FetchAbiResult> {
  if (!client || !isAddress(address)) {
    return { abi: null, verified: false, error: "Invalid address." };
  }

  // 1) Resolve from bytecode (fast, always works)
  // 2) Try explorer APIs in the background at the same time
  const [bytecodeResult, explorerAbi] = await Promise.all([
    buildAbiFromBytecode(client, address as Address).catch(() => null),
    tryExplorerAbi(address),
  ]);

  if (explorerAbi) {
    return { abi: explorerAbi, verified: true };
  }

  if (bytecodeResult) {
    return {
      abi: bytecodeResult.abi,
      verified: false,
      partial: true,
      resolvedCount: bytecodeResult.resolved,
      totalSelectors: bytecodeResult.total,
      error: `Resolved ${bytecodeResult.resolved}/${bytecodeResult.total} functions from bytecode. Paste the full ABI below to get complete type info.`,
    };
  }

  return {
    abi: null,
    verified: false,
    error: "No bytecode found at this address. Paste the ABI manually below.",
  };
}

export function parseAbiJson(raw: string): Abi {
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error("ABI must be a JSON array");
  return parsed as Abi;
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
