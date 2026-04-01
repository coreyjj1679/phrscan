import { defineChain } from "viem";

export const DEFAULT_RPC = "https://atlantic.dplabs-internal.com";

export const EXPLORER_URL = "https://atlantic.pharosscan.xyz";

export const EXPLORER_API =
  "https://api.socialscan.io/pharos-atlantic-testnet/v1/explorer/command_api";

export const EXPLORER_DIRECT_API = EXPLORER_URL;

export const pharosTestnet = defineChain({
  id: 688_689,
  name: "Pharos Atlantic Testnet",
  nativeCurrency: { name: "PHRS", symbol: "PHRS", decimals: 18 },
  rpcUrls: {
    default: { http: [DEFAULT_RPC] },
  },
  blockExplorers: {
    default: { name: "PharosScan", url: EXPLORER_URL },
  },
});
