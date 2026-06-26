export type SearchKind = "tx" | "address" | "block" | "unknown";

/** Classify a search query as a tx hash, address, block number, or unknown. */
export function classifyQuery(q: string): SearchKind {
  const t = q.trim();
  if (/^0x[0-9a-fA-F]{64}$/.test(t)) return "tx";
  if (/^0x[0-9a-fA-F]{40}$/.test(t)) return "address";
  if (/^\d+$/.test(t)) return "block";
  return "unknown";
}
