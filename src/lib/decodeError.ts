import {
  decodeAbiParameters,
  decodeErrorResult,
  parseAbiItem,
  type Abi,
  type Hex,
} from "viem";
import { getAbiRegistry } from "./storage";
import { lookupSelectorSignatures } from "./selectors";
import { PANIC_REASONS } from "./errors";

export type DecodedErrorArg = { name?: string; type: string; value: unknown };

export type DecodedError = {
  kind: "empty" | "string" | "panic" | "custom" | "unknown";
  selector?: string;
  name?: string | null;
  signature?: string;
  /** Human-readable summary for string/panic reverts. */
  reason?: string;
  source?: "builtin" | "abi" | "4byte";
  args?: DecodedErrorArg[];
  candidates?: string[];
};

const ERROR_STRING = "0x08c379a0"; // Error(string)
const PANIC = "0x4e487b71"; // Panic(uint256)

function argsFromItem(
  inputs: readonly { name?: string; type: string }[] | undefined,
  args: readonly unknown[] | undefined,
): DecodedErrorArg[] {
  return (args ?? []).map((value, i) => ({
    name: inputs?.[i]?.name || undefined,
    type: inputs?.[i]?.type ?? "",
    value,
  }));
}

/**
 * Decode raw revert / custom-error return data (`0x…`) against built-in
 * Solidity errors, your saved ABIs, then the 4byte (OpenChain) database.
 */
export async function decodeRevert(raw: string): Promise<DecodedError> {
  const hex = raw.trim().toLowerCase() as Hex;

  if (!hex || hex === "0x") {
    return { kind: "empty", reason: "Reverted with no return data (e.g. require without message, or out-of-gas)." };
  }

  const selector = hex.slice(0, 10);

  if (selector === ERROR_STRING) {
    try {
      const [reason] = decodeAbiParameters([{ type: "string" }], ("0x" + hex.slice(10)) as Hex);
      return {
        kind: "string",
        selector,
        name: "Error",
        signature: "Error(string)",
        source: "builtin",
        reason: reason as string,
      };
    } catch {
      // fall through
    }
  }

  if (selector === PANIC) {
    try {
      const [code] = decodeAbiParameters([{ type: "uint256" }], ("0x" + hex.slice(10)) as Hex);
      const codeHex = "0x" + (code as bigint).toString(16).padStart(2, "0");
      return {
        kind: "panic",
        selector,
        name: "Panic",
        signature: "Panic(uint256)",
        source: "builtin",
        reason: `Panic ${codeHex} — ${PANIC_REASONS[codeHex] ?? "unknown panic code"}`,
        args: [{ name: "code", type: "uint256", value: code }],
      };
    } catch {
      // fall through
    }
  }

  // Saved ABIs (custom errors defined in any loaded contract).
  const registry = getAbiRegistry();
  for (const [, abi] of registry) {
    try {
      const decoded = decodeErrorResult({ abi, data: hex });
      const item = decoded.abiItem as { inputs?: { name?: string; type: string }[] } | undefined;
      const inputs = item?.inputs ?? [];
      return {
        kind: "custom",
        selector,
        name: decoded.errorName,
        signature: `${decoded.errorName}(${inputs.map((i) => i.type).join(",")})`,
        source: "abi",
        args: argsFromItem(inputs, decoded.args as readonly unknown[]),
      };
    } catch {
      // try next ABI
    }
  }

  // 4byte / OpenChain — signatures share the function namespace with errors.
  const candidates = await lookupSelectorSignatures(selector);
  for (const sig of candidates) {
    try {
      const item = parseAbiItem(`error ${sig}`) as unknown as {
        inputs?: { name?: string; type: string }[];
      };
      const decoded = decodeErrorResult({ abi: [item] as unknown as Abi, data: hex });
      return {
        kind: "custom",
        selector,
        name: decoded.errorName,
        signature: sig,
        source: "4byte",
        args: argsFromItem(item.inputs, decoded.args as readonly unknown[]),
      };
    } catch {
      // signature didn't match the data — try next candidate
    }
  }

  return { kind: "unknown", selector, candidates };
}
