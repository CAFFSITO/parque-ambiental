-- =====================================================================
-- sql/09_credencial_nodo_fisico.sql
-- Parque Ambiental Municipal — credencial propia para el nodo NODO-INV-N-01,
-- SIN reflashear el firmware.
--
-- Pegar en el SQL Editor de Supabase DESPUÉS de 08_credenciales_dispositivos.sql.
-- Es aditiva e idempotente: se puede correr más de una vez sin romper nada.
--
-- ESPECÍFICA DE ESTA INSTALACIÓN. A diferencia de las migraciones anteriores,
-- este archivo no describe una estructura: describe UN aparato concreto, el
-- nodo que está montado en el Invernadero Norte. En otra instalación este
-- archivo no sirve, y hay que generar el suyo con:
--
--   node scripts/sembrar-credencial.js <CODIGO> --clave-env <VARIABLE>
--
-- QUÉ HACE Y POR QUÉ ASÍ
-- El nodo tiene la clave grabada en el firmware y no se puede cambiar sin ir
-- físicamente hasta el invernadero a reflashearlo. Registrando el HASH de esa
-- misma clave, el nodo pasa a autenticarse con credencial propia sin cambiar
-- una sola línea de firmware: sigue mandando la misma cabecera con el mismo
-- valor, y el servidor lo resuelve a un dispositivo concreto en vez de a
-- "alguien que sabe la clave global".
--
-- Acá va SOLO el hash bcrypt, generado con las mismas 10 rondas que usa el
-- resto del sistema. La clave en claro no está en este archivo ni en ningún
-- otro archivo nuevo del repositorio.
--
-- DEUDA CON VENCIMIENTO
-- Esta credencial es de baja entropía porque el secreto tiene 7 caracteres y
-- no lo elegimos nosotros: viene del firmware, que además está commiteado.
-- Bcrypt encarece un ataque por diccionario, pero no arregla un secreto corto.
-- En el próximo acceso físico al nodo hay que rotarla por un secreto generado
-- (rotarCredencial en lib/credenciales.ts, con ventana de gracia), reflashear,
-- y recién entonces revocar esta fila.
--
-- Después de correr este archivo el sistema se comporta igual que antes:
-- /api/ingest todavía autentica con DEVICE_KEY y nadie consulta esta tabla.
-- =====================================================================

insert into dispositivo_credenciales (
  dispositivo_id, algoritmo, secreto_hash, prefijo, estado, origen, creada_por, motivo
)
select
  d.id,
  'bcrypt-v1',
  '$2b$10$IKfbJhcQh8lADMR34Uiq9OnpEIkrVw9avOW/yEFP8YJaUPyMwWOaO',
  null,
  'ACTIVA',
  'LEGADO',
  'siembra',
  'Clave heredada del firmware. Rotar en el próximo acceso físico al nodo.'
from dispositivos d
where d.codigo = 'NODO-INV-N-01'
  and not exists (
    select 1 from dispositivo_credenciales c
     where c.dispositivo_id = d.id
       and c.origen = 'LEGADO'
       and c.estado <> 'REVOCADA'
  );
