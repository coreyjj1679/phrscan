import type { Abi } from "viem";
import { decodeFunctionData, decodeFunctionResult, parseAbiItem } from "viem";
import type { TraceCall } from "./trace";

export type DecodedArg = { name?: string; type: string; value: unknown };
export type DecodedCall = { name: string; args: DecodedArg[] };

type AbiFnItem = {
  type: string;
  name?: string;
  inputs?: { name?: string; type: string }[];
  outputs?: { name?: string; type: string }[];
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

/**
 * Decode a trace call's input into a function name + typed arguments.
 *
 * Prefers the verified ABI registered for the call's target address (gives
 * parameter names), and falls back to the 4byte/openchain signature resolved
 * on the trace (types only). Returns null when neither can decode the data.
 */
export function decodeTraceInput(
  call: TraceCall,
  registry: Map<string, Abi>,
): DecodedCall | null {
  const data = call.input;
  if (!data || data.length < 10) return null;

  const toAbi = call.to ? registry.get(call.to.toLowerCase()) : undefined;
  if (toAbi) {
    try {
      const { functionName, args } = decodeFunctionData({ abi: toAbi, data });
      const item = (toAbi as unknown as AbiFnItem[]).find(
        (i) => i.type === "function" && i.name === functionName,
      );
      return {
        name: functionName,
        args: buildArgs(item?.inputs ?? [], args as readonly unknown[]),
      };
    } catch {
      // fall through to signature-based decoding
    }
  }

  if (call.functionSig && call.functionSig.includes("(")) {
    try {
      const item = parseAbiItem(`function ${call.functionSig}`) as unknown as AbiFnItem;
      const { functionName, args } = decodeFunctionData({
        abi: [item] as unknown as Abi,
        data,
      });
      return {
        name: functionName,
        args: buildArgs(item.inputs ?? [], args as readonly unknown[]),
      };
    } catch {
      // unparseable signature or data mismatch
    }
  }

  return null;
}

/**
 * Decode a successful trace call's return data into typed outputs.
 *
 * Requires the verified ABI registered for the target address (the 4byte
 * signature only carries input types, not outputs). Skips reverted frames —
 * their `output` is revert data, decoded separately. Returns null when the
 * outputs can't be resolved or decoded.
 */
export function decodeTraceOutput(
  call: TraceCall,
  registry: Map<string, Abi>,
): DecodedArg[] | null {
  if (call.error) return null;
  const data = call.output;
  if (!data || data.length < 10) return null;
  if (!call.input || call.input.length < 10) return null;

  const toAbi = call.to ? registry.get(call.to.toLowerCase()) : undefined;
  if (!toAbi) return null;

  try {
    const { functionName } = decodeFunctionData({ abi: toAbi, data: call.input });
    const item = (toAbi as unknown as AbiFnItem[]).find(
      (i) => i.type === "function" && i.name === functionName,
    );
    const outputs = item?.outputs ?? [];
    if (outputs.length === 0) return null;

    const result = decodeFunctionResult({ abi: toAbi, functionName, data });
    const values =
      outputs.length === 1 ? [result] : (result as readonly unknown[]);

    return outputs.map((o, i) => ({
      name: o.name || undefined,
      type: o.type ?? "",
      value: values[i],
    }));
  } catch {
    return null;
  }
}

export function formatArgValue(val: unknown): string {
  if (val === undefined || val === null) return "—";
  if (typeof val === "bigint") return val.toString();
  if (typeof val === "string") return val;
  if (typeof val === "boolean") return String(val);
  try {
    return JSON.stringify(
      val,
      (_k, v) => (typeof v === "bigint" ? v.toString() : v),
      2,
    );
  } catch {
    return String(val);
  }
}
