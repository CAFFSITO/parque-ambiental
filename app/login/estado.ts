// app/login/estado.ts
// Tipo y valor inicial del formulario de acceso.
//
// Viven acá y no en acciones.ts porque un archivo "use server" solo puede
// exportar funciones async: exportar un objeto desde ahí compila, pero hace
// fallar la acción en tiempo de ejecución con
// "A 'use server' file can only export async functions, found object".

export type EstadoLogin = {
  error: string | null;
};

export const ESTADO_LOGIN_INICIAL: EstadoLogin = { error: null };
