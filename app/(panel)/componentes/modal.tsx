"use client";

// app/(panel)/componentes/modal.tsx
// Modal propio, con el estilo del panel. Reemplaza a alert() y confirm().

import { useEffect, type ReactNode } from "react";

function useEscape(activo: boolean, alCerrar: () => void) {
  useEffect(() => {
    if (!activo) return;
    const manejar = (evento: KeyboardEvent) => {
      if (evento.key === "Escape") alCerrar();
    };
    document.addEventListener("keydown", manejar);
    return () => document.removeEventListener("keydown", manejar);
  }, [activo, alCerrar]);
}

export function Modal({
  titulo,
  children,
  alCerrar,
  ancho = 400,
}: {
  titulo: string;
  children: ReactNode;
  alCerrar: () => void;
  ancho?: number;
}) {
  useEscape(true, alCerrar);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <button
        type="button"
        aria-label="Cerrar"
        onClick={alCerrar}
        className="absolute inset-0 cursor-default bg-black/60"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        className="panel relative w-full"
        style={{ maxWidth: ancho }}
      >
        <div className="flex items-center justify-between border-b border-borde px-3 py-2">
          <span className="rotulo">{titulo}</span>
          <button type="button" onClick={alCerrar} className="boton-plano">
            Cerrar
          </button>
        </div>
        <div className="p-3">{children}</div>
      </div>
    </div>
  );
}

export function ConfirmarModal({
  titulo,
  mensaje,
  textoConfirmar,
  peligro = false,
  pendiente = false,
  alConfirmar,
  alCancelar,
}: {
  titulo: string;
  mensaje: string;
  textoConfirmar: string;
  peligro?: boolean;
  pendiente?: boolean;
  alConfirmar: () => void;
  alCancelar: () => void;
}) {
  return (
    <Modal titulo={titulo} alCerrar={alCancelar} ancho={380}>
      <p className="text-texto">{mensaje}</p>

      <div className="mt-4 flex items-center justify-end gap-2 border-t border-borde pt-3">
        <button
          type="button"
          className="boton-plano"
          onClick={alCancelar}
          disabled={pendiente}
        >
          Cancelar
        </button>
        <button
          type="button"
          className={peligro ? "boton boton-peligro" : "boton"}
          onClick={alConfirmar}
          disabled={pendiente}
        >
          {pendiente ? "Aplicando…" : textoConfirmar}
        </button>
      </div>
    </Modal>
  );
}
