"use client";

// app/(panel)/componentes/lista.tsx
// Lista compacta con filas desplegables. La fila cerrada deja a la vista solo
// lo necesario para decidir, con la acción principal a la izquierda y a mano;
// al abrirla crece en el lugar y muestra la ficha completa.
//
// Solo una fila abierta a la vez: la que se abre cierra a la anterior, así la
// lista nunca deja de ser una lista.

import {
  createContext,
  useContext,
  useId,
  useState,
  type ReactNode,
} from "react";
import type { NivelEstado } from "@/lib/tipos";

type Nivel = NivelEstado | "NINGUNO";

const ContextoLista = createContext<{
  abierta: string | null;
  alternar: (clave: string) => void;
} | null>(null);

export function Lista({
  children,
  vacio,
  hayFilas = true,
}: {
  children: ReactNode;
  vacio: string;
  hayFilas?: boolean;
}) {
  const [abierta, setAbierta] = useState<string | null>(null);

  function alternar(clave: string) {
    setAbierta((actual) => (actual === clave ? null : clave));
  }

  return (
    <section className="panel">
      {hayFilas ? (
        <ContextoLista.Provider value={{ abierta, alternar }}>
          <div className="lista">{children}</div>
        </ContextoLista.Provider>
      ) : (
        <p className="lista-vacia">{vacio}</p>
      )}
    </section>
  );
}

function Chevron() {
  return (
    <svg
      className="fila-chevron"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

/**
 * `clave` identifica la fila dentro de la lista (el id de la entidad).
 * `accion` es lo primero que se ve: el botón que resuelve la fila sin abrirla.
 */
export function FilaDesplegable({
  clave,
  accion,
  titulo,
  resumen,
  marcas,
  detalle,
  pie,
  nivel = "NINGUNO",
  tenue = false,
}: {
  clave: string;
  accion?: ReactNode;
  titulo: ReactNode;
  resumen?: ReactNode;
  marcas?: ReactNode;
  detalle: ReactNode;
  pie?: ReactNode;
  nivel?: Nivel;
  tenue?: boolean;
}) {
  const contexto = useContext(ContextoLista);
  const idCuerpo = useId();
  const abierta = contexto?.abierta === clave;

  return (
    <div
      className="fila-desplegable"
      data-abierta={abierta ? "si" : "no"}
      data-nivel={nivel}
      data-tenue={tenue ? "si" : "no"}
    >
      <div className="fila-linea">
        {accion ? <div className="fila-accion">{accion}</div> : null}

        <button
          type="button"
          className="fila-cabezal"
          aria-expanded={abierta}
          aria-controls={idCuerpo}
          onClick={() => contexto?.alternar(clave)}
        >
          <span className="fila-titulo">{titulo}</span>
          {/* Envueltas: en angosto las marcas bajan a su propio renglón, y sin
              un contenedor cada chip sería una celda suelta de la grilla —el
              pie de usuarios puede traer dos y se pisarían. En escritorio el
              envoltorio es display:contents, o sea que no existe como caja y
              los chips siguen siendo hijos directos de la fila, igual que antes. */}
          {marcas ? <span className="fila-marcas">{marcas}</span> : null}
          <span className="fila-resumen">{resumen}</span>
          <Chevron />
        </button>
      </div>

      {/* inert saca del tab y del árbol de accesibilidad lo que está plegado:
          la altura llega a cero por CSS, pero los botones seguirían enfocables. */}
      <div className="fila-cuerpo" id={idCuerpo} inert={!abierta}>
        <div className="fila-cuerpo-interior">
          <div className="fila-detalle">{detalle}</div>
          {pie ? <div className="fila-pie">{pie}</div> : null}
        </div>
      </div>
    </div>
  );
}

export function Dato({
  rotulo,
  children,
  ancho = false,
}: {
  rotulo: string;
  children: ReactNode;
  ancho?: boolean;
}) {
  return (
    <div className={ancho ? "dato dato-ancho" : "dato"}>
      <span className="dato-rotulo">{rotulo}</span>
      <span className="dato-valor">{children}</span>
    </div>
  );
}

export function Chip({
  texto,
  nivel = "NINGUNO",
}: {
  texto: string;
  nivel?: Nivel;
}) {
  return (
    <span className="chip" data-nivel={nivel}>
      {texto}
    </span>
  );
}
