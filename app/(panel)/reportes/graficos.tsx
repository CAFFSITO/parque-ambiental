"use client";

// app/(panel)/reportes/graficos.tsx
// Los tres gráficos, compartidos por la pantalla de Reportes y por la vista
// de impresión. Recharts, con los colores de estado del sistema y nada más:
// sin animación de entrada, sin paleta decorativa, grilla tenue.

import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  FilaClima,
  FilaDistribucion,
  FilaPorArea,
  FilaPorDia,
} from "@/lib/reportes-comunes";
import { Desplegable } from "../componentes/desplegable";
import { particion } from "@/lib/reportes-comunes";
import { etiquetaEstado } from "@/lib/catalogos";

const VERDE = "#92a05b";
const AMBAR = "#d7ae67";
const TERRACOTA = "#c7785d";
const BORDE = "#345348";
const TENUE = "#a5b4aa";

/** Paleta por etiqueta: el color siempre significa estado, nunca adorna. */
const COLOR_POR_ETIQUETA: Record<string, string> = {
  ATENDIDO: VERDE,
  NO_ATENDIDO: AMBAR,
  NORMAL: VERDE,
  EMERGENCIA: TERRACOTA,
  SENSOR: VERDE,
  EMPLEADO: AMBAR,
};

const EJE = {
  stroke: TENUE,
  fontSize: 11,
  tickLine: false,
} as const;

/** dd/mm a partir de un date de Postgres, sin correr el día por zona. */
function diaCorto(dia: string): string {
  const [, mes, resto] = dia.split("-");
  return `${resto?.slice(0, 2) ?? ""}/${mes ?? ""}`;
}

function Marco({
  titulo,
  extra,
  children,
}: {
  titulo: string;
  extra?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="panel">
      <div className="flex items-center justify-between gap-3 border-b border-borde px-3 py-2">
        <span className="rotulo">{titulo}</span>
        {extra}
      </div>
      <div className="p-3">{children}</div>
    </section>
  );
}

const ESTILO_TOOLTIP = {
  backgroundColor: "#173129",
  border: `1px solid ${BORDE}`,
  borderRadius: 3,
  fontSize: 12,
  color: "#f5ead7",
} as const;

const ESTILO_LEYENDA = { fontSize: 11, color: TENUE } as const;

// ---------------------------------------------------------------------
// Barras: llamados por área, apilados Normal / Emergencia
// ---------------------------------------------------------------------
export function GraficoPorArea({
  datos,
  alto = 260,
}: {
  datos: FilaPorArea[];
  alto?: number;
}) {
  const filas = datos.map((fila) => ({
    codigo: fila.codigo,
    Normal: Number(fila.normal),
    Emergencia: Number(fila.emergencia),
  }));

  return (
    <Marco titulo="Llamados por área">
      <ResponsiveContainer width="100%" height={alto}>
        <BarChart data={filas} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
          <CartesianGrid stroke={BORDE} vertical={false} />
          <XAxis dataKey="codigo" {...EJE} axisLine={{ stroke: BORDE }} />
          <YAxis {...EJE} axisLine={{ stroke: BORDE }} allowDecimals={false} />
          <Tooltip contentStyle={ESTILO_TOOLTIP} cursor={{ fill: "#ffffff10" }} />
          <Legend wrapperStyle={ESTILO_LEYENDA} iconSize={8} />
          <Bar
            dataKey="Normal"
            stackId="a"
            fill={VERDE}
            isAnimationActive={false}
          />
          <Bar
            dataKey="Emergencia"
            stackId="a"
            fill={TERRACOTA}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </Marco>
  );
}

// ---------------------------------------------------------------------
// Torta: tres particiones seleccionables
// ---------------------------------------------------------------------
const PARTICIONES = [
  { clave: "estado", nombre: "Atendidos vs No atendidos" },
  { clave: "tipo", nombre: "Normal vs Emergencia" },
  { clave: "origen", nombre: "Sensor vs Empleado" },
];

export function GraficoDistribucion({
  datos,
  alto = 260,
  dimensionFija,
}: {
  datos: FilaDistribucion[];
  alto?: number;
  /** Si viene, no muestra el selector: lo usa la vista de impresión. */
  dimensionFija?: string;
}) {
  const [dimension, setDimension] = useState(dimensionFija ?? "estado");
  const activa = dimensionFija ?? dimension;
  // La etiqueta cruda sigue eligiendo el color; el nombre legible es lo que
  // se escribe en la torta y en el tooltip.
  const filas = particion(datos, activa).map((fila) => ({
    ...fila,
    nombre: etiquetaEstado(fila.etiqueta),
  }));

  const selector = dimensionFija ? undefined : (
    <Desplegable
      etiquetaAccesible="Partición de la torta"
      estilo={{ width: 220, height: 26 }}
      valor={dimension}
      opciones={PARTICIONES.map((opcion) => ({
        valor: opcion.clave,
        etiqueta: opcion.nombre,
      }))}
      alCambiar={setDimension}
    />
  );

  const titulo =
    PARTICIONES.find((opcion) => opcion.clave === activa)?.nombre ??
    "Distribución";

  return (
    <Marco titulo={dimensionFija ? titulo : "Distribución"} extra={selector}>
      {filas.length === 0 ? (
        <p className="text-tenue">Sin llamados en el rango elegido.</p>
      ) : (
        <ResponsiveContainer width="100%" height={alto}>
          <PieChart>
            <Pie
              data={filas}
              dataKey="cantidad"
              nameKey="nombre"
              innerRadius="45%"
              outerRadius="75%"
              isAnimationActive={false}
              stroke={BORDE}
              strokeWidth={1}
              label={(entrada: { name?: string; value?: number }) =>
                `${entrada.name ?? ""}: ${entrada.value ?? 0}`
              }
              labelLine={false}
            >
              {filas.map((fila) => (
                <Cell
                  key={fila.etiqueta}
                  fill={COLOR_POR_ETIQUETA[fila.etiqueta] ?? TENUE}
                />
              ))}
            </Pie>
            <Tooltip contentStyle={ESTILO_TOOLTIP} />
          </PieChart>
        </ResponsiveContainer>
      )}
    </Marco>
  );
}

// ---------------------------------------------------------------------
// Líneas: evolución diaria, o clima del área
// ---------------------------------------------------------------------
export function GraficoEvolucion({
  llamados,
  clima,
  alto = 260,
  serieFija,
}: {
  llamados: FilaPorDia[];
  clima: FilaClima[];
  alto?: number;
  /** "llamados" | "clima". Si viene, no muestra el selector. */
  serieFija?: string;
}) {
  const [serie, setSerie] = useState(serieFija ?? "llamados");
  const activa = serieFija ?? serie;

  const selector = serieFija ? undefined : (
    <Desplegable
      etiquetaAccesible="Serie del gráfico de evolución"
      estilo={{ width: 220, height: 26 }}
      valor={serie}
      opciones={[
        { valor: "llamados", etiqueta: "Llamados por día" },
        { valor: "clima", etiqueta: "Temperatura y humedad promedio" },
      ]}
      alCambiar={setSerie}
    />
  );

  if (activa === "clima") {
    const filas = clima.map((fila) => ({
      dia: diaCorto(fila.dia),
      Temperatura: fila.temp_prom === null ? null : Number(fila.temp_prom),
      Humedad: fila.hum_prom === null ? null : Number(fila.hum_prom),
    }));

    return (
      <Marco titulo="Temperatura y humedad promedio por día" extra={selector}>
        {filas.length === 0 ? (
          <p className="text-tenue">Sin lecturas en el rango elegido.</p>
        ) : (
          <ResponsiveContainer width="100%" height={alto}>
            <LineChart data={filas} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
              <CartesianGrid stroke={BORDE} vertical={false} />
              <XAxis dataKey="dia" {...EJE} axisLine={{ stroke: BORDE }} minTickGap={16} />
              <YAxis {...EJE} axisLine={{ stroke: BORDE }} />
              {/* Los promedios ya vienen redondeados a un decimal del motor. */}
              <Tooltip contentStyle={ESTILO_TOOLTIP} />
              <Legend wrapperStyle={ESTILO_LEYENDA} iconSize={8} />
              <Line
                type="monotone"
                dataKey="Temperatura"
                stroke={AMBAR}
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
                connectNulls
              />
              <Line
                type="monotone"
                dataKey="Humedad"
                stroke={VERDE}
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </Marco>
    );
  }

  const filas = llamados.map((fila) => ({
    dia: diaCorto(fila.dia),
    Normal: Number(fila.normal),
    Emergencia: Number(fila.emergencia),
  }));

  return (
    <Marco titulo="Evolución diaria de llamados" extra={selector}>
      {filas.length === 0 ? (
        <p className="text-tenue">Sin llamados en el rango elegido.</p>
      ) : (
        <ResponsiveContainer width="100%" height={alto}>
          <LineChart data={filas} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
            <CartesianGrid stroke={BORDE} vertical={false} />
            <XAxis dataKey="dia" {...EJE} axisLine={{ stroke: BORDE }} minTickGap={16} />
            <YAxis {...EJE} axisLine={{ stroke: BORDE }} allowDecimals={false} />
            <Tooltip contentStyle={ESTILO_TOOLTIP} />
            <Legend wrapperStyle={ESTILO_LEYENDA} iconSize={8} />
            <Line
              type="monotone"
              dataKey="Normal"
              stroke={VERDE}
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="Emergencia"
              stroke={TERRACOTA}
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </Marco>
  );
}
