-- =====================================================================
-- sql/03_reportes.sql
-- Parque Ambiental Municipal de Berisso — funciones de agregación
-- Pegar TERCERO en el SQL Editor de Supabase, después de 02_datos.sql.
--
-- Las agregaciones de la pantalla de Reportes se resuelven acá, en el motor.
-- La app llama estas funciones por RPC y recibe una decena de filas ya
-- sumadas, en vez de traerse todos los llamados para contarlos en memoria.
--
-- Convención de parámetros en las cinco funciones:
--   p_area   int         -> null = todas las áreas
--   p_origen text        -> null = SENSOR y EMPLEADO
--   p_desde  timestamptz -> null = sin límite inferior
--   p_hasta  timestamptz -> null = sin límite superior
-- =====================================================================

drop function if exists reporte_resumen(int, text, timestamptz, timestamptz);
drop function if exists reporte_por_area(int, text, timestamptz, timestamptz);
drop function if exists reporte_distribucion(int, text, timestamptz, timestamptz);
drop function if exists reporte_por_dia(int, text, timestamptz, timestamptz);
drop function if exists reporte_clima_por_dia(int, timestamptz, timestamptz);

-- Los días se agrupan en hora local, no en UTC: si no, los llamados de la
-- noche caen en el día siguiente y la curva queda corrida.
create or replace function pab_zona() returns text
language sql immutable as $$ select 'America/Argentina/Buenos_Aires' $$;

-- ---------------------------------------------------------------------
-- 1. Los cuatro números de arriba
-- ---------------------------------------------------------------------
create or replace function reporte_resumen(
  p_area   int         default null,
  p_origen text        default null,
  p_desde  timestamptz default null,
  p_hasta  timestamptz default null
)
returns table (
  total        bigint,
  atendidos    bigint,
  no_atendidos bigint
)
language sql
stable
as $$
  select
    count(*)                                             as total,
    count(*) filter (where l.estado = 'ATENDIDO')        as atendidos,
    count(*) filter (where l.estado = 'NO_ATENDIDO')     as no_atendidos
  from llamados l
  where (p_area   is null or l.area_id   = p_area)
    and (p_origen is null or l.origen    = p_origen)
    and (p_desde  is null or l.creado_en >= p_desde)
    and (p_hasta  is null or l.creado_en <= p_hasta);
$$;

-- ---------------------------------------------------------------------
-- 2. Barras: llamados por área, apilados Normal / Emergencia
--    Devuelve las 8 áreas aunque alguna no tenga llamados, para que el
--    eje no cambie de forma al mover los filtros.
-- ---------------------------------------------------------------------
create or replace function reporte_por_area(
  p_area   int         default null,
  p_origen text        default null,
  p_desde  timestamptz default null,
  p_hasta  timestamptz default null
)
returns table (
  codigo     text,
  nombre     text,
  normal     bigint,
  emergencia bigint
)
language sql
stable
as $$
  select
    a.codigo,
    a.nombre,
    count(l.id) filter (where l.tipo = 'NORMAL')     as normal,
    count(l.id) filter (where l.tipo = 'EMERGENCIA') as emergencia
  from areas a
  left join llamados l
    on l.area_id = a.id
   and (p_origen is null or l.origen    = p_origen)
   and (p_desde  is null or l.creado_en >= p_desde)
   and (p_hasta  is null or l.creado_en <= p_hasta)
  where (p_area is null or a.id = p_area)
  group by a.id, a.codigo, a.nombre
  order by a.codigo;
$$;

-- ---------------------------------------------------------------------
-- 3. Torta: las tres particiones en una sola consulta.
--    dimension = 'estado' | 'tipo' | 'origen'
-- ---------------------------------------------------------------------
create or replace function reporte_distribucion(
  p_area   int         default null,
  p_origen text        default null,
  p_desde  timestamptz default null,
  p_hasta  timestamptz default null
)
returns table (
  dimension text,
  etiqueta  text,
  cantidad  bigint
)
language sql
stable
as $$
  with filtrados as (
    select l.estado, l.tipo, l.origen
    from llamados l
    where (p_area   is null or l.area_id   = p_area)
      and (p_origen is null or l.origen    = p_origen)
      and (p_desde  is null or l.creado_en >= p_desde)
      and (p_hasta  is null or l.creado_en <= p_hasta)
  )
  select 'estado'::text, estado::text, count(*) from filtrados group by estado
  union all
  select 'tipo'::text,   tipo::text,   count(*) from filtrados group by tipo
  union all
  select 'origen'::text, origen::text, count(*) from filtrados group by origen;
$$;

-- ---------------------------------------------------------------------
-- 4. Líneas: evolución diaria. Rellena los días sin llamados con cero
--    para que la línea no salte huecos.
-- ---------------------------------------------------------------------
create or replace function reporte_por_dia(
  p_area   int         default null,
  p_origen text        default null,
  p_desde  timestamptz default null,
  p_hasta  timestamptz default null
)
returns table (
  dia        date,
  normal     bigint,
  emergencia bigint
)
language sql
stable
as $$
  with filtrados as (
    select
      (l.creado_en at time zone pab_zona())::date as dia,
      l.tipo
    from llamados l
    where (p_area   is null or l.area_id   = p_area)
      and (p_origen is null or l.origen    = p_origen)
      and (p_desde  is null or l.creado_en >= p_desde)
      and (p_hasta  is null or l.creado_en <= p_hasta)
  ),
  limites as (
    select
      coalesce(
        (p_desde at time zone pab_zona())::date,
        (select min(dia) from filtrados),
        (now() at time zone pab_zona())::date
      ) as inicio,
      coalesce(
        (p_hasta at time zone pab_zona())::date,
        (select max(dia) from filtrados),
        (now() at time zone pab_zona())::date
      ) as fin
  ),
  calendario as (
    select generate_series(l.inicio, l.fin, interval '1 day')::date as dia
    from limites l
    where l.inicio <= l.fin
  )
  select
    c.dia,
    count(f.tipo) filter (where f.tipo = 'NORMAL')     as normal,
    count(f.tipo) filter (where f.tipo = 'EMERGENCIA') as emergencia
  from calendario c
  left join filtrados f on f.dia = c.dia
  group by c.dia
  order by c.dia;
$$;

-- ---------------------------------------------------------------------
-- 5. Líneas, vista alternativa: temperatura y humedad promedio por día.
--    No usa p_origen porque las lecturas no tienen origen.
-- ---------------------------------------------------------------------
create or replace function reporte_clima_por_dia(
  p_area  int         default null,
  p_desde timestamptz default null,
  p_hasta timestamptz default null
)
returns table (
  dia       date,
  temp_prom numeric,
  hum_prom  numeric
)
language sql
stable
as $$
  select
    (le.tomada_en at time zone pab_zona())::date as dia,
    round(avg(le.temperatura)::numeric, 1)       as temp_prom,
    round(avg(le.humedad)::numeric, 1)           as hum_prom
  from lecturas le
  where (p_area  is null or le.area_id   = p_area)
    and (p_desde is null or le.tomada_en >= p_desde)
    and (p_hasta is null or le.tomada_en <= p_hasta)
  group by 1
  order by 1;
$$;
