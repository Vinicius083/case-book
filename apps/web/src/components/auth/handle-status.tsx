import { cn } from '@/lib/utils';

import type { HandleCheck } from '@/lib/hooks/use-handle-availability';

const MESSAGES: Record<Exclude<HandleCheck, 'idle'>, { text: string; tone: string }> = {
  checking: { text: 'Conferindo disponibilidade…', tone: 'text-muted' },
  available: { text: 'Disponível', tone: 'text-accent-text' },
  taken: { text: 'Já está em uso. Escolha outro.', tone: 'text-danger' },
  reserved: {
    text: 'Reservado: este endereço é do Casebook ou está guardado para quem o usava.',
    tone: 'text-danger',
  },
  invalid: {
    text: 'Use de 3 a 30 caracteres: letras minúsculas, números e hífen, sem começar por hífen.',
    tone: 'text-danger',
  },
  unknown: {
    text: 'Não deu para conferir agora. A disponibilidade é checada ao enviar.',
    tone: 'text-muted',
  },
};

/** Resultado da checagem de handle em tempo real, anunciado a leitores de tela. */
export function HandleStatus({ id, check }: { id: string; check: HandleCheck }) {
  const message = check === 'idle' ? undefined : MESSAGES[check];
  return (
    <p id={id} aria-live="polite" className={cn('min-h-[1.375rem] text-support', message?.tone)}>
      {message?.text}
    </p>
  );
}

/** A checagem diz que este handle não pode ser usado? */
export function isHandleBlocked(check: HandleCheck): boolean {
  return check === 'taken' || check === 'reserved' || check === 'invalid';
}
