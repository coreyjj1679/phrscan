import { SimpleStateManager } from "@ethereumjs/statemanager";
import {
  createAccount,
  hexToBytes,
  bytesToHex,
  setLengthLeft,
  type Address,
} from "@ethereumjs/util";

/**
 * State manager that lazily loads accounts, code, and storage from a JSON-RPC
 * endpoint at a fixed block tag. Pharos's prestateTracer returns zeroed storage,
 * so we read everything live via standard eth_* methods (which are accurate).
 *
 * Writes stay in memory, so running several calls against one instance lets
 * each call observe the previous ones — that is what makes bundle simulation
 * of consecutive Safe nonces possible without any bundle RPC.
 */
export class ForkStateManager extends SimpleStateManager {
  private rpcUrl: string;
  private blockTag: string;
  private seenAcct = new Set<string>();
  private seenCode = new Set<string>();
  private seenSlot = new Set<string>();
  private onRpc?: () => void;
  rpcCalls = 0;

  constructor(rpcUrl: string, blockTag: string, onRpc?: () => void) {
    super();
    this.rpcUrl = rpcUrl;
    this.blockTag = blockTag;
    this.onRpc = onRpc;
  }

  async rpc(method: string, params: unknown[]): Promise<string> {
    this.rpcCalls++;
    this.onRpc?.();
    const res = await fetch(this.rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    const j = await res.json();
    if (j.error) throw new Error(`${method}: ${j.error.message}`);
    return j.result as string;
  }

  override async getAccount(address: Address) {
    let acct = await super.getAccount(address);
    const a = address.toString();
    if (acct === undefined && !this.seenAcct.has(a)) {
      this.seenAcct.add(a);
      const [bal, nonce, code] = await Promise.all([
        this.rpc("eth_getBalance", [a, this.blockTag]),
        this.rpc("eth_getTransactionCount", [a, this.blockTag]),
        this.rpc("eth_getCode", [a, this.blockTag]),
      ]);
      acct = createAccount({ nonce: BigInt(nonce), balance: BigInt(bal) });
      await super.putAccount(address, acct);
      if (code && code !== "0x") {
        this.seenCode.add(a);
        await super.putCode(address, hexToBytes(code as `0x${string}`));
      }
      acct = await super.getAccount(address);
    }
    return acct;
  }

  override async getCode(address: Address) {
    let code = await super.getCode(address);
    const a = address.toString();
    if ((!code || code.length === 0) && !this.seenCode.has(a)) {
      this.seenCode.add(a);
      const c = await this.rpc("eth_getCode", [a, this.blockTag]);
      if (c && c !== "0x") {
        code = hexToBytes(c as `0x${string}`);
        await super.putCode(address, code);
      }
    }
    return code;
  }

  override async getStorage(address: Address, key: Uint8Array) {
    let val = await super.getStorage(address, key);
    const a = address.toString();
    const slotHex = bytesToHex(setLengthLeft(key, 32));
    const id = a + ":" + slotHex;
    if ((!val || val.length === 0) && !this.seenSlot.has(id)) {
      this.seenSlot.add(id);
      const raw = await this.rpc("eth_getStorageAt", [a, slotHex, this.blockTag]);
      const trimmed = raw.slice(2).replace(/^0+/, "");
      if (trimmed.length > 0) {
        const even = trimmed.length % 2 ? "0" + trimmed : trimmed;
        val = hexToBytes(("0x" + even) as `0x${string}`);
        await super.putStorage(address, key, val);
      }
    }
    return val;
  }
}
