import Link from 'next/link';

import { FullScreen } from '@/components/app/full-screen';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <FullScreen>
      <p className="eyebrow">Erro 404</p>
      <h1 className="text-section sm:text-page">Esta página não existe</h1>
      <p className="max-w-sm text-text-secondary">
        O endereço pode ter sido digitado errado, ou o perfil mudou de handle.
      </p>
      <Button asChild variant="secondary" className="mt-2">
        <Link href="/">Ir para o início</Link>
      </Button>
    </FullScreen>
  );
}
