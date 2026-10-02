import { passwordStrength } from '@/lib/password-strength';
import { cn } from '@/lib/utils';

const TONES = ['', 'bg-danger', 'bg-fg/60', 'bg-accent/70', 'bg-accent'] as const;

/** Quatro segmentos + rótulo. A força é anunciada sem interromper a digitação. */
export function PasswordStrengthMeter({ password }: { password: string }) {
  const { score, label } = passwordStrength(password);

  return (
    <div className="flex items-center gap-3" aria-live="polite">
      <div className="flex flex-1 gap-1" aria-hidden>
        {[1, 2, 3, 4].map((step) => (
          <span
            key={step}
            className={cn('h-1 flex-1 rounded-full bg-divider', step <= score && TONES[score])}
          />
        ))}
      </div>
      <span className="w-20 text-right text-sm text-muted">
        {score > 0 && <span className="sr-only">Força da senha: </span>}
        {label}
      </span>
    </div>
  );
}
