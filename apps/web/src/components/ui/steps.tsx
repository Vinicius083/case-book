import { cn } from '@/lib/utils';

interface StepsProps {
  current: number;
  total: number;
  /** Nome do passo atual ("criar conta"). */
  label?: string;
  /** `content`: sobre painel de mídia (sempre escuro), fora do tema da UI. */
  tone?: 'ui' | 'content';
  className?: string;
}

const tones = {
  ui: { text: 'text-muted', done: 'bg-accent-text', todo: 'bg-track' },
  content: {
    text: 'text-content-muted',
    done: 'bg-content-accent-text',
    todo: 'bg-content-border',
  },
} as const;

/** Progresso de um fluxo em etapas: uma barra por etapa e "2 de 3" em texto. */
export function Steps({ current, total, label, tone = 'ui', className }: StepsProps) {
  const { text, done, todo } = tones[tone];
  return (
    <p className={cn('flex items-center gap-2 text-caption', text, className)}>
      <span aria-hidden className="flex gap-1.5">
        {Array.from({ length: total }, (_, index) => (
          <span key={index} className={cn('h-0.5 w-6', index < current ? done : todo)} />
        ))}
      </span>
      <span>
        {current} de {total}
        {label && ` — ${label}`}
      </span>
    </p>
  );
}
