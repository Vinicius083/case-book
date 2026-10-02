'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { HandleStatus, isHandleBlocked } from '@/components/auth/handle-status';
import { Button } from '@/components/ui/button';
import { Field, fieldAria } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { changeHandle, type Me } from '@/lib/api/profile';
import { applyApiError } from '@/lib/forms';
import { useHandleAvailability } from '@/lib/hooks/use-handle-availability';
import { ME_QUERY_KEY } from '@/lib/hooks/use-me';
import { normalizeHandle } from '@casebook/contracts/handle';
import { type ChangeHandleInput, changeHandleSchema } from '@casebook/contracts/profile';

import type { z } from 'zod';

type HandleValues = z.input<typeof changeHandleSchema>;

const dateFormat = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long' });

export function HandleForm({ me }: { me: Me }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<{ kind: 'saved' } | { kind: 'error'; message: string }>();
  const form = useForm<HandleValues, unknown, ChangeHandleInput>({
    resolver: zodResolver(changeHandleSchema),
    defaultValues: { handle: '' },
  });
  const { errors, isSubmitting } = form.formState;

  const current = me.me.handle;
  const rawHandle = form.watch('handle');
  const check = useHandleAvailability(rawHandle, current);
  const allowedAt = me.me.handle_change_allowed_at;

  const onSubmit = form.handleSubmit(async ({ handle }) => {
    setStatus(undefined);
    if (handle === current) {
      form.setError('handle', { message: 'Este já é o seu handle.' });
      return;
    }
    if (isHandleBlocked(check)) {
      form.setFocus('handle');
      return;
    }
    try {
      queryClient.setQueryData(ME_QUERY_KEY, await changeHandle(handle));
      form.reset({ handle: '' });
      setStatus({ kind: 'saved' });
    } catch (error) {
      const message = applyApiError(form, error, ['handle']);
      if (message) setStatus({ kind: 'error', message });
    }
  });

  return (
    <form
      onSubmit={(event) => void onSubmit(event)}
      noValidate
      className="flex max-w-2xl flex-col gap-5"
    >
      <p>
        Seu endereço hoje: <span className="font-semibold break-all">casebook.app/u/{current}</span>
      </p>

      <ul className="flex max-w-prose list-disc flex-col gap-1.5 pl-5 leading-relaxed text-muted">
        <li>Você pode trocar de handle uma vez a cada 30 dias.</li>
        <li>
          O handle antigo fica reservado para você por 30 dias: ninguém mais pode usá-lo, e você
          pode voltar a ele quando quiser nesse período.
        </li>
        <li>Links para o endereço antigo deixam de funcionar assim que você troca.</li>
      </ul>

      {allowedAt && (
        <Notice tone="info">
          Próxima troca permitida a partir de {dateFormat.format(new Date(allowedAt))}. Até lá, só é
          possível voltar ao seu handle anterior.
        </Notice>
      )}

      <Field id="new-handle" label="Novo handle" error={errors.handle?.message}>
        <Input
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          {...fieldAria('new-handle', errors.handle?.message)}
          aria-describedby={errors.handle ? 'new-handle-error' : 'new-handle-status'}
          {...form.register('handle')}
        />
        {!errors.handle && <HandleStatus id="new-handle-status" check={check} />}
        {normalizeHandle(rawHandle) !== '' && (
          <p className="text-sm text-muted">
            Novo endereço:{' '}
            <span className="break-all text-fg">casebook.app/u/{normalizeHandle(rawHandle)}</span>
          </p>
        )}
      </Field>

      {status?.kind === 'error' && <Notice tone="danger">{status.message}</Notice>}
      {status?.kind === 'saved' && <Notice tone="success">Handle trocado.</Notice>}

      <Button type="submit" variant="secondary" className="w-fit" disabled={isSubmitting}>
        {isSubmitting ? 'Trocando…' : 'Trocar handle'}
      </Button>
    </form>
  );
}
