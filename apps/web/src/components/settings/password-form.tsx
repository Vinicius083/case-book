'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { PasswordStrengthMeter } from '@/components/auth/password-strength';
import { Button } from '@/components/ui/button';
import { Field, fieldAria } from '@/components/ui/field';
import { PasswordInput } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { changePassword } from '@/lib/api/profile';
import { applyApiError } from '@/lib/forms';
import { type ChangePasswordInput, changePasswordSchema } from '@casebook/contracts/profile';

export function PasswordForm({ email }: { email: string }) {
  const [status, setStatus] = useState<{ kind: 'saved' } | { kind: 'error'; message: string }>();
  const form = useForm<ChangePasswordInput>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { current_password: '', new_password: '' },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setStatus(undefined);
    try {
      await changePassword(values);
      form.reset();
      setStatus({ kind: 'saved' });
    } catch (error) {
      const message = applyApiError(form, error, ['current_password', 'new_password']);
      if (message) setStatus({ kind: 'error', message });
    }
  });

  return (
    <form onSubmit={(event) => void onSubmit(event)} noValidate className="flex flex-col gap-5">
      {/* Para o gerenciador de senhas saber de qual conta é a senha nova. */}
      <input type="text" name="username" autoComplete="username" value={email} readOnly hidden />

      <Field id="current_password" label="Senha atual" error={errors.current_password?.message}>
        <PasswordInput
          revealLabel="Mostrar senha atual"
          hideLabel="Ocultar senha atual"
          autoComplete="current-password"
          {...fieldAria('current_password', errors.current_password?.message)}
          {...form.register('current_password')}
        />
      </Field>

      <Field
        id="new_password"
        label="Nova senha"
        error={errors.new_password?.message}
        hint="De 10 a 128 caracteres."
      >
        <PasswordInput
          revealLabel="Mostrar nova senha"
          hideLabel="Ocultar nova senha"
          autoComplete="new-password"
          {...fieldAria('new_password', errors.new_password?.message, true)}
          {...form.register('new_password')}
        />
        <PasswordStrengthMeter password={form.watch('new_password')} />
      </Field>

      {status?.kind === 'error' && <Notice tone="danger">{status.message}</Notice>}
      {status?.kind === 'saved' && (
        <Notice tone="success">Senha trocada. As outras sessões foram encerradas.</Notice>
      )}

      <Button type="submit" variant="secondary" className="w-fit" loading={isSubmitting}>
        {isSubmitting ? 'Trocando…' : 'Trocar senha'}
      </Button>
    </form>
  );
}
