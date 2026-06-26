import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { decodeEventLog, type Abi, type Hex } from "viem";
import {
  startReplay,
  buildFrames,
  resolveFrameSignatures,
  resolveLogSignatures,
  stepGasCost,
  type OpcodeStep,
  type ReplayResult,
  type ReplayFrame,
  type ReplayHandle,
} from "../lib/evmReplay";
import { ACTIVE_NETWORK } from "../config/chain";
import { getAbiRegistry } from "../lib/storage";
import { decodeTraceInput, formatArgValue } from "../lib/decodeTrace";
import type { TraceCall } from "../lib/trace";
import { decodeRevert, type DecodedError } from "../lib/decodeError";
import { AddressLabel } from "./AddressLabel";
import type { AddressBook } from "../hooks/useAddressBook";

type Props = {
  tx: {
    from: string;
    to: string;
    data: string;
    value: string;
    blockNumber: string;
    gasLimit: string;
  };
  rpcUrl: string;
  book: AddressBook;
};

type Status = "idle" | "running" | "done" | "error";

const ROW_H = 22;
const VIEWPORT_H = 460;
const CALL_OPS = new Set(["CALL", "DELEGATECALL", "STATICCALL", "CALLCODE", "CREATE", "CREATE2"]);

/** Opcodes worth showing when "key steps only" is on (state, calls, logs, exits). */
const KEY_OPS = new Set([
  "SLOAD", "SSTORE", "TLOAD", "TSTORE",
  "LOG0", "LOG1", "LOG2", "LOG3", "LOG4",
  "CALL", "DELEGATECALL", "STATICCALL", "CALLCODE",
  "CREATE", "CREATE2", "SELFDESTRUCT",
  "REVERT", "RETURN", "STOP", "INVALID",
]);

function isKeyStep(s: OpcodeStep): boolean {
  return KEY_OPS.has(s.op) || !!s.isRevert;
}

export function OpcodeDebugger({ tx, rpcUrl, book }: Props) {
  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState<{ steps: number; rpcCalls: number }>({
    steps: 0,
    rpcCalls: 0,
  });
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<ReplayResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const handleRef = useRef<ReplayHandle | null>(null);
  const startRef = useRef(0);

  useEffect(() => {
    if (status !== "running") return;
    const id = setInterval(() => setElapsed(Date.now() - startRef.current), 100);
    return () => clearInterval(id);
  }, [status]);

  const run = useCallback(() => {
    setStatus("running");
    setProgress({ steps: 0, rpcCalls: 0 });
    setElapsed(0);
    startRef.current = Date.now();
    setError(null);
    setResult(null);

    const handle = startReplay(
      {
        rpcUrl,
        chainId: ACTIVE_NETWORK.chainId,
        from: tx.from,
        to: tx.to,
        data: tx.data,
        value: tx.value,
        gas: "0x" + BigInt(tx.gasLimit || "0").toString(16),
        blockNumber: BigInt(tx.blockNumber || "0"),
      },
      (p) => setProgress(p),
    );
    handleRef.current = handle;

    handle.promise
      .then((r) => {
        setResult(r);
        setStatus("done");
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
        setStatus("error");
      });
  }, [rpcUrl, tx]);

  const cancel = useCallback(() => {
    handleRef.current?.cancel();
    setStatus("idle");
  }, []);

  return (
    <div className="space-y-3 rounded-lg border border-border bg-surface p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-gray-100">Opcode Debugger</h3>
        <span className="rounded-full bg-fuchsia-900/40 px-2 py-0.5 text-xs font-medium text-fuchsia-300 ring-1 ring-fuchsia-800/40">
          beta
        </span>
        {status === "done" && result && (
          <span className="rounded-full bg-gray-800 px-2 py-0.5 text-xs font-medium text-gray-400">
            {result.steps.length.toLocaleString()} steps
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {status === "running" ? (
            <button
              onClick={cancel}
              className="rounded bg-gray-800 px-2.5 py-1 text-xs text-gray-300 hover:bg-gray-700"
            >
              Cancel
            </button>
          ) : (
            <button
              onClick={run}
              className="rounded bg-fuchsia-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-fuchsia-600"
            >
              {status === "done" || status === "error" ? "Re-run" : "Run replay"}
            </button>
          )}
        </div>
      </div>

      {status === "idle" && (
        <p className="text-xs leading-relaxed text-gray-500">
          Re-executes this transaction step-by-step in a local EVM (the node has no
          opcode tracer), reading state live at the parent block. Start with the call
          tree, then drill into any frame&rsquo;s opcodes. Gas uses Cancun rules and may
          differ slightly from this chain.
        </p>
      )}

      {status === "error" && (
        <p className="rounded-md bg-red-950/40 px-3 py-2 text-xs text-red-300 ring-1 ring-red-900/40">
          Replay failed: {error}
        </p>
      )}

      {status === "running" && <ReplayProgressBar progress={progress} elapsed={elapsed} />}

      {status === "done" && result && <ReplayView result={result} tx={tx} book={book} />}
    </div>
  );
}

function ReplayProgressBar({
  progress,
  elapsed,
}: {
  progress: { steps: number; rpcCalls: number };
  elapsed: number;
}) {
  // We can't know the total step count up front, so ease smoothly toward ~92%
  // based on elapsed time; the live counters below give the real signal.
  const pct = Math.min(92, 92 * (1 - Math.exp(-elapsed / 1500)));
  const phase =
    progress.steps > 0 ? "Executing opcodes" : progress.rpcCalls > 0 ? "Fetching state" : "Starting EVM";

  return (
    <div className="space-y-1.5">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-800">
        <div
          className="h-full rounded-full bg-linear-to-r from-fuchsia-600 to-fuchsia-400 transition-[width] duration-200 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-gray-500">
        <span className="text-fuchsia-300/80">{phase}…</span>
        <span className="tabular-nums">{progress.steps.toLocaleString()} steps</span>
        <span className="text-gray-700">·</span>
        <span className="tabular-nums">{progress.rpcCalls.toLocaleString()} state reads</span>
        <span className="ml-auto tabular-nums">{(elapsed / 1000).toFixed(1)}s</span>
      </div>
    </div>
  );
}

/* ─── Frame helpers ─────────────────────────────────────────── */

type DecodedEvent = { eventName: string; args: { name?: string; type: string; value: unknown }[] };

type AbiEventItem = { type: string; name?: string; inputs?: { name?: string; type: string }[] };

/** Decode a captured LOG against saved ABIs (emitter first), like receipt events. */
function decodeStepLog(
  log: NonNullable<OpcodeStep["log"]>,
  registry: Map<string, Abi>,
): DecodedEvent | null {
  if (log.topics.length === 0) return null;
  const topics = log.topics as [Hex, ...Hex[]];
  const data = (log.data || "0x") as Hex;
  const emitter = registry.get(log.address.toLowerCase());
  const abis = emitter
    ? [emitter, ...[...registry.values()].filter((a) => a !== emitter)]
    : [...registry.values()];
  for (const abi of abis) {
    try {
      const d = decodeEventLog({ abi, data, topics });
      const item = (abi as unknown as AbiEventItem[]).find(
        (i) => i.type === "event" && i.name === d.eventName,
      );
      const inputs = item?.inputs ?? [];
      const a = (d.args ?? {}) as Record<string, unknown> | unknown[];
      const args = inputs.map((inp, i) => ({
        name: inp.name,
        type: inp.type,
        value: Array.isArray(a) ? a[i] : a[inp.name ?? String(i)],
      }));
      return { eventName: d.eventName ?? "Event", args };
    } catch {
      // ABI didn't match — try next
    }
  }
  return null;
}

/** Event name for a LOG: decoded name, else 4byte signature name, else "LOGn". */
function logName(
  step: OpcodeStep,
  decoded: DecodedEvent | null,
  eventSigs: Map<string, string>,
): string {
  if (decoded) return decoded.eventName;
  const topic0 = step.log?.topics[0]?.toLowerCase();
  const sig = topic0 ? eventSigs.get(topic0) : undefined;
  if (sig) return sig.replace(/\(.*$/, "");
  return step.op;
}

/** Render a 32-byte storage word as an address, small integer, or trimmed hex. */
function formatWord(hex: string): string {
  const h = (hex.startsWith("0x") ? hex.slice(2) : hex).padStart(64, "0").toLowerCase();
  if (/^0{24}[0-9a-f]{40}$/.test(h) && !/^0+$/.test(h)) return "0x" + h.slice(24);
  const n = BigInt("0x" + h);
  if (n < 10n ** 21n) return n.toString();
  return "0x" + (h.replace(/^0+/, "") || "0");
}

function shortVal(v: unknown): string {
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "boolean") return String(v);
  if (typeof v === "string") {
    if (/^0x[0-9a-fA-F]{40}$/.test(v)) return v.slice(0, 6) + "…" + v.slice(-4);
    if (v.startsWith("0x") && v.length > 18) return v.slice(0, 10) + "…";
    if (v.length > 20) return v.slice(0, 18) + "…";
    return v;
  }
  if (Array.isArray(v)) return `[${v.length}]`;
  if (v && typeof v === "object") return "{…}";
  return String(v);
}

function frameDecode(
  frame: ReplayFrame,
  registry: Map<string, Abi>,
  sigMap: Map<string, string>,
): { name: string; preview: string } {
  if (frame.type === "CREATE" || frame.type === "CREATE2") return { name: "constructor", preview: "" };
  if (!frame.input || frame.input.length < 10) {
    const hasVal = !!frame.value && frame.value !== "0x0" && frame.value !== "0";
    return { name: hasVal ? "(value transfer)" : "(fallback)", preview: "" };
  }
  const sig = sigMap.get(frame.input.slice(0, 10).toLowerCase());
  const decoded = decodeTraceInput(
    { to: frame.to, input: frame.input, functionSig: sig } as unknown as TraceCall,
    registry,
  );
  const name = decoded?.name ?? (sig ? sig.replace(/\(.*$/, "") : frame.input.slice(0, 10));
  let preview = "";
  if (decoded) {
    preview =
      decoded.args.length === 0
        ? "()"
        : "(" + decoded.args.map((a) => shortVal(a.value)).join(", ") + ")";
    if (preview.length > 64) preview = preview.slice(0, 63) + "…)";
  }
  return { name, preview };
}

function frameLabel(
  frame: ReplayFrame,
  registry: Map<string, Abi>,
  sigMap: Map<string, string>,
): string {
  return frameDecode(frame, registry, sigMap).name;
}

/** Deepest frame whose opcode range contains `stepIndex`. */
function frameOfStep(frames: ReplayFrame[], stepIndex: number): ReplayFrame {
  let best = frames[0];
  for (const f of frames) {
    if (stepIndex >= f.startIndex && stepIndex <= f.endIndex && f.depth >= best.depth) {
      best = f;
    }
  }
  return best;
}

function framePath(frames: ReplayFrame[], frame: ReplayFrame): ReplayFrame[] {
  const path: ReplayFrame[] = [];
  let cur: ReplayFrame | undefined = frame;
  while (cur) {
    path.unshift(cur);
    cur = cur.parentId !== null ? frames[cur.parentId] : undefined;
  }
  return path;
}

/** The step where a reverted frame actually hit REVERT (last one in its range). */
function revertStepOf(steps: OpcodeStep[], frame: ReplayFrame): number {
  for (let i = frame.endIndex; i >= frame.startIndex; i--) {
    if (steps[i]?.isRevert && steps[i].depth === frame.depth) return i;
  }
  return frame.startIndex;
}

/* ─── Replay view ───────────────────────────────────────────── */

function ReplayView({
  result,
  tx,
  book,
}: {
  result: ReplayResult;
  tx: Props["tx"];
  book: AddressBook;
}) {
  const { steps } = result;
  const registry = useMemo(() => getAbiRegistry(), []);
  const frames = useMemo(
    () => buildFrames(steps, { to: tx.to, input: tx.data, value: tx.value }),
    [steps, tx],
  );

  const [sigMap, setSigMap] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    let on = true;
    resolveFrameSignatures(frames).then((m) => on && setSigMap(m));
    return () => {
      on = false;
    };
  }, [frames]);

  const [revert, setRevert] = useState<DecodedError | null>(null);
  useEffect(() => {
    if (!result.reverted) return;
    let on = true;
    decodeRevert(result.returnValue).then((d) => on && setRevert(d));
    return () => {
      on = false;
    };
  }, [result]);

  const [eventSigs, setEventSigs] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    let on = true;
    resolveLogSignatures(steps).then((m) => on && setEventSigs(m));
    return () => {
      on = false;
    };
  }, [steps]);

  const logDecodes = useMemo(() => {
    const m = new Map<number, DecodedEvent | null>();
    for (const s of steps) if (s.log) m.set(s.i, decodeStepLog(s.log, registry));
    return m;
  }, [steps, registry]);

  const revertStepIndex = useMemo(() => {
    for (let i = steps.length - 1; i >= 0; i--) if (steps[i].isRevert) return i;
    return -1;
  }, [steps]);

  const [keyOnly, setKeyOnly] = useState(false);
  const [selected, setSelected] = useState(() =>
    revertStepIndex >= 0 ? revertStepIndex : 0,
  );

  const displaySteps = useMemo(
    () => (keyOnly ? steps.filter(isKeyStep) : steps),
    [steps, keyOnly],
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);

  const scrollToStep = useCallback(
    (origIndex: number) => {
      setSelected(origIndex);
      let pos = displaySteps.findIndex((s) => s.i >= origIndex);
      if (pos < 0) pos = displaySteps.length - 1;
      const el = scrollRef.current;
      if (el) el.scrollTop = Math.max(0, pos * ROW_H - VIEWPORT_H / 2);
    },
    [displaySteps],
  );

  const selectFrame = useCallback(
    (f: ReplayFrame) => {
      scrollToStep(f.reverted ? revertStepOf(steps, f) : f.startIndex);
    },
    [steps, scrollToStep],
  );

  const selectedFrame = useMemo(() => frameOfStep(frames, selected), [frames, selected]);
  const path = useMemo(() => framePath(frames, selectedFrame), [frames, selectedFrame]);

  const start = Math.max(0, Math.floor(scrollTop / ROW_H) - 10);
  const end = Math.min(displaySteps.length, Math.ceil((scrollTop + VIEWPORT_H) / ROW_H) + 10);
  const visible = displaySteps.slice(start, end);
  const sel = steps[selected];

  return (
    <div className="space-y-3">
      <Summary
        result={result}
        revert={revert}
        revertStepIndex={revertStepIndex}
        revertFrame={revertStepIndex >= 0 ? frameOfStep(frames, revertStepIndex) : null}
        registry={registry}
        sigMap={sigMap}
        book={book}
        onJumpRevert={() => revertStepIndex >= 0 && scrollToStep(revertStepIndex)}
      />

      {/* Call tree */}
      <div className="rounded-md ring-1 ring-gray-800/60">
        <div className="border-b border-gray-800/60 bg-gray-950/40 px-2 py-1 text-xs font-medium uppercase tracking-wider text-gray-600">
          Call tree — click a frame to jump to its opcodes
        </div>
        <div className="max-h-56 overflow-auto p-1.5">
          {frames.map((f) => {
            const d = frameDecode(f, registry, sigMap);
            return (
              <FrameRow
                key={f.id}
                frame={f}
                name={d.name}
                preview={d.preview}
                active={f.id === selectedFrame.id}
                book={book}
                onClick={() => selectFrame(f)}
              />
            );
          })}
        </div>
      </div>

      {/* Opcode timeline + detail */}
      <div className="grid gap-3 lg:grid-cols-5">
        <div className="overflow-hidden rounded-md ring-1 ring-gray-800/60 lg:col-span-3">
          <div className="flex flex-wrap items-center gap-2 border-b border-gray-800/60 bg-gray-950/40 px-2 py-1.5 text-xs">
            <span className="font-medium uppercase tracking-wider text-gray-600">Opcodes</span>
            <Breadcrumb path={path} registry={registry} sigMap={sigMap} />
            <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-gray-500 select-none">
              <input
                type="checkbox"
                checked={keyOnly}
                onChange={(e) => setKeyOnly(e.target.checked)}
                className="size-3 rounded border-gray-600 bg-gray-900 accent-fuchsia-600"
              />
              Key steps only
            </label>
          </div>
          <div
            ref={scrollRef}
            className="relative overflow-auto"
            style={{ height: VIEWPORT_H }}
            onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
          >
            <div style={{ height: displaySteps.length * ROW_H, position: "relative" }}>
              {visible.map((s, vi) => (
                <StepRow
                  key={s.i}
                  step={s}
                  row={start + vi}
                  selected={s.i === selected}
                  inFrame={s.i >= selectedFrame.startIndex && s.i <= selectedFrame.endIndex}
                  cost={stepGasCost(steps, s.i)}
                  logName={s.log ? logName(s, logDecodes.get(s.i) ?? null, eventSigs) : undefined}
                  onClick={() => setSelected(s.i)}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-2 lg:col-span-2">
          {sel && (
            <StepDetail
              step={sel}
              cost={stepGasCost(steps, sel.i)}
              book={book}
              logDecoded={sel.log ? logDecodes.get(sel.i) ?? null : null}
              logEventName={
                sel.log ? logName(sel, logDecodes.get(sel.i) ?? null, eventSigs) : undefined
              }
            />
          )}
        </div>
      </div>
    </div>
  );
}

function Summary({
  result,
  revert,
  revertStepIndex,
  revertFrame,
  registry,
  sigMap,
  book,
  onJumpRevert,
}: {
  result: ReplayResult;
  revert: DecodedError | null;
  revertStepIndex: number;
  revertFrame: ReplayFrame | null;
  registry: Map<string, Abi>;
  sigMap: Map<string, string>;
  book: AddressBook;
  onJumpRevert: () => void;
}) {
  const reason =
    revert?.reason ??
    (revert?.name ? revert.name : undefined) ??
    (result.reverted ? result.errorType ?? "reverted" : undefined);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
        <span
          className={`rounded-full px-2 py-0.5 font-bold uppercase tracking-wider ${
            result.reverted ? "bg-red-900/50 text-red-400" : "bg-green-900/50 text-green-400"
          }`}
        >
          {result.reverted ? "reverted" : "success"}
        </span>
        <Stat label="Exec gas" value={BigInt(result.gasUsed).toLocaleString()} />
        <Stat label="RPC reads" value={String(result.rpcCalls)} />
        {result.truncated && (
          <span className="rounded bg-amber-900/40 px-2 py-0.5 font-medium text-amber-300">
            truncated — tx too large to fully replay
          </span>
        )}
      </div>

      {result.reverted && (
        <div className="space-y-1 rounded-md bg-red-950/40 px-3 py-2 ring-1 ring-red-900/50">
          <p className="text-sm font-semibold text-red-300">{reason ?? "Reverted"}</p>
          {revertFrame && (
            <p className="flex flex-wrap items-center gap-1.5 text-xs text-red-400/80">
              <span>reverted in</span>
              <AddressLabel address={revertFrame.to} book={book} />
              <span className="font-mono text-red-300">
                .{frameLabel(revertFrame, registry, sigMap)}
              </span>
              {revertStepIndex >= 0 && (
                <button
                  onClick={onJumpRevert}
                  className="rounded bg-red-900/50 px-1.5 py-0.5 font-medium text-red-300 hover:bg-red-900/70"
                >
                  go to step {revertStepIndex}
                </button>
              )}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Breadcrumb({
  path,
  registry,
  sigMap,
}: {
  path: ReplayFrame[];
  registry: Map<string, Abi>;
  sigMap: Map<string, string>;
}) {
  return (
    <span className="flex min-w-0 items-center gap-1 truncate font-mono text-xs text-gray-500">
      {path.map((f, i) => (
        <span key={f.id} className="flex items-center gap-1">
          {i > 0 && <span className="text-gray-700">›</span>}
          <span className={i === path.length - 1 ? "text-fuchsia-300" : "text-gray-600"}>
            {frameLabel(f, registry, sigMap)}
          </span>
        </span>
      ))}
    </span>
  );
}

function FrameRow({
  frame,
  name,
  preview,
  active,
  book,
  onClick,
}: {
  frame: ReplayFrame;
  name: string;
  preview: string;
  active: boolean;
  book: AddressBook;
  onClick: () => void;
}) {
  const gas = Number(BigInt(frame.gasStart) - BigInt(frame.gasEnd));
  return (
    <div
      onClick={onClick}
      className={`flex cursor-pointer items-center gap-1.5 rounded px-1.5 py-1 hover:bg-elevated/60 ${
        active ? "bg-fuchsia-950/40 ring-1 ring-inset ring-fuchsia-800/50" : ""
      }`}
      style={{ marginLeft: frame.depth * 14 }}
    >
      {frame.type !== "ROOT" && frame.type !== "CALL" && (
        <span className="shrink-0 rounded bg-gray-800/80 px-1 py-0.5 text-xs font-bold uppercase tracking-wide text-gray-400 ring-1 ring-gray-700/40">
          {frame.type === "DELEGATECALL" ? "DELEG" : frame.type === "STATICCALL" ? "STATIC" : frame.type}
        </span>
      )}
      {frame.reverted && (
        <span className="shrink-0 rounded bg-red-900/60 px-1 py-0.5 text-xs font-bold uppercase text-red-400">
          ✕
        </span>
      )}
      <AddressLabel address={frame.to} book={book} className="shrink-0" />
      <span className="shrink-0 text-gray-700">.</span>
      <span className={`shrink-0 font-mono text-xs font-semibold ${frame.reverted ? "text-red-300" : "text-cyan-300"}`}>
        {name}
      </span>
      {preview && (
        <span className="truncate font-mono text-xs text-gray-500">{preview}</span>
      )}
      <span className="ml-auto shrink-0 pl-2 tabular-nums text-xs text-gray-600" title="gas used (approx)">
        {gas.toLocaleString()}
      </span>
    </div>
  );
}

function StepRow({
  step,
  row,
  selected,
  inFrame,
  cost,
  logName,
  onClick,
}: {
  step: OpcodeStep;
  row: number;
  selected: boolean;
  inFrame: boolean;
  cost: number | null;
  logName?: string;
  onClick: () => void;
}) {
  const isCall = CALL_OPS.has(step.op);
  const isLog = !!step.log;
  const tone = step.isRevert
    ? "text-red-400"
    : isLog
      ? "text-violet-300"
      : isCall
        ? "text-cyan-300"
        : step.op === "SSTORE"
          ? "text-amber-300"
          : step.op === "SLOAD"
            ? "text-amber-400/70"
            : step.op === "JUMPDEST"
              ? "text-gray-600"
              : "text-gray-300";

  return (
    <div
      onClick={onClick}
      className={`absolute left-0 right-0 flex cursor-pointer items-center gap-2 px-2 font-mono text-xs hover:bg-elevated/60 ${
        selected ? "bg-fuchsia-950/40 ring-1 ring-inset ring-fuchsia-800/50" : ""
      } ${step.isRevert ? "bg-red-950/30" : ""} ${inFrame && !selected ? "border-l-2 border-fuchsia-800/40" : ""}`}
      style={{ top: row * ROW_H, height: ROW_H }}
    >
      <span className="w-14 shrink-0 tabular-nums text-gray-600">{step.i}</span>
      <span className="w-12 shrink-0 tabular-nums text-gray-600">{step.pc}</span>
      <span className="flex flex-1 items-center gap-1 truncate" style={{ paddingLeft: step.depth * 10 }}>
        {step.depth > 0 && <span className="text-gray-700">└</span>}
        <span className={`font-semibold ${tone}`}>{step.op}</span>
        {isLog && logName && (
          <span className="truncate text-violet-400/80">{logName}</span>
        )}
      </span>
      <span className="w-20 shrink-0 text-right tabular-nums text-gray-600">
        {cost !== null ? cost.toLocaleString() : "—"}
      </span>
    </div>
  );
}

function StepDetail({
  step,
  cost,
  book,
  logDecoded,
  logEventName,
}: {
  step: OpcodeStep;
  cost: number | null;
  book: AddressBook;
  logDecoded?: DecodedEvent | null;
  logEventName?: string;
}) {
  return (
    <div className="space-y-2 rounded-md bg-gray-950/50 p-3 ring-1 ring-gray-800/50">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm font-semibold text-fuchsia-300">{step.op}</span>
        <span className="rounded bg-gray-800 px-1.5 py-0.5 font-mono text-xs text-gray-500">
          0x{step.code.toString(16).padStart(2, "0")}
        </span>
        <span className="text-xs text-gray-600">depth {step.depth}</span>
      </div>

      {step.log && (
        <EventSection log={step.log} decoded={logDecoded ?? null} eventName={logEventName} book={book} />
      )}

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <DRow label="step" value={String(step.i)} />
        <DRow label="pc" value={String(step.pc)} />
        <DRow label="gas left" value={BigInt(step.gasLeft).toLocaleString()} />
        <DRow label="gas cost" value={cost !== null ? cost.toLocaleString() : "—"} />
        <dt className="text-gray-600">context</dt>
        <dd className="min-w-0">
          <AddressLabel address={step.address} book={book} />
        </dd>
        {step.callTarget && (
          <>
            <dt className="text-gray-600">target</dt>
            <dd className="min-w-0">
              <AddressLabel address={step.callTarget} book={book} />
            </dd>
          </>
        )}
      </dl>

      {step.storageOp && (
        <div className="space-y-0.5 rounded bg-gray-950/60 px-2 py-1.5 ring-1 ring-gray-800/50">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-medium text-amber-400/80">{step.storageOp.kind}</span>
            {step.storageOp.label && (
              <span className="rounded bg-amber-900/30 px-1.5 py-0.5 font-mono text-xs font-medium text-amber-300">
                {step.storageOp.label}
              </span>
            )}
          </div>
          <p className="break-all font-mono text-xs text-gray-500">slot {step.storageOp.slot}</p>
          {step.storageOp.value !== undefined && (
            <p className="break-all font-mono text-xs text-gray-400">
              {step.storageOp.kind === "SLOAD" ? "loaded " : "= "}
              {formatWord(step.storageOp.value)}
            </p>
          )}
        </div>
      )}

      <div>
        <p className="mb-1 text-xs font-medium uppercase tracking-wider text-gray-600">
          Stack ({step.stack.length})
        </p>
        {step.stack.length === 0 ? (
          <p className="text-xs text-gray-600">empty</p>
        ) : (
          <div className="max-h-48 space-y-0.5 overflow-auto">
            {step.stack
              .slice()
              .reverse()
              .map((v, i) => (
                <div key={i} className="flex gap-2 text-xs">
                  <span className="w-6 shrink-0 tabular-nums text-gray-700">{i}</span>
                  <span className="min-w-0 break-all font-mono text-gray-400">{v}</span>
                </div>
              ))}
          </div>
        )}
      </div>

      <MemorySection step={step} />
    </div>
  );
}

function MemorySection({ step }: { step: OpcodeStep }) {
  const shownBytes = step.memory ? (step.memory.length - 2) / 2 : 0;
  const full = step.memSize ?? shownBytes;
  const rows = useMemo(() => {
    if (!step.memory) return [];
    const body = step.memory.slice(2);
    const out: string[] = [];
    for (let i = 0; i < body.length; i += 64) out.push(body.slice(i, i + 64));
    return out;
  }, [step.memory]);

  return (
    <div>
      <p className="mb-1 text-xs font-medium uppercase tracking-wider text-gray-600">
        Memory{full > 0 && ` (${full} bytes${shownBytes < full ? `, showing ${shownBytes}` : ""})`}
      </p>
      {!step.memory ? (
        <p className="text-xs text-gray-600">
          {step.memSize === undefined ? "not captured" : "empty"}
        </p>
      ) : (
        <div className="max-h-48 space-y-0.5 overflow-auto">
          {rows.map((r, i) => (
            <div key={i} className="flex gap-2 text-xs">
              <span className="w-12 shrink-0 tabular-nums text-gray-700">
                0x{(i * 32).toString(16).padStart(4, "0")}
              </span>
              <span className="min-w-0 break-all font-mono text-gray-500">{r}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EventSection({
  log,
  decoded,
  eventName,
  book,
}: {
  log: NonNullable<OpcodeStep["log"]>;
  decoded: DecodedEvent | null;
  eventName?: string;
  book: AddressBook;
}) {
  return (
    <div className="space-y-1 rounded bg-violet-950/30 px-2 py-1.5 ring-1 ring-violet-900/40">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="rounded bg-violet-900/40 px-1.5 py-0.5 font-mono text-xs font-semibold text-violet-300 ring-1 ring-violet-800/30">
          {eventName ?? "LOG"}
        </span>
        <span className="text-xs text-gray-600">by</span>
        <AddressLabel address={log.address} book={book} />
      </div>
      {decoded && decoded.args.length > 0 ? (
        <div className="space-y-0.5">
          {decoded.args.map((a, i) => (
            <div key={i} className="flex gap-2 text-xs">
              <span className="shrink-0 text-gray-600">
                {a.name || `[${i}]`}
                {a.type && <span className="ml-1 text-gray-700">{a.type}</span>}
              </span>
              <span className="min-w-0 break-all font-mono text-violet-200">
                {formatArgValue(a.value)}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-0.5">
          {log.topics.map((t, i) => (
            <p key={i} className="break-all font-mono text-xs text-gray-500">
              topic{i}: {t}
            </p>
          ))}
          {log.data && log.data !== "0x" && (
            <p className="break-all font-mono text-xs text-gray-500">data: {log.data}</p>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="font-medium uppercase tracking-wider text-gray-600">{label}</span>
      <span className="font-mono text-gray-300">{value}</span>
    </span>
  );
}

function DRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-gray-600">{label}</dt>
      <dd className="font-mono text-gray-300">{value}</dd>
    </>
  );
}
