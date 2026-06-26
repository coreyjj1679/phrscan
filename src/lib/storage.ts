import type { Abi } from "viem";
import { ACTIVE_NETWORK, NETWORKS } from "../config/chain";

// Per-network storage: contracts, calls, addresses, ABIs, and the RPC override
// are scoped to the active chain so testnet and mainnet data stay separate.
const ns = (base: string) => `miniscan:${ACTIVE_NETWORK.chainId}:${base}`;

const CONTRACTS_KEY = ns("contracts");
const CALLS_KEY = ns("calls");
const ADDRESSES_KEY = ns("addresses");
const ABI_REGISTRY_KEY = ns("abi-registry");
const AUTO_LABELS_KEY = ns("auto-labels");
const RPC_URL_KEY = ns("rpc-url");
const SETTINGS_KEY = "miniscan:settings";

// One-time migration: legacy (pre-network) data belonged to the testnet.
(() => {
  try {
    if (localStorage.getItem("miniscan:migrated-v1")) return;
    const t = NETWORKS.testnet.chainId;
    const pairs: [string, string][] = [
      ["miniscan:contracts", `miniscan:${t}:contracts`],
      ["miniscan:calls", `miniscan:${t}:calls`],
      ["miniscan:addresses", `miniscan:${t}:addresses`],
      ["miniscan:abi-registry", `miniscan:${t}:abi-registry`],
      ["miniscan:rpc-url", `miniscan:${t}:rpc-url`],
    ];
    for (const [oldK, newK] of pairs) {
      const v = localStorage.getItem(oldK);
      if (v !== null && localStorage.getItem(newK) === null) {
        localStorage.setItem(newK, v);
      }
    }
    localStorage.setItem("miniscan:migrated-v1", "1");
  } catch {
    /* localStorage unavailable */
  }
})();

export type SavedContract = {
  address: string;
  label: string;
  abi: Abi;
  savedAt: number;
};

export type SavedCall = {
  id: string;
  label: string;
  contractAddress: string;
  functionName: string;
  args: string[];
  from: string;
  value: string;
  blockNumber: string;
  useCustomBlock: boolean;
  mode: "function" | "calldata";
  calldata?: string;
  savedAt: number;
};

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function getSavedContracts(): SavedContract[] {
  return readJson<SavedContract[]>(CONTRACTS_KEY, []);
}

export function saveContract(contract: SavedContract): void {
  const existing = getSavedContracts();
  const idx = existing.findIndex(
    (c) => c.address.toLowerCase() === contract.address.toLowerCase(),
  );
  if (idx >= 0) {
    existing[idx] = contract;
  } else {
    existing.unshift(contract);
  }
  localStorage.setItem(CONTRACTS_KEY, JSON.stringify(existing));
}

export function updateContractAbi(address: string, abi: Abi): void {
  const existing = getSavedContracts();
  const idx = existing.findIndex(
    (c) => c.address.toLowerCase() === address.toLowerCase(),
  );
  if (idx >= 0) {
    existing[idx] = { ...existing[idx], abi, savedAt: Date.now() };
    localStorage.setItem(CONTRACTS_KEY, JSON.stringify(existing));
  }
}

export function deleteContract(address: string): void {
  const existing = getSavedContracts().filter(
    (c) => c.address.toLowerCase() !== address.toLowerCase(),
  );
  localStorage.setItem(CONTRACTS_KEY, JSON.stringify(existing));
  const calls = getSavedCalls().filter(
    (c) => c.contractAddress.toLowerCase() !== address.toLowerCase(),
  );
  localStorage.setItem(CALLS_KEY, JSON.stringify(calls));
}

export function getSavedCalls(contractAddress?: string): SavedCall[] {
  const all = readJson<SavedCall[]>(CALLS_KEY, []);
  if (!contractAddress) return all;
  return all.filter(
    (c) => c.contractAddress.toLowerCase() === contractAddress.toLowerCase(),
  );
}

export function saveCall(call: SavedCall): void {
  const existing = readJson<SavedCall[]>(CALLS_KEY, []);
  const idx = existing.findIndex((c) => c.id === call.id);
  if (idx >= 0) {
    existing[idx] = call;
  } else {
    existing.unshift(call);
  }
  localStorage.setItem(CALLS_KEY, JSON.stringify(existing));
}

export function deleteCall(id: string): void {
  const existing = readJson<SavedCall[]>(CALLS_KEY, []).filter(
    (c) => c.id !== id,
  );
  localStorage.setItem(CALLS_KEY, JSON.stringify(existing));
}

export type SavedAddress = {
  address: string;
  label: string;
  savedAt: number;
};

export function getSavedAddresses(): SavedAddress[] {
  return readJson<SavedAddress[]>(ADDRESSES_KEY, []);
}

export function saveAddress(entry: SavedAddress): void {
  const existing = getSavedAddresses();
  const idx = existing.findIndex(
    (a) => a.address.toLowerCase() === entry.address.toLowerCase(),
  );
  if (idx >= 0) {
    existing[idx] = entry;
  } else {
    existing.unshift(entry);
  }
  localStorage.setItem(ADDRESSES_KEY, JSON.stringify(existing));
}

export function deleteAddress(address: string): void {
  const existing = getSavedAddresses().filter(
    (a) => a.address.toLowerCase() !== address.toLowerCase(),
  );
  localStorage.setItem(ADDRESSES_KEY, JSON.stringify(existing));
}

/** Auto-derived labels (e.g. token symbols). User labels take precedence. */
export function getAutoLabels(): Map<string, string> {
  const obj = readJson<Record<string, string>>(AUTO_LABELS_KEY, {});
  return new Map(Object.entries(obj));
}

/** Save an auto-label. Returns true if it changed (new or different). */
export function setAutoLabel(address: string, label: string): boolean {
  const obj = readJson<Record<string, string>>(AUTO_LABELS_KEY, {});
  const key = address.toLowerCase();
  if (obj[key] === label) return false;
  obj[key] = label;
  try {
    localStorage.setItem(AUTO_LABELS_KEY, JSON.stringify(obj));
  } catch {
    /* ignore */
  }
  return true;
}

export function clearAutoLabels(): void {
  try {
    localStorage.removeItem(AUTO_LABELS_KEY);
  } catch {
    /* ignore */
  }
}

export function resolveAddressLabel(address: string): string | undefined {
  const lc = address.toLowerCase();
  const addrMatch = getSavedAddresses().find(
    (a) => a.address.toLowerCase() === lc,
  );
  if (addrMatch) return addrMatch.label;
  const contractMatch = getSavedContracts().find(
    (c) => c.address.toLowerCase() === lc,
  );
  return contractMatch?.label;
}

type AbiRegistryEntry = {
  address: string;
  abi: Abi;
  savedAt: number;
};

export function getAbiRegistry(): Map<string, Abi> {
  const entries = readJson<AbiRegistryEntry[]>(ABI_REGISTRY_KEY, []);
  const map = new Map<string, Abi>();
  for (const e of entries) map.set(e.address.toLowerCase(), e.abi);
  return map;
}

export function getAbiForAddress(address: string): Abi | undefined {
  const entries = readJson<AbiRegistryEntry[]>(ABI_REGISTRY_KEY, []);
  return entries.find(
    (e) => e.address.toLowerCase() === address.toLowerCase(),
  )?.abi;
}

export function saveAbi(address: string, abi: Abi): void {
  const entries = readJson<AbiRegistryEntry[]>(ABI_REGISTRY_KEY, []);
  const key = address.toLowerCase();
  const idx = entries.findIndex((e) => e.address.toLowerCase() === key);
  const entry: AbiRegistryEntry = { address, abi, savedAt: Date.now() };
  if (idx >= 0) {
    entries[idx] = entry;
  } else {
    entries.unshift(entry);
  }
  localStorage.setItem(ABI_REGISTRY_KEY, JSON.stringify(entries));
}

export function deleteAbi(address: string): void {
  const entries = readJson<AbiRegistryEntry[]>(ABI_REGISTRY_KEY, []).filter(
    (e) => e.address.toLowerCase() !== address.toLowerCase(),
  );
  localStorage.setItem(ABI_REGISTRY_KEY, JSON.stringify(entries));
}

export function getAllAbiEntries(): AbiRegistryEntry[] {
  return readJson<AbiRegistryEntry[]>(ABI_REGISTRY_KEY, []);
}

// Replay history is scoped to the active network, like the other saved lists.
const REPLAY_HISTORY_KEY = ns("replay-history");
const REPLAY_HISTORY_LIMIT = 100;

export type ReplayHistoryEntry = {
  hash: string;
  blockNumber: string;
  from: string;
  to: string;
  status: "success" | "reverted";
  /** Optional user-assigned name/label for the replay. */
  tag?: string;
  viewedAt: number;
};

export function getReplayHistory(): ReplayHistoryEntry[] {
  return readJson<ReplayHistoryEntry[]>(REPLAY_HISTORY_KEY, []);
}

/** Record a replayed transaction, de-duped by hash and moved to the top. */
export function addReplayHistory(entry: Omit<ReplayHistoryEntry, "viewedAt">): void {
  const all = getReplayHistory();
  const prev = all.find((e) => e.hash.toLowerCase() === entry.hash.toLowerCase());
  const rest = all.filter((e) => e.hash.toLowerCase() !== entry.hash.toLowerCase());
  // Preserve any name the user assigned to this tx on a previous replay.
  rest.unshift({ ...entry, tag: entry.tag ?? prev?.tag, viewedAt: Date.now() });
  try {
    localStorage.setItem(
      REPLAY_HISTORY_KEY,
      JSON.stringify(rest.slice(0, REPLAY_HISTORY_LIMIT)),
    );
  } catch {
    /* ignore */
  }
}

export function setReplayHistoryTag(hash: string, tag: string): void {
  const all = getReplayHistory();
  const idx = all.findIndex((e) => e.hash.toLowerCase() === hash.toLowerCase());
  if (idx < 0) return;
  const trimmed = tag.trim();
  all[idx] = { ...all[idx], tag: trimmed || undefined };
  try {
    localStorage.setItem(REPLAY_HISTORY_KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
}

export function deleteReplayHistory(hash: string): void {
  const rest = getReplayHistory().filter(
    (e) => e.hash.toLowerCase() !== hash.toLowerCase(),
  );
  localStorage.setItem(REPLAY_HISTORY_KEY, JSON.stringify(rest));
}

export function clearReplayHistory(): void {
  try {
    localStorage.removeItem(REPLAY_HISTORY_KEY);
  } catch {
    /* ignore */
  }
}

export function getSavedRpcUrl(): string | null {
  return localStorage.getItem(RPC_URL_KEY);
}

export function saveRpcUrl(url: string): void {
  localStorage.setItem(RPC_URL_KEY, url);
}

export type ThemeMode = "system" | "light" | "dark";

export type AppSettings = {
  addressBookSuggest: boolean;
  theme: ThemeMode;
};

const DEFAULT_SETTINGS: AppSettings = {
  addressBookSuggest: true,
  theme: "system",
};

export function getSettings(): AppSettings {
  return { ...DEFAULT_SETTINGS, ...readJson<Partial<AppSettings>>(SETTINGS_KEY, {}) };
}

export function saveSettings(patch: Partial<AppSettings>): void {
  const current = getSettings();
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...current, ...patch }));
}
