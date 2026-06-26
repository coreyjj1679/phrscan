import type { SimOverrides, AccountOverride } from "../lib/overrides";
import { CURRENCY } from "../config/chain";

type Props = {
  value: SimOverrides;
  onChange: (v: SimOverrides) => void;
};

export function OverridesEditor({ value, onChange }: Props) {
  const setTimestamp = (timestamp: string) => onChange({ ...value, timestamp });

  const updateAccount = (i: number, patch: Partial<AccountOverride>) =>
    onChange({
      ...value,
      accounts: value.accounts.map((a, j) => (j === i ? { ...a, ...patch } : a)),
    });

  const addAccount = () =>
    onChange({ ...value, accounts: [...value.accounts, { address: "", storage: [] }] });

  const removeAccount = (i: number) =>
    onChange({ ...value, accounts: value.accounts.filter((_, j) => j !== i) });

  const addSlot = (i: number) =>
    updateAccount(i, { storage: [...value.accounts[i].storage, { slot: "", value: "" }] });

  const updateSlot = (i: number, si: number, patch: Partial<{ slot: string; value: string }>) =>
    updateAccount(i, {
      storage: value.accounts[i].storage.map((s, j) => (j === si ? { ...s, ...patch } : s)),
    });

  const removeSlot = (i: number, si: number) =>
    updateAccount(i, { storage: value.accounts[i].storage.filter((_, j) => j !== si) });

  const input =
    "w-full rounded bg-gray-900 px-2 py-1.5 font-mono text-xs text-gray-200 outline-none ring-1 ring-gray-700 focus:ring-cyan-600";

  return (
    <div className="space-y-3 rounded bg-gray-950/40 p-3 ring-1 ring-gray-800">
      <div>
        <label className="mb-1 block text-xs text-gray-400">
          Block timestamp <span className="text-gray-600">(optional, unix seconds)</span>
        </label>
        <input
          type="text"
          value={value.timestamp ?? ""}
          onChange={(e) => setTimestamp(e.target.value)}
          placeholder="e.g. 1782303564"
          spellCheck={false}
          className={input}
        />
      </div>

      {value.accounts.map((a, i) => (
        <div key={i} className="space-y-2 rounded bg-gray-900/60 p-2 ring-1 ring-gray-800">
          <div className="flex gap-2">
            <input
              type="text"
              value={a.address}
              onChange={(e) => updateAccount(i, { address: e.target.value })}
              placeholder="Account address (0x…)"
              spellCheck={false}
              className={`${input} flex-1`}
            />
            <button
              onClick={() => removeAccount(i)}
              title="Remove account"
              aria-label="Remove account override"
              className="shrink-0 rounded px-1.5 py-1 text-gray-600 hover:bg-red-900/40 hover:text-red-400"
            >
              <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="flex items-center gap-1.5 sm:flex-1">
              <input
                type="text"
                value={a.balance ?? ""}
                onChange={(e) => updateAccount(i, { balance: e.target.value })}
                placeholder="Balance"
                spellCheck={false}
                className={input}
              />
              <span className="shrink-0 text-xs text-gray-500">{CURRENCY}</span>
            </div>
            <input
              type="text"
              value={a.code ?? ""}
              onChange={(e) => updateAccount(i, { code: e.target.value })}
              placeholder="Code 0x… (optional)"
              spellCheck={false}
              className={`${input} sm:flex-1`}
            />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500">Storage</span>
              <button
                onClick={() => addSlot(i)}
                className="text-xs text-gray-500 hover:text-gray-300"
              >
                + slot
              </button>
            </div>
            {a.storage.map((s, si) => (
              <div key={si} className="flex gap-2">
                <input
                  type="text"
                  value={s.slot}
                  onChange={(e) => updateSlot(i, si, { slot: e.target.value })}
                  placeholder="slot 0x…"
                  spellCheck={false}
                  className={`${input} flex-1`}
                />
                <input
                  type="text"
                  value={s.value}
                  onChange={(e) => updateSlot(i, si, { value: e.target.value })}
                  placeholder="value 0x…"
                  spellCheck={false}
                  className={`${input} flex-1`}
                />
                <button
                  onClick={() => removeSlot(i, si)}
                  title="Remove slot"
                  aria-label="Remove storage slot"
                  className="shrink-0 rounded px-1.5 py-1 text-gray-600 hover:bg-red-900/40 hover:text-red-400"
                >
                  <svg className="size-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}

      <button
        onClick={addAccount}
        className="rounded bg-gray-800 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700"
      >
        + Add account override
      </button>

      <p className="text-xs text-gray-600">
        Balance is in {CURRENCY}; storage slot &amp; value are 32-byte hex. Timestamp override
        requires an RPC that supports <code className="text-gray-500">eth_simulateV1</code>.
      </p>
    </div>
  );
}
