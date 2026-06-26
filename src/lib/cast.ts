type CastOpts = {
  to: string;
  /** Function signature `name(type,…)` — omit for raw calldata. */
  sig?: string;
  args?: string[];
  /** Raw calldata (0x…) when no signature. */
  data?: string;
  from?: string;
  /** Value in wei (decimal string). */
  value?: string;
  block?: string;
  rpc: string;
};

function quote(s: string): string {
  return `"${s.replace(/(["\\$`])/g, "\\$1")}"`;
}

/** Build an equivalent Foundry `cast call` command for a call/simulation. */
export function castCall(o: CastOpts): string {
  const parts: string[] = ["cast call", o.to];
  if (o.sig) {
    parts.push(quote(o.sig));
    for (const a of o.args ?? []) parts.push(quote(a));
  } else if (o.data) {
    parts.push(o.data);
  }
  if (o.from?.trim()) parts.push(`--from ${o.from.trim()}`);
  if (o.value && o.value !== "0") parts.push(`--value ${o.value}`);
  if (o.block?.trim()) parts.push(`--block ${o.block.trim()}`);
  parts.push(`--rpc-url ${o.rpc}`);
  return parts.join(" ");
}
