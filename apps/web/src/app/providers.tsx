'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';

import { PublicUrlProvider } from '@/components/public-url';
import { Toaster } from '@/components/ui/toast';
import { ApiError } from '@/lib/api/errors';

interface ProvidersProps {
  publicBaseUrl: string;
  children: ReactNode;
}

export function Providers({ publicBaseUrl, children }: ProvidersProps) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            // Repetir só o que pode ter sido passageiro (rede, 5xx); 4xx não muda sozinho.
            retry: (failures, error) =>
              failures < 2 &&
              (!(error instanceof ApiError) || error.status === 0 || error.status >= 500),
          },
        },
      }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <PublicUrlProvider baseUrl={publicBaseUrl}>{children}</PublicUrlProvider>
      <Toaster />
    </QueryClientProvider>
  );
}
