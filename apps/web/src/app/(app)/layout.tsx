import { AppShell } from '@/components/app/app-shell';
import { SessionGate } from '@/components/app/session-gate';

import type { ReactNode } from 'react';

// Área logada: client-side, com TanStack Query. O middleware só redireciona quem
// claramente não tem sessão; quem autoriza de verdade é a API.
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <SessionGate>
      <AppShell>{children}</AppShell>
    </SessionGate>
  );
}
