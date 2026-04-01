import { useEffect, useState } from "react";
import {
  fetchContractSource,
  type ContractSource,
} from "../lib/contract";
import type { PublicClient, Address } from "viem";

type Props = {
  address: string;
  client: PublicClient;
};

export function ContractCode({ address, client }: Props) {
  const [source, setSource] = useState<ContractSource | null>(null);
  const [bytecode, setBytecode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeFile, setActiveFile] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setSource(null);
    setBytecode(null);
    setActiveFile(0);

    (async () => {
      const src = await fetchContractSource(address);
      if (cancelled) return;

      if (src) {
        setSource(src);
        setLoading(false);
      } else {
        try {
          const code = await client.getCode({ address: address as Address });
          if (!cancelled && code && code !== "0x") {
            setBytecode(code);
          }
        } catch {
          // bytecode fetch may fail
        }
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [address, client]);

  if (loading) {
    return (
      <div className="rounded bg-gray-900/50 p-4">
        <p className="animate-pulse text-xs text-gray-500">
          Loading contract code…
        </p>
      </div>
    );
  }

  if (source) {
    const files = [
      { name: source.name || "Main", code: source.sourceCode },
      ...source.additionalSources.map((s) => ({
        name: s.filename.split("/").pop() ?? s.filename,
        code: s.code,
      })),
    ];

    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-xs sm:gap-3">
          <span className="rounded bg-green-900/50 px-2 py-0.5 text-green-400">
            Verified
          </span>
          {source.compiler && (
            <span className="text-gray-500">
              {source.compiler}
            </span>
          )}
          {source.isProxy && (
            <span className="rounded bg-amber-900/50 px-2 py-0.5 text-amber-400">
              Proxy
            </span>
          )}
          {source.implementationAddress && (
            <span className="max-w-32 truncate font-mono text-gray-500 sm:max-w-48" title={source.implementationAddress}>
              impl: {source.implementationAddress.slice(0, 10)}…
            </span>
          )}
        </div>

        {files.length > 1 && (
          <div className="flex flex-wrap gap-1">
            {files.map((f, i) => (
              <button
                key={i}
                onClick={() => setActiveFile(i)}
                className={`rounded px-2 py-0.5 font-mono text-[11px] transition ${
                  i === activeFile
                    ? "bg-gray-700 text-gray-200"
                    : "text-gray-500 hover:text-gray-300"
                }`}
              >
                {f.name}
              </button>
            ))}
          </div>
        )}

        <div className="max-h-[60vh] overflow-auto rounded bg-gray-950 ring-1 ring-gray-800 sm:max-h-[500px]">
          <pre className="p-3 font-mono text-[11px] leading-relaxed text-gray-300 sm:p-4 sm:text-xs">
            <code>{files[activeFile]?.code}</code>
          </pre>
        </div>
      </div>
    );
  }

  if (bytecode) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-xs">
          <span className="rounded bg-gray-700 px-2 py-0.5 text-gray-400">
            Unverified
          </span>
          <span className="text-gray-500">
            Bytecode ({Math.floor((bytecode.length - 2) / 2)} bytes)
          </span>
        </div>
        <div className="max-h-[50vh] overflow-auto rounded bg-gray-950 ring-1 ring-gray-800 sm:max-h-[300px]">
          <pre className="break-all p-3 font-mono text-[11px] leading-relaxed text-gray-500 sm:p-4">
            {bytecode}
          </pre>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded bg-gray-900/50 p-4">
      <p className="text-xs text-gray-500">No code found at this address</p>
    </div>
  );
}
