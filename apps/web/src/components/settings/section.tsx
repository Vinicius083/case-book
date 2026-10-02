import type { ReactNode } from 'react';

interface SectionProps {
  id: string;
  title: string;
  description?: ReactNode;
  children: ReactNode;
}

/** Grupo de uma aba de configurações: título em eyebrow, como "Dados do perfil" no design. */
export function SettingsSection({ id, title, description, children }: SectionProps) {
  return (
    <section aria-labelledby={`${id}-title`} className="flex max-w-2xl flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h2 id={`${id}-title`} className="eyebrow font-sans font-normal">
          {title}
        </h2>
        {description && <p className="text-support text-text-secondary">{description}</p>}
      </div>
      {children}
    </section>
  );
}
