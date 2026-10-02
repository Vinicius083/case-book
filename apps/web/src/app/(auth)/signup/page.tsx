'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { AuthShell } from '@/components/auth/auth-shell';
import { HandleStatus, isHandleBlocked } from '@/components/auth/handle-status';
import { PasswordStrengthMeter } from '@/components/auth/password-strength';
import { usePublicAddress } from '@/components/public-url';
import { Button } from '@/components/ui/button';
import { Field, fieldAria } from '@/components/ui/field';
import { Input, PasswordInput } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { signup } from '@/lib/api/auth';
import { applyApiError } from '@/lib/forms';
import { useHandleAvailability } from '@/lib/hooks/use-handle-availability';
import { type SignupInput, signupSchema } from '@casebook/contracts/auth';
import { normalizeHandle } from '@casebook/contracts/handle';

import type { z } from 'zod';

type SignupValues = z.input<typeof signupSchema>;

// Passo 1 de 3. A conta passa a existir aqui; papel e perfil (passos 2 e 3) são
// onboarding, já com sessão, e podem ser pulados.
export default function SignupPage() {
  const router = useRouter();
  const address = usePublicAddress();
  const [formError, setFormError] = useState<string>();
  const form = useForm<SignupValues, unknown, SignupInput>({
    resolver: zodResolver(signupSchema),
    defaultValues: { email: '', password: '', display_name: '', handle: '' },
  });
  const { errors, isSubmitting } = form.formState;

  const [rawHandle, password] = form.watch(['handle', 'password']);
  const handle = normalizeHandle(rawHandle);
  const handleCheck = useHandleAvailability(rawHandle);

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(undefined);
    if (isHandleBlocked(handleCheck)) {
      form.setFocus('handle');
      return;
    }
    try {
      await signup(values);
      router.replace('/onboarding/role');
    } catch (error) {
      setFormError(applyApiError(form, error, ['email', 'password', 'display_name', 'handle']));
    }
  });

  return (
    <AuthShell
      eyebrow="Criar conta"
      title="Comece pelo seu nome."
      lead={
        <>
          Já tem conta?{' '}
          <Link href="/login" className="link">
            Entrar
          </Link>
        </>
      }
      step={{ current: 1, total: 3, label: 'criar conta' }}
    >
      <form
        onSubmit={(event) => void onSubmit(event)}
        noValidate
        className="flex flex-col gap-[1.125rem]"
      >
        {formError && <Notice tone="danger">{formError}</Notice>}

        <Field id="display_name" label="Nome de exibição" error={errors.display_name?.message}>
          <Input
            autoComplete="name"
            autoFocus
            {...fieldAria('display_name', errors.display_name?.message)}
            {...form.register('display_name')}
          />
        </Field>

        <Field id="email" label="Email" error={errors.email?.message}>
          <Input
            type="email"
            inputMode="email"
            autoComplete="email"
            {...fieldAria('email', errors.email?.message)}
            {...form.register('email')}
          />
        </Field>

        <Field
          id="password"
          label="Senha"
          error={errors.password?.message}
          hint="De 10 a 128 caracteres. Uma frase longa vale mais que símbolos."
        >
          <PasswordInput
            autoComplete="new-password"
            {...fieldAria('password', errors.password?.message, true)}
            {...form.register('password')}
          />
          <PasswordStrengthMeter password={password} />
        </Field>

        <Field id="handle" label="Handle" error={errors.handle?.message}>
          <Input
            // `username`: é o identificador público da conta, o que gerenciadores de senha guardam.
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            {...fieldAria('handle', errors.handle?.message)}
            aria-describedby={errors.handle ? 'handle-error' : 'handle-status handle-preview'}
            {...form.register('handle')}
          />
          {!errors.handle && <HandleStatus id="handle-status" check={handleCheck} />}
          <p id="handle-preview" className="text-support text-muted">
            Seu endereço público:{' '}
            <span className="break-all text-text">{address(handle || 'seu-handle').text}</span>
          </p>
        </Field>

        <Button type="submit" size="lg" className="mt-2" loading={isSubmitting}>
          {isSubmitting ? 'Criando conta…' : 'Continuar'}
        </Button>
      </form>
    </AuthShell>
  );
}
