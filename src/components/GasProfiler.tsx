import { useMemo, useState } from "react";
import type { TraceCall } from "../lib/trace";
import type { AddressBook } from "../hooks/useAddressBook";

type Props = {
  trace: TraceCall;
  book?: AddressBook;
};

type Box = { node: TraceCall; x: number; w: number };

const DEPTH_BG = [
  "bg-cyan-600/50",
  "bg-cyan-600/40",
  "bg-cyan-600/30",
  "bg-cyan-600/25",
  "bg-cyan-600/20",
  "bg-cyan-600/15",
];

function callName(c: TraceCall): string {
  if (c.functionSig) return c.functionSig.replace(/\(.*$/, "");
  if (c.input && c.input.length >= 10) return c.input.slice(0, 10);
  return c.type.toLowerCase();
}

function buildRows(root: TraceCall): Box[][] {
  const total = Number(root.gasUsed) || 1;
  const rows: Box[][] = [];
  const walk = (node: TraceCall, x: number, depth: number) => {
    if (!rows[depth]) rows[depth] = [];
    rows[depth].push({ node, x, w: Number(node.gasUsed) / total });
    let cx = x;
    for (const c of node.calls ?? []) {
      walk(c, cx, depth + 1);
      cx += Number(c.gasUsed) / total;
    }
  };
  walk(root, 0, 0);
  return rows;
}

export function GasProfiler({ trace, book }: Props) {
  const [focus, setFocus] = useState<TraceCall>(trace);
  const [prevTrace, setPrevTrace] = useState(trace);
  // Reset zoom when a new trace arrives (render-time state adjustment).
  if (prevTrace !== trace) {
    setPrevTrace(trace);
    setFocus(trace);
  }

  const rows = useMemo(() => buildRows(focus), [focus]);
  const totalGas = Number(trace.gasUsed) || 0;
  const focusGas = Number(focus.gasUsed) || 0;
  const zoomed = focus !== trace;

  return (
    <div className="space-y-3 rounded-lg border border-border bg-surface p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-gray-100">Gas Profile</h3>
        <span className="rounded-full bg-gray-800 px-2 py-0.5 text-xs font-medium text-gray-400">
          {totalGas.toLocaleString()} gas
        </span>
        {zoomed && (
          <span className="text-xs text-gray-500">
            zoomed: {focusGas.toLocaleString()} gas (
            {totalGas ? Math.round((focusGas / totalGas) * 100) : 0}%)
          </span>
        )}
        {zoomed && (
          <button
            onClick={() => setFocus(trace)}
            className="ml-auto text-xs text-gray-500 transition-colors hover:text-gray-300"
          >
            Reset zoom
          </button>
        )}
      </div>

      <div className="max-h-[60vh] space-y-0.5 overflow-y-auto">
        {rows.map((row, depth) => (
          <div key={depth} className="relative h-6 w-full">
            {row.map((b, i) => {
              const pct = focusGas ? (Number(b.node.gasUsed) / focusGas) * 100 : 0;
              const bg = b.node.error
                ? "bg-red-900/60 text-red-300 hover:bg-red-900/80"
                : `${DEPTH_BG[Math.min(depth, DEPTH_BG.length - 1)]} text-gray-100 hover:bg-cyan-600/60`;
              const label = callName(b.node);
              const target = book?.resolve(b.node.to);
              return (
                <button
                  key={i}
                  onClick={() => setFocus(b.node)}
                  title={`${target ? target + " · " : ""}${label} · ${Number(b.node.gasUsed).toLocaleString()} gas (${pct.toFixed(1)}%)\n${b.node.from} → ${b.node.to}`}
                  style={{
                    left: `${b.x * 100}%`,
                    width: `${Math.max(b.w * 100, 0.15)}%`,
                  }}
                  className={`absolute top-0 flex h-6 items-center overflow-hidden rounded-sm border-l border-ink/40 px-1 text-left font-mono text-xs transition-colors ${bg}`}
                >
                  <span className="truncate">{label}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <p className="text-xs text-gray-600">
        Width = gas used (incl. sub-calls). Click a frame to zoom in; reverted frames are red.
      </p>
    </div>
  );
}
