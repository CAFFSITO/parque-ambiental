// app/forbidden.tsx
// Pantalla que Next.js renderiza —con status HTTP 403— cuando cualquier
// página o Server Action llama a forbidden() desde exigirAdmin().

import Link from "next/link";

export default function Prohibido() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="panel w-full max-w-[420px] p-5">
        <div className="mb-3 flex items-center gap-2 border-b border-borde pb-3">
          <span className="punto" data-nivel="EMERGENCIA" />
          <span className="rotulo text-emergencia">Error 403</span>
        </div>

        <h1 className="text-[15px] font-semibold text-texto">
          No tenés permisos para acceder a esta sección
        </h1>

        <p className="mt-2 text-tenue">
          Esta sección es exclusiva del rol ADMINISTRADOR. Si necesitás
          acceder, pedíselo al administrador del sistema.
        </p>

        <div className="mt-4 border-t border-borde pt-3">
          <Link href="/" className="boton-plano inline-flex items-center">
            Volver al tablero
          </Link>
        </div>
      </div>
    </main>
  );
}
