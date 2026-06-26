import { useState, useEffect } from "react";
import { decodeRevert, type DecodedError } from "../lib/decodeError";
import { ValueView } from "./ValueView";
import { CopyButton } from "./CopyButton";

export function ErrorDecoder() {
  const [input, setInput] = useState("");
  const [result, setResult] = useState<DecodedError | null>(null);
  const [loading, setLoading] = useState(false);

  const hex = input.trim();
  const valid = /^0x[0-9a-fA-F]*$/.test(hex) && hex.length % 2 === 0 && hex.length >= 2;

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
      const r = await decodeRevert(hex);
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

  const sourceBadge =
    result?.source === "abi"
      ? { label: "saved ABI", cls: "bg-green-900/50 text-green-400" }
      : result?.source === "4byte"
        ? { label: "4byte", cls: "bg-blue-900/50 text-blue-400" }
        : { label: "builtin", cls: "bg-gray-700 text-gray-300" };

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h2 className="mb-2 text-xs font-semibold tracking-wide text-gray-500 uppercase">
          Revert / Error Decoder
        </h2>
        <p className="mb-2 text-xs text-gray-600">
          Paste raw revert data (the <span className="font-mono">0x…</span> blob from a failed
          call). Decoded against <span className="font-mono">Error(string)</span> /{" "}
          <span className="font-mono">Panic(uint256)</span>, your saved ABIs&rsquo; custom errors,
          then the 4byte database.
        </p>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="0xbc3088ef000000000000000000000000000000000000000000000000000000006a3ce09f"
          rows={4}
          spellCheck={false}
          className="w-full rounded bg-gray-900 px-3 py-2 font-mono text-xs text-gray-200 outline-none ring-1 ring-gray-700 focus:ring-cyan-600"
        />
        {hex.length > 0 && !valid && (
          <p className="mt-1 text-xs text-amber-400">Enter even-length hex starting with 0x.</p>
        )}
      </div>

      {loading && <p className="animate-pulse text-xs text-gray-500">Decoding…</p>}

      {result && !loading && (
        <div className="space-y-3 rounded-lg border border-border bg-surface p-3 sm:p-4">
          {result.kind === "empty" ? (
            <p className="text-sm text-amber-400">{result.reason}</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                {result.selector && (
                  <span className="rounded bg-gray-800 px-1.5 py-0.5 font-mono text-xs text-gray-400">
                    {result.selector}
                  </span>
                )}
                {result.name ? (
                  <>
                    <span className="font-mono text-sm font-semibold text-red-400">
                      {result.name}
                    </span>
                    <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${sourceBadge.cls}`}>
                      {sourceBadge.label}
                    </span>
                  </>
                ) : (
                  <span className="text-sm font-medium text-amber-400">Unknown error selector</span>
                )}
                <CopyButton text={hex} className="ml-auto" label="copy" />
              </div>

              {result.reason && (
                <p className="rounded bg-red-950/40 px-3 py-2 font-mono text-xs wrap-break-word text-red-300">
                  {result.reason}
                </p>
              )}

              {result.signature && (
                <p className="font-mono text-xs break-all text-gray-500">{result.signature}</p>
              )}

              {result.args && result.args.length > 0 && (
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

              {result.kind === "unknown" && (
                <p className="text-xs text-gray-500">
                  No signature found for{" "}
                  <span className="font-mono">{result.selector}</span>.
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
            </>
          )}
        </div>
      )}
    </div>
  );
}
