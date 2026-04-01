import type { CallResult, DecodedLog } from "../lib/simulate";

type Props = {
  result: CallResult | null;
  error: string | null;
};

export function ResultPanel({ result, error }: Props) {
  if (!result && !error) return null;

  return (
    <div className="space-y-2 rounded bg-gray-900/50 p-3 sm:p-4">
      <h3 className="text-xs font-semibold tracking-wide text-gray-500 uppercase">
        Result
      </h3>

      {error && (
        <div className="rounded bg-red-950/50 p-3 ring-1 ring-red-800">
          <p className="text-xs font-semibold text-red-400">Error</p>
          <pre className="mt-1 overflow-x-auto whitespace-pre-wrap font-mono text-xs text-red-300">
            {formatError(error)}
          </pre>
        </div>
      )}

      {result && !result.error && (
        <>
          {isVoid(result.decoded) ? (
            <div className="rounded bg-green-950/40 p-3 ring-1 ring-green-800">
              <p className="text-sm font-medium text-green-400">Success</p>
              {result.gasEstimate !== undefined && (
                <p className="mt-1 text-xs text-green-500/80">
                  Gas estimate:{" "}
                  <span className="font-mono text-green-400">
                    {result.gasEstimate.toLocaleString()}
                  </span>
                </p>
              )}
            </div>
          ) : (
            <div className="rounded bg-gray-900 p-3 ring-1 ring-gray-700">
              <p className="mb-1 text-xs text-gray-400">Decoded</p>
              <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-sm text-cyan-300">
                {formatValue(result.decoded)}
              </pre>
            </div>
          )}

          {result.logs && result.logs.length > 0 && (
            <EventLogs logs={result.logs} />
          )}

          {result.raw && result.raw !== "0x" && (
            <details className="group">
              <summary className="cursor-pointer text-xs text-gray-500 hover:text-gray-300">
                Raw output
              </summary>
              <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all font-mono text-xs text-gray-500">
                {result.raw}
              </pre>
            </details>
          )}

          {!isVoid(result.decoded) && result.gasEstimate !== undefined && (
            <p className="text-xs text-gray-500">
              Gas estimate:{" "}
              <span className="font-mono text-gray-300">
                {result.gasEstimate.toLocaleString()}
              </span>
            </p>
          )}
        </>
      )}
    </div>
  );
}

function EventLogs({ logs }: { logs: DecodedLog[] }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold text-gray-400">
        Events ({logs.length})
      </p>
      {logs.map((log, i) => (
        <details key={i} className="group rounded bg-gray-900 ring-1 ring-gray-700">
          <summary className="flex cursor-pointer items-center gap-2 px-3 py-2">
            <span className="rounded bg-violet-900/50 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-violet-400">
              {log.eventName}
            </span>
            <span className="truncate font-mono text-[11px] text-gray-600">
              {log.address}
            </span>
          </summary>
          <div className="border-t border-gray-800 px-3 py-2">
            {Object.keys(log.args).length > 0 ? (
              <div className="space-y-1">
                {Object.entries(log.args).map(([key, val]) => (
                  <div key={key} className="flex gap-2 text-xs">
                    <span className="shrink-0 text-gray-500">{key}:</span>
                    <span className="break-all font-mono text-cyan-300">
                      {formatValue(val)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-1">
                {log.raw.topics.length > 0 && (
                  <div className="text-xs">
                    <span className="text-gray-500">topics: </span>
                    {log.raw.topics.map((t, ti) => (
                      <span key={ti} className="block break-all pl-4 font-mono text-[11px] text-gray-500">
                        [{ti}] {t}
                      </span>
                    ))}
                  </div>
                )}
                {log.raw.data && log.raw.data !== "0x" && (
                  <div className="text-xs">
                    <span className="text-gray-500">data: </span>
                    <span className="break-all font-mono text-[11px] text-gray-500">
                      {log.raw.data}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        </details>
      ))}
    </div>
  );
}

function isVoid(val: unknown): boolean {
  return val === undefined || val === null;
}

function formatValue(val: unknown): string {
  if (isVoid(val)) return "void";
  if (typeof val === "bigint") return val.toString();
  if (typeof val === "string") return val;
  if (typeof val === "boolean") return String(val);
  try {
    return JSON.stringify(
      val,
      (_key, v) => (typeof v === "bigint" ? v.toString() : v),
      2,
    );
  } catch {
    return String(val);
  }
}

function formatError(msg: string): string {
  const revertMatch = msg.match(/reason:\s*(.+?)(?:\n|$)/);
  if (revertMatch) return revertMatch[1];

  const shortMatch = msg.match(/reverted with the following reason:\s*(.+?)(?:\n|$)/);
  if (shortMatch) return shortMatch[1];

  if (msg.length > 500) return msg.slice(0, 500) + "…";
  return msg;
}
