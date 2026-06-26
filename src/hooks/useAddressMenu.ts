import { createContext, useContext } from "react";

export type AddressMenuCtx = {
  open: (address: string, x: number, y: number) => void;
};

export const AddressMenuContext = createContext<AddressMenuCtx>({
  open: () => {},
});

export function useAddressMenu(): AddressMenuCtx {
  return useContext(AddressMenuContext);
}
