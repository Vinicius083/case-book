import Link from 'next/link';

import { Steps } from '@/components/ui/steps';

import type { ReactNode } from 'react';

interface AuthShellProps {
  eyebrow: string;
  title: string;
  /** Linha sob o título (o atalho para a outra tela de entrada). */
  lead: ReactNode;
  /** Passo do cadastro, quando a tela faz parte dele. */
  step?: { current: number; total: number; label: string };
  children: ReactNode;
}

/**
 * Telas de entrada: painel de citação à esquerda (some em telas estreitas) e
 * formulário à direita. O painel é "mídia": fica escuro nos dois temas.
 */
export function AuthShell({ eyebrow, title, lead, step, children }: AuthShellProps) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_1.05fr]">
      <aside className="bg-quote-panel hidden flex-col justify-between gap-10 p-10 text-content-text lg:flex">
        <Link href="/" className="brand-mark w-fit rounded-sm">
          Casebook
        </Link>
        <figure>
          <blockquote className="max-w-[27.5rem] font-heading text-[2.125rem] leading-[1.24] text-pretty italic">
            “Passei a mandar um link em vez de um WeTransfer de 4 GB. O cliente vê o grade certo, no
            navegador.”
          </blockquote>
          <figcaption className="mt-[1.625rem] text-support text-content-text-secondary">
            Rafael Lins — diretor de fotografia, São Paulo
          </figcaption>
        </figure>
        {step ? <Steps {...step} tone="content" /> : <span />}
      </aside>

      <main className="flex flex-col px-6 py-8 sm:px-12 lg:justify-center lg:px-[4.5rem] lg:py-14">
        <div className="mb-10 flex items-center justify-between gap-4 lg:hidden">
          <Link href="/" className="brand-mark rounded-sm">
            Casebook
          </Link>
          {step && <Steps current={step.current} total={step.total} />}
        </div>
        <div className="my-auto w-full max-w-[30rem] lg:my-0">
          <p className="eyebrow">{eyebrow}</p>
          <h1 className="mt-3 text-[2.125rem] leading-[1.12] tracking-[-0.02em] sm:text-screen">
            {title}
          </h1>
          <p className="mt-2 mb-[1.875rem] text-[0.9375rem] text-text-secondary">{lead}</p>
          {children}
        </div>
      </main>
    </div>
  );
}
