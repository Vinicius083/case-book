'use client';

import { HandleForm } from '@/components/settings/handle-form';
import { PasswordForm } from '@/components/settings/password-form';
import { ProfileForm } from '@/components/settings/profile-form';
import { SettingsSection } from '@/components/settings/section';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { useMe } from '@/lib/hooks/use-me';

export default function ProfileSettingsPage() {
  const me = useMe();

  return (
    <div className="flex flex-col gap-10">
      <title>Perfil — Casebook</title>
      <h1 className="font-heading text-3xl font-bold">Perfil</h1>

      {me.isPending && (
        <p role="status" className="text-muted">
          Carregando seu perfil…
        </p>
      )}
      {me.isError && (
        <Notice tone="danger" className="flex max-w-2xl flex-col items-start gap-3">
          <span>{me.error.message}</span>
          <Button variant="secondary" size="sm" onClick={() => void me.refetch()}>
            Tentar de novo
          </Button>
        </Notice>
      )}

      {me.data && (
        <>
          <SettingsSection
            id="profile"
            title="Perfil público"
            description="É o que aparece no seu endereço público, para qualquer pessoa."
          >
            <ProfileForm me={me.data} />
          </SettingsSection>

          <SettingsSection id="handle" title="Handle">
            <HandleForm me={me.data} />
          </SettingsSection>

          <SettingsSection
            id="password"
            title="Senha"
            description="Trocar a senha encerra todas as suas outras sessões, em qualquer dispositivo. Esta aqui continua aberta."
          >
            <PasswordForm email={me.data.me.email} />
          </SettingsSection>
        </>
      )}
    </div>
  );
}
