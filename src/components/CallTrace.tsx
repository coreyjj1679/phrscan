import { useState, useCallback } from "react";
import { formatEther } from "viem";
import type { TraceCall } from "../lib/trace";
import { countCalls, hasErrors } from "../lib/trace";
import type { AddressBook } from "../hooks/useAddressBook";

type Props = {
  trace: TraceCall;
  book: AddressBook;
};

export function CallTrace({ trace, book }: Props) {
  const total = countCalls(trace);
  const errored = hasErrors(trace);
  const [useLabels, setUseLabels] = useState(true);

  return (
    <div className="space-y-2 rounded bg-gray-900/50 p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-gray-200">Call Trace</h3>
        <span className="text-[11px] text-gray-500">{total} calls</span>
        {errored && (
          <span className="rounded bg-red-900/50 px-1.5 py-0.5 text-[10px] font-bold uppercase text-red-400">
            reverted
          </span>
        )}
        <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-[11px] text-gray-500 select-none">
          <input
            type="checkbox"
            checked={useLabels}
            onChange={(e) => setUseLabels(e.target.checked)}
            className="size-3 rounded border-gray-600 bg-gray-900 accent-cyan-600"
          />
          Use labels
        </label>
      </div>
      <div className="overflow-x-auto">
        <TraceNode call={trace} isLast book={book} useLabels={useLabels} />
      </div>
    </div>
  );
}

function TraceAddress({
  address,
  book,
  useLabels,
}: {
  address: string;
  book: AddressBook;
  useLabels: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const label = book.resolve(address);
  const short =
    address.length >= 10
      ? address.slice(0, 6) + "\u2026" + address.slice(-4)
      : address;

  const display = useLabels && label ? label : short;
  const hasLabel = useLabels && !!label;

  const handleCopy = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      navigator.clipboard.writeText(address).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      });
    },
    [address],
  );

  return (
    <span
      className={`cursor-pointer font-mono text-[11px] transition-colors ${
        copied
          ? "text-green-400"
          : hasLabel
            ? "rounded bg-cyan-900/30 px-1 py-0.5 text-cyan-300 hover:bg-cyan-900/50"
            : "text-gray-500 hover:text-gray-300"
      }`}
      title={copied ? "Copied!" : address}
      onClick={handleCopy}
    >
      {copied ? "copied" : display}
    </span>
  );
}

function TraceNode({ call, isLast, book, useLabels }: { call: TraceCall; isLast: boolean; book: AddressBook; useLabels: boolean }) {
  const [expanded, setExpanded] = useState(true);
  const hasSubs = call.calls && call.calls.length > 0;
  const isError = !!call.error;
  const valBigInt = BigInt(call.value);
  const hasValue = valBigInt > 0n;

  const fnName = call.functionSig
    ? call.functionSig.replace(/\(.*$/, "")
    : call.input?.length >= 10
      ? call.input.slice(0, 10)
      : "fallback";

  return (
    <div className={`${call.depth > 0 ? "ml-2 border-l border-gray-800 pl-2 sm:ml-4 sm:pl-3" : ""}`}>
      <div
        className={`group flex cursor-pointer items-start gap-1.5 py-1 ${
          isError ? "text-red-400" : "text-gray-300"
        }`}
        onClick={() => hasSubs && setExpanded(!expanded)}
      >
        {hasSubs ? (
          <span className="mt-0.5 shrink-0 text-[10px] text-gray-600">
            {expanded ? "▼" : "▶"}
          </span>
        ) : (
          <span className="mt-0.5 shrink-0 text-[10px] text-gray-700">
            {isLast ? "└" : "├"}
          </span>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <CallTypeBadge type={call.type} error={isError} />

            <TraceAddress address={call.to} book={book} useLabels={useLabels} />

            <span className="text-gray-600">.</span>

            <span
              className={`font-mono text-xs font-medium ${isError ? "text-red-300" : "text-cyan-300"}`}
              title={call.functionSig ?? call.input?.slice(0, 10)}
            >
              {fnName}
            </span>

            {hasValue && (
              <span className="rounded bg-yellow-900/40 px-1 py-0.5 text-[10px] text-yellow-400">
                {formatEther(valBigInt)} PHRS
              </span>
            )}

            <span className="text-[10px] text-gray-600">
              {Number(call.gasUsed).toLocaleString()} gas
            </span>
          </div>

          {isError && (
            <ErrorInfo call={call} />
          )}

          {!isError && call.output && call.output !== "0x" && call.output.length > 2 && (
            <details className="mt-0.5">
              <summary className="cursor-pointer text-[10px] text-gray-600 hover:text-gray-400">
                output
              </summary>
              <pre className="mt-0.5 max-h-16 overflow-auto break-all font-mono text-[10px] text-gray-500">
                {call.output}
              </pre>
            </details>
          )}
        </div>
      </div>

      {expanded && hasSubs && (
        <div>
          {call.calls!.map((sub, i) => (
            <TraceNode
              key={i}
              call={sub}
              isLast={i === call.calls!.length - 1}
              book={book}
              useLabels={useLabels}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ErrorInfo({ call }: { call: TraceCall }) {
  const errorDisplay = call.errorSig ?? call.revertReason ?? call.error ?? "reverted";

  return (
    <div className="mt-1 rounded bg-red-950/50 px-2 py-1.5 ring-1 ring-red-900/50">
      <p className="text-[11px] font-medium text-red-400">
        {errorDisplay}
      </p>
      {call.output && call.output !== "0x" && call.output.length > 10 && (
        <details className="mt-1">
          <summary className="cursor-pointer text-[10px] text-red-500/70 hover:text-red-400">
            revert data
          </summary>
          <pre className="mt-0.5 max-h-20 overflow-auto break-all font-mono text-[10px] text-red-500/60">
            {call.output}
          </pre>
        </details>
      )}
    </div>
  );
}

function CallTypeBadge({ type, error }: { type: string; error: boolean }) {
  const colors = error
    ? "bg-red-900/50 text-red-400"
    : type === "DELEGATECALL"
      ? "bg-purple-900/50 text-purple-400"
      : type === "STATICCALL"
        ? "bg-blue-900/50 text-blue-400"
        : type === "CREATE" || type === "CREATE2"
          ? "bg-green-900/50 text-green-400"
          : "bg-gray-800 text-gray-400";

  return (
    <span
      className={`shrink-0 rounded px-1 py-0.5 text-[9px] font-bold uppercase ${colors}`}
    >
      {type}
    </span>
  );
}

