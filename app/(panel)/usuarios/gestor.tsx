"use client";

// app/(panel)/usuarios/gestor.tsx
// Alta desde la nómina, edición de rol, activación y reseteo de contraseña.
// Los candados sobre uno mismo también se aplican en el servidor: acá solo
// se desactivan los controles para no ofrecer algo que va a fallar.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LARGO_MINIMO_PASSWORD, ROLES, sugerirUsuario } from "@/lib/catalogos";
import { SIN_DATO } from "@/lib/formato";
import type { Area, Empleado, Rol, Sesion, Usuario } from "@/lib/tipos";
import { Aviso, Campo } from "../componentes/campos";
import { Desplegable } from "../componentes/desplegable";
import { Icono } from "../componentes/iconos";
import { Chip, Dato, FilaDesplegable, Lista } from "../componentes/lista";
import { ConfirmarModal, Modal, ModalFicha } from "../componentes/modal";
import {
  cambiarActivoUsuario,
  cambiarRolUsuario,
  crearUsuario,
  eliminarUsuario,
  resetearPassword,
} from "./acciones";

export type UsuarioListado = Omit<Usuario, "password_hash">;

type FichaNueva = {
  empleado_id: number | null;
  usuario: string;
  password: string;
  rol: Rol;
};

const FICHA_NUEVA_VACIA: FichaNueva = {
  empleado_id: null,
  usuario: "",
  password: "",
  rol: "EMPLEADO",
};

type Confirmacion = {
  titulo: string;
  mensaje: string;
  textoConfirmar: string;
  peligro: boolean;
  ejecutar: () => Promise<{ ok: boolean; texto: string }>;
};

export function GestorUsuarios({
  usuarios,
  empleados,
  areas,
  sesion,
}: {
  usuarios: UsuarioListado[];
  empleados: Empleado[];
  areas: Area[];
  sesion: Sesion;
}) {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();

  const [ficha, setFicha] = useState<FichaNueva | null>(null);
  const [errorFicha, setErrorFicha] = useState<string | null>(null);
  const [aReset, setAReset] = useState<UsuarioListado | null>(null);
  const [passwordNueva, setPasswordNueva] = useState("");
  const [errorReset, setErrorReset] = useState<string | null>(null);
  const [confirmacion, setConfirmacion] = useState<Confirmacion | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const areaPorId = useMemo(() => {
    const mapa = new Map<number, string>();
    for (const area of areas) mapa.set(area.id, `${area.codigo} — ${area.nombre}`);
    return mapa;
  }, [areas]);

  const empleadoPorId = useMemo(() => {
    const mapa = new Map<number, Empleado>();
    for (const empleado of empleados) mapa.set(empleado.id, empleado);
    return mapa;
  }, [empleados]);

  /** Para el alta solo se ofrecen empleados en actividad y sin usuario. */
  const empleadosDisponibles = useMemo(() => {
    const yaTienen = new Set(
      usuarios
        .map((usuario) => usuario.empleado_id)
        .filter((id): id is number => id !== null),
    );
    return empleados.filter(
      (empleado) => empleado.estado !== "baja" && !yaTienen.has(empleado.id),
    );
  }, [empleados, usuarios]);

  const empleadoElegido =
    ficha?.empleado_id === null || ficha?.empleado_id === undefined
      ? null
      : (empleadoPorId.get(ficha.empleado_id) ?? null);

  const areaFijada =
    ficha?.rol === "EMPLEADO" && empleadoElegido?.area_id != null
      ? (areaPorId.get(empleadoElegido.area_id) ?? SIN_DATO)
      : null;

  function abrirNuevo() {
    setErrorFicha(null);
    setFicha({ ...FICHA_NUEVA_VACIA });
  }

  function elegirEmpleado(valor: string) {
    const id = valor === "" ? null : Number(valor);
    const empleado = id === null ? null : (empleadoPorId.get(id) ?? null);

    setFicha((actual) =>
      actual
        ? {
            ...actual,
            empleado_id: id,
            usuario: empleado
              ? sugerirUsuario(empleado.nombre, empleado.apellido)
              : "",
          }
        : actual,
    );
  }

  function guardarNuevo() {
    if (!ficha) return;
    setErrorFicha(null);

    iniciar(async () => {
      const resultado = await crearUsuario({
        usuario: ficha.usuario,
        password: ficha.password,
        rol: ficha.rol,
        empleado_id: ficha.empleado_id,
      });

      if (!resultado.ok) {
        setErrorFicha(resultado.error);
        return;
      }

      setFicha(null);
      setAviso(resultado.mensaje ?? "Listo.");
      router.refresh();
    });
  }

  function correrConfirmacion() {
    if (!confirmacion) return;
    const actual = confirmacion;

    iniciar(async () => {
      const resultado = await actual.ejecutar();
      setConfirmacion(null);
      setAviso(resultado.texto);
      if (resultado.ok) router.refresh();
    });
  }

  function pedirCambioDeRol(usuario: UsuarioListado, rol: Rol) {
    setConfirmacion({
      titulo: "Cambiar el rol",
      mensaje: `El usuario ${usuario.usuario} pasa a rol ${rol}.${
        rol === "EMPLEADO"
          ? " El área se toma del empleado vinculado y queda fija."
          : " Un ADMINISTRADOR no queda atado a ningún área."
      }`,
      textoConfirmar: "Cambiar rol",
      peligro: false,
      ejecutar: async () => {
        const resultado = await cambiarRolUsuario(usuario.id, rol);
        return {
          ok: resultado.ok,
          texto: resultado.ok ? (resultado.mensaje ?? "Listo.") : resultado.error,
        };
      },
    });
  }

  function pedirCambioDeActivo(usuario: UsuarioListado) {
    const activar = !usuario.activo;
    setConfirmacion({
      titulo: activar ? "Activar el usuario" : "Desactivar el usuario",
      mensaje: activar
        ? `${usuario.usuario} vuelve a poder ingresar al sistema.`
        : `${usuario.usuario} no va a poder ingresar. Las sesiones ya abiertas siguen vigentes hasta que venzan.`,
      textoConfirmar: activar ? "Activar" : "Desactivar",
      peligro: !activar,
      ejecutar: async () => {
        const resultado = await cambiarActivoUsuario(usuario.id, activar);
        return {
          ok: resultado.ok,
          texto: resultado.ok ? (resultado.mensaje ?? "Listo.") : resultado.error,
        };
      },
    });
  }

  function pedirEliminacion(usuario: UsuarioListado) {
    setConfirmacion({
      titulo: "Eliminar el usuario",
      mensaje: `Se elimina la credencial ${usuario.usuario}. La ficha del empleado en la nómina no se toca. Esta acción no se puede deshacer.`,
      textoConfirmar: "Eliminar",
      peligro: true,
      ejecutar: async () => {
        const resultado = await eliminarUsuario(usuario.id);
        return {
          ok: resultado.ok,
          texto: resultado.ok ? (resultado.mensaje ?? "Listo.") : resultado.error,
        };
      },
    });
  }

  function confirmarReset() {
    if (!aReset) return;
    const objetivo = aReset;
    setErrorReset(null);

    iniciar(async () => {
      const resultado = await resetearPassword(objetivo.id, passwordNueva);

      if (!resultado.ok) {
        setErrorReset(resultado.error);
        return;
      }

      setAReset(null);
      setPasswordNueva("");
      setAviso(resultado.mensaje ?? "Listo.");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between border-b border-borde pb-2">
        <h1 className="titulo-modulo">
          <Icono nombre="usuarios" tamano={18} />
          Usuarios
        </h1>
        <div className="flex items-center gap-3">
          <span className="rotulo">{usuarios.length} usuarios</span>
          <button type="button" className="boton" onClick={abrirNuevo}>
            Nuevo usuario
          </button>
        </div>
      </div>

      {aviso ? (
        <div className="flex items-start justify-between gap-3">
          <Aviso texto={aviso} nivel="NORMAL" />
          <button
            type="button"
            className="boton-plano shrink-0"
            onClick={() => setAviso(null)}
          >
            Descartar
          </button>
        </div>
      ) : null}

      <Lista hayFilas={usuarios.length > 0} vacio="No hay usuarios cargados.">
        {usuarios.map((usuario) => {
          const esYo = usuario.id === sesion.id;
          const empleado =
            usuario.empleado_id === null
              ? null
              : (empleadoPorId.get(usuario.empleado_id) ?? null);

          return (
            <FilaDesplegable
              key={usuario.id}
              clave={String(usuario.id)}
              nivel={usuario.activo ? "NORMAL" : "NINGUNO"}
              tenue={!usuario.activo}
              accion={
                <button
                  type="button"
                  className="boton boton-chico"
                  disabled={pendiente}
                  onClick={() => {
                    setPasswordNueva("");
                    setErrorReset(null);
                    setAReset(usuario);
                  }}
                >
                  Contraseña
                </button>
              }
              titulo={usuario.usuario}
              marcas={
                <>
                  {esYo ? <Chip texto="Vos" /> : null}
                  {usuario.activo ? null : <Chip texto="Inactivo" />}
                </>
              }
              resumen={`${usuario.rol} · ${
                empleado
                  ? `${empleado.legajo} ${empleado.apellido}`
                  : "sin empleado vinculado"
              }`}
              detalle={
                <>
                  <Dato rotulo="Estado">
                    {usuario.activo ? "Activo" : "Inactivo"}
                  </Dato>
                  <Dato rotulo="Empleado vinculado">
                    {empleado
                      ? `${empleado.legajo} · ${empleado.apellido}, ${empleado.nombre}`
                      : SIN_DATO}
                  </Dato>
                  <Dato rotulo="Área">
                    {usuario.area_id === null
                      ? SIN_DATO
                      : (areaPorId.get(usuario.area_id) ?? SIN_DATO)}
                  </Dato>
                  <Dato rotulo="Rol">
                    <Desplegable
                      etiquetaAccesible={`Rol de ${usuario.usuario}`}
                      valor={usuario.rol}
                      deshabilitado={pendiente}
                      opciones={ROLES.map((rol) => ({
                        valor: rol,
                        etiqueta: rol,
                        deshabilitada: esYo && rol !== "ADMINISTRADOR",
                      }))}
                      alCambiar={(nuevo) => {
                        if (nuevo !== usuario.rol && esRolValido(nuevo)) {
                          pedirCambioDeRol(usuario, nuevo);
                        }
                      }}
                    />
                  </Dato>
                </>
              }
              pie={
                <>
                  <button
                    type="button"
                    className="boton-plano"
                    disabled={pendiente || (esYo && usuario.activo)}
                    title={
                      esYo && usuario.activo
                        ? "No podés desactivar tu propio usuario"
                        : undefined
                    }
                    onClick={() => pedirCambioDeActivo(usuario)}
                  >
                    {usuario.activo ? "Desactivar" : "Activar"}
                  </button>
                  <button
                    type="button"
                    className="boton-plano boton-peligro"
                    disabled={pendiente || esYo}
                    title={
                      esYo ? "No podés eliminar tu propio usuario" : undefined
                    }
                    onClick={() => pedirEliminacion(usuario)}
                  >
                    Eliminar
                  </button>
                </>
              }
            />
          );
        })}
      </Lista>

      {ficha ? (
        <ModalFicha
          titulo="Nuevo usuario"
          alCerrar={() => setFicha(null)}
          pie={
            <>
              <button
                type="button"
                className="boton-plano"
                onClick={() => setFicha(null)}
                disabled={pendiente}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="boton"
                onClick={guardarNuevo}
                disabled={pendiente}
              >
                {pendiente ? "Creando…" : "Crear usuario"}
              </button>
            </>
          }
        >
          <div className="flex flex-col gap-3">
            {errorFicha ? <Aviso texto={errorFicha} /> : null}

            <Campo
              etiqueta="Empleado de la nómina"
              htmlFor="empleado"
              ayuda="Solo aparecen los empleados en actividad que todavía no tienen usuario."
            >
              <Desplegable
                id="empleado"
                valor={ficha.empleado_id === null ? "" : String(ficha.empleado_id)}
                opciones={[
                  { valor: "", etiqueta: "Sin vincular" },
                  ...empleadosDisponibles.map((empleado) => ({
                    valor: String(empleado.id),
                    etiqueta: `${empleado.legajo} — ${empleado.apellido}, ${empleado.nombre}`,
                  })),
                ]}
                alCambiar={elegirEmpleado}
              />
            </Campo>

            <Campo
              etiqueta="Nombre de usuario"
              htmlFor="usuario"
              ayuda="Se propone con la inicial del nombre más el apellido. Se puede editar."
            >
              <input
                id="usuario"
                className="campo"
                value={ficha.usuario}
                onChange={(e) =>
                  setFicha((actual) =>
                    actual
                      ? { ...actual, usuario: e.target.value.toLowerCase() }
                      : actual,
                  )
                }
              />
            </Campo>

            <Campo
              etiqueta="Contraseña"
              htmlFor="password"
              ayuda={`Mínimo ${LARGO_MINIMO_PASSWORD} caracteres. Se guarda hasheada con bcrypt.`}
            >
              <input
                id="password"
                type="password"
                className="campo"
                autoComplete="new-password"
                value={ficha.password}
                onChange={(e) =>
                  setFicha((actual) =>
                    actual ? { ...actual, password: e.target.value } : actual,
                  )
                }
              />
            </Campo>

            <Campo etiqueta="Rol" htmlFor="rol">
              <Desplegable
                id="rol"
                valor={ficha.rol}
                opciones={ROLES.map((rol) => ({ valor: rol, etiqueta: rol }))}
                alCambiar={(valor) => {
                  if (!esRolValido(valor)) return;
                  setFicha((actual) =>
                    actual ? { ...actual, rol: valor } : actual,
                  );
                }}
              />
            </Campo>

            <div className="border-t border-borde pt-3">
              <div className="rotulo mb-1.5">Área asignada</div>
              {ficha.rol === "ADMINISTRADOR" ? (
                <p className="text-tenue">
                  Un ADMINISTRADOR ve todas las áreas: no se le asigna ninguna.
                </p>
              ) : areaFijada ? (
                <p className="text-texto">
                  {areaFijada}
                  <span className="ml-2 text-tenue">
                    (fija, sale del empleado)
                  </span>
                </p>
              ) : (
                <p className="text-advertencia">
                  Elegí un empleado con área asignada: el rol EMPLEADO toma el
                  área de su ficha.
                </p>
              )}
            </div>
          </div>
        </ModalFicha>
      ) : null}

      {aReset ? (
        <Modal
          titulo={`Resetear la contraseña de ${aReset.usuario}`}
          alCerrar={() => setAReset(null)}
        >
          <div className="flex flex-col gap-3">
            {errorReset ? <Aviso texto={errorReset} /> : null}

            <Campo
              etiqueta="Contraseña nueva"
              htmlFor="password-nueva"
              ayuda={`Mínimo ${LARGO_MINIMO_PASSWORD} caracteres.`}
            >
              <input
                id="password-nueva"
                type="password"
                className="campo"
                autoComplete="new-password"
                autoFocus
                value={passwordNueva}
                onChange={(e) => setPasswordNueva(e.target.value)}
              />
            </Campo>

            <div className="flex items-center justify-end gap-2 border-t border-borde pt-3">
              <button
                type="button"
                className="boton-plano"
                onClick={() => setAReset(null)}
                disabled={pendiente}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="boton"
                onClick={confirmarReset}
                disabled={pendiente}
              >
                {pendiente ? "Aplicando…" : "Resetear"}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}

      {confirmacion ? (
        <ConfirmarModal
          titulo={confirmacion.titulo}
          mensaje={confirmacion.mensaje}
          textoConfirmar={confirmacion.textoConfirmar}
          peligro={confirmacion.peligro}
          pendiente={pendiente}
          alConfirmar={correrConfirmacion}
          alCancelar={() => {
            setConfirmacion(null);
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}

function esRolValido(valor: string): valor is Rol {
  return valor === "ADMINISTRADOR" || valor === "EMPLEADO";
}
