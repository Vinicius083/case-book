'use client';

import { DevicesIcon } from '@phosphor-icons/react/ssr';
import { useState } from 'react';

import { useLeave } from '@/components/app/account-menu';
import { Button } from '@/components/ui/button';
import { logoutAll } from '@/lib/api/auth';

export function SessionsForm() {
  const leave = useLeave();
  const [leaving, setLeaving] = useState(false);

  return (
    <Button
      variant="secondary"
      className="w-fit"
      loading={leaving}
      onClick={() => {
        setLeaving(true);
        void leave(logoutAll).finally(() => {
          setLeaving(false);
        });
      }}
    >
      {!leaving && <DevicesIcon aria-hidden weight="duotone" />}
      {leaving ? 'Saindo…' : 'Sair de todos os dispositivos'}
    </Button>
  );
}
