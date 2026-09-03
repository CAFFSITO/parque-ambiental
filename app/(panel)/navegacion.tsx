"use client";

// app/(panel)/navegacion.tsx
// Los módulos, en sus dos formas: el cajón lateral de escritorio y la barra
// inferior de pantalla angosta. Los ítems los decide el layout según el rol;
// acá solo se marca cuál está activo.
//
// Cuál de las dos se ve lo resuelve CSS —md:hidden / hidden md:block— y no
// JavaScript: el servidor pinta las dos y el navegador oculta la que sobra,
// así no hay nada que medir al hidratar.

import type { CSSProperties } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icono, type NombreIcono } from "./componentes/iconos";

export type ItemNav = {
  etiqueta: string;
  href: string;
  icono: NombreIcono;
};

/** Igual que en el marco: "/" solo con "/", el resto también con sus hijas. */
export function esRutaActiva(href: string, ruta: string): boolean {
  if (href === "/") return ruta === "/";
  return ruta === href || ruta.startsWith(`${href}/`);
}

export function Navegacion({
  items,
  abierto,
  alNavegar,
}: {
  items: ItemNav[];
  abierto: boolean;
  alNavegar: () => void;
}) {
  const ruta = usePathname();

  return (
    // inert saca del tab y del árbol de accesibilidad lo que está cerrado:
    // el cajón sigue en el DOM para poder animarlo.
    <nav
      id="nav-lateral"
      className="nav-lateral hidden md:block"
      data-abierto={abierto ? "si" : "no"}
      aria-label="Módulos"
      inert={!abierto}
    >
      {items.map((item, indice) => (
        <Link
          key={item.href}
          href={item.href}
          className="nav-item"
          style={{ "--i": indice } as CSSProperties}
          data-activo={esRutaActiva(item.href, ruta) ? "si" : "no"}
          data-solo-movil={item.href === "/movil" ? "si" : "no"}
          onClick={alNavegar}
        >
          <Icono nombre={item.icono} className="nav-icono" />
          {item.etiqueta}
        </Link>
      ))}
    </nav>
  );
}

/**
 * Los mismos módulos, abajo y siempre a la vista. No tiene estado: en angosto
 * no hay cajón que abrir ni hamburguesa que tocar, se navega directo.
 *
 * Acá entra también "Móvil", que en el cajón de escritorio está oculto porque
 * esa pantalla solo tiene sentido con el teléfono en la mano.
 */
export function BarraInferior({ items }: { items: ItemNav[] }) {
  const ruta = usePathname();

  return (
    <nav className="barra-inferior md:hidden" aria-label="Módulos">
      {items.map((item) => {
        const activo = esRutaActiva(item.href, ruta);

        return (
          <Link
            key={item.href}
            href={item.href}
            className="barra-inferior-item"
            data-activo={activo ? "si" : "no"}
            aria-current={activo ? "page" : undefined}
          >
            <Icono
              nombre={item.icono}
              tamano={20}
              className="barra-inferior-icono"
            />
            <span className="barra-inferior-etiqueta">{item.etiqueta}</span>
          </Link>
        );
      })}
    </nav>
  );
}
