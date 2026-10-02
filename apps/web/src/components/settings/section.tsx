import type { ReactNode } from 'react';

interface SectionProps {
  id: string;
  title: string;
  description?: ReactNode;
  children: ReactNode;
}

export function SettingsSection({ id, title, description, children }: SectionProps) {
  return (
    <section
      aria-labelledby={`${id}-title`}
      className="flex flex-col gap-6 border-t border-divider pt-8"
    >
      <div className="flex flex-col gap-2">
        <h2 id={`${id}-title`} className="font-heading text-xl font-bold">
          {title}
        </h2>
        {description && <p className="max-w-prose leading-relaxed text-muted">{description}</p>}
      </div>
      {children}
    </section>
  );
}
