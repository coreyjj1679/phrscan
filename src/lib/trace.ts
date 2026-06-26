import type { PublicClient, Hex } from "viem";
import { decodeRevert, type DecodedError } from "./decodeError";

const OPENCHAIN_API =
  "https://api.openchain.xyz/signature-database/v1/lookup";

export type TraceCall = {
  type: string;
  from: string;
  to: string;
  input: Hex;
  output?: Hex;
  value: string;
  gas: bigint;
  gasUsed: bigint;
  error?: string;
  revertReason?: string;
  calls?: TraceCall[];
  /** Resolved function name from 4byte, e.g. "transfer(address,uint256)" */
  functionSig?: string;
  /** Resolved error name from 4byte */
  errorSig?: string;
  /** Raw revert bytes for this frame (from `output`, or recovered via re-sim). */
  revertData?: Hex;
  /** Decoded revert reason (Error/Panic/custom error) for this frame. */
  decodedError?: DecodedError;
  /** True when revertData was recovered via re-simulation rather than the trace. */
  revertRecovered?: boolean;
  depth: number;
};

/**
 * Map node-specific revert strings to a friendly label. Pharos returns
 * `"execute_revert"` instead of geth's `"execution reverted"`; collapse both
 * (and bare `"revert"`) to `"reverted"`, passing through anything else
 * (e.g. `"out of gas"`, `"invalid opcode"`) untouched.
 */
export function normalizeTraceError(error?: string): string | undefined {
  if (!error) return undefined;
  const e = error.trim().toLowerCase();
  if (e === "execute_revert" || e === "execution reverted" || e === "revert") {
    return "reverted";
  }
  return error;
}

type RawTraceCall = {
  type: string;
  from: string;
  to: string;
  input: string;
  output?: string;
  value: string;
  gas?: string;
  gasUsed?: string;
  gas_used?: string;
  error?: string;
  revert_reason?: string;
  revertReason?: string;
  calls?: RawTraceCall[];
};

function normalizeTrace(raw: RawTraceCall, depth: number): TraceCall {
  return {
    type: raw.type ?? "CALL",
    from: raw.from ?? "",
    to: raw.to ?? "",
    input: (raw.input ?? "0x") as Hex,
    output: raw.output as Hex | undefined,
    value: raw.value ?? "0x0",
    gas: BigInt(raw.gas ?? "0x0"),
    gasUsed: BigInt(raw.gasUsed ?? raw.gas_used ?? "0x0"),
    error: raw.error,
    revertReason: raw.revert_reason ?? raw.revertReason,
    calls: raw.calls?.map((c) => normalizeTrace(c, depth + 1)),
    depth,
  };
}

function collectSelectors(trace: TraceCall): Set<string> {
  const selectors = new Set<string>();
  if (trace.input && trace.input.length >= 10) {
    selectors.add(trace.input.slice(0, 10).toLowerCase());
  }
  if (trace.output && trace.output.startsWith("0x") && trace.output.length >= 10 && trace.error) {
    selectors.add(trace.output.slice(0, 10).toLowerCase());
  }
  if (trace.calls) {
    for (const c of trace.calls) {
      for (const s of collectSelectors(c)) selectors.add(s);
    }
  }
  return selectors;
}

function collectErrorSelectors(trace: TraceCall): Set<string> {
  const selectors = new Set<string>();
  if (trace.error && trace.output && trace.output.length >= 10) {
    selectors.add(trace.output.slice(0, 10).toLowerCase());
  }
  if (trace.calls) {
    for (const c of trace.calls) {
      for (const s of collectErrorSelectors(c)) selectors.add(s);
    }
  }
  return selectors;
}

async function resolveSignatures(
  fnSelectors: Set<string>,
  errSelectors: Set<string>,
): Promise<{ fnMap: Map<string, string>; errMap: Map<string, string> }> {
  const fnMap = new Map<string, string>();
  const errMap = new Map<string, string>();

  const fnList = [...fnSelectors];
  const errList = [...errSelectors];

  const fetches: Promise<void>[] = [];

  if (fnList.length > 0) {
    fetches.push(
      (async () => {
        try {
          const url = `${OPENCHAIN_API}?function=${fnList.join(",")}&filter=true`;
          const res = await fetch(url);
          if (!res.ok) return;
          const json = await res.json();
          const fns = json?.result?.function ?? {};
          for (const [sel, matches] of Object.entries(fns)) {
            if (Array.isArray(matches) && matches.length > 0) {
              fnMap.set(sel.toLowerCase(), (matches[0] as { name: string }).name);
            }
          }
        } catch {
          // unavailable
        }
      })(),
    );
  }

  if (errList.length > 0) {
    fetches.push(
      (async () => {
        try {
          const url = `${OPENCHAIN_API}?error=${errList.join(",")}&filter=true`;
          const res = await fetch(url);
          if (!res.ok) return;
          const json = await res.json();
          const errors = json?.result?.error ?? {};
          for (const [sel, matches] of Object.entries(errors)) {
            if (Array.isArray(matches) && matches.length > 0) {
              errMap.set(sel.toLowerCase(), (matches[0] as { name: string }).name);
            }
          }
        } catch {
          // unavailable
        }
      })(),
    );
  }

  await Promise.all(fetches);
  return { fnMap, errMap };
}

function annotateTrace(
  trace: TraceCall,
  fnMap: Map<string, string>,
  errMap: Map<string, string>,
): void {
  if (trace.input && trace.input.length >= 10) {
    const sel = trace.input.slice(0, 10).toLowerCase();
    trace.functionSig = fnMap.get(sel);
  }
  if (trace.error && trace.output && trace.output.length >= 10) {
    const sel = trace.output.slice(0, 10).toLowerCase();
    trace.errorSig = errMap.get(sel);
  }
  if (trace.calls) {
    for (const c of trace.calls) annotateTrace(c, fnMap, errMap);
  }
}

export async function fetchTrace(
  client: PublicClient,
  txHash: Hex,
): Promise<TraceCall | null> {
  try {
    const result = await client.request({
      method: "debug_traceTransaction" as never,
      params: [txHash, { tracer: "callTracer" }] as never,
    });

    const raw = result as unknown as RawTraceCall;
    const trace = normalizeTrace(raw, 0);

    const fnSelectors = collectSelectors(trace);
    const errSelectors = collectErrorSelectors(trace);
    const { fnMap, errMap } = await resolveSignatures(fnSelectors, errSelectors);
    annotateTrace(trace, fnMap, errMap);

    return trace;
  } catch {
    return null;
  }
}

export async function traceCall(
  client: PublicClient,
  callParams: {
    from?: string;
    to: string;
    data?: Hex;
    value?: bigint;
  },
  blockNumber?: bigint,
  stateOverride?: Record<string, unknown>,
): Promise<TraceCall | null> {
  try {
    const callObj: Record<string, unknown> = { to: callParams.to };
    if (callParams.from) callObj.from = callParams.from;
    if (callParams.data) callObj.data = callParams.data;
    if (callParams.value) callObj.value = `0x${callParams.value.toString(16)}`;

    const blockTag = blockNumber ? `0x${blockNumber.toString(16)}` : "latest";

    const config: Record<string, unknown> = { tracer: "callTracer" };
    if (stateOverride) config.stateOverrides = stateOverride;

    const result = await client.request({
      method: "debug_traceCall" as never,
      params: [callObj, blockTag, config] as never,
    });

    const raw = result as unknown as RawTraceCall;

    // Some RPCs (e.g. Pharos) ignore the callTracer option and return
    // the default struct-log format ({failed, gas, returnValue, structLogs}).
    // Detect this and bail out instead of producing a garbage trace.
    if (!raw.type && !raw.from && !raw.to) return null;

    const trace = normalizeTrace(raw, 0);

    const fnSelectors = collectSelectors(trace);
    const errSelectors = collectErrorSelectors(trace);
    const { fnMap, errMap } = await resolveSignatures(fnSelectors, errSelectors);
    annotateTrace(trace, fnMap, errMap);

    if (trace.error) {
      await enrichTraceRevert(client, trace, {
        tx: {
          from: callParams.from,
          to: callParams.to,
          data: callParams.data,
          value: callParams.value,
        },
        blockNumber,
        // Re-sim recovery only when state isn't overridden, else the recovered
        // reason wouldn't reflect the overrides — decode from frame output only.
        recover: !stateOverride,
      }).catch(() => {});
    }

    return trace;
  } catch {
    return null;
  }
}

/* ─── Revert reason recovery & decoding ─────────────────────── */

/** Walk a (viem) error's `cause` chain looking for revert `data` bytes. */
function extractRpcRevertData(err: unknown): Hex | null {
  const visit = (e: unknown, depth: number): Hex | null => {
    if (!e || typeof e !== "object" || depth > 8) return null;
    const o = e as Record<string, unknown>;
    const d = o.data;
    if (typeof d === "string" && d.startsWith("0x")) return d as Hex;
    if (d && typeof d === "object") {
      const dd = (d as Record<string, unknown>).data;
      if (typeof dd === "string" && dd.startsWith("0x")) return dd as Hex;
    }
    return visit(o.cause, depth + 1);
  };
  return visit(err, 0);
}

/** Deepest frame in DFS order that carries an error (the revert origin). */
function deepestErroredFrame(trace: TraceCall): TraceCall | null {
  let best: TraceCall | null = trace.error ? trace : null;
  if (trace.calls) {
    for (const c of trace.calls) {
      const d = deepestErroredFrame(c);
      if (d) best = d;
    }
  }
  return best;
}

/** A hex string that could carry decodable revert data (>= a 4-byte selector). */
function looksLikeRevertData(out?: string): boolean {
  return !!out && out.startsWith("0x") && out.length >= 10;
}

/**
 * Recover the revert bytes for a reverted top-level transaction by replaying it
 * as an `eth_call` at its inclusion block. The Pharos callTracer omits revert
 * data from frames, so this is the only way to obtain a decodable reason.
 *
 * Returns the raw revert bytes (possibly `"0x"` for empty reverts), or `null`
 * when the re-simulation did not revert (state changed since) or the data could
 * not be extracted.
 */
export async function recoverTopLevelRevert(
  client: PublicClient,
  params: { from?: string; to: string; data?: Hex; value?: bigint },
  blockNumber?: bigint,
): Promise<Hex | null> {
  const callObj: Record<string, unknown> = { to: params.to };
  if (params.from) callObj.from = params.from;
  if (params.data) callObj.data = params.data;
  if (params.value) callObj.value = `0x${params.value.toString(16)}`;
  const blockTag =
    blockNumber !== undefined ? `0x${blockNumber.toString(16)}` : "latest";

  try {
    await client.request({
      method: "eth_call" as never,
      params: [callObj, blockTag] as never,
    });
    return null; // re-sim unexpectedly succeeded — original state is gone
  } catch (err) {
    return extractRpcRevertData(err);
  }
}

/**
 * Enrich a reverted trace with a decoded revert reason. Prefers revert bytes
 * already present on the failing frame's `output`; otherwise (when `recover` is
 * set and tx params are supplied) replays the transaction via `eth_call` to
 * recover them. Decodes against built-in errors, saved ABIs, then 4byte, and
 * attaches the result to both the root and the failing frame. Mutates `trace`.
 */
export async function enrichTraceRevert(
  client: PublicClient,
  trace: TraceCall,
  opts: {
    tx?: { from?: string; to: string; data?: Hex; value?: bigint };
    blockNumber?: bigint;
    recover?: boolean;
  } = {},
): Promise<TraceCall> {
  if (!trace.error) return trace;

  const deepest = deepestErroredFrame(trace);

  let revertData: Hex | null = null;
  let recovered = false;
  if (looksLikeRevertData(deepest?.output)) {
    revertData = deepest!.output as Hex;
  } else if (looksLikeRevertData(trace.output)) {
    revertData = trace.output as Hex;
  } else if (opts.recover && opts.tx) {
    revertData = await recoverTopLevelRevert(client, opts.tx, opts.blockNumber);
    recovered = revertData !== null;
  }

  if (revertData === null) return trace;

  const decoded = await decodeRevert(revertData);
  trace.revertData = revertData;
  trace.decodedError = decoded;
  trace.revertRecovered = recovered;
  if (deepest && deepest !== trace) {
    deepest.revertData = revertData;
    deepest.decodedError = decoded;
    deepest.revertRecovered = recovered;
  }
  return trace;
}

/* ─── State Diff (prestate tracer with diffMode) ────────────── */

export type AccountState = {
  balance?: string;
  nonce?: string | number;
  code?: string;
  storage?: Record<string, string>;
};

export type StateDiff = {
  pre: Record<string, AccountState>;
  post: Record<string, AccountState>;
};

export async function fetchStateDiff(
  client: PublicClient,
  txHash: Hex,
): Promise<StateDiff | null> {
  try {
    const result = await client.request({
      method: "debug_traceTransaction" as never,
      params: [
        txHash,
        { tracer: "prestateTracer", tracerConfig: { diffMode: true } },
      ] as never,
    });

    const raw = result as unknown as { pre?: Record<string, AccountState>; post?: Record<string, AccountState> };
    if (!raw.pre && !raw.post) return null;

    return { pre: raw.pre ?? {}, post: raw.post ?? {} };
  } catch {
    return null;
  }
}

export function flattenTrace(trace: TraceCall): TraceCall[] {
  const result: TraceCall[] = [trace];
  if (trace.calls) {
    for (const c of trace.calls) {
      result.push(...flattenTrace(c));
    }
  }
  return result;
}

export function countCalls(trace: TraceCall): number {
  let count = 1;
  if (trace.calls) {
    for (const c of trace.calls) count += countCalls(c);
  }
  return count;
}

export function hasErrors(trace: TraceCall): boolean {
  if (trace.error) return true;
  if (trace.calls) return trace.calls.some(hasErrors);
  return false;
}

/** Count how many call frames in the tree reverted (including nested ones). */
export function countErrors(trace: TraceCall): number {
  let n = trace.error ? 1 : 0;
  if (trace.calls) for (const c of trace.calls) n += countErrors(c);
  return n;
}

/**
 * Count distinct *handled* reverts: errored calls whose parent did not revert
 * (and excluding the top-level call). This collapses proxy frames
 * (CALL+DELEGATECALL) and revert-propagation chains into a single count per
 * caught failure, so the number reflects logical reverts rather than frames.
 */
export function countHandledReverts(trace: TraceCall): number {
  let n = 0;
  const walk = (node: TraceCall, parentErrored: boolean) => {
    const errored = !!node.error;
    if (errored && !parentErrored && node.depth > 0) n++;
    if (node.calls) for (const c of node.calls) walk(c, errored);
  };
  walk(trace, false);
  return n;
}
