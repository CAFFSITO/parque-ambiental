-- =====================================================================
-- sql/06_dispositivos.sql
-- Parque Ambiental Municipal — el nodo pasa a ser una entidad del sistema.
--
-- Pegar en el SQL Editor de Supabase DESPUÉS de 01_esquema.sql, 02_datos.sql,
-- 03_reportes.sql, 04_multiseleccion.sql y 05_avisos.sql.
-- Es aditiva e idempotente: se puede correr más de una vez sin romper nada.
--
-- Hasta ahora un dispositivo era apenas una cadena de texto suelta en
-- lecturas.dispositivo, sin tabla, sin dueño y sin forma de saber si era
-- hardware real o el simulador del panel. Por eso el nodo físico
-- NODO-INV-N-01 y el simulador escriben hoy bajo el MISMO identificador
-- (ver documents/contexto/03-riesgos.md, riesgo R1).
--
-- Esta migración crea la tabla, la puebla con lo que ya está en la base y
-- deja el vínculo armado. NO cambia el comportamiento de la aplicación:
-- ningún archivo de app/ ni de lib/ lee estas estructuras todavía, así que
-- después de correrla el sistema se comporta exactamente igual que antes.
--
-- lecturas.dispositivo (texto) NO se toca. Es el testimonio de lo que el nodo
-- dijo ser, y lo siguen usando estadoDeNodos(), el tablero y el detalle de los
-- llamados. La columna nueva dispositivo_id es a quién lo atribuyó el
-- servidor. Son dos cosas distintas y conviven.
-- =====================================================================

-- ---------------------------------------------------------------------
-- dispositivos
--
-- 'codigo' es la identidad PÚBLICA: viaja por la red en el cuerpo de
-- /api/ingest y está grabada en el firmware. Tiene que poder valer
-- exactamente 'NODO-INV-N-01', que es el valor de DISPOSITIVO en
-- firmware/produccion_parque/produccion_parque.ino, y también 'ESP32-INV-N',
-- que es el formato de los identificadores sembrados por sql/02_datos.sql.
-- Por eso el check es de higiene y no de formato: un patrón más estricto
-- dejaría afuera a la mitad de los identificadores que ya existen.
--
-- 'id' es la identidad INTERNA y es la que referencian las otras tablas, así
-- renombrar un nodo algún día no arrastra las lecturas.
--
-- 'naturaleza' es lo que resuelve el riesgo R1: separa el hardware real de lo
-- que produce el simulador. Es text con check y no un boolean para que el
-- valor sea siempre explícito y para poder sumar una naturaleza más sin
-- migrar el tipo de la columna.
--
-- 'area_id' es nullable a propósito: un nodo recién registrado, uno de
-- repuesto en depósito o uno en tránsito entre dos áreas no tiene área, y eso
-- es un estado válido. La referencia va SIN on delete cascade: las áreas se
-- dan de baja lógicamente con areas.activa, no se borran, y si alguna vez se
-- borrara una, perder el inventario de nodos sería peor que el error.
--
-- 'ultimo_contacto_en' está materializada. Hoy estadoDeNodos() (lib/alertas.ts)
-- se trae TODAS las lecturas de las últimas 24 horas para agrupar en
-- JavaScript, y /dispositivos repite ese barrido cada 10 segundos. Con el nodo
-- reportando cada 10 s eso son 8640 filas por nodo por día en cada barrido.
-- Guardar acá el último contacto convierte ese barrido en la lectura de una
-- tabla de una decena de filas. Es un dato derivado y recalculable: al final
-- de este archivo está la sentencia que lo reconstruye desde lecturas, que
-- sirve tanto de backfill inicial como de reparación.
-- ---------------------------------------------------------------------
create table if not exists dispositivos (
  id                   serial primary key,
  codigo               text not null,
  nombre               text not null,
  modelo               text,
  area_id              int references areas (id),
  activo               boolean not null default true,
  naturaleza           text not null default 'FISICO'
                         check (naturaleza in ('FISICO', 'SIMULADO')),
  reporta_temperatura  boolean not null default true,
  reporta_humedad      boolean not null default true,
  reporta_boton        boolean not null default true,
  acciona_rele         boolean not null default true,
  acciona_alarma       boolean not null default true,
  ultimo_contacto_en   timestamptz,
  observaciones        text,
  creado_en            timestamptz not null default now(),
  constraint dispositivos_codigo_higiene
    check (codigo = btrim(codigo) and length(codigo) between 1 and 64)
);

-- El índice por codigo es ÚNICO: es la clave con la que /api/ingest va a
-- resolver la identidad, y es el destino del on conflict del backfill de más
-- abajo. Se crea como índice y no como constraint inline para poder usar
-- 'if not exists' y que el archivo se pueda correr dos veces.
create unique index if not exists idx_dispositivos_codigo
  on dispositivos (codigo);

create index if not exists idx_dispositivos_area
  on dispositivos (area_id);

create index if not exists idx_dispositivos_contacto
  on dispositivos (ultimo_contacto_en desc);

-- ---------------------------------------------------------------------
-- HISTORIAL DE ASIGNACIÓN
--
-- No se crea ninguna tabla de historial, y es una decisión tomada, no un
-- olvido. Está justificada en documents/contexto/10-arquitectura.md, §2.
--
-- El motivo es que el pasado YA está congelado fila por fila:
--   * /api/ingest graba area_id en cada lectura y en cada llamado, con el
--     valor del momento;
--   * las cinco funciones de sql/03_reportes.sql agrupan por esa columna
--     congelada (l.area_id, le.area_id) y ninguna menciona el dispositivo.
--
-- Por lo tanto reasignar un nodo de un área a otra NO mueve ni una fila de
-- ningún reporte: las lecturas viejas conservan su area_id y las nuevas nacen
-- con el nuevo. La propiedad que se quería garantizar ya se cumple sola.
--
-- Lo único que no queda registrado es la FECHA del cambio de asignación, que
-- hoy ninguna pantalla, ningún reporte y ninguna función consultan.
--
-- Si algún día hace falta (varios nodos por área rotando entre sí, o auditar
-- una asignación equivocada), una tabla dispositivo_asignaciones se agrega de
-- forma puramente aditiva, sembrando un tramo abierto por dispositivo, sin
-- tocar nada de lo que hay acá: dispositivos.area_id seguiría siendo el
-- puntero vigente.
--
-- REGLA QUE NO SE DEBE ROMPER: las funciones reporte_* nunca deben resolver
-- el área a través de dispositivos.area_id. El área de un hecho histórico es
-- la que quedó grabada en la fila del hecho.
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- lecturas.dispositivo_id
--
-- Nace nullable, y también es a propósito. Durante la transición de
-- autenticación, lo que entre por la clave global vieja no va a resolver
-- ningún dispositivo y va a quedar con esta columna en null: contar esas
-- filas es la señal medible que autoriza a apagar el fallback. Volverla
-- not null es una migración posterior de una línea, cuando el contador
-- llegue a cero.
--
-- lecturas.dispositivo NO se toca: ni se borra, ni se renombra, ni se cambia
-- de tipo.
-- ---------------------------------------------------------------------
alter table lecturas
  add column if not exists dispositivo_id int references dispositivos (id);

-- Mismo patrón que idx_lecturas_area_hora (sql/01_esquema.sql): la columna de
-- agrupación primero y el tiempo descendente después, que es como se consulta
-- "la última lectura de este nodo".
create index if not exists idx_lecturas_dispositivo_hora
  on lecturas (dispositivo_id, tomada_en desc);

-- ---------------------------------------------------------------------
-- BACKFILL 1 — una fila por cada identificador que ya existe en lecturas
--
-- Los identificadores no se inventan: salen de lo que efectivamente está
-- escrito en lecturas.dispositivo.
--
-- naturaleza FÍSICA solo para NODO-INV-N-01, que es el único hardware real
-- del parque (firmware/produccion_parque/produccion_parque.ino, constante
-- DISPOSITIVO). Todo el resto es SIMULADO:
--   * los 'ESP32-<codigo>' los generó sql/02_datos.sql como datos de relleno
--     y nunca correspondieron a un aparato;
--   * los otros 'NODO-<codigo>-01' los produjo el simulador del panel, que
--     arma el nombre a partir del área elegida.
--
-- activo solo para el nodo físico. Los demás nacen inactivos porque son
-- historia: su última lectura es del 2026-09-01. Dejarlos inactivos además
-- los mantiene fuera de la vigilancia de nodos caídos y evita que se generen
-- llamados de "Sensor sin señal" por fantasmas.
--
-- El área se INFIERE: para cada dispositivo se toma el area_id con el que más
-- veces escribió. El empate se rompe por area_id ascendente para que el
-- resultado sea determinista y correr esto dos veces dé lo mismo.
--
-- on conflict (codigo) do nothing hace que sea idempotente y, más importante,
-- que correr el archivo de nuevo NUNCA pise una asignación o un nombre que
-- alguien haya corregido después desde el panel.
-- ---------------------------------------------------------------------
with conteo as (
  select
    l.dispositivo as codigo,
    l.area_id     as area_id,
    count(*)      as cantidad
  from lecturas l
  where l.dispositivo is not null
    and btrim(l.dispositivo) <> ''
  group by l.dispositivo, l.area_id
),
principal as (
  select distinct on (c.codigo)
    c.codigo,
    c.area_id
  from conteo c
  order by c.codigo, c.cantidad desc, c.area_id
)
insert into dispositivos (
  codigo,
  nombre,
  modelo,
  area_id,
  activo,
  naturaleza,
  observaciones
)
select
  p.codigo,
  case
    when p.codigo = 'NODO-INV-N-01' then 'Nodo Invernadero Norte'
    else p.codigo
  end,
  case
    when p.codigo = 'NODO-INV-N-01' then 'ESP32-S3-Zero'
    else null
  end,
  p.area_id,
  (p.codigo = 'NODO-INV-N-01'),
  case
    when p.codigo = 'NODO-INV-N-01' then 'FISICO'
    else 'SIMULADO'
  end,
  case
    when p.codigo = 'NODO-INV-N-01' then
      'Nodo físico del proyecto NEXO - ROOTBOX, placa ESP32-S3-Zero. '
      || 'Las lecturas anteriores a esta migración tienen identidad ambigua: '
      || 'el simulador del panel escribía bajo este mismo código. '
      || 'Ver documents/contexto/03-riesgos.md, riesgo R1.'
    when p.codigo like 'ESP32-%' then
      'Identificador sembrado por sql/02_datos.sql. No corresponde a ningún '
      || 'aparato: son datos de relleno para que el panel tuviera historia.'
    else
      'Identificador generado por el simulador del panel. No corresponde a '
      || 'ningún aparato.'
  end
from principal p
on conflict (codigo) do nothing;

-- ---------------------------------------------------------------------
-- BACKFILL 2 — vincular las lecturas existentes con su dispositivo
--
-- Empareja por igualdad exacta entre el texto que el nodo declaró y el codigo
-- del dispositivo. La condición 'dispositivo_id is null' lo hace idempotente
-- y garantiza que no se toque ninguna fila ya vinculada.
--
-- lecturas.dispositivo queda intacta: la fila termina con las dos columnas,
-- el texto y la referencia.
-- ---------------------------------------------------------------------
update lecturas l
   set dispositivo_id = d.id
  from dispositivos d
 where l.dispositivo = d.codigo
   and l.dispositivo_id is null;

-- ---------------------------------------------------------------------
-- BACKFILL 3 — último contacto de cada dispositivo
--
-- Se calcula desde lecturas, que es la fuente de verdad. Esta misma sentencia
-- es la que hay que correr si alguna vez la columna materializada queda
-- desfasada: es idempotente porque recalcula siempre el mismo valor a partir
-- de los mismos datos.
-- ---------------------------------------------------------------------
update dispositivos d
   set ultimo_contacto_en = ultimas.momento
  from (
    select
      l.dispositivo_id,
      max(l.tomada_en) as momento
    from lecturas l
    where l.dispositivo_id is not null
    group by l.dispositivo_id
  ) as ultimas
 where ultimas.dispositivo_id = d.id
   and d.ultimo_contacto_en is distinct from ultimas.momento;
