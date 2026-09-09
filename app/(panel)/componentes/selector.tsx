"use client";

// app/(panel)/componentes/selector.tsx
// Selector estilo Notion: una caja de texto que al tocarla abre las opciones
// ya creadas. Se puede elegir de a una o varias, filtrar escribiendo y crear
// una opción nueva tipeándola y apretando Enter: queda creada y seleccionada.
//
// El menú se ubica midiendo la caja y se monta en document.body: así no lo
// recorta el scroll de la ficha ni el transform del diálogo que la contiene
// (un ancestro con transform vuelve relativo al elemento el position: fixed).

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

export type OpcionSelector = {
  valor: string;
  etiqueta: string;
};

type Posicion = {
  top?: number;
  bottom?: number;
  left: number;
  width: number;
  alto: number;
};

/** Marcas diacríticas combinantes (bloque Unicode U+0300 a U+036F). */
const MARCAS_DIACRITICAS = new RegExp("[\\u0300-\\u036f]", "g");

/** Compara sin acentos ni mayúsculas, para filtrar y detectar duplicados. */
function plegar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(MARCAS_DIACRITICAS, "")
    .trim()
    .toLowerCase();
}

function Tilde() {
  return (
    <svg
      className="selector-tilde"
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

function Cruz() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.8"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

export function Selector({
  id,
  opciones,
  valores,
  alCambiar,
  multiple = false,
  creable = false,
  placeholder,
  rotuloMenu,
  deshabilitado = false,
}: {
  id?: string;
  opciones: OpcionSelector[];
  valores: string[];
  alCambiar: (valores: string[]) => void;
  multiple?: boolean;
  creable?: boolean;
  placeholder?: string;
  rotuloMenu?: string;
  deshabilitado?: boolean;
}) {
  const contenedor = useRef<HTMLDivElement>(null);
  const caja = useRef<HTMLDivElement>(null);
  const entrada = useRef<HTMLInputElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const idMenu = useId();

  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState("");
  const [activa, setActiva] = useState(0);
  const [creadas, setCreadas] = useState<OpcionSelector[]>([]);
  const [posicion, setPosicion] = useState<Posicion | null>(null);

  // Catálogo visible: lo que vino del servidor, más lo creado en esta sesión,
  // más cualquier valor ya guardado que no figure en ninguna de las dos listas.
  const catalogo = useMemo(() => {
    const mapa = new Map<string, OpcionSelector>();
    for (const opcion of [...opciones, ...creadas]) {
      if (!mapa.has(opcion.valor)) mapa.set(opcion.valor, opcion);
    }
    for (const valor of valores) {
      if (!mapa.has(valor)) mapa.set(valor, { valor, etiqueta: valor });
    }
    return [...mapa.values()];
  }, [opciones, creadas, valores]);

  const etiquetaDe = useCallback(
    (valor: string) =>
      catalogo.find((opcion) => opcion.valor === valor)?.etiqueta ?? valor,
    [catalogo],
  );

  const filtradas = useMemo(() => {
    const buscado = plegar(texto);
    if (buscado === "") return catalogo;
    return catalogo.filter((opcion) =>
      plegar(opcion.etiqueta).includes(buscado),
    );
  }, [catalogo, texto]);

  const limpio = texto.trim();
  const puedeCrear =
    creable &&
    limpio !== "" &&
    !catalogo.some((opcion) => plegar(opcion.etiqueta) === plegar(limpio));

  const totalEntradas = filtradas.length + (puedeCrear ? 1 : 0);

  // Al filtrar, la lista se acorta y el índice resaltado puede quedar afuera.
  // Se acota en el render en vez de reajustarlo con un efecto.
  const resaltada = totalEntradas === 0 ? 0 : Math.min(activa, totalEntradas - 1);

  const medir = useCallback(() => {
    const nodo = caja.current;
    if (!nodo) return;

    const rect = nodo.getBoundingClientRect();
    const abajo = window.innerHeight - rect.bottom - 8;
    const encima = rect.top - 8;
    const arriba = abajo < 180 && encima > abajo;

    // Igual que en el Desplegable: hacia arriba se ancla el borde inferior,
    // así el menú nace pegado al campo y no a media pantalla.
    setPosicion({
      top: arriba ? undefined : rect.bottom + 6,
      bottom: arriba ? window.innerHeight - rect.top + 6 : undefined,
      left: rect.left,
      width: rect.width,
      alto: Math.max(120, Math.min(264, (arriba ? encima : abajo) - 6)),
    });
  }, []);

  useLayoutEffect(() => {
    if (!abierto) return;
    medir();
  }, [abierto, medir, totalEntradas]);

  useEffect(() => {
    if (!abierto) return;

    const recalcular = () => medir();
    // Captura: así también sigue al scroll del panel lateral, no solo al de la página.
    window.addEventListener("scroll", recalcular, true);
    window.addEventListener("resize", recalcular);

    // El menú vive fuera del componente (portal), así que se comprueba aparte.
    const afuera = (evento: PointerEvent) => {
      const destino = evento.target as Node;
      if (contenedor.current?.contains(destino)) return;
      if (menu.current?.contains(destino)) return;
      setAbierto(false);
      setTexto("");
    };
    document.addEventListener("pointerdown", afuera);

    return () => {
      window.removeEventListener("scroll", recalcular, true);
      window.removeEventListener("resize", recalcular);
      document.removeEventListener("pointerdown", afuera);
    };
  }, [abierto, medir]);

  function abrir() {
    if (deshabilitado) return;
    setAbierto(true);
    setActiva(0);
    entrada.current?.focus();
  }

  function elegir(valor: string) {
    setTexto("");
    setActiva(0);

    if (multiple) {
      alCambiar(
        valores.includes(valor)
          ? valores.filter((actual) => actual !== valor)
          : [...valores, valor],
      );
      entrada.current?.focus();
      return;
    }

    alCambiar(valores[0] === valor ? [] : [valor]);
    setAbierto(false);
  }

  function crear() {
    const nueva: OpcionSelector = { valor: limpio, etiqueta: limpio };
    setCreadas((actual) => [...actual, nueva]);
    elegir(nueva.valor);
  }

  function quitar(valor: string) {
    alCambiar(valores.filter((actual) => actual !== valor));
  }

  function teclado(evento: React.KeyboardEvent<HTMLInputElement>) {
    if (evento.key === "ArrowDown" || evento.key === "ArrowUp") {
      evento.preventDefault();
      if (!abierto) {
        setAbierto(true);
        return;
      }
      if (totalEntradas === 0) return;
      const paso = evento.key === "ArrowDown" ? 1 : -1;
      setActiva((resaltada + paso + totalEntradas) % totalEntradas);
      return;
    }

    if (evento.key === "Enter") {
      if (!abierto) return;
      evento.preventDefault();

      if (resaltada < filtradas.length) {
        const opcion = filtradas[resaltada];
        if (opcion) elegir(opcion.valor);
        return;
      }
      if (puedeCrear) crear();
      return;
    }

    if (evento.key === "Escape") {
      if (!abierto) return;
      evento.preventDefault();
      setAbierto(false);
      setTexto("");
      setActiva(0);
      return;
    }

    if (
      evento.key === "Backspace" &&
      texto === "" &&
      multiple &&
      valores.length > 0
    ) {
      quitar(valores[valores.length - 1]);
    }
  }

  const marcador =
    placeholder ??
    (valores.length === 0
      ? creable
        ? "Elegí o escribí una nueva…"
        : "Elegí una opción…"
      : multiple
        ? "Agregar…"
        : "");

  const fichas = multiple ? valores : valores.slice(0, 1);

  return (
    <div
      className="selector"
      ref={contenedor}
      data-abierto={abierto ? "si" : "no"}
    >
      <div
        className="selector-caja"
        ref={caja}
        onPointerDown={(evento) => {
          // Un clic en la cruz de una ficha no tiene que abrir el menú.
          if ((evento.target as HTMLElement).closest(".selector-quitar")) return;
          abrir();
        }}
      >
        {fichas.map((valor) => (
          <span key={valor} className="selector-ficha">
            {etiquetaDe(valor)}
            <button
              type="button"
              className="selector-quitar"
              aria-label={`Quitar ${etiquetaDe(valor)}`}
              disabled={deshabilitado}
              onClick={() => quitar(valor)}
            >
              <Cruz />
            </button>
          </span>
        ))}

        <input
          id={id}
          ref={entrada}
          className="selector-entrada"
          role="combobox"
          aria-expanded={abierto}
          aria-controls={idMenu}
          aria-autocomplete="list"
          autoComplete="off"
          disabled={deshabilitado}
          placeholder={marcador}
          value={texto}
          onChange={(evento) => {
            setTexto(evento.target.value);
            setActiva(0);
            setAbierto(true);
          }}
          onFocus={() => setAbierto(true)}
          onKeyDown={teclado}
        />
      </div>

      {abierto && posicion
        ? createPortal(
        <div
          id={idMenu}
          ref={menu}
          className="selector-menu"
          role="listbox"
          style={{
            top: posicion.top,
            bottom: posicion.bottom,
            left: posicion.left,
            width: posicion.width,
            maxHeight: posicion.alto,
          }}
          // Sostiene el foco en el input mientras se hace clic en una opción.
          onMouseDown={(evento) => evento.preventDefault()}
        >
          {rotuloMenu ? (
            <div className="selector-rotulo-menu">{rotuloMenu}</div>
          ) : null}

          {filtradas.map((opcion, indice) => {
            const elegida = valores.includes(opcion.valor);
            return (
              <button
                key={opcion.valor}
                type="button"
                role="option"
                aria-selected={elegida}
                className="selector-opcion"
                data-activa={indice === resaltada ? "si" : "no"}
                onMouseEnter={() => setActiva(indice)}
                onClick={() => elegir(opcion.valor)}
              >
                {opcion.etiqueta}
                {elegida ? <Tilde /> : null}
              </button>
            );
          })}

          {puedeCrear ? (
            <button
              type="button"
              role="option"
              aria-selected={false}
              className="selector-opcion selector-opcion-nueva"
              data-activa={resaltada === filtradas.length ? "si" : "no"}
              onMouseEnter={() => setActiva(filtradas.length)}
              onClick={crear}
            >
              Crear «{limpio}»
            </button>
          ) : null}

          {totalEntradas === 0 ? (
            <p className="selector-vacio">
              {creable
                ? "Escribí para crear una opción nueva."
                : "No hay opciones que coincidan."}
            </p>
          ) : null}
        </div>,
            document.body,
          )
        : null}
    </div>
  );
}
