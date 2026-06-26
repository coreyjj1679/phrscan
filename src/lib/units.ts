import { parseEther, parseGwei } from "viem";

export type ValueUnit = "wei" | "gwei" | "ether";

/** Convert a user-entered amount in the given unit to wei. May throw on bad input. */
export function valueToWei(value: string, unit: ValueUnit): bigint {
  const t = value.trim();
  if (unit === "ether") return parseEther(t);
  if (unit === "gwei") return parseGwei(t);
  return BigInt(t);
}

/** Like valueToWei but returns the wei string, falling back to the raw input. */
export function safeValueToWei(value: string, unit: ValueUnit): string {
  try {
    return valueToWei(value, unit).toString();
  } catch {
    return value;
  }
}
