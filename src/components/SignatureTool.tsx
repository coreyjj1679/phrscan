import { useState } from "react";
import {
  recoverMessageAddress,
  recoverTypedDataAddress,
  recoverAddress,
  hashTypedData,
  isAddress,
  type Hex,
} from "viem";
import { CopyButton } from "./CopyButton";
import { EXPLORER_URL } from "../config/chain";

type Mode = "personal" | "typed" | "hash";

type Result = { address?: string; digest?: string; error?: string };

const TYPED_PLACEHOLDER = `{
  "domain": { "name": "Permit2", "chainId": 688689, "verifyingContract": "0x…" },
  "primaryType": "PermitTransferFrom",
  "types": {
    "PermitTransferFrom": [
      { "name": "permitted", "type": "TokenPermissions" },
      { "name": "spender", "type": "address" },
      { "name": "nonce", "type": "uint256" },
      { "name": "deadline", "type": "uint256" }
    ],
    "TokenPermissions": [
      { "name": "token", "type": "address" },
      { "name": "amount", "type": "uint256" }
    ]
  },
  "message": { "…": "…" }
}`;

export function SignatureTool() {
  const [mode, setMode] = useState<Mode>("personal");
  const [message, setMessage] = useState("");
  const [hexMessage, setHexMessage] = useState(false);
  const [typed, setTyped] = useState("");
  const [hash, setHash] = useState("");
  const [signature, setSignature] = useState("");
  const [expected, setExpected] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    setResult(null);
    try {
      const sig = signature.trim() as Hex;
      if (!/^0x[0-9a-fA-F]+$/.test(sig)) throw new Error("Signature must be 0x hex.");

      if (mode === "personal") {
        const address = await recoverMessageAddress({
          message: hexMessage ? { raw: message.trim() as Hex } : message,
          signature: sig,
        });
        setResult({ address });
      } else if (mode === "hash") {
        const h = hash.trim() as Hex;
        if (!/^0x[0-9a-fA-F]{64}$/.test(h)) throw new Error("Hash must be 0x + 64 hex (32 bytes).");
        const address = await recoverAddress({ hash: h, signature: sig });
        setResult({ address });
      } else {
        const parsed = JSON.parse(typed);
        const { domain, types, primaryType, message: msg } = parsed;
        if (!domain || !types || !primaryType || !msg) {
          throw new Error("Typed data needs domain, types, primaryType and message.");
        }
        // viem derives EIP712Domain from `domain`; drop it if pasted.
        const cleanTypes = { ...types };
        delete cleanTypes.EIP712Domain;
        const digest = hashTypedData({ domain, types: cleanTypes, primaryType, message: msg });
        const address = await recoverTypedDataAddress({
          domain,
          types: cleanTypes,
          primaryType,
          message: msg,
          signature: sig,
        });
        setResult({ address, digest });
      }
    } catch (e) {
      setResult({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const match =
    result?.address && expected.trim() && isAddress(expected.trim())
      ? result.address.toLowerCase() === expected.trim().toLowerCase()
      : null;

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h2 className="mb-2 text-xs font-semibold tracking-wide text-gray-500 uppercase">
          Signature &amp; EIP-712
        </h2>
        <p className="mb-2 text-xs text-gray-600">
          Recover the signer from a signature — personal (EIP-191) messages, EIP-712 typed data
          (permits/intents), or a raw 32-byte hash. Everything runs locally.
        </p>
        <div className="mb-3 inline-flex rounded-md bg-gray-900 p-0.5 ring-1 ring-gray-700">
          {(["personal", "typed", "hash"] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => {
                setMode(m);
                setResult(null);
              }}
              className={`rounded px-3 py-1 text-xs font-medium transition ${
                mode === m ? "bg-cyan-700 text-on-accent" : "text-gray-400 hover:text-gray-200"
              }`}
            >
              {m === "personal" ? "Personal (EIP-191)" : m === "typed" ? "Typed data (EIP-712)" : "Raw hash"}
            </button>
          ))}
        </div>
      </div>

      {mode === "personal" && (
        <Field label="Message">
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="The exact message that was signed"
            rows={3}
            spellCheck={false}
            className="w-full rounded bg-gray-900 px-3 py-2 font-mono text-xs text-gray-200 outline-none ring-1 ring-gray-700 focus:ring-cyan-600"
          />
          <label className="mt-1 flex items-center gap-2 text-xs text-gray-500">
            <input type="checkbox" checked={hexMessage} onChange={(e) => setHexMessage(e.target.checked)} />
            Message is hex bytes (0x…)
          </label>
        </Field>
      )}

      {mode === "typed" && (
        <Field label="Typed data JSON (eth_signTypedData_v4 payload)">
          <textarea
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={TYPED_PLACEHOLDER}
            rows={10}
            spellCheck={false}
            className="w-full rounded bg-gray-900 px-3 py-2 font-mono text-xs text-gray-200 outline-none ring-1 ring-gray-700 focus:ring-cyan-600"
          />
        </Field>
      )}

      {mode === "hash" && (
        <Field label="Message hash (32 bytes)">
          <input
            type="text"
            value={hash}
            onChange={(e) => setHash(e.target.value)}
            placeholder="0x…"
            spellCheck={false}
            className="w-full rounded bg-gray-900 px-3 py-1.5 font-mono text-xs text-gray-200 outline-none ring-1 ring-gray-700 focus:ring-cyan-600"
          />
        </Field>
      )}

      <Field label="Signature (65-byte r,s,v)">
        <textarea
          value={signature}
          onChange={(e) => setSignature(e.target.value)}
          placeholder="0x…"
          rows={2}
          spellCheck={false}
          className="w-full rounded bg-gray-900 px-3 py-2 font-mono text-xs text-gray-200 outline-none ring-1 ring-gray-700 focus:ring-cyan-600"
        />
      </Field>

      <Field label="Expected signer (optional)">
        <input
          type="text"
          value={expected}
          onChange={(e) => setExpected(e.target.value)}
          placeholder="0x… — compare against the recovered address"
          spellCheck={false}
          className="w-full rounded bg-gray-900 px-3 py-1.5 font-mono text-xs text-gray-200 outline-none ring-1 ring-gray-700 focus:ring-cyan-600"
        />
      </Field>

      <button
        onClick={run}
        disabled={busy || !signature.trim()}
        className="rounded bg-cyan-700 px-4 py-2 text-sm font-medium text-on-accent hover:bg-cyan-600 disabled:opacity-40"
      >
        {busy ? "Recovering…" : "Recover signer"}
      </button>

      {result?.error && (
        <p className="rounded bg-red-950/40 px-3 py-2 text-xs text-red-400">{result.error}</p>
      )}

      {result?.address && (
        <div className="space-y-3 rounded-lg border border-border bg-surface p-3 sm:p-4">
          <div>
            <span className="block text-xs font-medium tracking-wider text-gray-600 uppercase">
              Recovered signer
            </span>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm text-emerald-400">{result.address}</span>
              <CopyButton text={result.address} />
              <a
                href={`${EXPLORER_URL}/address/${result.address}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-gray-500 hover:text-cyan-400"
              >
                ↗
              </a>
              {match !== null && (
                <span
                  className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                    match ? "bg-green-900/50 text-green-400" : "bg-red-900/50 text-red-400"
                  }`}
                >
                  {match ? "matches expected" : "does NOT match"}
                </span>
              )}
            </div>
          </div>
          {result.digest && (
            <div>
              <span className="block text-xs font-medium tracking-wider text-gray-600 uppercase">
                EIP-712 digest
              </span>
              <p className="mt-1 font-mono text-xs break-all text-gray-400">{result.digest}</p>
            </div>
          )}
        </div>
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
