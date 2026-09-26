import { createContext, useContext } from "react";

export const IdentityReverificationContext = createContext<(() => void) | null>(null);

export function useRequestIdentityVerification() {
  return useContext(IdentityReverificationContext);
}
