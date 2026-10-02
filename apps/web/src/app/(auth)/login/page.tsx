'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useForm } from 'react-hook-form';

import { AuthShell } from '@/components/auth/auth-shell';
import { Button } from '@/components/ui/button';
import { Field, fieldAria } from '@/components/ui/field';
import { Input, PasswordInput } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { login } from '@/lib/api/auth';
import { safeNextPath } from '@/lib/auth/next-path';
import { applyApiError } from '@/lib/forms';
import { type LoginInput, loginSchema } from '@casebook/contracts/auth';

import type { z } from 'zod';

type LoginValues = z.input<typeof loginSchema>;

function LoginForm() {
  const router = useRouter();
  // Só rota interna: `?next=` vem da URL e não pode virar redirecionamento para fora.
  const next = safeNextPath(useSearchParams().get('next'));
  const [formError, setFormError] = useState<string>();
  const form = useForm<LoginValues, unknown, LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(undefined);
    try {
      await login(values);
      router.replace(next);
    } catch (error) {
      setFormError(applyApiError(form, error, ['email', 'password']));
      // Sem erro de campo (ex.: 401), o foco volta para a senha, que é o que se redigita.
      if (Object.keys(form.formState.errors).length === 0) form.setFocus('password');
    }
  });

  return (
    <form
      onSubmit={(event) => void onSubmit(event)}
      noValidate
      className="flex flex-col gap-[1.125rem]"
    >
      {formError && <Notice tone="danger">{formError}</Notice>}

      <Field id="email" label="Email" error={errors.email?.message}>
        <Input
          type="email"
          inputMode="email"
          autoComplete="email"
          autoFocus
          {...fieldAria('email', errors.email?.message)}
          {...form.register('email')}
        />
      </Field>

      <Field id="password" label="Senha" error={errors.password?.message}>
        <PasswordInput
          autoComplete="current-password"
          {...fieldAria('password', errors.password?.message)}
          {...form.register('password')}
        />
      </Field>

      <Button type="submit" size="lg" className="mt-2" loading={isSubmitting}>
        {isSubmitting ? 'Entrando…' : 'Entrar'}
      </Button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <AuthShell
      eyebrow="Entrar"
      title="Entre no Casebook"
      lead={
        <>
          Ainda não tem conta?{' '}
          <Link href="/signup" className="link">
            Criar conta
          </Link>
        </>
      }
    >
      {/* useSearchParams exige um limite de Suspense no build. */}
      <Suspense>
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}
