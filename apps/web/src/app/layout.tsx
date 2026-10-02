import './globals.css';

import { cookies } from 'next/headers';

import { getEnv } from '@/env';
import { parseTheme, THEME_COOKIE } from '@/lib/theme';

import { Providers } from './providers';

import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Casebook',
  description: 'Portfólio para profissionais do audiovisual.',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Ler o cookie torna toda rota dinâmica — e é o que deixa o env abaixo ser lido
  // por requisição, não no build (a imagem Docker é buildada sem o env de runtime).
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);

  return (
    <html lang="pt-BR" data-theme={theme}>
      <body className="min-h-dvh antialiased">
        <Providers publicBaseUrl={getEnv().PUBLIC_BASE_URL}>{children}</Providers>
      </body>
    </html>
  );
}
