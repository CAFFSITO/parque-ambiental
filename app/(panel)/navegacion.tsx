"use client";

// app/(panel)/navegacion.tsx
// Navegación lateral de texto plano. Los ítems los decide el layout según
// el rol; acá solo se marca cuál está activo.

import Link from "next/link";
import { usePathname } from "next/navigation";

export type ItemNav = {
  etiqueta: string;
  href: string;
};

export function Navegacion({ items }: { items: ItemNav[] }) {
  const ruta = usePathname();

  return (
    <nav className="nav-lateral">
      {items.map((item, indice) => {
        const activo =
          item.href === "/"
            ? ruta === "/"
            : ruta === item.href || ruta.startsWith(`${item.href}/`);
        const indiceEscritorio = items
          .slice(0, indice + 1)
          .filter((opcion) => opcion.href !== "/movil").length;

        return (
          <Link
            key={item.href}
            href={item.href}
            className="nav-item"
            data-activo={activo ? "si" : "no"}
            data-solo-movil={item.href === "/movil" ? "si" : "no"}
          >
            <span className="nav-indice" aria-hidden="true">
              {String(indiceEscritorio).padStart(2, "0")}
            </span>
            <span>{item.etiqueta}</span>
          </Link>
        );
      })}
    </nav>
  );
}
