/* ── MOCK DATA ─────────────────────────────────────── */
const MOCK = {
  serverOnline:  true,
  monoCategoria: "C",
  monoFacturado: 875420,
  monoLimite:    1166652.31,
  monoMes:       "Período: Enero – Diciembre 2025",
  hoyFacturado:  48500,  hoyDelta: "+12% vs ayer",   hoyTipo: "up",
  pendientesCAE: 3,      pendDelta:"Requieren emisión", pendTipo:"warn",
  mesFacturado:  875420, mesDelta: "+8% vs mes ant.", mesTipo: "up",
  chartDias:   ["01","02","03","04","05","06","07","08","09","10","11","12","13","14"],
  chartVentas: [32000,18000,45000,62000,28000,53000,71000,44000,38000,55000,67000,29000,48500,48500],
  comprobantes: [
    {id:"FC-A-0002-00000451",cliente:"María González",    tipo:"FC A",fecha:"13/06/25",monto:18500,estado:"cae-ok"},
    {id:"FC-A-0002-00000450",cliente:"Carlos Rodríguez",  tipo:"FC A",fecha:"13/06/25",monto:12000,estado:"cae-ok"},
    {id:"FC-A-0002-00000449",cliente:"Ana Martínez",      tipo:"FC A",fecha:"12/06/25",monto:8500, estado:"cae-pend"},
    {id:"FC-A-0002-00000448",cliente:"Textiles del Sur SRL",tipo:"FC A",fecha:"12/06/25",monto:35000,estado:"cae-pend"},
    {id:"FC-A-0002-00000447",cliente:"Laura Sánchez",     tipo:"FC A",fecha:"11/06/25",monto:9500, estado:"cae-err"},
  ]
};

/* ── HELPERS ───────────────────────────────────────── */
const ars = n => new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS',maximumFractionDigits:0}).format(n);
const arsShort = n => n>=1e6?`$${(n/1e6).toFixed(2)}M`:n>=1e3?`$${(n/1e3).toFixed(0)}k`:`$${n}`;

const ICONS = {success:'check_circle',error:'error',info:'info',warn:'warning'};
function toast(msg,type='info'){
  const el=document.createElement('div');
  el.className=`toast ${type}`;
  el.innerHTML=`<span class="material-icons" style="font-size:15px">${ICONS[type]||'info'}</span> ${msg}`;
  document.getElementById('toasts').appendChild(el);
  setTimeout(()=>el.remove(),3200);
}

/* ── RENDER ────────────────────────────────────────── */
function renderStatus(online){
  // Sidebar dot
  const dot=document.getElementById('sidebarDot');
  const lbl=document.getElementById('sidebarLabel');
  dot.className=`status-dot ${online?'':'offline'}`;
  lbl.textContent=online?'Activo':'Sin conexión';
  // Topbar pill
  const tdot=document.getElementById('topbarDot');
  const tlbl=document.getElementById('topbarLabel');
  if(tdot) { tdot.className=`status-dot ${online?'':'offline'}`; }
  if(tlbl) { tlbl.textContent=online?'AFIP Activo':'Sin conexión'; }
}

function renderMono(d){
  document.getElementById('monoCat').textContent=`Cat ${d.monoCategoria}`;
  document.getElementById('monoMes').textContent=d.monoMes;
  const ps=document.getElementById('topbarPeriod');
  if(ps) ps.textContent=d.monoMes;
  document.getElementById('monoVal').textContent=
    new Intl.NumberFormat('es-AR',{maximumFractionDigits:0}).format(d.monoFacturado);
  document.getElementById('monoLimVal').textContent=ars(d.monoLimite);
  const pct=Math.min((d.monoFacturado/d.monoLimite)*100,100);
  const fill=document.getElementById('progFill');
  const pctEl=document.getElementById('progPct');
  requestAnimationFrame(()=>{fill.style.width=pct.toFixed(1)+'%';});
  let cls='',pc='';
  if(pct>=90){cls='crit';pc='crit';}else if(pct>=70){cls='warn';pc='warn';}
  fill.className=`prog-fill ${cls}`;
  pctEl.textContent=pct.toFixed(1)+'%'; pctEl.className=`prog-pct ${pc}`;
  document.getElementById('progMes').textContent=`${pct.toFixed(1)}% del límite utilizado`;
}

function renderMetrics(d){
  const set=(id,val,did,delta,tipo)=>{
    const el=document.getElementById(id); el.textContent=val; el.className='mc-value';
    const dd=document.getElementById(did); dd.textContent=delta; dd.className=`mc-delta ${tipo}`;
  };
  set('mcHoy', ars(d.hoyFacturado),  'dcHoy', d.hoyDelta,  d.hoyTipo);
  set('mcPend',d.pendientesCAE,       'dcPend',d.pendDelta, d.pendTipo);
  set('mcMes', ars(d.mesFacturado),   'dcMes', d.mesDelta,  d.mesTipo);
  if(d.pendientesCAE>0) document.getElementById('mcPend').style.color='var(--yellow)';
  document.getElementById('navBadge').textContent=d.pendientesCAE;
}

let chartInst=null;
function renderChart(d){
  document.getElementById('chartTotal').textContent=arsShort(d.chartTotal || d.mesFacturado);
  const ctx=document.getElementById('salesChart').getContext('2d');
  const grad=ctx.createLinearGradient(0,0,0,160);
  grad.addColorStop(0,'rgba(0,230,118,0.28)');
  grad.addColorStop(1,'rgba(0,230,118,0)');
  if(chartInst) chartInst.destroy();
  chartInst=new Chart(ctx,{
    type:'line',
    data:{
      labels:d.chartDias,
      datasets:[{
        data:d.chartVentas, fill:true,
        backgroundColor:grad, borderColor:'#00e676', borderWidth:2,
        pointRadius:0, pointHoverRadius:5,
        pointHoverBackgroundColor:'#00e676', tension:0.45
      }]
    },
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{
        legend:{display:false},
        tooltip:{
          backgroundColor:'#17172a',
          borderColor:'rgba(0,230,118,0.2)', borderWidth:1,
          titleColor:'#8888aa', bodyColor:'#f0f0fa',
          titleFont:{family:'Plus Jakarta Sans',size:10},
          bodyFont:{family:'Space Grotesk',size:13,weight:'700'},
          padding:10,
          callbacks:{label:ctx=>` ${ars(ctx.raw)}`}
        }
      },
      scales:{
        x:{grid:{color:'rgba(255,255,255,0.04)',drawBorder:false},ticks:{color:'#44445a',font:{family:'Plus Jakarta Sans',size:10}}},
        y:{grid:{color:'rgba(255,255,255,0.04)',drawBorder:false},ticks:{color:'#44445a',font:{family:'Space Grotesk',size:10},callback:v=>arsShort(v)}}
      }
    }
  });
}

function renderComps(lista){
  document.getElementById('compBadge').textContent=lista.length;
  const cont=document.getElementById('compList');
  if(!lista.length){
    cont.innerHTML=`<div style="padding:30px;text-align:center;color:var(--text-3);font-size:12px">Sin ventas este mes</div>`;
    return;
  }
  cont.innerHTML=lista.map((c,i)=>{
    const emitido = c.estado === 'cae-ok';
    const btnEmitir = emitido
      ? `<button class="act-btn act-done" title="Emitido ✓" disabled><svg width='13' height='13' viewBox='0 0 14 14' fill='none'><path d='M2.5 7l3 3 6-6' stroke='currentColor' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'/></svg></button>`
      : `<button class="act-btn act-warn" title="Emitir CAE — requiere credenciales AFIP" onclick="emitir('${c._id||c.id}')"><svg width='13' height='13' viewBox='0 0 14 14' fill='none'><path d='M7 1.5l5.5 10H1.5L7 1.5z' stroke='currentColor' stroke-width='1.3' stroke-linejoin='round'/><path d='M7 5.5v3' stroke='currentColor' stroke-width='1.3' stroke-linecap='round'/><circle cx='7' cy='10' r='.6' fill='currentColor'/></svg></button>`;
    return `
    <div class="comp-row" style="animation-delay:${i*55}ms">
      <div class="cae-dot ${c.estado}"></div>
      <div class="comp-info">
        <div class="comp-cliente">${c.cliente}</div>
        <div class="comp-meta">
          ${c.concepto ? `<span style="color:var(--text-2);font-size:11px">${c.concepto.length>48?c.concepto.slice(0,46)+'…':c.concepto}</span> · ` : ''}${c.estado==='cae-ok'&&c.cae ? `CAE ${c.cae.slice(-8)} · Vto ${c.caeVto||'—'}` : c.fecha}
        </div>
      </div>
      <div class="comp-monto">${ars(c.monto)}</div>
      <div class="comp-actions">
        <button class="act-btn" title="Ver PDF"     onclick="verPDF('${c._id||c.id}')"><svg width="13" height="13" viewBox="0 0 14 14" fill="none"><rect x="2" y="1" width="8" height="11" rx="1.5" stroke="currentColor" stroke-width="1.3"/><path d="M4 4.5h4M4 6.5h4M4 8.5h2.5" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg></button>
        ${btnEmitir}
        <button class="act-btn" title="Enviar mail" onclick="enviarMail('${c._id||c.id}')"><svg width="13" height="13" viewBox="0 0 14 14" fill="none"><rect x="1.5" y="3" width="11" height="8" rx="1.5" stroke="currentColor" stroke-width="1.3"/><path d="M1.5 5l5.5 3.5L12.5 5" stroke="currentColor" stroke-width="1.2"/></svg></button>
      </div>
    </div>`;
  }).join('');
}

/* ── CARGA INICIAL ─────────────────────────────────── */
function cargarDashboard(data){
  const d=data||MOCK;
  renderStatus(d.serverOnline);
  renderMono(d);
  renderMetrics(d);
  renderChart(d);
  renderComps(d.comprobantes);
}

/* ── API BRIDGE — reemplaza gasRun para entorno web Render ── */
//
//  gasRun(fn, args, onOk, onErr) mantiene la misma firma que
//  antes para no romper ninguna llamada existente en el código.
//  Internamente mapea cada fn al endpoint REST correspondiente.

const API_MAP = {
  obtenerEstadoInfo:    () => api.get('/api/stats/dashboard'),
  obtenerMetricas:      () => api.get('/api/stats/dashboard'),
  obtenerManuales:      () => api.get('/api/orders?platform=manual'),
  obtenerTodosComprobantes: () => api.get('/api/orders?limit=200'),
  conmutarEstado:       () => api.post('/api/me/settings', { toggle: 'status' }),
  verificarSuscripcion: () => api.get('/api/me'),
  guardarConfiguracion: (datos) => api.patch('/api/me/settings', datos[0] || {}),
  registrarVentaManual: (args) => api.post('/api/orders/manual', args[0] || {}),
  anularManual:         (args) => api.post(`/api/orders/${args[0]}/anular`, {}),
  enviarMail:           (args) => api.post(`/api/orders/${args[0]}/mail`, {}),
  verPDF:               (args) => api.get(`/api/orders/${args[0]}/pdf`),
  emitirComprobante:    (args) => api.post(`/api/orders/${args[0]}/emitir`, {}),
  exportarIvaVentas:    () => api.get('/api/reports/iva-ventas'),
};

// HTTP helper con manejo de errores
const api = {
  async _fetch(method, path, body) {
    const opts = {
      method,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(path, opts);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
  },
  get:   (path)       => api._fetch('GET',    path),
  post:  (path, body) => api._fetch('POST',   path, body),
  patch: (path, body) => api._fetch('PATCH',  path, body),
  del:   (path)       => api._fetch('DELETE', path),
};

// Transforma la respuesta de /api/stats/dashboard al formato
// interno que esperan cargarDashboard() y las funciones render*
function adaptarStats(raw) {
  if (!raw) return null;

  const ahora  = new Date();
  const mesNom = ahora.toLocaleString('es-AR', { month:'long', year:'numeric' });

  // Calcular ventas de HOY
  const hoyStr   = ahora.toISOString().slice(0,10);
  const hoyTotal = (raw.ultimas || [])
    .filter(o => o.createdAt?.slice(0,10) === hoyStr)
    .reduce((s, o) => s + (o.amount || 0), 0);

  // Comprobantes para la bandeja — enriquecidos con datos de CAE
  const comprobantes = (raw.ultimas || []).map(o => ({
    _id:         o._id,
    id:          o.nroFormatted || o.externalId || o._id,
    externalId:  o.externalId,
    cliente:     o.customerName  || 'Sin nombre',
    email:       o.customerEmail || '',
    tipo:        o.nroFormatted  || o.platform || 'Venta',
    concepto:    o.concepto || '',
    fecha:       (o.orderDate||o.createdAt) ? new Date(o.orderDate||o.createdAt).toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit',year:'2-digit'}) : '—',
    monto:       o.amount || 0,
    estado:      o.status === 'invoiced'        ? 'cae-ok'
               : o.status === 'error_afip'      ? 'cae-err'
               : o.status === 'error_data'      ? 'cae-err'
               : 'cae-pend',
    cae:         o.caeNumber || null,
    caeVto:      o.caeExpiry ? new Date(o.caeExpiry).toLocaleDateString('es-AR') : null,
    origen:      o.platform === 'manual' ? 'manual' : 'woo',
    platform:    o.platform,
  }));

  // Período formateado
  const desde  = raw.periodo?.desde ? new Date(raw.periodo.desde) : null;
  const hasta  = raw.periodo?.hasta ? new Date(raw.periodo.hasta) : null;
  const fmtP   = d => d?.toLocaleDateString('es-AR', { day:'2-digit', month:'2-digit', year:'numeric' });
  const periodoLabel = (desde && hasta) ? `${fmtP(desde)} → ${fmtP(hasta)}` : mesNom;

  return {
    serverOnline:    true,
    monoCategoria:   'C',
    monoFacturado:   raw.totalMonto     || 0,   // ingresos del período
    monoLimite:      2432364,
    monoMes:         `Período: ${periodoLabel}`,
    hoyFacturado:    hoyTotal,
    hoyDelta:        '',
    hoyTipo:         'up',
    pendientesCAE:   raw.pendientesCAE  || 0,   // viene del server (todos los tiempos)
    pendDelta:       raw.pendientesCAE > 0 ? `${raw.pendientesCAE} sin emitir` : 'Al día ✓',
    pendTipo:        raw.pendientesCAE > 0 ? 'warn' : 'up',
    mesFacturado:    raw.totalFacturado || 0,   // SOLO facturas con CAE emitido en el período
    mesDelta:        `${raw.totalFacturas || 0} facturas emitidas`,
    mesTipo:         'up',
    chartTotal:      raw.totalMonto     || 0,
    chartDias:       raw.chartDias      || [],
    chartVentas:     raw.chartVentas    || [],
    comprobantes,
  };
}

// gasRun() — firma idéntica al original
async function gasRun(fn, args, onOk, onErr) {
  const handler = API_MAP[fn];
  if (!handler) {
    console.warn(`gasRun: función '${fn}' no mapeada`);
    if (onOk) onOk(null);
    return;
  }
  try {
    const raw = await handler(args);

    // Adaptar respuestas específicas
    let result = raw;
    if (fn === 'obtenerEstadoInfo' || fn === 'obtenerMetricas') {
      result = adaptarStats(raw);
    }
    if (fn === 'obtenerTodosComprobantes') {
      // Devolver en formato { comprobantes: [...] }
      result = { comprobantes: (raw.orders || []).map(o => ({
        id:      o.externalId || o._id,
        cliente: o.customerName || 'Sin nombre',
        tipo:    o.platform || 'Venta',
        fecha:   o.createdAt ? new Date(o.createdAt).toLocaleDateString('es-AR') : '—',
        monto:   o.amount || 0,
        estado:  o.status === 'invoiced' ? 'cae-ok' : 'cae-pend',
        origen:  o.platform || 'woo',
        email:   o.customerEmail || '',
        concepto: o.platform || '',
      })) };
    }
    if (fn === 'obtenerManuales') {
      result = (raw.orders || []).map(o => ({
        id:      o.externalId || o._id,
        cliente: o.customerName || 'Sin nombre',
        email:   o.customerEmail || '',
        concepto: o.platform || '',
        fecha:   o.createdAt ? new Date(o.createdAt).toLocaleDateString('es-AR') : '—',
        tipo:    'Factura C',
        monto:   o.amount || 0,
        estado:  o.status === 'invoiced' ? 'emitido' : 'pendiente',
        origen:  'manual',
      }));
    }
    if (fn === 'verificarSuscripcion') {
      result = { activa: raw?.user?.plan === 'pro', fechaAlta: raw?.user?.creadoEn };
    }

    if (onOk) onOk(result);
  } catch(e) {
    console.error(`gasRun [${fn}] error:`, e.message);
    if (onErr) onErr(e);
    else toast(`Error: ${e.message}`, 'error');
  }
}

/* ── VISTAS ─────────────────────────────────────────── */
let vistaActual = 'dashboard';
function mostrarVista(v) {
  vistaActual = v;
  document.querySelectorAll('.content').forEach(el => el.style.display = 'none');
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  if (v === 'dashboard') {
    document.querySelector('.content').style.display = 'block';
    document.getElementById('nav-dashboard').classList.add('active');
  } else if (v === 'comprobantes') {
    document.getElementById('vista-comprobantes').style.display = 'block';
    document.getElementById('nav-comprobantes').classList.add('active');
    if (!_rangoDesde) _iniciarPeriodo();
    cargarTodosComprobantes();
  } else if (v === 'negocio') {
    document.getElementById('vista-negocio').style.display = 'block';
    document.getElementById('nav-negocio').classList.add('active');
    cargarIntegraciones();
  } else if (v === 'arca') {
    document.getElementById('vista-arca').style.display = 'block';
    document.getElementById('nav-arca').classList.add('active');
  } else if (v === 'config') {
    document.getElementById('vista-config').style.display = 'block';
    document.getElementById('nav-config').classList.add('active');
    cargarConfigVista();
  } else if (v === 'estado') {
    document.getElementById('vista-estado').style.display = 'block';
    document.getElementById('nav-estado').classList.add('active');
    verificarSuscripcion();
  }
}

/* ── SUSCRIPCIÓN KOI / MERCADO PAGO ─────────────────── */
function verificarSuscripcion() {
  gasRun('verificarSuscripcion', null,
    res => {
      if (res && res.activa) {
        mostrarSuscripcionActiva(res.fechaAlta);
      } else {
        document.getElementById('susc-activa').style.display   = 'none';
        document.getElementById('susc-inactiva').style.display = 'block';
        document.getElementById('susc-cargando').style.display = 'none';
      }
    },
    () => {
      document.getElementById('susc-inactiva').style.display = 'block';
    }
  );
  if (typeof google === 'undefined') {
    document.getElementById('susc-inactiva').style.display = 'block';
  }
}

function mostrarSuscripcionActiva(fechaAlta) {
  document.getElementById('susc-activa').style.display   = 'block';
  document.getElementById('susc-inactiva').style.display = 'none';
  document.getElementById('susc-cargando').style.display = 'none';
  if (fechaAlta) {
    document.getElementById('susc-fecha-alta').textContent = 'Activa desde ' + fechaAlta;
  }
}

function iniciarSuscripcion() {
  const btn = document.getElementById('btnSuscribir');
  document.getElementById('susc-inactiva').style.display = 'none';
  document.getElementById('susc-cargando').style.display = 'block';

  gasRun('crearLinkSuscripcion', null,
    res => {
      document.getElementById('susc-cargando').style.display = 'none';
      document.getElementById('susc-inactiva').style.display = 'block';
      if (res && res.error) {
        toast('Error: ' + res.error, 'error');
        return;
      }
      if (res && res.url) {
        // Abrir checkout de MP en nueva pestaña
        window.open(res.url, '_blank');
        toast('Redirigiendo a Mercado Pago…', 'info');
      }
    },
    err => {
      document.getElementById('susc-cargando').style.display = 'none';
      document.getElementById('susc-inactiva').style.display = 'block';
      toast('Error: ' + err.message, 'error');
    }
  );

  if (typeof google === 'undefined') {
    setTimeout(() => {
      document.getElementById('susc-cargando').style.display = 'none';
      document.getElementById('susc-inactiva').style.display = 'block';
      toast('Demo: redirigiendo a Mercado Pago…', 'info');
      window.open('https://www.mercadopago.com.ar', '_blank');
    }, 1500);
  }
}

function cancelarSuscripcion() {
  if (!confirm('¿Cancelar la suscripción a KOI APP?\nPerderás acceso al sistema al finalizar el período.')) return;
  toast('Procesando cancelación…', 'info');
  gasRun('cancelarSuscripcion', null,
    res => {
      if (res && res.ok) {
        toast('Suscripción cancelada', 'warn');
        verificarSuscripcion();
      } else {
        toast('Error al cancelar: ' + (res && res.error || 'desconocido'), 'error');
      }
    },
    err => toast('Error: ' + err.message, 'error')
  );
}

/* ── COMPROBANTES UNIFICADOS ────────────────────────── */
let _todosComp   = [];  // todos sin filtrar
let _filtroTipo  = 'todos';
let _filtroMes   = '';

function cargarTodosComprobantes() {
  document.getElementById('manualesBody').innerHTML =
    `<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--text-3);font-size:13px">
      <span class="material-icons" style="font-size:18px!important;opacity:.4;display:block;margin-bottom:8px">hourglass_empty</span>
      Cargando comprobantes…
    </td></tr>`;

  // Cargar desde la API REST
  api.get('/api/orders?limit=200')
    .then(raw => {
      _todosComp = (raw.orders || []).map(o => ({
        id:      o.externalId || o._id,
        cliente: o.customerName  || 'Sin nombre',
        email:   o.customerEmail || '',
        concepto: o.platform || '',
        fecha:   o.createdAt ? new Date(o.createdAt).toLocaleDateString('es-AR') : '—',
        tipo:    'Factura C',
        monto:   o.amount || 0,
        estado:  o.status === 'invoiced' ? 'emitido' : 'pendiente',
        origen:  o.platform === 'manual' ? 'manual' : 'woo',
      })).sort((a,b) => _parseFecha(b.fecha) - _parseFecha(a.fecha));
      filtrarComprobantes();
    })
    .catch(err => {
      document.getElementById('manualesBody').innerHTML =
        `<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--red);font-size:12px">
          Error: ${err.message}
        </td></tr>`;
    });
}

function _parseFecha(str) {
  if (!str) return 0;
  const p = str.split('/');
  if (p.length === 3) return new Date(p[2], p[1]-1, p[0]).getTime();
  return 0;
}

function _poblarSelectMes() {
  const sel    = document.getElementById('compFiltroMes');
  const meses  = {};
  _todosComp.forEach(c => {
    const p = (c.fecha || '').split('/');
    if (p.length === 3) meses[p[2]+'/'+p[1]] = p[1]+'/'+p[2];
  });
  const opts = Object.keys(meses).sort().reverse()
    .map(k => `<option value="${k}">${meses[k]}</option>`).join('');
  sel.innerHTML = '<option value="">Todos los meses</option>' + opts;
}

/* ── ARCA SYNC ──────────────────────────────────────── */
function iniciarSyncArca() {
  const cuit  = document.getElementById('arcaCuit').value.trim();
  const clave = document.getElementById('arcaClave').value.trim();
  if (!cuit || !clave) { toast('Ingresá CUIT y Clave Fiscal', 'warn'); return; }

  document.getElementById('arcaProgress').style.display = 'block';
  document.getElementById('btnArcaSync').disabled = true;

  const steps = ['astep1','astep2','astep3','astep4','astep5'];
  const labels = ['Validando CUIT…','Autenticando con AFIP…','Obteniendo certificado…','Configurando punto de venta…','¡Listo!'];
  let current = 0;

  function nextStep() {
    if (current > 0) {
      document.getElementById(steps[current-1]).classList.remove('active');
      document.getElementById(steps[current-1]).classList.add('done');
      const dot = document.getElementById(steps[current-1]).querySelector('.cfg-step-dot');
      if (dot) dot.style.background = 'var(--green)';
    }
    if (current >= steps.length) {
      document.getElementById('arcaProgressTitle').textContent = '¡Sincronización completada!';
      document.getElementById('arcaSpinner').style.display = 'none';
      document.getElementById('arcaStatusBadge').innerHTML = '<div class="status-dot" style="background:var(--green);box-shadow:0 0 6px var(--green)"></div><span style="color:var(--green)">Activo</span>';
      toast('✅ ARCA sincronizado correctamente', 'success');
      return;
    }
    document.getElementById(steps[current]).classList.add('active');
    document.getElementById('arcaProgressTitle').textContent = labels[current];
    current++;
    setTimeout(nextStep, 900 + Math.random() * 400);
  }

  // En producción aquí iría: fetch('/api/arca/sync', { method:'POST', body:... })
  nextStep();
}

/* ── TOGGLE INTEGRACIÓN ──────────────────────────────── */
function toggleIntegracion(platform, enabled) {
  // Actualizar estado visual de la card
  const card = document.getElementById('card-' + platform);
  if (card) card.classList.toggle('is-active', enabled);

  fetch(`/api/integrations/${platform}/toggle`, {
    method: 'POST', credentials: 'include',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ enabled }),
  })
  .then(r => r.json())
  .then(d => {
    if (!d.ok) {
      // Revertir toggle si falló
      const tog = document.getElementById('toggle-' + platform);
      if (tog) tog.checked = !enabled;
      toast('Error al actualizar integración', 'error');
    } else {
      toast(enabled ? `${platform} activada` : `${platform} desactivada`, enabled ? 'success' : 'warn');
    }
  })
  .catch(() => {
    const tog = document.getElementById('toggle-' + platform);
    if (tog) tog.checked = !enabled;
  });
}

/* ── MI NEGOCIO ─────────────────────────────────────── */
let _plataformaActual = null;

function cargarIntegraciones() {
  const cont = document.getElementById('negIntegraciones');
  if (typeof google !== 'undefined') {
    // En GAS no hay /api/integrations, usar datos reales cuando sea web
    return;
  }
  fetch('/api/integrations', { credentials:'include' })
    .then(r => r.json())
    .then(data => {
      const list = data.integrations || [];
      if (!list.length) {
        cont.innerHTML = `<div class="neg-empty">
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none" opacity=".3">
            <rect x="2" y="8" width="28" height="20" rx="3" stroke="var(--text-2)" stroke-width="1.5"/>
            <path d="M10 8V6a6 6 0 0 1 12 0v2" stroke="var(--text-2)" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
          <span>Todavía no conectaste ninguna tienda</span>
        </div>`;
        return;
      }
      const LOGOS = {
        woocommerce:  '🛍',
        tiendanube:   '☁️',
        mercadolibre: '🛒',
        empretienda:  '🏪',
        rappi:        '🛵',
      };
      // Actualizar toggles y descripciones en las cards
    const connectedPlatforms = {};
    list.forEach(i => { connectedPlatforms[i.platform] = i; });

    ['woocommerce','mercadolibre','tiendanube','empretienda','rappi','vtex'].forEach(p => {
      const tog  = document.getElementById('toggle-' + p);
      const desc = document.getElementById('desc-' + p);
      const card = document.getElementById('card-' + p);
      const integration = connectedPlatforms[p];
      if (tog) {
        tog.checked = integration && integration.status === 'active';
        if (card) card.classList.toggle('is-active', tog.checked);
      }
      if (desc) {
        desc.textContent = integration
          ? (integration.status === 'active' ? `✓ Conectada — ${integration.storeName || integration.storeId}` : '⚠ Error de conexión')
          : 'Sin conectar';
        desc.style.color = integration && integration.status === 'active' ? 'var(--green)' : '';
      }
    });

    // También renderizar lista de integraciones activas arriba
    if (!list.length) {
      cont.innerHTML = `<div class="neg-empty">
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none" opacity=".3">
          <rect x="2" y="8" width="28" height="20" rx="3" stroke="var(--text-2)" stroke-width="1.5"/>
          <path d="M10 8V6a6 6 0 0 1 12 0v2" stroke="var(--text-2)" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        <span>Todavía no conectaste ninguna tienda</span>
      </div>`;
      return;
    }

    cont.innerHTML = list.map(i => `
        <div class="neg-integration">
          <div class="neg-integration-logo">${LOGOS[i.platform] || '🔗'}</div>
          <div class="neg-integration-info">
            <div class="neg-integration-name">${i.storeName || i.storeId}</div>
            <div class="neg-integration-url">${i.platform} · ${i.storeUrl || i.storeId}</div>
          </div>
          <span class="neg-integration-status ${i.status === 'active' ? 'neg-status-ok' : 'neg-status-error'}">
            ${i.status === 'active' ? '● Activa' : '✕ Error'}
          </span>
          <button class="neg-disconnect-btn" onclick="desconectar('${i._id}')">Desconectar</button>
        </div>`).join('');
    })
    .catch(() => {});
}

async function backfillConcepto(integrationId) {
  toast('Actualizando productos en órdenes históricas…', 'info');
  try {
    const res = await api.post(`/api/integrations/${integrationId}/backfill-concepto`, {});
    toast(`✅ ${res.message || 'Actualización iniciada'}`, 'success');
  } catch(e) {
    toast('Error: ' + e.message, 'error');
  }
}

function desconectar(id) {
  if (!confirm('¿Desconectar esta tienda? Se dejarán de recibir nuevas órdenes.')) return;
  fetch(`/api/integrations/${id}`, { method:'DELETE', credentials:'include' })
    .then(r => r.json())
    .then(d => { if(d.ok) { toast('Tienda desconectada','warn'); cargarIntegraciones(); } })
    .catch(() => toast('Error al desconectar','error'));
}

function abrirConexion(plataforma) {
  _plataformaActual = plataforma;
  document.getElementById('negMsgError').style.display = 'none';

  // Ocultar todos los forms
  document.querySelectorAll('.neg-form').forEach(f => f.style.display = 'none');

  const NOMBRES = {
    woocommerce:'WooCommerce', mercadolibre:'Mercado Libre',
    tiendanube:'Tienda Nube', empretienda:'Empretienda', rappi:'Rappi',
  };
  document.getElementById('negModalTitle').innerHTML =
    `<span class="material-icons" style="color:var(--orange-2)">link</span> Conectar ${NOMBRES[plataforma]}`;

  // Mostrar form correspondiente
  const forms = {
    woocommerce:'negFormWoo', mercadolibre:'negFormML',
    tiendanube:'negFormTN', empretienda:'negFormEM',
    rappi:'negFormRappi', vtex:'negFormVTEX',
  };
  const formId = forms[plataforma];
  if (formId) document.getElementById(formId).style.display = 'block';

  // Cambiar texto del botón para OAuth
  const isOAuth = ['woocommerce','mercadolibre'].includes(plataforma);
  document.getElementById('lblConectar').textContent = isOAuth ? 'Ir a autorizar →' : 'Conectar';

  document.getElementById('negModalOverlay').classList.add('open');
  document.getElementById('negModal').classList.add('open');
}

function cerrarConexion() {
  document.getElementById('negModalOverlay').classList.remove('open');
  document.getElementById('negModal').classList.remove('open');
  _plataformaActual = null;
}

async function confirmarConexion() {
  const btn = document.getElementById('btnConectar');
  const err = document.getElementById('negMsgError');
  err.style.display = 'none';
  btn.disabled = true;

  try {
    switch(_plataformaActual) {

      case 'woocommerce': {
        const url = document.getElementById('wooStoreUrl').value.trim();
        if (!url) throw new Error('Ingresá la URL de tu tienda.');
        if (!url.startsWith('http')) throw new Error('La URL debe comenzar con http:// o https://');
        window.location.href = `/auth/woo/connect?store_url=${encodeURIComponent(url)}`;
        return;
      }

      case 'mercadolibre': {
        window.location.href = '/auth/ml/connect';
        return;
      }

      case 'tiendanube': {
        const storeNumId = document.getElementById('tnStoreId').value.trim();
        const storeName  = document.getElementById('tnStoreName').value.trim();
        const apiToken   = document.getElementById('tnApiToken').value.trim();
        if (!storeNumId || !apiToken) throw new Error('Completá Store ID y API Token.');
        const res  = await fetch('/api/integrations/tiendanube', {
          method:'POST', credentials:'include',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ storeNumId, storeName, apiToken }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Error al conectar.');
        toast('✅ Tienda Nube conectada', 'success');
        cerrarConexion();
        cargarIntegraciones();
        break;
      }

      case 'empretienda': {
        const storeSlug = document.getElementById('emSlug').value.trim();
        const apiToken  = document.getElementById('emApiToken').value.trim();
        if (!storeSlug || !apiToken) throw new Error('Completá el slug y el API Token.');
        const res  = await fetch('/api/integrations/empretienda', {
          method:'POST', credentials:'include',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ storeSlug, apiToken }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Error al conectar.');
        toast('✅ Empretienda conectada', 'success');
        cerrarConexion();
        cargarIntegraciones();
        break;
      }

      case 'rappi': {
        const restaurantId = document.getElementById('rappiId').value.trim();
        const storeName    = document.getElementById('rappiName').value.trim();
        const apiToken     = document.getElementById('rappiToken').value.trim();
        if (!restaurantId || !apiToken) throw new Error('Completá Restaurant ID y API Token.');
        const res  = await fetch('/api/integrations/rappi', {
          method:'POST', credentials:'include',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ restaurantId, storeName, apiToken }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Error al conectar.');
        toast('✅ Rappi conectado', 'success');
        cerrarConexion();
        cargarIntegraciones();
        break;
      }

      case 'vtex': {
        const accountName = document.getElementById('vtexAccount').value.trim();
        const appKey      = document.getElementById('vtexAppKey').value.trim();
        const appToken    = document.getElementById('vtexAppToken').value.trim();
        if (!accountName || !appKey || !appToken) throw new Error('Completá todos los campos.');
        const res  = await fetch('/api/integrations/vtex', {
          method:'POST', credentials:'include',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ accountName, appKey, appToken }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Error al conectar.');
        toast('✅ VTEX conectado', 'success');
        cerrarConexion();
        cargarIntegraciones();
        break;
      }
    }
  } catch(e) {
    err.textContent = e.message;
    err.style.display = 'block';
  } finally {
    btn.disabled = false;
  }
}

// Detectar redirect de OAuth exitoso
(function checkOAuthReturn() {
  const p = new URLSearchParams(window.location.search);
  if (p.get('woo') === 'connected') {
    toast('✅ WooCommerce conectado correctamente', 'success');
    history.replaceState({}, '', '/dashboard');
    mostrarVista('negocio');
  }
  if (p.get('ml') === 'connected') {
    toast('✅ Mercado Libre conectado correctamente', 'success');
    history.replaceState({}, '', '/dashboard');
    mostrarVista('negocio');
  }
  if (p.get('error') === 'ml_failed') {
    toast('Error al conectar Mercado Libre', 'error');
    history.replaceState({}, '', '/dashboard');
  }
})();

/* ── CONFIGURACIÓN VISTA ────────────────────────────── */
function cargarConfigVista() {
  // Cargar valores guardados (ScriptProperties en GAS / API en web)
  if (typeof google !== 'undefined') {
    gasRun('obtenerConfiguracion', null, data => {
      if (!data) return;
      if (data.nombre)    document.getElementById('cfgNombre2').value    = data.nombre;
      if (data.cuit)      document.getElementById('cfgCuit2').value      = data.cuit;
      if (data.email)     document.getElementById('cfgEmail2').value     = data.email;
      if (data.categoria) document.getElementById('cfgCategoria2').value = data.categoria;
      if (typeof data.factAuto  !== 'undefined') document.getElementById('switchFactAuto2').checked  = data.factAuto;
      if (typeof data.envioAuto !== 'undefined') document.getElementById('switchEnvioAuto2').checked = data.envioAuto;
    }, null);
  }
}

function guardarPerfilVista() {
  const datos = {
    nombre:    document.getElementById('cfgNombre2').value.trim(),
    cuit:      document.getElementById('cfgCuit2').value.trim(),
    email:     document.getElementById('cfgEmail2').value.trim(),
    categoria: document.getElementById('cfgCategoria2').value,
  };
  gasRun('guardarConfiguracion', [datos], () => {
    const st = document.getElementById('cfgSaveStatus2');
    st.style.display = 'block';
    setTimeout(() => st.style.display = 'none', 2500);
  }, err => toast('Error al guardar: ' + err.message, 'error'));
  if (typeof google === 'undefined') {
    const st = document.getElementById('cfgSaveStatus2');
    st.style.display = 'block';
    setTimeout(() => st.style.display = 'none', 2000);
  }
}

/* ── MOBILE SIDEBAR ────────────────────────────────── */
function toggleSidebar() {
  const sidebar  = document.querySelector('.sidebar');
  const overlay  = document.getElementById('mobOverlay');
  const btn      = document.getElementById('mobHamburger');
  const isOpen   = sidebar.classList.toggle('mob-open');
  overlay.classList.toggle('visible', isOpen);
  btn.classList.toggle('is-open', isOpen);
  document.body.style.overflow = isOpen ? 'hidden' : '';
}

function cerrarSidebar() {
  document.querySelector('.sidebar').classList.remove('mob-open');
  document.getElementById('mobOverlay').classList.remove('visible');
  document.getElementById('mobHamburger').classList.remove('is-open');
  document.body.style.overflow = '';
}

// Close sidebar on nav item click (mobile)
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      if (window.innerWidth <= 720) cerrarSidebar();
    });
  });
});

/* ── SELECTOR DE PERÍODO GLOBAL ─────────────────────── */
let _dashDesde = null;
let _dashHasta = null;

const DASH_PRESETS = {
  mes:  'Este mes',
  ant:  'Mes anterior',
  trim: 'Trimestre',
  anio: 'Este año',
};

function _initDashPeriod() {
  const hoy = new Date();
  _dashDesde = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  _dashHasta = new Date(hoy.getFullYear(), hoy.getMonth()+1, 0);
  _syncDashInputs();
  _updateTopbarBadge('Este mes');
}

function toggleDashCalendario() {
  const dd  = document.getElementById('dashCalDropdown');
  const btn = document.getElementById('btnDashPeriodo');
  const isOpen = dd.classList.toggle('open');

  if (isOpen) {
    setTimeout(() => document.addEventListener('click', _cerrarDashCal, {once:true}), 10);
  }
}

function _cerrarDashCal(e) {
  const wrap = document.querySelector('.topbar-period-wrap');
  if (wrap && !wrap.contains(e.target)) {
    document.getElementById('dashCalDropdown').classList.remove('open');

  }
}

function aplicarDashPreset(preset, btn) {
  document.querySelectorAll('#dashCalDropdown .tcal-preset').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const hoy = new Date(), y = hoy.getFullYear(), m = hoy.getMonth();
  if (preset === 'mes')  { _dashDesde = new Date(y,m,1);                 _dashHasta = new Date(y,m+1,0); }
  if (preset === 'ant')  { _dashDesde = new Date(y,m-1,1);               _dashHasta = new Date(y,m,0); }
  if (preset === 'trim') { const ts=Math.floor(m/3)*3; _dashDesde=new Date(y,ts,1); _dashHasta=new Date(y,ts+3,0); }
  if (preset === 'anio') { _dashDesde = new Date(y,0,1);                 _dashHasta = new Date(y,11,31); }
  _syncDashInputs();
  _updateTopbarBadge(DASH_PRESETS[preset]);
  // Close dropdown
  document.getElementById('dashCalDropdown').classList.remove('open');
  document.getElementById('btnDashPeriodo').classList.remove('open');
  _recargarDashConPeriodo();
}

function aplicarDashRangoCustom() {
  const d = document.getElementById('dashDesde').value;
  const h = document.getElementById('dashHasta').value;
  if (!d || !h) return;
  _dashDesde = new Date(d);
  _dashHasta = new Date(h + 'T23:59:59');
  document.querySelectorAll('#dashCalDropdown .tcal-preset').forEach(b => b.classList.remove('active'));
  const fmt = dt => dt.toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit',year:'2-digit'});
  const label = fmt(_dashDesde) + ' → ' + fmt(_dashHasta);
  _updateTopbarBadge(label);
  document.getElementById('dashCalDropdown').classList.remove('open');
  document.getElementById('btnDashPeriodo').classList.remove('open');
  _recargarDashConPeriodo();
}

function _syncDashInputs() {
  const toISO = d => d ? d.toISOString().split('T')[0] : '';
  document.getElementById('dashDesde').value = toISO(_dashDesde);
  document.getElementById('dashHasta').value = toISO(_dashHasta);
}

function _updateTopbarBadge(label) {
  document.getElementById('dashPeriodoLabel').textContent = label;
  // Update chart subtitle
  const chartSub = document.getElementById('chartSub');
  if (chartSub) chartSub.textContent = label;
  // Update active label in dropdown
  const al = document.getElementById('tcalActiveLabel');
  if (al && _dashDesde && _dashHasta) {
    const fmt = d => d.toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit',year:'numeric'});
    al.textContent = fmt(_dashDesde) + '  →  ' + fmt(_dashHasta);
  } else if (al) { al.textContent = 'Todo el historial'; }
}

function _recargarDashConPeriodo() {
  // Filtra TODOS los datos del dashboard según el período global
  const loader = data => {
    if (!data) return;
    const desde = _dashDesde ? _dashDesde.getTime() : 0;
    const hasta  = _dashHasta ? _dashHasta.getTime() : Infinity;

    // Filtrar comprobantes
    if (data.comprobantes) {
      data.comprobantes = data.comprobantes.filter(c => {
        const ts = _parseFecha(c.fecha);
        return ts >= desde && ts <= hasta;
      });
    }

    // Filtrar chart data (days inside range)
    if (data.chartDias && data.chartVentas) {
      const filteredDias = [], filteredVentas = [];
      const desdeD = _dashDesde, hastaD = _dashHasta;
      data.chartDias.forEach((dia, i) => {
        // dia is "dd" format, reconstruct date using period year/month
        const mesRef = desdeD.getMonth(), anioRef = desdeD.getFullYear();
        const fecha = new Date(anioRef, mesRef, parseInt(dia));
        if (fecha >= desdeD && fecha <= hastaD) {
          filteredDias.push(dia);
          filteredVentas.push(data.chartVentas[i]);
        }
      });
      if (filteredDias.length) {
        data.chartDias   = filteredDias;
        data.chartVentas = filteredVentas;
      }
    }

    // Recalculate period total from filtered comprobantes
    if (data.comprobantes) {
      data.chartTotal = data.comprobantes.reduce((s,c) => s + (c.monto||0), 0);
    }

    cargarDashboard(data);

    // Update chart labels
    if (_dashDesde && _dashHasta) {
      const fmt = dt => dt.toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit',year:'numeric'});
      document.getElementById('chartTitle').textContent = 'Ingresos';
      document.getElementById('chartSub').textContent   = fmt(_dashDesde) + ' → ' + fmt(_dashHasta);
    }
  };

  // Construir URL con filtros de período
  const qs = new URLSearchParams();
  if (_dashDesde) qs.set('desde', _dashDesde.toISOString());
  if (_dashHasta) qs.set('hasta', _dashHasta.toISOString());

  api.get('/api/stats/dashboard?' + qs.toString())
    .then(raw => {
      const data = adaptarStats(raw);
      if (data) cargarDashboard(data);
    })
    .catch(err => { toast('Error cargando datos: ' + err.message, 'error'); });
}

/* ── CALENDARIO / PERÍODO ───────────────────────────── */
let _rangoDesde = null;  // Date
let _rangoHasta = null;  // Date

function _iniciarPeriodo() {
  // Por defecto: este mes
  const hoy   = new Date();
  _rangoDesde = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  _rangoHasta = new Date(hoy.getFullYear(), hoy.getMonth()+1, 0);
  _syncDateInputs();
}

function _syncDateInputs() {
  if (_rangoDesde) document.getElementById('calDesde').value = _rangoDesde.toISOString().split('T')[0];
  if (_rangoHasta) document.getElementById('calHasta').value = _rangoHasta.toISOString().split('T')[0];
}

function toggleCalendario() {
  const dd  = document.getElementById('calDropdown');
  const btn = document.getElementById('btnPeriodo');
  const open = dd.classList.toggle('open');
  btn.classList.toggle('active', open);
  if (open) {
    // Cerrar al hacer click fuera
    setTimeout(() => document.addEventListener('click', _cerrarCalFuera, {once:true}), 10);
  }
}

function _cerrarCalFuera(e) {
  const wrap = document.querySelector('.comp-periodo-wrap');
  if (wrap && !wrap.contains(e.target)) {
    document.getElementById('calDropdown').classList.remove('open');
    document.getElementById('btnPeriodo').classList.remove('active');
  }
}

function aplicarPreset(preset, btn) {
  document.querySelectorAll('.cal-preset').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');

  const hoy   = new Date();
  const y     = hoy.getFullYear();
  const m     = hoy.getMonth();

  if (preset === 'mes') {
    _rangoDesde = new Date(y, m, 1);
    _rangoHasta = new Date(y, m+1, 0);
    document.getElementById('btnPeriodoLabel').textContent = 'Este mes';
  } else if (preset === 'ant') {
    _rangoDesde = new Date(y, m-1, 1);
    _rangoHasta = new Date(y, m, 0);
    document.getElementById('btnPeriodoLabel').textContent = 'Mes anterior';
  } else if (preset === 'trim') {
    const trimStart = Math.floor(m/3)*3;
    _rangoDesde = new Date(y, trimStart, 1);
    _rangoHasta = new Date(y, trimStart+3, 0);
    document.getElementById('btnPeriodoLabel').textContent = 'Trimestre';
  } else if (preset === 'anio') {
    _rangoDesde = new Date(y, 0, 1);
    _rangoHasta = new Date(y, 11, 31);
    document.getElementById('btnPeriodoLabel').textContent = 'Este año';
  } else if (preset === 'todo') {
    _rangoDesde = null;
    _rangoHasta = null;
    document.getElementById('btnPeriodoLabel').textContent = 'Todo el tiempo';
  }

  _syncDateInputs();
  filtrarComprobantes();
}

function aplicarRangoCustom() {
  const desde = document.getElementById('calDesde').value;
  const hasta = document.getElementById('calHasta').value;
  if (!desde && !hasta) return;

  _rangoDesde = desde ? new Date(desde) : null;
  _rangoHasta = hasta ? new Date(hasta+'T23:59:59') : null;

  document.querySelectorAll('.cal-preset').forEach(b => b.classList.remove('active'));

  if (desde && hasta) {
    const d = new Date(desde), h = new Date(hasta);
    const fmt = d => d.toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit'});
    document.getElementById('btnPeriodoLabel').textContent = fmt(d) + ' → ' + fmt(h);
  } else if (desde) {
    document.getElementById('btnPeriodoLabel').textContent = 'Desde ' + new Date(desde).toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit',year:'numeric'});
  }

  filtrarComprobantes();
}

function limpiarBusqueda() {
  document.getElementById('compBuscar').value = '';
  document.getElementById('btnClearSearch').style.display = 'none';
  filtrarComprobantes();
}

function setFiltro(tipo, btn) {
  _filtroTipo = tipo;
  document.querySelectorAll('.filtro-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  filtrarComprobantes();
}

function filtrarComprobantes() {
  const q = (document.getElementById('compBuscar').value || '').toLowerCase();
  document.getElementById('btnClearSearch').style.display = q ? 'flex' : 'none';

  let lista = _todosComp.filter(c => {
    // Filtro tipo
    if (_filtroTipo === 'factura'   && c.tipo !== 'Factura C')         return false;
    if (_filtroTipo === 'nota'      && c.tipo !== 'Nota de Crédito C') return false;
    if (_filtroTipo === 'pendiente' && c.estado !== 'pendiente')       return false;
    if (_filtroTipo === 'manual'    && c.origen !== 'manual')          return false;
    if (_filtroTipo === 'woo'       && c.origen !== 'woo')             return false;

    // Filtro rango de fechas
    const ts = _parseFecha(c.fecha);
    if (_rangoDesde && ts < _rangoDesde.getTime()) return false;
    if (_rangoHasta && ts > _rangoHasta.getTime()) return false;

    // Búsqueda texto
    if (q) {
      const hay = [c.id, c.cliente, c.concepto, c.fecha].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  renderComprobantes(lista);
}

function renderComprobantes(lista) {
  const tbody = document.getElementById('manualesBody');
  if (!lista.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--text-3);font-size:13px">Sin comprobantes</td></tr>`;
    renderTotalesComp([]);
    return;
  }

  tbody.innerHTML = lista.map((c, i) => {
    const estadoChip = c.estado === 'emitido'
      ? `<span class="estado-chip ok">● Emitido</span>`
      : c.estado === 'anulado'
      ? `<span class="estado-chip anulado">✕ Anulado</span>`
      : `<span class="estado-chip pend">◌ Pendiente</span>`;

    const origenPill = c.origen === 'manual'
      ? `<span style="font-size:9px;font-weight:700;letter-spacing:1px;color:var(--yellow);background:rgba(255,179,0,.1);padding:2px 7px;border-radius:4px;border:1px solid rgba(255,179,0,.2)">MAN</span>`
      : `<span style="font-size:9px;font-weight:700;letter-spacing:1px;color:#7b8cde;background:rgba(123,140,222,.1);padding:2px 7px;border-radius:4px;border:1px solid rgba(123,140,222,.2)">WOO</span>`;

    const btnAnular = c.origen === 'manual' && c.estado !== 'anulado'
      ? `<button class="act-btn" title="Anular" onclick="anularManual('${c.id}')">↩️</button>`
      : c.origen === 'manual'
      ? `<button class="act-btn act-done" disabled title="Ya anulado">↩️</button>`
      : '';

    return `
    <tr style="animation:rowIn .3s ease ${i*35}ms both">
      <td style="text-align:center">${origenPill}</td>
      <td style="font-family:var(--font-num);font-weight:600;font-size:11px">${c.id}</td>
      <td>
        <div style="font-weight:600;font-size:12px">${c.cliente}</div>
        ${c.email ? `<div style="font-size:10px;color:var(--text-3)">${c.email}</div>` : ''}
      </td>
      <td style="max-width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:var(--text-2)">${c.concepto||c.tipo||''}</td>
      <td style="font-size:12px;color:var(--text-3)">${c.fecha}</td>
      <td style="text-align:right;font-family:var(--font-num);font-weight:700;font-size:13px">${ars(c.monto)}</td>
      <td style="text-align:center">${estadoChip}</td>
      <td style="text-align:center">
        <div class="comp-actions" style="justify-content:center">
          <button class="act-btn" title="Ver PDF"     onclick="verPDF('${c._id||c.id}')"><svg width="13" height="13" viewBox="0 0 14 14" fill="none"><rect x="2" y="1" width="8" height="11" rx="1.5" stroke="currentColor" stroke-width="1.3"/><path d="M4 4.5h4M4 6.5h4M4 8.5h2.5" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg></button>
          <button class="act-btn" title="Enviar mail" onclick="enviarMail('${c._id||c.id}')"><svg width="13" height="13" viewBox="0 0 14 14" fill="none"><rect x="1.5" y="3" width="11" height="8" rx="1.5" stroke="currentColor" stroke-width="1.3"/><path d="M1.5 5l5.5 3.5L12.5 5" stroke="currentColor" stroke-width="1.2"/></svg></button>
          ${btnAnular}
        </div>
      </td>
    </tr>`;
  }).join('');

  renderTotalesComp(lista);
}

function renderTotalesComp(lista) {
  const activos = lista.filter(c => c.estado !== 'anulado');
  const total   = activos.reduce((s, c) => s + c.monto, 0);
  const pend    = activos.filter(c => c.estado === 'pendiente').length;
  const woo     = activos.filter(c => c.origen === 'woo').length;
  const man     = activos.filter(c => c.origen === 'manual').length;
  document.getElementById('compTotales').innerHTML = `
    <div class="total-chip">${activos.length} comprobante${activos.length!==1?'s':''}</div>
    <div class="total-chip">Total: <strong>${ars(total)}</strong></div>
    <div class="total-chip">WooCommerce: <strong>${woo}</strong> &nbsp;·&nbsp; Manuales: <strong>${man}</strong></div>
    ${pend ? `<div class="total-chip" style="border-color:rgba(255,179,0,.3);color:var(--yellow)">${pend} pendiente${pend!==1?'s':''} de emitir</div>` : ''}
  `;
}

function anularManual(id) {
  if (!confirm(`¿Anular el comprobante ${id}?\nEsto generará una Nota de Crédito C vinculada.`)) return;
  toast('Generando nota de crédito…', 'info');
  gasRun('anularManual', [id],
    res => {
      if (res && res.error) { toast('Error: '+res.error, 'error'); return; }
      toast(`✅ Nota de Crédito ${res.nroNC} generada`, 'success');
      cargarTodosComprobantes();
    },
    err => toast('Error: '+err.message, 'error')
  );
}

/* ── MODAL NUEVA EMISIÓN ────────────────────────────── */
function abrirNuevaEmision() {
  document.getElementById('modalOverlay').classList.add('open');
  document.getElementById('modalEmision').classList.add('open');
  document.getElementById('emCliente').focus();
  document.getElementById('emError').style.display = 'none';
  ['emCliente','emEmail','emConcepto','emMonto'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('emTipo').value = 'Factura C';
}

function cerrarNuevaEmision() {
  document.getElementById('modalOverlay').classList.remove('open');
  document.getElementById('modalEmision').classList.remove('open');
}

function registrarEmision() {
  const cliente  = document.getElementById('emCliente').value.trim();
  const email    = document.getElementById('emEmail').value.trim();
  const concepto = document.getElementById('emConcepto').value.trim();
  const monto    = parseFloat(document.getElementById('emMonto').value);
  const tipo     = document.getElementById('emTipo').value;
  const errEl    = document.getElementById('emError');

  if (!cliente || !email || !concepto || !monto) {
    errEl.textContent = 'Completá todos los campos obligatorios.';
    errEl.style.display = 'block'; return;
  }
  if (!email.includes('@')) {
    errEl.textContent = 'El email no es válido.';
    errEl.style.display = 'block'; return;
  }
  if (monto <= 0) {
    errEl.textContent = 'El monto debe ser mayor a 0.';
    errEl.style.display = 'block'; return;
  }

  errEl.style.display = 'none';
  const btn = document.getElementById('btnRegistrar');
  btn.disabled = true;
  btn.innerHTML = '<span class="material-icons" style="font-size:14px!important;animation:spin .7s linear infinite">sync</span> Registrando…';

  gasRun('registrarVentaManual', [{cliente, email, concepto, monto, tipo}],
    res => {
      btn.disabled = false;
      btn.innerHTML = '<span class="material-icons" style="font-size:15px!important">save</span> Registrar';
      if (res && res.error) { errEl.textContent = res.error; errEl.style.display = 'block'; return; }
      toast(`✅ ${tipo} ${res.nro} registrada`, 'success');
      cerrarNuevaEmision();
      cargarTodosComprobantes();
    },
    err => {
      btn.disabled = false;
      btn.innerHTML = '<span class="material-icons" style="font-size:15px!important">save</span> Registrar';
      errEl.textContent = 'Error: ' + err.message;
      errEl.style.display = 'block';
    }
  );

  if (typeof google === 'undefined') {
    setTimeout(() => {
      btn.disabled = false;
      btn.innerHTML = '<span class="material-icons" style="font-size:15px!important">save</span> Registrar';
      toast('Registrado (demo)', 'success');
      cerrarNuevaEmision();
    }, 800);
  }
}

/* ── MOCK DATA COMPROBANTES ─────────────────────────── */
const MOCK_WOO = [
  {id:'17294', cliente:'Maglietti', tipo:'Factura C', fecha:'15/03/2026', monto:95000, estado:'cae-ok'},
  {id:'17292', cliente:'Rodríguez', tipo:'Factura C', fecha:'15/03/2026', monto:7500,  estado:'cae-ok'},
  {id:'17290', cliente:'Kibizs',    tipo:'Factura C', fecha:'13/03/2026', monto:95000, estado:'cae-pend'},
];
const MOCK_MANUALES = [
  {id:'M-1001', cliente:'García', email:'garcia@mail.com', concepto:'Curso Intensivo de Marroquinería x 2 meses', fecha:'15/03/2026', tipo:'Factura C', monto:95000, estado:'emitido'},
  {id:'M-1002', cliente:'Pérez',  email:'perez@mail.com',  concepto:'Patrones Bandolera Trendy', fecha:'18/03/2026', tipo:'Factura C', monto:19000, estado:'pendiente'},
];

function conmutarEstado(){
  toast('Conmutando estado…','info');
  if(typeof google!=='undefined'){
    gasRun('conmutarEstado',null,
      res=>{
        const on = res?.serverOnline === true;
        renderStatus(on);
        toast(on ? 'Sistema ACTIVO' : 'Sistema PAUSADO', on ? 'success' : 'warn');
      },
      err=>toast('Error: '+err.message,'error'));
  } else {
    const dot=document.getElementById('sidebarDot');
    const on=!dot.classList.contains('offline');
    renderStatus(!on);
    toast((!on?'Activado':'Pausado')+' (demo)',!on?'success':'warn');
  }
}

function abrirConfiguracion(){
  const panel   = document.getElementById('cfgPanel');
  const overlay = document.getElementById('cfgOverlay');
  // Forzar altura al documento completo (necesario dentro del iframe de GAS)
  const h = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight, window.innerHeight || 750);
  overlay.style.height = h + 'px';
  panel.style.height   = h + 'px';
  panel.classList.add('open');
  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function cerrarConfiguracion(){
  document.getElementById('cfgPanel').classList.remove('open');
  document.getElementById('cfgOverlay').classList.remove('open');
  document.body.style.overflow = '';
}

function abrirCalendario(){
  toast('Abriendo calendario…','info');
  gasRun('abrirCalendario',null,
    ()=>toast('Calendario abierto','success'),
    err=>toast('Error: '+err.message,'error'));
}

function exportarIvaVentas(){
  toast('Generando exportación…','info');
  gasRun('exportarIvaVentas',null,
    url=>{toast('Exportación lista','success');if(url)window.open(url,'_blank');},
    err=>toast('Error: '+err.message,'error'));
  if(typeof google==='undefined') setTimeout(()=>toast('Exportación generada (demo)','success'),1200);
}

function verPDF(orderId){
  if (!orderId || orderId === 'undefined') {
    toast('Sin comprobante disponible', 'warn');
    return;
  }
  window.open(`/api/orders/${orderId}/pdf`, '_blank');
}

async function emitir(idOrden) {
  // idOrden es el _id de MongoDB de la orden
  const btn = document.querySelector(`[data-emitir="${idOrden}"]`);
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="material-icons" style="font-size:13px;animation:spin .6s linear infinite">sync</span>'; }

  toast('Solicitando CAE a AFIP…', 'info');
  try {
    const res = await api.post(`/api/orders/${idOrden}/emitir`, {});
    if (res.ok) {
      toast(`✅ CAE emitido: ${res.cae}`, 'success');
      // Refrescar dashboard con el período actual
      _recargarDashConPeriodo();
    }
  } catch(e) {
    toast('Error AFIP: ' + e.message, 'error');
    if (btn) { btn.disabled = false; }
  }
}

async function emitirLote() {
  if (!confirm('¿Emitir CAE para TODAS las órdenes pendientes?')) return;
  toast('Emitiendo en lote… esto puede tardar unos segundos', 'info');
  try {
    const res = await api.post('/api/orders/emitir-lote', {});
    toast(`✅ ${res.message}`, 'success');
    setTimeout(_recargarDashConPeriodo, 3000);
  } catch(e) {
    toast('Error: ' + e.message, 'error');
  }
}

async function enviarMail(orderId){
  if (!orderId) return;
  toast('Enviando factura por mail…','info');
  try {
    const res = await api.post(`/api/orders/${orderId}/mail`, {});
    toast(res.message || 'Mail enviado correctamente', 'success');
  } catch(e) {
    toast('Error: ' + e.message, 'error');
  }
}

/* ── INIT ──────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', async () => {
  _initDashPeriod();

  // Cargar datos reales desde la API REST
  try {
    // Período por defecto: mes actual
    const _ahora = new Date();
    const _desde = new Date(_ahora.getFullYear(), _ahora.getMonth(), 1).toISOString();
    const _hasta = new Date(_ahora.getFullYear(), _ahora.getMonth()+1, 0, 23, 59, 59).toISOString();
    const raw  = await api.get(`/api/stats/dashboard?desde=${_desde}&hasta=${_hasta}`);
    const data = adaptarStats(raw);
    if (data) {
      cargarDashboard(data);
    } else {
      renderStatus(false);
      cargarDashboard(MOCK);
    }
  } catch(e) {
    console.error('Init error:', e.message);
    // Si falla auth → redirigir al login
    if (e.message.includes('401') || e.message.includes('autenticado')) {
      window.location.href = '/login';
      return;
    }
    renderStatus(false);
    toast('Error cargando datos: ' + e.message, 'error');
    cargarDashboard(MOCK);
  }

  // Detectar retorno de OAuth
  const params = new URLSearchParams(window.location.search);
  if (params.get('woo') === 'connected') {
    toast('✅ WooCommerce conectado correctamente', 'success');
    history.replaceState({}, '', '/dashboard');
    mostrarVista('negocio');
  }
  if (params.get('ml') === 'connected') {
    toast('✅ Mercado Libre conectado correctamente', 'success');
    history.replaceState({}, '', '/dashboard');
    mostrarVista('negocio');
  }
  if (params.get('error') === 'ml_failed') {
    toast('Error al conectar Mercado Libre', 'error');
    history.replaceState({}, '', '/dashboard');
  }
});
