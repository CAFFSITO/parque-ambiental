-- =====================================================================
-- sql/02_datos.sql
-- Parque Ambiental Municipal de Berisso — datos sembrados
-- Pegar SEGUNDO en el SQL Editor de Supabase, después de 01_esquema.sql.
--
-- Los hashes bcrypt de la tabla usuarios fueron generados con
-- scripts/hash.js (bcryptjs, 10 rondas). Contraseñas:
--   admin     -> Parque2026!
--   lbarrios  -> Invernadero1!
--   hgauna    -> Hidroponia1!
-- =====================================================================

truncate table llamados, lecturas, usuarios, empleados, areas restart identity cascade;

-- ---------------------------------------------------------------------
-- areas  (8)
-- ---------------------------------------------------------------------
insert into areas (codigo, nombre, tipo, temp_min, temp_max, hum_min, hum_max) values
  ('INV-N', 'Invernadero Norte',          'invernadero', 18, 28, 60, 80),
  ('INV-S', 'Invernadero Sur',            'invernadero', 16, 26, 50, 70),
  ('INV-G', 'Invernadero de Germinación', 'invernadero', 22, 30, 70, 90),
  ('HID-1', 'Hidroponía',                 'hidroponia',  18, 24, 55, 75),
  ('COM-1', 'Playa de Compostaje',        'compostaje',  10, 45, 40, 90),
  ('VIV-1', 'Vivero Forestal',            'vivero',      12, 32, 45, 85),
  ('RIE-1', 'Sala de Bombas y Riego',     'servicios',    5, 40, 20, 80),
  ('DEP-1', 'Depósito y Taller',          'servicios',    5, 40, 20, 80);

-- ---------------------------------------------------------------------
-- empleados  (15)
-- ---------------------------------------------------------------------
insert into empleados
  (legajo, nombre, apellido, dni, fecha_nacimiento, telefono, email, domicilio, area_id, tarea, turno, fecha_ingreso, estado, observaciones)
values
  ('PAB-0001', 'Lucía',    'Barrios',  '32458711', '1986-04-12', '221-4785123', 'lbarrios@berisso.gob.ar',  'Calle 12 nro 1487, Berisso',      (select id from areas where codigo = 'INV-N'), 'Operario de invernadero',   'M', '2016-03-01', 'activo', 'Referente del sector norte.'),
  ('PAB-0002', 'Héctor',   'Gauna',    '28914733', '1981-09-27', '221-4562098', 'hgauna@berisso.gob.ar',    'Av. Montevideo nro 3320, Berisso', (select id from areas where codigo = 'HID-1'), 'Encargado de hidroponía',   'T', '2014-07-15', 'activo', 'Maneja el control de conductividad.'),
  ('PAB-0003', 'Marcos',   'Ferreyra', '35120944', '1990-01-08', '221-4339876', 'mferreyra@berisso.gob.ar', 'Calle 8 nro 942, Berisso',        (select id from areas where codigo = 'INV-S'), 'Operario de invernadero',   'M', '2018-02-05', 'activo', null),
  ('PAB-0004', 'Silvina',  'Quiroga',  '30877215', '1984-06-30', '221-4718254', 'squiroga@berisso.gob.ar',  'Calle 25 nro 610, Berisso',       (select id from areas where codigo = 'INV-G'), 'Operario de invernadero',   'M', '2015-09-14', 'activo', 'Capacitada en germinación de nativas.'),
  ('PAB-0005', 'Diego',    'Maidana',  '33640187', '1988-11-19', '221-4290763', 'dmaidana@berisso.gob.ar',  'Calle 16 nro 2255, Berisso',      (select id from areas where codigo = 'RIE-1'), 'Técnico en riego',          'T', '2017-05-22', 'activo', null),
  ('PAB-0006', 'Norma',    'Cabrera',  '27331508', '1979-03-03', '221-4884471', 'ncabrera@berisso.gob.ar',  'Calle 9 nro 178, Berisso',        (select id from areas where codigo = 'VIV-1'), 'Auxiliar de vivero',        'M', '2012-10-01', 'activo', 'Antigüedad en el vivero forestal.'),
  ('PAB-0007', 'Rubén',    'Ojeda',    '26098442', '1977-12-11', '221-4635590', 'rojeda@berisso.gob.ar',    'Calle 4 nro 3081, Berisso',       (select id from areas where codigo = 'COM-1'), 'Responsable de compostaje', 'M', '2011-04-18', 'activo', null),
  ('PAB-0008', 'Paula',    'Lencina',  '34772360', '1989-08-24', '221-4127805', 'plencina@berisso.gob.ar',  'Calle 30 nro 745, Berisso',       (select id from areas where codigo = 'INV-G'), 'Supervisor de turno',       'T', '2019-01-07', 'activo', 'Coordina el turno tarde de invernaderos.'),
  ('PAB-0009', 'Andrés',   'Sosa',     '31205679', '1985-02-16', '221-4560312', 'asosa@berisso.gob.ar',     'Calle 21 nro 1290, Berisso',      (select id from areas where codigo = 'DEP-1'), 'Mantenimiento eléctrico',   'M', '2016-11-03', 'activo', 'Matrícula de electricista vigente.'),
  ('PAB-0010', 'Verónica', 'Ibáñez',   '29847031', '1982-07-05', '221-4903618', 'vibanez@berisso.gob.ar',   'Calle 11 nro 508, Berisso',       (select id from areas where codigo = 'DEP-1'), 'Administrativo',            'M', '2013-08-26', 'activo', null),
  ('PAB-0011', 'Gustavo',  'Peralta',  '36514902', '1992-05-21', '221-4471268', 'gperalta@berisso.gob.ar',  'Calle 7 nro 2634, Berisso',       (select id from areas where codigo = 'INV-N'), 'Técnico en riego',          'T', '2020-06-15', 'activo', null),
  ('PAB-0012', 'Mariela',  'Godoy',    '33018855', '1987-10-02', '221-4356740', 'mgodoy@berisso.gob.ar',    'Calle 18 nro 903, Berisso',       (select id from areas where codigo = 'HID-1'), 'Supervisor de turno',       'N', '2017-09-11', 'activo', 'Cubre guardias nocturnas.'),
  ('PAB-0013', 'Fabián',   'Roldán',   '30442176', '1983-01-29', '221-4682095', 'froldan@berisso.gob.ar',   'Calle 14 nro 1755, Berisso',      (select id from areas where codigo = 'RIE-1'), 'Mantenimiento eléctrico',   'N', '2015-02-23', 'activo', null),
  ('PAB-0014', 'Cecilia',  'Duarte',   '35907413', '1991-04-17', '221-4218836', 'cduarte@berisso.gob.ar',   'Calle 6 nro 421, Berisso',        (select id from areas where codigo = 'VIV-1'), 'Auxiliar de vivero',        'T', '2019-10-08', 'activo', null),
  ('PAB-0015', 'Julio',    'Almirón',  '25760338', '1976-06-09', '221-4740592', 'jalmiron@berisso.gob.ar',  'Calle 3 nro 2890, Berisso',       (select id from areas where codigo = 'COM-1'), 'Supervisor de turno',       'N', '2010-03-15', 'activo', 'Responsable de la guardia nocturna del predio.');

-- ---------------------------------------------------------------------
-- usuarios  (3)
-- ---------------------------------------------------------------------
insert into usuarios (usuario, password_hash, rol, empleado_id, area_id, activo) values
  ('admin',    '$2b$10$FJfchYCc8G6uJHMf146KK.egHNDItc34TauUXebEoSpq8QiUahwqS', 'ADMINISTRADOR', null,                                                 null,                                          true),
  ('lbarrios', '$2b$10$5KtHOcHrXaBWtEoG/VNoDONSN7xAJgvnq2NTejWP6zNDVzJH00spC', 'EMPLEADO',      (select id from empleados where legajo = 'PAB-0001'),  (select id from areas where codigo = 'INV-N'), true),
  ('hgauna',   '$2b$10$rJV6xp9t6x5hgRDLtSR4lON3owa1iS/0axzmovq/7GqvSZeLX1WZK', 'EMPLEADO',      (select id from empleados where legajo = 'PAB-0002'),  (select id from areas where codigo = 'HID-1'), true);

-- ---------------------------------------------------------------------
-- llamados  (400 en los últimos 90 días)
--   tipo    ~ 70 % NORMAL   / 30 % EMERGENCIA
--   origen  ~ 65 % SENSOR   / 35 % EMPLEADO
--   estado  ~ 80 % ATENDIDO / 20 % NO_ATENDIDO
--   área    concentrada en INV-G (22 %) e HID-1 (20 %)
-- ---------------------------------------------------------------------
with sorteo as (
  select
    now() - (random() * interval '90 days') as creado_en,
    random() as r_area,
    random() as r_tipo,
    random() as r_origen,
    random() as r_estado,
    random() as r_motivo,
    random() as r_autor,
    random() as r_demora,
    random() as r_cierre
  from generate_series(1, 400)
),
clasificado as (
  select
    s.creado_en,
    s.r_motivo,
    s.r_autor,
    s.r_demora,
    s.r_cierre,
    case
      when s.r_area < 0.12 then 'INV-N'
      when s.r_area < 0.22 then 'INV-S'
      when s.r_area < 0.44 then 'INV-G'
      when s.r_area < 0.64 then 'HID-1'
      when s.r_area < 0.73 then 'COM-1'
      when s.r_area < 0.82 then 'VIV-1'
      when s.r_area < 0.92 then 'RIE-1'
      else                      'DEP-1'
    end as codigo,
    case when s.r_tipo   < 0.70 then 'NORMAL'   else 'EMERGENCIA'  end as tipo,
    case when s.r_origen < 0.65 then 'SENSOR'   else 'EMPLEADO'    end as origen,
    case when s.r_estado < 0.80 then 'ATENDIDO' else 'NO_ATENDIDO' end as estado
  from sorteo s
),
armado as (
  select
    c.creado_en,
    c.r_autor,
    c.r_demora,
    c.r_cierre,
    c.codigo,
    c.tipo,
    c.origen,
    c.estado,
    case
      when c.origen = 'SENSOR' and c.tipo = 'NORMAL' then
        (array[
          'Temperatura fuera de rango',
          'Humedad fuera de rango',
          'Lectura intermitente del sensor',
          'Humedad de sustrato por debajo del mínimo',
          'Oscilación térmica sostenida'
        ])[1 + floor(c.r_motivo * 5)::int]
      when c.origen = 'SENSOR' and c.tipo = 'EMERGENCIA' then
        (array[
          'Temperatura crítica sostenida',
          'Humedad crítica sostenida',
          'Sensor sin señal por más de una hora',
          'Caída brusca de temperatura',
          'Sobrecalentamiento del sector'
        ])[1 + floor(c.r_motivo * 5)::int]
      when c.origen = 'EMPLEADO' and c.tipo = 'NORMAL' then
        (array[
          'Falta de insumos',
          'Pedido de recambio de sustrato',
          'Revisión de goteros',
          'Limpieza de bandejas pendiente',
          'Poda y raleo pendiente'
        ])[1 + floor(c.r_motivo * 5)::int]
      else
        (array[
          'Rotura de caño de riego',
          'Corte de energía en el sector',
          'Plaga detectada',
          'Bomba fuera de servicio',
          'Anegamiento del sector'
        ])[1 + floor(c.r_motivo * 5)::int]
    end as motivo,
    case
      when c.origen = 'SENSOR' then 'ESP32-' || c.codigo
      else (array['PAB-0001','PAB-0002','PAB-0004','PAB-0005','PAB-0007','PAB-0008','PAB-0011','PAB-0013'])[1 + floor(c.r_autor * 8)::int]
    end as creado_por
  from clasificado c
)
insert into llamados (area_id, tipo, origen, estado, motivo, detalle, creado_por, creado_en, atendido_por, atendido_en)
select
  a.id,
  x.tipo,
  x.origen,
  x.estado,
  x.motivo,
  case
    when x.origen = 'SENSOR'
      then 'Detectado automáticamente por el nodo ESP32-' || x.codigo || ' en ' || a.nombre || '.'
    else 'Reportado desde el panel por el legajo ' || x.creado_por || ' en ' || a.nombre || '.'
  end as detalle,
  x.creado_por,
  x.creado_en,
  case
    when x.estado = 'ATENDIDO'
      then (array['admin', 'lbarrios', 'hgauna'])[1 + floor(x.r_cierre * 3)::int]
    else null
  end as atendido_por,
  case
    when x.estado = 'ATENDIDO' then least(
      now(),
      x.creado_en + interval '4 minutes' + (
        x.r_demora * case when x.tipo = 'EMERGENCIA' then interval '90 minutes' else interval '10 hours' end
      )
    )
    else null
  end as atendido_en
from armado x
join areas a on a.codigo = x.codigo;

-- ---------------------------------------------------------------------
-- lecturas  (cada 15 minutos, últimos 7 días, las 8 áreas)
--   La temperatura sigue un ciclo diario con pico cerca de las 15:00
--   hora local, la humedad va en contrafase; ambas con ruido y
--   excursiones ocasionales fuera del rango declarado del área.
-- ---------------------------------------------------------------------
with instantes as (
  select
    t,
    sin(
      2 * pi() * (
        (
          extract(hour   from t at time zone 'America/Argentina/Buenos_Aires')
          + extract(minute from t at time zone 'America/Argentina/Buenos_Aires') / 60.0
        ) - 9.0
      ) / 24.0
    ) as ciclo
  from generate_series(now() - interval '7 days', now(), interval '15 minutes') as t
)
insert into lecturas (dispositivo, area_id, temperatura, humedad, tomada_en)
select
  'ESP32-' || a.codigo,
  a.id,
  round(
    (
      (a.temp_min + a.temp_max) / 2.0
      + (a.temp_max - a.temp_min) / 2.0 * 0.50 * i.ciclo
      + (a.temp_max - a.temp_min) / 2.0 * 0.20 * (random() - 0.5)
      + case when random() < 0.025
             then (a.temp_max - a.temp_min) / 2.0 * 0.85 * sign(random() - 0.5)
             else 0 end
    )::numeric, 1
  ) as temperatura,
  greatest(0, least(100, round(
    (
      (a.hum_min + a.hum_max) / 2.0
      - (a.hum_max - a.hum_min) / 2.0 * 0.45 * i.ciclo
      + (a.hum_max - a.hum_min) / 2.0 * 0.22 * (random() - 0.5)
      + case when random() < 0.025
             then (a.hum_max - a.hum_min) / 2.0 * 0.80 * sign(random() - 0.5)
             else 0 end
    )::numeric, 1
  ))) as humedad,
  i.t
from areas a
cross join instantes i;
