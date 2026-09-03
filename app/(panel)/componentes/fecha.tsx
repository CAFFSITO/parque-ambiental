"use client";

// app/(panel)/componentes/fecha.tsx
// Campo de fecha (y de fecha con hora) propio. No usa input type="date" ni
// type="datetime-local" porque el navegador impone ahí su propio calendario
// —el de Chrome, de aire Material— que no se puede tocar por CSS y no tiene
// nada que ver con el resto del panel.
//
// Se escribe a mano en dd/mm/aaaa (o dd/mm/aaaa hh:mm) o se elige del
// calendario. El valor que sale es siempre ISO: "AAAA-MM-DD" o
// "AAAA-MM-DDTHH:mm", igual que devolvía el input nativo.
//
// El menú se monta en document.body y se ubica midiendo la caja, por lo mismo
// que el Selector: un ancestro con transform vuelve relativo el position fixed.

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
import { Desplegable } from "./desplegable";

type Posicion = { top: number; left: number; ancho: number };

type Partes = {
  anio: number;
  mes: number;
  dia: number;
  hora: number;
  minuto: number;
};

const DIAS = ["LU", "MA", "MI", "JU", "VI", "SA", "DO"];

const MESES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

const ISO = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?$/;
const TIPEADO =
  /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})(?:[\s,]+(\d{1,2}):(\d{2}))?$/;

const ANCHO_MENU = 292;

function dosDigitos(numero: number): string {
  return String(numero).padStart(2, "0");
}

function diasDelMes(anio: number, mes: number): number {
  return new Date(anio, mes + 1, 0).getDate();
}

/** Toda la aritmética es con año/mes/día locales: nada de toISOString(). */
function leerISO(valor: string): Partes | null {
  const coincidencia = ISO.exec(valor.trim());
  if (!coincidencia) return null;

  const anio = Number(coincidencia[1]);
  const mes = Number(coincidencia[2]) - 1;
  const dia = Number(coincidencia[3]);
  const hora = coincidencia[4] === undefined ? 0 : Number(coincidencia[4]);
  const minuto = coincidencia[5] === undefined ? 0 : Number(coincidencia[5]);

  if (mes < 0 || mes > 11) return null;
  if (dia < 1 || dia > diasDelMes(anio, mes)) return null;
  if (hora > 23 || minuto > 59) return null;

  return { anio, mes, dia, hora, minuto };
}

function armarISO(partes: Partes, conHora: boolean): string {
  const fecha = `${partes.anio}-${dosDigitos(partes.mes + 1)}-${dosDigitos(partes.dia)}`;
  if (!conHora) return fecha;
  return `${fecha}T${dosDigitos(partes.hora)}:${dosDigitos(partes.minuto)}`;
}

function aTexto(valor: string, conHora: boolean): string {
  const partes = leerISO(valor);
  if (!partes) return "";

  const fecha = `${dosDigitos(partes.dia)}/${dosDigitos(partes.mes + 1)}/${partes.anio}`;
  if (!conHora) return fecha;
  return `${fecha} ${dosDigitos(partes.hora)}:${dosDigitos(partes.minuto)}`;
}

/** "" si está vacío, el ISO si se entiende, null si no hay manera de leerlo. */
function desdeTexto(texto: string, conHora: boolean): string | null {
  const limpio = texto.trim();
  if (limpio === "") return "";

  const coincidencia = TIPEADO.exec(limpio);
  if (!coincidencia) return null;

  const dia = Number(coincidencia[1]);
  const mes = Number(coincidencia[2]) - 1;
  const crudo = Number(coincidencia[3]);
  // Año de dos dígitos: 00-69 va al 2000, 70-99 al 1900. Sirve para fechas de
  // nacimiento, que es donde se tipea el año corto.
  const anio =
    coincidencia[3].length <= 2
      ? crudo < 70
        ? 2000 + crudo
        : 1900 + crudo
      : crudo;

  const hora = coincidencia[4] === undefined ? 0 : Number(coincidencia[4]);
  const minuto = coincidencia[5] === undefined ? 0 : Number(coincidencia[5]);

  if (mes < 0 || mes > 11) return null;
  if (dia < 1 || dia > diasDelMes(anio, mes)) return null;
  if (hora > 23 || minuto > 59) return null;

  return armarISO({ anio, mes, dia, hora, minuto }, conHora);
}

function Flecha({ doble, atras }: { doble?: boolean; atras?: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={atras ? { transform: "scaleX(-1)" } : undefined}
    >
      {doble ? (
        <path d="m6 18 6-6-6-6M13 18l6-6-6-6" />
      ) : (
        <path d="m9 18 6-6-6-6" />
      )}
    </svg>
  );
}

function Calendario() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  );
}

export function CampoFecha({
  id,
  valor,
  alCambiar,
  conHora = false,
  deshabilitado = false,
}: {
  id?: string;
  valor: string;
  alCambiar: (valor: string) => void;
  conHora?: boolean;
  deshabilitado?: boolean;
}) {
  const contenedor = useRef<HTMLDivElement>(null);
  const caja = useRef<HTMLDivElement>(null);
  const entrada = useRef<HTMLInputElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const idMenu = useId();

  const [abierto, setAbierto] = useState(false);
  const [posicion, setPosicion] = useState<Posicion | null>(null);
  const [texto, setTexto] = useState(() => aTexto(valor, conHora));

  const elegido = useMemo(() => leerISO(valor), [valor]);

  const hoy = useMemo(() => {
    const ahora = new Date();
    return {
      anio: ahora.getFullYear(),
      mes: ahora.getMonth(),
      dia: ahora.getDate(),
    };
  }, []);

  const [visible, setVisible] = useState(() => ({
    anio: elegido?.anio ?? hoy.anio,
    mes: elegido?.mes ?? hoy.mes,
  }));

  // El valor puede cambiar desde afuera (limpiar filtros, abrir otra ficha).
  // Mientras se está tipeando no se pisa: el foco manda.
  useEffect(() => {
    if (document.activeElement === entrada.current) return;
    setTexto(aTexto(valor, conHora));
  }, [valor, conHora]);

  const medir = useCallback(() => {
    const nodo = caja.current;
    if (!nodo) return;

    const rect = nodo.getBoundingClientRect();
    const alto = conHora ? 372 : 330;
    const abajo = window.innerHeight - rect.bottom;
    const arriba = abajo < alto && rect.top > abajo;

    setPosicion({
      top: arriba ? Math.max(8, rect.top - alto - 6) : rect.bottom + 6,
      left: Math.min(
        Math.max(8, rect.left),
        Math.max(8, window.innerWidth - ANCHO_MENU - 8),
      ),
      ancho: ANCHO_MENU,
    });
  }, [conHora]);

  useLayoutEffect(() => {
    if (!abierto) return;
    medir();
  }, [abierto, medir]);

  useEffect(() => {
    if (!abierto) return;

    const recalcular = () => medir();
    window.addEventListener("scroll", recalcular, true);
    window.addEventListener("resize", recalcular);

    // El menú vive fuera del componente (portal), así que se comprueba aparte.
    const afuera = (evento: PointerEvent) => {
      const destino = evento.target as Node;
      if (contenedor.current?.contains(destino)) return;
      if (menu.current?.contains(destino)) return;
      if ((destino as HTMLElement).closest?.(".desplegable-menu")) return;
      setAbierto(false);
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
    setVisible({
      anio: elegido?.anio ?? hoy.anio,
      mes: elegido?.mes ?? hoy.mes,
    });
    setAbierto(true);
  }

  function confirmarTexto() {
    const leido = desdeTexto(texto, conHora);
    if (leido === null) {
      // No se entiende: se vuelve a lo último válido en vez de borrar.
      setTexto(aTexto(valor, conHora));
      return;
    }
    if (leido !== valor) alCambiar(leido);
    setTexto(aTexto(leido, conHora));
  }

  function elegirDia(anio: number, mes: number, dia: number) {
    alCambiar(
      armarISO(
        {
          anio,
          mes,
          dia,
          hora: elegido?.hora ?? 0,
          minuto: elegido?.minuto ?? 0,
        },
        conHora,
      ),
    );
    // Con hora el menú sigue abierto: falta elegirla.
    if (!conHora) setAbierto(false);
  }

  function cambiarHora(campo: "hora" | "minuto", numero: number) {
    const base = elegido ?? { ...hoy, hora: 0, minuto: 0 };
    alCambiar(armarISO({ ...base, [campo]: numero }, conHora));
  }

  function correr(meses: number) {
    setVisible((actual) => {
      const fecha = new Date(actual.anio, actual.mes + meses, 1);
      return { anio: fecha.getFullYear(), mes: fecha.getMonth() };
    });
  }

  // Seis semanas fijas: la grilla no cambia de alto al pasar de mes.
  const celdas = useMemo(() => {
    const primero = new Date(visible.anio, visible.mes, 1);
    const corrimiento = (primero.getDay() + 6) % 7;

    return Array.from({ length: 42 }, (_, indice) => {
      const fecha = new Date(visible.anio, visible.mes, indice - corrimiento + 1);
      return {
        anio: fecha.getFullYear(),
        mes: fecha.getMonth(),
        dia: fecha.getDate(),
        delMes: fecha.getMonth() === visible.mes,
      };
    });
  }, [visible]);

  return (
    <div className="fecha" ref={contenedor} data-abierto={abierto ? "si" : "no"}>
      <div className="fecha-caja" ref={caja}>
        <input
          id={id}
          ref={entrada}
          type="text"
          className="fecha-entrada"
          inputMode="numeric"
          autoComplete="off"
          disabled={deshabilitado}
          placeholder={conHora ? "dd/mm/aaaa hh:mm" : "dd/mm/aaaa"}
          value={texto}
          onChange={(evento) => setTexto(evento.target.value)}
          onBlur={confirmarTexto}
          onKeyDown={(evento) => {
            if (evento.key === "Enter") {
              evento.preventDefault();
              confirmarTexto();
              setAbierto(false);
              return;
            }
            if (evento.key === "Escape" && abierto) {
              evento.preventDefault();
              setAbierto(false);
            }
          }}
        />

        <button
          type="button"
          className="fecha-boton"
          aria-haspopup="dialog"
          aria-expanded={abierto}
          aria-controls={abierto ? idMenu : undefined}
          aria-label={abierto ? "Cerrar calendario" : "Abrir calendario"}
          disabled={deshabilitado}
          onClick={() => (abierto ? setAbierto(false) : abrir())}
        >
          <Calendario />
        </button>
      </div>

      {abierto && posicion
        ? createPortal(
            <div
              id={idMenu}
              ref={menu}
              role="dialog"
              aria-label="Calendario"
              className="fecha-menu"
              style={{
                top: posicion.top,
                left: posicion.left,
                width: posicion.ancho,
              }}
              onKeyDown={(evento) => {
                if (evento.key !== "Escape") return;
                evento.preventDefault();
                setAbierto(false);
                entrada.current?.focus();
              }}
            >
              <div className="fecha-cabecera">
                <button
                  type="button"
                  className="fecha-paso"
                  aria-label="Año anterior"
                  onClick={() => correr(-12)}
                >
                  <Flecha doble atras />
                </button>
                <button
                  type="button"
                  className="fecha-paso"
                  aria-label="Mes anterior"
                  onClick={() => correr(-1)}
                >
                  <Flecha atras />
                </button>

                <span className="fecha-mes" aria-live="polite">
                  {MESES[visible.mes]} {visible.anio}
                </span>

                <button
                  type="button"
                  className="fecha-paso"
                  aria-label="Mes siguiente"
                  onClick={() => correr(1)}
                >
                  <Flecha />
                </button>
                <button
                  type="button"
                  className="fecha-paso"
                  aria-label="Año siguiente"
                  onClick={() => correr(12)}
                >
                  <Flecha doble />
                </button>
              </div>

              <div className="fecha-semana" aria-hidden="true">
                {DIAS.map((dia) => (
                  <span key={dia}>{dia}</span>
                ))}
              </div>

              <div className="fecha-grilla">
                {celdas.map((celda) => {
                  const esElegido =
                    elegido !== null &&
                    elegido.anio === celda.anio &&
                    elegido.mes === celda.mes &&
                    elegido.dia === celda.dia;
                  const esHoy =
                    hoy.anio === celda.anio &&
                    hoy.mes === celda.mes &&
                    hoy.dia === celda.dia;

                  return (
                    <button
                      key={`${celda.anio}-${celda.mes}-${celda.dia}`}
                      type="button"
                      className="fecha-dia"
                      data-fuera={celda.delMes ? "no" : "si"}
                      data-elegido={esElegido ? "si" : "no"}
                      data-hoy={esHoy ? "si" : "no"}
                      aria-pressed={esElegido}
                      onClick={() => elegirDia(celda.anio, celda.mes, celda.dia)}
                    >
                      {celda.dia}
                    </button>
                  );
                })}
              </div>

              {conHora ? (
                <div className="fecha-hora">
                  <span className="rotulo">Hora</span>
                  <Desplegable
                    etiquetaAccesible="Hora"
                    estilo={{ width: 76, height: 34 }}
                    valor={dosDigitos(elegido?.hora ?? 0)}
                    opciones={Array.from({ length: 24 }, (_, hora) => ({
                      valor: dosDigitos(hora),
                      etiqueta: dosDigitos(hora),
                    }))}
                    alCambiar={(nuevo) => cambiarHora("hora", Number(nuevo))}
                  />
                  <span className="fecha-dospuntos">:</span>
                  <Desplegable
                    etiquetaAccesible="Minutos"
                    estilo={{ width: 76, height: 34 }}
                    valor={dosDigitos(elegido?.minuto ?? 0)}
                    opciones={Array.from({ length: 60 }, (_, minuto) => ({
                      valor: dosDigitos(minuto),
                      etiqueta: dosDigitos(minuto),
                    }))}
                    alCambiar={(nuevo) => cambiarHora("minuto", Number(nuevo))}
                  />
                </div>
              ) : null}

              <div className="fecha-pie">
                <button
                  type="button"
                  className="boton-plano boton-chico"
                  onClick={() => {
                    alCambiar("");
                    setTexto("");
                    setAbierto(false);
                    entrada.current?.focus();
                  }}
                >
                  Borrar
                </button>
                <button
                  type="button"
                  className="boton boton-chico"
                  onClick={() => {
                    setVisible({ anio: hoy.anio, mes: hoy.mes });
                    elegirDia(hoy.anio, hoy.mes, hoy.dia);
                  }}
                >
                  Hoy
                </button>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
