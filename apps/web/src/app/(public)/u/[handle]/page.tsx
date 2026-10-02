import { notFound } from 'next/navigation';

import { getEnv } from '@/env';
import {
  type PublicProfileResponse,
  publicProfileResponseSchema,
} from '@casebook/contracts/profile';

import type { Metadata } from 'next';

// Versão mínima do perfil público, para o "Ver perfil público" do app ter destino.
// A página de verdade (grid de projetos, tema da paleta, OG tags) é da Sprint 4.

interface Props {
  params: Promise<{ handle: string }>;
}

async function fetchProfile(handle: string): Promise<PublicProfileResponse | undefined> {
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
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-8 px-6 py-16">
      <header className="flex flex-col gap-2">
        <h1 className="font-heading text-4xl leading-tight font-bold">{profile.display_name}</h1>
        <p className="text-muted">
          @{profile.handle}
          {profile.location && `, ${profile.location}`}
        </p>
      </header>

      {profile.roles.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Papéis na produção">
          {profile.roles.map((role) => (
            <li key={role} className="rounded-full border border-divider px-3 py-1 text-sm">
              {role}
            </li>
          ))}
        </ul>
      )}

      {/* Texto puro: o React escapa, nada da bio é interpretado como HTML. */}
      {profile.bio && <p className="leading-relaxed whitespace-pre-line">{profile.bio}</p>}

      {profile.links.length > 0 && (
        <ul className="flex flex-col gap-2">
          {profile.links.map((link) => (
            <li key={`${link.label}-${link.url}`}>
              <a
                href={link.url}
                rel="noopener noreferrer nofollow"
                target="_blank"
                className="underline underline-offset-4"
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
