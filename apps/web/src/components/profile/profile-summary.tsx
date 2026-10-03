import { timeZoneOffset } from '@/lib/time-zones';
import { cn } from '@/lib/utils';

export interface ProfileSummaryData {
  display_name: string;
  /** Foto de perfil (derivativo pequeno); sem ela, o fundo de mídia ausente. */
  avatar_url?: string | null | undefined;
  bio: string | null;
  location: string | null;
  work_timezone: string | null;
  available_for_freelance: boolean;
  roles: readonly string[];
}

interface ProfileSummaryProps {
  profile: ProfileSummaryData;
  /** `page`: a página pública (nome é o h1). `preview`: a miniatura no onboarding. */
  variant: 'page' | 'preview';
}

/**
 * Cabeçalho do perfil público: avatar, nome, papéis, lugar, bio e o selo de
 * disponibilidade. Usa só tokens de conteúdo — é o que a paleta da mídia recolore.
 */
export function ProfileSummary({ profile, variant }: ProfileSummaryProps) {
  const page = variant === 'page';
  const Name = page ? 'h1' : 'h3';
  const offset = profile.work_timezone ? timeZoneOffset(profile.work_timezone) : undefined;
  const meta = [profile.roles.join(' · '), profile.location, offset].filter(Boolean);

  return (
    <div className={cn('flex items-start', page ? 'flex-col gap-5 sm:flex-row sm:gap-7' : 'gap-5')}>
      <span
        aria-hidden
        data-avatar={profile.avatar_url ? 'photo' : 'empty'}
        className={cn(
          'bg-placeholder shrink-0 overflow-hidden rounded-full border border-content-border',
          page ? '-mt-14 size-[7.5rem]' : '-mt-[2.875rem] size-[5.25rem]',
        )}
      >
        {profile.avatar_url && (
          <img src={profile.avatar_url} alt="" className="size-full object-cover" />
        )}
      </span>
      <div className={cn('min-w-0 flex-1', page && 'sm:pt-[1.625rem]')}>
        <Name
          className={cn(
            'break-words',
            page
              ? 'text-[2.375rem] leading-[1.04] tracking-[-0.03em] sm:text-[3.375rem]'
              : 'text-section',
          )}
        >
          {profile.display_name || 'Seu nome'}
        </Name>
        {meta.length > 0 && (
          <ul
            className={cn(
              'flex flex-wrap items-center gap-x-3.5 gap-y-1 text-content-muted',
              page ? 'mt-3 text-[0.9375rem]' : 'mt-1 text-support',
            )}
          >
            {meta.map((item, index) => (
              <li key={item} className="flex items-center gap-3.5">
                {index > 0 && (
                  <span aria-hidden className="size-1 rounded-full bg-content-border" />
                )}
                {item}
              </li>
            ))}
          </ul>
        )}
        {/* Texto puro: o React escapa, nada da bio é interpretado como HTML. */}
        {profile.bio && (
          <p
            className={cn(
              'max-w-[37.5rem] whitespace-pre-line text-content-text-secondary',
              page ? 'mt-5 text-[1.125rem] leading-[1.65]' : 'mt-3.5 text-[0.9375rem]',
            )}
          >
            {profile.bio}
          </p>
        )}
        {profile.available_for_freelance && (
          <p
            className={cn(
              'inline-flex items-center gap-2 rounded-md bg-content-accent-tint px-3 py-1.5 text-[0.8125rem] text-content-accent-text',
              page ? 'mt-[1.375rem]' : 'mt-4',
            )}
          >
            <span aria-hidden className="size-[0.4375rem] rounded-full bg-content-accent-text" />
            Disponível para freelance
          </p>
        )}
      </div>
    </div>
  );
}
