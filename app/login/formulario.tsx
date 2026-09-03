"use client";

// app/login/formulario.tsx

import { useActionState, useState } from "react";
import { accionLogin } from "./acciones";
import { ESTADO_LOGIN_INICIAL, type EstadoLogin } from "./estado";

/** Ojo abierto / tachado. Mismo trazo que el resto de los íconos del panel. */
function IconoOjo({ visible }: { visible: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {visible ? (
        <>
          <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
          <circle cx="12" cy="12" r="3" />
        </>
      ) : (
        <>
          <path d="M10.6 6.2A9.9 9.9 0 0 1 12 6.1c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3 3.9" />
          <path d="M6.6 7.9a17 17 0 0 0-4.1 4.7S6 19.1 12 19.1a9.4 9.4 0 0 0 4.2-1" />
          <path d="M10.1 10.4a3 3 0 0 0 4.2 4.2" />
          <path d="m3.5 3.5 17 17" />
        </>
      )}
    </svg>
  );
}

export function FormularioLogin({ desde }: { desde: string }) {
  const [estado, accion, pendiente] = useActionState<EstadoLogin, FormData>(
    accionLogin,
    ESTADO_LOGIN_INICIAL,
  );
  const [verClave, setVerClave] = useState(false);

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
        <div className="campo-clave">
          <input
            id="password"
            name="password"
            type={verClave ? "text" : "password"}
            autoComplete="current-password"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            required
            className="campo"
          />
          {/* El estado real lo comunica aria-pressed; el título solo acompaña. */}
          <button
            type="button"
            className="boton-ojo"
            onClick={() => setVerClave((actual) => !actual)}
            aria-controls="password"
            aria-pressed={verClave}
            aria-label={verClave ? "Ocultar contraseña" : "Mostrar contraseña"}
            title={verClave ? "Ocultar contraseña" : "Mostrar contraseña"}
          >
            <IconoOjo visible={verClave} />
          </button>
        </div>
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
