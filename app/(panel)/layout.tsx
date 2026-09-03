// app/(panel)/layout.tsx
// Marco del panel: barra superior fija de 48 px y navegación lateral cuyos
// ítems dependen del rol.

import type { ReactNode } from "react";
import Image from "next/image";
import { redirect } from "next/navigation";
import marcaBerisso from "../marca-berisso.png";
import { getSesion } from "@/lib/auth";
import type { Rol } from "@/lib/tipos";
import { cerrarSesion } from "./acciones";
import { MarcoPanel } from "./marco";
import type { ItemNav } from "./navegacion";

const NAV_ADMINISTRADOR: ItemNav[] = [
  { etiqueta: "Tablero", href: "/", icono: "tablero" },
  { etiqueta: "Llamados", href: "/llamados", icono: "llamados" },
  { etiqueta: "Móvil", href: "/movil", icono: "movil" },
  { etiqueta: "Áreas", href: "/areas", icono: "areas" },
  { etiqueta: "Empleados", href: "/empleados", icono: "empleados" },
  { etiqueta: "Usuarios", href: "/usuarios", icono: "usuarios" },
  { etiqueta: "Dispositivos", href: "/dispositivos", icono: "dispositivos" },
  { etiqueta: "Reportes", href: "/reportes", icono: "reportes" },
];

const NAV_EMPLEADO: ItemNav[] = [
  { etiqueta: "Tablero", href: "/", icono: "tablero" },
  { etiqueta: "Llamados", href: "/llamados", icono: "llamados" },
  { etiqueta: "Móvil", href: "/movil", icono: "movil" },
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
    <div className="superficie-panel">
      <header className="barra-superior">
        <div className="marca-panel">
          <span className="marca-sigla">
            <Image
              src={marcaBerisso}
              alt="Municipalidad de Berisso"
              width={22}
              height={28}
              priority
            />
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

      <MarcoPanel items={itemsPara(sesion.rol)}>{children}</MarcoPanel>
    </div>
  );
}
