import { useState } from "react";
import type { Abi } from "viem";
import { extractFunctions, isReadFunction, fnKey, type AbiFunction } from "../lib/abi";

type Props = {
  abi: Abi;
  selectedFn: AbiFunction | null;
  onSelect: (fn: AbiFunction) => void;
};

export function AbiViewer({ abi, selectedFn, onSelect }: Props) {
  const [query, setQuery] = useState("");
  const fns = extractFunctions(abi);
  const q = query.trim().toLowerCase();
  const filtered = q ? fns.filter((f) => f.name.toLowerCase().includes(q)) : fns;
  const reads = filtered.filter(isReadFunction);
  const writes = filtered.filter((f) => !isReadFunction(f));
  const selectedKey = selectedFn ? fnKey(selectedFn) : null;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-2">
      <div className="relative">
        <svg
          className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-gray-500"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search functions…"
          spellCheck={false}
          className="w-full rounded-md bg-inset py-1.5 pr-2 pl-8 text-xs text-gray-200 outline-none ring-1 ring-border focus:ring-accent"
        />
      </div>

      <div className="flex max-h-[55vh] flex-col gap-3 overflow-y-auto pr-0.5 lg:max-h-[calc(100vh-180px)]">
        {reads.length > 0 && (
          <FnGroup label="Read" count={reads.length}>
            {reads.map((fn) => (
              <FnRow
                key={fnKey(fn)}
                fn={fn}
                kind="read"
                active={selectedKey === fnKey(fn)}
                onClick={() => onSelect(fn)}
              />
            ))}
          </FnGroup>
        )}
        {writes.length > 0 && (
          <FnGroup label="Write" count={writes.length}>
            {writes.map((fn) => (
              <FnRow
                key={fnKey(fn)}
                fn={fn}
                kind="write"
                active={selectedKey === fnKey(fn)}
                onClick={() => onSelect(fn)}
              />
            ))}
          </FnGroup>
        )}
        {filtered.length === 0 && (
          <p className="px-1 py-6 text-center text-xs text-gray-500">
            {fns.length === 0
              ? "No callable functions found"
              : "No functions match your search"}
          </p>
        )}
      </div>
    </div>
  );
}

function FnGroup({
  label,
  count,
  children,
}: {
  label: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <h3 className="px-1 text-xs font-semibold tracking-wide text-gray-500 uppercase">
        {label} <span className="text-gray-600">({count})</span>
      </h3>
      <div className="flex flex-col gap-0.5">{children}</div>
    </div>
  );
}

function FnRow({
  fn,
  kind,
  active,
  onClick,
}: {
  fn: AbiFunction;
  kind: "read" | "write";
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={fn.name}
      className={`flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left font-mono text-xs transition ${
        active
          ? "bg-elevated text-gray-100 ring-1 ring-border"
          : "text-gray-300 hover:bg-elevated/60"
      }`}
    >
      <span className="truncate">{fn.name}</span>
      <span
        className={`shrink-0 rounded px-1 py-0.5 text-xs font-semibold uppercase ${
          kind === "read"
            ? "bg-success/15 text-success"
            : "bg-warning/15 text-warning"
        }`}
      >
        {kind}
      </span>
    </button>
  );
}
