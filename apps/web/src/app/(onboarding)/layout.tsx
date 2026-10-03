import { SessionGate } from '@/components/app/session-gate';
import { MediaEvents } from '@/components/media/media-events';
import { OnboardingGate } from '@/components/onboarding/onboarding-gate';

import type { ReactNode } from 'react';

// Passos 2 e 3 do cadastro (papel e perfil): a conta já existe e a sessão está aberta.
export default function OnboardingLayout({ children }: { children: ReactNode }) {
  return (
    <SessionGate>
      {/* O seletor de foto do passo de perfil envia imagens: precisa dos eventos de mídia. */}
      <MediaEvents />
      <OnboardingGate>{children}</OnboardingGate>
    </SessionGate>
  );
}
