'use client';

import { useRouter } from 'next/navigation';
import { type ReactNode, useEffect } from 'react';

import { FullScreen, LoadingScreen } from '@/components/app/full-screen';
import { Button } from '@/components/ui/button';
import { useMe } from '@/lib/hooks/use-me';

/** Os passos de onboarding só existem para quem ainda não os terminou; os demais vão para o app. */
export function OnboardingGate({ children }: { children: ReactNode }) {
  const me = useMe();
  const router = useRouter();
  const done = me.data ? me.data.me.profile.onboarding_completed_at !== null : false;

  useEffect(() => {
    if (done) router.replace('/app');
  }, [done, router]);

  if (me.isError) {
    return (
      <FullScreen>
        <h1 className="text-section">Não deu para carregar seu perfil</h1>
        <p className="max-w-sm text-text-secondary">{me.error.message}</p>
        <Button className="mt-2" onClick={() => void me.refetch()}>
          Tentar de novo
        </Button>
      </FullScreen>
    );
  }
  if (me.isPending || done) return <LoadingScreen>Abrindo o Casebook…</LoadingScreen>;
  return children;
}
