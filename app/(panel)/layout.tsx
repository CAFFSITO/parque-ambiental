// app/(panel)/layout.tsx
// Marco del panel: barra superior fija de 48 px y navegación lateral cuyos
// ítems dependen del rol.

import type { ReactNode } from "react";
import localFont from "next/font/local";
import { redirect } from "next/navigation";
import { getSesion } from "@/lib/auth";
import type { Rol } from "@/lib/tipos";
import { cerrarSesion } from "./acciones";
import { Navegacion, type ItemNav } from "./navegacion";

const gcFenture = localFont({
  src: [
    { path: "./gcfentura-hairline.ttf", weight: "100", style: "normal" },
    { path: "./gcfentura-thin.otf", weight: "200", style: "normal" },
    { path: "./gcfentura-extralight.ttf", weight: "300", style: "normal" },
    { path: "./gcfentura-light.ttf", weight: "400", style: "normal" },
    { path: "./gcfentura-regular.ttf", weight: "500", style: "normal" },
    { path: "./gcfentura-medium.ttf", weight: "600", style: "normal" },
    { path: "./gcfentura-semibold.ttf", weight: "700", style: "normal" },
    { path: "./gcfentura-bold.ttf", weight: "800", style: "normal" },
    { path: "./gcfentura-extrabold.ttf", weight: "900", style: "normal" },
  ],
  variable: "--font-gc-fenture",
  display: "swap",
});

const NAV_ADMINISTRADOR: ItemNav[] = [
  { etiqueta: "Tablero", href: "/" },
  { etiqueta: "Llamados", href: "/llamados" },
  { etiqueta: "Móvil", href: "/movil" },
  { etiqueta: "Áreas", href: "/areas" },
  { etiqueta: "Empleados", href: "/empleados" },
  { etiqueta: "Usuarios", href: "/usuarios" },
  { etiqueta: "Dispositivos", href: "/dispositivos" },
  { etiqueta: "Reportes", href: "/reportes" },
];

const NAV_EMPLEADO: ItemNav[] = [
  { etiqueta: "Tablero", href: "/" },
  { etiqueta: "Llamados", href: "/llamados" },
  { etiqueta: "Móvil", href: "/movil" },
];

function itemsPara(rol: Rol): ItemNav[] {
  return rol === "ADMINISTRADOR" ? NAV_ADMINISTRADOR : NAV_EMPLEADO;
}

export default async function LayoutPanel({
  children,
}: {
  children: ReactNode;
}) {
  const sesion = await getSesion();
  if (!sesion) redirect("/login");

  return (
    <div className={`${gcFenture.variable} superficie-panel`}>
      <header className="barra-superior">
        <div className="marca-panel">
          <span className="marca-sigla" aria-hidden="true">
            PA
          </span>
          <span className="marca-texto">
            <span className="marca-titulo">Parque Ambiental</span>
            <span className="marca-subtitulo">Municipalidad de Berisso</span>
          </span>
        </div>

        <div className="usuario-panel">
          <span className="usuario-identidad">
            <span className="usuario-nombre">{sesion.usuario}</span>
            <span className="usuario-rol">{sesion.rol}</span>
          </span>
          <form action={cerrarSesion}>
            <button type="submit" className="boton-plano">
              Salir
            </button>
          </form>
        </div>
      </header>

      <Navegacion items={itemsPara(sesion.rol)} />

      <main className="contenido-panel">
        <div className="contenido-panel-interior">{children}</div>
      </main>
    </div>
  );
}
