"use client";

// app/(panel)/componentes/modal.tsx
// Diálogos propios, con el estilo del panel. Reemplazan a alert() y confirm().
// Los tres flotan centrados sobre la pantalla: el velo apaga el fondo y el
// cuadro entra con un rebote corto.

import { useEffect, useRef, type ReactNode } from "react";

function useEscape(alCerrar: () => void) {
  useEffect(() => {
    const manejar = (evento: KeyboardEvent) => {
      if (evento.key === "Escape") alCerrar();
    };
    document.addEventListener("keydown", manejar);
    return () => document.removeEventListener("keydown", manejar);
  }, [alCerrar]);
}

/**
 * Mientras hay un diálogo abierto la página de atrás no se mueve, y al cerrarlo
 * el foco vuelve al botón que lo abrió.
 */
function useFocoYScroll(dialogo: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const previo = document.activeElement as HTMLElement | null;
    const scrollPrevio = document.body.style.overflow;

    document.body.style.overflow = "hidden";
    dialogo.current?.focus();

    return () => {
      document.body.style.overflow = scrollPrevio;
      previo?.focus?.();
    };
  }, [dialogo]);
}

/** Armazón compartido: velo, centrado, cabecera, cuerpo con scroll y pie. */
function Dialogo({
  titulo,
  subtitulo,
  children,
  pie,
  alCerrar,
  ancho,
  cerrarEnCabecera = true,
}: {
  titulo: string;
  subtitulo?: string;
  children: ReactNode;
  pie?: ReactNode;
  alCerrar: () => void;
  ancho: number;
  /** El de confirmación ya tiene Cancelar en el pie: dos botones para lo
      mismo, uno arriba y otro abajo, solo hacen dudar. */
  cerrarEnCabecera?: boolean;
}) {
  const dialogo = useRef<HTMLDivElement>(null);

  useEscape(alCerrar);
  useFocoYScroll(dialogo);

  return (
    <div className="capa-modal">
      <button
        type="button"
        aria-label="Cerrar"
        onClick={alCerrar}
        className="velo"
      />

      <div
        ref={dialogo}
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        tabIndex={-1}
        className="dialogo"
        style={{ maxWidth: ancho }}
      >
        <header className="dialogo-cabecera">
          <div>
            <div className="dialogo-titulo">{titulo}</div>
            {subtitulo ? (
              <div className="dialogo-subtitulo">{subtitulo}</div>
            ) : null}
          </div>
          {cerrarEnCabecera ? (
            <button type="button" onClick={alCerrar} className="boton-plano">
              Cerrar
            </button>
          ) : null}
        </header>

        <div className="dialogo-cuerpo">{children}</div>

        {pie ? <footer className="dialogo-pie">{pie}</footer> : null}
      </div>
    </div>
  );
}

/**
 * Ficha de alta y edición. Antes era un cajón pegado al borde derecho; ahora
 * flota en el centro, que es donde ya está mirando quien apretó el botón.
 */
export function ModalFicha({
  titulo,
  subtitulo,
  children,
  pie,
  alCerrar,
  ancho = 560,
}: {
  titulo: string;
  subtitulo?: string;
  children: ReactNode;
  pie: ReactNode;
  alCerrar: () => void;
  ancho?: number;
}) {
  return (
    <Dialogo
      titulo={titulo}
      subtitulo={subtitulo}
      pie={pie}
      alCerrar={alCerrar}
      ancho={ancho}
    >
      {children}
    </Dialogo>
  );
}

export function Modal({
  titulo,
  children,
  alCerrar,
  ancho = 440,
}: {
  titulo: string;
  children: ReactNode;
  alCerrar: () => void;
  ancho?: number;
}) {
  return (
    <Dialogo titulo={titulo} alCerrar={alCerrar} ancho={ancho}>
      {children}
    </Dialogo>
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
    <Dialogo
      titulo={titulo}
      alCerrar={alCancelar}
      ancho={420}
      cerrarEnCabecera={false}
      pie={
        <>
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
        </>
      }
    >
      <p className="text-texto">{mensaje}</p>
    </Dialogo>
  );
}
