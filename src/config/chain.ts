import { defineChain, type Chain } from "viem";

export type NetworkId = "testnet" | "mainnet";

export type NetworkConfig = {
  id: NetworkId;
  label: string;
  shortLabel: string;
  chainId: number;
  rpc: string;
  explorerUrl: string;
  explorerApi: string;
  currency: string;
  chain: Chain;
};

export const NETWORKS: Record<NetworkId, NetworkConfig> = {
  testnet: {
    id: "testnet",
    label: "Atlantic Testnet",
    shortLabel: "Testnet",
    chainId: 688689,
    rpc: "https://atlantic.dplabs-internal.com",
    explorerUrl: "https://atlantic.pharosscan.xyz",
    explorerApi:
      "https://api.socialscan.io/pharos-atlantic-testnet/v1/explorer/command_api",
    currency: "PROS",
    chain: defineChain({
      id: 688689,
      name: "Pharos Atlantic Testnet",
      nativeCurrency: { name: "PROS", symbol: "PROS", decimals: 18 },
      rpcUrls: { default: { http: ["https://atlantic.dplabs-internal.com"] } },
      blockExplorers: {
        default: { name: "PharosScan", url: "https://atlantic.pharosscan.xyz" },
      },
    }),
  },
  mainnet: {
    id: "mainnet",
    label: "Pacific Mainnet",
    shortLabel: "Mainnet",
    chainId: 1672,
    rpc: "https://rpc.pharos.xyz",
    explorerUrl: "https://www.pharosscan.xyz",
    explorerApi:
      "https://api.socialscan.io/pharos-mainnet/v1/explorer/command_api",
    currency: "PROS",
    chain: defineChain({
      id: 1672,
      name: "Pharos Pacific Mainnet",
      nativeCurrency: { name: "PROS", symbol: "PROS", decimals: 18 },
      rpcUrls: { default: { http: ["https://rpc.pharos.xyz"] } },
      blockExplorers: {
        default: { name: "PharosScan", url: "https://www.pharosscan.xyz" },
      },
    }),
  },
};

const NETWORK_KEY = "miniscan:network";

export function getActiveNetworkId(): NetworkId {
  // A `net` URL param (from a shared link) wins over the persisted choice so
  // the link resolves on the right chain on first paint. Persist it so the
  // rest of the app, which reads ACTIVE_NETWORK, stays consistent.
  try {
    const fromUrl = new URLSearchParams(window.location.search).get("net");
    if (fromUrl === "mainnet" || fromUrl === "testnet") {
      setActiveNetworkId(fromUrl);
      return fromUrl;
    }
  } catch {
    /* window / URL unavailable */
  }
  try {
    const v = localStorage.getItem(NETWORK_KEY);
    if (v === "mainnet" || v === "testnet") return v;
  } catch {
    /* localStorage unavailable */
  }
  return "testnet";
}

export function setActiveNetworkId(id: NetworkId): void {
  try {
    localStorage.setItem(NETWORK_KEY, id);
  } catch {
    /* localStorage unavailable */
  }
}

/** The active network, resolved once at load. Switching networks reloads the app. */
export const ACTIVE_NETWORK: NetworkConfig = NETWORKS[getActiveNetworkId()];

// Per-active-network constants consumed across the app.
export const DEFAULT_RPC = ACTIVE_NETWORK.rpc;
export const EXPLORER_URL = ACTIVE_NETWORK.explorerUrl;
export const EXPLORER_API = ACTIVE_NETWORK.explorerApi;
export const EXPLORER_DIRECT_API = ACTIVE_NETWORK.explorerUrl;
export const CURRENCY = ACTIVE_NETWORK.currency;
