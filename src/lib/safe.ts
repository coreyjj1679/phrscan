import {
  bytesToBigInt,
  bytesToHex,
  getAddress,
  hexToBytes,
  parseAbi,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import {
  ACTIVE_NETWORK,
  EXPLORER_API,
  EXPLORER_DIRECT_API,
  SAFE_APP_CHAIN,
  SAFE_CLIENT_URL,
  SAFE_MULTISEND_ADDRESSES,
  SAFE_SYSTEM_CONTRACTS,
} from "../config/chain";
import { decodeCalldata, type DecodedCalldata } from "./decodeCalldata";
import { humanizeError } from "./errors";

export const SAFE_TX_ABI = parseAbi([
  "function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address payable refundReceiver, bytes signatures) payable returns (bool success)",
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
  "function nonce() view returns (uint256)",
  "function VERSION() view returns (string)",
]);

const MULTISEND_ABI = parseAbi(["function multiSend(bytes transactions) payable"]);

const EXEC_SELECTOR = "0x6a761202";

export type SafeInfo = {
  address: Address;
  owners: Address[];
  threshold: number;
  nonce: number;
  version: string | null;
};

export type DecodedSafeCall = {
  to: string;
  value: bigint;
  data: Hex;
  operation: 0 | 1;
  decoded: DecodedCalldata | null;
  systemLabel?: string;
  inner?: DecodedSafeCall[];
};

export type SafeTxConfirmation = {
  signer: string;
  signature?: string;
};

export type SafeMultisigTx = {
  id: string;
  safeTxHash?: string;
  txHash?: string | null;
  status: string;
  nonce: number | null;
  timestamp: number | null;
  confirmationsRequired: number | null;
  confirmations: SafeTxConfirmation[];
  signers: string[];
  call: DecodedSafeCall;
};

export function isSafeClientSupported(): boolean {
  return SAFE_APP_CHAIN !== null;
}

export function safeAppTxUrl(safeAddress: string, txId: string): string | null {
  if (!SAFE_APP_CHAIN) return null;
  return `https://app.safe.global/transactions/tx?safe=${SAFE_APP_CHAIN}:${safeAddress}&id=${encodeURIComponent(txId)}`;
}

export function systemLabel(address: string): string | undefined {
  return SAFE_SYSTEM_CONTRACTS[address.toLowerCase()];
}

export async function fetchSafeInfo(
  client: PublicClient,
  raw: string,
): Promise<SafeInfo> {
  let address: Address;
  try {
    address = getAddress(raw);
  } catch {
    throw new Error("Enter a valid Safe address (0x + 40 hex).");
  }

  try {
    const [owners, threshold, nonce, version] = await Promise.all([
      client.readContract({
        address,
        abi: SAFE_TX_ABI,
        functionName: "getOwners",
      }),
      client.readContract({
        address,
        abi: SAFE_TX_ABI,
        functionName: "getThreshold",
      }),
      client.readContract({
        address,
        abi: SAFE_TX_ABI,
        functionName: "nonce",
      }),
      client
        .readContract({ address, abi: SAFE_TX_ABI, functionName: "VERSION" })
        .catch(() => null),
    ]);
    return {
      address,
      owners: [...owners],
      threshold: Number(threshold),
      nonce: Number(nonce),
      version,
    };
  } catch (e) {
    throw new Error(
      `Not a Safe at this address (${humanizeError(e instanceof Error ? e.message : String(e))})`,
    );
  }
}

type CgwListItem = {
  type: string;
  transaction?: {
    id: string;
    timestamp: number;
    txStatus: string;
    executionInfo?: {
      type?: string;
      nonce?: number;
      confirmationsRequired?: number;
      confirmationsSubmitted?: number;
    };
  };
};

type CgwListResponse = {
  results?: CgwListItem[];
};

type CgwTxDetail = {
  txId?: string;
  txStatus?: string;
  txHash?: string | null;
  executedAt?: number | null;
  txData?: {
    hexData?: string | null;
    to?: { value?: string };
    value?: string;
    operation?: number;
  };
  detailedExecutionInfo?: {
    type?: string;
    nonce?: number | string;
    safeTxHash?: string;
    confirmationsRequired?: number;
    confirmations?: { signer?: { value?: string }; signature?: string }[];
    signers?: { value?: string }[];
    submittedAt?: number;
  };
};

async function cgwJson<T>(path: string): Promise<T> {
  const res = await fetch(`${SAFE_CLIENT_URL}${path}`);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Safe API ${res.status}${text ? `: ${text.slice(0, 180)}` : ""}`,
    );
  }
  return res.json() as Promise<T>;
}

async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }
  const n = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: n }, worker));
  return out;
}

function listMultisigIds(
  list: CgwListResponse,
): NonNullable<CgwListItem["transaction"]>[] {
  const txs: NonNullable<CgwListItem["transaction"]>[] = [];
  for (const item of list.results ?? []) {
    const tx = item.transaction;
    if (!tx?.id?.startsWith("multisig_")) continue;
    txs.push(tx);
  }
  return txs;
}

async function detailToMultisig(
  listTx: NonNullable<CgwListItem["transaction"]>,
  detail: CgwTxDetail | null,
): Promise<SafeMultisigTx> {
  const to = detail?.txData?.to?.value ?? "0x0000000000000000000000000000000000000000";
  const value = BigInt(detail?.txData?.value ?? "0");
  const data = (detail?.txData?.hexData || "0x") as Hex;
  const operation = (detail?.txData?.operation === 1 ? 1 : 0) as 0 | 1;
  const exec = detail?.detailedExecutionInfo;
  const nonceRaw = exec?.nonce ?? listTx.executionInfo?.nonce;
  const confirmations = (exec?.confirmations ?? [])
    .map((c) => ({ signer: c.signer?.value ?? "", signature: c.signature }))
    .filter((c) => c.signer);
  const signers = (exec?.signers ?? [])
    .map((s) => s.value ?? "")
    .filter(Boolean);

  return {
    id: detail?.txId ?? listTx.id,
    safeTxHash: exec?.safeTxHash,
    txHash: detail?.txHash ?? null,
    status: detail?.txStatus ?? listTx.txStatus,
    nonce: nonceRaw !== undefined && nonceRaw !== null ? Number(nonceRaw) : null,
    timestamp: detail?.executedAt ?? exec?.submittedAt ?? listTx.timestamp ?? null,
    confirmationsRequired:
      exec?.confirmationsRequired ?? listTx.executionInfo?.confirmationsRequired ?? null,
    confirmations,
    signers,
    call: await decodeSafeCall(to, value, data, operation),
  };
}

/** Queued + history from Client Gateway (first page each). */
export async function fetchSafeClientTxs(
  safeAddress: Address,
): Promise<{ queued: SafeMultisigTx[]; history: SafeMultisigTx[] }> {
  const chainId = ACTIVE_NETWORK.chainId;
  const addr = getAddress(safeAddress);
  const [queuedList, historyList] = await Promise.all([
    cgwJson<CgwListResponse>(
      `/v1/chains/${chainId}/safes/${addr}/transactions/queued`,
    ),
    cgwJson<CgwListResponse>(
      `/v1/chains/${chainId}/safes/${addr}/transactions/history`,
    ),
  ]);

  const queuedItems = listMultisigIds(queuedList);
  const historyItems = listMultisigIds(historyList);

  const load = async (items: NonNullable<CgwListItem["transaction"]>[]) =>
    mapPool(items, 4, async (item) => {
      try {
        const detail = await cgwJson<CgwTxDetail>(
          `/v1/chains/${chainId}/transactions/${encodeURIComponent(item.id)}`,
        );
        return detailToMultisig(item, detail);
      } catch {
        return detailToMultisig(item, null);
      }
    });

  const [queued, history] = await Promise.all([
    load(queuedItems),
    load(historyItems),
  ]);
  return { queued: sortTxsAsc(queued), history: sortTxsAsc(history) };
}

export function txTimestampMs(ts: number | null): number | null {
  if (ts === null || !Number.isFinite(ts) || ts <= 0) return null;
  return ts < 1e12 ? ts * 1000 : ts;
}

/** Nonce ascending, then oldest first — matches Safe queue order. */
export function sortTxsAsc(txs: SafeMultisigTx[]): SafeMultisigTx[] {
  return [...txs].sort((a, b) => {
    const na = a.nonce ?? Number.MAX_SAFE_INTEGER;
    const nb = b.nonce ?? Number.MAX_SAFE_INTEGER;
    if (na !== nb) return na - nb;
    const ta = txTimestampMs(a.timestamp) ?? 0;
    const tb = txTimestampMs(b.timestamp) ?? 0;
    return ta - tb;
  });
}

function unpackMultiSend(transactions: Hex): {
  to: string;
  value: bigint;
  data: Hex;
  operation: 0 | 1;
}[] {
  const buf = hexToBytes(transactions);
  const out: { to: string; value: bigint; data: Hex; operation: 0 | 1 }[] = [];
  let i = 0;
  while (i + 85 <= buf.length) {
    const operation = (buf[i] === 1 ? 1 : 0) as 0 | 1;
    i += 1;
    const to = getAddress(bytesToHex(buf.slice(i, i + 20)));
    i += 20;
    const value = bytesToBigInt(buf.slice(i, i + 32));
    i += 32;
    const dataLength = Number(bytesToBigInt(buf.slice(i, i + 32)));
    i += 32;
    if (i + dataLength > buf.length) break;
    const data = bytesToHex(buf.slice(i, i + dataLength));
    i += dataLength;
    out.push({ to, value, data, operation });
  }
  return out;
}

export async function decodeSafeCall(
  to: string,
  value: bigint,
  data: Hex,
  operation: 0 | 1,
  depth = 0,
): Promise<DecodedSafeCall> {
  const empty = !data || data === "0x";
  const decoded = empty
    ? null
    : await decodeCalldata(data, { to, extraAbis: [SAFE_TX_ABI, MULTISEND_ABI] });

  const call: DecodedSafeCall = {
    to,
    value,
    data,
    operation,
    decoded,
    systemLabel: systemLabel(to),
  };

  const isMultiSend =
    decoded?.name === "multiSend" ||
    SAFE_MULTISEND_ADDRESSES.has(to.toLowerCase());
  if (depth < 5 && isMultiSend && decoded?.name === "multiSend") {
    const packed = decoded.args[0]?.value;
    if (typeof packed === "string" && packed.startsWith("0x")) {
      try {
        const inner = unpackMultiSend(packed as Hex);
        call.inner = await Promise.all(
          inner.map((c) =>
            decodeSafeCall(c.to, c.value, c.data, c.operation, depth + 1),
          ),
        );
      } catch {
        /* leave packed */
      }
    }
  }
  return call;
}

type ExplorerTx = {
  hash: string;
  from: string;
  to: string;
  input: string;
  value: string;
  timeStamp?: string;
  timestamp?: string;
  nonce?: string;
  isError?: string;
  txreceipt_status?: string;
};

async function fetchExplorerTxList(address: string): Promise<ExplorerTx[]> {
  const urls = [
    `${EXPLORER_API}?module=account&action=txlist&address=${address}&sort=desc&page=1&offset=40`,
    `${EXPLORER_API}/account?module=account&action=txlist&address=${address}&sort=desc&page=1&offset=40`,
    `${EXPLORER_DIRECT_API}/api?module=account&action=txlist&address=${address}&sort=desc&page=1&offset=40`,
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const text = await res.text();
      if (text.includes("<!DOCTYPE") || text.includes("<html")) continue;
      const json = JSON.parse(text);
      const rows = json?.result;
      if (Array.isArray(rows)) return rows as ExplorerTx[];
    } catch {
      // try next
    }
  }
  return [];
}

async function execTxFromInput(
  id: string,
  input: Hex,
  from: string,
  timestamp: number | null,
  txHash: string,
  nonce: number | null,
  status: string,
): Promise<SafeMultisigTx | null> {
  if (!input.toLowerCase().startsWith(EXEC_SELECTOR)) return null;
  const decoded = await decodeCalldata(input, { extraAbis: [SAFE_TX_ABI] });
  if (decoded.name !== "execTransaction" || decoded.args.length < 4) return null;
  const to = String(decoded.args[0]?.value ?? "");
  const value = (decoded.args[1]?.value as bigint) ?? 0n;
  const data = (decoded.args[2]?.value as Hex) ?? "0x";
  const operation = (Number(decoded.args[3]?.value) === 1 ? 1 : 0) as 0 | 1;
  return {
    id,
    txHash,
    status,
    nonce,
    timestamp,
    confirmationsRequired: null,
    confirmations: from ? [{ signer: from }] : [],
    signers: [],
    call: await decodeSafeCall(to, value, data, operation),
  };
}

/** On-chain execTransaction history via explorer (used when CGW is unavailable). */
export async function fetchOnchainSafeTxs(
  safeAddress: Address,
): Promise<SafeMultisigTx[]> {
  const rows = await fetchExplorerTxList(safeAddress);
  const lc = safeAddress.toLowerCase();
  const execs = rows.filter(
    (r) =>
      r.to?.toLowerCase() === lc &&
      (r.input ?? "").toLowerCase().startsWith(EXEC_SELECTOR),
  );
  const decoded = await mapPool(execs, 4, async (r) => {
    const ts = Number(r.timeStamp ?? r.timestamp ?? 0);
    const status =
      r.isError === "1" || r.txreceipt_status === "0" ? "FAILED" : "SUCCESS";
    return execTxFromInput(
      r.hash,
      r.input as Hex,
      r.from,
      ts ? ts * (ts < 1e12 ? 1000 : 1) : null,
      r.hash,
      r.nonce !== undefined ? Number(r.nonce) : null,
      status,
    );
  });
  return sortTxsAsc(decoded.filter((t): t is SafeMultisigTx => t !== null));
}

/** Decode a single on-chain tx hash as a Safe execTransaction. */
export async function fetchOnchainSafeTxByHash(
  client: PublicClient,
  safeAddress: Address,
  hash: Hex,
): Promise<SafeMultisigTx> {
  const tx = await client.getTransaction({ hash });
  if (!tx.to || tx.to.toLowerCase() !== safeAddress.toLowerCase()) {
    throw new Error("This transaction was not sent to the Safe.");
  }
  const receipt = await client.getTransactionReceipt({ hash }).catch(() => null);
  const status =
    receipt?.status === "reverted"
      ? "FAILED"
      : receipt?.status === "success"
        ? "SUCCESS"
        : "SUCCESS";
  const parsed = await execTxFromInput(
    hash,
    tx.input,
    tx.from,
    null,
    hash,
    tx.nonce,
    status,
  );
  if (!parsed) throw new Error("Not an execTransaction call.");
  return parsed;
}
