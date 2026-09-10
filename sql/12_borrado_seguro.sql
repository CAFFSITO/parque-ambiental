-- =====================================================================
-- sql/12_borrado_seguro.sql
-- Parque Ambiental Municipal — dependencias de áreas y de empleados.
--
-- Pegar en el SQL Editor de Supabase DESPUÉS de 04_multiseleccion.sql y
-- 06_dispositivos.sql. Es aditiva e idempotente: se puede correr más de una
-- vez sin romper nada.
--
-- NO crea ni modifica ninguna tabla, ninguna columna y ninguna fila. Agrega
-- dos funciones de LECTURA.
--
-- PARA QUÉ EXISTE
--
-- La pantalla de Áreas y la de Empleados pasan a ofrecer BORRAR, no solo dar
-- de baja. Borrar solo puede ofrecerse cuando no queda nada colgando, y para
-- saberlo hay que contar en cinco tablas por área. Hacerlo con una consulta
-- por área y por tabla serían cuarenta viajes a la base en cada carga de la
-- pantalla; acá el motor devuelve una fila por área ya sumada.
--
-- Es el mismo criterio de sql/10_dispositivos_consultas.sql: la agregación la
-- resuelve Postgres, no la memoria del servidor de Next.
--
-- SIN ESTA MIGRACIÓN la aplicación funciona igual, pero **no ofrece borrar**:
-- sin poder contar no hay certeza, y sin certeza no se borra. La pantalla lo
-- dice en vez de esconder el botón sin explicación. Ver lib/borrado.ts.
--
-- POR QUÉ NO ALCANZA CON LAS CLAVES FORÁNEAS
--
-- Las cinco referencias a `areas` son `references areas (id)` **sin** `on
-- delete cascade`, así que Postgres ya rechaza el borrado por sí solo. Pero un
-- error 23503 crudo de PostgREST no le dice a nadie QUÉ lo está bloqueando, y
-- además hay una dependencia que NINGUNA clave foránea cubre:
-- `empleados.areas_ids`, el arreglo de sql/04_multiseleccion.sql. Borrar un
-- área dejaría ids colgando adentro de ese arreglo sin que la base proteste.
-- Por eso se cuenta acá y se decide en la aplicación.
-- =====================================================================

drop function if exists areas_dependencias();
drop function if exists empleados_dependencias();

-- ---------------------------------------------------------------------
-- 1. Qué cuelga de cada área.
--
-- Devuelve una fila por área, incluidas las que no tienen nada colgando: la
-- pantalla necesita saber que el conteo es cero, no que la fila falta.
-- ---------------------------------------------------------------------
create or replace function areas_dependencias()
returns table (
  area_id      int,
  lecturas     bigint,
  llamados     bigint,
  empleados    bigint,
  usuarios     bigint,
  dispositivos bigint
)
language sql
stable
as $$
  select
    a.id,
    (select count(*) from lecturas  l where l.area_id = a.id),
    (select count(*) from llamados  c where c.area_id = a.id),
    -- Cuenta al empleado una sola vez, tenga el área como principal
    -- (empleados.area_id) o dentro de la selección múltiple (areas_ids).
    -- El arreglo NO tiene clave foránea: es la dependencia que la base no ve.
    (select count(*) from empleados e
      where e.area_id = a.id or a.id = any (e.areas_ids)),
    (select count(*) from usuarios  u where u.area_id = a.id),
    (select count(*) from dispositivos d where d.area_id = a.id)
  from areas a
  order by a.id;
$$;

-- ---------------------------------------------------------------------
-- 2. Qué cuelga de cada empleado.
--
-- La única referencia con clave foránea es `usuarios.empleado_id`. Los
-- llamados guardan `creado_por` y `atendido_por` como TEXTO —el nombre de
-- usuario, no el legajo— así que no hay forma de atarlos a una fila de
-- `empleados`: se cuentan aparte, por si el legajo coincidiera, y se informan
-- como advertencia, nunca como bloqueo.
-- ---------------------------------------------------------------------
create or replace function empleados_dependencias()
returns table (
  empleado_id      int,
  usuarios         bigint,
  llamados_legajo  bigint
)
language sql
stable
as $$
  select
    e.id,
    (select count(*) from usuarios u where u.empleado_id = e.id),
    (select count(*) from llamados c
      where c.creado_por = e.legajo or c.atendido_por = e.legajo)
  from empleados e
  order by e.id;
$$;
