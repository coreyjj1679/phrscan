import { useState, useCallback } from "react";
import { formatEther } from "viem";
import type { StateDiff, AccountState } from "../lib/trace";
import type { AddressBook } from "../hooks/useAddressBook";

type Props = {
  diff: StateDiff;
  book: AddressBook;
};

export function StateChanges({ diff, book }: Props) {
  const addresses = Array.from(
    new Set([...Object.keys(diff.pre), ...Object.keys(diff.post)]),
  ).sort();

  if (addresses.length === 0) return null;

  return (
    <div className="space-y-3 rounded-lg border border-gray-800 bg-gradient-to-b from-gray-900/80 to-gray-950/80 p-3 sm:p-4">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold text-gray-100">State Changes</h3>
        <span className="rounded-full bg-gray-800 px-2 py-0.5 text-[10px] font-medium text-gray-400">
          {addresses.length} account{addresses.length !== 1 ? "s" : ""}
        </span>
      </div>
      <div className="space-y-1.5">
        {addresses.map((addr) => (
          <AccountDiff
            key={addr}
            address={addr}
            pre={diff.pre[addr]}
            post={diff.post[addr]}
            book={book}
          />
        ))}
      </div>
    </div>
  );
}

function AccountDiff({
  address,
  pre,
  post,
  book,
}: {
  address: string;
  pre?: AccountState;
  post?: AccountState;
  book: AddressBook;
}) {
  const label = book.resolve(address);
  const short = address.slice(0, 6) + "\u2026" + address.slice(-4);
  const display = label ?? short;

  const balChanged = pre?.balance !== post?.balance;
  const nonceChanged = String(pre?.nonce ?? "0") !== String(post?.nonce ?? "0");
  const codeChanged =
    (pre?.code ?? "0x") !== (post?.code ?? "0x") &&
    (!!pre?.code || !!post?.code);

  const allSlots = new Set([
    ...Object.keys(pre?.storage ?? {}),
    ...Object.keys(post?.storage ?? {}),
  ]);
  const changedSlots = [...allSlots].filter(
    (s) =>
      (pre?.storage?.[s] ?? "0x0").toLowerCase() !==
      (post?.storage?.[s] ?? "0x0").toLowerCase(),
  );

  const hasChanges =
    balChanged || nonceChanged || codeChanged || changedSlots.length > 0;
  if (!hasChanges) return null;

  return (
    <details className="group rounded-md bg-gray-950/50 ring-1 ring-gray-800/50">
      <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2">
        <CopyableAddress address={address} display={display} hasLabel={!!label} />
        <div className="flex flex-wrap gap-1.5">
          {balChanged && <Badge color="yellow">balance</Badge>}
          {nonceChanged && <Badge color="blue">nonce</Badge>}
          {codeChanged && <Badge color="green">code</Badge>}
          {changedSlots.length > 0 && (
            <Badge color="purple">
              {changedSlots.length} slot{changedSlots.length !== 1 ? "s" : ""}
            </Badge>
          )}
        </div>
      </summary>

      <div className="space-y-2 border-t border-gray-800 px-3 py-2">
        {balChanged && (
          <DiffRow
            label="Balance"
            before={formatBalance(pre?.balance)}
            after={formatBalance(post?.balance)}
          />
        )}
        {nonceChanged && (
          <DiffRow
            label="Nonce"
            before={formatNonce(pre?.nonce)}
            after={formatNonce(post?.nonce)}
          />
        )}
        {codeChanged && (
          <DiffRow
            label="Code"
            before={pre?.code ? `${(pre.code.length - 2) / 2} bytes` : "none"}
            after={post?.code ? `${(post.code.length - 2) / 2} bytes` : "none"}
          />
        )}
        {changedSlots.length > 0 && (
          <div className="space-y-1">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
              Storage
            </p>
            {changedSlots.map((slot) => (
              <StorageSlotDiff
                key={slot}
                slot={slot}
                before={pre?.storage?.[slot]}
                after={post?.storage?.[slot]}
              />
            ))}
          </div>
        )}
      </div>
    </details>
  );
}

function CopyableAddress({
  address,
  display,
  hasLabel,
}: {
  address: string;
  display: string;
  hasLabel: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      navigator.clipboard.writeText(address).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      });
    },
    [address],
  );

  return (
    <span
      className={`cursor-pointer font-mono text-[11px] transition-colors ${
        copied
          ? "text-green-400"
          : hasLabel
            ? "rounded bg-cyan-900/30 px-1 py-0.5 text-cyan-300 hover:bg-cyan-900/50"
            : "text-gray-300 hover:text-white"
      }`}
      title={copied ? "Copied!" : address}
      onClick={handleCopy}
    >
      {copied ? "copied" : display}
    </span>
  );
}

function DiffRow({
  label,
  before,
  after,
}: {
  label: string;
  before: string;
  after: string;
}) {
  return (
    <div className="text-xs">
      <span className="text-gray-500">{label}: </span>
      <span className="font-mono text-red-400/70 line-through">{before}</span>
      <span className="mx-1 text-gray-600">&rarr;</span>
      <span className="font-mono text-green-400">{after}</span>
    </div>
  );
}

function StorageSlotDiff({
  slot,
  before,
  after,
}: {
  slot: string;
  before?: string;
  after?: string;
}) {
  const displaySlot =
    slot.length > 18
      ? slot.slice(0, 10) + "\u2026" + slot.slice(-6)
      : slot;

  return (
    <div className="rounded bg-gray-950/50 px-2 py-1.5 ring-1 ring-gray-800">
      <p
        className="truncate font-mono text-[10px] text-gray-500"
        title={slot}
      >
        slot {displaySlot}
      </p>
      <div className="mt-0.5 space-y-0.5">
        {before && before !== "0x0" && (
          <p className="break-all font-mono text-[10px] text-red-400/60 line-through">
            {before}
          </p>
        )}
        <p className="break-all font-mono text-[10px] text-green-400">
          {after ?? "0x0"}
        </p>
      </div>
    </div>
  );
}

function Badge({
  color,
  children,
}: {
  color: "yellow" | "blue" | "green" | "purple";
  children: React.ReactNode;
}) {
  const colors = {
    yellow: "bg-yellow-900/50 text-yellow-400",
    blue: "bg-blue-900/50 text-blue-400",
    green: "bg-green-900/50 text-green-400",
    purple: "bg-purple-900/50 text-purple-400",
  };
  return (
    <span
      className={`rounded px-1 py-0.5 text-[9px] font-bold uppercase ${colors[color]}`}
    >
      {children}
    </span>
  );
}

function formatBalance(val?: string): string {
  if (!val || val === "0x0") return "0 PHRS";
  try {
    return formatEther(BigInt(val)) + " PHRS";
  } catch {
    return val;
  }
}

function formatNonce(val?: string | number): string {
  if (val === undefined || val === null) return "0";
  if (typeof val === "number") return val.toString();
  try {
    return BigInt(val).toString();
  } catch {
    return val;
  }
}
