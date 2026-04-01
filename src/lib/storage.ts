import type { Abi } from "viem";

const CONTRACTS_KEY = "miniscan:contracts";
const CALLS_KEY = "miniscan:calls";
const ADDRESSES_KEY = "miniscan:addresses";
const ABI_REGISTRY_KEY = "miniscan:abi-registry";
const RPC_URL_KEY = "miniscan:rpc-url";
const SETTINGS_KEY = "miniscan:settings";

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

export function getSavedRpcUrl(): string | null {
  return localStorage.getItem(RPC_URL_KEY);
}

export function saveRpcUrl(url: string): void {
  localStorage.setItem(RPC_URL_KEY, url);
}

export type AppSettings = {
  addressBookSuggest: boolean;
};

const DEFAULT_SETTINGS: AppSettings = { addressBookSuggest: true };

export function getSettings(): AppSettings {
  return { ...DEFAULT_SETTINGS, ...readJson<Partial<AppSettings>>(SETTINGS_KEY, {}) };
}

export function saveSettings(patch: Partial<AppSettings>): void {
  const current = getSettings();
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...current, ...patch }));
}
