// app/login/page.tsx
// Acceso al sistema. No hay registro público: los usuarios se cargan por SQL
// o desde la pantalla de Usuarios del administrador.

import { redirect } from "next/navigation";
import { getSesion } from "@/lib/auth";
import { Marca } from "@/app/(panel)/componentes/marca";
import { FormularioLogin } from "./formulario";

export const metadata = {
  title: "Gestión · Parque Ambiental Municipal",
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
        <div className="mb-4 flex items-center gap-3 border-b border-borde pb-0">
          <span className="marca-sigla">
            <Marca tamano={24} />
          </span>
          <h1 className="text-[17px] font-semibold text-texto">
            Parque Ambiental Municipal
          </h1>
        </div>

        <FormularioLogin desde={desde} />
      </div>
    </main>
  );
}
