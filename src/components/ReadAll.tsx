import { useMemo, useState } from "react";
import {
  encodeFunctionData,
  type Abi,
  type Address,
  type PublicClient,
} from "viem";
import { extractFunctions, isReadFunction, fnKey, type AbiFunction } from "../lib/abi";
import { formatArgValue } from "../lib/decodeTrace";
import { humanizeError } from "../lib/errors";

type Props = {
  client: PublicClient;
  address: string;
  abi: Abi;
};

type ReadResult = { value?: unknown; error?: string };

async function readView(
  client: PublicClient,
  address: Address,
  abi: Abi,
  fn: AbiFunction,
): Promise<ReadResult> {
  try {
    if (!fn.outputs || fn.outputs.length === 0) {
      const data = encodeFunctionData({ abi, functionName: fn.name, args: [] });
      const { data: out } = await client.call({ to: address, data });
      return { value: out && out !== "0x" ? out : "(no return data)" };
    }
    const value = await client.readContract({
      address,
      abi,
      functionName: fn.name,
      args: [],
    });
    return { value };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export function ReadAll({ client, address, abi }: Props) {
  const reads = useMemo(
    () => extractFunctions(abi).filter(isReadFunction).filter((f) => f.inputs.length === 0),
    [abi],
  );
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<Map<string, ReadResult> | null>(null);

  const run = async () => {
    setLoading(true);
    const out = new Map<string, ReadResult>();
    await Promise.all(
      reads.map(async (fn) => {
        out.set(fnKey(fn), await readView(client, address as Address, abi, fn));
      }),
    );
    setResults(out);
    setLoading(false);
  };

  if (reads.length === 0) {
    return (
      <div className="flex min-h-40 items-center justify-center rounded-lg border border-dashed border-border bg-surface/50 p-6 text-center text-sm text-gray-500">
        Select a function from the list to read or simulate it.
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-border bg-surface p-3 sm:p-4">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold text-gray-100">Read functions</h3>
        <span className="rounded-full bg-gray-800 px-2 py-0.5 text-xs font-medium text-gray-400">
          {reads.length} no-arg
        </span>
        <button
          onClick={run}
          disabled={loading}
          className="ml-auto rounded bg-cyan-700 px-3 py-1.5 text-xs font-medium text-on-accent hover:bg-cyan-600 disabled:opacity-40"
        >
          {loading ? "Reading…" : results ? "Re-read all" : "Read all"}
        </button>
      </div>

      {!results ? (
        <p className="text-xs text-gray-600">
          Calls every zero-argument view function at once. For functions with arguments, pick
          one from the list.
        </p>
      ) : (
        <div className="space-y-1">
          {reads.map((fn) => {
            const r = results.get(fnKey(fn));
            return (
              <div
                key={fnKey(fn)}
                className="rounded-md bg-inset px-2.5 py-1.5 ring-1 ring-border/60"
              >
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="shrink-0 font-mono text-xs font-semibold text-gray-300">
                    {fn.name}
                  </span>
                  {!r ? (
                    <span className="text-xs text-gray-600">—</span>
                  ) : r.error ? (
                    <span className="min-w-0 break-all text-xs text-red-400">
                      {humanizeError(r.error)}
                    </span>
                  ) : (
                    <span className="min-w-0 break-all font-mono text-xs whitespace-pre-wrap text-cyan-300">
                      {formatArgValue(r.value)}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
