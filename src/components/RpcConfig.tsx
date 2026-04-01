import { useState } from "react";

type Props = {
  rpcUrl: string;
  connected: boolean | null;
  onChangeRpc: (url: string) => void;
};

export function RpcConfig({ rpcUrl, connected, onChangeRpc }: Props) {
  const [draft, setDraft] = useState(rpcUrl);

  return (
    <div className="flex items-center gap-2">
      <div className="relative flex-1">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            if (draft !== rpcUrl) onChangeRpc(draft);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && draft !== rpcUrl) onChangeRpc(draft);
          }}
          placeholder="RPC URL"
          spellCheck={false}
          className="w-full rounded bg-gray-900 px-3 py-2 pr-8 font-mono text-sm text-gray-200 outline-none ring-1 ring-gray-700 focus:ring-cyan-600"
        />
        <span
          className={`absolute right-2.5 top-1/2 size-2.5 -translate-y-1/2 rounded-full ${
            connected === null
              ? "animate-pulse bg-yellow-500"
              : connected
                ? "bg-green-500"
                : "bg-red-500"
          }`}
          title={
            connected === null
              ? "Connecting…"
              : connected
                ? "Connected"
                : "Disconnected"
          }
        />
      </div>
    </div>
  );
}
