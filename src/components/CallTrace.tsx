import { useState, useCallback, useMemo, useEffect, useId } from "react";
import { formatEther, type Abi } from "viem";
import type { TraceCall } from "../lib/trace";
import { countCalls, countErrors, countHandledReverts, normalizeTraceError } from "../lib/trace";
import type { DecodedError } from "../lib/decodeError";
import { decodeTraceInput, decodeTraceOutput, formatArgValue, type DecodedArg, type DecodedCall } from "../lib/decodeTrace";
import { ValueView } from "./ValueView";
import { getAbiRegistry } from "../lib/storage";
import { downloadJson } from "../lib/download";
import type { AddressBook } from "../hooks/useAddressBook";
import { EXPLORER_URL, CURRENCY } from "../config/chain";
import { useAddressMenu } from "../hooks/useAddressMenu";

type Props = {
  trace: TraceCall;
  book: AddressBook;
};

type ExpandMode = "auto" | "all" | "none";

export function CallTrace({ trace, book }: Props) {
  const total = countCalls(trace);
  const rootReverted = !!trace.error;
  const handledReverts = countHandledReverts(trace);
  const erroredFrames = countErrors(trace);
  const [useLabels, setUseLabels] = useState(true);
  const [showIO, setShowIO] = useState(false);
  const [mode, setMode] = useState<ExpandMode>(total > 40 ? "auto" : "all");
  const [signal, setSignal] = useState(0);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const registry = useMemo(() => getAbiRegistry(), []);
  const uid = useId();

  // Debounce the query that drives matching (clearing applies immediately so the
  // tree collapses back without lag); keeps typing responsive on large traces.
  useEffect(() => {
    if (query.trim() === "") {
      setDebouncedQuery("");
      return;
    }
    const t = setTimeout(() => setDebouncedQuery(query), 180);
    return () => clearTimeout(t);
  }, [query]);

  const setExpand = (m: ExpandMode) => {
    setMode(m);
    setSignal((n) => n + 1);
  };

  // Stable per-node ids (DFS order) used for match navigation and scrolling.
  const idMap = useMemo(() => {
    const m = new Map<TraceCall, number>();
    let i = 0;
    const walk = (n: TraceCall) => {
      m.set(n, i++);
      for (const c of n.calls ?? []) walk(c);
    };
    walk(trace);
    return m;
  }, [trace]);

  const matches = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase();
    if (!q) return [];
    const out: number[] = [];
    const walk = (n: TraceCall) => {
      if (nodeHaystack(n, book, registry).includes(q)) {
        const id = idMap.get(n);
        if (id !== undefined) out.push(id);
      }
      for (const c of n.calls ?? []) walk(c);
    };
    walk(trace);
    return out;
  }, [debouncedQuery, trace, book, registry, idMap]);

  const matchSet = useMemo(() => new Set(matches), [matches]);
  const clampedIndex = matches.length ? Math.min(activeIndex, matches.length - 1) : 0;
  const activeId = matches.length ? matches[clampedIndex] : null;

  // Reset the cursor to the first match whenever the (debounced) query changes.
  useEffect(() => {
    setActiveIndex(0);
  }, [debouncedQuery]);

  // Scroll the focused match into view (the tree is force-expanded while searching).
  useEffect(() => {
    if (activeId === null) return;
    document
      .getElementById(`${uid}-node-${activeId}`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeId, uid]);

  const go = (dir: 1 | -1) => {
    if (matches.length === 0) return;
    setActiveIndex((i) => {
      const base = Math.min(i, matches.length - 1);
      return (base + dir + matches.length) % matches.length;
    });
  };

  return (
    <div className="space-y-3 rounded-lg border border-border bg-surface p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-gray-100">Call Trace</h3>
        <span className="rounded-full bg-gray-800 px-2 py-0.5 text-xs font-medium text-gray-400">
          {total} calls
        </span>
        {rootReverted ? (
          <span className="rounded-full bg-red-900/60 px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-red-400">
            reverted
          </span>
        ) : handledReverts > 0 ? (
          <span
            title={`${handledReverts} call path${handledReverts !== 1 ? "s" : ""} reverted but ${handledReverts !== 1 ? "were" : "was"} caught (${erroredFrames} nested frames); the transaction itself succeeded.`}
            className="rounded-full bg-amber-900/40 px-2 py-0.5 text-xs font-medium text-amber-400"
          >
            {handledReverts} handled revert{handledReverts !== 1 ? "s" : ""}
          </span>
        ) : null}
        <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <button
            onClick={() => downloadJson("trace.json", trace)}
            className="text-xs text-gray-500 transition-colors hover:text-gray-300"
          >
            Export
          </button>
          <button
            onClick={() => setExpand("all")}
            className="text-xs text-gray-500 transition-colors hover:text-gray-300"
          >
            Expand all
          </button>
          <button
            onClick={() => setExpand("none")}
            className="text-xs text-gray-500 transition-colors hover:text-gray-300"
          >
            Collapse all
          </button>
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-gray-500 select-none">
            <input
              type="checkbox"
              checked={showIO}
              onChange={(e) => setShowIO(e.target.checked)}
              className="size-3 rounded border-gray-600 bg-gray-900 accent-cyan-600"
            />
            Decode I/O
          </label>
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-gray-500 select-none">
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
      {total > 1 && (
        <TraceSearch
          query={query}
          onQuery={setQuery}
          matchCount={matches.length}
          position={matches.length ? clampedIndex + 1 : 0}
          onNav={go}
        />
      )}
      {!rootReverted && handledReverts > 0 && (
        <p className="rounded-md bg-amber-950/30 px-2.5 py-1.5 text-xs text-amber-300/80 ring-1 ring-amber-900/30">
          {handledReverts} internal call path{handledReverts !== 1 ? "s" : ""} reverted but{" "}
          {handledReverts !== 1 ? "were" : "was"} caught — the transaction itself succeeded.
        </p>
      )}
      {rootReverted && <RevertBanner trace={trace} />}
      {erroredFrames > 0 && <FailuresSummary trace={trace} book={book} registry={registry} useLabels={useLabels} />}
      <div className="overflow-x-auto">
        <TraceNode
          key={signal}
          call={trace}
          book={book}
          useLabels={useLabels}
          showIO={showIO}
          registry={registry}
          mode={mode}
          rootGas={trace.gasUsed}
          uid={uid}
          idMap={idMap}
          matchSet={matchSet}
          activeId={activeId}
          forceExpand={matches.length > 0}
        />
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
  const { open } = useAddressMenu();
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
    <span className="inline-flex shrink-0 items-center gap-0.5">
      <span
        className={`max-w-40 cursor-pointer truncate font-mono text-xs transition-colors ${
          copied
            ? "text-green-400"
            : hasLabel
              ? "rounded bg-cyan-900/30 px-1 py-0.5 text-cyan-300 hover:bg-cyan-900/50"
              : "text-gray-400 hover:text-gray-200"
        }`}
        title={copied ? "Copied!" : address}
        onClick={handleCopy}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          open(address, e.clientX, e.clientY);
        }}
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
  book,
  useLabels,
  showIO,
  registry,
  mode,
  rootGas,
  uid,
  idMap,
  matchSet,
  activeId,
  forceExpand,
}: {
  call: TraceCall;
  book: AddressBook;
  useLabels: boolean;
  showIO: boolean;
  registry: Map<string, Abi>;
  mode: ExpandMode;
  rootGas: bigint;
  uid: string;
  idMap: Map<TraceCall, number>;
  matchSet: Set<number>;
  activeId: number | null;
  forceExpand: boolean;
}) {
  const decoded = useMemo(() => decodeTraceInput(call, registry), [call, registry]);
  const decodedOutput = useMemo(() => decodeTraceOutput(call, registry), [call, registry]);
  const hasSubs = !!call.calls && call.calls.length > 0;
  const isError = !!call.error;
  const valBigInt = BigInt(call.value);
  const hasValue = valBigInt > 0n;

  const nodeId = idMap.get(call);
  const isActive = nodeId !== undefined && nodeId === activeId;
  const isMatch = nodeId !== undefined && matchSet.has(nodeId);

  const initialExpanded = mode === "all" ? true : mode === "none" ? false : call.depth < 2;
  const [expanded, setExpanded] = useState(initialExpanded);
  const isExpanded = forceExpand || expanded;

  const fnName =
    decoded?.name ??
    (call.functionSig
      ? call.functionSig.replace(/\(.*$/, "")
      : call.input && call.input.length >= 10
        ? call.input.slice(0, 10)
        : "fallback");
  const fnSig = call.functionSig ?? (call.input && call.input.length >= 10 ? call.input.slice(0, 10) : "");
  const preview = argsPreview(decoded);
  const retPreview = returnsPreview(decodedOutput);

  const hasInput = !!call.input && call.input !== "0x" && call.input.length > 2;
  const hasOutput = !isError && !!call.output && call.output !== "0x" && call.output.length > 2;
  const showDetail = showIO && (!!decoded || hasInput || hasOutput);

  return (
    <div className={call.depth > 0 ? "ml-3 border-l border-gray-800/60 pl-2 sm:ml-4 sm:pl-3" : ""}>
      <div
        id={nodeId !== undefined ? `${uid}-node-${nodeId}` : undefined}
        className={`group flex cursor-pointer items-center gap-1.5 rounded px-1 py-1 transition-colors hover:bg-elevated/50 ${
          isActive
            ? "bg-cyan-900/40 ring-1 ring-cyan-600/50"
            : isMatch
              ? "bg-cyan-900/15"
              : ""
        } ${isError ? "text-red-400" : "text-gray-300"}`}
        onClick={() => hasSubs && setExpanded(!expanded)}
        title={`${call.from} → ${call.to}`}
      >
        {hasSubs ? (
          <span
            className={`shrink-0 text-gray-500 transition-transform ${isExpanded ? "" : "-rotate-90"}`}
          >
            <svg className="size-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </span>
        ) : (
          <span className="flex size-3 shrink-0 items-center justify-center">
            <span className="size-1 rounded-full bg-gray-700" />
          </span>
        )}

        {(call.type !== "CALL" || isError) && <CallTypeBadge type={call.type} error={isError} />}

        <span className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
          <TraceAddress address={call.to} book={book} useLabels={useLabels} />
          <span className="shrink-0 text-gray-700">.</span>
          <span
            className={`shrink-0 font-mono text-xs font-semibold ${isError ? "text-red-300" : "text-cyan-300"}`}
            title={fnSig}
          >
            {fnName}
          </span>
          {preview && (
            <span className="truncate font-mono text-xs text-gray-500">{preview}</span>
          )}
          {retPreview && (
            <span className="shrink-0 truncate font-mono text-xs text-emerald-500/70" title="return value">
              {"\u21D2"} {retPreview}
            </span>
          )}
        </span>

        {hasValue && (
          <span className="shrink-0 rounded-full bg-yellow-900/40 px-1.5 py-0.5 text-xs font-medium text-yellow-400">
            {formatEther(valBigInt)} {CURRENCY}
          </span>
        )}
        <GasBar used={call.gasUsed} total={rootGas} />
        <span
          className="shrink-0 tabular-nums text-xs text-gray-600"
          title={`${Number(call.gasUsed).toLocaleString()} gas`}
        >
          {Number(call.gasUsed).toLocaleString()}
        </span>
      </div>

      {showDetail && (
        <div className="mb-1 ml-5 space-y-1">
          {decoded && <DecodedParams decoded={decoded} book={book} />}
          {!decoded && hasInput && (
            <HexDataBlock label="input" data={call.input} color="text-blue-400/70" />
          )}
          {decodedOutput ? (
            <DecodedReturns outputs={decodedOutput} book={book} />
          ) : (
            hasOutput && (
              <HexDataBlock label="output" data={call.output!} color="text-emerald-400/70" />
            )
          )}
        </div>
      )}

      {isError && call.depth > 0 && (
        <div className="mb-1 ml-5">
          <ErrorInfo call={call} />
        </div>
      )}

      {isExpanded && hasSubs && (
        <div>
          {call.calls!.map((sub, i) => (
            <TraceNode
              key={i}
              call={sub}
              book={book}
              useLabels={useLabels}
              showIO={showIO}
              registry={registry}
              mode={mode}
              rootGas={rootGas}
              uid={uid}
              idMap={idMap}
              matchSet={matchSet}
              activeId={activeId}
              forceExpand={forceExpand}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function shortVal(v: unknown): string {
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "boolean") return String(v);
  if (typeof v === "string") {
    if (/^0x[0-9a-fA-F]{40}$/.test(v)) return v.slice(0, 6) + "…" + v.slice(-4);
    if (v.startsWith("0x") && v.length > 18) return v.slice(0, 10) + "…";
    if (v.length > 24) return v.slice(0, 22) + "…";
    return v;
  }
  if (Array.isArray(v)) return `[${v.length}]`;
  if (v && typeof v === "object") return "{…}";
  return String(v);
}

function argsPreview(decoded: DecodedCall | null): string {
  if (!decoded) return "";
  if (decoded.args.length === 0) return "()";
  const s = "(" + decoded.args.map((a) => shortVal(a.value)).join(", ") + ")";
  return s.length > 72 ? s.slice(0, 71) + "…)" : s;
}

/** Compact one-line summary of decoded return values for the collapsed row. */
function returnsPreview(outputs: DecodedArg[] | null): string {
  if (!outputs || outputs.length === 0) return "";
  const inner = outputs.map((o) => shortVal(o.value)).join(", ");
  const s = outputs.length === 1 ? inner : `(${inner})`;
  return s.length > 40 ? s.slice(0, 39) + "…" : s;
}

/** A thin bar showing this frame's gasUsed relative to the whole transaction. */
function GasBar({ used, total }: { used: bigint; total: bigint }) {
  if (total <= 0n) return null;
  const pct = Math.max(0, Math.min(100, Number((used * 10000n) / total) / 100));
  return (
    <span
      className="hidden h-1.5 w-12 shrink-0 overflow-hidden rounded-full bg-gray-800/80 sm:block"
      title={`${pct.toFixed(1)}% of total gas`}
    >
      <span
        className="block h-full rounded-full bg-cyan-600/60"
        style={{ width: `${Math.max(pct, used > 0n ? 3 : 0)}%` }}
      />
    </span>
  );
}

/** Searchable text for a call frame: type, addresses, label, function, args. */
function nodeHaystack(call: TraceCall, book: AddressBook, registry: Map<string, Abi>): string {
  const parts: string[] = [call.type, call.to ?? "", call.from ?? ""];
  if (call.to) {
    const label = book.resolve(call.to);
    if (label) parts.push(label);
  }
  const decoded = decodeTraceInput(call, registry);
  if (decoded?.name) parts.push(decoded.name);
  if (call.functionSig) parts.push(call.functionSig);
  if (decoded) parts.push(argsPreview(decoded));
  return parts.join(" ").toLowerCase();
}

/** Search box + match navigator for the call trace. */
function TraceSearch({
  query,
  onQuery,
  matchCount,
  position,
  onNav,
}: {
  query: string;
  onQuery: (q: string) => void;
  matchCount: number;
  position: number;
  onNav: (dir: 1 | -1) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="relative w-full sm:w-52">
        <svg
          className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-gray-500"
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
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onNav(e.shiftKey ? -1 : 1);
            } else if (e.key === "Escape") {
              onQuery("");
            }
          }}
          placeholder="Search calls: address, function…"
          spellCheck={false}
          className="w-full rounded bg-gray-900 py-1 pr-6 pl-7 text-xs text-gray-300 outline-none ring-1 ring-gray-700 focus:ring-cyan-600"
        />
        {query && (
          <button
            type="button"
            onClick={() => onQuery("")}
            aria-label="Clear search"
            className="absolute top-1/2 right-1.5 -translate-y-1/2 text-gray-600 hover:text-gray-300"
          >
            <svg className="size-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        )}
      </div>
      {query && (
        <div className="flex shrink-0 items-center gap-1 text-xs text-gray-500">
          <span className="tabular-nums">
            {position}/{matchCount}
          </span>
          <button
            type="button"
            onClick={() => onNav(-1)}
            disabled={matchCount === 0}
            aria-label="Previous match"
            className="rounded p-0.5 transition-colors hover:bg-elevated hover:text-gray-300 disabled:opacity-30"
          >
            <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="m18 15-6-6-6 6" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => onNav(1)}
            disabled={matchCount === 0}
            aria-label="Next match"
            className="rounded p-0.5 transition-colors hover:bg-elevated hover:text-gray-300 disabled:opacity-30"
          >
            <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}

function DecodedParams({ decoded, book }: { decoded: DecodedCall; book: AddressBook }) {
  return (
    <div
      className="space-y-1 rounded bg-gray-950/60 px-2 py-1.5 ring-1 ring-gray-800/50"
      onClick={(e) => e.stopPropagation()}
    >
      <p className="font-mono text-xs">
        <span className="text-cyan-300">{decoded.name}</span>
        <span className="text-gray-600">({decoded.args.length})</span>
      </p>
      {decoded.args.map((arg, i) => (
        <DecodedParamRow key={i} index={i} arg={arg} book={book} />
      ))}
      {decoded.args.length === 0 && (
        <p className="text-xs text-gray-600">no arguments</p>
      )}
    </div>
  );
}

/** Tuples and arrays render as multi-line blocks; everything else stays inline. */
function isComplexArg(v: unknown): boolean {
  return Array.isArray(v) || (typeof v === "object" && v !== null);
}

function DecodedParamRow({ index, arg, book }: { index: number; arg: DecodedArg; book: AddressBook }) {
  const label = (
    <span className="shrink-0 text-gray-600">
      {arg.name || `[${index}]`}
      {arg.type && <span className="ml-1 text-gray-700">{arg.type}</span>}
    </span>
  );

  if (isComplexArg(arg.value)) {
    return (
      <div className="text-xs">
        {label}
        <div className="mt-0.5 border-l border-gray-800/70 pl-2 font-mono">
          <ValueView value={arg.value} book={book} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-2 text-xs">
      {label}
      <div className="min-w-0 break-all font-mono">
        <ValueView value={arg.value} book={book} />
      </div>
    </div>
  );
}

function DecodedReturns({ outputs, book }: { outputs: DecodedArg[]; book: AddressBook }) {
  return (
    <div
      className="space-y-1 rounded bg-gray-950/60 px-2 py-1.5 ring-1 ring-emerald-900/30"
      onClick={(e) => e.stopPropagation()}
    >
      <p className="font-mono text-xs">
        <span className="text-emerald-400/80">returns</span>
        <span className="text-gray-600">({outputs.length})</span>
      </p>
      {outputs.map((arg, i) => (
        <DecodedParamRow key={i} index={i} arg={arg} book={book} />
      ))}
    </div>
  );
}

/** Innermost reverting frames — the actual origins of each revert (not the
 *  parents that merely propagated it). */
function collectRevertOrigins(trace: TraceCall): TraceCall[] {
  const out: TraceCall[] = [];
  const walk = (n: TraceCall) => {
    const childErrored = (n.calls ?? []).some((c) => c.error);
    if (n.error && !childErrored) out.push(n);
    for (const c of n.calls ?? []) walk(c);
  };
  walk(trace);
  return out;
}

function frameFnName(call: TraceCall, registry: Map<string, Abi>): string {
  const decoded = decodeTraceInput(call, registry);
  if (decoded?.name) return decoded.name;
  if (call.functionSig) return call.functionSig.replace(/\(.*$/, "");
  if (call.input && call.input.length >= 10) return call.input.slice(0, 10);
  return "fallback";
}

function frameReason(call: TraceCall): string {
  if (call.decodedError) return errorHeadline(call.decodedError);
  return call.errorSig ?? call.revertReason ?? normalizeTraceError(call.error) ?? "reverted";
}

/** Collapsible list summarizing every revert origin in the trace. */
function FailuresSummary({
  trace,
  book,
  registry,
  useLabels,
}: {
  trace: TraceCall;
  book: AddressBook;
  registry: Map<string, Abi>;
  useLabels: boolean;
}) {
  const origins = useMemo(() => collectRevertOrigins(trace), [trace]);
  if (origins.length === 0) return null;

  return (
    <details className="overflow-hidden rounded-md bg-red-950/20 ring-1 ring-red-900/30">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs">
        <svg className="size-3.5 shrink-0 text-red-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 9v4M12 17h.01M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.7 3.86a2 2 0 0 0-3.42 0Z" />
        </svg>
        <span className="font-semibold text-red-300">
          {origins.length} failure{origins.length !== 1 ? "s" : ""}
        </span>
        <span className="text-gray-600">— innermost reverts</span>
      </summary>
      <div className="space-y-1.5 border-t border-red-900/30 px-3 py-2">
        {origins.map((c, i) => (
          <div key={i} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
            <TraceAddress address={c.to} book={book} useLabels={useLabels} />
            <span className="text-gray-700">.</span>
            <span className="font-mono font-semibold text-red-300">{frameFnName(c, registry)}</span>
            <span className="min-w-0 text-red-400/70">— {frameReason(c)}</span>
          </div>
        ))}
      </div>
    </details>
  );
}

function HexDataBlock({ label, data, color }: { label: string; data: string; color: string }) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const previewLen = 138;
  const long = data.length > previewLen;
  const display = expanded || !long ? data : data.slice(0, previewLen) + "…";

  return (
    <div className="rounded bg-gray-950/60 px-2 py-1 ring-1 ring-gray-800/50" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-2">
        <span className={`shrink-0 text-xs font-bold uppercase tracking-wider ${color}`}>{label}</span>
        <span className="text-xs text-gray-700">{(data.length - 2) / 2} bytes</span>
        {long && (
          <button
            className="text-xs text-gray-500 transition-colors hover:text-gray-300"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? "collapse" : "expand"}
          </button>
        )}
        <button
          className="ml-auto text-xs text-gray-600 transition-colors hover:text-gray-300"
          onClick={() => {
            navigator.clipboard.writeText(data);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
        >
          {copied ? "copied" : "copy"}
        </button>
      </div>
      <pre
        className={`mt-0.5 font-mono text-xs break-all whitespace-pre-wrap text-gray-500 ${
          expanded ? "max-h-72 overflow-y-auto" : ""
        }`}
      >
        {display}
      </pre>
    </div>
  );
}

/** Concise one-line summary of a decoded revert reason. */
function errorHeadline(d: DecodedError): string {
  switch (d.kind) {
    case "string":
      return d.reason || "Reverted";
    case "panic":
      return d.reason || "Panic";
    case "custom":
      return d.name || d.signature || "Custom error";
    case "empty":
      return "Reverted with no reason";
    case "unknown":
      return d.selector ? `Unknown error ${d.selector}` : "Unknown error";
    default:
      return "Reverted";
  }
}

function sourceBadge(source?: DecodedError["source"]): { label: string; cls: string } {
  if (source === "abi") return { label: "saved ABI", cls: "bg-green-900/50 text-green-400" };
  if (source === "4byte") return { label: "4byte", cls: "bg-blue-900/50 text-blue-400" };
  return { label: "builtin", cls: "bg-gray-700 text-gray-300" };
}

function ErrorArgsTable({ args }: { args: NonNullable<DecodedError["args"]> }) {
  return (
    <div className="space-y-0.5">
      {args.map((a, i) => (
        <div key={i} className="flex gap-2 text-xs">
          <span className="shrink-0 text-red-400/50">
            {a.name || `[${i}]`}
            {a.type && <span className="ml-1 text-red-400/30">{a.type}</span>}
          </span>
          <span className="min-w-0 break-all font-mono text-red-300">
            {formatArgValue(a.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Supplementary detail for a decoded error (signature, args, unknown candidates). */
function DecodedErrorDetails({ decoded }: { decoded: DecodedError }) {
  return (
    <>
      {decoded.kind === "empty" && decoded.reason && (
        <p className="text-xs text-red-300/70">{decoded.reason}</p>
      )}
      {decoded.kind === "custom" && decoded.signature && (
        <p className="break-all font-mono text-xs text-red-400/60">{decoded.signature}</p>
      )}
      {decoded.args && decoded.args.length > 0 && <ErrorArgsTable args={decoded.args} />}
      {decoded.kind === "unknown" && (
        <p className="text-xs text-red-400/70">
          No signature matched
          {decoded.candidates && decoded.candidates.length > 0
            ? ` (tried ${decoded.candidates.join(", ")})`
            : ""}
          .
        </p>
      )}
    </>
  );
}

function RawRevertData({ data }: { data: string }) {
  return (
    <details className="mt-0.5" onClick={(e) => e.stopPropagation()}>
      <summary className="cursor-pointer text-xs text-red-500/70 hover:text-red-400">
        revert data
      </summary>
      <pre className="mt-0.5 max-h-72 overflow-y-auto break-all whitespace-pre-wrap font-mono text-xs text-red-500/50">
        {data}
      </pre>
    </details>
  );
}

/** Prominent top-of-trace summary of why the transaction reverted. */
function RevertBanner({ trace }: { trace: TraceCall }) {
  const decoded = trace.decodedError;
  const rawData = trace.revertData ?? trace.output;
  const badge =
    decoded?.kind === "custom" ? sourceBadge(decoded.source) : null;

  return (
    <div className="space-y-1.5 rounded-md bg-red-950/40 px-3 py-2.5 ring-1 ring-red-900/50">
      <div className="flex flex-wrap items-center gap-2">
        <svg className="size-3.5 shrink-0 text-red-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 9v4M12 17h.01M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.7 3.86a2 2 0 0 0-3.42 0Z" />
        </svg>
        <span className="text-sm font-semibold text-red-300">
          {decoded ? errorHeadline(decoded) : normalizeTraceError(trace.error) ?? "reverted"}
        </span>
        {badge && (
          <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${badge.cls}`}>
            {badge.label}
          </span>
        )}
        {decoded && trace.revertRecovered && (
          <span
            title="The node omits revert data from traces, so this reason was recovered by replaying the transaction as an eth_call at its block. State may differ from the original execution."
            className="rounded bg-gray-800 px-1.5 py-0.5 text-xs font-medium text-gray-400"
          >
            re-simulated
          </span>
        )}
      </div>
      {decoded ? (
        <DecodedErrorDetails decoded={decoded} />
      ) : (
        <p className="text-xs text-red-400/70">
          Reason couldn&rsquo;t be recovered — the node omits revert data, and re-simulating
          at this block didn&rsquo;t reproduce a revert (state may have changed since).
        </p>
      )}
      {rawData && rawData !== "0x" && rawData.length > 10 && <RawRevertData data={rawData} />}
    </div>
  );
}

function ErrorInfo({ call }: { call: TraceCall }) {
  const decoded = call.decodedError;
  const headline = decoded
    ? errorHeadline(decoded)
    : call.errorSig ?? call.revertReason ?? normalizeTraceError(call.error) ?? "reverted";
  const rawData = call.revertData ?? call.output;

  return (
    <div className="rounded-md bg-red-950/40 px-2 py-1.5 ring-1 ring-red-900/40">
      <p className="text-xs font-medium text-red-400">{headline}</p>
      {decoded && (decoded.kind === "custom" || decoded.kind === "unknown") && (
        <div className="mt-1">
          <DecodedErrorDetails decoded={decoded} />
        </div>
      )}
      {rawData && rawData !== "0x" && rawData.length > 10 && <RawRevertData data={rawData} />}
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
      className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-bold uppercase tracking-wide ring-1 ${colors}`}
    >
      {type}
    </span>
  );
}
