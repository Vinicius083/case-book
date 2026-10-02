import type { ReactNode } from 'react';

interface PageHeaderProps {
  /** Linha pequena acima do título: a que seção a página pertence. */
  eyebrow?: string;
  title: string;
  /** Ação principal da página, à direita. */
  action?: ReactNode;
  /** Abaixo do título, colado na borda inferior (abas). */
  children?: ReactNode;
}

/** Cabeçalho de página do app: eyebrow, título e ação, como no dashboard do design. */
export function PageHeader({ eyebrow, title, action, children }: PageHeaderProps) {
  return (
    <header
      className={children ? 'px-5 pt-6 md:px-10' : 'border-b border-border px-5 py-6 md:px-10'}
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          {eyebrow && <p className="eyebrow">{eyebrow}</p>}
          <h1
            className={`text-[1.875rem] leading-[1.12] tracking-[-0.02em] md:text-page ${eyebrow ? 'mt-2' : ''}`}
          >
            {title}
          </h1>
        </div>
        {action}
      </div>
      {children && <div className="mt-[1.375rem]">{children}</div>}
    </header>
  );
}
