import type { PublicClient, Address, Hex } from "viem";
import { getAddress } from "viem";

export type ProxyInfo = {
  /** Human label for the proxy standard. */
  kind: string;
  /** Implementation (logic) contract address. */
  implementation: string;
  /** Beacon address, when the proxy points at a beacon. */
  beacon?: string;
};

// Well-known implementation storage slots.
const IMPL_SLOTS: { slot: Hex; kind: string }[] = [
  // EIP-1967: bytes32(uint256(keccak256("eip1967.proxy.implementation")) - 1)
  { slot: "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc", kind: "EIP-1967" },
  // EIP-1822 (UUPS): keccak256("PROXIABLE")
  { slot: "0xc5f16f0fcc639fa48a6947836d9850f504798523bf8c9a3a87d5876cf622bcf7", kind: "EIP-1822 (UUPS)" },
  // OpenZeppelin legacy: keccak256("org.zeppelinos.proxy.implementation")
  { slot: "0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3", kind: "OZ legacy" },
];

// EIP-1967 beacon slot: bytes32(uint256(keccak256("eip1967.proxy.beacon")) - 1)
const BEACON_SLOT: Hex = "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50";

const IMPLEMENTATION_ABI = [
  {
    type: "function",
    name: "implementation",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
] as const;

/** Extract a non-zero address from a 32-byte storage word (or raw address). */
function asAddress(raw?: string | null): string | null {
  if (!raw) return null;
  const hex = raw.toLowerCase().replace(/^0x/, "");
  if (hex.length < 40) return null;
  const addr = "0x" + hex.slice(-40);
  if (/^0x0{40}$/.test(addr)) return null;
  try {
    return getAddress(addr);
  } catch {
    return null;
  }
}

/** EIP-1167 minimal proxy: implementation address is baked into the bytecode. */
function parseMinimalProxy(code?: string): string | null {
  if (!code) return null;
  const m = code
    .toLowerCase()
    .match(/363d3d373d3d3d363d73([0-9a-f]{40})5af43d82803e903d91602b57fd5bf3/);
  return m ? asAddress(m[1]) : null;
}

/**
 * Detect common proxy patterns and resolve the implementation address.
 * Returns null for non-proxies. Best-effort — never throws.
 */
export async function detectProxy(
  client: PublicClient,
  address: Address,
): Promise<ProxyInfo | null> {
  const reads = await Promise.all([
    client.getCode({ address }).catch(() => undefined),
    ...IMPL_SLOTS.map((s) =>
      client.getStorageAt({ address, slot: s.slot }).catch(() => undefined),
    ),
    client.getStorageAt({ address, slot: BEACON_SLOT }).catch(() => undefined),
  ]);
  const code = reads[0] as string | undefined;
  const slotVals = reads.slice(1, 1 + IMPL_SLOTS.length) as (string | undefined)[];
  const beaconVal = reads[1 + IMPL_SLOTS.length] as string | undefined;

  for (let i = 0; i < IMPL_SLOTS.length; i++) {
    const impl = asAddress(slotVals[i]);
    if (impl) return { kind: IMPL_SLOTS[i].kind, implementation: impl };
  }

  const beacon = asAddress(beaconVal);
  if (beacon) {
    try {
      const impl = await client.readContract({
        address: beacon as Address,
        abi: IMPLEMENTATION_ABI,
        functionName: "implementation",
      });
      const implAddr = asAddress(impl as string);
      if (implAddr) return { kind: "EIP-1967 beacon", implementation: implAddr, beacon };
    } catch {
      // beacon without a standard implementation() getter
    }
  }

  const minimal = parseMinimalProxy(code);
  if (minimal) return { kind: "EIP-1167 minimal", implementation: minimal };

  return null;
}
