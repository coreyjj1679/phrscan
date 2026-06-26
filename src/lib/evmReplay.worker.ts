import { createEVM } from "@ethereumjs/evm";
import { SimpleStateManager } from "@ethereumjs/statemanager";
import { createCustomCommon, Mainnet, Hardfork } from "@ethereumjs/common";
import {
  createAddressFromString,
  createAccount,
  hexToBytes,
  bytesToHex,
  setLengthLeft,
  type Address,
} from "@ethereumjs/util";
import type { ReplayRequest, ReplayResult, OpcodeStep, WorkerOut } from "./evmReplay";

const CALL_OPS = new Set(["CALL", "DELEGATECALL", "STATICCALL", "CALLCODE"]);
const LOG_TOPICS: Record<string, number> = { LOG0: 0, LOG1: 1, LOG2: 2, LOG3: 3, LOG4: 4 };

const ctx = globalThis as unknown as {
  postMessage(msg: WorkerOut): void;
  addEventListener(
    type: "message",
    cb: (e: MessageEvent<ReplayRequest>) => void,
  ): void;
};

function post(msg: WorkerOut) {
  ctx.postMessage(msg);
}

class StepCapError extends Error {}

/**
 * State manager that lazily loads accounts, code, and storage from a JSON-RPC
 * endpoint at a fixed block tag. Pharos's prestateTracer returns zeroed storage,
 * so we read everything live via standard eth_* methods (which are accurate).
 */
class ForkStateManager extends SimpleStateManager {
  private rpcUrl: string;
  private blockTag: string;
  private seenAcct = new Set<string>();
  private seenCode = new Set<string>();
  private seenSlot = new Set<string>();
  private onRpc?: () => void;
  rpcCalls = 0;

  constructor(rpcUrl: string, blockTag: string, onRpc?: () => void) {
    super();
    this.rpcUrl = rpcUrl;
    this.blockTag = blockTag;
    this.onRpc = onRpc;
  }

  private async rpc(method: string, params: unknown[]): Promise<string> {
    this.rpcCalls++;
    this.onRpc?.();
    const res = await fetch(this.rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    const j = await res.json();
    if (j.error) throw new Error(`${method}: ${j.error.message}`);
    return j.result as string;
  }

  override async getAccount(address: Address) {
    let acct = await super.getAccount(address);
    const a = address.toString();
    if (acct === undefined && !this.seenAcct.has(a)) {
      this.seenAcct.add(a);
      const [bal, nonce, code] = await Promise.all([
        this.rpc("eth_getBalance", [a, this.blockTag]),
        this.rpc("eth_getTransactionCount", [a, this.blockTag]),
        this.rpc("eth_getCode", [a, this.blockTag]),
      ]);
      acct = createAccount({ nonce: BigInt(nonce), balance: BigInt(bal) });
      await super.putAccount(address, acct);
      if (code && code !== "0x") {
        this.seenCode.add(a);
        await super.putCode(address, hexToBytes(code as `0x${string}`));
      }
      acct = await super.getAccount(address);
    }
    return acct;
  }

  override async getCode(address: Address) {
    let code = await super.getCode(address);
    const a = address.toString();
    if ((!code || code.length === 0) && !this.seenCode.has(a)) {
      this.seenCode.add(a);
      const c = await this.rpc("eth_getCode", [a, this.blockTag]);
      if (c && c !== "0x") {
        code = hexToBytes(c as `0x${string}`);
        await super.putCode(address, code);
      }
    }
    return code;
  }

  override async getStorage(address: Address, key: Uint8Array) {
    let val = await super.getStorage(address, key);
    const a = address.toString();
    const slotHex = bytesToHex(setLengthLeft(key, 32));
    const id = a + ":" + slotHex;
    if ((!val || val.length === 0) && !this.seenSlot.has(id)) {
      this.seenSlot.add(id);
      const raw = await this.rpc("eth_getStorageAt", [a, slotHex, this.blockTag]);
      const trimmed = raw.slice(2).replace(/^0+/, "");
      if (trimmed.length > 0) {
        const even = trimmed.length % 2 ? "0" + trimmed : trimmed;
        val = hexToBytes(("0x" + even) as `0x${string}`);
        await super.putStorage(address, key, val);
      }
    }
    return val;
  }
}

function stackToHex(stack: bigint[]): string[] {
  return stack.map((v) => "0x" + v.toString(16));
}

/** Well-known fixed storage slots (proxy patterns). */
const KNOWN_SLOTS: Record<string, string> = {
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc": "EIP-1967 implementation",
  "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103": "EIP-1967 admin",
  "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50": "EIP-1967 beacon",
  "0xc5f16f0fcc639fa48a6947836d9850f504798523bf8c9a3a87d5876cf622bcf7": "EIP-1822 proxiable (UUPS)",
  "0x4910fdfa16fed3260ed0e7147f7cc6da11a60208b5b9406d12a635614ffd9143": "EIP-1967 rollback",
};

function normSlot(slot: string): string {
  const h = slot.startsWith("0x") ? slot.slice(2) : slot;
  return "0x" + h.padStart(64, "0").toLowerCase();
}

function slotShort(slot: string): string {
  const n = BigInt(normSlot(slot));
  if (n < 1_000_000n) return n.toString();
  const h = normSlot(slot);
  return h.slice(0, 10) + "…";
}

function keyShort(word: string): string {
  // 32-byte word; if it looks like a left-padded address, show as address.
  const h = normSlot(word).slice(2);
  if (/^0{24}[0-9a-f]{40}$/.test(h) && !/^0{64}$/.test(h)) {
    const a = "0x" + h.slice(24);
    return a.slice(0, 6) + "…" + a.slice(-4);
  }
  const n = BigInt("0x" + h);
  if (n < 1_000_000n) return n.toString();
  return "0x" + h.slice(0, 8) + "…";
}

/**
 * Best-effort label for a storage slot, source-free: matches well-known proxy
 * slots, and reconstructs mapping/array slots from captured KECCAK256 preimages
 * (mapping slot = keccak(key . baseSlot); array data = keccak(baseSlot)).
 */
function labelSlot(slot: string, keccak: Map<string, string>, depth = 0): string {
  const norm = normSlot(slot);
  if (KNOWN_SLOTS[norm]) return KNOWN_SLOTS[norm];
  const pre = keccak.get(norm);
  if (pre && depth < 4) {
    const bytes = (pre.length - 2) / 2;
    if (bytes === 64) {
      const key = "0x" + pre.slice(2, 66);
      const base = "0x" + pre.slice(66, 130);
      const baseLabel = labelSlot(base, keccak, depth + 1);
      const baseTxt = KNOWN_SLOTS[normSlot(base)] || keccak.get(normSlot(base)) ? baseLabel : `slot ${slotShort(base)}`;
      return `mapping[${keyShort(key)}] @ ${baseTxt}`;
    }
    if (bytes === 32) return `array/bytes @ slot ${slotShort(pre)}`;
    return "hashed slot";
  }
  if (BigInt(norm) < 1024n) return `slot ${BigInt(norm).toString()}`;
  return "";
}

const MAX_CALLDATA = 8192;
// Per-step memory is captured (bounded) so the UI can show memory at any step.
const MAX_MEM_BYTES = 4096;
const MAX_MEM_STEPS = 20000;

/** Read a bounded slice of EVM memory as hex (zero-padded past current length). */
function readMemory(memory: Uint8Array, offset: bigint, length: bigint): string {
  const off = Number(offset);
  const len = Math.min(Number(length), MAX_CALLDATA);
  if (len <= 0 || off < 0) return "0x";
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = memory[off + i] ?? 0;
  return bytesToHex(out);
}

/**
 * Extract the target, input calldata, and value passed by a CALL-family opcode
 * from the pre-execution stack + memory. Stack is top-last.
 */
function extractCall(
  op: string,
  stack: bigint[],
  memory: Uint8Array,
): { target?: string; input?: string; value?: string } {
  const n = stack.length;
  const addr = (i: number) => "0x" + stack[n - i].toString(16).padStart(40, "0");
  if (op === "CALL" || op === "CALLCODE") {
    if (n < 7) return {};
    return {
      target: addr(2),
      value: "0x" + stack[n - 3].toString(16),
      input: readMemory(memory, stack[n - 4], stack[n - 5]),
    };
  }
  if (op === "DELEGATECALL" || op === "STATICCALL") {
    if (n < 6) return {};
    return { target: addr(2), input: readMemory(memory, stack[n - 3], stack[n - 4]) };
  }
  return {};
}

async function run(req: ReplayRequest): Promise<ReplayResult> {
  let lastPost = 0;
  let stepCount = 0;
  const postProgress = (force = false) => {
    const now = Date.now();
    if (!force && now - lastPost < 60) return;
    lastPost = now;
    post({ type: "progress", steps: stepCount, rpcCalls: sm.rpcCalls });
  };

  const sm = new ForkStateManager(req.rpcUrl, req.blockTag, () => postProgress());
  const common = createCustomCommon(
    { chainId: req.chainId },
    Mainnet,
    { hardfork: Hardfork.Cancun },
  );
  const evm = await createEVM({ common, stateManager: sm });

  const steps: OpcodeStep[] = [];
  let truncated = false;

  // Reconstruct mapping/array slots: remember each KECCAK256 preimage keyed by
  // its result (read off the stack on the following step).
  const keccak = new Map<string, string>();
  let pendingKeccak: { preimage: string; depth: number } | null = null;
  // SLOAD result is pushed on the next step; backfill it onto the SLOAD step.
  let pendingSload: { index: number; depth: number } | null = null;

  evm.events.on("step", (step) => {
    const stack = step.stack;
    const op = step.opcode.name;
    const len = stack.length;

    if (pendingKeccak && step.depth === pendingKeccak.depth && len >= 1) {
      keccak.set(normSlot("0x" + stack[len - 1].toString(16)), pendingKeccak.preimage);
      pendingKeccak = null;
    }
    if (pendingSload && step.depth === pendingSload.depth && len >= 1) {
      const so = steps[pendingSload.index]?.storageOp;
      if (so) so.value = "0x" + stack[len - 1].toString(16);
      pendingSload = null;
    }
    if (op === "KECCAK256" && len >= 2) {
      pendingKeccak = {
        preimage: readMemory(step.memory, stack[len - 1], stack[len - 2]),
        depth: step.depth,
      };
    }

    const out: OpcodeStep = {
      i: steps.length,
      pc: step.pc,
      op,
      code: step.opcode.code,
      gasLeft: step.gasLeft.toString(),
      depth: step.depth,
      stack: stackToHex(stack),
      address: step.address.toString(),
    };

    if (op === "SLOAD" && len >= 1) {
      const slot = "0x" + stack[len - 1].toString(16);
      out.storageOp = { kind: "SLOAD", slot, label: labelSlot(slot, keccak) || undefined };
      pendingSload = { index: steps.length, depth: step.depth };
    } else if (op === "SSTORE" && len >= 2) {
      const slot = "0x" + stack[len - 1].toString(16);
      out.storageOp = {
        kind: "SSTORE",
        slot,
        value: "0x" + stack[len - 2].toString(16),
        label: labelSlot(slot, keccak) || undefined,
      };
    } else if (CALL_OPS.has(op) && len >= 2) {
      out.callTarget = "0x" + stack[len - 2].toString(16).padStart(40, "0");
      const c = extractCall(op, stack, step.memory);
      if (c.input !== undefined) out.callInput = c.input;
      if (c.value !== undefined) out.callValue = c.value;
    } else if (op in LOG_TOPICS) {
      const tc = LOG_TOPICS[op];
      if (len >= 2 + tc) {
        const topics: string[] = [];
        for (let t = 0; t < tc; t++) {
          topics.push("0x" + stack[len - 3 - t].toString(16).padStart(64, "0"));
        }
        out.log = {
          address: step.address.toString(),
          topics,
          data: readMemory(step.memory, stack[len - 1], stack[len - 2]),
        };
      }
    } else if (op === "REVERT") {
      out.isRevert = true;
    }

    const mem = step.memory;
    if (mem && mem.length > 0 && steps.length < MAX_MEM_STEPS) {
      out.memSize = mem.length;
      out.memory = bytesToHex(
        mem.length > MAX_MEM_BYTES ? mem.subarray(0, MAX_MEM_BYTES) : mem,
      );
    }

    steps.push(out);
    stepCount = steps.length;

    if (steps.length % 2000 === 0) postProgress();

    if (steps.length >= req.maxSteps) {
      truncated = true;
      throw new StepCapError("step cap reached");
    }
  });

  let reverted = false;
  let returnValue = "0x";
  let gasUsed = "0";
  let errorType: string | undefined;

  try {
    const result = await evm.runCall({
      caller: createAddressFromString(req.from),
      to: createAddressFromString(req.to),
      data: hexToBytes(req.data as `0x${string}`),
      value: BigInt(req.value),
      gasLimit: BigInt(req.gas),
      skipBalance: true,
    });
    const ex = result.execResult;
    reverted = ex.exceptionError !== undefined;
    errorType = ex.exceptionError ? String(ex.exceptionError.error) : undefined;
    returnValue = bytesToHex(ex.returnValue ?? new Uint8Array());
    gasUsed = (ex.executionGasUsed ?? 0n).toString();
  } catch (e) {
    if (!(e instanceof StepCapError)) throw e;
  }

  return {
    steps,
    truncated,
    reverted,
    gasUsed,
    returnValue,
    errorType,
    rpcCalls: sm.rpcCalls,
  };
}

ctx.addEventListener("message", async (e: MessageEvent<ReplayRequest>) => {
  try {
    const result = await run(e.data);
    post({ type: "done", result });
  } catch (err) {
    post({ type: "error", error: err instanceof Error ? err.message : String(err) });
  }
});
