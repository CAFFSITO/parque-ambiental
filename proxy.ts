// proxy.ts
// En Next.js 16 el archivo middleware.ts pasó a llamarse proxy.ts y corre
// siempre en el runtime de Node.js.
//
// Todo exige sesión válida salvo /login, /api/ingest y los assets estáticos.

import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_SESION, verificarSesion } from "@/lib/sesion";

// /api/ingest y /api/vigilancia se autentican con x-device-key dentro de la
// propia ruta, por eso el proxy las deja pasar sin sesión.
const RUTAS_PUBLICAS = ["/login", "/api/ingest", "/api/vigilancia"];

function esPublica(ruta: string): boolean {
  return RUTAS_PUBLICAS.some(
    (publica) => ruta === publica || ruta.startsWith(`${publica}/`),
  );
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get(COOKIE_SESION)?.value;
  const sesion = token ? await verificarSesion(token) : null;

  if (esPublica(pathname)) {
    // Con sesión abierta, /login no tiene sentido: al tablero.
    if (pathname === "/login" && sesion) {
      const destino = request.nextUrl.clone();
      destino.pathname = "/";
      destino.search = "";
      return NextResponse.redirect(destino);
    }
    return NextResponse.next();
  }

  if (sesion) return NextResponse.next();

  const destino = request.nextUrl.clone();
  destino.pathname = "/login";
  destino.search = "";
  if (pathname !== "/") destino.searchParams.set("desde", pathname);

  const respuesta = NextResponse.redirect(destino);
  // Cookie presente pero vencida o adulterada: la limpiamos.
  if (token) respuesta.cookies.delete(COOKIE_SESION);
  return respuesta;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|woff|woff2|txt|xml)$).*)",
  ],
};
