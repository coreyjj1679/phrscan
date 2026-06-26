import { useState } from "react";
import {
  keccak256,
  encodePacked,
  toHex,
  pad,
  getAddress,
  type PublicClient,
  type Address,
  type Hex,
} from "viem";
import { CopyButton } from "./CopyButton";
import { EXPLORER_URL } from "../config/chain";

type Mode = "direct" | "mapping" | "array";
type KeyType = "address" | "uint256" | "bytes32" | "string";

type Row = { slot: string; value: string };

function normalizeSlot(input: string): Hex {
  const s = input.trim();
  if (s.startsWith("0x")) return pad(s as Hex, { size: 32 });
  return toHex(BigInt(s), { size: 32 });
}

function mappingSlot(baseSlot: bigint, key: string, keyType: KeyType): Hex {
  if (keyType === "address") {
    return keccak256(encodePacked(["uint256", "uint256"], [BigInt(getAddress(key.trim())), baseSlot]));
  }
  if (keyType === "uint256") {
    return keccak256(encodePacked(["uint256", "uint256"], [BigInt(key.trim()), baseSlot]));
  }
  if (keyType === "bytes32") {
    return keccak256(encodePacked(["bytes32", "uint256"], [pad(key.trim() as Hex, { size: 32 }), baseSlot]));
  }
  // string key: keccak256(bytes(key) ++ pad32(slot))
  return keccak256(encodePacked(["string", "uint256"], [key, baseSlot]));
}

function arrayElementSlot(baseSlot: bigint, index: bigint): Hex {
  const start = BigInt(keccak256(toHex(baseSlot, { size: 32 })));
  return toHex(start + index, { size: 32 });
}

export function StorageInspector({ client, address }: { client: PublicClient; address: string }) {
  const [mode, setMode] = useState<Mode>("direct");
  const [slot, setSlot] = useState("0");
  const [baseSlot, setBaseSlot] = useState("");
  const [key, setKey] = useState("");
  const [keyType, setKeyType] = useState<KeyType>("address");
  const [index, setIndex] = useState("0");
  const [computed, setComputed] = useState<string | null>(null);
  const [row, setRow] = useState<Row | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const read = async () => {
    setError(null);
    setRow(null);
    setComputed(null);
    setLoading(true);
    try {
      let target: Hex;
      if (mode === "direct") {
        target = normalizeSlot(slot);
      } else if (mode === "mapping") {
        target = mappingSlot(BigInt(normalizeSlot(baseSlot)), key, keyType);
        setComputed(target);
      } else {
        target = arrayElementSlot(BigInt(normalizeSlot(baseSlot)), BigInt(index.trim() || "0"));
        setComputed(target);
      }
      const value = await client.getStorageAt({ address: address as Address, slot: target });
      setRow({ slot: target, value: value ?? "0x" });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-gray-200">Storage Inspector</h3>
        <p className="mt-1 text-xs text-gray-600">
          Read raw EVM storage at <span className="font-mono">{address.slice(0, 10)}…</span> via{" "}
          <span className="font-mono">eth_getStorageAt</span>. Use the helpers to compute
          mapping/array slots.
        </p>
      </div>

      <div className="inline-flex rounded-md bg-gray-900 p-0.5 ring-1 ring-gray-700">
        {(["direct", "mapping", "array"] as Mode[]).map((m) => (
          <button
            key={m}
            onClick={() => {
              setMode(m);
              setRow(null);
              setComputed(null);
              setError(null);
            }}
            className={`rounded px-3 py-1 text-xs font-medium capitalize transition ${
              mode === m ? "bg-cyan-700 text-on-accent" : "text-gray-400 hover:text-gray-200"
            }`}
          >
            {m}
          </button>
        ))}
      </div>

      {mode === "direct" && (
        <Field label="Slot (hex or decimal)">
          <input
            value={slot}
            onChange={(e) => setSlot(e.target.value)}
            placeholder="0 or 0x…"
            spellCheck={false}
            className="w-full rounded bg-gray-900 px-3 py-1.5 font-mono text-xs text-gray-200 outline-none ring-1 ring-gray-700 focus:ring-cyan-600"
          />
        </Field>
      )}

      {(mode === "mapping" || mode === "array") && (
        <Field label="Base slot (declaration slot, hex or decimal)">
          <input
            value={baseSlot}
            onChange={(e) => setBaseSlot(e.target.value)}
            placeholder="e.g. 0 for the first declared variable"
            spellCheck={false}
            className="w-full rounded bg-gray-900 px-3 py-1.5 font-mono text-xs text-gray-200 outline-none ring-1 ring-gray-700 focus:ring-cyan-600"
          />
        </Field>
      )}

      {mode === "mapping" && (
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="flex-1">
            <Field label="Key">
              <input
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder={keyType === "address" ? "0x… holder address" : "key value"}
                spellCheck={false}
                className="w-full rounded bg-gray-900 px-3 py-1.5 font-mono text-xs text-gray-200 outline-none ring-1 ring-gray-700 focus:ring-cyan-600"
              />
            </Field>
          </div>
          <Field label="Key type">
            <select
              value={keyType}
              onChange={(e) => setKeyType(e.target.value as KeyType)}
              className="rounded bg-gray-900 px-2 py-1.5 text-xs text-gray-200 ring-1 ring-gray-700 focus:ring-cyan-600"
            >
              <option value="address">address</option>
              <option value="uint256">uint256</option>
              <option value="bytes32">bytes32</option>
              <option value="string">string</option>
            </select>
          </Field>
        </div>
      )}

      {mode === "array" && (
        <Field label="Index">
          <input
            value={index}
            onChange={(e) => setIndex(e.target.value)}
            placeholder="0"
            spellCheck={false}
            className="w-full rounded bg-gray-900 px-3 py-1.5 font-mono text-xs text-gray-200 outline-none ring-1 ring-gray-700 focus:ring-cyan-600"
          />
        </Field>
      )}

      <button
        onClick={read}
        disabled={loading}
        className="rounded bg-cyan-700 px-4 py-2 text-sm font-medium text-on-accent hover:bg-cyan-600 disabled:opacity-40"
      >
        {loading ? "Reading…" : "Read slot"}
      </button>

      {error && <p className="rounded bg-red-950/40 px-3 py-2 text-xs text-red-400">{error}</p>}

      {computed && (
        <p className="font-mono text-xs text-gray-500">
          computed slot: <span className="text-gray-400">{computed}</span>
        </p>
      )}

      {row && <SlotResult row={row} />}
    </div>
  );
}

function SlotResult({ row }: { row: Row }) {
  const word = pad((row.value && row.value !== "0x" ? row.value : "0x0") as Hex, { size: 32 });
  const big = BigInt(word);
  const addrLike = /^0x0{24}[0-9a-f]{40}$/i.test(word) && big !== 0n;
  const addr = addrLike ? getAddress(("0x" + word.slice(26)) as Hex) : null;
  const isBool = big === 0n || big === 1n;

  return (
    <div className="space-y-2 rounded-lg border border-border bg-surface p-3 sm:p-4">
      <Line label="Slot" value={row.slot} copy />
      <Line label="Raw (bytes32)" value={word} copy />
      <Line label="uint256" value={big.toString()} copy />
      {addr && <Line label="address" value={addr} copy explorer />}
      {isBool && <Line label="bool" value={big === 1n ? "true" : "false"} />}
    </div>
  );
}

function Line({
  label,
  value,
  copy,
  explorer,
}: {
  label: string;
  value: string;
  copy?: boolean;
  explorer?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-24 shrink-0 text-xs font-medium tracking-wider text-gray-600 uppercase">
        {label}
      </span>
      <span className="min-w-0 font-mono text-xs break-all text-gray-200">{value}</span>
      {copy && <CopyButton text={value} />}
      {explorer && (
        <a
          href={`${EXPLORER_URL}/address/${value}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-gray-500 hover:text-cyan-400"
        >
          ↗
        </a>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs text-gray-400">{label}</label>
      {children}
    </div>
  );
}
