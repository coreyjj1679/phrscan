import type { Abi, PublicClient, Hex, Address, Log } from "viem";
import {
  decodeFunctionResult,
  encodeFunctionData,
  decodeEventLog,
} from "viem";
import type { AbiFunction } from "./abi";
import { traceCall, type TraceCall } from "./trace";

export type DecodedLog = {
  eventName: string;
  args: Record<string, unknown>;
  address: Address;
  raw: { topics: Hex[]; data: Hex };
};

export type CallResult = {
  decoded: unknown;
  raw: Hex;
  gasEstimate?: bigint;
  logs?: DecodedLog[];
  error?: string;
  trace?: TraceCall | null;
};

function decodeLogs(rawLogs: Log[], abi: Abi | null): DecodedLog[] {
  return rawLogs.map((log) => {
    const raw = {
      topics: (log.topics ?? []) as Hex[],
      data: (log.data ?? "0x") as Hex,
    };

    if (abi) {
      try {
        const decoded = decodeEventLog({
          abi,
          data: log.data,
          topics: log.topics,
        });
        return {
          eventName: decoded.eventName ?? "Unknown",
          args: (decoded.args ?? {}) as Record<string, unknown>,
          address: log.address,
          raw,
        };
      } catch {
        // fall through to raw log
      }
    }

    return {
      eventName: raw.topics[0]?.slice(0, 10) ?? "Unknown",
      args: {},
      address: log.address,
      raw,
    };
  });
}

type SimResult = {
  result: unknown;
  gasUsed: bigint;
  logs: DecodedLog[];
  error?: string;
};

async function trySimulateCalls(
  client: PublicClient,
  call: {
    to: Address;
    data?: Hex;
    value?: bigint;
    abi?: Abi;
    functionName?: string;
    args?: unknown[];
  },
  opts: { from?: Address; blockNumber?: bigint },
  abi: Abi | null,
): Promise<SimResult | null> {
  try {
    const callObj: Record<string, unknown> = { to: call.to };
    if (call.abi && call.functionName) {
      callObj.abi = call.abi;
      callObj.functionName = call.functionName;
      if (call.args) callObj.args = call.args;
    } else if (call.data) {
      callObj.data = call.data;
    }
    if (call.value) callObj.value = call.value;

    const simOpts: Record<string, unknown> = {
      calls: [callObj],
    };
    if (opts.from) simOpts.account = opts.from;
    if (opts.blockNumber) simOpts.blockNumber = opts.blockNumber;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { results } = await (client as any).simulateCalls(simOpts);
    const r = results[0];
    if (!r) return null;

    if (r.status === "failure" && r.error) {
      const msg = r.error instanceof Error ? r.error.message : String(r.error);
      const logs = decodeLogs(r.logs ?? [], abi);
      return { result: undefined, gasUsed: r.gasUsed ?? 0n, logs, error: msg };
    }

    const logs = decodeLogs(r.logs ?? [], abi);
    return { result: r.result, gasUsed: r.gasUsed ?? 0n, logs };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (
      msg.includes("not supported") ||
      msg.includes("not found") ||
      msg.includes("eth_simulateV1") ||
      msg.includes("does not exist")
    ) {
      return null;
    }
    throw e;
  }
}

export async function readOrSimulate(
  client: PublicClient,
  address: Address,
  abi: Abi,
  fn: AbiFunction,
  args: unknown[],
  opts: { from?: Address; blockNumber?: bigint; value?: bigint },
): Promise<CallResult> {
  const isRead = fn.stateMutability === "view" || fn.stateMutability === "pure";
  const calldata = encodeFunctionData({ abi, functionName: fn.name, args });

  const traceParams = { from: opts.from, to: address, data: calldata, value: opts.value };

  const sim = await trySimulateCalls(
    client,
    { to: address, abi, functionName: fn.name, args, value: opts.value },
    opts,
    abi,
  );

  if (sim) {
    let trace: TraceCall | null = null;
    if (!isRead || sim.error) {
      trace = await traceCall(client, traceParams, opts.blockNumber);
    }
    return {
      decoded: sim.result,
      raw: "0x" as Hex,
      gasEstimate: sim.gasUsed,
      logs: sim.logs,
      trace,
      error: sim.error,
    };
  }

  if (isRead) {
    const result = await client.readContract({
      address,
      abi,
      functionName: fn.name,
      args,
      blockNumber: opts.blockNumber,
    });
    let gasEstimate: bigint | undefined;
    try {
      gasEstimate = await client.estimateGas({
        to: address,
        data: calldata,
        account: opts.from,
        blockNumber: opts.blockNumber,
      });
    } catch {
      // gas estimation can fail for view functions without a from address
    }
    return { decoded: result, raw: "0x" as Hex, gasEstimate };
  }

  try {
    const { result } = await client.simulateContract({
      address,
      abi,
      functionName: fn.name,
      args,
      account: opts.from,
      blockNumber: opts.blockNumber,
      value: opts.value,
    });

    const trace = await traceCall(client, traceParams, opts.blockNumber);
    return { decoded: result, raw: "0x" as Hex, trace };
  } catch (err) {
    const trace = await traceCall(client, traceParams, opts.blockNumber);
    const msg = err instanceof Error ? err.message : String(err);
    return { decoded: undefined, raw: "0x" as Hex, error: msg, trace };
  }
}

export async function rawCall(
  client: PublicClient,
  opts: {
    to: Address;
    data: Hex;
    from?: Address;
    value?: bigint;
    blockNumber?: bigint;
  },
  abi?: Abi | null,
): Promise<CallResult> {
  const traceParams = { from: opts.from, to: opts.to, data: opts.data, value: opts.value };

  const sim = await trySimulateCalls(
    client,
    { to: opts.to, data: opts.data, value: opts.value },
    { from: opts.from, blockNumber: opts.blockNumber },
    abi ?? null,
  );

  const trace = await traceCall(client, traceParams, opts.blockNumber);

  if (sim) {
    return {
      decoded: sim.result ?? opts.data,
      raw: "0x" as Hex,
      gasEstimate: sim.gasUsed,
      logs: sim.logs,
      trace,
      error: sim.error,
    };
  }

  try {
    const { data: raw } = await client.call({
      to: opts.to,
      data: opts.data,
      account: opts.from,
      value: opts.value,
      blockNumber: opts.blockNumber,
    });

    let gasEstimate: bigint | undefined;
    try {
      gasEstimate = await client.estimateGas({
        to: opts.to,
        data: opts.data,
        account: opts.from,
        value: opts.value,
        blockNumber: opts.blockNumber,
      });
    } catch {
      // gas estimation may fail
    }

    return { decoded: raw ?? "0x", raw: (raw ?? "0x") as Hex, gasEstimate, trace };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { decoded: undefined, raw: "0x" as Hex, error: msg, trace };
  }
}

export function tryDecodeResult(
  abi: Abi,
  functionName: string,
  data: Hex,
): unknown {
  try {
    return decodeFunctionResult({ abi, functionName, data });
  } catch {
    return data;
  }
}

export function tryDecodeLogs(rawLogs: Log[], abi: Abi): DecodedLog[] {
  return decodeLogs(rawLogs, abi);
}
