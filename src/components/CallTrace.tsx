import { useState, useCallback } from "react";
import { formatEther } from "viem";
import type { TraceCall } from "../lib/trace";
import { countCalls, hasErrors } from "../lib/trace";
import type { AddressBook } from "../hooks/useAddressBook";
import { EXPLORER_URL } from "../config/chain";

type Props = {
  trace: TraceCall;
  book: AddressBook;
};

export function CallTrace({ trace, book }: Props) {
  const total = countCalls(trace);
  const errored = hasErrors(trace);
  const [useLabels, setUseLabels] = useState(true);
  const [showIO, setShowIO] = useState(false);

  return (
    <div className="space-y-3 rounded-lg border border-gray-800 bg-gradient-to-b from-gray-900/80 to-gray-950/80 p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-gray-100">Call Trace</h3>
        <span className="rounded-full bg-gray-800 px-2 py-0.5 text-[10px] font-medium text-gray-400">
          {total} calls
        </span>
        {errored && (
          <span className="rounded-full bg-red-900/60 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-red-400">
            reverted
          </span>
        )}
        <div className="ml-auto flex items-center gap-3">
          <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-gray-500 select-none">
            <input
              type="checkbox"
              checked={showIO}
              onChange={(e) => setShowIO(e.target.checked)}
              className="size-3 rounded border-gray-600 bg-gray-900 accent-cyan-600"
            />
            I/O data
          </label>
          <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-gray-500 select-none">
            <input
              type="checkbox"
              checked={useLabels}
              onChange={(e) => setUseLabels(e.target.checked)}
              className="size-3 rounded border-gray-600 bg-gray-900 accent-cyan-600"
            />
            Labels
          </label>
        </div>
      </div>
      <div className="overflow-x-auto">
        <TraceNode call={trace} isLast book={book} useLabels={useLabels} showIO={showIO} />
      </div>
    </div>
  );
}

function TraceAddress({
  address,
  book,
  useLabels,
  role,
}: {
  address: string;
  book: AddressBook;
  useLabels: boolean;
  role?: "from" | "to";
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

  const roleColor = role === "from" ? "text-orange-400/60" : "";

  return (
    <span className="inline-flex items-center gap-0.5">
      <span
        className={`cursor-pointer font-mono text-[11px] transition-colors ${
          copied
            ? "text-green-400"
            : hasLabel
              ? "rounded bg-cyan-900/30 px-1 py-0.5 text-cyan-300 hover:bg-cyan-900/50"
              : `${roleColor || "text-gray-400"} hover:text-gray-200`
        }`}
        title={copied ? "Copied!" : address}
        onClick={handleCopy}
      >
        {copied ? "copied" : display}
      </span>
      <a
        href={`${EXPLORER_URL}/address/${address}`}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="text-gray-700 transition-colors hover:text-cyan-400"
        title="View on PharosScan"
      >
        <svg className="size-2.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M6 2H3a1 1 0 00-1 1v10a1 1 0 001 1h10a1 1 0 001-1v-3M10 2h4m0 0v4m0-4L7 9" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </a>
    </span>
  );
}

function TraceNode({
  call,
  isLast,
  book,
  useLabels,
  showIO,
}: {
  call: TraceCall;
  isLast: boolean;
  book: AddressBook;
  useLabels: boolean;
  showIO: boolean;
}) {
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

  const fnSig = call.functionSig ?? (call.input?.length >= 10 ? call.input.slice(0, 10) : "");

  const hasInput = call.input && call.input !== "0x" && call.input.length > 2;
  const hasOutput = !isError && call.output && call.output !== "0x" && call.output.length > 2;

  return (
    <div className={`${call.depth > 0 ? "ml-3 border-l border-gray-800/60 pl-3 sm:ml-5 sm:pl-4" : ""}`}>
      <div
        className={`group flex cursor-pointer items-start gap-1.5 rounded-md px-1.5 py-1.5 transition-colors hover:bg-gray-800/30 ${
          isError ? "text-red-400" : "text-gray-300"
        }`}
        onClick={() => hasSubs && setExpanded(!expanded)}
      >
        {hasSubs ? (
          <span className={`mt-0.5 shrink-0 text-[10px] transition-transform ${expanded ? "" : "-rotate-90"} text-gray-500`}>
            ▼
          </span>
        ) : (
          <span className="mt-0.5 shrink-0 text-[10px] text-gray-700">
            {isLast ? "└" : "├"}
          </span>
        )}

        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <CallTypeBadge type={call.type} error={isError} />

            <TraceAddress address={call.from} book={book} useLabels={useLabels} role="from" />
            <span className="text-[10px] text-gray-600">→</span>
            <TraceAddress address={call.to} book={book} useLabels={useLabels} role="to" />

            <span className="text-gray-700">·</span>

            <span
              className={`font-mono text-xs font-semibold ${isError ? "text-red-300" : "text-cyan-300"}`}
              title={fnSig}
            >
              {fnName}
            </span>

            {hasValue && (
              <span className="rounded-full bg-yellow-900/40 px-1.5 py-0.5 text-[10px] font-medium text-yellow-400">
                {formatEther(valBigInt)} PHRS
              </span>
            )}

            <span className="rounded bg-gray-800/60 px-1 py-0.5 text-[9px] tabular-nums text-gray-600">
              {Number(call.gasUsed).toLocaleString()} gas
            </span>
          </div>

          {showIO && fnSig && (
            <div className="rounded bg-gray-950/60 px-2 py-1 ring-1 ring-gray-800/50">
              <p className="font-mono text-[10px] text-gray-500">{fnSig}</p>
            </div>
          )}

          {showIO && hasInput && (
            <HexDataBlock label="input" data={call.input} color="text-blue-400/70" />
          )}

          {showIO && hasOutput && (
            <HexDataBlock label="output" data={call.output!} color="text-emerald-400/70" />
          )}

          {isError && <ErrorInfo call={call} />}

          {!showIO && hasOutput && (
            <details className="mt-0.5" onClick={(e) => e.stopPropagation()}>
              <summary className="cursor-pointer text-[10px] text-gray-600 hover:text-gray-400">
                output
              </summary>
              <pre className="mt-0.5 max-h-16 overflow-auto break-all rounded bg-gray-950/50 p-1.5 font-mono text-[10px] text-gray-500 ring-1 ring-gray-800/50">
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
              showIO={showIO}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function HexDataBlock({ label, data, color }: { label: string; data: string; color: string }) {
  const [copied, setCopied] = useState(false);
  const maxShow = 200;
  const truncated = data.length > maxShow;
  const display = truncated ? data.slice(0, maxShow) + "…" : data;

  return (
    <div className="group/hex relative rounded bg-gray-950/60 px-2 py-1 ring-1 ring-gray-800/50" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-2">
        <span className={`shrink-0 text-[9px] font-bold uppercase tracking-wider ${color}`}>{label}</span>
        <span className="text-[9px] text-gray-700">{(data.length - 2) / 2} bytes</span>
        <button
          className="ml-auto text-[9px] text-gray-700 opacity-0 transition-opacity hover:text-gray-400 group-hover/hex:opacity-100"
          onClick={() => {
            navigator.clipboard.writeText(data);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
        >
          {copied ? "copied" : "copy"}
        </button>
      </div>
      <pre className="mt-0.5 max-h-20 overflow-auto break-all font-mono text-[10px] text-gray-600">
        {display}
      </pre>
    </div>
  );
}

function ErrorInfo({ call }: { call: TraceCall }) {
  const errorDisplay = call.errorSig ?? call.revertReason ?? call.error ?? "reverted";

  return (
    <div className="rounded-md bg-red-950/40 px-2 py-1.5 ring-1 ring-red-900/40">
      <p className="text-[11px] font-medium text-red-400">
        {errorDisplay}
      </p>
      {call.output && call.output !== "0x" && call.output.length > 10 && (
        <details className="mt-1" onClick={(e) => e.stopPropagation()}>
          <summary className="cursor-pointer text-[10px] text-red-500/70 hover:text-red-400">
            revert data
          </summary>
          <pre className="mt-0.5 max-h-20 overflow-auto break-all font-mono text-[10px] text-red-500/50">
            {call.output}
          </pre>
        </details>
      )}
    </div>
  );
}

function CallTypeBadge({ type, error }: { type: string; error: boolean }) {
  const colors = error
    ? "bg-red-900/60 text-red-400 ring-red-800/40"
    : type === "DELEGATECALL"
      ? "bg-purple-900/50 text-purple-400 ring-purple-800/30"
      : type === "STATICCALL"
        ? "bg-blue-900/50 text-blue-400 ring-blue-800/30"
        : type === "CREATE" || type === "CREATE2"
          ? "bg-green-900/50 text-green-400 ring-green-800/30"
          : "bg-gray-800/80 text-gray-400 ring-gray-700/40";

  return (
    <span
      className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ring-1 ${colors}`}
    >
      {type}
    </span>
  );
}
