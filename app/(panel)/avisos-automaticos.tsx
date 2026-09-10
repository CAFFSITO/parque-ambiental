"use client";

// app/(panel)/avisos-automaticos.tsx
// Los avisos vienen prendidos: apenas se entra al panel, este componente deja
// el dispositivo suscripto sin que haya que ir a buscar el interruptor. La
// pantalla de Avisos queda para lo contrario, apagarlos.
//
// Tres frenos, para que "por defecto" no signifique "insistente":
//   * si la persona los apagó en este dispositivo, no los vuelve a prender;
//   * el permiso se pide una sola vez por navegador. Si lo negó o cerró el
//     cartel, no se le pregunta más;
//   * si el permiso ya estaba dado, no aparece ningún cartel: solo se
//     restablece la suscripción, que es lo que pasa después de limpiar los
//     datos del sitio o de cambiar de máquina.

import { useEffect } from "react";
import {
  estaApagadoAca,
  soportaPush,
  suscribir,
} from "./componentes/push-cliente";
import { asegurarSuscripcion } from "./avisos/acciones";

/** Marca de "a este navegador ya se le preguntó". */
const CLAVE_PREGUNTADO = "pab_avisos_preguntado";

function yaSePregunto(): boolean {
  try {
    return window.localStorage.getItem(CLAVE_PREGUNTADO) === "1";
  } catch {
    return false;
  }
}

function marcarPreguntado(): void {
  try {
    window.localStorage.setItem(CLAVE_PREGUNTADO, "1");
  } catch {
    // Sin almacenamiento se preguntaría de nuevo en la próxima visita: es
    // molesto, no roto.
  }
}

export function AvisosAutomaticos({ clavePublica }: { clavePublica: string }) {
  useEffect(() => {
    let vigente = true;

    const enganchar = async () => {
      if (!soportaPush() || clavePublica === "") return;
      if (estaApagadoAca()) return;
      if (Notification.permission === "denied") return;

      // Sin permiso todavía: se pide una vez y nunca más.
      const pedir = Notification.permission === "default";
      if (pedir) {
        if (yaSePregunto()) return;
        marcarPreguntado();
      }

      const resultado = await suscribir(clavePublica, pedir);
      if (!vigente || !resultado.ok) return;

      await asegurarSuscripcion(resultado.suscripcion);
    };

    void enganchar();

    return () => {
      vigente = false;
    };
  }, [clavePublica]);

  return null;
}
