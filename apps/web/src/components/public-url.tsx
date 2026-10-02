'use client';

import { createContext, type ReactNode, useCallback, useContext } from 'react';

import { publicAddress } from '@/lib/public-address';

const PublicUrlContext = createContext('');

/** Entrega `PUBLIC_BASE_URL` (lida no servidor, por requisição) aos componentes de cliente. */
export function PublicUrlProvider({ baseUrl, children }: { baseUrl: string; children: ReactNode }) {
  return <PublicUrlContext.Provider value={baseUrl}>{children}</PublicUrlContext.Provider>;
}

/** `(handle) => { text, url }` com a URL base do ambiente. */
export function usePublicAddress() {
  const baseUrl = useContext(PublicUrlContext);
  return useCallback((handle: string) => publicAddress(baseUrl, handle), [baseUrl]);
}
