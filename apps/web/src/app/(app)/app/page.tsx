import { PlusIcon } from '@phosphor-icons/react/ssr';

import { PageHeader } from '@/components/app/page-header';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';

import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Projetos — Casebook' };

export default function ProjectsPage() {
  return (
    <>
      <PageHeader eyebrow="Seus projetos" title="Projetos" />
      <EmptyState
        title="Nenhum projeto ainda"
        action={
          <div className="flex flex-col items-center gap-3">
            <Button size="lg" disabled aria-describedby="new-project-note">
              <PlusIcon aria-hidden /> Novo projeto
            </Button>
            <span id="new-project-note" className="text-support text-muted">
              Chega na próxima versão.
            </span>
          </div>
        }
      >
        Cada projeto é uma página do seu portfólio, montada em blocos de imagem, vídeo e texto.
        Enquanto a criação de projetos não chega, deixe seu perfil pronto.
      </EmptyState>
    </>
  );
}
