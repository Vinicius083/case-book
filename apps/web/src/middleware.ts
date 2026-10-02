import { type NextRequest, NextResponse } from 'next/server';

import { loginUrl } from '@/lib/auth/next-path';

// Marcador emitido pela API junto com o refresh token. O `cb_refresh` em si só é
// enviado a /api/auth (é o Path dele), então não aparece nas requisições de página.
const SESSION_MARKER = 'cb_session';

/**
 * Só UX: evita mostrar o app a quem claramente não tem sessão e o login a quem
 * tem. NÃO é autorização — o cookie pode estar presente com a sessão revogada ou
 * expirada. Quem decide é a API, a cada requisição; se ela recusar, o cliente
 * HTTP limpa a sessão e manda para o login.
 */
export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const hasSession = request.cookies.has(SESSION_MARKER);

  if (pathname === '/login' || pathname === '/signup') {
    return hasSession ? NextResponse.redirect(new URL('/app', request.url)) : NextResponse.next();
  }
  if (!hasSession) {
    return NextResponse.redirect(new URL(loginUrl(`${pathname}${search}`), request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/app/:path*', '/login', '/signup'],
};
