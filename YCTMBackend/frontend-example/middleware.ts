// ============================================================
// Next.js middleware — route guard
// ============================================================
//
// Sits in front of every request. Rejects unauthenticated users from
// protected paths by checking the presence of our access cookie.
// (Real authentication still happens server-side — this is just a fast
// edge-level redirect to avoid flashing protected content.)

import { NextResponse, type NextRequest } from 'next/server';

const PUBLIC_PATHS = ['/login', '/auth/logged-out', '/_next', '/favicon', '/favicon.svg'];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) return NextResponse.next();
  const token = req.cookies.get('yc_access')?.value;
  if (!token) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('redirect', pathname);
    return NextResponse.redirect(url);
  }
  // Prevent browser back-button from re-showing protected pages
  const res = NextResponse.next();
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.headers.set('Pragma', 'no-cache');
  res.headers.set('Expires', '0');
  return res;
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon|.*\\.(?:png|jpg|svg|css|js)).*)'],
};
