/**
 * scripts/sembrar-credencial.js
 * Genera el SQL para registrar la credencial de un dispositivo.
 *
 * Existe por una razón concreta: el nodo físico ya tiene una clave grabada en
 * el firmware y no se puede cambiar sin ir hasta el invernadero a reflashearlo.
 * Registrando el HASH de esa misma clave, el nodo pasa a autenticarse con
 * credencial propia sin cambiar una sola línea de firmware: sigue mandando la
 * misma cabecera con el mismo valor, y el servidor lo resuelve a un
 * dispositivo concreto en vez de a "alguien que sabe la clave global".
 *
 * Uso:
 *
 *   Credencial heredada (la clave que el aparato YA tiene):
 *     node scripts/sembrar-credencial.js NODO-INV-N-01 --clave LA_CLAVE
 *     node scripts/sembrar-credencial.js NODO-INV-N-01 --clave-env PAB_CLAVE
 *
 *   Credencial nueva generada por el sistema:
 *     node scripts/sembrar-credencial.js SIM-INV-N --generar
 *
 * Imprime un INSERT idempotente por stdout. El secreto en claro NUNCA aparece
 * en el SQL: solo su hash.
 *
 * --clave deja la clave en el historial del intérprete de comandos. Para no
 * dejar rastro, usá --clave-env y exportá la variable antes.
 */

const RONDAS = 10;
const PREFIJO_SECRETO = "pab_";
const BYTES_SECRETO = 32;
const LARGO_PREFIJO_VISIBLE = PREFIJO_SECRETO.length + 8;

function ayuda() {
  console.log(
    [
      "Uso:",
      "  node scripts/sembrar-credencial.js <CODIGO> --clave <CLAVE>",
      "  node scripts/sembrar-credencial.js <CODIGO> --clave-env <VARIABLE>",
      "  node scripts/sembrar-credencial.js <CODIGO> --generar",
      "",
      "Opciones:",
      "  --clave <CLAVE>        Clave que el dispositivo YA tiene. Se guarda",
      "                         con bcrypt como credencial heredada.",
      "  --clave-env <VAR>      Igual, pero leyendo la clave de una variable de",
      "                         entorno, para no dejarla en el historial.",
      "  --generar              Genera un secreto nuevo de 256 bits y lo guarda",
      "                         con SHA-256. Lo imprime UNA sola vez.",
      "  --motivo <TEXTO>       Texto para la columna motivo.",
      "  --usuario <TEXTO>      Queda en creada_por. Por omisión: siembra.",
    ].join("\n"),
  );
}

/** Lee los argumentos con el formato --clave valor. */
function leerArgumentos(argv) {
  const opciones = { codigo: "", generar: false };

  for (let i = 0; i < argv.length; i += 1) {
    const actual = argv[i];

    if (actual === "--generar") {
      opciones.generar = true;
      continue;
    }

    if (actual.startsWith("--")) {
      const nombre = actual.slice(2);
      const valor = argv[i + 1];
      if (valor === undefined || valor.startsWith("--")) {
        throw new Error(`Falta el valor de ${actual}.`);
      }
      opciones[nombre] = valor;
      i += 1;
      continue;
    }

    if (opciones.codigo === "") opciones.codigo = actual;
  }

  return opciones;
}

/** Comilla simple duplicada, que es como se escapa un literal en SQL. */
function literal(valor) {
  if (valor === null || valor === undefined) return "null";
  return `'${String(valor).replace(/'/g, "''")}'`;
}

/**
 * INSERT idempotente. Resuelve el dispositivo por su código, así el SQL sirve
 * en cualquier base sin depender de los identificadores internos, y no vuelve
 * a insertar si ya hay una credencial viva del mismo origen.
 */
function armarSql({ codigo, algoritmo, hash, prefijo, origen, usuario, motivo }) {
  return [
    "insert into dispositivo_credenciales (",
    "  dispositivo_id, algoritmo, secreto_hash, prefijo, estado, origen, creada_por, motivo",
    ")",
    "select",
    "  d.id,",
    `  ${literal(algoritmo)},`,
    `  ${literal(hash)},`,
    `  ${literal(prefijo)},`,
    "  'ACTIVA',",
    `  ${literal(origen)},`,
    `  ${literal(usuario)},`,
    `  ${literal(motivo)}`,
    "from dispositivos d",
    `where d.codigo = ${literal(codigo)}`,
    "  and not exists (",
    "    select 1 from dispositivo_credenciales c",
    "     where c.dispositivo_id = d.id",
    `       and c.origen = ${literal(origen)}`,
    "       and c.estado <> 'REVOCADA'",
    "  );",
  ].join("\n");
}

async function main() {
  const argv = process.argv.slice(2);

  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    ayuda();
    process.exitCode = argv.length === 0 ? 1 : 0;
    return;
  }

  let opciones;
  try {
    opciones = leerArgumentos(argv);
  } catch (fallo) {
    console.error(`Error: ${fallo.message}\n`);
    ayuda();
    process.exitCode = 1;
    return;
  }

  const codigo = opciones.codigo.trim();
  if (codigo === "") {
    console.error("Error: falta el código del dispositivo.\n");
    ayuda();
    process.exitCode = 1;
    return;
  }

  const usuario = (opciones.usuario ?? "siembra").trim();

  let clave = null;
  if (typeof opciones["clave-env"] === "string") {
    clave = process.env[opciones["clave-env"]] ?? null;
    if (clave === null || clave === "") {
      console.error(
        `Error: la variable de entorno ${opciones["clave-env"]} está vacía o no existe.`,
      );
      process.exitCode = 1;
      return;
    }
  } else if (typeof opciones.clave === "string") {
    clave = opciones.clave;
  }

  if (opciones.generar && clave !== null) {
    console.error("Error: elegí --generar o --clave, no las dos.");
    process.exitCode = 1;
    return;
  }
  if (!opciones.generar && clave === null) {
    console.error("Error: falta --clave, --clave-env o --generar.\n");
    ayuda();
    process.exitCode = 1;
    return;
  }

  const { createHash, randomBytes } = await import("node:crypto");

  let sql;

  if (opciones.generar) {
    const secreto = `${PREFIJO_SECRETO}${randomBytes(BYTES_SECRETO).toString("base64url")}`;
    const hash = createHash("sha256").update(secreto, "utf8").digest("hex");

    sql = armarSql({
      codigo,
      algoritmo: "sha256-v1",
      hash,
      prefijo: secreto.slice(0, LARGO_PREFIJO_VISIBLE),
      origen: "GENERADA",
      usuario,
      motivo: opciones.motivo ?? "Credencial generada con scripts/sembrar-credencial.js.",
    });

    console.log("=".repeat(70));
    console.log(" SECRETO — se muestra UNA sola vez. Guardalo ahora.");
    console.log(" No queda en la base ni se puede volver a consultar.");
    console.log("=".repeat(70));
    console.log(secreto);
    console.log("=".repeat(70));
    console.log();
  } else {
    const { default: bcrypt } = await import("bcryptjs");
    const hash = bcrypt.hashSync(clave, RONDAS);

    if (!bcrypt.compareSync(clave, hash)) {
      console.error("Error: el hash generado no verifica contra la clave.");
      process.exitCode = 1;
      return;
    }

    sql = armarSql({
      codigo,
      algoritmo: "bcrypt-v1",
      hash,
      // Prefijo nulo a propósito: guardar los primeros caracteres de una clave
      // corta sería publicar casi toda la clave.
      prefijo: null,
      origen: "LEGADO",
      usuario,
      motivo:
        opciones.motivo ??
        "Clave heredada del firmware. Rotar en el próximo acceso físico al nodo.",
    });

    console.log("-- Credencial HEREDADA (bcrypt). La clave en claro no aparece acá.");
  }

  console.log(sql);
}

main();
