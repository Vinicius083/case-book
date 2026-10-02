'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';

import { FreelanceSwitch, TimeZoneSelect } from '@/components/profile/fields';
import { ProfilePreview } from '@/components/profile/profile-preview';
import { usePublicAddress } from '@/components/public-url';
import { TagInput } from '@/components/settings/tag-input';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Field, fieldAria } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { Steps } from '@/components/ui/steps';
import { type Me, updateProfile } from '@/lib/api/profile';
import { applyApiError } from '@/lib/forms';
import { ME_QUERY_KEY, useMe } from '@/lib/hooks/use-me';
import { cn } from '@/lib/utils';
import {
  BIO_MAX_LENGTH,
  bioSchema,
  LOCATION_MAX_LENGTH,
  locationSchema,
  PROFILE_ROLES_MAX,
  rolesSchema,
  type UpdateProfileInput,
  workTimezoneSchema,
} from '@casebook/contracts/profile';

const FORM_ID = 'onboarding-profile';
const FIELDS = ['bio', 'location', 'work_timezone', 'available_for_freelance', 'roles'] as const;

// Os mesmos schemas de campo do PATCH /me/profile.
const formSchema = z.object({
  bio: bioSchema,
  location: locationSchema,
  work_timezone: workTimezoneSchema,
  available_for_freelance: z.boolean(),
  roles: rolesSchema,
});

type FormValues = z.input<typeof formSchema>;
type FormOutput = z.output<typeof formSchema>;

function ProfileStep({ me }: { me: Me }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const address = usePublicAddress();
  const [formError, setFormError] = useState<string>();
  const [skipping, setSkipping] = useState(false);
  const { profile } = me.me;
  const form = useForm<FormValues, unknown, FormOutput>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      bio: profile.bio ?? '',
      location: profile.location ?? '',
      work_timezone: profile.work_timezone ?? '',
      available_for_freelance: profile.available_for_freelance,
      roles: profile.roles,
    },
  });
  const { errors, isSubmitting } = form.formState;
  const values = form.watch();
  const bioLength = (values.bio ?? '').length;

  /** Grava o que foi preenchido (ou nada, ao pular) e encerra o onboarding. */
  const finish = async (patch: UpdateProfileInput) => {
    setFormError(undefined);
    const current = queryClient.getQueryData<Me>(ME_QUERY_KEY) ?? me;
    try {
      const updated = await updateProfile({ ...patch, onboarding_completed: true }, current.etag);
      queryClient.setQueryData(ME_QUERY_KEY, updated);
      router.replace('/app');
    } catch (error) {
      setFormError(applyApiError(form, error, FIELDS));
    }
  };

  const onSubmit = form.handleSubmit((output) => finish(output));

  return (
    <div className="flex min-h-dvh flex-col">
      <title>Seu perfil — Casebook</title>
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-border px-6 py-4 sm:px-10">
        <span className="brand-mark">Casebook</span>
        <Steps current={3} total={3} label="seu perfil" />
        <div className="flex items-center gap-2 max-sm:w-full max-sm:justify-between">
          <Button
            variant="ghost"
            size="sm"
            loading={skipping}
            disabled={isSubmitting}
            onClick={() => {
              setSkipping(true);
              void finish({}).finally(() => {
                setSkipping(false);
              });
            }}
          >
            Pular por agora
          </Button>
          <Button type="submit" form={FORM_ID} loading={isSubmitting} disabled={skipping}>
            {isSubmitting ? 'Salvando…' : 'Salvar e entrar'}
          </Button>
        </div>
      </header>

      <div className="grid flex-1 lg:grid-cols-[1fr_1.15fr]">
        <main className="px-6 py-8 sm:p-10">
          <form
            id={FORM_ID}
            onSubmit={(event) => void onSubmit(event)}
            noValidate
            className="flex max-w-[35rem] flex-col gap-6"
          >
            <div>
              <h1 className="text-section sm:text-[2rem]">Monte seu perfil</h1>
              <p className="mt-1.5 text-support text-muted">
                <span className="max-lg:hidden">
                  Tudo o que você escreve aparece na hora no preview.{' '}
                </span>
                Dá para mudar depois nas configurações.
              </p>
            </div>

            {formError && <Notice tone="danger">{formError}</Notice>}

            <div className="flex items-center gap-[1.125rem]">
              <Avatar name={profile.display_name} className="size-[4.75rem] text-[1.625rem]" />
              <p className="text-support text-muted">
                Foto de perfil: o envio de imagens chega com a biblioteca de mídia.
              </p>
            </div>

            <Field
              id="bio"
              label="Bio"
              error={errors.bio?.message}
              aside={
                <span
                  className={cn(
                    'text-caption text-muted',
                    bioLength > BIO_MAX_LENGTH && 'text-danger',
                  )}
                  aria-label={`${String(bioLength)} de ${String(BIO_MAX_LENGTH)} caracteres`}
                >
                  {bioLength}/{BIO_MAX_LENGTH}
                </span>
              }
            >
              <Textarea {...fieldAria('bio', errors.bio?.message)} {...form.register('bio')} />
            </Field>

            <Field
              id="roles"
              label="Papéis na produção"
              error={errors.roles?.message ?? errors.roles?.root?.message}
              hint={`Enter adiciona. Até ${String(PROFILE_ROLES_MAX)}.`}
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

            <div className="grid gap-6 sm:grid-cols-2 sm:gap-4">
              <Field id="location" label="Localização" error={errors.location?.message}>
                <Input
                  maxLength={LOCATION_MAX_LENGTH + 20}
                  autoComplete="address-level2"
                  placeholder="São Paulo, BR"
                  {...fieldAria('location', errors.location?.message)}
                  {...form.register('location')}
                />
              </Field>
              <Field
                id="work_timezone"
                label="Fuso de trabalho"
                error={errors.work_timezone?.message}
              >
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
              render={({ field }) => (
                <FreelanceSwitch checked={field.value} onChange={field.onChange} />
              )}
            />
          </form>
        </main>

        <aside className="hidden border-l border-border bg-well p-[1.625rem] lg:block">
          <ProfilePreview
            address={address(me.me.handle).text}
            profile={{
              display_name: profile.display_name,
              bio: (values.bio ?? '').trim() || null,
              location: (values.location ?? '').trim() || null,
              work_timezone: values.work_timezone ?? null,
              available_for_freelance: values.available_for_freelance,
              roles: values.roles,
            }}
          />
        </aside>
      </div>
    </div>
  );
}

export default function OnboardingProfilePage() {
  const me = useMe();
  // O `OnboardingGate` do layout só monta a página com o perfil já carregado.
  return me.data ? <ProfileStep me={me.data} /> : null;
}
