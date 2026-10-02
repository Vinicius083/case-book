import Link from 'next/link';

import type { ReactNode } from 'react';

interface AuthShellProps {
  title: string;
  /** Painel ao lado do formulário (some em telas estreitas). */
  aside: ReactNode;
  children: ReactNode;
}

export function AuthShell({ title, aside, children }: AuthShellProps) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,30rem)_1fr]">
      <main className="flex flex-col gap-10 px-6 py-10 sm:px-12">
        <Link href="/" className="font-heading w-fit text-lg font-bold">
          Casebook
        </Link>
        <div className="my-auto flex flex-col gap-8">
          <h1 className="font-heading text-3xl leading-tight font-bold">{title}</h1>
          {children}
        </div>
      </main>
      <aside className="hidden items-center justify-center border-l border-divider bg-surface p-12 lg:flex">
        {aside}
      </aside>
    </div>
  );
}
