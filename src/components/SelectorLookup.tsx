import { useEffect, useState } from "react";
import { CopyButton } from "./CopyButton";
import { EXPLORER_URL } from "../config/chain";
import {
  lookupSelectorQuery,
  type SelectorLookupResult,
  type SelectorMatch,
} from "../lib/selectorLookup";

export function SelectorLookup() {
  const [input, setInput] = useState("");
  const [result, setResult] = useState<SelectorLookupResult | null>(null);
  const [loading, setLoading] = useState(false);

  const q = input.trim();

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      if (!q) {
        if (!cancelled) {
          setResult(null);
          setLoading(false);
        }
        return;
      }
      if (!cancelled) setLoading(true);
      const r = await lookupSelectorQuery(q);
      if (!cancelled) {
        setResult(r);
        setLoading(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q]);

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h2 className="mb-2 text-xs font-semibold tracking-wide text-gray-500 uppercase">
          Selector lookup
        </h2>
        <p className="mb-2 text-xs text-gray-600">
          Paste a 4-byte selector (<span className="font-mono">0xe98484f1</span>) to
          find the function in your saved ABIs, or a function name /{" "}
          <span className="font-mono">name(types)</span> signature to get the selector.
        </p>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="0xe98484f1  or  transfer  or  transfer(address,uint256)"
          spellCheck={false}
          className="w-full rounded bg-gray-900 px-3 py-2 font-mono text-sm text-gray-200 outline-none ring-1 ring-gray-700 focus:ring-cyan-600"
        />
      </div>

      {loading && <p className="animate-pulse text-xs text-gray-500">Looking up…</p>}

      {result && !loading && (
        <div className="space-y-3">
          {result.computed && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2.5">
              <span className="font-mono text-sm font-semibold text-emerald-400">
                {result.computed.selector}
              </span>
              <CopyButton text={result.computed.selector} />
              <span className="font-mono text-xs break-all text-gray-500">
                {result.computed.signature}
              </span>
            </div>
          )}

          {result.queryKind === "selector" && result.matches.length === 0 && (
            <p className="text-xs text-gray-500">
              No saved ABI contains this selector.
              {result.openchain && result.openchain.length > 0 && (
                <> OpenChain candidates: </>
              )}
              {result.openchain && result.openchain.length > 0 && (
                <span className="font-mono text-gray-400">
                  {result.openchain.join(", ")}
                </span>
              )}
            </p>
          )}

          {result.queryKind !== "selector" &&
            result.matches.length === 0 &&
            !result.computed && (
              <p className="text-xs text-gray-500">
                No matching function in saved ABIs.
              </p>
            )}

          {result.matches.length > 0 && (
            <div className="overflow-hidden rounded-lg border border-border bg-surface">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="border-b border-border text-left text-gray-600">
                    <th className="px-3 py-2 font-medium">Selector</th>
                    <th className="px-3 py-2 font-medium">Function</th>
                    <th className="px-3 py-2 font-medium">Contract</th>
                  </tr>
                </thead>
                <tbody>
                  {result.matches.map((m, i) => (
                    <MatchRow key={`${m.selector}-${m.address}-${i}`} match={m} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MatchRow({ match }: { match: SelectorMatch }) {
  const short =
    match.address.length >= 10
      ? `${match.address.slice(0, 6)}…${match.address.slice(-4)}`
      : match.address;
  return (
    <tr className="border-b border-border/60 last:border-0">
      <td className="px-3 py-2 align-top">
        <span className="inline-flex items-center gap-1 font-mono text-cyan-300">
          {match.selector}
          <CopyButton text={match.selector} />
        </span>
      </td>
      <td className="px-3 py-2 align-top">
        <div className="font-mono font-medium text-emerald-400">{match.name}</div>
        <div className="font-mono break-all text-gray-500">{match.signature}</div>
      </td>
      <td className="px-3 py-2 align-top">
        {match.label && (
          <span className="mb-0.5 block rounded bg-cyan-900/30 px-1 py-0.5 text-cyan-300">
            {match.label}
          </span>
        )}
        <a
          href={`${EXPLORER_URL}/address/${match.address}`}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-gray-500 hover:text-cyan-400"
        >
          {short}
        </a>
      </td>
    </tr>
  );
}
