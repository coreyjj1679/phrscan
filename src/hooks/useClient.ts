import { useMemo, useState, useEffect, useCallback } from "react";
import { createPublicClient, http, type PublicClient } from "viem";
import { pharosTestnet, DEFAULT_RPC } from "../config/chain";
import { getSavedRpcUrl, saveRpcUrl } from "../lib/storage";

export function useClient() {
  const [rpcUrl, setRpcUrl] = useState(() => getSavedRpcUrl() ?? DEFAULT_RPC);
  const [connected, setConnected] = useState<boolean | null>(null);

  const client: PublicClient = useMemo(
    () =>
      createPublicClient({
        chain: pharosTestnet,
        transport: http(rpcUrl),
      }),
    [rpcUrl],
  );

  const checkConnection = useCallback(async () => {
    setConnected(null);
    try {
      await client.getChainId();
      setConnected(true);
    } catch {
      setConnected(false);
    }
  }, [client]);

  useEffect(() => {
    checkConnection();
  }, [checkConnection]);

  const updateRpcUrl = useCallback((url: string) => {
    setRpcUrl(url);
    saveRpcUrl(url);
  }, []);

  return { client, rpcUrl, setRpcUrl: updateRpcUrl, connected, checkConnection };
}
