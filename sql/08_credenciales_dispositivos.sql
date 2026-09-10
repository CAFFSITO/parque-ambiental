-- =====================================================================
-- sql/08_credenciales_dispositivos.sql
-- Parque Ambiental Municipal — cada dispositivo pasa a tener su propia
-- credencial, en lugar de la clave única compartida por todos.
--
-- Pegar en el SQL Editor de Supabase DESPUÉS de 06_dispositivos.sql.
-- Es aditiva e idempotente: se puede correr más de una vez sin romper nada.
--
-- Hoy hay una sola clave, DEVICE_KEY, que abre /api/ingest y también
-- /api/vigilancia, que está en claro en el firmware commiteado, y que no
-- permite saber cuál de todos los que la conocen escribió una lectura
-- (ver documents/contexto/03-riesgos.md, riesgo R2).
--
-- Esta tabla es la estructura para reemplazarla por una credencial por
-- dispositivo. Crearla NO cambia el comportamiento de la aplicación: ningún
-- archivo de app/ ni de lib/ la consulta todavía, y este archivo no siembra
-- ninguna fila. Después de correrlo, /api/ingest sigue autenticando
-- exactamente como antes.
--
-- NUNCA se guarda el secreto. Solo su hash. El secreto se muestra una sola
-- vez, cuando se genera, y no se persiste en ningún lado.
-- =====================================================================

-- ---------------------------------------------------------------------
-- dispositivo_credenciales
--
-- 'algoritmo' admite dos valores y cada uno se verifica distinto:
--
--   * 'sha256-v1' es el normal, para secretos generados por el servidor con
--     alta entropía. Al no llevar sal, el hash es determinista y se puede
--     indexar: eso permite resolver el dispositivo a partir del header, sin
--     confiar en ningún campo del cuerpo de la petición.
--
--   * 'bcrypt-v1' existe solo para la clave que el nodo físico YA tiene
--     grabada y que no se puede cambiar sin ir hasta el invernadero a
--     reflashear. Ese secreto es corto y de baja entropía, y bcrypt es
--     justamente lo que corresponde para un secreto así. Al ser salado no se
--     puede buscar por hash, así que ese camino se resuelve por el
--     dispositivo declarado en el cuerpo. Es un camino de transición y se
--     elimina cuando el nodo se reflashee.
--
-- 'prefijo' guarda los primeros caracteres del secreto para poder
-- identificar una credencial en pantalla sin revelarla. Queda NULL para la
-- credencial heredada: guardar el prefijo de un secreto corto sería
-- publicarlo entero.
--
-- Estados:
--   * ACTIVA   -> verifica.
--   * ROTADA   -> verifica MIENTRAS expira_en siga en el futuro. Es la
--                 ventana de gracia: se emite la credencial nueva y el nodo
--                 sigue funcionando con la vieja hasta que alguien vaya a
--                 reflashearlo. Que las dos verifiquen a la vez durante ese
--                 rato es lo buscado, no un defecto.
--   * REVOCADA -> no verifica nunca, sin importar fechas. Es el freno de mano.
--
-- 'usada_en' es la auditoría de uso, y tiene un propósito concreto: durante
-- una rotación, es lo que dice si ya es seguro revocar la credencial vieja.
-- Si hace días que nadie la usa, el nodo ya está con la nueva.
--
-- on delete cascade acá SÍ corresponde, al revés que en dispositivos.area_id:
-- una credencial no tiene sentido sin su dispositivo, y dejarla huérfana
-- sería dejar un secreto válido sin dueño.
-- ---------------------------------------------------------------------
create table if not exists dispositivo_credenciales (
  id              bigserial primary key,
  dispositivo_id  int not null references dispositivos (id) on delete cascade,
  algoritmo       text not null default 'sha256-v1'
                    check (algoritmo in ('sha256-v1', 'bcrypt-v1')),
  secreto_hash    text not null,
  prefijo         text,
  estado          text not null default 'ACTIVA'
                    check (estado in ('ACTIVA', 'ROTADA', 'REVOCADA')),
  origen          text not null default 'GENERADA'
                    check (origen in ('GENERADA', 'LEGADO')),
  expira_en       timestamptz,
  usada_en        timestamptz,
  creada_en       timestamptz not null default now(),
  creada_por      text,
  revocada_en     timestamptz,
  revocada_por    text,
  motivo          text
);

create index if not exists idx_credenciales_dispositivo
  on dispositivo_credenciales (dispositivo_id);

create index if not exists idx_credenciales_estado
  on dispositivo_credenciales (estado);

-- Índice único PARCIAL: es el que convierte "verificar una clave" en una sola
-- búsqueda indexada por hash, sin recorrer la tabla ni preguntarle al cuerpo
-- de la petición quién dice ser. Es parcial porque solo aplica al algoritmo
-- determinista: los hashes de bcrypt llevan sal y dos credenciales con el
-- mismo secreto darían hashes distintos, así que exigirles unicidad no
-- significaría nada.
create unique index if not exists idx_credenciales_hash_sha256
  on dispositivo_credenciales (secreto_hash)
  where algoritmo = 'sha256-v1';

-- ---------------------------------------------------------------------
-- ACÁ NO SE SIEMBRA NINGUNA CREDENCIAL, A PROPÓSITO.
--
-- La credencial del nodo físico NODO-INV-N-01 tiene que llevar el hash de la
-- clave que el firmware ya tiene, calculado con bcryptjs y las mismas 10
-- rondas que usa el resto del sistema (ver scripts/hash.js). Eso no se puede
-- hacer desde SQL: hay que generarlo con un script de Node y pegarlo en su
-- propia migración, en la etapa siguiente.
--
-- Hacerlo así es lo que va a permitir que el nodo pase a autenticarse con
-- credencial propia SIN cambiar una sola línea de firmware: sigue mandando el
-- mismo header con el mismo valor, y el servidor lo resuelve a un dispositivo
-- concreto en vez de a "alguien que sabe la clave global".
--
-- Mientras tanto esta tabla queda vacía y el sistema sigue funcionando con
-- DEVICE_KEY, exactamente como hasta ahora.
-- ---------------------------------------------------------------------
