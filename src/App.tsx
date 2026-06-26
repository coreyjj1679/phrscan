import { useState, useEffect, useMemo, useRef } from "react";
import { Analytics } from "@vercel/analytics/react";
import { useClient } from "./hooks/useClient";
import { useAbi } from "./hooks/useAbi";
import { useAddressBook } from "./hooks/useAddressBook";
import { RpcConfig } from "./components/RpcConfig";
import { ContractInput } from "./components/ContractInput";
import { AbiViewer } from "./components/AbiViewer";
import { ReadAll } from "./components/ReadAll";
import { FunctionForm } from "./components/FunctionForm";
import { CalldataForm, type CalldataInitial } from "./components/CalldataForm";
import { ResultPanel } from "./components/ResultPanel";
import { TxReplay, TxReceiptPanel, TxSummaryBar, type TxData, type TxReceipt } from "./components/TxReplay";
import { ReplayHistory } from "./components/ReplayHistory";
import { ContractCode } from "./components/ContractCode";
import { StorageInspector } from "./components/StorageInspector";
import { CallTrace } from "./components/CallTrace";
import { GasProfiler } from "./components/GasProfiler";
import { OpcodeDebugger } from "./components/OpcodeDebugger";
import { MoneyFlow } from "./components/MoneyFlow";
import { StateChanges } from "./components/StateChanges";
import { AddressBookManager } from "./components/AddressBookManager";
import { AddressMenuProvider } from "./components/AddressMenu";
import { CalldataDecoder } from "./components/CalldataDecoder";
import { ErrorDecoder } from "./components/ErrorDecoder";
import { SignatureTool } from "./components/SignatureTool";
import { BundleSimulator } from "./components/BundleSimulator";
import { fnKey, type AbiFunction } from "./lib/abi";
import { countCalls } from "./lib/trace";
import type { CallResult } from "./lib/simulate";
import { type SavedContract, type ThemeMode, getSettings, saveSettings, getSavedContracts, addReplayHistory, getReplayHistory } from "./lib/storage";
import { setThemeMode, resolveTheme } from "./lib/theme";
import { Explore, type ExploreTarget } from "./components/Explore";
import { classifyQuery } from "./lib/search";
import { decodeSim } from "./lib/shareSim";
import { ACTIVE_NETWORK, NETWORKS, setActiveNetworkId, type NetworkId, EXPLORER_URL } from "./config/chain";

type Page = "explore" | "contract" | "replay" | "bundle" | "decode" | "addresses" | "settings";
type ContractTab = "functions" | "calldata" | "code" | "storage";
type ReplayTab = "receipt" | "trace" | "flow" | "state" | "resim";

export default function App() {
  const { client, rpcUrl, setRpcUrl, connected } = useClient();
  const { abi, verified, partial, proxy, loading, error, load, pasteAbi, clear } = useAbi();
  const addressBook = useAddressBook();

  const initialParams = useMemo(() => new URLSearchParams(window.location.search), []);
  const initialTab = initialParams.get("tab");
  const initialSim = useMemo(() => {
    const s = initialParams.get("sim");
    return s ? decodeSim(s) : null;
  }, [initialParams]);

  const [page, setPage] = useState<Page>(
    initialTab === "explore" ||
    initialTab === "replay" ||
    initialTab === "bundle" ||
    initialTab === "decode" ||
    initialTab === "addresses" ||
    initialTab === "settings"
      ? initialTab
      : "contract",
  );
  const [contractAddress, setContractAddress] = useState(() => initialParams.get("address") ?? initialSim?.to ?? "");
  const [selectedFn, setSelectedFn] = useState<AbiFunction | null>(null);
  const [result, setResult] = useState<CallResult | null>(null);
  const [callError, setCallError] = useState<string | null>(null);
  const [contractTab, setContractTab] = useState<ContractTab>(initialSim ? "calldata" : "functions");
  const [calldataInitial, setCalldataInitial] = useState<CalldataInitial | undefined>();
  const [calldataKey, setCalldataKey] = useState(0);
  const sharedCalldataInit = useMemo<CalldataInitial | undefined>(
    () =>
      initialSim?.to && initialSim.data
        ? {
            to: initialSim.to,
            from: initialSim.from,
            data: initialSim.data,
            value: initialSim.value,
            blockNumber: initialSim.block,
            unit: initialSim.unit,
            overrides: initialSim.overrides,
            autoRun: true,
          }
        : undefined,
    [initialSim],
  );
  const [txReceipt, setTxReceipt] = useState<TxReceipt | null>(null);
  const [txHash, setTxHash] = useState(() => initialParams.get("tx") ?? "");
  const [replayLoading, setReplayLoading] = useState(false);
  const [replayResult, setReplayResult] = useState<CallResult | null>(null);
  const [replayError, setReplayError] = useState<string | null>(null);
  const [replayTab, setReplayTab] = useState<ReplayTab>("receipt");
  const [decodeTab, setDecodeTab] = useState<"calldata" | "errors" | "signature">("calldata");
  const [pendingTx, setPendingTx] = useState("");
  const [replayKey, setReplayKey] = useState(0);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);
  const historyCount = useMemo(() => getReplayHistory().length, [historyVersion]);
  const [exploreTarget, setExploreTarget] = useState<ExploreTarget>({ type: "feed" });
  const [exploreKey, setExploreKey] = useState(0);
  const [addressBookSuggest, setAddressBookSuggest] = useState(() => getSettings().addressBookSuggest);
  const [themeMode, setThemeModeState] = useState<ThemeMode>(() => getSettings().theme);
  const bootstrapped = useRef(false);

  const changeTheme = (mode: ThemeMode) => {
    setThemeMode(mode);
    setThemeModeState(mode);
  };

  useEffect(() => {
    if (abi && contractAddress) {
      addressBook.saveAbi(contractAddress, abi);
    }
  }, [abi, contractAddress]);

  // Load the ABI for an address passed via the URL (deep link), once on mount.
  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    const addr = initialParams.get("address") ?? initialSim?.to ?? null;
    if (!addr) return;
    // Prefer a previously saved contract ABI (e.g. a proxy address mapped to its
    // implementation ABI) over a network re-fetch that would only recover a
    // partial ABI from bytecode.
    const saved = getSavedContracts().find(
      (c) => c.address.toLowerCase() === addr.toLowerCase(),
    );
    if (saved) handleLoadSaved(saved);
    else load(addr, client);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the URL in sync so sessions are shareable.
  useEffect(() => {
    const params = new URLSearchParams();
    params.set("tab", page);
    params.set("net", ACTIVE_NETWORK.id);
    if (contractAddress) params.set("address", contractAddress);
    if (txHash) params.set("tx", txHash);
    // Preserve a shared-simulation payload so the link stays reload-safe
    // instead of being wiped the moment the page loads.
    const sim = initialParams.get("sim");
    if (sim) params.set("sim", sim);
    const qs = params.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  }, [page, contractAddress, txHash, initialParams]);

  const handleLoadAddress = (address: string) => {
    setContractAddress(address);
    setSelectedFn(null);
    setResult(null);
    setCallError(null);
    load(address, client);
  };

  const handleLoadSaved = (saved: SavedContract) => {
    setContractAddress(saved.address);
    setSelectedFn(null);
    setResult(null);
    setCallError(null);
    pasteAbi(JSON.stringify(saved.abi));
  };

  const handleClear = () => {
    clear();
    setContractAddress("");
    setSelectedFn(null);
    setResult(null);
    setCallError(null);
  };

  const handleResult = (r: CallResult | null, err: string | null) => {
    setResult(r);
    setCallError(err);
  };

  const handleReplayResult = (r: CallResult | null, err: string | null) => {
    setReplayResult(r);
    setReplayError(err);
  };

  const handleTxLoaded = (tx: TxData, receipt: TxReceipt) => {
    setTxReceipt(receipt);
    setTxHash(tx.hash);
    setCalldataInitial({
      to: tx.to,
      from: tx.from,
      data: tx.data,
      value: tx.value === "0" ? "" : tx.value,
      blockNumber: tx.blockNumber,
    });
    setCalldataKey((k) => k + 1);
    setReplayResult(null);
    setReplayError(null);
    setReplayTab("receipt");
    addReplayHistory({
      hash: tx.hash,
      blockNumber: receipt.blockNumber.toString(),
      from: tx.from,
      to: tx.to,
      status: receipt.status,
    });
    setHistoryVersion((v) => v + 1);
  };

  const openReplay = (hash: string) => {
    setPendingTx(hash);
    setReplayKey((k) => k + 1);
    setTxHash(hash);
    setPage("replay");
  };

  const handleSearch = (q: string) => {
    const kind = classifyQuery(q);
    if (kind === "tx") {
      openReplay(q.trim());
    } else if (kind === "address") {
      setExploreTarget({ type: "address", value: q.trim() });
      setExploreKey((k) => k + 1);
      setPage("explore");
    } else if (kind === "block") {
      setExploreTarget({ type: "block", value: q.trim() });
      setExploreKey((k) => k + 1);
      setPage("explore");
    }
  };

  const handleOpenContract = (address: string) => {
    handleLoadAddress(address);
    setPage("contract");
  };

  return (
    <AddressMenuProvider book={addressBook}>
    <div className="min-h-screen pb-16">
      <Analytics />
      <header className="sticky top-0 z-30 border-b border-border bg-ink/85 backdrop-blur supports-backdrop-filter:bg-ink/70">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-3 sm:px-4">
          <BeaconMark />
          <h1 className="truncate text-sm font-bold tracking-tight text-gray-100 sm:text-base">
            Pharos Mini Explorer
          </h1>
          <NetworkSwitcher />
          <div className="hidden min-w-0 flex-1 md:block">
            <GlobalSearch onSearch={handleSearch} />
          </div>
          <div className="ml-auto flex items-center gap-1">
            <ConnDot connected={connected} />
            <ThemeToggle mode={themeMode} onChange={changeTheme} />
            <a
              href="https://github.com/coreyjj1679/phrscan"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="View source on GitHub"
              className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-gray-500 transition hover:bg-elevated hover:text-gray-300"
            >
              <svg className="size-4 fill-current">
                <use href="/icons.svg#github-icon" />
              </svg>
              <span className="hidden sm:inline">Source</span>
            </a>
          </div>
        </div>
        <div className="border-t border-border/60">
          <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-2 sm:px-4">
            <NavButton active={page === "explore"} onClick={() => setPage("explore")}>
              Explore
            </NavButton>
            <NavButton active={page === "contract"} onClick={() => setPage("contract")}>
              Contract
            </NavButton>
            <NavButton active={page === "replay"} onClick={() => setPage("replay")}>
              Replay Tx
            </NavButton>
            <NavButton active={page === "bundle"} onClick={() => setPage("bundle")}>
              Bundle
            </NavButton>
            <NavButton active={page === "decode"} onClick={() => setPage("decode")}>
              Decode
            </NavButton>
            <NavButton active={page === "addresses"} onClick={() => setPage("addresses")}>
              Addresses
            </NavButton>
            <NavButton active={page === "settings"} onClick={() => setPage("settings")}>
              Settings
            </NavButton>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-3 py-5 sm:px-4 sm:py-6">
        <div className="mb-5 flex items-start gap-2 rounded-md border border-border bg-surface px-3 py-2 text-xs leading-relaxed text-gray-500">
          <svg viewBox="0 0 24 24" className="mt-px size-3.5 shrink-0 text-warning" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
          </svg>
          <span>
            Non-official &middot; Use at your own risk &middot; Never enter a private key &mdash; all contract calls only simulate.
          </span>
        </div>

      {page === "explore" && (
        <Explore
          key={exploreKey}
          client={client}
          book={addressBook}
          initialTarget={exploreTarget}
          onOpenTx={openReplay}
          onOpenContract={handleOpenContract}
        />
      )}

      {page === "bundle" && (
        <BundleSimulator client={client} book={addressBook} addressBookSuggest={addressBookSuggest} />
      )}

      {page === "decode" && (
        <div className="space-y-4">
          <div className="flex items-center gap-4 border-b border-border pb-2">
            <SubTab active={decodeTab === "calldata"} onClick={() => setDecodeTab("calldata")}>
              Calldata
            </SubTab>
            <SubTab active={decodeTab === "errors"} onClick={() => setDecodeTab("errors")}>
              Revert / Error
            </SubTab>
            <SubTab active={decodeTab === "signature"} onClick={() => setDecodeTab("signature")}>
              Signature
            </SubTab>
          </div>
          {decodeTab === "calldata" && <CalldataDecoder />}
          {decodeTab === "errors" && <ErrorDecoder />}
          {decodeTab === "signature" && <SignatureTool />}
        </div>
      )}

      {page === "settings" && (
        <div className="max-w-2xl space-y-6">
          <div className="space-y-2">
            <SectionLabel>Appearance</SectionLabel>
            <ThemeSegment mode={themeMode} onChange={changeTheme} />
            <p className="text-xs text-gray-600">
              Choose a color theme. “System” follows your operating system setting.
            </p>
          </div>

          <div className="space-y-4">
            <SectionLabel>RPC Endpoint</SectionLabel>
            <RpcConfig
              rpcUrl={rpcUrl}
              connected={connected}
              onChangeRpc={setRpcUrl}
            />
            <p className="text-xs text-gray-600">
              Change the RPC URL to use a custom endpoint. The connection
              indicator shows whether the node is reachable.
            </p>
          </div>

          <div className="space-y-2">
            <SectionLabel>Address Book</SectionLabel>
            <label className="flex cursor-pointer items-center gap-2.5 rounded bg-gray-900/50 px-4 py-3 ring-1 ring-gray-800 select-none">
              <input
                type="checkbox"
                checked={addressBookSuggest}
                onChange={(e) => {
                  setAddressBookSuggest(e.target.checked);
                  saveSettings({ addressBookSuggest: e.target.checked });
                }}
                className="size-4 rounded border-gray-600 bg-gray-900 accent-cyan-600"
              />
              <div>
                <p className="text-sm text-gray-200">Suggest addresses from address book</p>
                <p className="text-xs text-gray-600">
                  Show a dropdown with saved addresses on address inputs in function calls and calldata forms.
                </p>
              </div>
            </label>
          </div>

          <div className="space-y-2">
            <SectionLabel>Token labels</SectionLabel>
            <div className="rounded bg-gray-900/50 ring-1 ring-gray-800">
              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p className="text-sm text-gray-200">
                    Auto-detected token labels ({addressBook.autoLabels.size})
                  </p>
                  <p className="text-xs text-gray-600">
                    Token symbols discovered while viewing money-flow are reused as labels
                    across the app.
                  </p>
                </div>
                <button
                  onClick={() => addressBook.clearAuto()}
                  disabled={addressBook.autoLabels.size === 0}
                  className="shrink-0 rounded bg-gray-700 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-600 disabled:opacity-40"
                >
                  Clear
                </button>
              </div>
              {addressBook.autoLabels.size > 0 && (
                <div className="flex flex-wrap gap-1.5 border-t border-gray-800 px-4 py-3">
                  {[...addressBook.autoLabels.entries()]
                    .sort((a, b) => a[1].localeCompare(b[1]))
                    .map(([addr, label]) => (
                      <a
                        key={addr}
                        href={`${EXPLORER_URL}/address/${addr}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={addr}
                        className="inline-flex items-center gap-1.5 rounded bg-gray-800/70 py-1 pr-2 pl-1.5 ring-1 ring-gray-700/60 transition-colors hover:ring-cyan-700"
                      >
                        <span className="rounded bg-cyan-900/30 px-1.5 py-0.5 font-mono text-xs text-cyan-300">
                          {label}
                        </span>
                        <span className="font-mono text-xs text-gray-500">
                          {addr.slice(0, 6)}&#8230;{addr.slice(-4)}
                        </span>
                      </a>
                    ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {page === "replay" && (
        <div className="space-y-5">
          <div className="max-w-4xl">
            <SectionLabel>Transaction Hash</SectionLabel>
            <TxReplay
              key={replayKey}
              client={client}
              onTxLoaded={handleTxLoaded}
              initialHash={pendingTx || initialParams.get("tx") || undefined}
              onLoadingChange={setReplayLoading}
              trailing={
                <HistoryToggle
                  open={historyOpen}
                  count={historyCount}
                  onClick={() => setHistoryOpen((v) => !v)}
                />
              }
            />
          </div>

          {historyOpen && (
            <ReplayHistory
              book={addressBook}
              version={historyVersion}
              onOpen={(hash) => {
                setHistoryOpen(false);
                openReplay(hash);
              }}
              onChange={() => setHistoryVersion((v) => v + 1)}
            />
          )}

          {replayLoading && <ReplaySkeleton />}

          {!replayLoading && txReceipt && (
            <div className="space-y-4">
              <TxSummaryBar receipt={txReceipt} book={addressBook} />

              <ReplayTabs
                receipt={txReceipt}
                hasCalldata={!!calldataInitial}
                activeTab={replayTab}
                onTabChange={setReplayTab}
              />

              {replayTab === "receipt" && (
                <TxReceiptPanel receipt={txReceipt} book={addressBook} />
              )}

              {replayTab === "trace" && txReceipt.trace && (
                <>
                  <CallTrace trace={txReceipt.trace} book={addressBook} />
                  <GasProfiler trace={txReceipt.trace} book={addressBook} />
                  <OpcodeDebugger tx={txReceipt.tx} rpcUrl={rpcUrl} book={addressBook} />
                </>
              )}

              {replayTab === "flow" && txReceipt.trace && (
                <MoneyFlow trace={txReceipt.trace} logs={txReceipt.logs} book={addressBook} client={client} />
              )}

              {replayTab === "state" && txReceipt.stateDiff && (
                <StateChanges diff={txReceipt.stateDiff} book={addressBook} />
              )}

              {replayTab === "resim" && calldataInitial && (
                <div>
                  <p className="mb-2 text-xs text-gray-600">
                    Simulates with current contract state (may differ from original execution).
                  </p>
                  <CalldataForm
                    key={calldataKey}
                    client={client}
                    abi={null}
                    contractAddress={calldataInitial.to ?? ""}
                    initial={calldataInitial}
                    onResult={handleReplayResult}
                    book={addressBook}
                    addressBookSuggest={addressBookSuggest}
                    rpcUrl={rpcUrl}
                    shareTxHash={txHash}
                  />
                  <ResultPanel result={replayResult} error={replayError} />
                  {replayResult?.trace && <CallTrace trace={replayResult.trace} book={addressBook} />}
                  {replayResult?.trace && <GasProfiler trace={replayResult.trace} book={addressBook} />}
                  {replayResult?.trace && (
                    <MoneyFlow trace={replayResult.trace} logs={replayResult.logs} book={addressBook} client={client} />
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {page === "addresses" && (
        <div className="max-w-3xl space-y-5">
          <SectionLabel>Address Book</SectionLabel>
          <AddressBookManager book={addressBook} />
        </div>
      )}

      {page === "contract" && (
        <div className="space-y-5">
          <div className="max-w-3xl">
            <SectionLabel>Contract Address</SectionLabel>
            <ContractInput
              loading={loading}
              verified={verified}
              partial={partial}
              proxy={proxy}
              abi={abi}
              error={error}
              onLoad={handleLoadAddress}
              onPasteAbi={(raw, addr) => {
                pasteAbi(raw);
                if (addr) setContractAddress(addr);
              }}
              onClear={handleClear}
              onLoadSaved={handleLoadSaved}
              initialAddress={contractAddress}
            />
          </div>

          {(abi || (contractAddress && !loading) || sharedCalldataInit) && (
            <div className="space-y-4">
              <div className="flex items-center gap-4 border-b border-border pb-2">
                {abi && (
                  <SubTab
                    active={contractTab === "functions"}
                    onClick={() => { setContractTab("functions"); setResult(null); setCallError(null); }}
                  >
                    Functions
                  </SubTab>
                )}
                <SubTab
                  active={contractTab === "calldata"}
                  onClick={() => { setContractTab("calldata"); setResult(null); setCallError(null); }}
                >
                  Raw Calldata
                </SubTab>
                {contractAddress && (
                  <SubTab
                    active={contractTab === "code"}
                    onClick={() => { setContractTab("code"); setResult(null); setCallError(null); }}
                  >
                    Code
                  </SubTab>
                )}
                {contractAddress && (
                  <SubTab
                    active={contractTab === "storage"}
                    onClick={() => { setContractTab("storage"); setResult(null); setCallError(null); }}
                  >
                    Storage
                  </SubTab>
                )}
              </div>

              {contractTab === "functions" && abi && (
                <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
                  <aside className="lg:sticky lg:top-[104px] lg:self-start">
                    <AbiViewer
                      abi={abi}
                      selectedFn={selectedFn}
                      onSelect={(fn) => {
                        setSelectedFn(fn);
                        setResult(null);
                        setCallError(null);
                      }}
                    />
                  </aside>
                  <div className="min-w-0 space-y-4">
                    {selectedFn ? (
                      <>
                        <FunctionForm
                          key={fnKey(selectedFn)}
                          fn={selectedFn}
                          abi={abi}
                          address={contractAddress}
                          client={client}
                          onResult={handleResult}
                          book={addressBook}
                          addressBookSuggest={addressBookSuggest}
                          rpcUrl={rpcUrl}
                        />
                        <ResultPanel result={result} error={callError} />
                        {result?.trace && <CallTrace trace={result.trace} book={addressBook} />}
                        {result?.trace && (
                          <MoneyFlow trace={result.trace} logs={result.logs} book={addressBook} client={client} />
                        )}
                      </>
                    ) : (
                      <ReadAll client={client} address={contractAddress} abi={abi} />
                    )}
                  </div>
                </div>
              )}

              {contractTab === "calldata" && (
                <div className="space-y-4">
                  <CalldataForm
                    client={client}
                    abi={abi}
                    contractAddress={contractAddress}
                    initial={sharedCalldataInit}
                    onResult={handleResult}
                    book={addressBook}
                    addressBookSuggest={addressBookSuggest}
                    rpcUrl={rpcUrl}
                  />
                  <ResultPanel result={result} error={callError} />
                  {result?.trace && <CallTrace trace={result.trace} book={addressBook} />}
                  {result?.trace && <GasProfiler trace={result.trace} book={addressBook} />}
                  {result?.trace && (
                    <MoneyFlow trace={result.trace} logs={result.logs} book={addressBook} client={client} />
                  )}
                </div>
              )}

              {contractTab === "code" && contractAddress && (
                <ContractCode address={contractAddress} client={client} />
              )}

              {contractTab === "storage" && contractAddress && (
                <StorageInspector client={client} address={contractAddress} />
              )}
            </div>
          )}
        </div>
      )}
      </main>
    </div>
    </AddressMenuProvider>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-2 text-xs font-semibold tracking-wide text-gray-500 uppercase">
      {children}
    </h2>
  );
}

function BeaconMark() {
  return (
    <img
      src="/pharos-logo.png"
      alt="Pharos"
      width={24}
      height={24}
      className="size-6 shrink-0 rounded-md"
      aria-hidden="true"
    />
  );
}

function networkDot(id: string): string {
  return id === "mainnet" ? "bg-success" : "bg-warning";
}

function NetworkSwitcher() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const active = ACTIVE_NETWORK;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const select = (id: NetworkId) => {
    if (id === active.id) {
      setOpen(false);
      return;
    }
    setActiveNetworkId(id);
    window.location.reload();
  };

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Switch network"
        className="flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-xs font-medium text-gray-300 transition hover:bg-elevated"
      >
        <span className={`size-1.5 rounded-full ${networkDot(active.id)}`} />
        <span className="hidden sm:inline">{active.label}</span>
        <span className="sm:hidden">{active.shortLabel}</span>
        <svg
          className={`size-3 text-gray-500 transition-transform ${open ? "rotate-180" : ""}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="absolute left-0 z-50 mt-1.5 w-56 overflow-hidden rounded-lg border border-border bg-elevated p-1 shadow-lg">
          {Object.values(NETWORKS).map((n) => (
            <button
              key={n.id}
              onClick={() => select(n.id)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-surface"
            >
              <span className={`size-2 shrink-0 rounded-full ${networkDot(n.id)}`} />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium text-gray-200">{n.label}</div>
                <div className="text-xs text-gray-500">
                  Chain {n.chainId} · {n.currency}
                </div>
              </div>
              {n.id === active.id && (
                <svg className="size-4 shrink-0 text-cyan-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m5 13 4 4L19 7" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ConnDot({ connected }: { connected: boolean | null }) {
  const title =
    connected === null ? "Checking RPC…" : connected ? "RPC connected" : "RPC unreachable";
  const color =
    connected === null ? "bg-gray-600" : connected ? "bg-success" : "bg-danger";
  return (
    <span title={title} className="flex items-center px-1.5">
      <span className={`size-1.5 rounded-full ${color}`} />
    </span>
  );
}

function GlobalSearch({
  onSearch,
  className = "",
}: {
  onSearch: (q: string) => void;
  className?: string;
}) {
  const [q, setQ] = useState("");
  return (
    <div className={`relative ${className}`}>
      <svg
        className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-gray-500"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m21 21-4.3-4.3" />
      </svg>
      <input
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && q.trim()) {
            onSearch(q);
            setQ("");
          }
        }}
        placeholder="Search address / tx / block…"
        spellCheck={false}
        className="w-full rounded-md bg-surface py-1.5 pr-2 pl-8 text-xs text-gray-300 outline-none ring-1 ring-border focus:ring-accent"
      />
    </div>
  );
}

function ReplaySkeleton() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="h-11 rounded-lg border border-border bg-surface" />
      <div className="h-9 rounded-lg border border-border bg-surface" />
      <div className="h-64 rounded-lg border border-border bg-surface" />
    </div>
  );
}

function HistoryToggle({
  open,
  count,
  onClick,
}: {
  open: boolean;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={open}
      title="Replay history"
      className={`flex shrink-0 items-center gap-1.5 self-end rounded-md px-2.5 py-2 text-xs font-medium ring-1 ring-border transition sm:self-auto ${
        open
          ? "bg-elevated text-cyan-400"
          : "bg-surface text-gray-400 hover:bg-elevated hover:text-gray-200"
      }`}
    >
      <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 3v5h5" />
        <path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" />
        <path d="M12 7v5l3 2" />
      </svg>
      <span className="hidden sm:inline">History</span>
      {count > 0 && (
        <span className={`rounded-full px-1.5 py-0.5 text-xs ${
          open ? "bg-cyan-900/40 text-cyan-400" : "bg-gray-800 text-gray-400"
        }`}>
          {count}
        </span>
      )}
    </button>
  );
}

function SunIcon() {
  return (
    <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  );
}

function MonitorIcon() {
  return (
    <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </svg>
  );
}

function ThemeToggle({ mode, onChange }: { mode: ThemeMode; onChange: (m: ThemeMode) => void }) {
  const effective = resolveTheme(mode);
  const next = effective === "dark" ? "light" : "dark";
  return (
    <button
      onClick={() => onChange(next)}
      title={`Switch to ${next} theme`}
      aria-label={`Switch to ${next} theme`}
      className="flex items-center rounded-md p-1.5 text-gray-500 transition hover:bg-elevated hover:text-gray-200"
    >
      {effective === "dark" ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

function ThemeSegment({ mode, onChange }: { mode: ThemeMode; onChange: (m: ThemeMode) => void }) {
  const options: { id: ThemeMode; label: string; icon: React.ReactNode }[] = [
    { id: "system", label: "System", icon: <MonitorIcon /> },
    { id: "light", label: "Light", icon: <SunIcon /> },
    { id: "dark", label: "Dark", icon: <MoonIcon /> },
  ];
  return (
    <div className="grid grid-cols-3 gap-1 rounded-lg bg-gray-900 p-1 ring-1 ring-gray-800">
      {options.map((opt) => (
        <button
          key={opt.id}
          onClick={() => onChange(opt.id)}
          aria-pressed={mode === opt.id}
          className={`flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition ${
            mode === opt.id
              ? "bg-elevated text-cyan-400"
              : "text-gray-500 hover:text-gray-300"
          }`}
        >
          {opt.icon}
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function NavButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition ${
        active
          ? "border-accent text-cyan-400"
          : "border-transparent text-gray-500 hover:text-gray-300"
      }`}
    >
      {children}
    </button>
  );
}

const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

function countValueTransfers(receipt: TxReceipt): number {
  let count = 0;

  function walkTrace(t: import("./lib/trace").TraceCall) {
    if (BigInt(t.value) > 0n && t.type !== "DELEGATECALL") count++;
    if (t.calls) for (const c of t.calls) walkTrace(c);
  }
  if (receipt.trace) walkTrace(receipt.trace);

  for (const log of receipt.logs) {
    const isDecodedTransfer = (log.eventName === "Transfer" || log.eventName.startsWith("Transfer("))
      && log.args.from && log.args.to
      && (log.args.value !== undefined || log.args.amount !== undefined);
    if (isDecodedTransfer) { count++; continue; }

    const topic0 = log.raw.topics[0];
    if (topic0?.toLowerCase() === TRANSFER_TOPIC && log.raw.topics.length >= 3) {
      try { if (BigInt(log.raw.data) > 0n) count++; } catch { /* skip */ }
    }
  }
  return count;
}

function ReplayTabs({
  receipt,
  hasCalldata,
  activeTab,
  onTabChange,
}: {
  receipt: TxReceipt;
  hasCalldata: boolean;
  activeTab: ReplayTab;
  onTabChange: (tab: ReplayTab) => void;
}) {
  const availableTabs = useMemo(() => {
    const tabs: ReplayTab[] = ["receipt"];
    if (receipt.trace) tabs.push("trace", "flow");
    if (receipt.stateDiff) tabs.push("state");
    if (hasCalldata) tabs.push("resim");
    return tabs;
  }, [receipt.trace, receipt.stateDiff, hasCalldata]);

  const callCount = receipt.trace ? countCalls(receipt.trace) : 0;
  const transferCount = countValueTransfers(receipt);
  const stateCount = receipt.stateDiff
    ? new Set([...Object.keys(receipt.stateDiff.pre), ...Object.keys(receipt.stateDiff.post)]).size
    : 0;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT") return;

      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        const idx = availableTabs.indexOf(activeTab);
        if (idx === -1) return;
        const next = e.key === "ArrowRight"
          ? availableTabs[(idx + 1) % availableTabs.length]
          : availableTabs[(idx - 1 + availableTabs.length) % availableTabs.length];
        onTabChange(next);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeTab, availableTabs, onTabChange]);

  return (
    <div className="flex flex-wrap items-center gap-1 rounded-lg bg-gray-900/80 p-1 ring-1 ring-gray-800/60">
      <PillTab active={activeTab === "receipt"} onClick={() => onTabChange("receipt")} badge={receipt.logs.length || undefined}>
        Receipt
      </PillTab>
      {receipt.trace && (
        <PillTab active={activeTab === "trace"} onClick={() => onTabChange("trace")} badge={callCount}>
          Trace
        </PillTab>
      )}
      {receipt.trace && (
        <PillTab active={activeTab === "flow"} onClick={() => onTabChange("flow")} badge={transferCount || undefined}>
          Flow
        </PillTab>
      )}
      {receipt.stateDiff && (
        <PillTab active={activeTab === "state"} onClick={() => onTabChange("state")} badge={stateCount}>
          State
        </PillTab>
      )}
      {hasCalldata && (
        <PillTab active={activeTab === "resim"} onClick={() => onTabChange("resim")}>
          Re-sim
        </PillTab>
      )}
      <span className="ml-auto pr-1.5 text-xs text-gray-700">← →</span>
    </div>
  );
}

function PillTab({
  active,
  onClick,
  children,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  badge?: number | string;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-all ${
        active
          ? "bg-gray-800 text-cyan-400 shadow-sm shadow-cyan-500/10"
          : "text-gray-500 hover:bg-gray-800/50 hover:text-gray-300"
      }`}
    >
      {children}
      {badge !== undefined && badge !== 0 && (
        <span className={`ml-1 rounded-full px-1.5 py-0.5 text-xs ${
          active ? "bg-cyan-900/40 text-cyan-400" : "bg-gray-800 text-gray-500"
        }`}>
          {badge}
        </span>
      )}
    </button>
  );
}

function SubTab({
  active,
  onClick,
  children,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  badge?: number | string;
}) {
  return (
    <button
      onClick={onClick}
      className={`pb-1 text-sm font-medium transition ${
        active
          ? "border-b-2 border-cyan-500 text-cyan-400"
          : "text-gray-500 hover:text-gray-300"
      }`}
    >
      {children}
      {badge !== undefined && badge !== 0 && (
        <span className="ml-1 rounded-full bg-gray-800 px-1.5 py-0.5 text-xs text-gray-400">
          {badge}
        </span>
      )}
    </button>
  );
}
