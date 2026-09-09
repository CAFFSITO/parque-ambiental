-- =====================================================================
-- sql/04_multiseleccion.sql
-- Parque Ambiental Municipal — área, tarea y turno pasan a ser
-- multivaluados en la ficha del empleado.
--
-- Pegar en el SQL Editor de Supabase DESPUÉS de 01_esquema.sql y 02_datos.sql.
-- Es aditiva e idempotente: se puede correr más de una vez sin romper nada.
--
-- Las columnas viejas (area_id, tarea, turno) NO se borran. El sistema las
-- sigue escribiendo con el primer valor de cada arreglo, así el tablero, los
-- llamados y la asignación de área de los usuarios siguen funcionando igual.
-- =====================================================================

-- 'turno' era char(1) para los códigos M, T y N. Al poder crearse turnos
-- nuevos escribiéndolos, el nombre ya no entra en un solo carácter.
alter table empleados
  alter column turno type text;

alter table empleados
  add column if not exists areas_ids int[] not null default '{}';

alter table empleados
  add column if not exists tareas text[] not null default '{}';

alter table empleados
  add column if not exists turnos text[] not null default '{}';

-- ---------------------------------------------------------------------
-- Backfill: lo que hoy hay en las columnas de un solo valor pasa a ser el
-- primer (y único) elemento del arreglo correspondiente.
-- ---------------------------------------------------------------------
update empleados
   set areas_ids = array[area_id]
 where area_id is not null
   and cardinality(areas_ids) = 0;

update empleados
   set tareas = array[tarea]
 where tarea is not null
   and btrim(tarea) <> ''
   and cardinality(tareas) = 0;

update empleados
   set turnos = array[btrim(turno)]
 where turno is not null
   and btrim(turno) <> ''
   and cardinality(turnos) = 0;

-- ---------------------------------------------------------------------
-- Índices para poder filtrar por "empleados de esta área / este turno"
-- sin recorrer la nómina entera.
-- ---------------------------------------------------------------------
create index if not exists idx_empleados_areas  on empleados using gin (areas_ids);
create index if not exists idx_empleados_turnos on empleados using gin (turnos);
create index if not exists idx_empleados_tareas on empleados using gin (tareas);
