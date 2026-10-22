/* =====================================================================
   CotizaObra · capa de datos del prototipo (v2)
   ---------------------------------------------------------------------
   Todo se guarda en el navegador (localStorage) para poder probar el
   circuito completo sin servidor: cliente → corralones → comparador →
   entrega → calificación.
   Para producción, reemplazar estas funciones por llamadas a la base de
   datos (por ejemplo Supabase) manteniendo los mismos nombres.
   IMPORTANTE: en este prototipo las contraseñas y PIN quedan guardados
   en el propio navegador; no usar con datos reales.
   ===================================================================== */
(function () {
  const KEY = 'cotizaobra:db:v2';
  const SESSION_KEY = tipo => 'cotizaobra:sesion:' + tipo;   // una sesión por rol: cliente y corralón
  const EMPTY = () => ({ clientes: [], corralones: [], pedidos: [], listas: [], obras: [], seq: 123 });

  /* ---------- storage ---------- */
  function db() {
    try { return Object.assign(EMPTY(), JSON.parse(localStorage.getItem(KEY) || 'null') || {}); }
    catch (e) { return EMPTY(); }
  }
  const listeners = [];
  function commit(data) {
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* sin almacenamiento */ }
    listeners.forEach(fn => fn());
  }
  function onChange(fn) {
    listeners.push(fn);
    window.addEventListener('storage', e => { if (e.key === KEY || (e.key || '').startsWith('cotizaobra:sesion:')) fn(); }); // otra pestaña
  }

  /* ---------- helpers ---------- */
  const normEmail = e => String(e || '').trim().toLowerCase();
  const now = () => Date.now();
  const DAY = 864e5;
  function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rng(seed) { let a = hashStr(seed); return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function genPin() {
    const a = new Uint32Array(1);
    (window.crypto || window.msCrypto).getRandomValues(a);
    return String(a[0] % 1000000).padStart(6, '0');
  }
  const uid = p => p + Math.random().toString(36).slice(2, 8) + now().toString(36).slice(-4);
  const money = n => '$ ' + Math.round(n || 0).toLocaleString('es-AR');
  function timeAgo(ts) {
    const s = Math.max(1, Math.round((now() - ts) / 1000));
    if (s < 60) return 'hace instantes';
    const m = Math.round(s / 60); if (m < 60) return `hace ${m} min`;
    const h = Math.round(m / 60); if (h < 24) return `hace ${h} h`;
    const d = Math.round(h / 24); return `hace ${d} día${d > 1 ? 's' : ''}`;
  }
  const fmtDate = v => { if (!v) return '—'; const [y, m, d] = String(v).split('-'); return `${d}/${m}/${y}`; };
  const fmtTs = ts => new Date(ts).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
  const fmtTime = ts => new Date(ts).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ø/g, 'o').replace(/[^a-z0-9,.\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const DEMORAS = [['24 horas', 1], ['48 horas', 2], ['3 a 5 días', 4], ['1 semana', 7], ['Más de 1 semana', 10]];
  const demoraDias = txt => (DEMORAS.find(d => d[0] === txt) || [, 99])[1];
  const VALIDEZ = [[1, '24 horas'], [2, '48 horas'], [3, '3 días'], [5, '5 días'], [7, '7 días'], [15, '15 días']];
  const PAGOS = [['efectivo', 'Efectivo'], ['transferencia', 'Transferencia'], ['debito', 'Débito'], ['credito', 'Crédito'], ['cuotas', 'Cuotas sin interés'], ['cheque', 'Cheque']];
  const ENTREGA_PASOS = [['preparando', 'Preparando el pedido'], ['en_camino', 'En camino'], ['entregado', 'Entregado']];

  /* ---------- sesión ---------- */
  function session(tipo) { try { return JSON.parse(localStorage.getItem(SESSION_KEY(tipo)) || 'null'); } catch (e) { return null; } }
  function setSession(s) { try { localStorage.setItem(SESSION_KEY(s.tipo), JSON.stringify(s)); } catch (e) {} listeners.forEach(fn => fn()); }
  function logout(tipo) { try { localStorage.removeItem(SESSION_KEY(tipo)); } catch (e) {} listeners.forEach(fn => fn()); }

  /* ---------- clientes (acceso con PIN) ---------- */
  function clienteRegistrar({ nombre, apellido, email }) {
    const d = db(), em = normEmail(email);
    let c = d.clientes.find(x => x.email === em);
    const pin = genPin();
    if (c) { c.pin = pin; c.nombre = nombre || c.nombre; c.apellido = apellido || c.apellido; }
    else { c = { email: em, nombre: nombre.trim(), apellido: apellido.trim(), pin, createdAt: now() }; d.clientes.push(c); }
    commit(d);
    setSession({ tipo: 'cliente', email: em });
    adoptarListas(em);
    return { ok: true, pin, cliente: c };
  }
  function clienteIngresar(email, pin) {
    const c = db().clientes.find(x => x.email === normEmail(email));
    if (!c) return { ok: false, error: 'No encontramos un acceso con ese email.' };
    if (String(pin) !== c.pin) return { ok: false, error: 'El PIN no es correcto.' };
    setSession({ tipo: 'cliente', email: c.email });
    adoptarListas(c.email);
    return { ok: true, cliente: c };
  }
  function clienteActual() {
    const s = session('cliente'); if (!s) return null;
    return db().clientes.find(x => x.email === s.email) || null;
  }

  /* ---------- listas guardadas (cliente o este dispositivo) ---------- */
  function listasOwner() { const c = clienteActual(); return c ? c.email : 'dispositivo'; }
  function listas() { const o = listasOwner(); return db().listas.filter(l => l.owner === o || l.owner === 'dispositivo').sort((a, b) => b.at - a.at); }
  // las listas guardadas sin cuenta pasan a la cuenta del cliente cuando entra
  function adoptarListas(email) { const d = db(); let n = 0; d.listas.forEach(l => { if (l.owner === 'dispositivo') { l.owner = email; n++; } }); if (n) commit(d); }
  function guardarLista(nombre, items) {
    const d = db(), o = listasOwner();
    const ex = d.listas.find(l => l.owner === o && norm(l.nombre) === norm(nombre));
    if (ex) { ex.items = items; ex.at = now(); }
    else d.listas.push({ id: uid('L'), owner: o, nombre: nombre.trim(), items, at: now() });
    commit(d); return { ok: true, actualizada: !!ex };
  }
  function borrarLista(id) { const d = db(); d.listas = d.listas.filter(l => l.id !== id); commit(d); }

  /* ---------- corralones y equipo ---------- */
  function buscarUsuario(email) {
    const em = normEmail(email);
    for (const c of db().corralones) { const u = (c.usuarios || []).find(x => x.email === em); if (u) return { c, u }; }
    return null;
  }
  function corralonRegistrar(email, password) {
    const d = db(), em = normEmail(email);
    if (buscarUsuario(em)) return { ok: false, error: 'Ya hay una cuenta con ese email. Ingresá con tu contraseña.' };
    const c = { id: 'C' + (hashStr(em + now()) % 100000), createdAt: now(), perfil: null, precios: [], avisos: { whatsapp: true, email: true },
      usuarios: [{ email: em, password, rol: 'dueno', nombre: 'Dueño', createdAt: now() }] };
    d.corralones.push(c); commit(d);
    setSession({ tipo: 'corralon', corralonId: c.id, email: em });
    return { ok: true, corralon: c };
  }
  function corralonIngresar(email, password) {
    const r = buscarUsuario(email);
    if (!r || r.u.password !== password) return { ok: false, error: 'El email o la contraseña no son correctos.' };
    setSession({ tipo: 'corralon', corralonId: r.c.id, email: r.u.email });
    return { ok: true, corralon: r.c, usuario: r.u };
  }
  function corralonActual() {
    const s = session('corralon'); if (!s) return null;
    const c = db().corralones.find(x => x.id === s.corralonId);
    if (!c || !(c.usuarios || []).some(u => u.email === s.email)) return null;
    return c;
  }
  function usuarioActual() {
    const s = session('corralon'), c = corralonActual(); if (!c) return null;
    return c.usuarios.find(u => u.email === s.email) || null;
  }
  const esDueno = () => { const u = usuarioActual(); return !!u && u.rol === 'dueno'; };
  function mutarCorralon(fn) {
    const d = db(), s = session('corralon'); const c = d.corralones.find(x => x.id === (s && s.corralonId)); if (!c) return null;
    fn(c); commit(d); return c;
  }
  const corralonGuardarPerfil = perfil => mutarCorralon(c => { c.perfil = perfil; });
  const logoDe = id => { const c = db().corralones.find(x => x.id === id); return (c && c.perfil && c.perfil.logo) || null; };
  const corralonGuardarAvisos = avisos => mutarCorralon(c => { c.avisos = avisos; });
  function equipoAgregar({ nombre, email, password }) {
    if (!esDueno()) return { ok: false, error: 'Solo el dueño puede sumar usuarios.' };
    if (buscarUsuario(email)) return { ok: false, error: 'Ese email ya tiene una cuenta.' };
    mutarCorralon(c => c.usuarios.push({ email: normEmail(email), password, rol: 'vendedor', nombre: nombre.trim(), createdAt: now() }));
    return { ok: true };
  }
  function equipoQuitar(email) {
    if (!esDueno()) return { ok: false };
    mutarCorralon(c => { c.usuarios = c.usuarios.filter(u => u.rol === 'dueno' || u.email !== email); });
    return { ok: true };
  }

  /* ---------- lista de precios del corralón ---------- */
  // Lee lo pegado desde Excel/planilla: "Material <TAB> Unidad <TAB> Precio" (unidad opcional).
  function parsePrecio(v) {
    let s = String(v || '').replace(/[$\s]/g, '');
    if (!/\d/.test(s)) return NaN;
    if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');      // 9.500,50
    else if (/\.\d{3}(\.|$)/.test(s)) s = s.replace(/\./g, '');               // 9.500
    else s = s.replace(/,/g, '');
    return Number(s);
  }
  function parseListaPrecios(texto) {
    const out = [], errores = [];
    String(texto || '').split(/\r?\n/).forEach((line, i) => {
      if (!line.trim()) return;
      let cols = line.includes('\t') ? line.split('\t') : line.includes(';') ? line.split(';') : line.split(/\s{2,}/);
      cols = cols.map(c => c.trim()).filter(Boolean);
      if (cols.length < 2) {                                                  // "Arena gruesa 42000"
        const m = line.trim().match(/^(.*?)[\s:]+\$?\s*([\d.,]+)\s*$/);
        if (m) cols = [m[1], m[2]];
      }
      let precioIdx = -1;
      for (let k = cols.length - 1; k >= 0; k--) { if (!isNaN(parsePrecio(cols[k])) && /^\$?\s*[\d.,]+$/.test(cols[k])) { precioIdx = k; break; } }
      if (precioIdx < 1) { if (!/precio|material|producto|articulo/i.test(line)) errores.push(i + 1); return; }
      const precio = parsePrecio(cols[precioIdx]);
      const name = cols[0], unit = precioIdx >= 2 ? cols[1] : '';
      if (!name || !(precio > 0)) { errores.push(i + 1); return; }
      out.push({ name, unit, precio: Math.round(precio) });
    });
    return { items: out, errores };
  }
  function preciosImportar(items, modo) {
    if (!esDueno()) return { ok: false, error: 'Solo el dueño puede editar la lista de precios.' };
    let nuevos = 0, actualizados = 0;
    mutarCorralon(c => {
      if (modo === 'reemplazar') c.precios = [];
      items.forEach(it => {
        const ex = c.precios.find(p => norm(p.name) === norm(it.name));
        if (ex) { ex.precio = it.precio; if (it.unit) ex.unit = it.unit; ex.at = now(); actualizados++; }
        else { c.precios.push(Object.assign({ at: now() }, it)); nuevos++; }
      });
    });
    return { ok: true, nuevos, actualizados };
  }
  function precioQuitar(name) { if (!esDueno()) return; mutarCorralon(c => { c.precios = c.precios.filter(p => norm(p.name) !== norm(name)); }); }
  // "Cemento Portland 50kg" ≈ "Cemento portland x 50 kg" · "Hierro del 8" ≈ "Hierro aletado Ø8 mm x 12 m"
  const STOP = new Set(['x', 'de', 'del', 'la', 'el', 'los', 'las', 'con', 'para', 'por', 'y', 'en', 'mm', 'cm', 'm', 'mts', 'u', 'un', 'tipo']);
  const tokens = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[øØ]/g, ' ')
    .replace(/(\d)([a-z])/g, '$1 $2').replace(/([a-z])(\d)/g, '$1 $2').replace(/[^a-z0-9,.\s]/g, ' ').split(/\s+/)
    .map(t => t.replace(/[.,]$/, '')).filter(t => t && !STOP.has(t)).map(t => t.length > 4 ? t.replace(/(es|s)$/, '') : t);
  function buscarPrecio(c, itemName) {
    if (!c || !c.precios || !c.precios.length) return null;
    const exact = c.precios.find(p => norm(p.name) === norm(itemName)); if (exact) return { precio: exact.precio, match: exact.name, exacto: true };
    const ti = tokens(itemName); let best = null, bestScore = 0;
    c.precios.forEach(p => {
      const tp = tokens(p.name);
      const inter = ti.filter(t => tp.includes(t)).length;
      const [corto, largo] = ti.length <= tp.length ? [ti, tp] : [tp, ti];
      const nI = ti.filter(t => /^\d/.test(t)), nP = tp.filter(t => /^\d/.test(t));
      const numsOk = corto.filter(t => /^\d/.test(t)).every(t => largo.includes(t))      // las medidas tienen que coincidir
        && (!nI.length || !nP.length || nI[0] === nP[0]);                                // y la primera medida es la que manda (Ø8, 50 kg, 12x18…)
      if (inter < 2 || !numsOk) return;
      const score = inter / corto.length + inter / largo.length / 10;
      if (score > bestScore) { bestScore = score; best = p; }
    });
    return bestScore >= 0.75 ? { precio: best.precio, match: best.name, exacto: false } : null;
  }

  /* ---------- corralones de demostración ---------- */
  const DEMO = [
    { id: 'D1', localidad: 'San Miguel de Tucumán', radio: 'Hasta 25 km', rubros: ['gruesa','aridos','hierros','ladrillos'], horarios: 'Lun a vie 7:30 a 17 · Sáb 8 a 13', sobre: 'Corralón familiar con más de 20 años en la zona. Entregamos con camión propio y grúa.', nombre: 'Corralón Norte', factor: 0.95, flete: 38000, demora: '48 horas', responde: 12, faltan: 0.00, tel: '+54 9 000 000-0001', validez: 5, pago: ['efectivo', 'transferencia', 'debito'], desc: 5, rating: [4.7, 38] },
    { id: 'D2', localidad: 'Yerba Buena', radio: 'Hasta 10 km', rubros: ['gruesa','sanitarios','electricidad','terminaciones'], horarios: 'Lun a sáb 8 a 18', sobre: 'Materiales para obra gruesa y terminaciones. Asesoramiento en obra y envío bonificado en la zona.', nombre: 'Materiales del Centro', factor: 1.04, flete: 0, demora: '24 horas', responde: 28, faltan: 0.00, tel: '+54 9 000 000-0002', validez: 3, pago: ['transferencia', 'credito', 'cuotas'], desc: 0, rating: [4.5, 61] },
    { id: 'D3', localidad: 'Tafí Viejo', radio: 'Hasta 25 km', rubros: ['gruesa','aridos','ladrillos','techos'], horarios: 'Lun a vie 8 a 17', sobre: 'Si no tenemos la marca que pediste, te ofrecemos una equivalente al mismo precio o menos.', nombre: 'Corralón La Esquina', factor: 0.98, flete: 45000, demora: '3 a 5 días', responde: 55, faltan: 0.35, tel: '+54 9 000 000-0003', validez: 2, pago: ['efectivo', 'transferencia'], desc: 8, rating: [4.1, 17], pregunta: '¡Hola! ¿Aceptan una marca equivalente si no tenemos la que pidieron? Así cotizamos todo el pedido.' },
    { id: 'D4', localidad: 'Banda del Río Salí', radio: 'Hasta 50 km', rubros: ['gruesa','aridos','hierros','ladrillos','sanitarios','electricidad','techos','terminaciones'], horarios: 'Lun a vie 7 a 18 · Sáb 8 a 14', sobre: 'Distribuidora mayorista: atendemos constructoras y particulares. Aceptamos cheques y cuentas corrientes.', nombre: 'Distribuidora Sur', factor: 1.08, flete: 25000, demora: '48 horas', responde: 110, faltan: 0.00, tel: '+54 9 000 000-0004', validez: 7, pago: ['efectivo', 'transferencia', 'debito', 'credito', 'cheque'], desc: 3, rating: [4.8, 92] },
    { id: 'D5', localidad: 'Lules', radio: 'Hasta 25 km', rubros: ['gruesa','aridos'], horarios: 'Lun a vie 8 a 16', sobre: 'Áridos y materiales básicos para obra gruesa.', nombre: 'Corralón El Puente', factor: 1.0, flete: 52000, demora: '1 semana', responde: null, faltan: 0.10, tel: '+54 9 000 000-0005', validez: 5, pago: ['efectivo'], desc: 10, rating: [3.9, 9] }
  ];
  const isDemo = id => /^D\d$/.test(id);
  /* ---------- corralones adheridos y perfil público ---------- */
  function adheridos() {
    const d = db(), ps = d.pedidos;
    const respondidos = id => ps.filter(p => respuestas(p).some(q => q.corralonId === id)).length;
    const demo = DEMO.map(dc => ({ id: dc.id, demo: true, nombre: dc.nombre, provincia: 'Tucumán', localidad: dc.localidad, radio: dc.radio, rubros: dc.rubros, horarios: dc.horarios, sobre: dc.sobre, pagos: dc.pago, logo: null, desde: null, demora: dc.demora, flete: dc.flete }));
    const reales = d.corralones.filter(c => c.perfil && c.perfil.nombre).map(c => {
      const ult = ps.map(p => (p.respuestas || []).find(q => q.corralonId === c.id)).filter(Boolean).sort((a, b) => b.fecha - a.fecha)[0];
      return { id: c.id, demo: false, nombre: c.perfil.nombre, provincia: c.perfil.provincia, localidad: c.perfil.localidad, radio: c.perfil.radio, rubros: c.perfil.rubros || [], horarios: c.perfil.horarios || '', sobre: c.perfil.sobre || '', pagos: ult ? ult.pago : null, logo: c.perfil.logo || null, desde: c.createdAt, demora: ult ? ult.demora : null, flete: ult ? ult.flete : null };
    });
    return reales.concat(demo).map(c => Object.assign(c, { rating: rating(c.id), respondidos: respondidos(c.id) }));
  }
  function perfilPublico(id) {
    const c = adheridos().find(x => x.id === id); if (!c) return null;
    const res = db().pedidos.filter(p => (p.calificaciones || {})[id]).map(p => Object.assign({ cliente: p.cliente ? `${p.cliente.nombre} ${(p.cliente.apellido || '').charAt(0)}.`.trim() : 'Cliente', localidad: p.localidad }, p.calificaciones[id])).sort((a, b) => (b.at || 0) - (a.at || 0));
    const avg = k => res.length ? Math.round(res.reduce((s, r) => s + (r[k] || 0), 0) / res.length * 10) / 10 : null;
    return Object.assign(c, { resenas: res, detalle: { puntualidad: avg('puntualidad'), precio: avg('precio'), estado: avg('estado') } });
  }
  const BASE = { bolsa: 11000, 'm³': 42000, 'm²': 18000, m: 6500, kg: 3800, barra: 9500, rollo: 62000, lata: 72000, placa: 31000, 'paño': 41000, 'bolsón': 46000, balde: 36000, 'bidón': 26000, caja: 16000, L: 5200, u: 950 };
  const basePrice = item => { const r = rng('base:' + item.name.toLowerCase()); return (BASE[item.unit] || 1000) * (0.7 + r() * 0.7); };
  function demoQuote(p, dc) {
    const r = rng(p.id + ':' + dc.id);
    let missing = 0;
    const items = p.items.map(it => {
      const sinStock = r() < dc.faltan && missing < 1 && p.items.length > 2 ? (missing++, true) : false;
      const precio = Math.round(basePrice(it) * dc.factor * (0.92 + r() * 0.16) / 10) * 10;
      const alt = sinStock && dc.id === 'D3' ? { nombre: it.name.replace(/x \d+.*$/, '').trim() + ' (marca equivalente)', precio: Math.round(precio * 0.97 / 10) * 10 } : null;
      return { precio: sinStock ? 0 : precio, sinStock, alt };
    });
    return finalizeQuote({ corralonId: dc.id, nombre: dc.nombre, demo: true, tel: dc.tel, items, flete: dc.flete, demora: dc.demora,
      validez: dc.validez, pago: dc.pago, descEfectivo: dc.desc, notas: '', fecha: p.createdAt + dc.responde * 1000 }, p);
  }
  function finalizeQuote(q, p) {
    q.items = q.items.map(it => Object.assign({ alt: null }, it));
    q.subtotal = q.items.reduce((s, it, i) => s + itemPrecio(it) * (Number(p.items[i].qty) || 0), 0);
    q.total = q.subtotal + (Number(q.flete) || 0);
    q.faltantes = q.items.filter(it => it.sinStock && !it.alt).length;
    q.alternativas = q.items.filter(it => it.sinStock && it.alt).length;
    q.cubiertos = q.items.length - q.faltantes;
    q.demoraDias = demoraDias(q.demora);
    q.vence = q.fecha + (Number(q.validez) || 3) * DAY;
    q.vencido = now() > q.vence;
    const rt = rating(q.corralonId); q.rating = rt.prom; q.ratingN = rt.n;
    return q;
  }
  const itemPrecio = it => it.sinStock ? (it.alt ? it.alt.precio : 0) : it.precio;
  const itemDisponible = it => !it.sinStock || !!it.alt;

  /* ---------- pedidos ---------- */
  function crearPedido(data) {
    const d = db();
    d.seq = (d.seq || 123) + 1;
    const p = Object.assign({ id: 'P-' + String(d.seq).padStart(4, '0'), createdAt: now(), respuestas: [], hilos: {}, leido: {}, adjudicacion: null, entregas: {}, calificaciones: {} }, data);
    p.items = p.items.map(it => ({ name: it.name, qty: Number(String(it.qty).replace(',', '.')) || 0, unit: it.unit }));
    d.pedidos.unshift(p); commit(d);
    return p;
  }
  function mutarPedido(id, fn) { const d = db(), p = d.pedidos.find(x => x.id === id); if (!p) return null; fn(p); commit(d); return p; }
  const pedido = id => db().pedidos.find(p => p.id === id) || null;
  const pedidosDeCliente = email => db().pedidos.filter(p => p.cliente && p.cliente.email === normEmail(email) && !p.archivado);
  // Sin compra: se borra para todos. Con compra: se archiva (el corralón conserva su venta).
  /* ---------- clientes / obras de constructoras y estudios ---------- */
  const obrasDe = email => { const em = normEmail(email); return (db().obras || []).filter(o => !o.email || (em && o.email === em)).sort((a, b) => (b.usado || 0) - (a.usado || 0)); };
  function guardarObra({ id, nombre, ref, email }) {
    let out = null;
    const d = db(); d.obras = d.obras || [];
    const em = normEmail(email) || null, nn = String(nombre || '').trim();
    let o = id ? d.obras.find(x => x.id === id) : d.obras.find(x => norm(x.nombre) === norm(nn) && (!x.email || x.email === em));
    if (!o) { o = { id: 'O' + (hashStr(nn + now()) % 100000), nombre: nn, ref: String(ref || '').trim(), email: em, createdAt: now() }; d.obras.push(o); }
    if (em && !o.email) o.email = em;
    if (ref != null && String(ref).trim()) o.ref = String(ref).trim();
    o.usado = now(); out = Object.assign({}, o); commit(d);
    return out;
  }
  const borrarObra = id => { const d = db(); d.obras = (d.obras || []).filter(o => o.id !== id); commit(d); };
  const pedidosArchivados = email => db().pedidos.filter(p => p.cliente && p.cliente.email === normEmail(email) && p.archivado);
  const desarchivarPedido = id => mutarPedido(id, p => { delete p.archivado; });
  function borrarPedido(id) {
    const d = db(), i = d.pedidos.findIndex(x => x.id === id); if (i < 0) return null;
    const p = d.pedidos[i];
    if (p.adjudicacion) { p.archivado = true; commit(d); return { modo: 'archivado', copia: null }; }
    d.pedidos.splice(i, 1); commit(d); return { modo: 'borrado', copia: p, pos: i };
  }
  function restaurarPedido(r, id) {
    const d = db();
    if (r.modo === 'archivado') { const p = d.pedidos.find(x => x.id === id); if (p) delete p.archivado; }
    else if (r.copia && !d.pedidos.some(x => x.id === r.copia.id)) d.pedidos.splice(Math.min(r.pos, d.pedidos.length), 0, r.copia);
    commit(d);
  }
  const corralonesReales = p => db().corralones.filter(c => c.perfil && c.perfil.provincia === p.provincia && c.perfil.rubros && c.perfil.rubros.length);
  function destinatarios(p) {
    return DEMO.map(c => ({ id: c.id, nombre: c.nombre, demo: true })).concat(corralonesReales(p).map(c => ({ id: c.id, nombre: c.perfil.nombre, demo: false })));
  }
  /* ---------- plazo para responder: 48 h fijas ---------- */
  const PLAZO_H = 48;
  const cierre = p => p.cerradoAt || (p.createdAt + PLAZO_H * 3600e3);
  const abierto = p => !p.adjudicacion && now() < cierre(p);
  const restante = p => Math.max(0, cierre(p) - now());
  function fmtRestante(ms) {
    const m = Math.ceil(ms / 60000), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
    return d ? `${d} d ${h} h` : h ? `${h} h ${mm} min` : `${mm} min`;
  }
  const cerrarPedido = id => mutarPedido(id, p => { if (!p.cerradoAt) p.cerradoAt = now(); });
  function respuestas(p) {
    const t = now(), lim = cierre(p);
    const demos = DEMO.filter(dc => dc.responde != null && t >= p.createdAt + dc.responde * 1000 && p.createdAt + dc.responde * 1000 <= lim).map(dc => demoQuote(p, dc));
    const reales = (p.respuestas || []).filter(q => !q.fecha || q.fecha <= lim).map(q => finalizeQuote(JSON.parse(JSON.stringify(q)), p));
    return demos.concat(reales).sort((a, b) => (a.faltantes - b.faltantes) || (a.total - b.total));
  }
  const adjudicados = p => p.adjudicacion ? p.adjudicacion.partes.map(x => x.corralonId) : [];
  function estado(p) {
    const dest = destinatarios(p).length, resp = respuestas(p).length;
    if (p.adjudicacion) {
      const ids = adjudicados(p), entregados = ids.filter(id => entregaEstado(p, id).key === 'recibido' || entregaEstado(p, id).key === 'entregado').length;
      const cerrados = ids.filter(id => entregaEstado(p, id).recibido && (p.calificaciones || {})[id]).length;
      if (cerrados === ids.length) return { key: 'completado', label: 'Completado', dest, resp };
      if (entregados === ids.length) return { key: 'entregado', label: 'Entregado', dest, resp };
      return { key: 'aceptado', label: p.adjudicacion.tipo === 'combinada' ? `Compra combinada (${ids.length} corralones)` : 'Presupuesto aceptado', dest, resp };
    }
    if (!abierto(p)) return resp ? { key: 'comparando', label: `Cerrado · ${resp} presupuesto${resp > 1 ? 's' : ''} para comparar`, dest, resp } : { key: 'sin_respuestas', label: 'Cerrado sin presupuestos', dest, resp };
    if (!resp) return { key: 'esperando', label: 'Esperando presupuestos', dest, resp };
    return { key: 'comparando', label: `${resp} presupuesto${resp > 1 ? 's' : ''} para comparar`, dest, resp };
  }
  function contactoCorralon(id) {
    const dc = DEMO.find(c => c.id === id);
    if (dc) return { nombre: dc.nombre, tel: dc.tel, email: dc.nombre.toLowerCase().replace(/[^a-z]+/g, '') + '@demo.cotizaobra', demo: true };
    const c = db().corralones.find(x => x.id === id);
    return c ? { nombre: c.perfil ? c.perfil.nombre : 'Corralón', tel: c.perfil ? c.perfil.whatsapp : '', email: (c.usuarios.find(u => u.rol === 'dueno') || {}).email || '', demo: false } : null;
  }
  const nombreCorralon = id => (contactoCorralon(id) || {}).nombre || 'Corralón';

  /* ---------- compra combinada ---------- */
  // Busca la combinación más barata (precio de cada material + un flete por corralón usado).
  function combinacionOptima(p, qs) {
    qs = (qs || respuestas(p)).filter(q => !q.vencido);
    const n = p.items.length, K = Math.min(qs.length, 10);
    let best = null;
    for (let mask = 1; mask < (1 << K); mask++) {
      const sel = qs.filter((_, k) => mask & (1 << k));
      const asig = p.items.map((it, i) => {
        let m = null;
        sel.forEach(q => { const x = q.items[i]; if (itemDisponible(x) && (!m || itemPrecio(x) < itemPrecio(m.x))) m = { q, x }; });
        return m ? m.q.corralonId : null;
      });
      const cubiertos = asig.filter(Boolean).length;
      const r = evaluarAsignacion(p, qs, asig);
      if (r.usados.length !== sel.length) continue;                         // un corralón elegido sin materiales: no suma
      if (!best || cubiertos > best.cubiertos || (cubiertos === best.cubiertos && r.total < best.total)) best = Object.assign(r, { asignacion: asig, cubiertos });
    }
    return best;
  }
  function evaluarAsignacion(p, qs, asig) {
    const by = {}; let total = 0;
    asig.forEach((cid, i) => {
      if (!cid) return;
      const q = qs.find(x => x.corralonId === cid); if (!q) return;
      const x = q.items[i], sub = itemPrecio(x) * (Number(p.items[i].qty) || 0);
      by[cid] = by[cid] || { corralonId: cid, nombre: q.nombre, items: [], subtotal: 0, flete: Number(q.flete) || 0 };
      by[cid].items.push(i); by[cid].subtotal += sub; total += sub;
    });
    const usados = Object.values(by);
    usados.forEach(u => total += u.flete);
    return { partes: usados, usados, total, cubiertos: asig.filter(Boolean).length };
  }
  function adjudicar(pedidoId, tipo, partes) {
    return mutarPedido(pedidoId, p => {
      p.adjudicacion = { tipo, at: now(), partes: partes.map(x => ({ corralonId: x.corralonId, items: x.items })) };
      p.adjudicacion.partes.forEach(x => { p.entregas[x.corralonId] = { estados: [{ key: 'aceptado', at: now() }], recibido: null }; });
    });
  }
  const parteDe = (p, cid) => p.adjudicacion ? p.adjudicacion.partes.find(x => x.corralonId === cid) || null : null;

  /* ---------- entregas ---------- */
  function entregaEstado(p, cid) {
    const e = (p.entregas || {})[cid]; if (!e) return { key: 'ninguno', pasos: [] };
    let estados = e.estados.slice();
    if (isDemo(cid) && p.adjudicacion) {                                    // los corralones demo avanzan solos
      const t0 = p.adjudicacion.at, t = now();
      [['preparando', 4], ['en_camino', 25], ['entregado', 50]].forEach(([k, s]) => { if (t >= t0 + s * 1000 && !estados.some(x => x.key === k)) estados.push({ key: k, at: t0 + s * 1000 }); });
    }
    let key = estados[estados.length - 1].key;
    if (e.recibido) key = 'recibido';
    return { key, estados, recibido: e.recibido };
  }
  const avanzarEntrega = (pedidoId, cid, key) => mutarPedido(pedidoId, p => { const e = p.entregas[cid]; if (e && !e.estados.some(x => x.key === key)) e.estados.push({ key, at: now() }); });
  const confirmarRecepcion = (pedidoId, cid) => mutarPedido(pedidoId, p => { const e = p.entregas[cid]; if (e) e.recibido = now(); });

  /* ---------- calificaciones ---------- */
  function calificar(pedidoId, cid, data) {
    return mutarPedido(pedidoId, p => { p.calificaciones = p.calificaciones || {}; p.calificaciones[cid] = Object.assign({ at: now() }, data); });
  }
  function rating(cid) {
    const all = db().pedidos.map(p => (p.calificaciones || {})[cid]).filter(Boolean);
    const dc = DEMO.find(c => c.id === cid);
    let sum = all.reduce((s, c) => s + (c.puntualidad + c.precio + c.estado) / 3, 0), n = all.length;
    if (dc) { sum += dc.rating[0] * dc.rating[1]; n += dc.rating[1]; }
    return { prom: n ? Math.round(sum / n * 10) / 10 : null, n, propias: all };
  }

  /* ---------- mensajes privados (cliente ↔ cada corralón) ---------- */
  function hilo(p, cid) {
    let msgs = ((p.hilos || {})[cid] || []).slice();
    const dc = DEMO.find(c => c.id === cid);
    if (dc) {                                                               // respuestas automáticas de demostración
      const t = now();
      if (dc.pregunta && t >= p.createdAt + 40000) msgs.push({ de: 'corralon', autor: dc.nombre, texto: dc.pregunta, at: p.createdAt + 40000, auto: true });
      ((p.hilos || {})[cid] || []).filter(m => m.de === 'cliente').forEach(m => {
        if (t >= m.at + 5000) msgs.push({ de: 'corralon', autor: dc.nombre, texto: '¡Gracias por la respuesta! Lo tenemos en cuenta para tu presupuesto.', at: m.at + 5000, auto: true });
      });
    }
    return msgs.sort((a, b) => a.at - b.at);
  }
  function enviarMensaje(pedidoId, cid, de, texto, autor) {
    return mutarPedido(pedidoId, p => {
      p.hilos = p.hilos || {}; p.hilos[cid] = p.hilos[cid] || [];
      p.hilos[cid].push({ de, autor, texto: texto.trim(), at: now() });
      marcarLeidoMut(p, cid, de);
    });
  }
  function marcarLeidoMut(p, cid, lado) { p.leido = p.leido || {}; p.leido[lado + ':' + cid] = now(); }
  const marcarLeido = (pedidoId, cid, lado) => mutarPedido(pedidoId, p => marcarLeidoMut(p, cid, lado));
  function noLeidos(p, cid, lado) {
    const last = (p.leido || {})[lado + ':' + cid] || 0;
    return hilo(p, cid).filter(m => m.de !== lado && m.at > last && m.at <= now()).length;
  }

  /* ---------- lado corralón ---------- */
  const pedidosParaCorralon = c => (!c || !c.perfil) ? [] : db().pedidos.filter(p => p.provincia === c.perfil.provincia);
  const respuestaDe = (p, cid) => (p.respuestas || []).find(q => q.corralonId === cid) || null;
  function responder(pedidoId, c, data) {
    const u = usuarioActual(), ped = pedido(pedidoId);
    if (!ped || !abierto(ped)) return null;
    return mutarPedido(pedidoId, p => {
      p.respuestas = (p.respuestas || []).filter(q => q.corralonId !== c.id);
      p.respuestas.push(Object.assign({ corralonId: c.id, nombre: c.perfil.nombre, demo: false, tel: c.perfil.whatsapp, fecha: now(), por: u ? u.nombre : '' }, data));
    });
  }
  // Datos agregados de la zona: nunca expone precios de otros corralones.
  function datosZona(c) {
    const ps = pedidosParaCorralon(c), mes = now() - 30 * DAY;
    const mat = {};
    ps.forEach(p => p.items.forEach(it => { const k = norm(it.name); mat[k] = mat[k] || { name: it.name, unit: it.unit, pedidos: 0, qty: 0 }; mat[k].pedidos++; mat[k].qty += it.qty; }));
    const top = Object.values(mat).sort((a, b) => b.pedidos - a.pedidos || b.qty - a.qty).slice(0, 8);
    const comp = {};
    ps.forEach(p => {
      const mine = respuestaDe(p, c.id); if (!mine) return;
      const otros = respuestas(p).filter(q => q.corralonId !== c.id);
      p.items.forEach((it, i) => {
        const mi = mine.items[i]; if (!mi || mi.sinStock) return;
        const vals = otros.map(q => q.items[i]).filter(x => x && !x.sinStock).map(x => x.precio);
        if (vals.length < 2) return;                                         // con menos de 2 no se calcula: evitaría deducir un precio ajeno
        const prom = vals.reduce((a, b) => a + b, 0) / vals.length, k = norm(it.name);
        comp[k] = comp[k] || { name: it.name, difs: [] }; comp[k].difs.push((mi.precio - prom) / prom * 100);
      });
    });
    const vsProm = Object.values(comp).map(x => ({ name: x.name, dif: Math.round(x.difs.reduce((a, b) => a + b, 0) / x.difs.length), n: x.difs.length })).sort((a, b) => b.dif - a.dif);
    const mios = ps.filter(p => respuestaDe(p, c.id));
    const ganados = ps.filter(p => parteDe(p, c.id)).length;
    const cerrados = mios.filter(p => p.adjudicacion).length;
    return { pedidosMes: ps.filter(p => p.createdAt >= mes).length, total: ps.length, respondidos: mios.length, ganados, cerrados,
      tasaRespuesta: ps.length ? Math.round(mios.length / ps.length * 100) : 0, tasaCierre: cerrados ? Math.round(ganados / cerrados * 100) : null, top, vsProm };
  }
  function pedidoDePrueba(provincia, localidad) {
    const muestras = [
      [['Cemento portland x 50 kg', 40, 'bolsa'], ['Hierro aletado Ø8 mm x 12 m', 60, 'barra'], ['Arena gruesa', 6, 'm³'], ['Ladrillo hueco 18x18x33', 900, 'u'], ['Cal hidratada x 25 kg', 20, 'bolsa']],
      [['Chapa sinusoidal C25', 48, 'm'], ['Tirante de pino 2x6" x 4 m', 14, 'u'], ['Membrana asfáltica 4 mm', 3, 'rollo'], ['Tornillo autoperforante para chapa', 2, 'caja']],
      [['Caño PVC 110 mm x 4 m', 6, 'u'], ['Codo PVC 110 mm 90°', 8, 'u'], ['Caño termofusión 20 mm x 4 m', 12, 'u'], ['Tanque de agua 1000 L', 1, 'u']]
    ];
    const m = muestras[Math.floor(Math.random() * muestras.length)];
    return crearPedido({
      tipo: 'particular', cliente: { nombre: 'Cliente', apellido: 'de prueba', email: 'prueba@demo.cotizaobra', telefono: '+54 9 000 000-0000' },
      items: m.map(([name, qty, unit]) => ({ name, qty, unit })), provincia, localidad: localidad || '', direccion: '',
      fecha: new Date(now() + 7 * DAY).toISOString().slice(0, 10), acceso: 'Sin restricciones', notas: '', prueba: true
    });
  }

  /* ---------- header según la sesión ---------- */
  function decorarHeader() {
    const cli = clienteActual(), cor = corralonActual();
    const corNombre = cor && cor.perfil && cor.perfil.nombre;
    const ini = t => String(t || '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
    const label = cli ? cli.nombre : cor ? (corNombre || 'Mi panel') : '';
    document.querySelectorAll('[data-login-text]').forEach(el => { el.textContent = label || 'Ingresar'; });
    document.querySelectorAll('[data-login-avatar]').forEach(el => {
      el.textContent = cli ? ini(cli.nombre + ' ' + (cli.apellido || '')) : cor ? ini(corNombre || 'C') : '';
      el.classList.toggle('hidden', !label); el.classList.toggle('grid', !!label);
    });
    document.querySelectorAll('[data-login-icon]').forEach(el => el.classList.toggle('hidden', !!label));
    const set = (sel, txt) => document.querySelectorAll(sel).forEach(el => { el.textContent = txt; });
    set('[data-login-cliente-title]', cli ? 'Mis pedidos' : 'Soy cliente');
    set('[data-login-cliente-sub]', cli ? `Ingresaste como ${cli.nombre}` : 'Mis pedidos · entrás con email y PIN');
    set('[data-login-corralon-title]', cor ? 'Mi panel' : 'Soy corralón');
    set('[data-login-corralon-sub]', cor ? (corNombre || cor.email) : 'Panel de pedidos · email y contraseña');
    document.querySelectorAll('[data-login-corralon]').forEach(a => {
      if (cor) { a.removeAttribute('data-auth'); a.dataset.auth = ''; a.setAttribute('href', 'panel-corralon.html'); }
    });
    document.querySelectorAll('[data-login-signup]').forEach(el => el.classList.toggle('hidden', !!cor));
    document.querySelectorAll('[data-login-logout]').forEach(el => {
      const btns = [];
      if (cli) btns.push(['cliente', `Salir de Mis pedidos`]);
      if (cor) btns.push(['corralon', `Salir del panel`]);
      el.innerHTML = btns.map(([t, l]) => `<button type="button" data-logout="${t}" role="menuitem" class="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-stone-600 hover:bg-stone-50 hover:text-brand-700"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/></svg>${l}</button>`).join('');
      el.classList.toggle('hidden', !btns.length);
    });
  }
  // Menú "Ingresar" del encabezado
  (function loginMenu() {
    const init = () => {
      const btn = document.getElementById('loginBtn'), menu = document.getElementById('loginMenu');
      if (!btn || !menu) return;
      const chev = btn.querySelector('.login-chev');
      const setOpen = open => {
        menu.hidden = !open; btn.setAttribute('aria-expanded', String(open));
        if (chev) chev.style.transform = open ? 'rotate(180deg)' : '';
        if (open) { menu.animate([{ opacity: 0, transform: 'translateY(-6px) scale(.98)' }, { opacity: 1, transform: 'none' }], { duration: 160, easing: 'cubic-bezier(.23,1,.32,1)' }); }
      };
      btn.addEventListener('click', e => { e.stopPropagation(); setOpen(menu.hidden); });
      document.addEventListener('click', e => { if (!menu.hidden && !menu.contains(e.target)) setOpen(false); });
      menu.addEventListener('click', e => { if (e.target.closest('a,button')) setTimeout(() => setOpen(false), 0); });
      document.addEventListener('keydown', e => { if (e.key === 'Escape' && !menu.hidden) { setOpen(false); btn.focus(); } });
      document.addEventListener('click', e => {
        const b = e.target.closest && e.target.closest('[data-logout]'); if (!b) return;
        logout(b.dataset.logout); decorarHeader(); ir('index.html');
      });
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  })();

  /* ---------- app instalable + avisos del navegador ---------- */
  const app = (() => {
    let deferred = null;
    const framed = (() => { try { return window.top !== window.self; } catch (e) { return true; } })();   // visor o app de un solo archivo
    const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const swOk = 'serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1');
    if (swOk && !framed) navigator.serviceWorker.register('sw.js').catch(() => {});
    const notifOk = 'Notification' in window && !framed && (location.protocol === 'https:' || location.hostname === 'localhost');
    const puedeInstalar = () => !framed && !standalone() && !!(deferred || (ios && swOk));
    const avisos = () => notifOk ? Notification.permission : 'no';
    function paint() {
      document.querySelectorAll('[data-install]').forEach(el => { el.hidden = !puedeInstalar(); });
      document.querySelectorAll('[data-notify]').forEach(el => {
        const st = avisos(); el.hidden = st === 'no' || st === 'denied';
        el.disabled = st === 'granted';
        const t = el.querySelector('[data-notify-text]'); if (t) t.textContent = st === 'granted' ? 'Avisos activados' : 'Activar avisos';
      });
      document.querySelectorAll('[data-app-banner]').forEach(b => { b.hidden = ![...b.querySelectorAll('[data-install],[data-notify]')].some(x => !x.hidden && !x.disabled); });
    }
    function iosAyuda() {
      let d = document.getElementById('iosInstall');
      if (!d) {
        d = document.createElement('div'); d.id = 'iosInstall';
        d.className = 'fixed inset-0 z-[95] flex items-end justify-center bg-black/55 p-3 sm:items-center';
        d.innerHTML = `<div class="w-full max-w-sm rounded-[1.5rem] bg-white p-6 text-ink shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="iosT">
          <div class="flex items-center gap-3"><img src="icons/icon-192.png" alt="" class="h-12 w-12 rounded-xl"><div><p id="iosT" class="text-lg font-extrabold">Instalá CotizaObra</p><p class="text-xs text-stone-500">Queda en tu pantalla de inicio, como una app.</p></div></div>
          <ol class="mt-5 space-y-3 text-sm">
            <li class="flex items-center gap-3"><span class="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-50 text-xs font-black text-brand-700">1</span>Tocá <b>Compartir</b> <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2v13"/><path d="m16 6-4-4-4 4"/><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/></svg> en la barra de Safari.</li>
            <li class="flex items-center gap-3"><span class="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-50 text-xs font-black text-brand-700">2</span>Elegí <b>Agregar a inicio</b>.</li>
            <li class="flex items-center gap-3"><span class="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-50 text-xs font-black text-brand-700">3</span>Tocá <b>Agregar</b>. ¡Listo!</li>
          </ol>
          <button type="button" data-close class="mt-6 flex h-12 w-full items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white">Entendido</button></div>`;
        d.addEventListener('click', e => { if (e.target === d || e.target.closest('[data-close]')) d.remove(); });
        document.body.appendChild(d);
      }
    }
    async function instalar() {
      if (deferred) { deferred.prompt(); try { await deferred.userChoice; } catch (e) {} deferred = null; paint(); return; }
      if (ios) iosAyuda();
    }
    async function activarAvisos() { if (!notifOk) return 'no'; const r = await Notification.requestPermission(); paint(); if (r === 'granted') avisar('Avisos activados', 'Te avisamos acá cuando haya novedades.', location.pathname.split('/').pop() || 'index.html'); return r; }
    async function avisar(title, body, url) {
      if (avisos() !== 'granted') return;
      try {
        const reg = swOk && await navigator.serviceWorker.getRegistration();
        if (reg) return reg.showNotification(title, { body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: url || title, data: { url } });
        new Notification(title, { body, icon: 'icons/icon-192.png' });
      } catch (e) { /* el navegador no permite avisos acá */ }
    }
    addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; paint(); });
    addEventListener('appinstalled', () => { deferred = null; paint(); });
    document.addEventListener('click', e => {
      if (e.target.closest && e.target.closest('[data-install]')) { e.preventDefault(); instalar(); }
      else if (e.target.closest && e.target.closest('[data-notify]')) { e.preventDefault(); activarAvisos(); }
    });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', paint); else setTimeout(paint);
    return { paint, instalar, activarAvisos, avisar, puedeInstalar, avisos, standalone };
  })();

  /* ---------- tarjetas que se inclinan al pasar el mouse ---------- */
  (function tilt() {
    const fine = matchMedia('(hover: hover) and (pointer: fine)'), calm = matchMedia('(prefers-reduced-motion: reduce)');
    let cur = null;
    const reset = el => { el.classList.remove('tilting'); el.style.removeProperty('--rx'); el.style.removeProperty('--ry'); };
    document.addEventListener('pointermove', e => {
      if (!fine.matches || calm.matches || e.pointerType !== 'mouse') return;
      const el = e.target.closest && e.target.closest('[data-tilt]');
      if (cur && cur !== el) { reset(cur); cur = null; }
      if (!el) return;
      if (!el.querySelector(':scope > .tilt-glare')) { const g = document.createElement('span'); g.className = 'tilt-glare'; g.setAttribute('aria-hidden', 'true'); el.appendChild(g); }
      const r = el.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      const k = Math.min(1, 520 / Math.max(r.width, 1));          // las tarjetas grandes se inclinan menos
      el.style.setProperty('--ry', ((x - .5) * 7 * k).toFixed(2) + 'deg');
      el.style.setProperty('--rx', ((.5 - y) * 6 * k).toFixed(2) + 'deg');
      el.style.setProperty('--mx', (x * 100).toFixed(1) + '%'); el.style.setProperty('--my', (y * 100).toFixed(1) + '%');
      el.style.transitionDelay = '0s'; el.classList.add('tilting'); cur = el;
    }, { passive: true });
    document.addEventListener('pointerleave', () => { if (cur) { reset(cur); cur = null; } });
    document.addEventListener('pointerdown', () => { if (cur) { reset(cur); cur = null; } }, { passive: true });
  })();

  /* ---------- pasar datos entre páginas sin usar la URL ---------- */
  const PASE = 'cotizaobra:pase';
  // Dentro de la app de un solo archivo, cada sección se carga por dentro: no se navega a otro archivo
  const shell = (() => { try { return window.parent !== window && window.parent.coShell ? window.parent.coShell : null; } catch (e) { return null; } })();
  function ir(url) { if (shell) shell.go(url); else location.href = url; }
  function irA(url, data) {
    let ok = false;
    try { sessionStorage.setItem(PASE, JSON.stringify(data || {})); ok = true; } catch (e) { /* sin almacenamiento: va por la URL */ }
    ir(ok || shell ? url : url + '?' + new URLSearchParams(data || {}).toString());
  }
  // Links: a otra sección → por la app; a "#algo" → cambio de ancla dentro de la misma página
  document.addEventListener('click', e => {
    if (e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const a = e.target.closest && e.target.closest('a[href]'); if (!a || a.target === '_blank') return;
    const href = a.getAttribute('href');
    if (/^[\w-]+\.html(#[\w.~-]*)?$/.test(href)) { if (shell) { e.preventDefault(); ir(href); } return; }
    if (shell && href.charAt(0) === '#') {
      e.preventDefault();
      const id = href.slice(1), el = id && document.getElementById(id);
      if (location.hash === href && el) el.scrollIntoView({ behavior: 'smooth' });
      else location.hash = id;
    }
  });
  function recibir() {
    try { const v = JSON.parse(sessionStorage.getItem(PASE) || 'null'); sessionStorage.removeItem(PASE); return v || {}; } catch (e) { return {}; }
  }

  /* ---------- aviso de demo ---------- */
  // Dentro del visor de Claude la página corre en un marco: ahí no se pueden descargar archivos.
  const enVisor = (() => { try { const w = shell ? window.parent : window; return w.self !== w.top; } catch (e) { return true; } })();
  const VISTO = 'cotizaobra:demo-visto';
  function demoAviso() {
    const logo = document.querySelector('#siteHeader a[href="index.html"], #siteHeader a[href="#inicio"]');
    if (!logo || document.getElementById('demoChip')) return;
    const chip = document.createElement('button');
    chip.type = 'button'; chip.id = 'demoChip';
    chip.className = 'rounded-full bg-white/15 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[.14em] text-white transition hover:bg-white/25';
    chip.textContent = 'Demo'; chip.setAttribute('aria-label', 'Qué es esta demo');
    logo.appendChild(chip);
    const dlg = document.createElement('div');
    dlg.id = 'demoDlg';
    dlg.className = 'fixed inset-0 z-[90] hidden items-end justify-center bg-black/55 sm:items-center sm:p-6';
    dlg.setAttribute('role', 'dialog'); dlg.setAttribute('aria-modal', 'true'); dlg.setAttribute('aria-labelledby', 'demoTitle');
    dlg.innerHTML = `
      <div class="w-full max-w-lg rounded-t-[1.75rem] bg-white p-6 text-ink shadow-2xl sm:rounded-[1.75rem] sm:p-8" style="padding-bottom:calc(1.5rem + env(safe-area-inset-bottom, 0px))">
        <span class="inline-flex rounded-full bg-brand-600 px-3 py-1 text-[11px] font-bold uppercase tracking-[.14em] text-white">Versión de demostración</span>
        <h2 id="demoTitle" class="mt-4 text-2xl font-extrabold tracking-tight">Probá CotizaObra de punta a punta</h2>
        <ul class="mt-4 space-y-2.5 text-sm leading-relaxed text-stone-600">
          <li class="flex gap-2.5"><span class="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-600"></span>Los corralones marcados “demo”, sus precios y sus calificaciones son ficticios. Responden solos en un par de minutos.</li>
          <li class="flex gap-2.5"><span class="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-600"></span>Lo que cargues queda solo en este navegador. Nadie más lo ve y no se envían emails ni WhatsApp.</li>
          <li class="flex gap-2.5"><span class="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-600"></span>No uses contraseñas ni datos reales.</li>
        </ul>
        <p class="mt-5 rounded-2xl bg-sand p-4 text-sm leading-relaxed text-stone-700"><b class="text-ink">Para ver todo el circuito:</b> pedí una cotización en Tucumán y seguila en Mis pedidos. Para el lado del corralón, tocá “Soy corralón”, creá una cuenta y elegí Tucumán como provincia.</p>
        <div class="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          <button type="button" id="demoReset" class="inline-flex h-12 items-center justify-center rounded-full border border-stone-200 px-5 text-sm font-bold text-stone-700 hover:border-ink">Empezar de cero</button>
          <button type="button" id="demoOk" class="inline-flex h-12 items-center justify-center rounded-full bg-brand-600 px-7 text-sm font-bold text-white hover:bg-brand-700">Entendido</button>
        </div>
      </div>`;
    document.body.appendChild(dlg);
    let last = null, armed = false;
    const open = () => { last = document.activeElement; armed = false; dlg.querySelector('#demoReset').textContent = 'Empezar de cero'; dlg.classList.remove('hidden'); dlg.classList.add('flex'); dlg.querySelector('#demoOk').focus(); };
    const isOpen = () => !dlg.classList.contains('hidden');
    const close = () => { dlg.classList.add('hidden'); dlg.classList.remove('flex'); try { localStorage.setItem(VISTO, '1'); } catch (e) {} if (last && last.focus) last.focus(); };
    chip.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); open(); });
    dlg.querySelector('#demoOk').addEventListener('click', close);
    dlg.addEventListener('click', e => { if (e.target === dlg) close(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && isOpen()) close(); });
    dlg.querySelector('#demoReset').addEventListener('click', e => {
      if (!armed) { armed = true; e.currentTarget.textContent = 'Tocá de nuevo para borrar todo'; return; }
      try { Object.keys(localStorage).filter(k => k.startsWith('cotizaobra:')).forEach(k => localStorage.removeItem(k)); localStorage.setItem(VISTO, '1'); } catch (err) {}
      try { sessionStorage.removeItem(PASE); } catch (err) {}
      ir('index.html');
    });
    let visto = false; try { visto = !!localStorage.getItem(VISTO); } catch (e) {}
    if (!visto) setTimeout(open, 600);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', demoAviso); else demoAviso();

  window.CO = {
    ir, irA, recibir, enVisor,
    db, commit, onChange, session, setSession, logout, genPin, money, timeAgo, fmtDate, fmtTs, fmtTime, norm,
    DEMORAS, VALIDEZ, PAGOS, ENTREGA_PASOS, isDemo, itemPrecio, itemDisponible,
    clienteRegistrar, clienteIngresar, clienteActual, listas, guardarLista, borrarLista,
    corralonRegistrar, corralonIngresar, corralonActual, usuarioActual, esDueno, corralonGuardarPerfil, logoDe, corralonGuardarAvisos, equipoAgregar, equipoQuitar,
    parseListaPrecios, parsePrecio, preciosImportar, precioQuitar, buscarPrecio,
    crearPedido, pedido, pedidosDeCliente, destinatarios, respuestas, estado, contactoCorralon, nombreCorralon, adjudicados,
    combinacionOptima, evaluarAsignacion, adjudicar, parteDe, entregaEstado, avanzarEntrega, confirmarRecepcion, calificar, rating,
    hilo, enviarMensaje, marcarLeido, noLeidos,
    pedidosParaCorralon, respuestaDe, responder, adheridos, perfilPublico, app, borrarPedido, restaurarPedido, obrasDe, guardarObra, borrarObra, pedidosArchivados, desarchivarPedido, PLAZO_H, cierre, abierto, restante, fmtRestante, cerrarPedido, datosZona, pedidoDePrueba, decorarHeader
  };
})();
