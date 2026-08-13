/**
 * Sequential ("bundle") simulation of queued Safe transactions.
 *
 * Pharos has no bundle RPC — eth_simulateV1, eth_callMany, debug_traceCallMany,
 * trace_callMany and eth_callBundle are all absent — so this runs the queue in a
 * local EVM instead. State written by one execTransaction is visible to the
 * next, which is what makes a tx at nonce N+1 that depends on nonce N simulate
 * correctly. The Safe's threshold is set to 1 in the forked state, so no real
 * signatures are needed.
 */

export type BundleTx = {
  /** Matches SafeMultisigTx.id so results can be mapped back onto rows. */
  id: string;
  nonce: number | null;
  to: string;
  value: string;
  data: string;
  operation: 0 | 1;
  safeTxGas: string;
  baseGas: string;
  gasPrice: string;
  gasToken: string;
  refundReceiver: string;
};

export type BundleTxResult = {
  id: string;
  nonce: number | null;
  /** `success` — execTransaction returned true. */
  status: "success" | "inner-failed" | "reverted";
  reason?: string;
  gasUsed: string;
};

export type BundleResult = {
  results: BundleTxResult[];
  rpcCalls: number;
  /** Safe nonce after the whole queue ran. */
  finalNonce: number | null;
};

export type BundleRequest = {
  rpcUrl: string;
  chainId: number;
  blockTag: string;
  safe: string;
  owner: string;
  txs: BundleTx[];
};

export type BundleProgress = { done: number; total: number; rpcCalls: number };

export type BundleWorkerOut =
  | { type: "progress"; done: number; total: number; rpcCalls: number }
  | { type: "done"; result: BundleResult }
  | { type: "error"; error: string };

export type BundleHandle = {
  promise: Promise<BundleResult>;
  cancel: () => void;
};

export function startSafeBundle(
  req: BundleRequest,
  onProgress?: (p: BundleProgress) => void,
): BundleHandle {
  const worker = new Worker(new URL("./safeBundle.worker.ts", import.meta.url), {
    type: "module",
  });

  let settled = false;
  const promise = new Promise<BundleResult>((resolve, reject) => {
    worker.onmessage = (e: MessageEvent<BundleWorkerOut>) => {
      const m = e.data;
      if (m.type === "progress") {
        onProgress?.({ done: m.done, total: m.total, rpcCalls: m.rpcCalls });
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
      reject(new Error(e.message || "Bundle worker crashed"));
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
