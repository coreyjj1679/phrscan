/**
 * Local opcode-level transaction replay.
 *
 * The Pharos node only exposes `callTracer`/`prestateTracer` (no struct-log or
 * vmTrace tracer), so an opcode debugger can't be served by the RPC. Instead we
 * re-execute the transaction in an in-browser EVM (`@ethereumjs/evm`), lazily
 * reading code/storage/balances live from the RPC at the parent block. This
 * faithfully reproduces the call (including reverts) and yields a per-opcode
 * trace. The heavy work runs in a Web Worker to keep the UI responsive.
 *
 * Caveats:
 *  - Re-executed with Cancun gas rules; gas/precompiles may differ slightly from
 *    Pharos's custom client.
 *  - State is read at `blockNumber - 1`, so for non-first txs in a block the
 *    pre-state can differ from the exact original execution.
 */

export type OpcodeStep = {
  /** Sequential index in the trace. */
  i: number;
  pc: number;
  /** Opcode mnemonic, e.g. "SSTORE". */
  op: string;
  /** Opcode byte. */
  code: number;
  /** Gas remaining before this opcode (bigint as string). */
  gasLeft: string;
  /** Call depth (0 = top-level). */
  depth: number;
  /** Stack contents as hex strings, top of stack last. */
  stack: string[];
  /** Storage context address (the proxy under DELEGATECALL). */
  address: string;
  storageOp?: {
    kind: "SLOAD" | "SSTORE";
    slot: string;
    value?: string;
    /** Semantic slot label, e.g. "mapping[0x..] @ slot 3" or "EIP-1967 implementation". */
    label?: string;
  };
  /** Target address for CALL-family opcodes. */
  callTarget?: string;
  /** Calldata passed by a CALL-family opcode (for frame decoding). */
  callInput?: string;
  /** Value passed by a CALL/CALLCODE opcode. */
  callValue?: string;
  /** Memory contents (hex, capped) before this opcode; absent for huge traces. */
  memory?: string;
  /** Full memory byte length (memory may be truncated in `memory`). */
  memSize?: number;
  /** Event emitted by a LOG0-LOG4 opcode (raw; decoded in the UI). */
  log?: { address: string; topics: string[]; data: string };
  isRevert?: boolean;
};

/**
 * A call frame reconstructed from the opcode trace's depth transitions — the
 * same structure the `callTracer` shows, but mapped to opcode ranges so each
 * frame links to its slice of the step list.
 */
export type ReplayFrame = {
  id: number;
  parentId: number | null;
  depth: number;
  type: "ROOT" | "CALL" | "DELEGATECALL" | "STATICCALL" | "CALLCODE" | "CREATE" | "CREATE2";
  /** Code address running in this frame (target for calls). */
  to: string;
  input: string;
  value: string;
  /** First/last step indices belonging directly-or-nested to this frame. */
  startIndex: number;
  endIndex: number;
  gasStart: string;
  gasEnd: string;
  reverted: boolean;
  children: number[];
};

export type ReplayResult = {
  steps: OpcodeStep[];
  /** True when the step cap was hit and the trace is incomplete. */
  truncated: boolean;
  reverted: boolean;
  /** Execution gas used (excludes intrinsic/calldata cost), bigint as string. */
  gasUsed: string;
  /** Final return / revert data. */
  returnValue: string;
  /** EVM exception type when reverted (e.g. "revert", "out of gas"). */
  errorType?: string;
  rpcCalls: number;
};

export type ReplayRequest = {
  rpcUrl: string;
  chainId: number;
  from: string;
  to: string;
  data: string;
  value: string;
  gas: string;
  blockTag: string;
  maxSteps: number;
};

export type ReplayProgress = { steps: number; rpcCalls: number };

export type WorkerOut =
  | { type: "progress"; steps: number; rpcCalls: number }
  | { type: "done"; result: ReplayResult }
  | { type: "error"; error: string };

export const DEFAULT_MAX_STEPS = 250_000;

export type ReplayHandle = {
  promise: Promise<ReplayResult>;
  cancel: () => void;
};

/**
 * Replay a transaction in a Web Worker and stream back progress.
 * `blockNumber` is the block the tx was mined in; state is forked at the parent.
 */
export function startReplay(
  params: {
    rpcUrl: string;
    chainId: number;
    from: string;
    to: string;
    data: string;
    value: string;
    gas: string;
    blockNumber: bigint;
    maxSteps?: number;
  },
  onProgress?: (p: ReplayProgress) => void,
): ReplayHandle {
  const parent = params.blockNumber > 0n ? params.blockNumber - 1n : 0n;
  const req: ReplayRequest = {
    rpcUrl: params.rpcUrl,
    chainId: params.chainId,
    from: params.from,
    to: params.to,
    data: params.data || "0x",
    value: params.value || "0",
    gas: params.gas || "0xf4240",
    blockTag: "0x" + parent.toString(16),
    maxSteps: params.maxSteps ?? DEFAULT_MAX_STEPS,
  };

  const worker = new Worker(new URL("./evmReplay.worker.ts", import.meta.url), {
    type: "module",
  });

  let settled = false;
  const promise = new Promise<ReplayResult>((resolve, reject) => {
    worker.onmessage = (e: MessageEvent<WorkerOut>) => {
      const m = e.data;
      if (m.type === "progress") {
        onProgress?.({ steps: m.steps, rpcCalls: m.rpcCalls });
      } else if (m.type === "done") {
        settled = true;
        worker.terminate();
        resolve(m.result);
      } else if (m.type === "error") {
        settled = true;
        worker.terminate();
        reject(new Error(m.error));
      }
    };
    worker.onerror = (e) => {
      settled = true;
      worker.terminate();
      reject(new Error(e.message || "Replay worker crashed"));
    };
    worker.postMessage(req);
  });

  return {
    promise,
    cancel: () => {
      if (!settled) {
        settled = true;
        worker.terminate();
      }
    },
  };
}

const CREATE_OPS = new Set(["CREATE", "CREATE2"]);

function frameType(op: string | undefined): ReplayFrame["type"] {
  switch (op) {
    case "CALL":
    case "DELEGATECALL":
    case "STATICCALL":
    case "CALLCODE":
    case "CREATE":
    case "CREATE2":
      return op;
    default:
      return "CALL";
  }
}

/**
 * Reconstruct the call-frame tree from the opcode trace by following depth
 * transitions. Each frame records the opcode range `[startIndex, endIndex]` it
 * spans, so the UI can map frames ⇆ opcodes.
 */
export function buildFrames(
  steps: OpcodeStep[],
  root: { to: string; input: string; value: string },
): ReplayFrame[] {
  if (steps.length === 0) return [];
  const frames: ReplayFrame[] = [];
  let nextId = 0;

  const rootFrame: ReplayFrame = {
    id: nextId++,
    parentId: null,
    depth: 0,
    type: "ROOT",
    to: root.to,
    input: root.input || "0x",
    value: root.value || "0x0",
    startIndex: 0,
    endIndex: steps.length - 1,
    gasStart: steps[0].gasLeft,
    gasEnd: steps[steps.length - 1].gasLeft,
    reverted: false,
    children: [],
  };
  frames.push(rootFrame);
  const stack: ReplayFrame[] = [rootFrame];

  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];

    while (s.depth > stack[stack.length - 1].depth) {
      const opener = steps[i - 1];
      const parent = stack[stack.length - 1];
      const isCreate = opener && CREATE_OPS.has(opener.op);
      const frame: ReplayFrame = {
        id: nextId++,
        parentId: parent.id,
        depth: parent.depth + 1,
        type: frameType(opener?.op),
        to: isCreate ? s.address : (opener?.callTarget ?? s.address),
        input: isCreate ? "0x" : (opener?.callInput ?? "0x"),
        value: opener?.callValue ?? "0x0",
        startIndex: i,
        endIndex: i,
        gasStart: s.gasLeft,
        gasEnd: s.gasLeft,
        reverted: false,
        children: [],
      };
      parent.children.push(frame.id);
      frames.push(frame);
      stack.push(frame);
    }

    while (s.depth < stack[stack.length - 1].depth) {
      const closed = stack.pop()!;
      closed.endIndex = i - 1;
      closed.gasEnd = steps[i - 1].gasLeft;
    }

    const top = stack[stack.length - 1];
    top.endIndex = i;
    if (s.isRevert) top.reverted = true;
  }

  while (stack.length) {
    const closed = stack.pop()!;
    closed.endIndex = steps.length - 1;
    closed.gasEnd = steps[steps.length - 1].gasLeft;
  }

  return frames;
}

const OPENCHAIN_API = "https://api.openchain.xyz/signature-database/v1/lookup";

/**
 * Resolve 4-byte selectors of frame calldata to text signatures via OpenChain,
 * so frame names match those shown in the Call Trace. Best-effort; returns an
 * empty map when offline.
 */
export async function resolveFrameSignatures(
  frames: ReplayFrame[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const selectors = new Set<string>();
  for (const f of frames) {
    if (f.input && f.input.length >= 10) selectors.add(f.input.slice(0, 10).toLowerCase());
  }
  if (selectors.size === 0) return map;
  try {
    const url = `${OPENCHAIN_API}?function=${[...selectors].join(",")}&filter=true`;
    const res = await fetch(url);
    if (!res.ok) return map;
    const json = await res.json();
    const fns = json?.result?.function ?? {};
    for (const [sel, matches] of Object.entries(fns)) {
      if (Array.isArray(matches) && matches.length > 0) {
        map.set(sel.toLowerCase(), (matches[0] as { name: string }).name);
      }
    }
  } catch {
    // openchain unavailable
  }
  return map;
}

/**
 * Resolve event `topic0` hashes of emitted LOGs to text signatures via
 * OpenChain, so undecoded events still show a name. Best-effort.
 */
export async function resolveLogSignatures(
  steps: OpcodeStep[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const topics = new Set<string>();
  for (const s of steps) {
    if (s.log && s.log.topics.length > 0) topics.add(s.log.topics[0].toLowerCase());
  }
  if (topics.size === 0) return map;
  try {
    const url = `${OPENCHAIN_API}?event=${[...topics].join(",")}&filter=true`;
    const res = await fetch(url);
    if (!res.ok) return map;
    const json = await res.json();
    const events = json?.result?.event ?? {};
    for (const [hash, matches] of Object.entries(events)) {
      if (Array.isArray(matches) && matches.length > 0) {
        map.set(hash.toLowerCase(), (matches[0] as { name: string }).name);
      }
    }
  } catch {
    // openchain unavailable
  }
  return map;
}

/** Best-effort per-step gas cost (delta to the next step at equal/greater depth). */
export function stepGasCost(steps: OpcodeStep[], i: number): number | null {
  const cur = steps[i];
  const next = steps[i + 1];
  if (!next) return null;
  // Returning to a shallower frame: the remaining gas is refunded to the parent,
  // so a delta would be meaningless.
  if (next.depth < cur.depth) return null;
  if (next.depth > cur.depth) {
    // Entered a sub-call; the call op's own cost is the gas not forwarded.
    // Approximate with the delta anyway (forwarded gas reappears on return).
    const d = Number(BigInt(cur.gasLeft) - BigInt(next.gasLeft));
    return d >= 0 ? d : null;
  }
  const d = Number(BigInt(cur.gasLeft) - BigInt(next.gasLeft));
  return d >= 0 ? d : null;
}
