'use client';

import { notFound } from 'next/navigation';
import { use } from 'react';

import { PageHeader } from '@/components/app/page-header';
import { AvatarPicker } from '@/components/media/avatar-picker';
import { HandleForm } from '@/components/settings/handle-form';
import { PasswordForm } from '@/components/settings/password-form';
import { ProfileForm } from '@/components/settings/profile-form';
import { SettingsSection } from '@/components/settings/section';
import { SessionsForm } from '@/components/settings/sessions';
import { ThemeToggle } from '@/components/settings/theme-toggle';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { Skeleton } from '@/components/ui/skeleton';
import { TabsNav } from '@/components/ui/tabs';
import { useMe } from '@/lib/hooks/use-me';

import type { Me } from '@/lib/api/profile';
import type { ReactNode } from 'react';

// Uma aba por rota (`/app/settings/<tab>`): Privacidade, Projetos, Domínio e Plano,
// que o design prevê, entram aqui quando existirem — sem mexer nas outras.
const TABS = {
  profile: { label: 'Perfil', render: (me: Me) => <ProfileTab me={me} /> },
  account: { label: 'Conta', render: (me: Me) => <AccountTab me={me} /> },
} as const satisfies Record<string, { label: string; render: (me: Me) => ReactNode }>;

const href = (tab: string) => `/app/settings/${tab}`;

function ProfileTab({ me }: { me: Me }) {
  return (
    <>
      <SettingsSection
        id="profile"
        title="Dados do perfil"
        description="É o que aparece no seu endereço público, para qualquer pessoa."
      >
        <AvatarPicker me={me} className="mb-8" />
        <ProfileForm me={me} />
      </SettingsSection>

      <SettingsSection
        id="theme"
        title="Aparência"
        description="Tema da interface do Casebook neste navegador. Sua página pública não muda."
      >
        <ThemeToggle />
      </SettingsSection>
    </>
  );
}

function AccountTab({ me }: { me: Me }) {
  return (
    <>
      <SettingsSection id="handle" title="Handle">
        <HandleForm me={me} />
      </SettingsSection>

      <SettingsSection
        id="password"
        title="Senha"
        description="Trocar a senha encerra todas as suas outras sessões, em qualquer dispositivo. Esta aqui continua aberta."
      >
        <PasswordForm email={me.me.email} />
      </SettingsSection>

      <SettingsSection
        id="sessions"
        title="Sessões"
        description="Encerra o acesso em todos os navegadores e aparelhos, inclusive neste. Você vai precisar entrar de novo."
      >
        <SessionsForm />
      </SettingsSection>
    </>
  );
}

export default function SettingsPage({ params }: { params: Promise<{ tab: string }> }) {
  const { tab } = use(params);
  const me = useMe();
  if (!Object.hasOwn(TABS, tab)) notFound();
  const current = TABS[tab as keyof typeof TABS];

  return (
    <>
      <title>{`${current.label} — Configurações — Casebook`}</title>
      <PageHeader title="Configurações">
        <TabsNav
          label="Seções das configurações"
          current={href(tab)}
          tabs={Object.entries(TABS).map(([key, { label }]) => ({ href: href(key), label }))}
        />
      </PageHeader>

      <div className="flex flex-col gap-12 px-5 py-[1.875rem] md:px-10">
        {me.isPending && (
          <div className="flex max-w-2xl flex-col gap-5">
            <p role="status" className="sr-only">
              Carregando seu perfil…
            </p>
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-12" />
            <Skeleton className="h-32" />
            <Skeleton className="h-12" />
          </div>
        )}
        {me.isError && (
          <Notice tone="danger" className="flex max-w-2xl flex-col items-start gap-3">
            <span>{me.error.message}</span>
            <Button variant="secondary" size="sm" onClick={() => void me.refetch()}>
              Tentar de novo
            </Button>
          </Notice>
        )}
        {me.data && current.render(me.data)}
      </div>
    </>
  );
}
