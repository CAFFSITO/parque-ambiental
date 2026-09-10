// Ejecutar después de yarn build: node scripts/pruebas-permisos.mjs
// HTTP real de Next + Supabase real. Un gateway local limita la BD a fixtures;
// no reemplaza guards, JWT, Server Actions, handlers ni respuestas de negocio.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import { SignJWT } from 'jose';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const { encodeReply } = require('next/dist/compiled/react-server-dom-turbopack/client.browser');
require('@next/env').loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
const root = process.cwd();
const prefix = `P${randomBytes(4).toString('hex').toUpperCase()}`;
const lower = prefix.toLowerCase();
const password = randomBytes(24).toString('base64url');
const deviceKey = `pab_${randomBytes(32).toString('base64url')}`;
const port = Number(process.env.PERMISOS_PORT || 3107);
const origin = `http://127.0.0.1:${port}`;
const upstream = process.env.SUPABASE_URL?.replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
assert(upstream && process.env.SUPABASE_SERVICE_KEY && process.env.JWT_SECRET, 'Falta configuración local');
const database = createClient(upstream, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const rows = [];
const checks = [];
const gatewayEvents = [];
const secrets = [password, deviceKey, process.env.SUPABASE_SERVICE_KEY, process.env.JWT_SECRET, process.env.DEVICE_KEY].filter(Boolean);
const ids = { areas: new Set(), empleados: new Set(), usuarios: new Set(), dispositivos: new Set() };
const keyColumn = { areas: 'codigo', empleados: 'legajo', usuarios: 'usuario', dispositivos: 'codigo' };
const parent = { llamados: ['area_id', 'areas'], lecturas: ['dispositivo_id', 'dispositivos'], dispositivo_credenciales: ['dispositivo_id', 'dispositivos'], suscripciones_push: ['usuario_id', 'usuarios'] };
const settingKey = `${prefix}_telegram_activo`;
let server, gateway, cleanup = null, failure = null;
let pendingQueries = 0;

const files = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(resolve(dir, e.name)) : [resolve(dir, e.name)]);
const rel = f => relative(root, f).replaceAll('\\', '/');
const sourceFiles = [...files(resolve('app')), ...files(resolve('lib')), resolve('proxy.ts')].filter(f => /\.[cm]?[jt]sx?$/.test(f));
const sources = new Map(sourceFiles.map(f => [rel(f), ts.createSourceFile(f, readFileSync(f, 'utf8'), ts.ScriptTarget.Latest, true)]));
const directive = (s, value) => s.statements.some(n => ts.isExpressionStatement(n) && ts.isStringLiteral(n.expression) && n.expression.text === value);
const actions = [], pages = [];
for (const [file, src] of sources) {
  for (const n of src.statements) {
    if (!ts.isFunctionDeclaration(n) || !n.body || !n.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
    if (!directive(src, 'use server') && !(file.startsWith('app/(panel)/') && file.endsWith('/page.tsx') && n.modifiers.some(m => m.kind === ts.SyntaxKind.DefaultKeyword))) continue;
    const first = n.body.statements[0]?.getText(src) ?? '';
    const guard = /(?:^await|= await) (exigirAdmin|exigirSesion)\(\)/.exec(first)?.[1];
    const item = { file, name: n.name?.text, line: src.getLineAndCharacterOfPosition(n.getStart()).line + 1, guard: guard ?? 'pública (login)' };
    assert(guard || (file === 'app/login/acciones.ts' && item.name === 'accionLogin'), `Guardia ausente: ${file}:${item.name}`);
    (directive(src, 'use server') ? actions : pages).push(item);
  }
  function inspect(n) {
    if (ts.isBlock(n) && n.statements.some(s => ts.isExpressionStatement(s) && ts.isStringLiteral(s.expression) && s.expression.text === 'use server')) {
      throw new Error(`Acción inline no inventariada: ${file}`);
    }
    ts.forEachChild(n, inspect);
  }
  inspect(src);
}
assert.equal(actions.length, 31, 'Cambió el inventario: actualizar casos, nunca omitir acciones');
assert.equal(pages.length, 10, 'Cambió el inventario de páginas');
const manifest = JSON.parse(readFileSync('.next/server/server-reference-manifest.json', 'utf8'));
const references = new Map(Object.entries(manifest.node).map(([id, v]) => [v.exportedName, { id, ...v }]));
assert.deepEqual([...references.keys()].sort(), actions.map(a => a.name).sort());
// Inspección transitiva del grafo cliente; las Server Actions son la frontera
// de RPC de Next, no dependencias que se ejecuten en el navegador.
let clientCount = 0;
for (const [file, src] of sources) {
  if (!directive(src, 'use client')) continue;
  clientCount++;
  const visited = new Set();
  function visit(file) {
    if (visited.has(file)) return;
    visited.add(file);
    assert(!['lib/db.ts', 'lib/credenciales.ts'].includes(file), `Import cliente prohibido desde ${src.fileName}: ${file}`);
    const s = sources.get(file);
    if (!s || directive(s, 'use server')) return;
    for (const n of s.statements) {
      if (!(ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) || !n.moduleSpecifier || !ts.isStringLiteral(n.moduleSpecifier)) continue;
      if (n.isTypeOnly || n.importClause?.isTypeOnly) continue;
      const bindings = n.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings) && !n.importClause.name && bindings.elements.every(e => e.isTypeOnly)) continue;
      const p = n.moduleSpecifier.text;
      const path = p.startsWith('@/') ? p.slice(2) : p.startsWith('.') ? rel(resolve(file, '..', p)) : null;
      if (!path) continue;
      const target = [path, `${path}.ts`, `${path}.tsx`, `${path}/index.ts`, `${path}/index.tsx`].find(f => sources.has(f));
      if (target) visit(target);
    }
  }
  visit(file);
}
const proxyText = readFileSync('proxy.ts', 'utf8');
assert.match(proxyText, /RUTAS_PUBLICAS\s*=\s*\["\/login", "\/api\/ingest", "\/api\/vigilancia"\]/);
checks.push(`${actions.length} acciones y ${pages.length} páginas: guardia inicial; login público como excepción necesaria.`, `${clientCount} módulos use client: sin dependencias runtime transitivas de db/credenciales.`, 'RUTAS_PUBLICAS: exactamente /login, /api/ingest, /api/vigilancia.');

function noSecrets(text) {
  for (const secret of secrets) assert(!text.includes(secret), 'Se detectó un secreto en una respuesta pública');
  assert(!/secreto_hash|password_hash/.test(text), 'Se detectó un hash en respuesta');
}
async function data(query) {
  const { data, error } = await query;
  if (error) throw new Error(`Supabase: ${error.code} ${error.message}`);
  return data;
}
async function refreshIds() {
  for (const [table, column] of Object.entries(keyColumn)) {
    const found = await data(database.from(table).select('id').like(column, `${table === 'usuarios' ? lower : prefix}%`));
    ids[table] = new Set(found.map(r => r.id));
  }
}
async function insert(table, row) {
  const result = await data(database.from(table).insert(row).select().single());
  ids[table]?.add(result.id);
  if (result.password_hash) secrets.push(result.password_hash);
  if (result.secreto_hash) secrets.push(result.secreto_hash);
  return result;
}
const listIds = table => [...ids[table]].join(',') || '0';
function scope(table) {
  if (keyColumn[table]) return [keyColumn[table], `like.${table === 'usuarios' ? lower : prefix}%`];
  if (parent[table]) return [parent[table][0], `in.(${listIds(parent[table][1])})`];
  if (table === 'ajustes') return ['clave', `eq.${settingKey}`];
  throw new Error(`Tabla fuera de alcance: ${table}`);
}
function validateRow(table, row, insert) {
  if (keyColumn[table] && (insert || keyColumn[table] in row)) assert(String(row[keyColumn[table]]).startsWith(table === 'usuarios' ? lower : prefix), 'Identidad ajena al fixture');
  for (const [column, source] of [['area_id', 'areas'], ['empleado_id', 'empleados'], ['usuario_id', 'usuarios'], ['dispositivo_id', 'dispositivos']]) {
    if (row[column] != null) assert(ids[source].has(row[column]), `FK fuera del fixture: ${table}.${column}`);
  }
  if (row.areas_ids) assert(row.areas_ids.every(id => ids.areas.has(id)));
  if (parent[table] && insert) assert(ids[parent[table][1]].has(row[parent[table][0]]));
  if (table === 'lecturas' && row.dispositivo) assert(row.dispositivo.startsWith(prefix));
  if (table === 'suscripciones_push' && row.endpoint) assert(row.endpoint.startsWith(`https://example.invalid/${prefix}/`));
  if (table === 'ajustes') assert.equal(row.clave, settingKey);
}
async function startGateway() {
  gateway = createServer(async (req, res) => {
    pendingQueries++;
    try {
      assert.equal(req.headers.apikey, process.env.SUPABASE_SERVICE_KEY, 'Gateway requiere clave de servicio');
      const url = new URL(req.url, upstream);
      assert(url.pathname.startsWith('/rest/v1/'));
      const table = url.pathname.slice('/rest/v1/'.length);
      const chunks = [];
      for await (const c of req) chunks.push(c);
      let body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
      const rpc = table.startsWith('rpc/');
      if (rpc) {
        assert(['reporte_resumen', 'reporte_por_area', 'reporte_distribucion', 'reporte_por_dia', 'reporte_clima_por_dia', 'dispositivos_ultima_lectura', 'dispositivos_historial_areas'].includes(table.slice(4)), 'RPC fuera de alcance');
        if (table.startsWith('rpc/reporte_')) body = { ...body, p_area: [...ids.areas][0] };
      } else {
        if (table === 'ajustes' && body) body = { ...body, clave: settingKey };
        // Los filtros son aditivos (AND): no se quita el filtro de dueño/id
        // aplicado por la acción. Solo ajustes traduce su clave global.
        if (table === 'ajustes') url.searchParams.delete('clave');
        const [column, filter] = scope(table);
        if (req.method !== 'POST') url.searchParams.append(column, filter);
        if (body) for (const row of Array.isArray(body) ? body : [body]) validateRow(table, row, req.method === 'POST');
      }
      const headers = new Headers();
      for (const name of ['apikey', 'authorization', 'content-type', 'accept', 'prefer', 'range', 'range-unit']) if (req.headers[name]) headers.set(name, req.headers[name]);
      if (!rpc && req.method === 'POST') headers.set('prefer', `${(headers.get('prefer') || '').replace(/return=\w+,?/g, '')},return=representation`.replace(/^,/, ''));
      const result = await fetch(url, { method: req.method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000) });
      let raw = await result.text();
      if (result.ok && raw && req.method !== 'HEAD') {
        let resultRows = JSON.parse(raw);
        if (rpc && table.startsWith('rpc/dispositivos_') && Array.isArray(resultRows)) resultRows = resultRows.filter(r => ids.dispositivos.has(r.dispositivo_id));
        if (ids[table] && req.method === 'POST') for (const r of Array.isArray(resultRows) ? resultRows : [resultRows]) if (r.id) ids[table].add(r.id);
        if (table === 'ajustes') resultRows = Array.isArray(resultRows) ? resultRows.map(r => ({ ...r, clave: 'telegram_activo' })) : { ...resultRows, clave: 'telegram_activo' };
        raw = JSON.stringify(resultRows);
      }
      gatewayEvents.push({ table, method: req.method, status: result.status });
      res.statusCode = result.status;
      for (const name of ['content-type', 'content-range', 'preference-applied']) if (result.headers.get(name)) res.setHeader(name, result.headers.get(name));
      res.end(raw);
    } catch (error) {
      gatewayEvents.push({ blocked: true, reason: String(error.message).slice(0, 180) });
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ code: 'TEST_SCOPE', message: 'Gateway bloqueó operación fuera del fixture' }));
    } finally {
      pendingQueries--;
    }
  });
  gateway.listen(0, '127.0.0.1');
  await once(gateway, 'listening');
  return `http://127.0.0.1:${gateway.address().port}`;
}
async function http(path, role, init = {}) {
  const headers = new Headers(init.headers);
  if (cookies[role]) headers.set('cookie', cookies[role]);
  const r = await fetch(`${origin}${path}`, { ...init, headers, redirect: 'manual', signal: AbortSignal.timeout(45000) });
  const text = await r.text();
  return { status: r.status, text, headers: r.headers };
}
const cookies = {};
async function token(user) {
  return 'pab_sesion=' + await new SignJWT({ id: user.id, usuario: user.usuario, rol: user.rol, area_id: user.area_id }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('8h').sign(new TextEncoder().encode(process.env.JWT_SECRET));
}
function routeOf(action) { return Object.keys(action.workers)[0].replace(/^app\/\(panel\)/, '').replace(/^app/, '').replace(/\/page$/, '') || '/'; }
async function action(name, role, args, path) {
  const entry = references.get(name);
  assert(entry, `Acción no registrada: ${name}`);
  return http(path ?? routeOf(entry), role, { method: 'POST', headers: { 'content-type': 'application/json', 'Next-Action': entry.id, origin }, body: JSON.stringify(args) });
}
function resultOf(r) {
  for (const line of r.text.split('\n')) {
    if (!/^[0-9a-f]+:\{/.test(line)) continue;
    try { const v = JSON.parse(line.slice(line.indexOf(':') + 1)); if (typeof v.ok === 'boolean') return v; } catch { /* otro frame Flight */ }
  }
  return null;
}
async function runAction(name, args, { shared = false, expectedOk = true, path } = {}) {
  const results = {};
  for (const role of ['SIN_SESION', 'EMPLEADO', 'ADMINISTRADOR']) {
    // after() de la request anterior puede seguir registrando telemetría.
    // Esperar quietud antes de atribuir consultas a un rechazo de autorización.
    for (let attempt = 0; attempt < 50; attempt++) {
      const count = gatewayEvents.length;
      await new Promise(r => setTimeout(r, 300));
      if (!pendingQueries && count === gatewayEvents.length) break;
      assert(attempt < 49, 'La BD no quedó en reposo');
    }
    const before = gatewayEvents.length;
    const r = await action(name, role, args, path);
    if (role === 'SIN_SESION') {
      assert.equal(r.status, 307, `${name} anónimo`);
      assert(new URL(r.headers.get('location'), origin).pathname === '/login');
      results[role] = '307 → /login';
    } else if (role === 'EMPLEADO' && !shared) {
      assert.equal(r.status, 403, `${name} EMPLEADO`);
      const effects = gatewayEvents.slice(before).filter(e => ['POST', 'PATCH', 'DELETE'].includes(e.method) && !e.table.startsWith('rpc/'));
      assert.equal(effects.length, 0, `${name}: el rechazo ejecutó escrituras`);
      noSecrets(r.text);
      results[role] = '403; 0 escrituras';
    } else {
      assert.equal(r.status, 200, `${name} ${role}`);
      const value = resultOf(r);
      assert(value, `Falta resultado de ${name}`);
      assert.equal(value.ok, expectedOk, `${name}: ${value.error ?? 'resultado inesperado'}`);
      if (value.secreto) secrets.push(value.secreto);
      else noSecrets(r.text);
      results[role] = `200; ok:${value.ok}`;
    }
  }
  rows.push({ kind: 'acción', name: path ? `${name} vía ${path}` : name, expected: shared ? '200 / 200 / 307 login' : '200 / 403 / 307 login', ...results });
  console.log(`OK acción ${name}${path ? ` vía ${path}` : ''}`);
}

async function execute() {
  console.log(`Fixtures de permisos: ${prefix}; servidor ${origin}`);
  const areaInput = suffix => ({ codigo: `${prefix}-${suffix}`, nombre: `Prueba permisos ${suffix}`, tipo: 'invernadero', temp_min: 0, temp_max: 40, hum_min: 10, hum_max: 90, activa: true, auto_temp_baja: false, auto_temp_alta: false, auto_hum_baja: false, auto_hum_alta: false });
  const areaA = await insert('areas', areaInput('A'));
  const areaB = await insert('areas', areaInput('B'));
  const employeeInput = suffix => ({ legajo: `${prefix}-${suffix}`, nombre: 'Prueba', apellido: 'Permisos', dni: String(80000000 + Number.parseInt(randomBytes(3).toString('hex'), 16) % 19000000), fecha_nacimiento: '', telefono: '', email: '', domicilio: '', areas_ids: [areaA.id], tareas: [], turnos: [], fecha_ingreso: '', estado: 'activo', observaciones: prefix });
  const employee = await insert('empleados', { legajo: `${prefix}-E`, nombre: 'Prueba', apellido: 'Permisos', dni: employeeInput('E').dni, area_id: areaA.id, areas_ids: [areaA.id], estado: 'activo' });
  const password_hash = await bcrypt.hash(password, 10);
  const admin = await insert('usuarios', { usuario: `${lower}.admin`, password_hash, rol: 'ADMINISTRADOR', area_id: null, activo: true });
  const worker = await insert('usuarios', { usuario: `${lower}.empleado`, password_hash, rol: 'EMPLEADO', empleado_id: employee.id, area_id: areaA.id, activo: true });
  const deviceInput = suffix => ({ codigo: `${prefix}-${suffix}`, nombre: `Prueba ${suffix}`, modelo: 'TEST', area_id: areaA.id, naturaleza: 'SIMULADO', reporta_temperatura: true, reporta_humedad: true, reporta_boton: true, acciona_rele: true, acciona_alarma: true, observaciones: prefix });
  const device = await insert('dispositivos', deviceInput('D'));
  const sim = await insert('dispositivos', deviceInput('SIM'));
  const credential = await insert('dispositivo_credenciales', { dispositivo_id: sim.id, algoritmo: 'sha256-v1', secreto_hash: createHash('sha256').update(deviceKey).digest('hex'), prefijo: deviceKey.slice(0, 12), estado: 'ACTIVA', origen: 'GENERADA', creada_por: admin.usuario });
  cookies.ADMINISTRADOR = await token(admin);
  cookies.EMPLEADO = await token(worker);
  const gatewayUrl = await startGateway();
  server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', String(port)], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NODE_ENV: 'production', SUPABASE_URL: gatewayUrl, TELEGRAM_TOKEN: '', TELEGRAM_CHAT_ID: '', VAPID_PRIVATE_KEY: '', DEVICE_KEY: deviceKey, INGEST_PERMITE_CLAVE_GLOBAL: '0' } });
  // No probar un servidor ajeno si el puerto estaba ocupado: esperar el
  // mensaje Ready del proceso que acabamos de iniciar, no solo un HTTP 200.
  let listening = false;
  server.stdout.on('data', chunk => { if (chunk.toString().includes('Ready in')) listening = true; });
  server.stderr.resume();
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error('Next finalizó antes de estar listo (¿puerto ocupado?)');
    try { if (listening && (await http('/login', 'SIN_SESION')).status === 200) { ready = true; break; } } catch { /* arranque */ }
    await new Promise(r => setTimeout(r, 200));
  }
  assert(ready, 'Next no inició');

  for (const route of ['/', '/llamados', '/movil', '/avisos', '/areas', '/empleados', '/usuarios', '/dispositivos', '/reportes', '/reportes/imprimir', '/login', '/api/exportar/csv', '/api/ingest', '/api/vigilancia']) {
    const publicPanel = ['/', '/llamados', '/movil', '/avisos'].includes(route);
    const row = { kind: 'ruta', name: route, expected: route === '/login' ? '307 / 307 / 200' : route === '/api/ingest' ? '401 / 401 / 401 (sin clave)' : route === '/api/vigilancia' ? '200 / 403 / 401' : publicPanel ? '200 / 200 / 307 login' : '200 / 403 / 307 login' };
    for (const role of ['ADMINISTRADOR', 'EMPLEADO', 'SIN_SESION']) {
      const method = route === '/api/ingest' ? 'POST' : 'GET';
      const r = await http(route, role, { method });
      const expected = route === '/login' ? (role === 'SIN_SESION' ? 200 : 307) : route === '/api/ingest' ? 401 : route === '/api/vigilancia' ? (role === 'SIN_SESION' ? 401 : role === 'EMPLEADO' ? 403 : 200) : role === 'SIN_SESION' ? 307 : role === 'EMPLEADO' && !publicPanel ? 403 : 200;
      assert.equal(r.status, expected, `${route} ${role}`);
      if (r.status === 307) assert.equal(new URL(r.headers.get('location'), origin).pathname, route === '/login' ? '/' : '/login');
      noSecrets(r.text);
      if (role === 'EMPLEADO' && r.status === 200 && publicPanel) {
        assert(!/href="\/(areas|empleados|usuarios|dispositivos|reportes)(?:"|\?)/.test(r.text), 'Menú administrativo visible al empleado');
        if (route === '/') assert(/Sensor|sensor/.test(r.text), 'Falta visibilidad de sensor en tablero');
      }
      row[role] = String(r.status) + (r.status === 307 ? ` → ${route === '/login' ? '/' : '/login'}` : '');
    }
    rows.push(row);
    console.log(`OK ruta ${route}`);
  }
  await runAction('crearArea', [areaInput('C')]);
  await runAction('actualizarArea', [areaB.id, { ...areaInput('B'), auto_temp_alta: true }]);
  assert.equal((await data(database.from('areas').select('auto_temp_alta').eq('id', areaB.id).single())).auto_temp_alta, true);
  await runAction('cambiarActivaArea', [areaB.id, false]);
  await runAction('crearEmpleado', [employeeInput('NEW')]);
  await runAction('actualizarEmpleado', [employee.id, { ...employeeInput('E'), dni: employee.dni }]);
  await runAction('cambiarEstadoEmpleado', [employee.id, 'licencia']);
  await runAction('crearUsuario', [{ usuario: `${lower}.new`, password, rol: 'EMPLEADO', empleado_id: employee.id }]);
  await refreshIds();
  const newUser = await data(database.from('usuarios').select('id').eq('usuario', `${lower}.new`).single());
  await runAction('cambiarRolUsuario', [newUser.id, 'ADMINISTRADOR']);
  await runAction('cambiarActivoUsuario', [newUser.id, false]);
  await runAction('resetearPassword', [newUser.id, `${password}2`]);
  await runAction('eliminarUsuario', [newUser.id]);
  await runAction('crearDispositivoNuevo', [deviceInput('NEW')]);
  await runAction('guardarDispositivo', [device.id, { ...deviceInput('D'), codigo: 'IGNORADO', naturaleza: 'FISICO', nombre: 'Prueba editada' }]);
  const unchanged = await data(database.from('dispositivos').select('codigo,naturaleza').eq('id', device.id).single());
  assert.equal(unchanged.codigo, device.codigo); assert.equal(unchanged.naturaleza, 'SIMULADO');
  await runAction('cambiarAreaDispositivo', [device.id, areaB.id]);
  await runAction('cambiarAreaDispositivo', [device.id, areaA.id], { path: '/areas' });
  await runAction('cambiarActivoDispositivo', [device.id, false]);
  await runAction('emitirCredencial', [device.id, device.codigo]);
  await runAction('rotarCredencialDispositivo', [device.id, device.codigo, 0]);
  const activeCredential = await data(database.from('dispositivo_credenciales').select('id').eq('dispositivo_id', device.id).eq('estado', 'ACTIVA').single());
  await runAction('revocarCredencialDispositivo', [activeCredential.id, prefix]);
  await runAction('simularLectura', [{ dispositivo: sim.codigo, area: areaA.codigo, temperatura: 20, humedad: 50, boton: 'NINGUNO' }]);
  await runAction('eliminarDispositivoSinLecturas', [device.id]);
  await runAction('cambiarTelegram', [false]);
  assert.equal((await data(database.from('ajustes').select('valor').eq('clave', settingKey).single())).valor, 'no');
  // Casos de sesión: cada rol usa su propio fixture; el llamado del EMPLEADO
  // está en un área ajena, para demostrar que no se inventó una restricción.
  for (const name of ['crearLlamado', 'atenderLlamado', 'cancelarAtencion', 'guardarSuscripcion', 'asegurarSuscripcion', 'cambiarSuscripcion', 'borrarSuscripcion', 'probarPush', 'cerrarSesion']) {
    const row = { kind: 'acción', name, expected: name === 'cerrarSesion' ? 'redirect Flight login / redirect Flight login / 307 login' : '200 / 200 / 307 login' };
    for (const role of ['ADMINISTRADOR', 'EMPLEADO', 'SIN_SESION']) {
      const user = role === 'ADMINISTRADOR' ? admin : worker;
      const sub = { endpoint: `https://example.invalid/${prefix}/${role}/${name}`, p256dh: 'fixture-public-key', auth: `fixture-auth-${role}-${name}`, dispositivo: prefix };
      secrets.push(sub.auth);
      let args = [];
      if (name === 'crearLlamado') args = [{ area_id: areaB.id, tipo: 'NORMAL', motivo: 'Solicitud de asistencia', detalle: prefix }];
      if (['atenderLlamado', 'cancelarAtencion'].includes(name)) {
        const call = await insert('llamados', { area_id: areaB.id, tipo: 'NORMAL', origen: 'EMPLEADO', motivo: 'Solicitud de asistencia', detalle: prefix, estado: name === 'cancelarAtencion' ? 'ATENDIDO' : 'NO_ATENDIDO', creado_por: user.usuario });
        args = [call.id];
      }
      if (['guardarSuscripcion', 'asegurarSuscripcion'].includes(name)) args = [sub];
      if (['cambiarSuscripcion', 'borrarSuscripcion'].includes(name)) {
        const subscription = await insert('suscripciones_push', { ...sub, usuario_id: user.id, activa: true });
        args = name === 'cambiarSuscripcion' ? [subscription.id, false] : [sub.endpoint];
      }
      const r = await action(name, role, args);
      const expected = role === 'SIN_SESION' ? [307] : name === 'cerrarSesion' ? [200, 303] : [200];
      assert(expected.includes(r.status), `${name} ${role}: HTTP ${r.status}`);
      if (role !== 'SIN_SESION' && name !== 'cerrarSesion') {
        const value = resultOf(r);
        assert(value, `Sin resultado: ${name}`);
        assert.equal(value.ok, name !== 'probarPush', `${name}: ${value.error}`);
      }
      if (name === 'cerrarSesion' && role !== 'SIN_SESION') {
        assert(r.headers.get('x-action-redirect')?.startsWith('/login;'));
        assert(r.headers.get('set-cookie')?.includes('pab_sesion=;'));
      }
      noSecrets(r.text);
      row[role] = `${r.status}${name === 'probarPush' && role !== 'SIN_SESION' ? '; ok:false (envío deshabilitado)' : name === 'cerrarSesion' && role !== 'SIN_SESION' ? '; redirect Flight /login; cookie borrada' : ''}`;
    }
    rows.push(row); console.log(`OK acción ${name}`);
  }
  const loginRow = { kind: 'acción', name: 'accionLogin', expected: '307 / 307 / redirect Flight con credenciales válidas' };
  for (const role of ['ADMINISTRADOR', 'EMPLEADO', 'SIN_SESION']) {
    const fields = new FormData();
    fields.set('usuario', worker.usuario); fields.set('password', password); fields.set('desde', '/llamados');
    // Serializador real de esta versión: también respeta el orden necesario
    // de las partes multipart para el decoder en streaming del servidor.
    const form = await encodeReply([null, fields]);
    const r = await http('/login', role, { method: 'POST', headers: { 'Next-Action': references.get('accionLogin').id, origin }, body: form });
    assert((role === 'SIN_SESION' ? [200, 303] : [307]).includes(r.status), `accionLogin ${role}: HTTP ${r.status}`);
    if (role === 'SIN_SESION') {
      assert(r.headers.get('set-cookie')?.includes('pab_sesion='), `Login sin cookie: ${r.text.match(/"error":"([^"]+)"/)?.[1] ?? 'sin mensaje de validación'}`);
      assert(r.headers.get('x-action-redirect')?.startsWith('/llamados;'));
    }
    noSecrets(r.text); loginRow[role] = String(r.status) + (role === 'SIN_SESION' ? '; cookie + redirect /llamados' : ' → /');
  }
  rows.push(loginRow);

  // Reintentos de apropiación sobre el mismo endpoint de otra cuenta.
  const alien = { endpoint: `https://example.invalid/${prefix}/foreign`, p256dh: 'public-owner', auth: 'secret-owner', dispositivo: prefix };
  const subscription = await insert('suscripciones_push', { ...alien, usuario_id: admin.id, activa: true });
  for (const name of ['guardarSuscripcion', 'asegurarSuscripcion', 'cambiarSuscripcion', 'borrarSuscripcion']) {
    const args = name === 'borrarSuscripcion' ? [alien.endpoint] : name === 'cambiarSuscripcion' ? [subscription.id, false] : [{ ...alien, auth: 'attacker' }];
    const r = await action(name, 'EMPLEADO', args);
    assert.equal(r.status, 200);
    if (name === 'guardarSuscripcion' || name === 'asegurarSuscripcion') assert.equal(resultOf(r)?.ok, false);
    const current = await data(database.from('suscripciones_push').select().eq('id', subscription.id).single());
    assert.equal(current.usuario_id, admin.id); assert.equal(current.auth, alien.auth); assert.equal(current.activa, true);
    checks.push(`${name}: EMPLEADO no modifica, borra ni se apropia de endpoint ajeno (fila verificada).`);
  }
  // Comprobar props Flight con filas que sí contienen material sensible en BD.
  secrets.push(alien.auth);
  noSecrets((await http('/avisos', 'ADMINISTRADOR')).text);
  // Renovación legítima: asegurar conserva apagada; guardar reactiva.
  await data(database.from('suscripciones_push').update({ activa: false }).eq('id', subscription.id));
  const renewed = { ...alien, auth: `${prefix}-renewed-auth` };
  secrets.push(renewed.auth);
  assert.equal(resultOf(await action('asegurarSuscripcion', 'ADMINISTRADOR', [renewed]))?.ok, true);
  let own = await data(database.from('suscripciones_push').select('auth,activa,usuario_id').eq('id', subscription.id).single());
  assert.equal(own.auth, renewed.auth); assert.equal(own.activa, false); assert.equal(own.usuario_id, admin.id);
  assert.equal(resultOf(await action('guardarSuscripcion', 'ADMINISTRADOR', [renewed]))?.ok, true);
  own = await data(database.from('suscripciones_push').select('activa').eq('id', subscription.id).single());
  assert.equal(own.activa, true);
  noSecrets((await http('/avisos', 'ADMINISTRADOR')).text);
  checks.push('Dueño legítimo: asegurar renueva claves sin reactivar; guardar reactiva. Props no contienen auth en ninguno de los casos.');
  for (const role of ['ADMINISTRADOR', 'EMPLEADO', 'SIN_SESION']) {
    const r = await http('/api/vigilancia', role, { method: 'POST' });
    assert.equal(r.status, role === 'ADMINISTRADOR' ? 200 : role === 'EMPLEADO' ? 403 : 401);
    checks.push(`POST vigilancia ${role}: ${r.status}.`);
  }
  for (const method of ['GET', 'POST']) {
    const r = await http('/api/vigilancia', 'SIN_SESION', { method, headers: { 'x-device-key': deviceKey } });
    assert.equal(r.status, 200); assert.equal(JSON.parse(r.text).ok, true);
    checks.push(`${method} vigilancia sin sesión, credencial SHA vigente: 200.`);
  }
  const ingestBody = { dispositivo: sim.codigo, area: areaB.codigo, temperatura: 20, humedad: 50, boton: 'NINGUNO' };
  const ingested = await http('/api/ingest', 'SIN_SESION', { method: 'POST', headers: { 'content-type': 'application/json', 'x-device-key': deviceKey }, body: JSON.stringify(ingestBody) });
  assert.equal(ingested.status, 200); assert.equal(JSON.parse(ingested.text).ok, true);
  const reading = await data(database.from('lecturas').select('area_id').eq('dispositivo_id', sim.id).order('id', { ascending: false }).limit(1).single());
  assert.equal(reading.area_id, areaA.id);
  checks.push('POST ingest sin sesión: 200 con credencial; ignora área declarada y guarda área asignada.', 'Simulador probado solo con DEVICE_KEY temporal registrada al fixture SIMULADO; R1 productivo NO se considera cerrado.');
  assert.equal((await http('/api/ingest', 'SIN_SESION')).status, 405);
  for (const state of ['REVOCADA', 'EXPIRADA', 'INACTIVO', 'INVALIDA']) {
    await data(database.from('dispositivo_credenciales').update({ estado: state === 'REVOCADA' ? 'REVOCADA' : 'ACTIVA', expira_en: state === 'EXPIRADA' ? new Date(Date.now() - 60000).toISOString() : null }).eq('id', credential.id));
    await data(database.from('dispositivos').update({ activo: state !== 'INACTIVO' }).eq('id', sim.id));
    const r = await http('/api/vigilancia', 'SIN_SESION', { headers: { 'x-device-key': state === 'INVALIDA' ? 'no-registrada' : deviceKey } });
    assert.equal(r.status, 401); checks.push(`Vigilancia credencial ${state}: 401.`);
  }
  const legacyKey = `legacy-${randomBytes(20).toString('hex')}`;
  secrets.push(legacyKey);
  await insert('dispositivo_credenciales', { dispositivo_id: sim.id, algoritmo: 'bcrypt-v1', secreto_hash: await bcrypt.hash(legacyKey, 10), estado: 'ACTIVA', origen: 'LEGADO' });
  assert.equal((await http('/api/vigilancia', 'SIN_SESION', { headers: { 'x-device-key': legacyKey, 'x-device-code': sim.codigo } })).status, 200);
  checks.push('Vigilancia legado bcrypt + x-device-code: 200; sin cambiar firmware ni credencial física.');
  await data(database.from('dispositivos').update({ ultimo_contacto_en: new Date(Date.now() - 300000).toISOString() }).eq('id', sim.id));
  const stale = await http('/', 'EMPLEADO');
  assert.equal(stale.status, 200); assert(stale.text.includes('sin señal')); assert(stale.text.includes('umbral'));
  await data(database.from('dispositivos').update({ ultimo_contacto_en: new Date().toISOString() }).eq('id', sim.id));
  const fresh = await http('/', 'EMPLEADO');
  assert.equal(fresh.status, 200); assert(fresh.text.includes('en línea'));
  checks.push('Tablero EMPLEADO por HTTP: sensor callado 5 minutos muestra sin señal; contacto reciente muestra en línea, sin sección administrativa nueva. El borde 90/91 s se cubre en tests unitarios.');
  assert.equal(gatewayEvents.filter(e => e.blocked).length, 0, 'Hubo intentos fuera del fixture');
  for (const file of files(resolve('.next/static')).filter(f => f.endsWith('.js'))) noSecrets(readFileSync(file, 'utf8'));
  checks.push('Bundles cliente y respuestas HTML/Flight inspeccionados: sin secretos conocidos ni hashes; secreto nuevo solo en respuesta de emisión/rotación ADMINISTRADOR.');
}

async function clean() {
  if (server && server.exitCode === null) { server.kill(); await once(server, 'exit'); }
  if (gateway) { gateway.closeAllConnections(); await new Promise(r => gateway.close(r)); }
  await refreshIds();
  for (const table of ['suscripciones_push', 'llamados', 'lecturas', 'dispositivo_credenciales']) {
    const [column, owner] = parent[table];
    if (ids[owner].size) await data(database.from(table).delete().in(column, [...ids[owner]]));
  }
  await data(database.from('ajustes').delete().eq('clave', settingKey));
  for (const table of ['usuarios', 'empleados', 'dispositivos', 'areas']) {
    if (ids[table].size) await data(database.from(table).delete().in('id', [...ids[table]]).like(keyColumn[table], `${table === 'usuarios' ? lower : prefix}%`));
  }
  const counts = {};
  for (const table of [...Object.keys(keyColumn), ...Object.keys(parent), 'ajustes']) {
    let query = database.from(table).select('*', { count: 'exact', head: true });
    const [column, filter] = scope(table);
    if (keyColumn[table]) query = query.like(column, filter.slice(5));
    else if (table === 'ajustes') query = query.eq(column, settingKey);
    else query = query.in(column, [...ids[parent[table][1]]]);
    const result = await query;
    assert(!result.error, `No se pudo comprobar limpieza ${table}`);
    counts[table] = result.count;
    assert.equal(result.count, 0, `Residuo en ${table}`);
  }
  return counts;
}
function report() {
  const inventory = actions.concat(pages).map(a => `| ${a.file}:${a.line} | ${a.name} | ${a.guard} |`).join('\n');
  const table = kind => rows.filter(r => r.kind === kind).map(r => `| ${r.name} | ${r.expected} | ${r.ADMINISTRADOR} | ${r.EMPLEADO} | ${r.SIN_SESION} |`).join('\n');
  const header = '| Ruta / acción | Esperado A / E / sin sesión | ADMINISTRADOR observado | EMPLEADO observado | Sin sesión observado |\n|---|---|---|---|---|\n';
  const output = `# 70 — Pruebas reproducibles de permisos\n\nFecha UTC: ${new Date().toISOString()}. Fixture: ${prefix}. Resultado: **${failure ? 'INCOMPLETO / FALLÓ' : 'PASS'}**.\n\n## Reproducción y alcance\n\nDesde la raíz, con .env.local válido y las migraciones ya aplicadas:\n\n\`\`\`powershell\nyarn test\nyarn build\nnode scripts/pruebas-permisos.mjs\n\`\`\`\n\nEl script descubre las 31 acciones desde el AST y contrasta el manifiesto real de Next; falla ante acciones/páginas nuevas sin casos. Inicia next start en 127.0.0.1:${port}, sin tocar el servidor 3000. Envía POST con Next-Action y argumentos válidos, no hace mocks de autorización, cookies, JWT, acciones, handlers ni BD. Firma cookies de usuarios temporales con el payload vigente y prueba además login real con contraseña bcrypt. No imprime tokens ni secretos.\n\nPara evitar efectos sobre la operación, un gateway PostgREST local autenticado limita lecturas y escrituras a filas temporales en la base REAL. Añade filtros AND, conserva filtros de dueño de la aplicación, valida FKs y prefijos, restringe RPC de reportes al área temporal y filtra resultados de RPC de dispositivos. Traduce únicamente la clave global telegram_activo a una clave temporal. No fabrica resultados exitosos. La aplicación conserva su lógica real, incluyendo la vigilancia; solo ve nodos temporales. TELEGRAM_TOKEN, TELEGRAM_CHAT_ID y VAPID_PRIVATE_KEY vacías en este proceso deshabilitan envíos; probarPush devuelve ok:false por ese motivo, no por permisos. DEVICE_KEY se reemplaza solo en este proceso por una credencial del simulador temporal, con fallback global desactivado. .env.local no se modifica. Esto verifica autorización HTTP con datos aislados, no entrega real de notificaciones ni configuración del despliegue remoto.\n\nLimpieza en finally: elimina solo filas del prefijo/IDs verificados, en orden de dependencias; comprueba cero residuo. Las secuencias autoincrementales pueden avanzar. Una interrupción forzada del proceso podría impedir finally: usar el prefijo informado para revisar residuos antes de repetir.\n\n## Inventario completo y primera instrucción ejecutable\n\nLogin es necesariamente público: exigir sesión antes de autenticarse impediría ingresar. cerrarSesion exige ahora exigirSesion; sin cookie igualmente vuelve al login. No se agregaron roles ni se cambió el JWT.\n\n| Archivo:línea | Función | Guardia inicial |\n|---|---|---|\n${inventory}\n\n## Rutas: matriz esperada vs observada\n\n${header}${table('ruta')}\n\n## Acciones: matriz esperada vs observada\n\nCada acción administrativa se envía con sesión EMPLEADO y sin sesión antes de la llamada ADMINISTRADOR; el 403 se comprueba junto con cero consultas al gateway. No se confunde un 200 con permiso para mutar: se exige además ok:true, salvo prueba push sin entrega. Las acciones compartidas usan filas propias por rol. Los llamados de EMPLEADO se ejercen sobre otra área para conservar el permiso histórico.\n\n${header}${table('acción')}\n\n## Comprobaciones adicionales\n\n${checks.map(c => `- ${c}`).join('\n')}\n\n## Aislamiento y limpieza observados\n\nOperaciones PostgREST: ${gatewayEvents.length}. Operaciones bloqueadas por aislamiento: ${gatewayEvents.filter(e => e.blocked).length}.\n\n\`\`\`json\n${JSON.stringify(cleanup, null, 2)}\n\`\`\`\n\n${failure ? `Fallo: ${failure}\n` : 'Matriz de autorización OBJETIVO satisfecha por las pruebas anteriores. R1 del simulador sigue pendiente y no se presenta como un problema de permisos resuelto.\n'}`;
  writeFileSync('documents/contexto/70-pruebas-permisos.md', output.replace('cero consultas al gateway', 'cero escrituras al gateway (Next puede releer la página Avisos al renderizar un 403)'));
  writeFileSync('documents/contexto/70-resultados-permisos.json', JSON.stringify({ date: new Date().toISOString(), prefix, pass: !failure, actions, pages, clientCount, rows, checks, cleanup, failure, gatewayEvents }, null, 2));
}
try { await execute(); } catch (error) { failure = String(error.message); console.error(`FALLÓ: ${failure}`); }
finally {
  try { cleanup = await clean(); } catch (error) { failure = `${failure ?? ''}; limpieza: ${error.message}`; console.error(failure); }
  report();
}
if (failure) process.exitCode = 1;
else console.log(`PASS: ${rows.length} filas de matriz; limpieza verificada. documents/contexto/70-pruebas-permisos.md`);
