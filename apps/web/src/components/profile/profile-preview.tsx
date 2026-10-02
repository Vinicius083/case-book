import { SquaresFourIcon } from '@phosphor-icons/react/ssr';

import { ProfileSummary, type ProfileSummaryData } from './profile-summary';

interface ProfilePreviewProps {
  profile: ProfileSummaryData;
  /** Endereço público, como se mostra (`casebook.com.br/ana`). */
  address: string;
}

/** Miniatura do perfil público que acompanha o formulário do onboarding. */
export function ProfilePreview({ profile, address }: ProfilePreviewProps) {
  return (
    <section aria-label="Preview do perfil público" className="flex h-full flex-col gap-3.5">
      <p className="eyebrow">
        Preview ao vivo — <span className="tracking-normal break-all normal-case">{address}</span>
      </p>
      <div className="flex min-h-[32rem] flex-1 flex-col overflow-hidden rounded-md border border-border bg-content-bg text-content-text">
        <div aria-hidden className="bg-placeholder h-[11.875rem] shrink-0" />
        <div className="px-7 py-6">
          <ProfileSummary profile={profile} variant="preview" />
        </div>
        <div className="mx-7 mt-2 mb-7 flex min-h-32 flex-1 flex-col items-center justify-center gap-2 rounded-md border border-dashed border-content-border text-content-muted">
          <SquaresFourIcon aria-hidden weight="duotone" className="size-[1.625rem]" />
          <span className="text-[0.8125rem]">Seus projetos aparecem aqui</span>
        </div>
      </div>
    </section>
  );
}
