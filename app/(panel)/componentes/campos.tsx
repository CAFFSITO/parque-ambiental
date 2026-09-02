"use client";

// app/(panel)/componentes/campos.tsx
// Campos de formulario en HTML plano, sin librerías. Solo agrupan rótulo,
// control y mensaje de error para no repetir markup en cada ficha.

import type { ReactNode } from "react";

export function Campo({
  etiqueta,
  htmlFor,
  ayuda,
  children,
}: {
  etiqueta: string;
  htmlFor?: string;
  ayuda?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="rotulo">
        {etiqueta}
      </label>
      {children}
      {ayuda ? <span className="text-tenue">{ayuda}</span> : null}
    </div>
  );
}

export function Aviso({
  texto,
  nivel = "EMERGENCIA",
}: {
  texto: string;
  nivel?: "EMERGENCIA" | "ADVERTENCIA" | "NORMAL";
}) {
  const clase =
    nivel === "EMERGENCIA"
      ? "border-emergencia/50 bg-emergencia/10 text-emergencia"
      : nivel === "ADVERTENCIA"
        ? "border-advertencia/50 bg-advertencia/10 text-advertencia"
        : "border-senal/50 bg-senal/10 text-senal";

  return (
    <p role="alert" className={`rounded-pab border px-2 py-1.5 ${clase}`}>
      {texto}
    </p>
  );
}

export function Etiqueta({
  texto,
  nivel,
}: {
  texto: string;
  nivel: "NORMAL" | "ADVERTENCIA" | "EMERGENCIA" | "NEUTRO";
}) {
  const color =
    nivel === "NORMAL"
      ? "text-normal"
      : nivel === "ADVERTENCIA"
        ? "text-advertencia"
        : nivel === "EMERGENCIA"
          ? "text-emergencia"
          : "text-tenue";

  return (
    <span className={color}>
      {nivel !== "NEUTRO" ? (
        <span className="punto" data-nivel={nivel} />
      ) : null}
      {texto}
    </span>
  );
}
