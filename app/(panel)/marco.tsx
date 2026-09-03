"use client";

// app/(panel)/marco.tsx
// Marco de cliente del panel: el botón hamburguesa, el cajón de navegación y
// el contenido. Los tres comparten un estado, así que viven juntos.
//
// El cajón no tapa la pantalla: cuando se abre, el contenido se corre y se
// achica para dejarle lugar. No hay velo, y la página sigue siendo usable con
// el menú desplegado.
//
// Debajo de 768 px no hay cajón ni hamburguesa: los módulos viven en una barra
// fija abajo. El cambio es solo de CSS, así que el estado de abierto/cerrado
// que hay acá simplemente no se usa en angosto.
//
// Además se cambia de módulo arrastrando o rodando en horizontal, tanto con
// el dedo como con trackpad. En angosto el arrastre además se ve: la pantalla
// sigue al dedo y por el costado asoma el módulo al que se está yendo.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { Icono } from "./componentes/iconos";
import {
  BarraInferior,
  Navegacion,
  esRutaActiva,
  type ItemNav,
} from "./navegacion";

/** Rueda horizontal acumulada que hace falta para saltar de módulo. */
const UMBRAL_RUEDA = 160;
/** Arrastre con el dedo que hace falta para saltar de módulo. */
const UMBRAL_TOQUE = 72;
/** Descanso después de un salto, para no encadenar varios con un solo gesto. */
const ESPERA_MS = 700;
/** Un gesto más lento que esto ya no es un arrastre, es un scroll. */
const TOQUE_MAX_MS = 700;
/** Lo que tarda la pantalla en terminar de salir antes de navegar. */
const SALIDA_MS = 240;
/** Lo que dura la entrada del módulo nuevo. Igual que en el CSS. */
const ENTRADA_MS = 300;
/** Recorrido mínimo para que el gesto se declare horizontal y empiece a mover. */
const UMBRAL_SEGUIR = 12;

function useEsAngosta(): boolean {
  return useSyncExternalStore(
    (avisar) => {
      const consulta = window.matchMedia("(max-width: 900px)");
      consulta.addEventListener("change", avisar);
      return () => consulta.removeEventListener("change", avisar);
    },
    () => window.matchMedia("(max-width: 900px)").matches,
    () => false,
  );
}

/**
 * Si el gesto empezó dentro de algo que puede correrse hacia ese lado —una
 * tabla ancha, un menú— el gesto es de ese contenedor y no del panel.
 */
function loAtrapaUnContenedor(inicio: EventTarget | null, hacia: number): boolean {
  let nodo = inicio instanceof HTMLElement ? inicio : null;

  while (nodo && nodo !== document.body) {
    const desborde = getComputedStyle(nodo).overflowX;
    const corrible =
      (desborde === "auto" || desborde === "scroll") &&
      nodo.scrollWidth > nodo.clientWidth + 1;

    if (corrible) {
      const alFinal =
        nodo.scrollLeft + nodo.clientWidth >= nodo.scrollWidth - 1;
      const alPrincipio = nodo.scrollLeft <= 1;
      // Solo suelta el gesto cuando ya no tiene para dónde correrse.
      if (!(hacia > 0 ? alFinal : alPrincipio)) return true;
    }

    nodo = nodo.parentElement;
  }

  return false;
}

/**
 * Lo que asoma al costado mientras se arrastra. El contenido real del módulo
 * no se puede pintar antes de navegar —todavía no se pidió al servidor— así
 * que lo que se ve venir es su identidad: el mismo ícono y el mismo nombre
 * que en la barra de abajo, sobre el fondo del panel.
 */
function AdelantoModulo({
  item,
  lado,
}: {
  item: ItemNav | undefined;
  lado: "anterior" | "siguiente";
}) {
  if (!item) return null;

  return (
    <aside className="adelanto-modulo md:hidden" data-lado={lado} aria-hidden>
      <span className="adelanto-marca">
        <Icono nombre={item.icono} tamano={30} />
        <span className="adelanto-etiqueta">{item.etiqueta}</span>
      </span>
    </aside>
  );
}

export function MarcoPanel({
  items,
  children,
}: {
  items: ItemNav[];
  children: ReactNode;
}) {
  const router = useRouter();
  const ruta = usePathname();
  const angosta = useEsAngosta();
  const [abierto, setAbierto] = useState(false);

  // En escritorio, /movil redirige al tablero: no entra en la vuelta.
  const orden = useMemo(
    () => items.filter((item) => angosta || item.href !== "/movil"),
    [items, angosta],
  );

  // Los módulos de al lado sirven para dos cosas: saber si el gesto tiene a
  // dónde ir, y pintar el adelanto que asoma mientras se arrastra.
  const actual = orden.findIndex((item) => esRutaActiva(item.href, ruta));
  const anterior = actual > 0 ? orden[actual - 1] : undefined;
  const siguiente = actual >= 0 ? orden[actual + 1] : undefined;

  const saltar = useCallback(
    (direccion: 1 | -1) => {
      const destino = direccion > 0 ? siguiente : anterior;
      if (!destino) return false;

      router.push(destino.href);
      return true;
    },
    [anterior, siguiente, router],
  );

  useEffect(() => {
    if (!abierto) return;

    const teclado = (evento: KeyboardEvent) => {
      if (evento.key === "Escape") setAbierto(false);
    };
    document.addEventListener("keydown", teclado);
    return () => document.removeEventListener("keydown", teclado);
  }, [abierto]);

  // -- Cambio de módulo por gesto horizontal ----------------------------
  const acumulado = useRef(0);
  const ultimoSalto = useRef(0);
  const ultimaRueda = useRef(0);
  const toque = useRef<{ x: number; y: number; en: number } | null>(null);
  /** El gesto ya se declaró horizontal y la pantalla está siguiendo al dedo. */
  const siguiendo = useRef(false);
  /** Hacia dónde se fue, para que el módulo nuevo entre por ese mismo lado. */
  const entrada = useRef<1 | -1 | null>(null);
  const pista = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const enDescanso = () => Date.now() - ultimoSalto.current < ESPERA_MS;

    const rueda = (evento: WheelEvent) => {
      // Diagonal o vertical: no es un cambio de módulo.
      if (Math.abs(evento.deltaX) <= Math.abs(evento.deltaY) * 1.5) return;
      if (enDescanso()) return;
      if (loAtrapaUnContenedor(evento.target, evento.deltaX)) return;

      const ahora = Date.now();
      // Si pasó un rato desde el último tramo, el gesto anterior terminó.
      if (ahora - ultimaRueda.current > 320) acumulado.current = 0;
      ultimaRueda.current = ahora;

      acumulado.current += evento.deltaX;

      if (Math.abs(acumulado.current) < UMBRAL_RUEDA) return;

      const direccion = acumulado.current > 0 ? 1 : -1;
      acumulado.current = 0;
      if (saltar(direccion)) ultimoSalto.current = ahora;
    };

    const relojes: number[] = [];

    /**
     * Saca el transform de la pista. En reposo tiene que quedar sin él: con un
     * transform puesto, la pista pasa a ser el bloque contenedor de todo lo
     * que tenga adentro en position fixed, y los modales quedarían recortados
     * dentro de ella en vez de ocupar la pantalla.
     */
    const apagar = () => {
      const nodo = pista.current;
      if (nodo && !siguiendo.current) nodo.dataset.activa = "no";
    };

    /** Deja de seguir al dedo y manda la pantalla a donde se le diga. */
    const soltar = (hasta: string) => {
      siguiendo.current = false;
      const nodo = pista.current;
      if (!nodo) return;
      nodo.dataset.arrastrando = "no";
      nodo.style.setProperty("--desliz", hasta);
    };

    const empieza = (evento: TouchEvent) => {
      const dedo = evento.touches[0];
      if (!dedo || evento.touches.length > 1) {
        soltar("0px");
        apagar();
        toque.current = null;
        return;
      }
      toque.current = { x: dedo.clientX, y: dedo.clientY, en: Date.now() };
    };

    const mueve = (evento: TouchEvent) => {
      const inicio = toque.current;
      const nodo = pista.current;
      const dedo = evento.touches[0];
      if (!inicio || !nodo || !dedo) return;

      const dx = dedo.clientX - inicio.x;
      const dy = dedo.clientY - inicio.y;

      // Hasta que el gesto no se declara horizontal no se mueve nada: si era
      // un scroll vertical, la página tiene que bajar como siempre.
      if (!siguiendo.current) {
        if (Math.abs(dx) < UMBRAL_SEGUIR) return;
        if (Math.abs(dx) <= Math.abs(dy) * 1.4) {
          toque.current = null;
          return;
        }
        // El corte entre angosto y escritorio vive en el CSS —desde md la
        // pista es display:contents— así que en vez de medir la ventana se le
        // pregunta a la pista qué está siendo: un solo punto de verdad.
        if (getComputedStyle(nodo).display === "contents") return;
        if (enDescanso() || loAtrapaUnContenedor(evento.target, -dx)) {
          toque.current = null;
          return;
        }
        // Con un modal abierto el gesto es del diálogo, no del panel.
        if (document.querySelector(".capa-modal")) {
          toque.current = null;
          return;
        }

        siguiendo.current = true;
        nodo.dataset.activa = "si";
        nodo.dataset.arrastrando = "si";
        nodo.dataset.entrando = "no";
      }

      // Sin módulo de ese lado el arrastre casi no responde: se nota que la
      // vuelta se terminó, en vez de dejar la pantalla en blanco.
      const hay = dx < 0 ? siguiente : anterior;
      nodo.style.setProperty("--desliz", `${hay ? dx : dx * 0.26}px`);
    };

    const termina = (evento: TouchEvent) => {
      const inicio = toque.current;
      toque.current = null;

      if (!siguiendo.current) return;

      const dedo = evento.changedTouches[0];
      const dx = inicio && dedo ? dedo.clientX - inicio.x : 0;
      const duracion = inicio ? Date.now() - inicio.en : Infinity;
      const direccion: 1 | -1 = dx < 0 ? 1 : -1;
      const destino = direccion > 0 ? siguiente : anterior;

      // Corto, lento o sin módulo del otro lado: la pantalla vuelve a su sitio.
      if (!destino || duracion > TOQUE_MAX_MS || Math.abs(dx) < UMBRAL_TOQUE) {
        soltar("0px");
        relojes.push(window.setTimeout(apagar, ENTRADA_MS));
        return;
      }

      // Termina de correr la pantalla y recién ahí navega, para que el módulo
      // nuevo entre por el mismo lado por el que salió el anterior.
      soltar(direccion > 0 ? "-100%" : "100%");
      ultimoSalto.current = Date.now();
      entrada.current = direccion;

      relojes.push(
        window.setTimeout(() => {
          router.push(destino.href);
          // Red de seguridad: si la navegación no llega, la pantalla no puede
          // quedarse corrida y vacía.
          relojes.push(
            window.setTimeout(() => {
              soltar("0px");
              apagar();
            }, 1600),
          );
        }, SALIDA_MS),
      );
    };

    window.addEventListener("wheel", rueda, { passive: true });
    window.addEventListener("touchstart", empieza, { passive: true });
    window.addEventListener("touchmove", mueve, { passive: true });
    window.addEventListener("touchend", termina, { passive: true });
    window.addEventListener("touchcancel", termina, { passive: true });

    return () => {
      window.removeEventListener("wheel", rueda);
      window.removeEventListener("touchstart", empieza);
      window.removeEventListener("touchmove", mueve);
      window.removeEventListener("touchend", termina);
      window.removeEventListener("touchcancel", termina);
      relojes.forEach(window.clearTimeout);
    };
  }, [saltar, anterior, siguiente, router]);

  // Al llegar al módulo nuevo el corrimiento se apaga sin animarlo —ya está en
  // su lugar— y el contenido entra desde el lado por el que se arrastró.
  useEffect(() => {
    const nodo = pista.current;
    if (!nodo) return;

    nodo.dataset.arrastrando = "si";
    nodo.style.setProperty("--desliz", "0px");
    void nodo.offsetWidth; // fuerza el reflujo: la vuelta a cero no se anima
    nodo.dataset.arrastrando = "no";

    const direccion = entrada.current;
    entrada.current = null;

    if (!direccion) {
      nodo.dataset.activa = "no";
      return;
    }

    nodo.dataset.entrando = direccion > 0 ? "siguiente" : "anterior";
    const reloj = window.setTimeout(() => {
      nodo.dataset.entrando = "no";
      nodo.dataset.activa = "no";
    }, ENTRADA_MS);

    return () => window.clearTimeout(reloj);
  }, [ruta]);

  return (
    <>
      <button
        type="button"
        className="boton-menu hidden md:flex"
        data-abierto={abierto ? "si" : "no"}
        aria-label={abierto ? "Cerrar menú" : "Abrir menú"}
        aria-expanded={abierto}
        aria-controls="nav-lateral"
        onClick={() => setAbierto((actual) => !actual)}
      >
        <span className="boton-menu-linea" />
        <span className="boton-menu-linea" />
        <span className="boton-menu-linea" />
      </button>

      <Navegacion
        items={items}
        abierto={abierto}
        alNavegar={() => setAbierto(false)}
      />

      <BarraInferior items={items} />

      {/* La pista es la que se corre con el dedo. Desde md es display:contents,
          o sea que en escritorio no existe como caja y el marco queda igual
          que siempre: ni un envoltorio de más en el layout. */}
      <div
        ref={pista}
        className="pista-modulos"
        data-activa="no"
        data-arrastrando="no"
        data-entrando="no"
      >
        <AdelantoModulo item={anterior} lado="anterior" />

        <main
          className="contenido-panel"
          data-menu={abierto ? "abierto" : "cerrado"}
        >
          <div className="contenido-panel-interior">{children}</div>
        </main>

        <AdelantoModulo item={siguiente} lado="siguiente" />
      </div>
    </>
  );
}
