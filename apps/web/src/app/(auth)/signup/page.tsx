'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { AuthShell } from '@/components/auth/auth-shell';
import { HandleStatus, isHandleBlocked } from '@/components/auth/handle-status';
import { PasswordStrengthMeter } from '@/components/auth/password-strength';
import { ProfileFrame } from '@/components/auth/profile-frame';
import { Button } from '@/components/ui/button';
import { Field, fieldAria } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { signup } from '@/lib/api/auth';
import { applyApiError } from '@/lib/forms';
import { useHandleAvailability } from '@/lib/hooks/use-handle-availability';
import { type SignupInput, signupSchema } from '@casebook/contracts/auth';
import { normalizeHandle } from '@casebook/contracts/handle';

import type { z } from 'zod';

type SignupValues = z.input<typeof signupSchema>;

export default function SignupPage() {
  const router = useRouter();
  const [formError, setFormError] = useState<string>();
  const form = useForm<SignupValues, unknown, SignupInput>({
    resolver: zodResolver(signupSchema),
    defaultValues: { email: '', password: '', display_name: '', handle: '' },
  });
  const { errors, isSubmitting } = form.formState;

  const [displayName, rawHandle, password] = form.watch(['display_name', 'handle', 'password']);
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
      router.replace('/app');
    } catch (error) {
      setFormError(applyApiError(form, error, ['email', 'password', 'display_name', 'handle']));
    }
  });

  return (
    <AuthShell
      title="Crie sua conta"
      aside={
        <ProfileFrame title={displayName.trim() || 'Seu nome'}>
          casebook.app/u/{handle || 'seu-handle'}
        </ProfileFrame>
      }
    >
      <form onSubmit={(event) => void onSubmit(event)} noValidate className="flex flex-col gap-5">
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
          <Input
            type="password"
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
          <p id="handle-preview" className="text-sm text-muted">
            Seu endereço público:{' '}
            <span className="break-all text-fg">casebook.app/u/{handle || 'seu-handle'}</span>
          </p>
        </Field>

        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Criando conta…' : 'Criar conta'}
        </Button>
      </form>

      <p className="text-sm text-muted">
        Já tem conta?{' '}
        <Link href="/login" className="text-fg underline underline-offset-4">
          Entrar
        </Link>
      </p>
    </AuthShell>
  );
}
