import { createEVM } from "@ethereumjs/evm";
import { createCustomCommon, Mainnet, Hardfork } from "@ethereumjs/common";
import {
  createAddressFromString,
  hexToBytes,
  bytesToHex,
  setLengthLeft,
} from "@ethereumjs/util";
import { decodeAbiParameters, encodeFunctionData, parseAbi, type Hex } from "viem";
import { ForkStateManager } from "./forkState";
import type {
  BundleRequest,
  BundleResult,
  BundleTx,
  BundleTxResult,
  BundleWorkerOut,
} from "./safeBundle";

const ctx = globalThis as unknown as {
  postMessage(msg: BundleWorkerOut): void;
  addEventListener(
    type: "message",
    cb: (e: MessageEvent<BundleRequest>) => void,
  ): void;
};

const SAFE_ABI = parseAbi([
  "function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address payable refundReceiver, bytes signatures) payable returns (bool success)",
  "function nonce() view returns (uint256)",
]);

/** Safe stores `threshold` in slot 4. */
const THRESHOLD_SLOT = 4;
const GAS_LIMIT = 30_000_000n;
const ERROR_STRING = "0x08c379a0";

/** v = 1 signature: valid as long as the caller is the named owner. */
function preValidatedSignature(owner: string): Hex {
  const padded = owner.slice(2).toLowerCase().padStart(64, "0");
  return `0x${padded}${"0".repeat(64)}01`;
}

function slotKey(n: number): Uint8Array {
  return setLengthLeft(hexToBytes(`0x${n.toString(16).padStart(2, "0")}`), 32);
}

function decodeReason(returnValue: string): string | undefined {
  if (!returnValue || returnValue === "0x") return undefined;
  if (returnValue.startsWith(ERROR_STRING)) {
    try {
      const [reason] = decodeAbiParameters(
        [{ type: "string" }],
        `0x${returnValue.slice(10)}`,
      );
      return reason as string;
    } catch {
      /* fall through to raw data */
    }
  }
  return returnValue.length > 74 ? `${returnValue.slice(0, 74)}…` : returnValue;
}

function execCalldata(tx: BundleTx, owner: string): Hex {
  return encodeFunctionData({
    abi: SAFE_ABI,
    functionName: "execTransaction",
    args: [
      tx.to as `0x${string}`,
      BigInt(tx.value),
      (tx.data || "0x") as Hex,
      tx.operation,
      BigInt(tx.safeTxGas),
      BigInt(tx.baseGas),
      BigInt(tx.gasPrice),
      tx.gasToken as `0x${string}`,
      tx.refundReceiver as `0x${string}`,
      preValidatedSignature(owner),
    ],
  });
}

async function run(req: BundleRequest): Promise<BundleResult> {
  const sm = new ForkStateManager(req.rpcUrl, req.blockTag);
  const common = createCustomCommon({ chainId: req.chainId }, Mainnet, {
    hardfork: Hardfork.Cancun,
  });
  const evm = await createEVM({ common, stateManager: sm });

  const safeAddr = createAddressFromString(req.safe);
  const caller = createAddressFromString(req.owner);

  // Load the real Safe first, then drop its threshold to 1 so a single
  // pre-validated signature is enough. Everything else stays authentic.
  await sm.getAccount(safeAddr);
  await sm.getCode(safeAddr);
  await sm.putStorage(safeAddr, slotKey(THRESHOLD_SLOT), hexToBytes("0x01"));

  const results: BundleTxResult[] = [];

  for (const tx of req.txs) {
    let entry: BundleTxResult;
    try {
      const r = await evm.runCall({
        caller,
        to: safeAddr,
        data: hexToBytes(execCalldata(tx, req.owner)),
        value: 0n,
        gasLimit: GAS_LIMIT,
        skipBalance: true,
      });
      const ex = r.execResult;
      const returnValue = bytesToHex(ex.returnValue ?? new Uint8Array());
      const gasUsed = (ex.executionGasUsed ?? 0n).toString();

      if (ex.exceptionError) {
        entry = {
          id: tx.id,
          nonce: tx.nonce,
          status: "reverted",
          reason: decodeReason(returnValue) ?? String(ex.exceptionError.error),
          gasUsed,
        };
      } else {
        const ok = returnValue !== "0x" ? BigInt(returnValue) !== 0n : true;
        entry = {
          id: tx.id,
          nonce: tx.nonce,
          status: ok ? "success" : "inner-failed",
          gasUsed,
        };
      }
    } catch (e) {
      entry = {
        id: tx.id,
        nonce: tx.nonce,
        status: "reverted",
        reason: e instanceof Error ? e.message : String(e),
        gasUsed: "0",
      };
    }

    results.push(entry);
    ctx.postMessage({
      type: "progress",
      done: results.length,
      total: req.txs.length,
      rpcCalls: sm.rpcCalls,
    });
  }

  let finalNonce: number | null = null;
  try {
    const r = await evm.runCall({
      caller,
      to: safeAddr,
      data: hexToBytes(
        encodeFunctionData({ abi: SAFE_ABI, functionName: "nonce" }),
      ),
      gasLimit: GAS_LIMIT,
      skipBalance: true,
    });
    const out = bytesToHex(r.execResult.returnValue ?? new Uint8Array());
    if (out && out !== "0x") finalNonce = Number(BigInt(out));
  } catch {
    /* nonce readback is a nicety */
  }

  return { results, rpcCalls: sm.rpcCalls, finalNonce };
}

ctx.addEventListener("message", async (e: MessageEvent<BundleRequest>) => {
  try {
    ctx.postMessage({ type: "done", result: await run(e.data) });
  } catch (err) {
    ctx.postMessage({
      type: "error",
      error: err instanceof Error ? err.message : String(err),
    });
  }
});
