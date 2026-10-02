import { passwordStrength } from '@/lib/password-strength';
import { cn } from '@/lib/utils';

const TONES = ['', 'bg-danger', 'bg-muted', 'bg-accent', 'bg-accent-text'] as const;

/** Quatro segmentos + rótulo. A força é anunciada sem interromper a digitação. */
export function PasswordStrengthMeter({ password }: { password: string }) {
  const { score, label } = passwordStrength(password);

  return (
    <div className="flex items-center gap-3" aria-live="polite">
      <div className="flex flex-1 gap-1.5" aria-hidden>
        {[1, 2, 3, 4].map((step) => (
          <span key={step} className={cn('h-0.5 flex-1 bg-track', step <= score && TONES[score])} />
        ))}
      </div>
      <span className="w-20 text-right text-caption text-muted">
        {score > 0 && <span className="sr-only">Força da senha: </span>}
        {label}
      </span>
    </div>
  );
}
