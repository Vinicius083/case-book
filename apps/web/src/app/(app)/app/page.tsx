import { Clapperboard, Plus } from 'lucide-react';

import { EmptyState } from '@/components/app/empty-state';
import { Button } from '@/components/ui/button';

import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Projetos — Casebook' };

export default function ProjectsPage() {
  return (
    <div className="flex flex-col gap-8">
      <h1 className="font-heading text-3xl font-bold">Projetos</h1>
      <EmptyState
        icon={Clapperboard}
        title="Nenhum projeto ainda"
        action={
          <div className="flex flex-wrap items-center gap-3">
            <Button disabled aria-describedby="new-project-note">
              <Plus aria-hidden /> Novo projeto
            </Button>
            <span id="new-project-note" className="text-sm text-muted">
              Chega na próxima versão.
            </span>
          </div>
        }
      >
        Cada projeto é uma página do seu portfólio, montada em blocos de imagem, vídeo e texto.
        Enquanto a criação de projetos não chega, deixe seu perfil pronto.
      </EmptyState>
    </div>
  );
}
