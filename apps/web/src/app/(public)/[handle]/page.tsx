import { ArrowUpRightIcon } from '@phosphor-icons/react/ssr';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ProfileSummary } from '@/components/profile/profile-summary';
import { getEnv } from '@/env';
import { handleProblem, normalizeHandle } from '@casebook/contracts/handle';
import {
  type PublicProfileResponse,
  publicProfileResponseSchema,
} from '@casebook/contracts/profile';

import type { Metadata } from 'next';

// Versão mínima do perfil público (`/:handle`), no visual do design. A página de
// verdade (grid de projetos, paleta da mídia, OG tags) é da Sprint 4.

interface Props {
  params: Promise<{ handle: string }>;
}

async function fetchProfile(raw: string): Promise<PublicProfileResponse | undefined> {
  // Esta rota recebe qualquer `/<algo>` que não seja outra página: o que não tem
  // formato de handle nem chega à API.
  const handle = normalizeHandle(decodeURIComponent(raw));
  if (handleProblem(handle)) return undefined;

  const res = await fetch(
    `${getEnv().API_URL}/public/profiles/${encodeURIComponent(handle)}`,
    // Mesmo prazo do Cache-Control da API.
    { next: { revalidate: 60 } },
  );
  if (res.status === 404) return undefined;
  if (!res.ok) throw new Error(`API respondeu ${String(res.status)} ao buscar o perfil`);
  return publicProfileResponseSchema.parse(await res.json());
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const profile = await fetchProfile((await params).handle);
  return { title: profile ? `${profile.display_name} — Casebook` : 'Perfil não encontrado' };
}

export default async function PublicProfilePage({ params }: Props) {
  const profile = await fetchProfile((await params).handle);
  if (!profile) notFound();

  return (
    // Só tokens de conteúdo daqui para baixo: é este bloco que a paleta da mídia vai recolorir.
    <div className="min-h-dvh bg-content-bg text-content-text">
      <header className="bg-placeholder relative h-48 sm:h-72">
        <Link href="/" className="brand-mark absolute top-[1.375rem] left-6 rounded-sm sm:left-11">
          Casebook
        </Link>
      </header>

      <main className="mx-auto flex max-w-[68rem] flex-col gap-10 px-6 pb-20 sm:px-11">
        <ProfileSummary profile={profile} variant="page" />

        {profile.links.length > 0 && (
          <ul aria-label="Links" className="flex flex-wrap gap-x-6 gap-y-2 text-[0.9375rem]">
            {profile.links.map((link) => (
              <li key={`${link.label}-${link.url}`}>
                <a
                  href={link.url}
                  rel="noopener noreferrer nofollow"
                  target="_blank"
                  className="inline-flex items-center gap-1 rounded-sm text-content-accent-text underline-offset-4 hover:underline"
                >
                  {link.label}
                  <ArrowUpRightIcon aria-hidden className="size-3.5" />
                  <span className="sr-only">(abre em nova aba)</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
