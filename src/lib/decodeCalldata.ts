import { decodeFunctionData, parseAbiItem, type Abi, type Hex } from "viem";
import { getAbiRegistry } from "./storage";
import { lookupSelectorSignatures } from "./selectors";

type AbiFnItem = {
  type: string;
  name?: string;
  inputs?: { name?: string; type: string }[];
};

export type DecodedArg = { name?: string; type: string; value: unknown };

export type DecodedCalldata = {
  selector: string;
  name: string | null;
  signature?: string;
  source: "abi" | "4byte" | "none";
  args: DecodedArg[];
  candidates?: string[];
};

function buildArgs(
  inputs: { name?: string; type: string }[],
  args: readonly unknown[] | undefined,
): DecodedArg[] {
  return (args ?? []).map((value, i) => ({
    name: inputs[i]?.name || undefined,
    type: inputs[i]?.type ?? "",
    value,
  }));
}

function tryAbi(abi: Abi, data: Hex, selector: string): DecodedCalldata | null {
  try {
    const { functionName, args } = decodeFunctionData({ abi, data });
    const item = (abi as unknown as AbiFnItem[]).find(
      (i) => i.type === "function" && i.name === functionName,
    );
    const inputs = item?.inputs ?? [];
    return {
      selector,
      name: functionName,
      signature: `${functionName}(${inputs.map((x) => x.type).join(",")})`,
      source: "abi",
      args: buildArgs(inputs, args as readonly unknown[]),
    };
  } catch {
    return null;
  }
}

/**
 * Decode calldata against saved ABIs, then OpenChain 4byte.
 *
 * When `to` is set, the ABI registered for that address is tried first
 * (parameter names). `extraAbis` are well-known fallbacks (e.g. Safe).
 */
export async function decodeCalldata(
  hex: string,
  options?: {
    to?: string;
    registry?: Map<string, Abi>;
    extraAbis?: Abi[];
  },
): Promise<DecodedCalldata> {
  const data = hex as Hex;
  const selector = hex.slice(0, 10);
  const registry = options?.registry ?? getAbiRegistry();

  if (options?.to) {
    const toAbi = registry.get(options.to.toLowerCase());
    if (toAbi) {
      const hit = tryAbi(toAbi, data, selector);
      if (hit) return hit;
    }
  }

  for (const abi of options?.extraAbis ?? []) {
    const hit = tryAbi(abi, data, selector);
    if (hit) return hit;
  }

  const skip = options?.to?.toLowerCase();
  for (const [addr, abi] of registry) {
    if (skip && addr === skip) continue;
    const hit = tryAbi(abi, data, selector);
    if (hit) return hit;
  }

  const candidates = await lookupSelectorSignatures(selector);
  for (const sig of candidates) {
    try {
      const item = parseAbiItem(`function ${sig}`) as unknown as AbiFnItem;
      const { functionName, args } = decodeFunctionData({
        abi: [item] as unknown as Abi,
        data,
      });
      return {
        selector,
        name: functionName,
        signature: sig,
        source: "4byte",
        args: buildArgs(item.inputs ?? [], args as readonly unknown[]),
      };
    } catch {
      // signature didn't decode the data — try next candidate
    }
  }

  return { selector, name: null, source: "none", args: [], candidates };
}
