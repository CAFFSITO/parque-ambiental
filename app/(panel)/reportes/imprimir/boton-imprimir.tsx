"use client";

// app/(panel)/reportes/imprimir/boton-imprimir.tsx
// Sin jsPDF ni html2canvas: el motor de impresión del navegador ya sabe
// hacer PDF, sale igual en cualquier máquina y no hay librería que pueda
// fallar durante la demostración.

export function BotonImprimir() {
  return (
    <button type="button" className="boton" onClick={() => window.print()}>
      Imprimir / Guardar como PDF
    </button>
  );
}
