export const PANIC_REASONS: Record<string, string> = {
  "0x00": "generic compiler panic",
  "0x01": "assertion failed",
  "0x11": "arithmetic overflow or underflow",
  "0x12": "division or modulo by zero",
  "0x21": "conversion to an invalid enum value",
  "0x22": "incorrectly encoded storage byte array",
  "0x31": ".pop() on an empty array",
  "0x32": "array index out of bounds",
  "0x41": "out of memory / too much allocated",
  "0x51": "called an invalid internal function",
};

function cleanup(s: string): string {
  return s.replace(/^['"]+|['"]+$/g, "").trim();
}

/**
 * Turn a verbose viem / RPC error string into a short, human-readable reason.
 * Falls back to the first meaningful line (truncated) when nothing matches.
 */
export function humanizeError(raw: string): string {
  if (!raw) return "Execution reverted";
  const msg = raw.trim();

  // Explicit revert reason surfaced by viem.
  const reason =
    msg.match(/reverted with the following reason:\s*(.+?)(?:\n|$)/i) ??
    msg.match(/reason:\s*(.+?)(?:\n|$)/i);
  if (reason?.[1]) return cleanup(reason[1]);

  // Solidity Panic(uint256) — 0x4e487b71 selector + 32-byte code.
  const panic = msg.match(/4e487b71([0-9a-f]{64})/i);
  if (panic) {
    const code = "0x" + panic[1].slice(-2).toLowerCase();
    return `Panic: ${PANIC_REASONS[code] ?? `code ${code}`}`;
  }

  const lower = msg.toLowerCase();
  if (lower.includes("insufficient funds"))
    return "Insufficient funds for the value + gas";
  if (lower.includes("out of gas") || lower.includes("intrinsic gas"))
    return "Out of gas";
  if (lower.includes("nonce too low")) return "Nonce too low";
  if (lower.includes("gas required exceeds")) return "Gas limit too low";
  if (lower.includes("user rejected")) return "Request rejected";
  if (
    lower.includes("execution reverted") &&
    !lower.includes("reason")
  )
    return "Execution reverted (no reason given)";

  const firstLine = msg.split("\n")[0];
  return cleanup(firstLine.length > 300 ? firstLine.slice(0, 300) + "…" : firstLine);
}
