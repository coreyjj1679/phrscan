import type { Abi } from "viem";
import { extractFunctions, isReadFunction, fnKey, type AbiFunction } from "../lib/abi";

type Props = {
  abi: Abi;
  selectedFn: AbiFunction | null;
  onSelect: (fn: AbiFunction) => void;
};

export function AbiViewer({ abi, selectedFn, onSelect }: Props) {
  const fns = extractFunctions(abi);
  const reads = fns.filter(isReadFunction);
  const writes = fns.filter((f) => !isReadFunction(f));

  return (
    <div className="space-y-3">
      {reads.length > 0 && (
        <div>
          <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-gray-500 uppercase">
            Read
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {reads.map((fn) => (
              <FnButton
                key={fnKey(fn)}
                fn={fn}
                active={selectedFn === fn}
                kind="read"
                onClick={() => onSelect(fn)}
              />
            ))}
          </div>
        </div>
      )}

      {writes.length > 0 && (
        <div>
          <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-gray-500 uppercase">
            Write (simulated)
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {writes.map((fn) => (
              <FnButton
                key={fnKey(fn)}
                fn={fn}
                active={selectedFn === fn}
                kind="write"
                onClick={() => onSelect(fn)}
              />
            ))}
          </div>
        </div>
      )}

      {fns.length === 0 && (
        <p className="text-xs text-gray-500">No callable functions found</p>
      )}
    </div>
  );
}

function FnButton({
  fn,
  active,
  kind,
  onClick,
}: {
  fn: AbiFunction;
  active: boolean;
  kind: "read" | "write";
  onClick: () => void;
}) {
  const base =
    kind === "read"
      ? "border-green-800 text-green-400 hover:bg-green-900/40"
      : "border-amber-800 text-amber-400 hover:bg-amber-900/40";
  const activeClass =
    kind === "read" ? "bg-green-900/60 ring-green-600" : "bg-amber-900/60 ring-amber-600";

  return (
    <button
      onClick={onClick}
      className={`rounded border px-2 py-1 font-mono text-xs transition ${base} ${
        active ? `ring-1 ${activeClass}` : ""
      }`}
    >
      {fn.name}
    </button>
  );
}
