"use client";

// app/login/formulario.tsx

import { useActionState } from "react";
import { accionLogin } from "./acciones";
import { ESTADO_LOGIN_INICIAL, type EstadoLogin } from "./estado";

export function FormularioLogin({ desde }: { desde: string }) {
  const [estado, accion, pendiente] = useActionState<EstadoLogin, FormData>(
    accionLogin,
    ESTADO_LOGIN_INICIAL,
  );

  return (
    <form action={accion} className="flex flex-col gap-3">
      <input type="hidden" name="desde" value={desde} />

      <div className="flex flex-col gap-1.5">
        <label htmlFor="usuario" className="rotulo">
          Usuario
        </label>
        <input
          id="usuario"
          name="usuario"
          type="text"
          autoComplete="username"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          required
          autoFocus
          className="campo"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="password" className="rotulo">
          Contraseña
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="campo"
        />
      </div>

      {estado.error ? (
        <p
          role="alert"
          className="border border-emergencia/50 bg-emergencia/10 px-2 py-1.5 text-emergencia"
          style={{ borderRadius: "3px" }}
        >
          {estado.error}
        </p>
      ) : null}

      <button type="submit" className="boton mt-1" disabled={pendiente}>
        {pendiente ? "Verificando…" : "Ingresar"}
      </button>
    </form>
  );
}
