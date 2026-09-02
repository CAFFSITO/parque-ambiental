/**
 * scripts/hash.js
 * Genera los hashes bcrypt que están pegados en sql/02_datos.sql.
 *
 * Uso:  node scripts/hash.js
 */

const RONDAS = 10;

const CUENTAS = [
  { usuario: "admin", password: "Parque2026!" },
  { usuario: "lbarrios", password: "Invernadero1!" },
  { usuario: "hgauna", password: "Hidroponia1!" },
];

async function main() {
  const { default: bcrypt } = await import("bcryptjs");

  for (const cuenta of CUENTAS) {
    const hash = bcrypt.hashSync(cuenta.password, RONDAS);
    const verifica = bcrypt.compareSync(cuenta.password, hash);
    console.log(`${cuenta.usuario.padEnd(10)} ${hash}  verifica=${verifica}`);
  }
}

main();
