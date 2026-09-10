// app/(panel)/layout.tsx
// Marco del panel: barra superior fija de 48 px y navegación lateral cuyos
// ítems dependen del rol.

import type { ReactNode } from "react";
import { exigirSesion } from "@/lib/auth";
import type { Rol } from "@/lib/tipos";
import { cerrarSesion } from "./acciones";
import { AvisosAutomaticos } from "./avisos-automaticos";
import { Marca } from "./componentes/marca";
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
  { etiqueta: "Avisos", href: "/avisos", icono: "avisos" },
];

const NAV_EMPLEADO: ItemNav[] = [
  { etiqueta: "Tablero", href: "/", icono: "tablero" },
  { etiqueta: "Llamados", href: "/llamados", icono: "llamados" },
  { etiqueta: "Móvil", href: "/movil", icono: "movil" },
  { etiqueta: "Avisos", href: "/avisos", icono: "avisos" },
];

function itemsPara(rol: Rol): ItemNav[] {
  return rol === "ADMINISTRADOR" ? NAV_ADMINISTRADOR : NAV_EMPLEADO;
}

export default async function LayoutPanel({
  children,
}: {
  children: ReactNode;
}) {
  const sesion = await exigirSesion();

  return (
    <div className="superficie-panel">
      <header className="barra-superior">
        <div className="marca-panel">
          <span className="marca-logotipo">
            <Marca alto={22} />
          </span>
          <span className="marca-texto">
            <span className="marca-titulo">Parque Ambiental</span>
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

      {/* Deja este dispositivo suscripto apenas se entra. Se apaga desde
          Avisos, y esa decisión se respeta. */}
      <AvisosAutomaticos
        clavePublica={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ""}
      />
    </div>
  );
}
