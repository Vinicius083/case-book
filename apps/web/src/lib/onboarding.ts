import type { MeResponse } from '@casebook/contracts/profile';

/**
 * Passo de onboarding que falta, ou `undefined` se já terminou (ou pulou). Só há
 * um carimbo de conclusão, então o passo é deduzido: sem papel escolhido, volta
 * ao passo do papel; com papel, vai direto ao do perfil.
 */
export function pendingOnboardingStep(me: MeResponse): string | undefined {
  if (me.profile.onboarding_completed_at !== null) return undefined;
  return me.profile.roles.length === 0 ? '/onboarding/role' : '/onboarding/profile';
}
