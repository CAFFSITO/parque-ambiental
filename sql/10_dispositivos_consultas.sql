-- =====================================================================
-- sql/10_dispositivos_consultas.sql
-- Parque Ambiental Municipal — dos agregaciones para la pantalla de
-- Dispositivos.
--
-- Pegar en el SQL Editor de Supabase DESPUÉS de 06_dispositivos.sql.
-- Es aditiva e idempotente: se puede correr más de una vez sin romper nada.
--
-- No crea ni modifica ninguna tabla, ninguna columna y ninguna fila. Solo
-- agrega dos funciones de LECTURA, con la misma convención que las de
-- sql/03_reportes.sql: la agregación la resuelve el motor y la app recibe una
-- decena de filas ya sumadas, en vez de traerse la tabla de lecturas entera
-- para contarla en memoria.
--
-- Sin este archivo la pantalla de Dispositivos igual funciona: cae a una
-- consulta por dispositivo para la última lectura, y oculta el historial de
-- asignación. Ver lib/dispositivos.ts.
-- =====================================================================

drop function if exists dispositivos_ultima_lectura();
drop function if exists dispositivos_historial_areas();

-- ---------------------------------------------------------------------
-- 1. La última lectura de cada dispositivo, en una sola consulta.
--
-- 'distinct on' con el mismo orden que el índice idx_lecturas_dispositivo_hora
-- (dispositivo_id, tomada_en desc): el motor recorre el índice y corta en la
-- primera fila de cada dispositivo, sin ordenar la tabla.
--
-- La alternativa era una consulta por dispositivo. Con trece nodos son trece
-- viajes a la base en cada carga de la pantalla, que además se recarga sola.
-- ---------------------------------------------------------------------
create or replace function dispositivos_ultima_lectura()
returns table (
  dispositivo_id int,
  lectura_id     bigint,
  area_id        int,
  temperatura    numeric,
  humedad        numeric,
  tomada_en      timestamptz
)
language sql
stable
as $$
  select distinct on (l.dispositivo_id)
    l.dispositivo_id,
    l.id,
    l.area_id,
    l.temperatura,
    l.humedad,
    l.tomada_en
  from lecturas l
  where l.dispositivo_id is not null
  order by l.dispositivo_id, l.tomada_en desc;
$$;

-- ---------------------------------------------------------------------
-- 2. Historial de asignación, deducido de los hechos.
--
-- No hay tabla de asignaciones, y es una decisión tomada, no un olvido: está
-- justificada en documents/contexto/10-arquitectura.md, §2. El pasado ya está
-- congelado fila por fila en lecturas.area_id, que es lo que el servidor grabó
-- en el momento de recibir cada lectura.
--
-- Esta función lee ese pasado: por cada par (dispositivo, área) devuelve
-- cuántas lecturas escribió ahí y entre qué fechas. Es el historial real —lo
-- que el aparato efectivamente hizo— y no una declaración de intenciones.
--
-- Lo único que no puede responder es la FECHA EXACTA de un cambio de
-- asignación que no haya dejado lecturas de por medio. Si algún día hace falta
-- esa precisión, se agrega una tabla de asignaciones de forma aditiva, sin
-- tocar nada de esto.
--
-- Se ordena por última actividad descendente: arriba queda dónde estuvo el
-- dispositivo más recientemente.
-- ---------------------------------------------------------------------
create or replace function dispositivos_historial_areas()
returns table (
  dispositivo_id int,
  area_id        int,
  lecturas       bigint,
  primera        timestamptz,
  ultima         timestamptz
)
language sql
stable
as $$
  select
    l.dispositivo_id,
    l.area_id,
    count(*)          as lecturas,
    min(l.tomada_en)  as primera,
    max(l.tomada_en)  as ultima
  from lecturas l
  where l.dispositivo_id is not null
  group by l.dispositivo_id, l.area_id
  order by l.dispositivo_id, max(l.tomada_en) desc;
$$;
