// app/login/page.tsx
// Acceso al sistema. No hay registro público: los usuarios se cargan por SQL
// o desde la pantalla de Usuarios del administrador.

import { redirect } from "next/navigation";
import { getSesion } from "@/lib/auth";
import { FormularioLogin } from "./formulario";

export const metadata = {
  title: "Acceso · Parque Ambiental Municipal de Berisso",
};

export default async function PaginaLogin(props: PageProps<"/login">) {
  const sesion = await getSesion();
  if (sesion) redirect("/");

  const parametros = await props.searchParams;
  const crudo = parametros.desde;
  const desde =
    typeof crudo === "string" && crudo.startsWith("/") && !crudo.startsWith("//")
      ? crudo
      : "/";

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="panel w-full max-w-[340px] p-5">
        <div className="mb-4 border-b border-borde pb-3">
          <p className="rotulo">Municipalidad de Berisso</p>
          <h1 className="mt-1 text-[15px] font-semibold text-texto">
            Parque Ambiental Municipal
          </h1>
          <p className="mt-1 text-tenue">Sistema de gestión y monitoreo</p>
        </div>

        <FormularioLogin desde={desde} />

        <p className="mt-4 border-t border-borde pt-3 text-tenue">
          Acceso restringido al personal del parque.
        </p>
      </div>
    </main>
  );
}
