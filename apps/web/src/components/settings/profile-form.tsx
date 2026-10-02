'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { PlusIcon, TrashIcon } from '@phosphor-icons/react/ssr';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { z } from 'zod';

import { FreelanceSwitch, TimeZoneSelect } from '@/components/profile/fields';
import { Button } from '@/components/ui/button';
import { Field, FieldError, fieldAria } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { ApiError } from '@/lib/api/errors';
import { fetchMe, type Me, updateProfile } from '@/lib/api/profile';
import { applyApiError } from '@/lib/forms';
import { ME_QUERY_KEY } from '@/lib/hooks/use-me';
import { cn } from '@/lib/utils';
import {
  BIO_MAX_LENGTH,
  bioSchema,
  displayNameSchema,
  linksSchema,
  LOCATION_MAX_LENGTH,
  locationSchema,
  PROFILE_LINKS_MAX,
  PROFILE_ROLES_MAX,
  rolesSchema,
  type UpdateProfileInput,
  workTimezoneSchema,
} from '@casebook/contracts/profile';

import { TagInput } from './tag-input';

// Os mesmos schemas de campo do PATCH /me/profile; aqui todos presentes, e o
// envio manda só os que mudaram.
const profileFormSchema = z.object({
  display_name: displayNameSchema,
  bio: bioSchema,
  location: locationSchema,
  work_timezone: workTimezoneSchema,
  available_for_freelance: z.boolean(),
  roles: rolesSchema,
  links: linksSchema,
});

type ProfileValues = z.input<typeof profileFormSchema>;
type ProfileOutput = z.output<typeof profileFormSchema>;

const FIELDS = [
  'display_name',
  'bio',
  'location',
  'work_timezone',
  'available_for_freelance',
  'roles',
  'links',
] as const;

function toValues({ me }: Me): ProfileValues {
  const { profile } = me;
  return {
    display_name: profile.display_name,
    bio: profile.bio ?? '',
    location: profile.location ?? '',
    work_timezone: profile.work_timezone ?? '',
    available_for_freelance: profile.available_for_freelance,
    roles: profile.roles,
    links: profile.links,
  };
}

/** Só os campos cujo valor difere do que o servidor tem. */
function changedFields(values: ProfileOutput, { me }: Me): UpdateProfileInput {
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  return Object.fromEntries(
    FIELDS.filter((field) => !same(values[field], me.profile[field])).map((field) => [
      field,
      values[field],
    ]),
  );
}

export function ProfileForm({ me }: { me: Me }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<
    { kind: 'saved' | 'unchanged' | 'conflict' } | { kind: 'error'; message: string }
  >();
  const form = useForm<ProfileValues, unknown, ProfileOutput>({
    resolver: zodResolver(profileFormSchema),
    defaultValues: toValues(me),
  });
  const { errors, isSubmitting } = form.formState;
  const links = useFieldArray({ control: form.control, name: 'links' });
  const bioLength = (form.watch('bio') ?? '').length;
  const linksError = errors.links?.message ?? errors.links?.root?.message;

  const onSubmit = form.handleSubmit(async (values) => {
    setStatus(undefined);
    // O ETag é o da última leitura do servidor, não o da montagem do formulário.
    const current = queryClient.getQueryData<Me>(ME_QUERY_KEY) ?? me;
    const patch = changedFields(values, current);
    if (Object.keys(patch).length === 0) {
      setStatus({ kind: 'unchanged' });
      return;
    }

    try {
      const updated = await updateProfile(patch, current.etag);
      queryClient.setQueryData(ME_QUERY_KEY, updated);
      form.reset(toValues(updated));
      setStatus({ kind: 'saved' });
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setStatus({ kind: 'conflict' });
        return;
      }
      const message = applyApiError(form, error, FIELDS);
      if (message) setStatus({ kind: 'error', message });
    }
  });

  const reloadFromServer = async () => {
    const fresh = await fetchMe();
    queryClient.setQueryData(ME_QUERY_KEY, fresh);
    form.reset(toValues(fresh));
    setStatus(undefined);
  };

  return (
    <form onSubmit={(event) => void onSubmit(event)} noValidate className="flex flex-col gap-5">
      <Field id="display_name" label="Nome de exibição" error={errors.display_name?.message}>
        <Input
          autoComplete="name"
          {...fieldAria('display_name', errors.display_name?.message)}
          {...form.register('display_name')}
        />
      </Field>

      <Field
        id="bio"
        label="Bio"
        error={errors.bio?.message}
        hint="Texto simples: quebras de linha são mantidas, formatação não."
        aside={
          <span
            className={cn('text-caption text-muted', bioLength > BIO_MAX_LENGTH && 'text-danger')}
            aria-label={`${String(bioLength)} de ${String(BIO_MAX_LENGTH)} caracteres`}
          >
            {bioLength}/{BIO_MAX_LENGTH}
          </span>
        }
      >
        <Textarea {...fieldAria('bio', errors.bio?.message, true)} {...form.register('bio')} />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2 sm:gap-4">
        <Field
          id="location"
          label="Localização"
          error={errors.location?.message}
          hint="Cidade e estado ou país."
        >
          <Input
            maxLength={LOCATION_MAX_LENGTH + 20}
            autoComplete="address-level2"
            {...fieldAria('location', errors.location?.message, true)}
            {...form.register('location')}
          />
        </Field>

        <Field id="work_timezone" label="Fuso de trabalho" error={errors.work_timezone?.message}>
          <Controller
            control={form.control}
            name="work_timezone"
            render={({ field }) => (
              <TimeZoneSelect
                value={field.value ?? ''}
                onChange={field.onChange}
                {...fieldAria('work_timezone', errors.work_timezone?.message)}
              />
            )}
          />
        </Field>
      </div>

      <Controller
        control={form.control}
        name="available_for_freelance"
        render={({ field }) => <FreelanceSwitch checked={field.value} onChange={field.onChange} />}
      />

      <Field
        id="roles"
        label="Papéis na produção"
        error={errors.roles?.message ?? errors.roles?.root?.message}
        hint={`Montagem, cor, direção… Enter adiciona. Até ${String(PROFILE_ROLES_MAX)}.`}
      >
        <Controller
          control={form.control}
          name="roles"
          render={({ field }) => (
            <TagInput
              value={field.value}
              onChange={field.onChange}
              max={PROFILE_ROLES_MAX}
              placeholder="Ex.: colorista"
              {...fieldAria('roles', errors.roles?.message, true)}
            />
          )}
        />
      </Field>

      <fieldset className="flex flex-col gap-3">
        <legend className="label-caps mb-3">Links externos</legend>
        {links.fields.length === 0 && (
          <p className="text-support text-muted">Nenhum link. Adicione seu site, Vimeo, IMDb…</p>
        )}
        {links.fields.map((link, index) => {
          const error = errors.links?.[index];
          return (
            <div key={link.id} className="grid gap-3 sm:grid-cols-[12rem_1fr_auto] sm:items-start">
              <Field
                id={`links.${String(index)}.label`}
                label="Rótulo"
                error={error?.label?.message}
              >
                <Input
                  placeholder="Vimeo"
                  {...fieldAria(`links.${String(index)}.label`, error?.label?.message)}
                  // O RHF tipa o path com o índice numérico.
                  // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
                  {...form.register(`links.${index}.label`)}
                />
              </Field>
              <Field id={`links.${String(index)}.url`} label="Endereço" error={error?.url?.message}>
                <Input
                  type="url"
                  inputMode="url"
                  placeholder="https://"
                  {...fieldAria(`links.${String(index)}.url`, error?.url?.message)}
                  // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
                  {...form.register(`links.${index}.url`)}
                />
              </Field>
              <Button
                variant="ghost"
                size="icon"
                className="sm:mt-[1.625rem]"
                aria-label={`Remover link ${String(index + 1)}`}
                onClick={() => {
                  links.remove(index);
                }}
              >
                <TrashIcon aria-hidden weight="duotone" />
              </Button>
            </div>
          );
        })}
        {linksError && <FieldError>{linksError}</FieldError>}
        <Button
          variant="secondary"
          size="sm"
          className="w-fit"
          disabled={links.fields.length >= PROFILE_LINKS_MAX}
          onClick={() => {
            links.append({ label: '', url: '' });
          }}
        >
          <PlusIcon aria-hidden /> Adicionar link
        </Button>
        {links.fields.length >= PROFILE_LINKS_MAX && (
          <p className="text-support text-muted">Limite de {PROFILE_LINKS_MAX} links.</p>
        )}
      </fieldset>

      <p className="text-support text-muted">
        Foto de perfil: o envio de imagens chega com a biblioteca de mídia.
      </p>

      {status?.kind === 'conflict' && (
        <Notice tone="danger" className="flex flex-col items-start gap-3">
          <span>
            O perfil foi alterado em outra aba ou dispositivo depois que você abriu esta página.
            Nada foi salvo. Recarregue os dados do servidor e refaça a edição.
          </span>
          <Button variant="secondary" size="sm" onClick={() => void reloadFromServer()}>
            Recarregar dados do servidor
          </Button>
        </Notice>
      )}
      {status?.kind === 'error' && <Notice tone="danger">{status.message}</Notice>}
      {status?.kind === 'saved' && <Notice tone="success">Perfil salvo.</Notice>}
      {status?.kind === 'unchanged' && (
        <Notice tone="info">Nada mudou desde o último salvamento.</Notice>
      )}

      <Button type="submit" className="w-fit" loading={isSubmitting}>
        {isSubmitting ? 'Salvando…' : 'Salvar perfil'}
      </Button>
    </form>
  );
}
