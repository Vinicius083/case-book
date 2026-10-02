'use client';

import { CheckCircleIcon, InfoIcon, WarningCircleIcon, XIcon } from '@phosphor-icons/react/ssr';
import { useEffect } from 'react';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

import { cn } from '@/lib/utils';

type ToastTone = 'info' | 'success' | 'danger';

interface ToastItem {
  id: number;
  tone: ToastTone;
  message: string;
}

const DURATION_MS = 6_000;
let nextId = 1;

// Fora do React: qualquer código (um handler, o cliente HTTP) pode avisar.
const toastStore = createStore<{ toasts: ToastItem[] }>(() => ({ toasts: [] }));

/** Mostra um aviso passageiro no canto da tela. Para erro de formulário, use `Notice`. */
export function toast(message: string, tone: ToastTone = 'info'): void {
  toastStore.setState(({ toasts }) => ({ toasts: [...toasts, { id: nextId++, tone, message }] }));
}

function dismiss(id: number): void {
  toastStore.setState(({ toasts }) => ({ toasts: toasts.filter((item) => item.id !== id) }));
}

const tones = {
  info: { icon: 'text-muted', Icon: InfoIcon },
  success: { icon: 'text-accent-text', Icon: CheckCircleIcon },
  danger: { icon: 'text-danger', Icon: WarningCircleIcon },
} as const;

function Toast({ item }: { item: ToastItem }) {
  const { icon, Icon } = tones[item.tone];

  // Erro fica até ser fechado: pode ser a única explicação do que falhou.
  useEffect(() => {
    if (item.tone === 'danger') return;
    const timer = setTimeout(() => {
      dismiss(item.id);
    }, DURATION_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [item]);

  return (
    <li
      role={item.tone === 'danger' ? 'alert' : 'status'}
      className="flex items-start gap-3 rounded-md border border-border bg-surface py-3 pr-2 pl-4 text-support shadow-menu"
    >
      <Icon aria-hidden weight="duotone" className={cn('mt-0.5 size-[1.125rem] shrink-0', icon)} />
      <span className="min-w-0 flex-1 py-px">{item.message}</span>
      <button
        type="button"
        aria-label="Fechar aviso"
        className="rounded-md p-1.5 text-muted hover:text-text"
        onClick={() => {
          dismiss(item.id);
        }}
      >
        <XIcon aria-hidden className="size-3.5" />
      </button>
    </li>
  );
}

/** Onde os toasts aparecem. Uma vez, no layout raiz. */
export function Toaster() {
  const toasts = useStore(toastStore, (state) => state.toasts);
  return (
    <ul
      aria-label="Avisos"
      className="pointer-events-none fixed inset-x-4 bottom-20 z-50 flex flex-col gap-2 sm:inset-x-auto sm:right-6 sm:bottom-6 sm:w-[22.5rem] [&>li]:pointer-events-auto"
    >
      {toasts.map((item) => (
        <Toast key={item.id} item={item} />
      ))}
    </ul>
  );
}
