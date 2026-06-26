import { useState, useEffect } from "react";
import { decodeFunctionData, parseAbiItem, type Abi, type Hex } from "viem";
import { getAbiRegistry } from "../lib/storage";
import { lookupSelectorSignatures } from "../lib/selectors";
import { ValueView } from "./ValueView";
import { CopyButton } from "./CopyButton";

type AbiFnItem = {
  type: string;
  name?: string;
  inputs?: { name?: string; type: string }[];
};

type DecodedArg = { name?: string; type: string; value: unknown };

type Decoded = {
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

async function decodeCalldata(hex: string): Promise<Decoded> {
  const data = hex as Hex;
  const selector = hex.slice(0, 10);

  const registry = getAbiRegistry();
  for (const [, abi] of registry) {
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
      // try next ABI
    }
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

export function CalldataDecoder() {
  const [input, setInput] = useState("");
  const [result, setResult] = useState<Decoded | null>(null);
  const [loading, setLoading] = useState(false);

  const hex = input.trim();
  const valid = /^0x[0-9a-fA-F]{8,}$/.test(hex) && hex.length % 2 === 0;

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      if (!valid) {
        if (!cancelled) {
          setResult(null);
          setLoading(false);
        }
        return;
      }
      if (!cancelled) setLoading(true);
      const r = await decodeCalldata(hex);
      if (!cancelled) {
        setResult(r);
        setLoading(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [hex, valid]);

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h2 className="mb-2 text-xs font-semibold tracking-wide text-gray-500 uppercase">
          Calldata Decoder
        </h2>
        <p className="mb-2 text-xs text-gray-600">
          Paste any transaction input / calldata. It&rsquo;s decoded against your saved ABIs,
          then the 4byte (OpenChain) signature database — no contract address needed.
        </p>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="0xa9059cbb000000000000000000000000…"
          rows={4}
          spellCheck={false}
          className="w-full rounded bg-gray-900 px-3 py-2 font-mono text-xs text-gray-200 outline-none ring-1 ring-gray-700 focus:ring-cyan-600"
        />
        {hex.length > 0 && !valid && (
          <p className="mt-1 text-xs text-amber-400">
            Enter hex calldata: 0x + at least a 4-byte selector (even length).
          </p>
        )}
      </div>

      {loading && <p className="animate-pulse text-xs text-gray-500">Decoding…</p>}

      {result && !loading && (
        <div className="space-y-3 rounded-lg border border-border bg-surface p-3 sm:p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded bg-gray-800 px-1.5 py-0.5 font-mono text-xs text-gray-400">
              {result.selector}
            </span>
            {result.name ? (
              <>
                <span className="font-mono text-sm font-semibold text-emerald-400">
                  {result.name}
                </span>
                <span
                  className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                    result.source === "abi"
                      ? "bg-green-900/50 text-green-400"
                      : "bg-blue-900/50 text-blue-400"
                  }`}
                >
                  {result.source === "abi" ? "saved ABI" : "4byte"}
                </span>
              </>
            ) : (
              <span className="text-sm font-medium text-amber-400">Unknown selector</span>
            )}
            <CopyButton text={input.trim()} className="ml-auto" label="copy" />
          </div>

          {result.signature && (
            <p className="font-mono text-xs break-all text-gray-500">{result.signature}</p>
          )}

          {result.name && result.args.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="border-b border-gray-800 text-left text-gray-600">
                    <th className="py-1 pr-2 font-medium">#</th>
                    <th className="py-1 pr-3 font-medium">Param</th>
                    <th className="py-1 pr-3 font-medium">Type</th>
                    <th className="py-1 font-medium">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {result.args.map((arg, i) => (
                    <tr key={i} className="border-b border-gray-800/50 align-top last:border-0">
                      <td className="py-1.5 pr-2 tabular-nums text-gray-600">{i}</td>
                      <td className="py-1.5 pr-3 font-mono text-gray-300">
                        {arg.name || `arg${i}`}
                      </td>
                      <td className="py-1.5 pr-3 font-mono text-gray-500">{arg.type || "—"}</td>
                      <td className="py-1.5 font-mono">
                        <ValueView value={arg.value} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {result.name && result.args.length === 0 && (
            <p className="text-xs text-gray-600">No parameters.</p>
          )}

          {!result.name && (
            <p className="text-xs text-gray-500">
              No signature found for <span className="font-mono">{result.selector}</span>.
              {result.candidates && result.candidates.length > 0 && (
                <>
                  {" "}
                  Candidates that didn&rsquo;t match the data:{" "}
                  <span className="font-mono text-gray-400">
                    {result.candidates.join(", ")}
                  </span>
                </>
              )}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
