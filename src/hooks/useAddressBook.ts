import { useCallback, useState } from "react";
import type { Abi } from "viem";
import {
  getSavedAddresses,
  saveAddress,
  deleteAddress,
  getAbiForAddress,
  getAbiRegistry,
  getSavedContracts,
  saveContract,
  deleteContract,
  updateContractAbi as updateContractAbiStorage,
  saveAbi as saveAbiStorage,
  deleteAbi as deleteAbiStorage,
} from "../lib/storage";

export function useAddressBook() {
  const [version, setVersion] = useState(0);

  const bump = () => setVersion((v) => v + 1);

  const addresses = getSavedAddresses();
  const contracts = getSavedContracts();

  const resolve = useCallback(
    (addr: string): string | undefined => {
      void version;
      const lc = addr.toLowerCase();
      const addrMatch = addresses.find(
        (a) => a.address.toLowerCase() === lc,
      );
      if (addrMatch) return addrMatch.label;
      const contractMatch = contracts.find(
        (c) => c.address.toLowerCase() === lc,
      );
      return contractMatch?.label;
    },
    [version, addresses, contracts],
  );

  const save = useCallback(
    (address: string, label: string) => {
      saveAddress({ address, label, savedAt: Date.now() });
      bump();
    },
    [],
  );

  const remove = useCallback(
    (address: string) => {
      deleteAddress(address);
      bump();
    },
    [],
  );

  const resolveAbi = useCallback(
    (addr: string): Abi | undefined => {
      void version;
      return getAbiForAddress(addr);
    },
    [version],
  );

  const abiRegistry = useCallback((): Map<string, Abi> => {
    void version;
    return getAbiRegistry();
  }, [version]);

  const saveAbi = useCallback(
    (address: string, abi: Abi) => {
      saveAbiStorage(address, abi);
      bump();
    },
    [],
  );

  const removeAbi = useCallback(
    (address: string) => {
      deleteAbiStorage(address);
      bump();
    },
    [],
  );

  const updateEntry = useCallback(
    (oldAddress: string, newAddress: string, label: string) => {
      if (oldAddress.toLowerCase() !== newAddress.toLowerCase()) {
        deleteAddress(oldAddress);
      }
      saveAddress({ address: newAddress, label, savedAt: Date.now() });
      bump();
    },
    [],
  );

  const renameContract = useCallback(
    (address: string, label: string) => {
      const existing = contracts.find(
        (c) => c.address.toLowerCase() === address.toLowerCase(),
      );
      if (existing) {
        saveContract({ ...existing, label, savedAt: Date.now() });
        bump();
      }
    },
    [contracts],
  );

  const updateContract = useCallback(
    (oldAddress: string, newAddress: string, label: string) => {
      const existing = contracts.find(
        (c) => c.address.toLowerCase() === oldAddress.toLowerCase(),
      );
      if (!existing) return;
      if (oldAddress.toLowerCase() !== newAddress.toLowerCase()) {
        deleteContract(oldAddress);
      }
      saveContract({ ...existing, address: newAddress, label, savedAt: Date.now() });
      bump();
    },
    [contracts],
  );

  const updateContractAbi = useCallback(
    (address: string, abi: Abi) => {
      updateContractAbiStorage(address, abi);
      saveAbiStorage(address, abi);
      bump();
    },
    [],
  );

  const removeContract = useCallback(
    (address: string) => {
      deleteContract(address);
      bump();
    },
    [],
  );

  return {
    addresses,
    contracts,
    resolve,
    save,
    remove,
    updateEntry,
    resolveAbi,
    abiRegistry,
    saveAbi,
    removeAbi,
    renameContract,
    updateContract,
    updateContractAbi,
    removeContract,
    version,
  };
}

export type AddressBook = ReturnType<typeof useAddressBook>;
