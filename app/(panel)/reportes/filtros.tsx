"use client";

// app/(panel)/reportes/filtros.tsx
// Los filtros viven en la URL: así el mismo rango alimenta los gráficos, la
// tabla, el CSV y la vista de impresión sin duplicar estado.

import { useRouter } from "next/navigation";
import type { Area } from "@/lib/tipos";
import {
  filtroAQueryString,
  type FiltroReporte,
} from "@/lib/reportes-comunes";
import { Campo } from "../componentes/campos";
import { Desplegable } from "../componentes/desplegable";
import { CampoFecha } from "../componentes/fecha";

/** Date -> "aaaa-mm-ddTHH:mm" en hora local del navegador. */
function aDatetimeLocal(fecha: Date): string {
  const dos = (valor: number) => String(valor).padStart(2, "0");
  return (
    `${fecha.getFullYear()}-${dos(fecha.getMonth() + 1)}-${dos(fecha.getDate())}` +
    `T${dos(fecha.getHours())}:${dos(fecha.getMinutes())}`
  );
}

export function FiltrosReporte({
  filtro,
  areas,
}: {
  filtro: FiltroReporte;
  areas: Area[];
}) {
  const router = useRouter();

  function aplicar(siguiente: FiltroReporte) {
    const consulta = filtroAQueryString(siguiente);
    router.replace(consulta === "" ? "/reportes" : `/reportes?${consulta}`);
  }

  function cambiar(campo: keyof FiltroReporte, valor: string) {
    aplicar({ ...filtro, [campo]: valor });
  }

  function rangoRelativo(dias: number | null) {
    if (dias === null) {
      aplicar({ ...filtro, desde: "", hasta: "" });
      return;
    }

    const hasta = new Date();
    const desde = new Date();

    if (dias === 0) {
      desde.setHours(0, 0, 0, 0);
    } else {
      desde.setDate(desde.getDate() - dias);
    }

    aplicar({
      ...filtro,
      desde: aDatetimeLocal(desde),
      hasta: aDatetimeLocal(hasta),
    });
  }

  const rangos = [
    { etiqueta: "Hoy", dias: 0 },
    { etiqueta: "Últimos 7 días", dias: 7 },
    { etiqueta: "Últimos 30 días", dias: 30 },
    { etiqueta: "Todo", dias: null },
  ];

  return (
    <section className="panel flex flex-wrap items-end gap-3 p-3">
      <div className="w-[220px]">
        <Campo etiqueta="Área" htmlFor="r-area">
          <Desplegable
            id="r-area"
            valor={filtro.area}
            opciones={[
              { valor: "", etiqueta: "Todas" },
              ...areas.map((area) => ({
                valor: String(area.id),
                etiqueta: `${area.codigo} — ${area.nombre}`,
              })),
            ]}
            alCambiar={(valor) => cambiar("area", valor)}
          />
        </Campo>
      </div>

      <div className="w-[160px]">
        <Campo etiqueta="Origen" htmlFor="r-origen">
          <Desplegable
            id="r-origen"
            valor={filtro.origen}
            opciones={[
              { valor: "", etiqueta: "Todos" },
              { valor: "SENSOR", etiqueta: "Sensor" },
              { valor: "EMPLEADO", etiqueta: "Empleado" },
            ]}
            alCambiar={(valor) => cambiar("origen", valor)}
          />
        </Campo>
      </div>

      <div className="w-[200px]">
        <Campo etiqueta="Desde" htmlFor="r-desde">
          <CampoFecha
            id="r-desde"
            conHora
            valor={filtro.desde}
            alCambiar={(valor) => cambiar("desde", valor)}
          />
        </Campo>
      </div>

      <div className="w-[200px]">
        <Campo etiqueta="Hasta" htmlFor="r-hasta">
          <CampoFecha
            id="r-hasta"
            conHora
            valor={filtro.hasta}
            alCambiar={(valor) => cambiar("hasta", valor)}
          />
        </Campo>
      </div>

      <div className="flex items-center gap-2">
        {rangos.map((rango) => (
          <button
            key={rango.etiqueta}
            type="button"
            className="boton-plano"
            onClick={() => rangoRelativo(rango.dias)}
          >
            {rango.etiqueta}
          </button>
        ))}
      </div>
    </section>
  );
}
