"use client";

// app/(panel)/componentes/desplegable.tsx
// Lista desplegable de una sola opción. Reemplaza a <select>: el menú que
// abre el navegador para un select nativo lo dibuja el sistema operativo
// —en Chrome, con aire Material— y no se puede estilar desde la página.
//
// Es un combobox de solo lectura: no se escribe, se elige. Para elegir
// varias, filtrar o crear opciones nuevas está el Selector.
//
// El menú se monta en document.body y se ubica midiendo la caja, por lo mismo
// que el Selector: un ancestro con transform vuelve relativo el position fixed.

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";

export type OpcionDesplegable = {
  valor: string;
  etiqueta: string;
  deshabilitada?: boolean;
};

type Posicion = { top: number; left: number; ancho: number; arriba: boolean };

const ALTO_MENU = 268;

function Chevron() {
  return (
    <svg
      className="desplegable-chevron"
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function Tilde() {
  return (
    <svg
      className="desplegable-tilde"
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export function Desplegable({
  id,
  valor,
  opciones,
  alCambiar,
  placeholder = "Elegí una opción",
  etiquetaAccesible,
  deshabilitado = false,
  estilo,
}: {
  id?: string;
  valor: string;
  opciones: OpcionDesplegable[];
  alCambiar: (valor: string) => void;
  placeholder?: string;
  etiquetaAccesible?: string;
  deshabilitado?: boolean;
  estilo?: CSSProperties;
}) {
  const caja = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const idMenu = useId();

  const [abierto, setAbierto] = useState(false);
  const [posicion, setPosicion] = useState<Posicion | null>(null);
  const [activa, setActiva] = useState(0);

  const elegida = opciones.find((opcion) => opcion.valor === valor);
  const indiceElegido = opciones.findIndex((opcion) => opcion.valor === valor);

  // Al filtrar desde afuera la lista puede acortarse: el índice se acota en el
  // render en vez de reajustarlo con un efecto.
  const resaltada =
    opciones.length === 0 ? 0 : Math.min(Math.max(activa, 0), opciones.length - 1);

  const medir = useCallback(() => {
    const nodo = caja.current;
    if (!nodo) return;

    const rect = nodo.getBoundingClientRect();
    const abajo = window.innerHeight - rect.bottom;
    const arriba = abajo < ALTO_MENU && rect.top > abajo;

    setPosicion({
      top: arriba
        ? Math.max(8, rect.top - Math.min(ALTO_MENU, rect.top - 8) - 6)
        : rect.bottom + 6,
      left: rect.left,
      ancho: rect.width,
      arriba,
    });
  }, []);

  useLayoutEffect(() => {
    if (!abierto) return;
    medir();
  }, [abierto, medir, opciones.length]);

  useEffect(() => {
    if (!abierto) return;

    const recalcular = () => medir();
    // Captura: así también sigue al scroll de un diálogo o del panel lateral.
    window.addEventListener("scroll", recalcular, true);
    window.addEventListener("resize", recalcular);

    const afuera = (evento: PointerEvent) => {
      const destino = evento.target as Node;
      if (caja.current?.contains(destino)) return;
      if (menu.current?.contains(destino)) return;
      setAbierto(false);
    };
    document.addEventListener("pointerdown", afuera);

    return () => {
      window.removeEventListener("scroll", recalcular, true);
      window.removeEventListener("resize", recalcular);
      document.removeEventListener("pointerdown", afuera);
    };
  }, [abierto, medir]);

  // La opción resaltada tiene que quedar a la vista al abrir y al navegar.
  useEffect(() => {
    if (!abierto) return;
    const nodo = menu.current?.querySelector<HTMLElement>('[data-activa="si"]');
    nodo?.scrollIntoView({ block: "nearest" });
  }, [abierto, resaltada]);

  function abrir() {
    if (deshabilitado) return;
    setActiva(indiceElegido < 0 ? 0 : indiceElegido);
    setAbierto(true);
  }

  function cerrar() {
    setAbierto(false);
    caja.current?.focus();
  }

  function elegir(opcion: OpcionDesplegable) {
    if (opcion.deshabilitada) return;
    if (opcion.valor !== valor) alCambiar(opcion.valor);
    cerrar();
  }

  /** Salta las opciones deshabilitadas al moverse con las flechas. */
  function correr(desde: number, paso: number) {
    if (opciones.length === 0) return;

    let indice = desde;
    for (let vuelta = 0; vuelta < opciones.length; vuelta += 1) {
      indice = (indice + paso + opciones.length) % opciones.length;
      if (!opciones[indice].deshabilitada) {
        setActiva(indice);
        return;
      }
    }
  }

  function teclado(evento: React.KeyboardEvent<HTMLButtonElement>) {
    if (evento.key === "Escape") {
      if (!abierto) return;
      evento.preventDefault();
      cerrar();
      return;
    }

    if (evento.key === "Tab") {
      setAbierto(false);
      return;
    }

    if (!abierto) {
      if (
        evento.key === "ArrowDown" ||
        evento.key === "ArrowUp" ||
        evento.key === "Enter" ||
        evento.key === " "
      ) {
        evento.preventDefault();
        abrir();
      }
      return;
    }

    if (evento.key === "ArrowDown" || evento.key === "ArrowUp") {
      evento.preventDefault();
      correr(resaltada, evento.key === "ArrowDown" ? 1 : -1);
      return;
    }

    if (evento.key === "Home" || evento.key === "End") {
      evento.preventDefault();
      correr(evento.key === "Home" ? -1 : 0, evento.key === "Home" ? 1 : -1);
      return;
    }

    if (evento.key === "Enter" || evento.key === " ") {
      evento.preventDefault();
      const opcion = opciones[resaltada];
      if (opcion) elegir(opcion);
      return;
    }

    // Tipeo rápido: la primera opción que empiece con la letra apretada.
    if (evento.key.length === 1) {
      const letra = evento.key.toLowerCase();
      const encontrada = opciones.findIndex(
        (opcion) =>
          !opcion.deshabilitada && opcion.etiqueta.toLowerCase().startsWith(letra),
      );
      if (encontrada >= 0) setActiva(encontrada);
    }
  }

  return (
    <>
      <button
        id={id}
        ref={caja}
        type="button"
        className="desplegable"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={abierto}
        aria-controls={abierto ? idMenu : undefined}
        aria-label={etiquetaAccesible}
        data-abierto={abierto ? "si" : "no"}
        data-vacio={elegida ? "no" : "si"}
        disabled={deshabilitado}
        style={estilo}
        onClick={() => (abierto ? setAbierto(false) : abrir())}
        onKeyDown={teclado}
      >
        <span className="desplegable-valor">
          {elegida ? elegida.etiqueta : placeholder}
        </span>
        <Chevron />
      </button>

      {abierto && posicion
        ? createPortal(
            <div
              id={idMenu}
              ref={menu}
              className="desplegable-menu"
              role="listbox"
              aria-label={etiquetaAccesible}
              style={{
                top: posicion.top,
                left: posicion.left,
                minWidth: posicion.ancho,
                maxHeight: ALTO_MENU,
              }}
              // Sostiene el foco en el botón mientras se hace clic en la lista.
              onMouseDown={(evento) => evento.preventDefault()}
            >
              {opciones.map((opcion, indice) => {
                const esta = opcion.valor === valor;
                return (
                  <button
                    key={opcion.valor}
                    type="button"
                    role="option"
                    aria-selected={esta}
                    className="desplegable-opcion"
                    data-activa={indice === resaltada ? "si" : "no"}
                    disabled={opcion.deshabilitada}
                    onMouseEnter={() => {
                      if (!opcion.deshabilitada) setActiva(indice);
                    }}
                    onClick={() => elegir(opcion)}
                  >
                    {opcion.etiqueta}
                    {esta ? <Tilde /> : null}
                  </button>
                );
              })}

              {opciones.length === 0 ? (
                <p className="desplegable-vacio">No hay opciones.</p>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
