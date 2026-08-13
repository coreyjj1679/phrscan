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

/** Safe{Wallet} Client Gateway — Pharos Pacific is listed; Atlantic is not. */
export const SAFE_CLIENT_URL = "https://safe-client.safe.global";
/** `app.safe.global` shortName for Pacific; null when the chain isn't on Safe infra. */
export const SAFE_APP_CHAIN = ACTIVE_NETWORK.id === "mainnet" ? "pharos" : null;

/**
 * Safe 1.4.1 canonical deployments (same CREATE2 addresses on Pacific and
 * Atlantic). Used to label system contracts and unwrap MultiSend batches.
 */
export const SAFE_SYSTEM_CONTRACTS: Record<string, string> = {
  "0x41675c099f32341bf84bfc5382af534df5c7461a": "Safe 1.4.1",
  "0x29fcb43b46531bca003ddc8fcb67ffe91900c762": "SafeL2 1.4.1",
  "0x4e1dcf7ad4e460cfd30791ccc4f9c8a4f820ec67": "SafeProxyFactory 1.4.1",
  "0x38869bf66a61cf6bdb996a6ae40d5853fd43b526": "MultiSend 1.4.1",
  "0x9641d764fc13c8b624c04430c7356c1c7c8102e2": "MultiSendCallOnly 1.4.1",
  "0xfd0732dc9e303f09fcef3a7388ad10a83459ec99": "CompatibilityFallbackHandler 1.4.1",
  "0xd53cd0ab83d845ac265be939c57f53ad838012c9": "SignMessageLib 1.4.1",
  "0x3d4ba2e0884aa488718476ca2fb8efc291a46199": "SimulateTxAccessor 1.4.1",
  "0x9b35af71d77eaf8d7e40252370304687390a1a52": "CreateCall 1.4.1",
};

export const SAFE_MULTISEND_ADDRESSES = new Set([
  "0x38869bf66a61cf6bdb996a6ae40d5853fd43b526",
  "0x9641d764fc13c8b624c04430c7356c1c7c8102e2",
]);
