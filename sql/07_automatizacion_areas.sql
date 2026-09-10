-- =====================================================================
-- sql/07_automatizacion_areas.sql
-- Parque Ambiental Municipal — la automatización del relé se separa de las
-- alertas y pasa a configurarse por área.
--
-- Pegar en el SQL Editor de Supabase DESPUÉS de 06_dispositivos.sql.
-- Es aditiva e idempotente: se puede correr más de una vez sin romper nada.
--
-- Hoy la decisión de accionar el relé está cableada en una sola expresión de
-- app/api/ingest/route.ts y no se puede cambiar por área:
--
--     const rele =
--       (cuerpo.temperatura !== null &&
--         cuerpo.temperatura > Number(area.temp_max)) ||
--       (cuerpo.humedad !== null && cuerpo.humedad < Number(area.hum_min));
--
-- O sea: de las cuatro condiciones posibles, solo dos accionan —temperatura
-- por encima del máximo (ventilar) y humedad por debajo del mínimo (regar)—
-- y las otras dos, que igual generan llamados, no accionan nada.
--
-- Estas cuatro columnas hacen esa elección explícita y editable por área. El
-- backfill de más abajo deja marcadas exactamente las dos que accionan hoy,
-- así el comportamiento no cambia al aplicar la migración.
--
-- LO QUE ESTAS COLUMNAS NO HACEN: no intervienen en la generación de
-- llamados. evaluarDesvios() (lib/alertas.ts) sigue evaluando las cuatro
-- condiciones contra los cuatro umbrales y sigue creando los mismos llamados
-- con los mismos motivos. Desmarcar un flag apaga una bomba, nunca apaga una
-- alarma.
--
-- temp_min, temp_max, hum_min y hum_max NO se tocan: no cambian de tipo, de
-- nombre ni de significado. Siguen definiendo la normalidad y siguen
-- alimentando las alertas.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Las cuatro columnas se agregan primero SIN default y aceptando null.
--
-- Es a propósito, y el orden importa:
--   1. add column sin default  -> las filas existentes quedan en null;
--   2. update ... where is null -> el backfill hace el trabajo de verdad y
--      queda a la vista, auditable, en vez de esconderse en un default;
--   3. set default             -> las áreas que se creen de acá en adelante
--      nacen con la misma configuración;
--   4. set not null            -> a partir de ahora no existe el estado
--      indefinido.
--
-- Si se agregaran directamente con default, el update del paso 2 no tendría
-- nunca nada que hacer y el backfill sería decorativo.
--
-- Y como el update está acotado con 'where ... is null', correr este archivo
-- de nuevo NO revierte una configuración que alguien haya cambiado después
-- desde la pantalla de Áreas.
-- ---------------------------------------------------------------------
alter table areas add column if not exists auto_temp_alta boolean;
alter table areas add column if not exists auto_temp_baja boolean;
alter table areas add column if not exists auto_hum_alta  boolean;
alter table areas add column if not exists auto_hum_baja  boolean;

-- ---------------------------------------------------------------------
-- BACKFILL — replica exactamente la conducta actual
--
-- Estos cuatro valores reproducen la expresión de `rele` transcrita en la
-- cabecera de este archivo (app/api/ingest/route.ts, cálculo de `rele`,
-- inmediatamente antes de armar la respuesta 200):
--
--   auto_temp_alta = true   ->  temperatura > temp_max   ACCIONA (ventilar)
--   auto_temp_baja = false  ->  temperatura < temp_min   no acciona
--   auto_hum_alta  = false  ->  humedad     > hum_max    no acciona
--   auto_hum_baja  = true   ->  humedad     < hum_min    ACCIONA (regar)
--
-- Reemplazando esos valores en la expresión nueva, los dos términos del medio
-- se anulan y queda:
--
--   rele = (temperatura > temp_max) || (humedad < hum_min)
--
-- que es la condición que el sistema aplica hoy, con las mismas comparaciones
-- estrictas: estar exactamente en el límite sigue sin accionar.
-- ---------------------------------------------------------------------
update areas set auto_temp_alta = true  where auto_temp_alta is null;
update areas set auto_temp_baja = false where auto_temp_baja is null;
update areas set auto_hum_alta  = false where auto_hum_alta  is null;
update areas set auto_hum_baja  = true  where auto_hum_baja  is null;

-- ---------------------------------------------------------------------
-- Defaults para las áreas nuevas: misma configuración que las existentes.
-- ---------------------------------------------------------------------
alter table areas alter column auto_temp_alta set default true;
alter table areas alter column auto_temp_baja set default false;
alter table areas alter column auto_hum_alta  set default false;
alter table areas alter column auto_hum_baja  set default true;

-- ---------------------------------------------------------------------
-- Y recién ahora not null, que ya no puede fallar porque el backfill
-- completó todas las filas.
-- ---------------------------------------------------------------------
alter table areas alter column auto_temp_alta set not null;
alter table areas alter column auto_temp_baja set not null;
alter table areas alter column auto_hum_alta  set not null;
alter table areas alter column auto_hum_baja  set not null;
