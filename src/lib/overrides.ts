import { parseEther, type Address, type Hex, type StateOverride } from "viem";

export type StorageOverride = { slot: string; value: string };

export type AccountOverride = {
  address: string;
  /** Balance in the native currency (decimal). */
  balance?: string;
  /** Replacement bytecode (0x…). */
  code?: string;
  storage: StorageOverride[];
};

export type SimOverrides = {
  accounts: AccountOverride[];
  /** block.timestamp override (unix seconds, decimal). */
  timestamp?: string;
};

export type BuiltOverrides = {
  /** viem state override array for call/simulate/estimate. */
  state?: StateOverride;
  /** geth-format map for debug_traceCall. */
  rpcState?: Record<string, unknown>;
  /** block overrides for eth_simulateV1. */
  block?: { time: bigint };
};

export function emptyOverrides(): SimOverrides {
  return { accounts: [], timestamp: "" };
}

export function hasOverrides(o: SimOverrides): boolean {
  if (o.timestamp?.trim()) return true;
  return o.accounts.some(
    (a) =>
      a.address.trim() &&
      (a.balance?.trim() ||
        a.code?.trim() ||
        a.storage.some((s) => s.slot.trim() && s.value.trim())),
  );
}

/** viem state override array (for client.call / simulateContract / estimateGas). */
function buildStateOverride(o: SimOverrides): StateOverride | undefined {
  const out: {
    address: Address;
    balance?: bigint;
    code?: Hex;
    stateDiff?: { slot: Hex; value: Hex }[];
  }[] = [];

  for (const a of o.accounts) {
    const address = a.address.trim();
    if (!address) continue;
    const entry: (typeof out)[number] = { address: address as Address };
    let used = false;
    if (a.balance?.trim()) {
      entry.balance = parseEther(a.balance.trim());
      used = true;
    }
    if (a.code?.trim()) {
      entry.code = a.code.trim() as Hex;
      used = true;
    }
    const slots = a.storage
      .filter((s) => s.slot.trim() && s.value.trim())
      .map((s) => ({ slot: s.slot.trim() as Hex, value: s.value.trim() as Hex }));
    if (slots.length) {
      entry.stateDiff = slots;
      used = true;
    }
    if (used) out.push(entry);
  }

  return out.length ? (out as unknown as StateOverride) : undefined;
}

/** geth-format override map (for debug_traceCall stateOverrides). */
function buildRpcStateOverride(o: SimOverrides): Record<string, unknown> | undefined {
  const map: Record<string, unknown> = {};
  for (const a of o.accounts) {
    const address = a.address.trim();
    if (!address) continue;
    const entry: Record<string, unknown> = {};
    if (a.balance?.trim()) {
      entry.balance = "0x" + parseEther(a.balance.trim()).toString(16);
    }
    if (a.code?.trim()) entry.code = a.code.trim();
    const slots = a.storage.filter((s) => s.slot.trim() && s.value.trim());
    if (slots.length) {
      const sd: Record<string, string> = {};
      for (const s of slots) sd[s.slot.trim()] = s.value.trim();
      entry.stateDiff = sd;
    }
    if (Object.keys(entry).length) map[address] = entry;
  }
  return Object.keys(map).length ? map : undefined;
}

function buildBlockOverrides(o: SimOverrides): { time: bigint } | undefined {
  if (!o.timestamp?.trim()) return undefined;
  try {
    return { time: BigInt(o.timestamp.trim()) };
  } catch {
    return undefined;
  }
}

/** Build all override representations. May throw (e.g. invalid balance). */
export function buildOverrides(o: SimOverrides): BuiltOverrides {
  return {
    state: buildStateOverride(o),
    rpcState: buildRpcStateOverride(o),
    block: buildBlockOverrides(o),
  };
}
