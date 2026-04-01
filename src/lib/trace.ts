import type { PublicClient, Hex } from "viem";

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
  depth: number;
};

type RawTraceCall = {
  type: string;
  from: string;
  to: string;
  input: string;
  output?: string;
  value: string;
  gas: string;
  gas_used: string;
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
    gasUsed: BigInt(raw.gas_used ?? "0x0"),
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
): Promise<TraceCall | null> {
  try {
    const callObj: Record<string, unknown> = { to: callParams.to };
    if (callParams.from) callObj.from = callParams.from;
    if (callParams.data) callObj.data = callParams.data;
    if (callParams.value) callObj.value = `0x${callParams.value.toString(16)}`;

    const blockTag = blockNumber ? `0x${blockNumber.toString(16)}` : "latest";

    const result = await client.request({
      method: "debug_traceCall" as never,
      params: [callObj, blockTag, { tracer: "callTracer" }] as never,
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

    return trace;
  } catch {
    return null;
  }
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
