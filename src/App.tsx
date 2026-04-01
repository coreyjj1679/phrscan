import { useState, useEffect } from "react";
import { useClient } from "./hooks/useClient";
import { useAbi } from "./hooks/useAbi";
import { useAddressBook } from "./hooks/useAddressBook";
import { RpcConfig } from "./components/RpcConfig";
import { ContractInput } from "./components/ContractInput";
import { AbiViewer } from "./components/AbiViewer";
import { FunctionForm } from "./components/FunctionForm";
import { CalldataForm, type CalldataInitial } from "./components/CalldataForm";
import { ResultPanel } from "./components/ResultPanel";
import { TxReplay, TxReceiptPanel, type TxData, type TxReceipt } from "./components/TxReplay";
import { ContractCode } from "./components/ContractCode";
import { CallTrace } from "./components/CallTrace";
import { StateChanges } from "./components/StateChanges";
import { AddressBookManager } from "./components/AddressBookManager";
import { fnKey, type AbiFunction } from "./lib/abi";
import type { CallResult } from "./lib/simulate";
import { type SavedContract, getSettings, saveSettings } from "./lib/storage";

type Page = "contract" | "replay" | "addresses" | "settings";
type ContractTab = "functions" | "calldata" | "code";

export default function App() {
  const { client, rpcUrl, setRpcUrl, connected } = useClient();
  const { abi, verified, partial, loading, error, load, pasteAbi, clear } = useAbi();
  const addressBook = useAddressBook();

  const [page, setPage] = useState<Page>("contract");
  const [contractAddress, setContractAddress] = useState("");
  const [selectedFn, setSelectedFn] = useState<AbiFunction | null>(null);
  const [result, setResult] = useState<CallResult | null>(null);
  const [callError, setCallError] = useState<string | null>(null);
  const [contractTab, setContractTab] = useState<ContractTab>("functions");
  const [calldataInitial, setCalldataInitial] = useState<CalldataInitial | undefined>();
  const [calldataKey, setCalldataKey] = useState(0);
  const [txReceipt, setTxReceipt] = useState<TxReceipt | null>(null);
  const [replayResult, setReplayResult] = useState<CallResult | null>(null);
  const [replayError, setReplayError] = useState<string | null>(null);
  const [showResim, setShowResim] = useState(false);
  const [addressBookSuggest, setAddressBookSuggest] = useState(() => getSettings().addressBookSuggest);

  useEffect(() => {
    if (abi && contractAddress) {
      addressBook.saveAbi(contractAddress, abi);
    }
  }, [abi, contractAddress]);

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
    setShowResim(false);
  };

  return (
    <div className="mx-auto max-w-2xl px-3 py-4 sm:px-4 sm:py-6">
      <header className="mb-4">
        <div className="flex items-center justify-between">
          <h1 className="text-base font-bold tracking-tight text-gray-100 sm:text-lg">
            Pharos Mini Explorer
          </h1>
          <a
            href="https://github.com/coreyjj1679/phrscan"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-gray-500 transition hover:bg-gray-800 hover:text-gray-300"
          >
            <svg className="size-4 fill-current">
              <use href="/icons.svg#github-icon" />
            </svg>
            Source
          </a>
        </div>
        <p className="mt-0.5 text-xs text-gray-500">
          Atlantic Testnet &middot; Chain 688689
        </p>
        <div className="mt-3 rounded-md border border-gray-800 bg-gray-900/60 px-3 py-2 text-[11px] leading-relaxed text-gray-500">
          Non-official &middot; Use at your own risk &middot; Never enter a private key &mdash; all contract calls only simulate
        </div>
      </header>

      <nav className="mb-6 grid grid-cols-2 gap-1 rounded-lg bg-gray-900 p-1 sm:flex">
        <NavButton active={page === "contract"} onClick={() => setPage("contract")}>
          Contract
        </NavButton>
        <NavButton active={page === "replay"} onClick={() => setPage("replay")}>
          Replay Tx
        </NavButton>
        <NavButton active={page === "addresses"} onClick={() => setPage("addresses")}>
          Addresses
        </NavButton>
        <NavButton active={page === "settings"} onClick={() => setPage("settings")}>
          Settings
        </NavButton>
      </nav>

      {page === "settings" && (
        <div className="space-y-6">
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
        </div>
      )}

      {page === "replay" && (
        <div className="space-y-5">
          <div>
            <SectionLabel>Transaction Hash</SectionLabel>
            <TxReplay client={client} onTxLoaded={handleTxLoaded} />
          </div>

          {txReceipt && <TxReceiptPanel receipt={txReceipt} book={addressBook} />}

          {txReceipt?.trace && <CallTrace trace={txReceipt.trace} book={addressBook} />}
          {txReceipt?.stateDiff && <StateChanges diff={txReceipt.stateDiff} book={addressBook} />}

          {calldataInitial && (
            <div>
              {!showResim ? (
                <button
                  onClick={() => setShowResim(true)}
                  className="text-xs text-gray-500 underline hover:text-gray-300"
                >
                  Re-simulate at current state
                </button>
              ) : (
                <>
                  <SectionLabel>Re-simulate</SectionLabel>
                  <p className="mb-2 text-[11px] text-gray-600">
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
                  />
                  <ResultPanel result={replayResult} error={replayError} />
                  {replayResult?.trace && <CallTrace trace={replayResult.trace} book={addressBook} />}
                </>
              )}
            </div>
          )}
        </div>
      )}

      {page === "addresses" && (
        <div className="space-y-5">
          <SectionLabel>Address Book</SectionLabel>
          <AddressBookManager book={addressBook} />
        </div>
      )}

      {page === "contract" && (
        <div className="space-y-5">
          <div>
            <SectionLabel>Contract Address</SectionLabel>
            <ContractInput
              loading={loading}
              verified={verified}
              partial={partial}
              abi={abi}
              error={error}
              onLoad={handleLoadAddress}
              onPasteAbi={(raw, addr) => {
                pasteAbi(raw);
                if (addr) setContractAddress(addr);
              }}
              onClear={handleClear}
              onLoadSaved={handleLoadSaved}
            />
          </div>

          {(abi || (contractAddress && !loading)) && (
            <div>
              <div className="mb-3 flex items-center gap-3 border-b border-gray-800 pb-2">
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
              </div>

              {contractTab === "functions" && abi && (
                <div className="space-y-4">
                  <AbiViewer
                    abi={abi}
                    selectedFn={selectedFn}
                    onSelect={(fn) => {
                      setSelectedFn(fn);
                      setResult(null);
                      setCallError(null);
                    }}
                  />
                  {selectedFn && (
                    <FunctionForm
                      key={fnKey(selectedFn)}
                      fn={selectedFn}
                      abi={abi}
                      address={contractAddress}
                      client={client}
                      onResult={handleResult}
                      book={addressBook}
                      addressBookSuggest={addressBookSuggest}
                    />
                  )}
                </div>
              )}

              {contractTab === "calldata" && (
                <CalldataForm
                  client={client}
                  abi={abi}
                  contractAddress={contractAddress}
                  onResult={handleResult}
                  book={addressBook}
                  addressBookSuggest={addressBookSuggest}
                />
              )}

              {contractTab === "code" && contractAddress && (
                <ContractCode address={contractAddress} client={client} />
              )}
            </div>
          )}

          {contractTab !== "code" && (
            <>
              <ResultPanel result={result} error={callError} />
              {result?.trace && <CallTrace trace={result.trace} book={addressBook} />}
            </>
          )}
        </div>
      )}

    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-2 text-xs font-semibold tracking-wide text-gray-500 uppercase">
      {children}
    </h2>
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
      className={`rounded-md px-3 py-2 text-sm font-medium transition sm:flex-1 sm:py-1.5 ${
        active
          ? "bg-gray-800 text-cyan-400"
          : "text-gray-500 hover:text-gray-300"
      }`}
    >
      {children}
    </button>
  );
}

function SubTab({
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
      className={`pb-1 text-sm font-medium transition ${
        active
          ? "border-b-2 border-cyan-500 text-cyan-400"
          : "text-gray-500 hover:text-gray-300"
      }`}
    >
      {children}
    </button>
  );
}
