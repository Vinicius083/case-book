'use client';

import {
  ApertureIcon,
  CheckCircleIcon,
  ClipboardTextIcon,
  MagicWandIcon,
  MegaphoneIcon,
  MonitorPlayIcon,
  PaletteIcon,
  PlusIcon,
  ScissorsIcon,
  ShapesIcon,
  TagIcon,
  VideoCameraIcon,
  WaveformIcon,
} from '@phosphor-icons/react/ssr';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { Steps } from '@/components/ui/steps';
import { ApiError } from '@/lib/api/errors';
import { type Me, updateProfile } from '@/lib/api/profile';
import { ME_QUERY_KEY, useMe } from '@/lib/hooks/use-me';
import { cn } from '@/lib/utils';

import type { Icon } from '@phosphor-icons/react';

const NEXT_STEP = '/onboarding/profile';
/** Limite só deste passo; nas configurações o perfil aceita mais papéis. */
const MAX_ROLES = 3;

const ROLES: readonly { name: string; hint: string; icon: Icon }[] = [
  { name: 'Montagem', hint: 'edição e ritmo', icon: ScissorsIcon },
  { name: 'Direção', hint: 'direção e roteiro', icon: MegaphoneIcon },
  { name: 'Motion design', hint: 'animação e gráficos', icon: ShapesIcon },
  { name: 'Direção de fotografia', hint: 'câmera e luz', icon: ApertureIcon },
  { name: 'Videomaker', hint: 'captação completa', icon: VideoCameraIcon },
  { name: 'Som', hint: 'captação e mixagem', icon: WaveformIcon },
  { name: 'Produção', hint: 'orçamento e equipe', icon: ClipboardTextIcon },
  { name: 'VFX', hint: 'composição e limpeza', icon: MagicWandIcon },
  { name: 'Cor', hint: 'color grading', icon: PaletteIcon },
  { name: 'Finalização', hint: 'entrega e masterização', icon: MonitorPlayIcon },
];

function RoleCard({
  name,
  hint,
  icon: RoleIcon,
  selected,
  disabled,
  onToggle,
}: {
  name: string;
  hint: string;
  icon: Icon;
  selected: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        'relative flex min-h-24 flex-col justify-between gap-3 rounded-md border p-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-45 sm:min-h-[8.25rem] sm:p-[1.375rem]',
        selected
          ? 'border-accent-text bg-accent-tint'
          : 'border-border bg-surface hover:border-border-control',
      )}
    >
      <RoleIcon
        aria-hidden
        weight="duotone"
        className={cn('size-7', selected ? 'text-accent-text' : 'text-text-secondary')}
      />
      {selected && (
        <CheckCircleIcon
          aria-hidden
          weight="duotone"
          className="absolute top-4 right-4 size-5 text-accent-text"
        />
      )}
      <span>
        <span className="block font-heading text-[1.0625rem] leading-tight sm:text-card">
          {name}
        </span>
        <span
          className={cn('mt-1 block text-caption', selected ? 'text-on-accent-tint' : 'text-muted')}
        >
          {selected ? 'selecionado' : hint}
        </span>
      </span>
    </button>
  );
}

export default function OnboardingRolePage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const me = useMe();
  const [roles, setRoles] = useState<string[]>(() => me.data?.me.profile.roles ?? []);
  const [addingOther, setAddingOther] = useState(false);
  const [other, setOther] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  const full = roles.length >= MAX_ROLES;
  const custom = roles.filter((role) => !ROLES.some((preset) => preset.name === role));
  const toggle = (role: string) => {
    setRoles((current) =>
      current.includes(role) ? current.filter((item) => item !== role) : [...current, role],
    );
  };

  const addOther = (event: { preventDefault: () => void }) => {
    event.preventDefault();
    const role = other.trim();
    if (role !== '' && !roles.includes(role) && !full) setRoles([...roles, role]);
    setOther('');
    setAddingOther(false);
  };

  const save = async () => {
    setError(undefined);
    const current = queryClient.getQueryData<Me>(ME_QUERY_KEY) ?? me.data;
    if (!current) return;
    setSaving(true);
    try {
      queryClient.setQueryData(ME_QUERY_KEY, await updateProfile({ roles }, current.etag));
      router.push(NEXT_STEP);
    } catch (cause) {
      setError(
        cause instanceof ApiError ? cause.message : 'Não foi possível salvar. Tente de novo.',
      );
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-dvh flex-col">
      <title>Papel na produção — Casebook</title>
      <header className="flex items-center justify-between gap-4 px-6 py-[1.375rem] sm:px-12">
        <span className="brand-mark">Casebook</span>
        <Steps current={2} total={3} />
      </header>

      <main className="flex flex-1 flex-col px-6 pt-4 pb-8 sm:px-12 sm:pt-[1.625rem] sm:pb-12">
        <h1 className="text-[2rem] leading-[1.12] tracking-[-0.02em] sm:text-screen">
          O que você faz em um set?
        </h1>
        <p className="mt-3 mb-[2.125rem] max-w-[38.75rem] text-text-secondary">
          Escolha até três papéis. Eles aparecem no seu perfil público, e dá para mudar depois nas
          configurações.
        </p>

        <div className="grid grid-cols-2 gap-2.5 sm:gap-4 lg:grid-cols-4">
          {ROLES.map((role) => (
            <RoleCard
              key={role.name}
              {...role}
              selected={roles.includes(role.name)}
              disabled={full && !roles.includes(role.name)}
              onToggle={() => {
                toggle(role.name);
              }}
            />
          ))}
          {custom.map((role) => (
            <RoleCard
              key={role}
              name={role}
              hint=""
              icon={TagIcon}
              selected
              disabled={false}
              onToggle={() => {
                toggle(role);
              }}
            />
          ))}
          {addingOther ? (
            <form
              onSubmit={addOther}
              className="flex min-h-24 flex-col justify-between gap-3 rounded-md border border-dashed border-border-control bg-surface p-4 sm:min-h-[8.25rem] sm:p-[1.375rem]"
            >
              <label htmlFor="other-role" className="label-caps">
                Outro papel
              </label>
              <Input
                id="other-role"
                autoFocus
                maxLength={40}
                value={other}
                placeholder="Ex.: roteiro"
                className="h-10"
                onChange={(event) => {
                  setOther(event.target.value);
                }}
                onBlur={addOther}
              />
            </form>
          ) : (
            <button
              type="button"
              disabled={full}
              onClick={() => {
                setAddingOther(true);
              }}
              className="flex min-h-24 items-center justify-center gap-2.5 rounded-md border border-dashed border-border-control bg-surface text-[0.9375rem] text-muted hover:text-text disabled:cursor-not-allowed disabled:opacity-45 sm:min-h-[8.25rem]"
            >
              <PlusIcon aria-hidden className="size-[1.125rem]" />
              Outro papel
            </button>
          )}
        </div>

        {error && (
          <div className="mt-6">
            <Notice tone="danger">{error}</Notice>
          </div>
        )}

        <div className="mt-auto flex flex-wrap items-center justify-between gap-4 border-t border-border pt-8 max-sm:mt-8">
          <p aria-live="polite" className="text-support text-muted">
            {roles.length} de {MAX_ROLES} selecionados
          </p>
          <div className="flex items-center gap-3.5">
            <Button
              variant="ghost"
              disabled={saving}
              onClick={() => {
                router.push(NEXT_STEP);
              }}
            >
              Pular por agora
            </Button>
            <Button
              size="lg"
              loading={saving}
              disabled={roles.length === 0}
              onClick={() => void save()}
            >
              {saving ? 'Salvando…' : 'Continuar'}
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}
