"use client";

// app/(panel)/componentes/panel-lateral.tsx
// Cajón lateral derecho para las fichas de alta y edición.

import { useEffect, type ReactNode } from "react";

export function PanelLateral({
  titulo,
  subtitulo,
  children,
  pie,
  alCerrar,
  ancho = 420,
}: {
  titulo: string;
  subtitulo?: string;
  children: ReactNode;
  pie: ReactNode;
  alCerrar: () => void;
  ancho?: number;
}) {
  useEffect(() => {
    const manejar = (evento: KeyboardEvent) => {
      if (evento.key === "Escape") alCerrar();
    };
    document.addEventListener("keydown", manejar);
    return () => document.removeEventListener("keydown", manejar);
  }, [alCerrar]);

  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        aria-label="Cerrar"
        onClick={alCerrar}
        className="absolute inset-0 cursor-default bg-black/60"
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        className="absolute top-0 right-0 bottom-0 flex w-full flex-col border-l border-borde bg-panel"
        style={{ maxWidth: ancho }}
      >
        <header className="flex items-center justify-between border-b border-borde px-3 py-2">
          <div>
            <div className="rotulo">{titulo}</div>
            {subtitulo ? (
              <div className="mt-0.5 text-texto">{subtitulo}</div>
            ) : null}
          </div>
          <button type="button" onClick={alCerrar} className="boton-plano">
            Cerrar
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-3">{children}</div>

        <footer className="flex items-center justify-end gap-2 border-t border-borde px-3 py-2">
          {pie}
        </footer>
      </aside>
    </div>
  );
}
