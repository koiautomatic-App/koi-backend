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
// Formateador de moneda que soporta ARS, USD, EUR
const formatCurrency = (amount, currency = 'ARS') => {
  const num = Number(amount);
  if (isNaN(num) || num === null || num === undefined) {
    return currency === 'USD' ? 'U$S 0' : '$0';
  }
  
  const formatters = {
    'ARS': new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: 'ARS',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }),
    'USD': new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }),
    'EUR': new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })
  };
  
  const formatter = formatters[currency] || formatters['ARS'];
  return formatter.format(num);
};

// Mantener ars para compatibilidad (solo ARS)
const ars = (n) => formatCurrency(n, 'ARS');

// Versión corta para gráficos (solo ARS, mantiene compatibilidad)
const arsShort = n => {
  const num = Number(n);
  if (isNaN(num)) return '$0';
  return num >= 1e6 ? `$${(num / 1e6).toFixed(2)}M` 
       : num >= 1e3 ? `$${(num / 1e3).toFixed(0)}k` 
       : `$${num}`;
};

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
  
  // 👇 NUEVA MÉTRICA - Notas de Crédito
  if (document.getElementById('mcNC')) {
    const ncMonto = d.notasCredito?.montoTotal || 0;
    const ncCantidad = d.notasCredito?.cantidad || 0;
    document.getElementById('mcNC').innerText = `-${ars(ncMonto)}`;
    document.getElementById('dcNC').innerText = `${ncCantidad} NC emitida${ncCantidad !== 1 ? 's' : ''}`;
  }
  
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
function filtrarComprobantes() {
  let lista = _todosComp.filter(c => {
    // Filtro por tipo de comprobante
    if (_filtroTipo === 'factura' && c.tipo !== 'Factura C') return false;
    if (_filtroTipo === 'nota' && c.tipo !== 'Nota de Crédito C') return false;
    
    // 👇 FILTRO "SIN EMITIR" CORREGIDO (VERSIÓN DEFINITIVA)
    if (_filtroTipo === 'pendiente') {
      // Excluir notas de crédito (por status cancelled o por ID con NC)
      if (c.status === 'cancelled') return false;
      if (c.id && c.id.includes('NC')) return false;
      // Excluir facturas ya emitidas o anuladas
      if (c.estado === 'cae-ok' || c.status === 'invoiced') return false;
      if (c.status === 'cancelled_by_nc') return false;
      // Solo incluir pendientes y errores de AFIP
      return c.estado === 'pendiente' || c.status === 'error_afip';
    }
    
    // Filtro por origen (plataforma)
    if (_filtroTipo === 'manual' && c.origen !== 'manual') return false;
    if (_filtroTipo === 'woo' && c.origen !== 'woo') return false;
    
    return true;
  });

  renderComprobantes(lista);
}
function renderComps(lista) {
  document.getElementById('compBadge').textContent = lista.length;
  const cont = document.getElementById('compList');
  if (!lista.length) {
    cont.innerHTML = `<div style="padding:30px;text-align:center;color:var(--text-3);font-size:12px">Sin ventas este mes</div>`;
    return;
  }
  
  cont.innerHTML = lista.map((c, i) => {
    const esNotaCredito = c.amount < 0 || (c.nroFormatted && c.nroFormatted.startsWith('NC'));
    const emitido = c.estado === 'cae-ok' || c.status === 'invoiced' || (c.caeNumber && c.caeNumber !== '');
    const esCancelada = c.status === 'cancelled' || esNotaCredito;
    
    const btnEmitir = (emitido || esCancelada)
      ? `<button class="act-btn act-done" title="${esCancelada ? 'Nota de Crédito emitida' : 'Factura ya emitida'}" disabled>
          <svg width='13' height='13' viewBox='0 0 14 14' fill='none'>
            <path d='M2.5 7l3 3 6-6' stroke='currentColor' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'/>
          </svg>
         </button>`
      : `<button class="act-btn act-warn" title="Emitir CAE" data-emitir="${c._id||c.id}" onclick="emitir('${c._id||c.id}')">
          <svg width='13' height='13' viewBox='0 0 14 14' fill='none'>
            <path d='M7 1.5l5.5 10H1.5L7 1.5z' stroke='currentColor' stroke-width='1.3' stroke-linejoin='round'/>
            <path d='M7 5.5v3' stroke='currentColor' stroke-width='1.3' stroke-linecap='round'/>
            <circle cx='7' cy='10' r='.6' fill='currentColor'/>
          </svg>
         </button>`;
    
    const emailSent = c.emailSent === true;
    const emailTitle = emailSent 
      ? (esCancelada ? 'Nota de Crédito ya enviada' : 'Factura ya enviada')
      : (esCancelada ? 'Enviar Nota de Crédito por email' : 'Enviar factura por email');
    
    const btnEmail = emailSent
      ? `<button class="act-btn act-btn-sent" title="${emailTitle}" disabled>
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
            <rect x="1.5" y="3" width="11" height="8" rx="1.5" stroke="currentColor" stroke-width="1.3"/>
            <path d="M1.5 5l5.5 3.5L12.5 5" stroke="currentColor" stroke-width="1.2"/>
            <path d="M9 9l2 2M5 9l-2 2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
          </svg>
         </button>`
      : `<button class="act-btn" title="${emailTitle}" onclick="enviarMail('${c._id||c.id}')">
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
            <rect x="1.5" y="3" width="11" height="8" rx="1.5" stroke="currentColor" stroke-width="1.3"/>
            <path d="M1.5 5l5.5 3.5L12.5 5" stroke="currentColor" stroke-width="1.2"/>
          </svg>
         </button>`;
    
    const btnCancelar = (emitido && !esCancelada && !esNotaCredito)
      ? `<button class="act-btn act-danger" title="Cancelar factura - Emitir Nota de Crédito" onclick="cancelarFactura('${c._id||c.id}')">
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
            <path d="M2 2L12 12M12 2L2 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            <circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="1.3"/>
          </svg>
         </button>`
      : '';
    
    const montoRaw = (c.monto !== undefined && c.monto !== null) ? c.monto 
                   : (c.amount !== undefined && c.amount !== null) ? Math.abs(c.amount) 
                   : 0;
    const montoMostrar = esCancelada ? Math.abs(montoRaw) : montoRaw;
    
    return `
    <div class="comp-row" style="animation-delay:${i*55}ms">
      <div class="cae-dot ${c.estado || (emitido ? 'cae-ok' : 'cae-pend')}"></div>
      <div class="comp-info">
        <div class="comp-cliente">${c.customerName || c.cliente}</div>
        <div class="comp-meta">
          ${c.concepto ? `<span style="color:var(--text-2);font-size:11px">${c.concepto.length>48?c.concepto.slice(0,46)+'…':c.concepto}</span> · ` : ''}
          ${esCancelada ? `NC ${c.caeNumber ? c.caeNumber.slice(-8) : '---'}` : (emitido && c.caeNumber ? `CAE ${c.caeNumber.slice(-8)}` : c.fecha || c.orderDate)}
        </div>
      </div>
      <div class="comp-monto">${formatCurrency(montoMostrar, c.currency || 'ARS')}</div>
      <div class="comp-actions">
        <button class="act-btn" title="${esCancelada ? 'Ver Nota de Crédito' : 'Ver PDF'}" onclick="verPDF('${c._id||c.id}')">
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
            <rect x="2" y="1" width="8" height="11" rx="1.5" stroke="currentColor" stroke-width="1.3"/>
            <path d="M4 4.5h4M4 6.5h4M4 8.5h2.5" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
          </svg>
        </button>
        ${btnEmitir}
        ${btnEmail}
        ${btnCancelar}
      </div>
    </div>`;
  }).join('');
}
/* ── CARGA INICIAL ─────────────────────────────────── */
function cargarDashboard(data){
  const d = data || MOCK;
  
  // 👇 Asegurar que los comprobantes tengan emailSent
  const comprobantesConEmail = (d.comprobantes || []).map(c => ({
    ...c,
    emailSent: c.emailSent || false
  }));
  
  renderStatus(d.serverOnline);
  renderMono(d);
  renderMetrics(d);
  renderChart(d);
  renderComps(comprobantesConEmail);
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

  // Período formateado
  const ahora = new Date();
  const mesNom = ahora.toLocaleString('es-AR', { month: 'long', year: 'numeric' });
  
  const desde = raw.periodo?.desde ? new Date(raw.periodo.desde) : null;
  const hasta = raw.periodo?.hasta ? new Date(raw.periodo.hasta) : null;
  const fmtP = d => d?.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const periodoLabel = (desde && hasta) ? `${fmtP(desde)} → ${fmtP(hasta)}` : mesNom;

  // Comprobantes para la bandeja
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
    currency:    o.currency || 'ARS',
    estado:      o.status === 'invoiced'        ? 'cae-ok'
               : o.status === 'error_afip'      ? 'cae-err'
               : o.status === 'error_data'      ? 'cae-err'
               : 'cae-pend',
    cae:         o.caeNumber || null,
    caeVto:      o.caeExpiry ? new Date(o.caeExpiry).toLocaleDateString('es-AR') : null,
    origen:      o.platform === 'manual' ? 'manual' : 'woo',
    platform:    o.platform,
    emailSent:   o.emailSent || false,
  }));

  return {
    serverOnline:    true,
    // 👇 NUEVOS CAMPOS para facturación acumulada (últimos 12 meses)
    categoria:       raw.categoria || 'C',
    facturacionAcumulada: raw.facturacionAcumulada || 0,
    limiteAnual:     raw.limiteAnual || 13862982.24,
    porcentajeAnual: raw.porcentajeAnual || 0,
    // 👇 CAMPOS PARA COMPATIBILIDAD (monotributo)
    monoCategoria:   raw.categoria || 'C',
    monoFacturado:   raw.facturacionAcumulada || 0,
    monoLimite:      raw.limiteAnual || 13862982.24,
    monoMes:         `Período: últimos 12 meses`,
    // 👇 MÉTRICAS DEL PERÍODO
    hoyFacturado:    raw.hoyMonto || 0,
    hoyDelta:        raw.hoyCount > 0 ? `${raw.hoyCount} factura${raw.hoyCount !== 1 ? 's' : ''} emitida${raw.hoyCount !== 1 ? 's' : ''} hoy` : 'Sin facturar hoy',
    hoyTipo:         raw.hoyCount > 0 ? 'up' : '',
    pendientesCAE:   raw.pendientesCAE  || 0,
    pendDelta:       raw.pendientesCAE > 0 ? `${raw.pendientesCAE} sin emitir` : 'Al día ✓',
    pendTipo:        raw.pendientesCAE > 0 ? 'warn' : 'up',
    mesFacturado:    raw.totalFacturado || 0,
    mesDelta:        `${raw.totalFacturas || 0} facturas emitidas`,
    mesTipo:         'up',
    chartTotal:      raw.totalMonto     || 0,
    chartDias:       raw.chartDias      || [],
    chartVentas:     raw.chartVentas    || [],
    comprobantes,
    notasCredito:    raw.notasCredito   || { montoTotal: 0, cantidad: 0 }
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
  
  // Mapa de vistas
  const map = {
    dashboard: { id: 'vista-dashboard', nav: 'nav-dashboard' },
    comprobantes: { id: 'vista-comprobantes', nav: 'nav-comprobantes' },
    negocio: { id: 'vista-negocio', nav: 'nav-negocio' },
    arca: { id: 'vista-arca', nav: 'nav-arca' },
    config: { id: 'vista-config', nav: 'nav-config' },
    estado: { id: 'vista-estado', nav: 'nav-estado' },
    reporte: { id: 'vista-reporte', nav: 'nav-reporte' }
  };
  
  const vista = map[v];
  if (!vista) {
    console.warn('⚠️ Vista no encontrada:', v);
    return;
  }
  
  // Mostrar la vista
  const el = document.getElementById(vista.id);
  if (el) {
    el.style.display = 'block';
    console.log(`✅ Vista ${v} mostrada`);
  } else {
    console.warn(`⚠️ Elemento #${vista.id} no encontrado`);
  }
  
  // Activar nav
  const nav = document.getElementById(vista.nav);
  if (nav) nav.classList.add('active');
  
  // Ejecutar función específica según la vista
  if (v === 'comprobantes') {
    if (!_rangoDesde) _iniciarPeriodo();
    if (typeof cargarTodosComprobantes === 'function') cargarTodosComprobantes();
  } else if (v === 'negocio') {
    if (typeof mostrarVistaNormalNegocio === 'function') mostrarVistaNormalNegocio();
  } else if (v === 'arca') {
    if (typeof cargarEstadoARCA === 'function') cargarEstadoARCA();
  } else if (v === 'config') {
    if (typeof cargarConfigVista === 'function') cargarConfigVista();
  } else if (v === 'estado') {
    // Verificar estado de suscripción
    const vistaEstado = document.getElementById('vista-estado');
    if (vistaEstado) vistaEstado.style.display = 'none';
    
    if (typeof verificarEstadoSuscripcion === 'function') {
      verificarEstadoSuscripcion().then(activa => {
        if (activa) {
          console.log('✅ Usuario suscripto → Mostrando vista de Suscripción Activa');
          if (typeof mostrarSuscripcionActiva === 'function') mostrarSuscripcionActiva();
        } else {
          console.log('⚠️ Usuario no suscripto → Mostrando onboarding de MI PLAN');
          if (typeof mostrarOnboardingPlan === 'function') {
            mostrarOnboardingPlan();
          } else {
            if (vistaEstado) vistaEstado.style.display = 'block';
            if (typeof verificarSuscripcion === 'function') verificarSuscripcion();
          }
        }
      }).catch(error => {
        console.error('Error verificando suscripción:', error);
        if (typeof mostrarOnboardingPlan === 'function') mostrarOnboardingPlan();
      });
    }
  } else if (v === 'reporte') {
    // 👇 INICIALIZAR CONTADOR
    if (typeof initContadorInputs === 'function') {
      initContadorInputs();
      console.log('✅ Contador inicializado en vista reporte');
    }
    // 👇 INICIALIZAR BOTÓN ENVIAR REPORTE
    if (typeof initReporteCompleto === 'function') {
      initReporteCompleto();
      console.log('✅ Reporte completo inicializado');
    }
    // 👇 CARGAR DATOS DEL REPORTE
    if (typeof cargarReporte === 'function') {
      cargarReporte();
    }
  }
}
/* ── SUSCRIPCIÓN KOI / MERCADO PAGO ─────────────────── */

// ============================================================
//  VERIFICAR SUSCRIPCIÓN (VISTA MI PLAN) - UNIFICADA
//  Muestra el mismo contenido que el onboarding expirado
// ============================================================

// ============================================================
//  VERIFICAR SUSCRIPCIÓN - Redirige al onboarding unificado de MI PLAN
// ============================================================

async function verificarSuscripcion() {
    console.log('🔍 Verificando suscripción → mostrando onboarding de MI PLAN');
    
    // Mostrar el onboarding unificado que ya tiene todo el HTML y CSS
    if (typeof mostrarOnboardingPlan === 'function') {
        mostrarOnboardingPlan();
    } else {
        console.warn('⚠️ mostrarOnboardingPlan no está disponible');
        // Fallback: mostrar mensaje de error
        const vistaEstado = document.getElementById('vista-estado');
        if (vistaEstado) {
            vistaEstado.innerHTML = '<div style="padding: 40px; text-align: center;">Error: No se pudo cargar la vista del plan. Recargá la página.</div>';
            vistaEstado.style.display = 'block';
        }
    }
}

function descargarComprobante() {
    toast('📄 Generando comprobante...', 'info');
    window.open('/api/orders/ultimo/pdf', '_blank');
}

function verComprobantePago() {
    window.open('/api/orders/ultimo/pdf', '_blank');
}

function cambiarMetodoPago() {
    toast('🔄 Redirigiendo a Mercado Pago...', 'info');
    window.open('https://www.mercadopago.com.ar', '_blank');
}
// ============================================================
//  MOSTRAR MI PLAN - CORTESÍA ACTIVA (Etapa 5)
// ============================================================

function mostrarMiPlanCortesiaActiva(diasRestantes) {
    const contenedor = document.getElementById('susc-inactiva');
    if (!contenedor) return;
    
    contenedor.innerHTML = `
        <div style="text-align: center; padding: 20px;">
            <div style="font-size: 48px; margin-bottom: 16px;">🎉</div>
            <h3 style="color: #00e676; margin-bottom: 8px;">Período de prueba activo</h3>
            <p style="color: #8888aa; margin-bottom: 24px;">Te quedan <strong style="color: #00e676">${diasRestantes} días</strong> de cortesía gratuita.</p>
            
            <div class="price-card" style="margin-top: 16px; background: #0D0D16; border-radius: 20px; padding: 20px; border: 1px solid rgba(249,115,22,0.2);">
                <div style="font-size: 11px; color: #F97316; margin-bottom: 16px;">PLAN ÚNICO · MENSUAL</div>
                <div style="font-size: 48px; font-weight: 900;">$40.000 <span style="font-size: 16px;">/ mes</span></div>
                <div style="color: #22C55E; margin: 8px 0;">Sin permanencia · Cancelás cuando querés</div>
                <button id="btnSuscribirMiPlan" class="susc-btn-mp" style="margin-top: 16px; background: linear-gradient(90deg, #F97316, #FB923C); width: 100%; padding: 14px; border-radius: 12px; border: none; color: white; cursor: pointer;">
                    Suscribirme ahora →
                </button>
                <div style="font-size: 11px; color: #4B5563; margin-top: 12px;">Débito automático · Mercado Pago</div>
            </div>
        </div>
    `;
    
    const btn = document.getElementById('btnSuscribirMiPlan');
    if (btn) {
        btn.onclick = () => iniciarSuscripcion();
    }
}

// ============================================================
//  MOSTRAR MI PLAN - EXPIRADO (COPIA EXACTA DEL ONBOARDING)
// ============================================================

function mostrarMiPlanExpirado() {
    const contenedor = document.getElementById('susc-inactiva');
    if (!contenedor) return;
    
    // Obtener el HTML del onboarding (que ya tiene el diseño correcto)
    const onboarding = document.getElementById('vista-onboarding-plan');
    
    if (!onboarding) {
        // Fallback: usar HTML hardcodeado si no hay onboarding
        contenedor.innerHTML = `
            <div class="plan-unified-container" style="max-width: 850px; margin: 0 auto; padding: 20px;">
                <div class="koi-unified-header">
  <div class="koi-unified-icon" style="display: none;">K</div>
</div>
                <div class="status-unified-card status-expired">
                    <div class="status-unified-title">⚠️ Tu período de prueba finalizó</div>
                    <div class="status-unified-sub">Suscribite para seguir facturando sin interrupciones.</div>
                </div>
                <div class="price-unified-card">
                    <div class="price-unified-top-bar"></div>
                    <div class="price-unified-inner">
                        <div class="price-unified-eyebrow">PLAN ÚNICO · MENSUAL</div>
                        <div class="price-unified-amount">
                            <span class="price-unified-cur">$</span>
                            <span class="price-unified-num">40.000</span>
                            <span class="price-unified-period">/ mes</span>
                        </div>
                        <div class="price-unified-note">Sin permanencia · Cancelás cuando querés</div>
                        <div class="price-unified-divider"></div>
                        <div class="price-unified-features">
                            <div class="price-unified-feature"><div class="price-unified-check"><svg viewBox="0 0 12 12" fill="none"><path d="M2 6L5 9L10 3" stroke="#22C55E" stroke-width="2" stroke-linecap="round"/></svg></div><span class="price-unified-feature-text">Facturas ilimitadas (A, B y C)</span></div>
                            <div class="price-unified-feature"><div class="price-unified-check"><svg viewBox="0 0 12 12" fill="none"><path d="M2 6L5 9L10 3" stroke="#22C55E" stroke-width="2" stroke-linecap="round"/></svg></div><span class="price-unified-feature-text">Facturación automática o manual</span></div>
                            <div class="price-unified-feature"><div class="price-unified-check"><svg viewBox="0 0 12 12" fill="none"><path d="M2 6L5 9L10 3" stroke="#22C55E" stroke-width="2" stroke-linecap="round"/></svg></div><span class="price-unified-feature-text">Envío automático de comprobantes</span></div>
                            <div class="price-unified-feature"><div class="price-unified-check"><svg viewBox="0 0 12 12" fill="none"><path d="M2 6L5 9L10 3" stroke="#22C55E" stroke-width="2" stroke-linecap="round"/></svg></div><span class="price-unified-feature-text">Multi-integración simultánea</span></div>
                            <div class="price-unified-feature"><div class="price-unified-check"><svg viewBox="0 0 12 12" fill="none"><path d="M2 6L5 9L10 3" stroke="#22C55E" stroke-width="2" stroke-linecap="round"/></svg></div><span class="price-unified-feature-text">Soporte por WhatsApp</span></div>
                        </div>
                        <button class="price-unified-btn" id="btnSuscribirMiPlan">Suscribirme ahora →</button>
                        <div class="price-unified-footnote">Débito automático · Mercado Pago</div>
                    </div>
                </div>
            </div>
        `;
    } else {
        // Copiar exactamente el HTML del onboarding
        const onboardingHTML = onboarding.innerHTML;
        contenedor.innerHTML = onboardingHTML;
        console.log('✅ "Mi Plan" copió el HTML del onboarding');
    }
    
    // Configurar el botón
    const btn = document.getElementById('btnSuscribirMiPlan');
    if (btn) {
        // Clonar para eliminar event listeners anteriores
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);
        newBtn.onclick = () => {
            console.log('💳 Iniciando suscripción desde Mi Plan');
            iniciarSuscripcion();
        };
    }
}
// ============================================================
//  MOSTRAR MI PLAN - SIN FECHA (Etapa 3)
// ============================================================

function mostrarMiPlanSinFecha() {
    const contenedor = document.getElementById('susc-inactiva');
    if (!contenedor) return;
    
    contenedor.innerHTML = `
        <div style="text-align: center; padding: 20px;">
            <div style="font-size: 48px; margin-bottom: 16px;">⚙️</div>
            <h3 style="color: #8888aa; margin-bottom: 8px;">Configuración pendiente</h3>
            <p style="color: #8888aa; margin-bottom: 24px;">Completá la configuración de tu cuenta para comenzar.</p>
            <button class="susc-btn-mp" onclick="mostrarVista('config')" style="background: linear-gradient(90deg, #F97316, #FB923C); padding: 12px 24px; border-radius: 40px; border: none; color: white; cursor: pointer;">
                Ir a Configuración →
            </button>
        </div>
    `;
}

// ============================================================
//  MOSTRAR MI PLAN - ERROR
// ============================================================

function mostrarMiPlanError() {
    const contenedor = document.getElementById('susc-inactiva');
    if (!contenedor) return;
    
    contenedor.innerHTML = `
        <div style="text-align: center; padding: 20px;">
            <div style="font-size: 48px; margin-bottom: 16px;">⚠️</div>
            <h3 style="color: #ff6b7a; margin-bottom: 8px;">Error de conexión</h3>
            <p style="color: #8888aa; margin-bottom: 24px;">No se pudo verificar el estado de tu cuenta.</p>
            <button class="susc-btn-mp" onclick="location.reload()" style="background: linear-gradient(90deg, #F97316, #FB923C); padding: 12px 24px; border-radius: 40px; border: none; color: white; cursor: pointer;">
                Recargar página →
            </button>
        </div>
    `;
}

// ============================================================
//  INICIAR SUSCRIPCIÓN (desde Mi Plan)
// ============================================================

function iniciarSuscripcion() {
    const btn = document.getElementById('btnSuscribir');
    const suscInactiva = document.getElementById('susc-inactiva');
    const suscCargando = document.getElementById('susc-cargando');
    
    if (!btn || !suscInactiva || !suscCargando) {
        console.log('ℹ️ Elementos de suscripción no encontrados, redirigiendo directamente');
        window.location.href = '/api/suscripcion/crear';
        return;
    }
    
    suscInactiva.style.display = 'none';
    suscCargando.style.display = 'block';

    gasRun('crearLinkSuscripcion', null,
        res => {
            if (suscCargando) suscCargando.style.display = 'none';
            if (suscInactiva) suscInactiva.style.display = 'block';
            
            if (res && res.error) {
                toast('Error: ' + res.error, 'error');
                return;
            }
            if (res && res.url) {
                window.open(res.url, '_blank');
                toast('Redirigiendo a Mercado Pago…', 'info');
            }
        },
        err => {
            if (suscCargando) suscCargando.style.display = 'none';
            if (suscInactiva) suscInactiva.style.display = 'block';
            toast('Error: ' + err.message, 'error');
        }
    );

    if (typeof google === 'undefined') {
        setTimeout(() => {
            if (suscCargando) suscCargando.style.display = 'none';
            if (suscInactiva) suscInactiva.style.display = 'block';
            toast('Demo: redirigiendo a Mercado Pago…', 'info');
            window.open('https://www.mercadopago.com.ar', '_blank');
        }, 1500);
    }
}

// ============================================================
//  CANCELAR SUSCRIPCIÓN
// ============================================================

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

// Variables globales para paginación
let paginaActual = 1;
let totalPaginas = 1;
let busquedaActual = '';

// 👇 AGREGAR ESTAS VARIABLES GLOBALES DE PERÍODO 👇
let _rangoDesde = null;
let _rangoHasta = null;
let _dashDesde = null;
let _dashHasta = null;


function cargarTodosComprobantes(page = 1, search = '', intento = 1) {
  paginaActual = page;
  busquedaActual = search;
  
  document.getElementById('manualesBody').innerHTML =
    `<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--text-3);font-size:13px">
      <span class="material-icons" style="font-size:18px!important;opacity:.4;display:block;margin-bottom:8px">hourglass_empty</span>
      Cargando comprobantes…
    </tr>`;

  const params = new URLSearchParams({
    limit: 25,
    page: paginaActual
  });
  if (busquedaActual) params.set('search', busquedaActual);
  if (_rangoDesde) params.set('desde', _rangoDesde.toISOString().split('T')[0]);
  if (_rangoHasta) params.set('hasta', _rangoHasta.toISOString().split('T')[0]);
  
  api.get(`/api/orders?${params.toString()}`)
    .then(raw => {
      const orders = raw.orders || [];
      totalPaginas = raw.pagination?.pages || 1;
      
      _todosComp = orders.map(o => {
        let conceptoMostrar = o.concepto || '';
        if (!conceptoMostrar && o.items && o.items.length > 0) {
          conceptoMostrar = o.items.map(i => `${i.cantidad}x ${i.nombre}`).join(', ');
        }
        if (!conceptoMostrar) {
          conceptoMostrar = o.platform || 'Venta';
        }
        
        // 👇 DETERMINAR ORIGEN CORRECTO
        let origen = 'woo';
        if (o.platform === 'manual' || o.platform === 'manuales') {
          origen = 'manual';
        } else if (o.platform === 'mercadolibre' || o.platform === 'ml') {
          origen = 'mercadolibre';
        } else if (o.platform === 'tiendanube') {
          origen = 'tiendanube';
        } else if (o.platform === 'empretienda') {
          origen = 'empretienda';
        } else if (o.platform === 'rappi') {
          origen = 'rappi';
        } else if (o.platform === 'vtex') {
          origen = 'vtex';
        }
        
        // 👇 DETERMINAR EMISIÓN
        const emision = (o.platform === 'manual' || o.platform === 'manuales') ? 'manual' : 'automatica';
        
        // 👇 FECHA ISO para filtros
        const fechaISO = o.createdAt ? new Date(o.createdAt).toISOString().split('T')[0] : '';
        
        return {
          id: o.externalId || o._id,
          _id: o._id,
          cliente: o.customerName || 'Sin nombre',
          email: o.customerEmail || '',
          concepto: conceptoMostrar,
          fecha: o.createdAt ? new Date(o.createdAt).toLocaleDateString('es-AR') : '—',
          fechaISO: fechaISO,
          tipo: 'factura_c',
          monto: o.amount || 0,
          currency: o.currency || 'ARS',
          estado: o.status === 'invoiced' ? 'emitido' : 'pendiente',
          origen: origen,
          platform: o.platform,
          emision: emision,
          emailSent: o.emailSent || false,
          amount: o.amount,
          nroFormatted: o.nroFormatted,
          status: o.status,
          caeNumber: o.caeNumber,
          caeExpiry: o.caeExpiry
        };
      });
      
      console.log('✅ Comprobantes cargados:', _todosComp.length);
      
      // 👇 CAMBIO CLAVE: Usar renderComprobantes en lugar de filtrarComprobantes
      if (typeof renderComprobantes === 'function') {
        renderComprobantes(_todosComp);
        console.log('✅ Comprobantes renderizados en la tabla');
      } else {
        console.error('❌ renderComprobantes no está definida');
        // Fallback: usar filtrarComprobantes
        filtrarComprobantes();
      }
      
      renderPaginadorComprobantes();
    })
    .catch(err => {
      console.error(`Error (intento ${intento}/3):`, err.message);
      if (intento < 3) {
        setTimeout(() => cargarTodosComprobantes(page, search, intento + 1), intento * 2000);
      } else {
        document.getElementById('manualesBody').innerHTML = `<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--text-3);font-size:13px">❌ Error de conexión. Recargá la página.</td></tr>`;
      }
    });
}
function renderPaginadorComprobantes() {
  // Buscar o crear contenedor del paginador
  let container = document.getElementById('paginadorComprobantes');
  if (!container) {
    const tablaContainer = document.querySelector('.comp-tabla-wrap');
    if (tablaContainer) {
      const div = document.createElement('div');
      div.id = 'paginadorComprobantes';
      div.style.marginTop = '16px';
      div.style.marginBottom = '16px';
      tablaContainer.insertAdjacentElement('afterend', div);
      container = div;
    }
  }
  
  if (!container) return;
  
  if (totalPaginas <= 1) {
    container.innerHTML = '';
    return;
  }
  
  let html = '<div style="display:flex;gap:8px;justify-content:center;align-items:center;">';
  
  if (paginaActual > 1) {
    html += `<button onclick="cargarTodosComprobantes(${paginaActual - 1}, '${busquedaActual}')" style="padding:6px 12px;border-radius:6px;border:1px solid var(--border);background:var(--card);cursor:pointer;">◀ Anterior</button>`;
  }
  
  html += `<span style="padding:6px 12px;">Página ${paginaActual} de ${totalPaginas}</span>`;
  
  if (paginaActual < totalPaginas) {
    html += `<button onclick="cargarTodosComprobantes(${paginaActual + 1}, '${busquedaActual}')" style="padding:6px 12px;border-radius:6px;border:1px solid var(--border);background:var(--card);cursor:pointer;">Siguiente ▶</button>`;
  }
  
  html += '</div>';
  container.innerHTML = html;
}

// Conectar la caja de búsqueda existente
function conectarBusquedaComprobantes() {
  const inputBusqueda = document.getElementById('compBuscar');
  if (inputBusqueda) {
    let timeout;
    inputBusqueda.addEventListener('input', (e) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        cargarTodosComprobantes(1, e.target.value);
      }, 500);
    });
  }
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
    return;
  }
  fetch('/api/integrations', { credentials: 'include' })
    .then(r => r.json())
    .then(data => {
      const list = data.integrations || [];
      
      // Actualizar toggles y descripciones en las cards (si existen)
      const connectedPlatforms = {};
      list.forEach(i => { connectedPlatforms[i.platform] = i; });

      ['woocommerce', 'mercadolibre', 'tiendanube', 'empretienda', 'rappi', 'vtex'].forEach(p => {
        const tog = document.getElementById('toggle-' + p);
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

      // Renderizar lista de integraciones activas en negIntegraciones
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
        woocommerce: '🛍',
        tiendanube: '☁️',
        mercadolibre: '🛒',
        empretienda: '🏪',
        rappi: '🛵',
      };

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
          <div style="display:flex;gap:8px;align-items:center;flex-shrink:0">
            ${i.platform === 'woocommerce' ? `<button class="neg-backfill-btn" onclick="backfillConcepto('${i._id}')">
              <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M12 7A5 5 0 1 1 7 2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M12 2v3H9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
              Actualizar Ordenes
            </button>` : ''}
            <button class="neg-disconnect-btn" onclick="desconectar('${i._id}')">Desconectar</button>
          </div>
        </div>`).join('');
    })
    .catch(err => console.error('Error cargando integraciones:', err));
}

// ============================================================
//  SINCRONIZAR ÓRDENES - Desde Mi Negocio
// ============================================================

async function sincronizarOrdenes(integrationId) {
    console.log('🔄 Sincronizando órdenes pendientes...');
    
    // Mostrar toast de inicio
    if (typeof toast === 'function') {
        toast('🔄 Buscando órdenes nuevas...', 'info');
    }
    
    try {
        // Obtener la integración para saber qué plataforma es
        const res = await fetch('/api/integrations', { credentials: 'include' });
        const data = await res.json();
        const integration = data.integrations.find(i => i._id === integrationId);
        
        if (!integration) {
            throw new Error('Integración no encontrada');
        }
        
        let syncRes;
        let syncData;
        
        // Sincronizar según la plataforma
        if (integration.platform === 'woocommerce') {
            syncRes = await fetch('/api/integrations/woocommerce/sync-missing-completed', {
                method: 'POST',
                credentials: 'include'
            });
            syncData = await syncRes.json();
        } else if (integration.platform === 'mercadolibre') {
            syncRes = await fetch('/api/integrations/mercadolibre/sync-all', {
                method: 'POST',
                credentials: 'include'
            });
            syncData = await syncRes.json();
        } else {
            throw new Error(`Plataforma ${integration.platform} no soportada para sincronización automática`);
        }
        
        console.log('📥 Respuesta sincronización:', syncData);
        
        if (syncData.ok) {
            if (typeof toast === 'function') {
                toast('✅ Órdenes sincronizadas correctamente', 'success');
            }
            
            // Recargar la lista de comprobantes
            setTimeout(() => {
                if (typeof cargarTodosComprobantes === 'function') {
                    cargarTodosComprobantes(1, '');
                }
            }, 1500);
        } else {
            throw new Error(syncData.error || 'Error al sincronizar');
        }
        
    } catch (error) {
        console.error('❌ Error sincronizando:', error);
        if (typeof toast === 'function') {
            toast('❌ Error: ' + error.message, 'error');
        }
    }
}

// Mantener la función antigua por compatibilidad (pero redirigir)
async function backfillConcepto(integrationId) {
    console.log('⚠️ backfillConcepto está obsoleta. Usando sincronizarOrdenes...');
    return sincronizarOrdenes(integrationId);
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

// ==================== LOGO ====================
async function cargarLogoActual() {
  try {
    const res = await fetch('/api/me', { credentials: 'include' });
    const data = await res.json();
    const logoUrl = data.user?.settings?.logoUrl;
    
    // Actualizar en ambas vistas
    const imgVista = document.getElementById('currentLogoImg');
    const imgCfg = document.getElementById('currentLogoImgCfg');
    const noLogoVista = document.getElementById('noLogoText');
    const noLogoCfg = document.getElementById('noLogoTextCfg');
    const btnEliminarVista = document.getElementById('btnEliminarLogo');
    const btnEliminarCfg = document.getElementById('btnEliminarLogoCfg');
    
    if (logoUrl) {
      if (imgVista) { imgVista.src = logoUrl; imgVista.style.display = 'block'; }
      if (imgCfg) { imgCfg.src = logoUrl; imgCfg.style.display = 'block'; }
      if (noLogoVista) noLogoVista.style.display = 'none';
      if (noLogoCfg) noLogoCfg.style.display = 'none';
      if (btnEliminarVista) btnEliminarVista.style.display = 'inline-flex';
      if (btnEliminarCfg) btnEliminarCfg.style.display = 'inline-flex';
    } else {
      if (imgVista) imgVista.style.display = 'none';
      if (imgCfg) imgCfg.style.display = 'none';
      if (noLogoVista) noLogoVista.style.display = 'flex';
      if (noLogoCfg) noLogoCfg.style.display = 'flex';
      if (btnEliminarVista) btnEliminarVista.style.display = 'none';
      if (btnEliminarCfg) btnEliminarCfg.style.display = 'none';
    }
  } catch(e) {
    console.warn('Error cargando logo:', e);
  }
}

async function subirLogo(inputId, btnId) {
  const input = document.getElementById(inputId);
  if (!input?.files.length) {
    toast('Seleccioná un archivo primero', 'warn');
    return;
  }
  
  const file = input.files[0];
  const formData = new FormData();
  formData.append('logo', file);
  
  const btn = document.getElementById(btnId);
  const originalText = btn.innerHTML;
  btn.innerHTML = '<span class="material-icons" style="font-size: 14px; animation: spin 1s linear infinite;">sync</span> Subiendo...';
  btn.disabled = true;
  
  try {
    const res = await fetch('/api/me/logo', {
      method: 'POST',
      credentials: 'include',
      body: formData
    });
    
    const data = await res.json();
    if (data.ok) {
      toast('Logo actualizado correctamente', 'success');
      await cargarLogoActual();
      input.value = '';
    } else {
      toast('Error: ' + data.error, 'error');
    }
  } catch(e) {
    toast('Error al subir el logo', 'error');
  } finally {
    btn.innerHTML = originalText;
    btn.disabled = false;
  }
}

async function eliminarLogo(btnId) {
  if (!confirm('¿Eliminar el logo actual?')) return;
  
  try {
    const res = await fetch('/api/me/logo', {
      method: 'DELETE',
      credentials: 'include'
    });
    
    const data = await res.json();
    if (data.ok) {
      toast('Logo eliminado', 'success');
      await cargarLogoActual();
    } else {
      toast('Error al eliminar', 'error');
    }
  } catch(e) {
    toast('Error al eliminar', 'error');
  }
}

// Inicializar handlers
function initLogoHandlers() {
  // Vista principal
  const btnSubir1 = document.getElementById('btnSubirLogo');
  const btnEliminar1 = document.getElementById('btnEliminarLogo');
  const logoInput1 = document.getElementById('logoInput');
  
  if (btnSubir1) btnSubir1.onclick = () => subirLogo('logoInput', 'btnSubirLogo');
  if (btnEliminar1) btnEliminar1.onclick = () => eliminarLogo('btnEliminarLogo');
  if (logoInput1) logoInput1.onchange = () => { if (logoInput1.files.length) subirLogo('logoInput', 'btnSubirLogo'); };
  
  // Panel flotante
  const btnSubir2 = document.getElementById('btnSubirLogoCfg');
  const btnEliminar2 = document.getElementById('btnEliminarLogoCfg');
  const logoInput2 = document.getElementById('logoInputCfg');
  
  if (btnSubir2) btnSubir2.onclick = () => subirLogo('logoInputCfg', 'btnSubirLogoCfg');
  if (btnEliminar2) btnEliminar2.onclick = () => eliminarLogo('btnEliminarLogoCfg');
  if (logoInput2) logoInput2.onchange = () => { if (logoInput2.files.length) subirLogo('logoInputCfg', 'btnSubirLogoCfg'); };
}

// Modificar cargarConfigVista para incluir el logo
// Si ya existe cargarConfigVista, agregale estas líneas al final:
// cargarLogoActual();
// initLogoHandlers();


/* ── CONFIGURACIÓN VISTA ────────────────────────────── */
function cargarConfigVista() {
  // 🔒 SI ESTÁ BLOQUEADO, NO HACER NADA
  if (window._bloquearRecargaConfig) {
    console.log('⏳ cargarConfigVista bloqueada temporalmente');
    return;
  }
  
  // Cargar valores desde la API REST
  fetch('/api/me', { credentials: 'include' })
    .then(r => r.json())
    .then(data => {
      if (!data.user) return;
      const user = data.user;
      const s = user.settings || {};
      
      // ✅ USAR IDs SIN "2" (los que existen en el HTML)
      const nombreInput = document.getElementById('cfgNombre');
      if (nombreInput) nombreInput.value = user.nombre || '';
      
      const cuitInput = document.getElementById('cfgCuit');
      if (cuitInput) cuitInput.value = s.cuit || '';
      
      const emailInput = document.getElementById('cfgEmail');
      if (emailInput) emailInput.value = user.email || '';
      
      const condicionSelect = document.getElementById('cfgCondicionFiscal');
      if (condicionSelect) condicionSelect.value = s.condicionFiscal || 'responsable_inscripto';
      
      const categoriaSelect = document.getElementById('cfgCategoria');
      if (categoriaSelect) categoriaSelect.value = s.categoria || 'C';
      
      // Switches (verificar si existen estos IDs)
      const swFactAuto = document.getElementById('switchFactAuto');
      if (swFactAuto) swFactAuto.checked = s.factAuto === true;
      
      const swEnvioAuto = document.getElementById('switchEnvioAuto');
      if (swEnvioAuto) swEnvioAuto.checked = s.envioAuto === true;
      
      // 👇 NUEVO SWITCH - Envío Automático de Reporte
      const swEnvioReporte = document.getElementById('switchEnvioReporte');
      if (swEnvioReporte) swEnvioReporte.checked = s.envioReporteAuto === true;
      
      // Mostrar/ocultar categoría según condición fiscal
      const categoriaGroup = document.getElementById('categoriaGroup');
      if (categoriaGroup) {
        categoriaGroup.style.display = s.condicionFiscal === 'monotributo' ? 'flex' : 'none';
      }
      
      cargarLogoActual();
      initLogoHandlers();
    })
    .catch(err => console.warn('cargarConfigVista error:', err.message));
}
function guardarPerfilVista() {
  // ✅ USAR IDs SIN "2"
  const nombre = document.getElementById('cfgNombre')?.value.trim() || '';
  const cuit = document.getElementById('cfgCuit')?.value.trim() || '';
  const email = document.getElementById('cfgEmail')?.value.trim() || '';
  const condicionFiscal = document.getElementById('cfgCondicionFiscal')?.value || 'responsable_inscripto';
  const categoria = document.getElementById('cfgCategoria')?.value || 'C';
  
  const datos = {
    nombre,
    cuit,
    email,
    condicionFiscal,
    categoria: condicionFiscal === 'monotributo' ? categoria : 'C'
  };
  
  console.log('📤 Guardando configuración:', datos);
  
  fetch('/api/me/settings', {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(datos)
  })
  .then(r => r.json())
  .then(data => {
    if (data.ok) {
      const st = document.getElementById('cfgSaveStatus');
      if (st) {
        st.classList.add('visible');
        setTimeout(() => st.classList.remove('visible'), 2500);
      }
      toast('✅ Configuración guardada', 'success');
      
      // Actualizar variable global
      if (typeof _condicionFiscal !== 'undefined') {
        window._condicionFiscal = condicionFiscal;
      }
    } else {
      toast('Error: ' + (data.error || 'No se pudo guardar'), 'error');
    }
  })
  .catch(err => {
    console.error('Error:', err);
    toast('Error al guardar: ' + err.message, 'error');
  });
}

// Variable para controlar ejecuciones duplicadas
let _ultimoCambio = {};
let _timeout = {};

async function guardarSwitch(key, value) {
    // 🔒 PREVENIR EJECUCIONES DUPLICADAS (debounce)
    const now = Date.now();
    
    // Si la misma key se llama en menos de 300ms, ignorar
    if (_ultimoCambio[key] && (now - _ultimoCambio[key] < 300)) {
        console.log(`⏳ Ignorando ejecución duplicada de ${key} (${now - _ultimoCambio[key]}ms)`);
        return;
    }
    _ultimoCambio[key] = now;
    
    // Limpiar timeout anterior
    if (_timeout[key]) {
        clearTimeout(_timeout[key]);
    }
    
    // Después de 500ms, permitir nuevas ejecuciones
    _timeout[key] = setTimeout(() => {
        _ultimoCambio[key] = 0;
    }, 500);
    
    console.log(`📤 guardarSwitch: ${key} = ${value}`);
    
    try {
        const payload = {};
        payload[key] = value;
        
        console.log('📤 Payload:', payload);
        
        const res = await fetch('/api/me/settings', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(payload)
        });
        
        if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
        }
        
        const data = await res.json();
        console.log('📥 Respuesta:', data);
        
        // Mapeo de IDs y nombres
        const mapping = {
            'factAuto': { id: 'switchFacturacionAuto', nombre: 'Facturación automática' },
            'envioAuto': { id: 'switchEnvioAuto', nombre: 'Envío automático de factura' },
            'envioReporteAuto': { id: 'switchEnvioReporte', nombre: 'Envío automático de reporte' }
        };
        
        const config = mapping[key];
        if (config) {
            const sw = document.getElementById(config.id);
            if (sw) {
                sw.checked = value;
                console.log(`✅ Switch ${config.nombre} actualizado a: ${value}`);
            }
            
            if (typeof toast === 'function') {
                toast(`${config.nombre} ${value ? 'activado' : 'desactivado'}`, value ? 'success' : 'warn');
            }
        }
        
        const statusDiv = document.getElementById('cfgAutoStatus');
        if (statusDiv) {
            statusDiv.classList.add('visible');
            setTimeout(() => statusDiv.classList.remove('visible'), 2000);
        }
        
        // Verificar que se guardó
        const verifyRes = await fetch('/api/me', { credentials: 'include' });
        const verifyData = await verifyRes.json();
        console.log(`📊 Verificación: ${key} = ${verifyData.user?.settings?.[key]}`);
        
        return true;
        
    } catch(e) {
        console.error('❌ Error en guardarSwitch:', e.message);
        if (typeof toast === 'function') {
            toast('Error al guardar: ' + e.message, 'error');
        }
        return false;
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
// let _dashDesde = null;  // ELIMINADO - usar _rangoDesde
// let _dashHasta = null;  // ELIMINADO - usar _rangoHasta

const DASH_PRESETS = {
  mes:  'Este mes',
  ant:  'Mes anterior',
  trim: 'Trimestre',
  anio: 'Este año',
};

// ============================================================
//  INICIALIZAR PERÍODO DEL DASHBOARD - "TODO EL TIEMPO"
// ============================================================
function _initDashPeriod() {
    // ✅ Cambiar a "Todo" por defecto"
    _rangoDesde = null;
    _rangoHasta = null;
    _dashDesde = null;
    _dashHasta = null;
    
    _syncDashInputs();
    _updateTopbarBadge('Todo');
    _recargarDashConPeriodo();
    
    console.log('📌 Dashboard inicializado con período: TODO');
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
  
  let label = '';
  
  if (preset === 'mes') { 
    _rangoDesde = new Date(y, m, 1);
    _rangoHasta = new Date(y, m+1, 0);
    _dashDesde = _rangoDesde;
    _dashHasta = _rangoHasta;
    label = 'Este mes';
  } else if (preset === 'ant') { 
    _rangoDesde = new Date(y, m-1, 1);
    _rangoHasta = new Date(y, m, 0);
    _dashDesde = _rangoDesde;
    _dashHasta = _rangoHasta;
    label = 'Mes anterior';
  } else if (preset === 'trim') {
    // Últimos 90 días desde hoy
    _rangoDesde = new Date(hoy);
    _rangoDesde.setDate(hoy.getDate() - 90);
    _rangoHasta = new Date(hoy);
    _rangoHasta.setHours(23, 59, 59, 999);
    _dashDesde = _rangoDesde;
    _dashHasta = _rangoHasta;
    label = 'Últimos 90 días';
  } else if (preset === 'anio') { 
    _rangoDesde = new Date(y, 0, 1);
    _rangoHasta = new Date(y, 11, 31);
    _dashDesde = _rangoDesde;
    _dashHasta = _rangoHasta;
    label = 'Este año';
  } else if (preset === 'todo') {
    _rangoDesde = null;
    _rangoHasta = null;
    _dashDesde = null;
    _dashHasta = null;
    label = 'Todo el tiempo';
  }
  
  _syncDashInputs();
  _updateTopbarBadge(label);
  _syncDateInputs();
  
  // Close dropdown
  document.getElementById('dashCalDropdown').classList.remove('open');
  document.getElementById('btnDashPeriodo').classList.remove('open');
  
  _recargarDashConPeriodo();
  cargarTodosComprobantes(1, '');
}

function aplicarDashRangoCustom() {
  const d = document.getElementById('dashDesde').value;
  const h = document.getElementById('dashHasta').value;
  if (!d || !h) return;
  
  _rangoDesde = new Date(d);
  _rangoHasta = new Date(h + 'T23:59:59');
  _dashDesde = _rangoDesde;
  _dashHasta = _rangoHasta;
  
  document.querySelectorAll('#dashCalDropdown .tcal-preset').forEach(b => b.classList.remove('active'));
  const fmt = dt => dt.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' });
  const label = fmt(_dashDesde) + ' → ' + fmt(_dashHasta);
  _updateTopbarBadge(label);
  
  _syncDateInputs();
  
  document.getElementById('dashCalDropdown').classList.remove('open');
  document.getElementById('btnDashPeriodo').classList.remove('open');
  
  _recargarDashConPeriodo();
  cargarTodosComprobantes(1, '');
}

function _syncDashInputs() {
  const toISO = d => d ? d.toISOString().split('T')[0] : '';
  const dashDesde = document.getElementById('dashDesde');
  const dashHasta = document.getElementById('dashHasta');
  if (dashDesde) dashDesde.value = toISO(_rangoDesde);
  if (dashHasta) dashHasta.value = toISO(_rangoHasta);
}

function _updateTopbarBadge(label) {
  const el = document.getElementById('dashPeriodoLabel');
  if (el) el.textContent = label;
  
  // Update chart subtitle
  const chartSub = document.getElementById('chartSub');
  if (chartSub) chartSub.textContent = label;
  
  // Update active label in dropdown
  const al = document.getElementById('tcalActiveLabel');
  if (al && _rangoDesde && _rangoHasta) {
    const fmt = d => d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    al.textContent = fmt(_rangoDesde) + '  →  ' + fmt(_rangoHasta);
  } else if (al) { 
    al.textContent = 'Todo el historial'; 
  }
}

async function _recargarDashConPeriodo() {
  // Construir URL con filtros de período (solo backend)
  const qs = new URLSearchParams();
  if (_rangoDesde) qs.set('desde', _rangoDesde.toISOString().split('T')[0]);
  if (_rangoHasta) qs.set('hasta', _rangoHasta.toISOString().split('T')[0]);
  
  try {
    const raw = await api.get('/api/stats/dashboard?' + qs.toString());
    const data = adaptarStats(raw);
    if (data) {
      cargarDashboard(data);
      
      // Actualizar etiquetas del período
      if (_rangoDesde && _rangoHasta) {
        const fmt = dt => dt.toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' });
        document.getElementById('chartSub').textContent = `${fmt(_rangoDesde)} → ${fmt(_rangoHasta)}`;
        document.getElementById('topbarPeriod').textContent = `Período: ${fmt(_rangoDesde)} → ${fmt(_rangoHasta)}`;
      } else {
        document.getElementById('chartSub').textContent = 'Todo el historial';
        document.getElementById('topbarPeriod').textContent = 'Período: Todo el historial';
      }
    }
  } catch(err) { 
    console.error('Dashboard error:', err.message);
    toast('Error cargando datos: ' + err.message, 'error'); 
  }
}

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
    // Últimos 90 días desde hoy
    _rangoDesde = new Date(hoy);
    _rangoDesde.setDate(hoy.getDate() - 90);
    _rangoHasta = new Date(hoy);
    _rangoHasta.setHours(23, 59, 59, 999);
    document.getElementById('btnPeriodoLabel').textContent = 'Últimos 90 días';
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
  cargarTodosComprobantes(1, busquedaActual);
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
  
  // 👇 Recargar desde el backend con el nuevo filtro
  cargarTodosComprobantes(1, busquedaActual);
}

function filtrarComprobantes() {
  let lista = _todosComp.filter(c => {
    // Filtro por tipo de comprobante
    if (_filtroTipo === 'factura' && c.tipo !== 'Factura C') return false;
    if (_filtroTipo === 'nota' && c.tipo !== 'Nota de Crédito C') return false;
    
    // 👇 FILTRO POR ESTADO CORREGIDO
    if (_filtroTipo === 'pendiente') {
      // Incluir pendientes y errores de AFIP
      return c.estado === 'pendiente' || c.status === 'error_afip' || c.estado === 'cae-err';
    }
    
    // Filtro por origen (plataforma)
    if (_filtroTipo === 'manual' && c.origen !== 'manual') return false;
    if (_filtroTipo === 'woo' && c.origen !== 'woo') return false;
    
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

  let html = '';
  for (let i = 0; i < lista.length; i++) {
    const c = lista[i];
    
    // 👇 DETERMINAR TIPOS
    const esNotaCredito = c.amount < 0 || (c.nroFormatted && c.nroFormatted.startsWith('NC')) || (c.id && c.id.includes('NC'));
    const esCancelada = c.status === 'cancelled' || c.status === 'cancelled_by_nc';
    const esAnulada = c.status === 'cancelled_by_nc';
    const emitido = (c.estado === 'emitido' || c.status === 'invoiced' || (c.caeNumber && c.caeNumber !== '')) && !esCancelada;
    
    // 👇 DATA ATTRIBUTES
    const origen = c.origen || c.platform || 'woo';
    const estado = (() => {
      if (esAnulada) return 'anulada';
      if (esCancelada) return 'cancelada';
      if (emitido) return 'emitido';
      return 'pendiente';
    })();
    const tipo = esNotaCredito ? 'nota_credito' : (c.tipo || 'factura_c');
    const emision = c.origen === 'manual' ? 'manual' : 'automatica';
    const fecha = c.fechaISO || c.fecha || '';
    const emailSent = c.emailSent === true;
    const envio = emailSent ? 'enviado' : 'no_enviado';
    
    // 👇 CHIP
    let estadoChip = '';
    if (esAnulada) {
      estadoChip = `<span class="estado-chip anulado">⚠️ Anulada</span>`;
    } else if (esCancelada) {
      estadoChip = `<span class="estado-chip anulado">⚠️ Cancelada</span>`;
    } else if (emitido) {
      estadoChip = `<span class="estado-chip ok">● Emitido</span>`;
    } else {
      estadoChip = `<span class="estado-chip pend">◌ Pendiente</span>`;
    }
    
    const origenPill = (() => {
      switch (c.platform) {
        case 'mercadolibre':
          return '<span style="font-size:9px;font-weight:700;background:#FFE600;color:#1a1a1a;padding:2px 7px;border-radius:4px;">ML</span>';
        case 'woocommerce':
          return '<span style="font-size:9px;font-weight:700;background:#7F54B3;color:white;padding:2px 7px;border-radius:4px;">WOO</span>';
        default:
          return '<span style="font-size:9px;font-weight:700;background:#444;padding:2px 7px;border-radius:4px;">EXT</span>';
      }
    })();
    
    const btnAnular = c.origen === 'manual' && !emitido && !esAnulada && !esCancelada
      ? `<button class="act-btn" title="Anular" onclick="anularManual('${c.id}')">↩️</button>`
      : '';
    
    const btnCancelar = (emitido && !esCancelada && !esNotaCredito && !esAnulada && c.origen !== 'manual')
      ? `<button class="act-btn act-danger" title="Cancelar factura - Emitir Nota de Crédito" onclick="cancelarFactura('${c.orderId || c._id || c.id}')">
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
            <path d="M2 2L12 12M12 2L2 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            <circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="1.3"/>
          </svg>
         </button>`
      : '';
    
    // 👇 TÍTULO DEL PDF
    let tituloPDF = 'Ver PDF';
    if (esNotaCredito) {
      tituloPDF = 'Ver Nota de Crédito';
    } else if (esAnulada) {
      tituloPDF = 'Ver Factura Anulada';
    } else if (esCancelada && !esNotaCredito) {
      tituloPDF = 'Ver Factura Cancelada';
    }
    
    const emailTitle = emailSent 
      ? (esNotaCredito ? 'Nota de Crédito ya enviada' : 'Factura ya enviada')
      : (esNotaCredito ? 'Enviar Nota de Crédito por email' : 'Enviar factura por email');
    const emailDisabled = emailSent ? 'disabled' : '';
    const emailOnclick = emailSent ? '' : `enviarMail('${c._id||c.id}')`;
    
    const montoRaw = c.monto !== undefined ? c.monto : (c.amount !== undefined ? Math.abs(c.amount) : 0);
    const montoMostrar = esNotaCredito ? Math.abs(montoRaw) : montoRaw;
    const pdfId = c._id || c.id;
    
    // 👇 FILA CON DATA-LABEL (VERSIÓN FINAL)
    html += `
    <tr data-origen="${origen}" data-estado="${estado}" data-tipo="${tipo}" data-emision="${emision}" data-envio="${envio}" data-email-sent="${emailSent}" data-fecha="${fecha}" style="animation:rowIn .3s ease ${i*35}ms both">
      <td data-label="Origen" style="text-align:center">${origenPill}</td>
      <td data-label="N° Comp." style="font-family:var(--font-num);font-weight:600;font-size:11px">${c.id}</td>
      <td data-label="Cliente">
        <div style="font-weight:600;font-size:12px;color:#F9FAFB;">${c.cliente}</div>
        ${c.email ? `<div class="user-email" style="font-size:10px;color:#6B7280;margin-top:1px;">${c.email}</div>` : ''}
      </td>
      <td data-label="Concepto" style="font-size:12px;color:var(--text-2);word-break:break-word;white-space:normal;line-height:1.4;">${c.concepto || c.tipo || ''}</td>
      <td data-label="Fecha" style="font-size:12px;color:var(--text-3)">${c.fecha}</td>
      <td data-label="Monto" style="text-align:right;font-family:var(--font-num);font-weight:700;font-size:13px;color:#F9FAFB;">${formatCurrency(montoMostrar, c.currency || 'ARS')}</td>
      <td data-label="Estado" style="text-align:center">${estadoChip}</td>
      <td data-label="Acciones" style="text-align:center">
        <div class="comp-actions" style="display:flex;flex-direction:row;flex-wrap:nowrap;align-items:center;justify-content:center;gap:4px;">
          <button class="act-btn" title="${tituloPDF}" onclick="verPDF('${pdfId}')">
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
              <rect x="2" y="1" width="8" height="11" rx="1.5" stroke="currentColor" stroke-width="1.3"/>
              <path d="M4 4.5h4M4 6.5h4M4 8.5h2.5" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
            </svg>
          </button>
          ${!emitido && !esNotaCredito && !esAnulada && !esCancelada
            ? `<button class="act-btn act-warn" title="Emitir CAE" data-emitir="${c._id||c.id}" onclick="emitir('${c._id||c.id}')">
                <svg width='13' height='13' viewBox='0 0 14 14' fill='none'>
                  <path d='M7 1.5l5.5 10H1.5L7 1.5z' stroke='currentColor' stroke-width='1.3' stroke-linejoin='round'/>
                  <path d='M7 5.5v3' stroke='currentColor' stroke-width='1.3' stroke-linecap='round'/>
                  <circle cx='7' cy='10' r='.6' fill='currentColor'/>
                </svg>
               </button>`
            : `<button class="act-btn act-done" title="${esNotaCredito || esCancelada ? 'Nota de Crédito emitida' : 'Factura ya emitida'}" disabled>
                <svg width='13' height='13' viewBox='0 0 14 14' fill='none'>
                  <path d='M2.5 7l3 3 6-6' stroke='currentColor' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'/>
                </svg>
               </button>`
          }
          <button class="act-btn ${emailSent ? 'act-btn-sent' : ''}" title="${emailTitle}" onclick="${emailOnclick}" ${emailDisabled}>
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
              <rect x="1.5" y="3" width="11" height="8" rx="1.5" stroke="currentColor" stroke-width="1.3"/>
              <path d="M1.5 5l5.5 3.5L12.5 5" stroke="currentColor" stroke-width="1.2"/>
            </svg>
          </button>
          ${btnCancelar}
          ${btnAnular}
        </div>
      </td>
     </tr>`;
  }
  
  tbody.innerHTML = html;
  renderTotalesComp(lista);
}
function renderTotalesComp(lista) {
  // Excluir órdenes anuladas/canceladas
  const activos = lista.filter(c => c.estado !== 'anulado' && c.status !== 'cancelled');
  const total   = activos.reduce((s, c) => s + Math.abs(c.monto), 0);
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
  const cliente = document.getElementById('emCliente').value.trim();
  const email = document.getElementById('emEmail').value.trim();
  const concepto = document.getElementById('emConcepto').value.trim();
  const monto = parseFloat(document.getElementById('emMonto').value);
  const tipo = document.getElementById('emTipo').value;
  const errEl = document.getElementById('emError');

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

  // 🔥 USAR FETCH DIRECTO AL ENDPOINT /manual
  fetch('/api/orders/manual', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      cliente: cliente,
      email: email,
      concepto: concepto,
      monto: monto,
      tipo: tipo
    })
  })
  .then(res => res.json())
  .then(data => {
    btn.disabled = false;
    btn.innerHTML = '<span class="material-icons" style="font-size:15px!important">save</span> Registrar';
    
    if (data.error) {
      errEl.textContent = data.error;
      errEl.style.display = 'block';
      return;
    }
    
    // 🔥 CORREGIDO: usar externalId o id
    toast(`✅ ${tipo} ${data.externalId || data.id || ''} registrada`, 'success');
    cerrarNuevaEmision();
    cargarTodosComprobantes();
  })
  .catch(err => {
    btn.disabled = false;
    btn.innerHTML = '<span class="material-icons" style="font-size:15px!important">save</span> Registrar';
    errEl.textContent = 'Error: ' + err.message;
    errEl.style.display = 'block';
  });
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

function verPDF(orderId) {
    if (!orderId || orderId === 'undefined') {
        toast('Sin comprobante disponible', 'warn');
        return;
    }
    
    // Buscar la orden en _todosComp para identificar si es NC
    const orden = _todosComp.find(c => c._id === orderId || c.id === orderId);
    
    let pdfId = orderId;
    let tipo = 'Factura';
    
    if (orden) {
        // 🔥 CASO 1: SI ES NC (id contiene NC o amount < 0) → Mostrar NC
        if (orden.id && orden.id.includes('NC')) {
            pdfId = orden._id;
            tipo = 'Nota de Crédito';
            console.log(`📄 Abriendo PDF de Nota de Crédito (ID: ${pdfId})`);
            window.open(`/api/orders/${pdfId}/pdf`, '_blank');
            return;
        }
        
        if (orden.nroFormatted && orden.nroFormatted.startsWith('NC')) {
            pdfId = orden._id;
            tipo = 'Nota de Crédito';
            console.log(`📄 Abriendo PDF de Nota de Crédito (ID: ${pdfId})`);
            window.open(`/api/orders/${pdfId}/pdf`, '_blank');
            return;
        }
        
        // 🔥 CASO 2: FACTURA ANULADA POR NC → Mostrar la factura original
        if (orden.status === 'cancelled_by_nc') {
            // NO buscar NC, mostrar la factura original
            pdfId = orden._id;
            tipo = 'Factura Anulada';
            console.log(`📄 Abriendo PDF de Factura Anulada (ID: ${pdfId})`);
            window.open(`/api/orders/${pdfId}/pdf`, '_blank');
            return;
        }
        
        // 🔥 CASO 3: FACTURA CANCELADA (sin NC) → Buscar NC
        if (orden.status === 'cancelled') {
            const ncAsociada = _todosComp.find(c => 
                c.id && c.id.includes('NC') && 
                c.concepto && c.concepto.includes(orden.id)
            );
            if (ncAsociada) {
                pdfId = ncAsociada._id;
                tipo = 'Nota de Crédito asociada';
                console.log(`📄 ${tipo} encontrada para factura cancelada #${orden.id}`);
                window.open(`/api/orders/${pdfId}/pdf`, '_blank');
                return;
            }
        }
        
        // 🔥 CASO 4: FACTURA NORMAL
        console.log(`📄 Abriendo PDF de Factura (ID: ${pdfId})`);
        window.open(`/api/orders/${pdfId}/pdf`, '_blank');
        return;
    }
    
    // Fallback
    window.open(`/api/orders/${orderId}/pdf`, '_blank');
}
async function emitir(idOrden) {
  // idOrden es el _id de MongoDB de la orden
  const btn = document.querySelector(`[data-emitir="${idOrden}"]`);
  const originalHtml = btn ? btn.innerHTML : '';
  if (btn) { 
    btn.disabled = true; 
    btn.innerHTML = '<span class="material-icons" style="font-size:13px;animation:spin .6s linear infinite">sync</span>'; 
  }

  toast('Solicitando CAE a AFIP…', 'info');
  
  try {
    const res = await fetch(`/api/orders/${idOrden}/emitir`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' }
    });
    
    const data = await res.json();

    // 👇 CASO 0: PERÍODO EXPIRADO (403)
    if (res.status === 403 && data.codigo === 'PERIODO_EXPIRADO') {
      toast('⚠️ ' + data.error, 'error');
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
      }
      // Redirigir a la página de suscripción después de 2 segundos
      setTimeout(() => {
        if (typeof mostrarVista === 'function') {
          mostrarVista('estado');
        }
      }, 2000);
      return;
    }

    // Caso 1: Requiere confirmación (409 Conflict)
    if (res.status === 409 && data.requiereConfirmacion) {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
      }
      
      const confirmar = confirm(data.mensaje);
      if (confirmar) {
        toast('Procesando emisión forzada…', 'info');
        
        const res2 = await fetch(`/api/orders/${idOrden}/emitir-forzar`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' }
        });
        
        const data2 = await res2.json();
        
        if (data2.ok) {
          toast(`✅ CAE emitido: ${data2.cae}`, 'success');
          _recargarDashConPeriodo();
          if (typeof cargarTodosComprobantes === 'function') {
            cargarTodosComprobantes(paginaActual, busquedaActual);
          }
        } else {
          toast('❌ Error: ' + data2.error, 'error');
        }
      }
      return;
    }

    // Caso 2: Emisión exitosa (usando api.post)
    if (data.ok) {
      toast(`✅ CAE emitido: ${data.cae}`, 'success');
      _recargarDashConPeriodo();
      if (typeof cargarTodosComprobantes === 'function') {
        cargarTodosComprobantes(paginaActual, busquedaActual);
      }
    } else {
      toast('❌ Error: ' + data.error, 'error');
    }
    
  } catch(e) {
    console.error('Error en emitir:', e);
    toast('Error AFIP: ' + e.message, 'error');
    if (btn) { 
      btn.disabled = false; 
      btn.innerHTML = originalHtml;
    }
  }
}

async function emitirLote() {
  if (!confirm('¿Emitir CAE para TODAS las órdenes pendientes?')) return;
  
  toast('Verificando órdenes pendientes…', 'info');
  
  try {
    const res = await fetch('/api/orders/emitir-lote', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' }
    });
    
    const data = await res.json();

    // 👇 CASO: PERÍODO EXPIRADO (403)
    if (res.status === 403 && data.codigo === 'PERIODO_EXPIRADO') {
      toast('⚠️ ' + data.error, 'error');
      setTimeout(() => {
        if (typeof mostrarVista === 'function') {
          mostrarVista('estado');
        }
      }, 2000);
      return;
    }
    
    // Caso 1: Requiere confirmación (409 Conflict)
    if (res.status === 409 && data.requiereConfirmacion) {
      const confirmar = confirm(data.mensaje);
      if (confirmar) {
        toast('Emitiendo lote forzado… Esto puede tardar unos segundos', 'info');
        
        const res2 = await fetch('/api/orders/emitir-lote-forzar', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' }
        });
        
        const data2 = await res2.json();
        
        if (data2.ok) {
          toast(`✅ ${data2.message || 'Lote emitido correctamente'}`, 'success');
          setTimeout(_recargarDashConPeriodo, 3000);
          if (typeof cargarTodosComprobantes === 'function') {
            setTimeout(() => cargarTodosComprobantes(1, ''), 3000);
          }
        } else {
          toast('❌ Error: ' + data2.error, 'error');
        }
      }
      return;
    }
    
    // Caso 2: Emisión directa
    if (data.ok) {
      toast(`✅ ${data.message || 'Lote emitido correctamente'}`, 'success');
      setTimeout(_recargarDashConPeriodo, 3000);
      if (typeof cargarTodosComprobantes === 'function') {
        setTimeout(() => cargarTodosComprobantes(1, ''), 3000);
      }
    } else {
      toast('❌ Error: ' + data.error, 'error');
    }
    
  } catch(e) {
    console.error('Error en emitirLote:', e);
    toast('Error: ' + e.message, 'error');
  }
}
async function enviarMail(orderId) {
  if (!orderId) return;
  
  // Obtener la orden para saber su estado
  try {
    const ordenRes = await fetch(`/api/orders/${orderId}`, { credentials: 'include' });
    const orden = await ordenRes.json();
    const esCancelada = orden.status === 'cancelled';
    const tipoMensaje = esCancelada ? 'Nota de Crédito' : 'factura';
    
    toast(`Enviando ${tipoMensaje} por mail…`, 'info');
    
    const res = await api.post(`/api/orders/${orderId}/mail`, {});
    
    if (res.ok) {
      toast(res.message || `${tipoMensaje} enviada correctamente`, 'success');
      
      // Actualizar visualmente el botón
      const buttons = document.querySelectorAll(`button[onclick*="enviarMail('${orderId}')"]`);
      buttons.forEach(btn => {
        btn.classList.remove('act-btn');
        btn.classList.add('act-btn-sent');
        btn.title = `${tipoMensaje} ya enviada`;
        btn.disabled = true;
        btn.onclick = null;
      });
      
      // Recargar la lista
      setTimeout(() => cargarTodosComprobantes(paginaActual, busquedaActual), 1500);
    } else {
      toast(res.message || 'Error al enviar', 'error');
    }
  } catch(e) {
    toast('Error: ' + e.message, 'error');
  }
}

/* ── INIT ──────────────────────────────────────────── */

// ========== VARIABLE GLOBAL DE CONDICIÓN FISCAL ==========
let _condicionFiscal = null;

// ========== FUNCIONES DE CONDICIÓN FISCAL ==========

// Función para cargar la condición fiscal del usuario
async function cargarCondicionFiscal() {
    try {
        const res = await fetch('/api/me');
        const { user } = await res.json();
        if (user?.settings?.condicionFiscal) {
            _condicionFiscal = user.settings.condicionFiscal;
        } else {
            _condicionFiscal = 'responsable_inscripto';
        }
    } catch (err) {
        console.warn('Error cargando condición fiscal:', err);
        _condicionFiscal = 'responsable_inscripto';
    }
    console.log('📋 Condición fiscal cargada:', _condicionFiscal);
}

// Función para obtener la condición fiscal actual
function getCondicionFiscal() {
    return _condicionFiscal || 'responsable_inscripto';
}

// Función para obtener el mensaje según condición fiscal
function getMensajePeriodoAnterior() {
    const condicion = getCondicionFiscal();
    
    if (condicion === 'monotributo') {
        return `
            <strong>Importante:</strong> Las facturas se imputan al <strong>MES CORRIENTE</strong>.<br>
            Facturar períodos anteriores puede afectar tu <strong>CATEGORÍA de Monotributo</strong> y superar los límites de facturación.<br>
            Verificá antes de continuar.
        `;
    } else if (condicion === 'responsable_inscripto') {
        return `
            <strong>Importante:</strong> Las facturas se imputan al <strong>MES CORRIENTE</strong>.<br>
            Facturar períodos anteriores puede afectar el cómputo de <strong>IVA, Ganancias y percepciones de IIBB</strong>.<br>
            Verificá tu situación fiscal antes de continuar.
        `;
    } else {
        return `
            <strong>Importante:</strong> Las facturas se imputan al <strong>MES CORRIENTE</strong>.<br>
            Facturar períodos anteriores puede afectar tu declaración fiscal del período actual.<br>
            Verificá antes de continuar.
        `;
    }
}


// ========== INIT (UNIFICADO) ==========
document.addEventListener('DOMContentLoaded', async () => {
    // Cargar condición fiscal primero
    await cargarCondicionFiscal();
    
    // Cargar configuración del usuario
    await cargarConfiguracion();
    
    // Inicializar período del dashboard
    _initDashPeriod();

    // Cargar datos reales desde la API REST
    try {
        const _ahora = new Date();
      const _desde = new Date(_ahora.getFullYear(), _ahora.getMonth(), 1).toISOString().split('T')[0];
      const _hasta = new Date(_ahora.getFullYear(), _ahora.getMonth() + 1, 0).toISOString().split('T')[0];
        const raw = await api.get(`/api/stats/dashboard?desde=${_desde}&hasta=${_hasta}`);
        const data = adaptarStats(raw);
        if (data) {
            cargarDashboard(data);
        } else {
            renderStatus(false);
            cargarDashboard(MOCK);
        }
    } catch(e) {
        console.error('Init error:', e.message);
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
        // Después de conectar una tienda, verificar si necesita onboarding de ARCA
        setTimeout(() => {
            if (typeof mostrarPantallaInicial === 'function') {
                mostrarPantallaInicial();
            } else {
                console.error('❌ mostrarPantallaInicial no está definida');
                mostrarVista('dashboard');
            }
        }, 500);
    }
    if (params.get('ml') === 'connected') {
        toast('✅ Mercado Libre conectado correctamente', 'success');
        history.replaceState({}, '', '/dashboard');
        // Después de conectar una tienda, verificar si necesita onboarding de ARCA
        setTimeout(() => {
            if (typeof mostrarPantallaInicial === 'function') {
                mostrarPantallaInicial();
            } else {
                console.error('❌ mostrarPantallaInicial no está definida');
                mostrarVista('dashboard');
            }
        }, 500);
    }
    if (params.get('error') === 'ml_failed') {
        toast('Error al conectar Mercado Libre', 'error');
        history.replaceState({}, '', '/dashboard');
    }
    
    // Conectar búsqueda de comprobantes
    conectarBusquedaComprobantes();
    
    // Configurar auto-guardado de límites
    initAutoGuardadoLimites();
    
    // ========== 👇 NUEVA LÓGICA DE ONBOARDING ==========
    setTimeout(() => {
        console.log('🔄 Verificando pantalla inicial (tiendas + ARCA)...');
        if (typeof mostrarPantallaInicial === 'function') {
            mostrarPantallaInicial();
        } else {
            console.error('❌ mostrarPantallaInicial no está definida - revisá el orden de carga del script');
            console.log('📋 Funciones disponibles en window:', Object.keys(window).filter(k => k.includes('mostrar')));
            mostrarVista('dashboard');
        }
    }, 500);
});
// ========== FUNCIONES DE CONFIGURACIÓN ==========

// Modificar la función guardarPerfilVista() para incluir condicionFiscal
async function guardarPerfilVista() {
    const condicionFiscal = document.getElementById('cfgCondicionFiscal2').value;
    const categoria = document.getElementById('cfgCategoria2').value;
    const cuit = document.getElementById('cfgCuit2').value;
    const email = document.getElementById('cfgEmail2').value;
    
    const payload = {
        condicionFiscal,
        categoria: condicionFiscal === 'monotributo' ? categoria : 'C',
        cuit,
        email
    };
    
    const btn = event?.target?.closest?.('.btn-cfg-save') || document.querySelector('.btn-cfg-save');
    if (btn) btn.disabled = true;
    
    try {
        const res = await fetch('/api/me/settings', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        const data = await res.json();
        
        if (data.ok) {
            // Actualizar variable global de condición fiscal
            _condicionFiscal = condicionFiscal;
            
            const statusDiv = document.getElementById('cfgSaveStatus2');
            if (statusDiv) {
                statusDiv.style.display = 'block';
                setTimeout(() => { statusDiv.style.display = 'none'; }, 3000);
            }
            console.log('✅ Configuración guardada:', payload);
            
            // Si el modal de lote está abierto, actualizar mensaje
            const desde = document.getElementById('loteFechaDesde')?.value;
            const hasta = document.getElementById('loteFechaHasta')?.value;
            if (desde && hasta && _lotePrevio) {
                const errorDiv = document.getElementById('loteError');
                if (typeof verificarLimitesYContinuar === 'function') {
                    verificarLimitesYContinuar(desde, hasta, errorDiv);
                }
            }
        } else {
            alert('Error: ' + (data.error || 'No se pudo guardar'));
        }
    } catch (err) {
        console.error('Error al guardar:', err);
        alert('Error al guardar la configuración');
    } finally {
        if (btn) btn.disabled = false;
    }
}

// Función para cargar los datos del usuario
async function cargarConfiguracion() {
    try {
        const res = await fetch('/api/me');
        const { user } = await res.json();
        
        if (user?.settings) {
            // Sincronizar variable global de condición fiscal
            _condicionFiscal = user.settings.condicionFiscal || 'responsable_inscripto';
            
            // Cargar condición fiscal
            const condicion = user.settings.condicionFiscal || 'responsable_inscripto';
            const condicionSelect = document.getElementById('cfgCondicionFiscal2');
            if (condicionSelect) condicionSelect.value = condicion;
            
            // Cargar categoría
            const categoria = user.settings.categoria || 'C';
            const categoriaSelect = document.getElementById('cfgCategoria2');
            if (categoriaSelect) categoriaSelect.value = categoria;
            
            // Cargar CUIT
            const cuitInput = document.getElementById('cfgCuit2');
            if (cuitInput && user.settings.cuit) cuitInput.value = user.settings.cuit;
            
            // Cargar email
            const emailInput = document.getElementById('cfgEmail2');
            if (emailInput && user.email) emailInput.value = user.email;
            
            // Aplicar visibilidad del campo categoría
            toggleCategoriaField();
        }
    } catch (err) {
        console.error('Error al cargar configuración:', err);
    }
}

// Cancelar factura y emitir Nota de Crédito
async function cancelarFactura(orderId) {
    if (!confirm('¿Cancelar esta factura?\n\nSe emitirá una Nota de Crédito vinculada a la factura original.')) return;
    
    toast('Procesando cancelación y generando Nota de Crédito...', 'info');
    
    try {
        const res = await fetch(`/api/orders/${orderId}/cancelar`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' }
        });
        
        const data = await res.json();
        
        if (data.ok) {
            toast(`✅ Nota de Crédito emitida: ${data.nroNC}`, 'success');
            setTimeout(() => cargarTodosComprobantes(paginaActual, busquedaActual), 1500);
            setTimeout(() => _recargarDashConPeriodo(), 2000);
        } else {
            toast('❌ Error: ' + data.error, 'error');
        }
    } catch(e) {
        toast('Error: ' + e.message, 'error');
    }
}

// Forzar regeneración automática al cargar la página
(function() {
    const originalLoad = window.onload;
    window.onload = function(e) {
        if (originalLoad) originalLoad(e);
        setTimeout(() => {
            fetch('/api/stats/dashboard', { credentials: 'include', cache: 'no-cache' })
                .then(r => r.json())
                .then(data => renderComps(data.ultimas))
                .catch(() => {});
        }, 100);
    };
})();

// ==================== EMITIR LOTE (FLUJO DE DOS PASOS) ====================

let _pasoActualLote = 1;      // 1: selección, 2: confirmación
let _lotePrevio = null;       // guardar datos del preview para el paso 2
window._modoPruebaLote = true; // true = simulación, false = emisión real

// Inicializar límites configurables (valores por defecto)
window._limitesConfig = window._limitesConfig || { maxFacturas: 20, maxMonto: 1000000, maxDias: 90, activarFacturas: true, activarMonto: true, activarDias: true };

// ========== FUNCIONES DE VISUALIZACIÓN DE PASOS ==========

function mostrarPasoSeleccionLote() {
    const pasoSeleccion = document.getElementById('pasoSeleccionLote');
    const pasoConfirmacion = document.getElementById('pasoConfirmacionLote');
    const btnSiguiente = document.getElementById('btnSiguienteLote');
    const btnVolver = document.getElementById('btnVolverLote');
    const btnEmitir = document.getElementById('btnEmitirLoteConfirmado');
    
    if (pasoSeleccion) pasoSeleccion.style.display = 'block';
    if (pasoConfirmacion) pasoConfirmacion.style.display = 'none';
    if (btnSiguiente) btnSiguiente.style.display = 'flex';
    if (btnVolver) btnVolver.style.display = 'none';
    if (btnEmitir) btnEmitir.style.display = 'none';
}

function mostrarPasoConfirmacionLote() {
    const pasoSeleccion = document.getElementById('pasoSeleccionLote');
    const pasoConfirmacion = document.getElementById('pasoConfirmacionLote');
    const btnSiguiente = document.getElementById('btnSiguienteLote');
    const btnVolver = document.getElementById('btnVolverLote');
    const btnEmitir = document.getElementById('btnEmitirLoteConfirmado');
    
    if (pasoSeleccion) pasoSeleccion.style.display = 'none';
    if (pasoConfirmacion) pasoConfirmacion.style.display = 'block';
    if (btnSiguiente) btnSiguiente.style.display = 'none';
    if (btnVolver) btnVolver.style.display = 'flex';
    if (btnEmitir) btnEmitir.style.display = 'flex';
    
    cargarResumenConfirmacionLote();
}

// ========== ABRIR Y CERRAR MODAL ==========

function abrirModalLote() {
    _pasoActualLote = 1;
    _lotePrevio = null;
    
    const desdeInput = document.getElementById('loteFechaDesde');
    const hastaInput = document.getElementById('loteFechaHasta');
    
    if (desdeInput) desdeInput.value = '';
    if (hastaInput) hastaInput.value = '';
    
    const errorDiv = document.getElementById('loteError');
    const previewDiv = document.getElementById('lotePreview');
    const seguridadDiv = document.getElementById('loteSeguridad');
    
    if (errorDiv) {
        errorDiv.style.display = 'none';
        errorDiv.innerHTML = '';
    }
    if (previewDiv) previewDiv.innerHTML = '';
    if (seguridadDiv) {
        seguridadDiv.style.display = 'none';
        seguridadDiv.innerHTML = '';
    }
    
    mostrarPasoSeleccionLote();
    
    const overlay = document.getElementById('modalLoteOverlay');
    const modal = document.getElementById('modalLote');
    
    if (overlay) overlay.style.display = 'block';
    if (modal) {
        modal.style.display = 'block';
        modal.style.opacity = '1';
        modal.style.pointerEvents = 'auto';
    }
    
    const ejecutarPreviewYValidar = async () => {
        await previewEmitirLote();
        const desde = desdeInput?.value;
        const hasta = hastaInput?.value;
        if (desde && hasta && errorDiv && _lotePrevio) {
            verificarLimitesYContinuar(desde, hasta, errorDiv);
        }
    };
    
    if (desdeInput) {
        desdeInput.removeEventListener('change', ejecutarPreviewYValidar);
        desdeInput.addEventListener('change', ejecutarPreviewYValidar);
    }
    if (hastaInput) {
        hastaInput.removeEventListener('change', ejecutarPreviewYValidar);
        hastaInput.addEventListener('change', ejecutarPreviewYValidar);
    }
}

function cerrarModalLote() {
    const overlay = document.getElementById('modalLoteOverlay');
    const modal = document.getElementById('modalLote');
    
    if (overlay) overlay.style.display = 'none';
    if (modal) modal.style.display = 'none';
    
    _pasoActualLote = 1;
    _lotePrevio = null;
    
    const errorDiv = document.getElementById('loteError');
    if (errorDiv) {
        errorDiv.style.display = 'none';
        errorDiv.innerHTML = '';
    }
}

// ========== PREVIEW ==========

async function previewEmitirLote() {
    const desde = document.getElementById('loteFechaDesde').value;
    const hasta = document.getElementById('loteFechaHasta').value;
    const previewDiv = document.getElementById('lotePreview');
    const errorDiv = document.getElementById('loteError');
    
    if (!desde || !hasta) {
        if (previewDiv) previewDiv.innerHTML = '';
        if (errorDiv) errorDiv.style.display = 'none';
        _lotePrevio = null;
        return;
    }
    
    if (errorDiv) {
        errorDiv.style.display = 'none';
        errorDiv.innerHTML = '';
    }
    
    try {
        const res = await fetch('/api/orders/preview-lote', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ desde, hasta })
        });
        const data = await res.json();
        
        _lotePrevio = {
            total: data.total,
            montoTotal: data.montoTotal,
            desde,
            hasta,
            esMesAnterior: data.esMesAnterior || false
        };
        
        if (previewDiv) {
            if (data.total === 0) {
                previewDiv.innerHTML = `<div style="background: rgba(255,61,87,0.1); padding: 16px; border-radius: 12px; margin-top: 16px;">❌ No hay órdenes pendientes en este período</div>`;
            } else {
                let filas = '';
                data.detalle.slice(0, 10).forEach((o, idx) => {
                    const fechaOrden = o.fecha || (o.createdAt ? new Date(o.createdAt).toLocaleDateString('es-AR') : '—');
                    const externalId = o.externalId || o.id || `orden-${idx}`;
                    filas += `<div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.05);">
                        <span>#${externalId} - ${fechaOrden} - ${o.customerName}</span>
                        <span>${formatCurrency(o.amount, o.currency)}</span>
                    </div>`;
                });
                const masOrdenes = data.total > 10 ? `<div style="padding: 8px 0; text-align: center;">... y ${data.total - 10} órdenes más</div>` : '';
                previewDiv.innerHTML = `<div style="background: var(--card-2); border-radius: 12px; margin-top: 16px; padding: 12px;">
                    <div style="display: flex; justify-content: space-between; margin-bottom: 12px;">
                        <span>📋 ÓRDENES A EMITIR (${data.total})</span>
                        <span>${formatCurrency(data.montoTotal)}</span>
                    </div>
                    <div style="max-height: 200px; overflow-y: auto;">${filas}${masOrdenes}</div>
                </div>`;
            }
        }
        
        const btnSiguiente = document.getElementById('btnSiguienteLote');
        if (btnSiguiente) btnSiguiente.disabled = (data.total === 0);
        
        return data;
        
    } catch(e) {
        console.error('Error en preview:', e);
        if (previewDiv) previewDiv.innerHTML = '<div style="color: var(--red); padding: 12px;">❌ Error al cargar previsualización</div>';
        _lotePrevio = null;
        return null;
    }
}

// ========== NAVEGACIÓN ENTRE PASOS ==========

function siguientePasoLote() {
    const desde = document.getElementById('loteFechaDesde').value;
    const hasta = document.getElementById('loteFechaHasta').value;
    const errorDiv = document.getElementById('loteError');
    const btnSiguiente = document.getElementById('btnSiguienteLote');
    
    if (errorDiv) {
        errorDiv.style.display = 'none';
        errorDiv.innerHTML = '';
    }
    if (btnSiguiente) {
        btnSiguiente.disabled = false;
        btnSiguiente.style.opacity = '1';
        btnSiguiente.style.cursor = 'pointer';
    }
    
    if (!desde || !hasta) {
        if (errorDiv) {
            errorDiv.innerText = 'Completá ambas fechas';
            errorDiv.style.display = 'block';
        }
        return;
    }
    
    if (new Date(desde) > new Date(hasta)) {
        if (errorDiv) {
            errorDiv.innerText = 'La fecha "Desde" no puede ser mayor que "Hasta"';
            errorDiv.style.display = 'block';
        }
        return;
    }
    
    if (!_lotePrevio) {
        toast('Generando previsualización...', 'info');
        previewEmitirLote().then(() => {
            verificarLimitesYContinuar(desde, hasta, errorDiv);
        });
        return;
    }
    
    verificarLimitesYContinuar(desde, hasta, errorDiv);
}

function volverPasoSeleccionLote() {
    _pasoActualLote = 1;
    mostrarPasoSeleccionLote();
}

// ========== VALIDACIÓN DE LÍMITES ==========

// Función para obtener mensaje según condición fiscal (siempre el correcto)
function getMensajePorCondicionFiscal() {
    // Usar _condicionFiscal en lugar de window._condicionFiscal
    const condicionFiscal = typeof _condicionFiscal !== 'undefined' ? _condicionFiscal : 'responsable_inscripto';
    
    if (condicionFiscal === 'monotributo' || condicionFiscal === 'monotributista') {
        return `📅 Las facturas se imputan al <strong>MES CORRIENTE</strong>.<br>
                Facturar períodos anteriores puede afectar tu <strong>CATEGORÍA de MoFributo</strong> y superar los límites de facturación.<br>
                Verificá antes de continuar.`;
    } else {
        return `📅 Las facturas se imputan al <strong>MES CORRIENTE</strong>.<br>
                Facturar períodos anteriores puede afectar el <strong>cómputo de IVA, Ganancias y percepciones de IIBB</strong>.<br>
                Verificá tu situación fiscal antes de continuar.`;
    }
}

function verificarLimitesYContinuar(desde, hasta, errorDiv) {
    if (!errorDiv || errorDiv.id !== 'loteError') {
        errorDiv = document.getElementById('loteError');
    }
    
    const btnSiguiente = document.getElementById('btnSiguienteLote');
    
    const maxFacturasActivo = window._limitesConfig?.activarFacturas !== false;
    const maxMontoActivo = window._limitesConfig?.activarMonto !== false;
    const maxDiasActivo = window._limitesConfig?.activarDias !== false;
    const maxFacturas = window._limitesConfig?.maxFacturas || 20;
    const maxMonto = window._limitesConfig?.maxMonto || 1000000;
    const maxDias = window._limitesConfig?.maxDias || 90;
    
    const fechaDesde = new Date(desde);
    const fechaHasta = new Date(hasta);
    const hoy = new Date();
    const mesActual = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
    const esPeriodoAnterior = fechaHasta < mesActual;
    const diffDays = Math.ceil((fechaHasta - fechaDesde) / (1000 * 60 * 60 * 24));
    const excedeDias = maxDiasActivo && diffDays > maxDias;
    const diasDesdePeriodo = Math.ceil((hoy - fechaHasta) / (1000 * 60 * 60 * 24));
    const periodoMuyAntiguo = maxDiasActivo && diasDesdePeriodo > maxDias;
    const excedeFacturas = maxFacturasActivo && _lotePrevio?.total > maxFacturas;
    const excedeMonto = maxMontoActivo && _lotePrevio?.montoTotal > maxMonto;
    const bloquea = excedeFacturas || excedeMonto || excedeDias || periodoMuyAntiguo;
    
    // Obtener el mensaje correcto según condición fiscal (SIEMPRE el mismo, haya o no bloqueo)
    const mensajeFiscalCorrecto = getMensajePorCondicionFiscal();
    
    const advertenciaFiscal = `
        <div style="background: rgba(255,179,0,0.08); border-radius: 10px; padding: 10px 12px; margin-bottom: 16px;">
            <div style="display: flex; align-items: center; gap: 8px;">
                <span>⚠️</span>
                <span style="font-size: 12px; color: var(--text-2); line-height: 1.4;">
                    <strong>Importante:</strong><br>
                    ${mensajeFiscalCorrecto}
                </span>
            </div>
        </div>
    `;
    
    // ========== CASO 1: ERROR BLOQUEANTE (rojo) ==========
    if (bloquea) {
        let erroresLista = '';
        
        if (excedeFacturas) {
            erroresLista += `<div style="display: flex; align-items: center; gap: 8px; background: rgba(255,61,87,0.08); padding: 8px 12px; border-radius: 10px; border-left: 3px solid var(--red);">
                <span>⚠️</span>
                <span><strong>La operación intenta emitir ${_lotePrevio.total} facturas</strong> (máximo: ${maxFacturas})</span>
            </div>`;
        }
        if (excedeMonto) {
            erroresLista += `<div style="display: flex; align-items: center; gap: 8px; background: rgba(255,61,87,0.08); padding: 8px 12px; border-radius: 10px; border-left: 3px solid var(--red);">
                <span>⚠️</span>
                <span><strong>El monto total alcanza ${formatCurrency(_lotePrevio.montoTotal)}</strong> (límite: ${formatCurrency(maxMonto)})</span>
            </div>`;
        }
        if (excedeDias) {
            erroresLista += `<div style="display: flex; align-items: center; gap: 8px; background: rgba(255,61,87,0.08); padding: 8px 12px; border-radius: 10px; border-left: 3px solid var(--red);">
                <span>⚠️</span>
                <span><strong>El período abarca ${diffDays} días</strong> (máximo: ${maxDias} días)</span>
            </div>`;
        }
        if (periodoMuyAntiguo) {
            erroresLista += `<div style="display: flex; align-items: center; gap: 8px; background: rgba(255,61,87,0.08); padding: 8px 12px; border-radius: 10px; border-left: 3px solid var(--red);">
                <span>⚠️</span>
                <span><strong>El período terminó hace ${diasDesdePeriodo} días</strong> (máximo: ${maxDias} días atrás)</span>
            </div>`;
        }
        
        let mensajeUnificado = `
            <div style="background: rgba(255,61,87,0.05); border: 1px solid rgba(255,61,87,0.2); border-radius: 20px; padding: 20px; margin-top: 16px;">
                <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px;">
                    <div style="width: 44px; height: 44px; background: rgba(255,61,87,0.12); border-radius: 22px; display: flex; align-items: center; justify-content: center;">
                        <span style="font-size: 24px;">🛡️</span>
                    </div>
                    <div>
                        <div style="font-weight: 800; font-size: 16px; color: var(--red);">ADVERTENCIAS DE SEGURIDAD</div>
                    </div>
                </div>
                ${advertenciaFiscal}
                <div style="background: rgba(0,0,0,0.2); border-radius: 14px; padding: 14px; margin-bottom: 16px;">
                    <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px;">
                        <span style="font-size: 18px;">🚫</span>
                        <span style="font-weight: 700; font-size: 14px; color: var(--text-1);">No se puede continuar con la emisión por lote</span>
                    </div>
                    <div style="display: flex; flex-direction: column; gap: 10px;">
                        ${erroresLista}
                    </div>
                </div>
                <div style="background: rgba(0,230,118,0.04); border: 1px solid rgba(0,230,118,0.12); border-radius: 14px; padding: 14px;">
                    <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 10px;">
                        <span style="font-size: 18px;">💡</span>
                        <span style="font-weight: 700; font-size: 13px; color: var(--green);">¿Cómo solucionarlo?</span>
                    </div>
                    <div style="font-size: 12px; color: var(--text-2); line-height: 1.5; padding-left: 26px;">
                        Para poder emitir este lote, solo tenés que aumentar los límites en:<br>
                        <strong style="color: var(--orange-2);">→ Configuración → Límites para Emisión en Lote</strong>
                    </div>
                </div>
                <div style="margin-top: 14px; font-size: 11px; color: var(--text-3); display: flex; align-items: center; gap: 6px; justify-content: flex-end;">
                    <span>🔒</span>
                    <span>Estamos cuidando tus intereses</span>
                </div>
            </div>
        `;
        
        if (errorDiv) {
            errorDiv.innerHTML = mensajeUnificado;
            errorDiv.style.display = 'block';
            errorDiv.style.background = 'transparent';
            errorDiv.style.border = 'none';
            errorDiv.style.padding = '0';
        }
        
        if (btnSiguiente) {
            btnSiguiente.disabled = true;
            btnSiguiente.style.opacity = '0.5';
            btnSiguiente.style.cursor = 'not-allowed';
        }
        toast('⚠️ Límites superados. Aumentalos en Configuración.', 'error');
        return;
    }
    
    // ========== CASO 2: SIN BLOQUEO (amarillo informativo) ==========
    if (esPeriodoAnterior) {
        let mensajeInformativo = `
            <div style="background: rgba(255,179,0,0.05); border: 1px solid rgba(255,179,0,0.2); border-radius: 20px; padding: 20px; margin-top: 16px;">
                <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px;">
                    <div style="width: 44px; height: 44px; background: rgba(255,179,0,0.12); border-radius: 22px; display: flex; align-items: center; justify-content: center;">
                        <span style="font-size: 24px;">🛡️</span>
                    </div>
                    <div>
                        <div style="font-weight: 800; font-size: 16px; color: var(--yellow);">ADVERTENCIAS DE SEGURIDAD</div>
                    </div>
                </div>
                ${advertenciaFiscal}
                <div style="background: rgba(0,230,118,0.04); border: 1px solid rgba(0,230,118,0.12); border-radius: 14px; padding: 14px;">
                    <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 10px;">
                        <span style="font-size: 18px;">✅</span>
                        <span style="font-weight: 700; font-size: 13px; color: var(--green);">Podés continuar con la emisión</span>
                    </div>
                </div>
                <div style="margin-top: 14px; font-size: 11px; color: var(--text-3); display: flex; align-items: center; gap: 6px; justify-content: flex-end;">
                    <span>🔒</span>
                    <span>Estamos cuidando tus intereses</span>
                </div>
            </div>
        `;
        
        if (errorDiv) {
            errorDiv.innerHTML = mensajeInformativo;
            errorDiv.style.display = 'block';
            errorDiv.style.background = 'transparent';
            errorDiv.style.border = 'none';
            errorDiv.style.padding = '0';
        }
    } else {
        if (errorDiv) {
            errorDiv.style.display = 'none';
            errorDiv.innerHTML = '';
        }
    }
    
    // ========== CONTINUAR AL PASO 2 ==========
    if (btnSiguiente) {
        btnSiguiente.disabled = false;
        btnSiguiente.style.opacity = '1';
        btnSiguiente.style.cursor = 'pointer';
    }
    
    if (_lotePrevio.total === 0) {
        if (errorDiv) {
            errorDiv.innerText = 'No hay órdenes pendientes en este período';
            errorDiv.style.display = 'block';
        }
        return;
    }
    
    _pasoActualLote = 2;
    mostrarPasoConfirmacionLote();
}

// ========== RESUMEN DE CONFIRMACIÓN ==========

async function cargarResumenConfirmacionLote() {
    const confirmacionDiv = document.getElementById('loteConfirmacionResumen');
    if (!confirmacionDiv) return;
    
    if (!_lotePrevio) {
        confirmacionDiv.innerHTML = '<div style="padding: 20px; text-align: center;">Cargando resumen...</div>';
        return;
    }
    
    const desde = document.getElementById('loteFechaDesde')?.value || '';
    const hasta = document.getElementById('loteFechaHasta')?.value || '';
    
    const advertenciaImputacion = `
        <div style="background: rgba(255,179,0,0.08); border-left: 3px solid var(--yellow); padding: 10px 12px; margin-top: 14px; border-radius: 8px;">
            <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 16px;">📅</span>
                <span style="font-size: 12px; color: var(--text-2); line-height: 1.4;">
                    ${getMensajePeriodoAnterior()}
                </span>
            </div>
        </div>
    `;
    
    confirmacionDiv.innerHTML = `
        <div style="background: var(--card-2); border-radius: 12px; padding: 16px;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 12px;">
                <span style="color: var(--text-3);">Período:</span>
                <span style="font-weight: 600;">${desde} → ${hasta}</span>
            </div>
            <div style="display: flex; justify-content: space-between; margin-bottom: 12px;">
                <span style="color: var(--text-3);">Facturas a emitir:</span>
                <span style="font-weight: 700; font-size: 18px;">${_lotePrevio.total}</span>
            </div>
            <div style="display: flex; justify-content: space-between; margin-bottom: 12px;">
                <span style="color: var(--text-3);">Monto total:</span>
                <span style="font-weight: 700; font-size: 18px; color: var(--green);">${formatCurrency(_lotePrevio.montoTotal)}</span>
            </div>
            <div style="margin-top: 16px; padding-top: 12px; border-top: 1px solid rgba(255,255,255,0.1); font-size: 12px; color: var(--text-3);">
                📋 Esta acción emitirá CAE para TODAS las órdenes pendientes en el período seleccionado.
            </div>
            ${advertenciaImputacion}
        </div>
    `;
}

// ========== EMISIÓN CONFIRMADA ==========

async function emitirLoteConfirmado() {
    const desde = document.getElementById('loteFechaDesde')?.value;
    const hasta = document.getElementById('loteFechaHasta')?.value;
    const errorDiv = document.getElementById('loteError');
    
    if (!desde || !hasta) {
        if (errorDiv) {
            errorDiv.innerText = 'Completá ambas fechas';
            errorDiv.style.display = 'block';
        }
        return;
    }
    
    // Validación de límites
    const maxFacturasActivo = window._limitesConfig?.activarFacturas !== false;
    const maxMontoActivo = window._limitesConfig?.activarMonto !== false;
    const maxDiasActivo = window._limitesConfig?.activarDias !== false;
    const maxFacturas = window._limitesConfig?.maxFacturas || 20;
    const maxMonto = window._limitesConfig?.maxMonto || 1000000;
    const maxDias = window._limitesConfig?.maxDias || 90;
    
    const fechaDesde = new Date(desde);
    const fechaHasta = new Date(hasta);
    const diffDays = Math.ceil((fechaHasta - fechaDesde) / (1000 * 60 * 60 * 24));
    const diasDesdePeriodo = Math.ceil((new Date() - fechaHasta) / (1000 * 60 * 60 * 24));
    const excedeDias = maxDiasActivo && diffDays > maxDias;
    const periodoMuyAntiguo = maxDiasActivo && diasDesdePeriodo > maxDias;
    const excedeFacturas = maxFacturasActivo && _lotePrevio?.total > maxFacturas;
    const excedeMonto = maxMontoActivo && _lotePrevio?.montoTotal > maxMonto;
    
    if (excedeFacturas || excedeMonto || excedeDias || periodoMuyAntiguo) {
        let mensajeError = '⚠️ <strong>No se puede emitir el lote</strong><br><br>';
        mensajeError += 'Los siguientes límites están superados:<br>';
        if (excedeFacturas) mensajeError += `• <strong>Facturas:</strong> ${_lotePrevio.total} (máximo: ${maxFacturas})<br>`;
        if (excedeMonto) mensajeError += `• <strong>Monto total:</strong> ${formatCurrency(_lotePrevio.montoTotal)} (máximo: ${formatCurrency(maxMonto)})<br>`;
        if (excedeDias) mensajeError += `• <strong>Rango de días:</strong> ${diffDays} (máximo: ${maxDias})<br>`;
        if (periodoMuyAntiguo) mensajeError += `• <strong>Período muy antiguo:</strong> hace ${diasDesdePeriodo} días (máximo: ${maxDias} días)<br>`;
        mensajeError += '<br>📋 <strong>Para continuar, debes aumentar los límites en:</strong><br>';
        mensajeError += '&nbsp;&nbsp;&nbsp;→ <strong>Configuración</strong> → <strong>Límites para Emisión en Lote</strong>';
        
        if (errorDiv) {
            errorDiv.innerHTML = mensajeError;
            errorDiv.style.display = 'block';
            errorDiv.style.background = 'rgba(255,61,87,0.1)';
            errorDiv.style.border = '1px solid rgba(255,61,87,0.3)';
            errorDiv.style.padding = '16px';
            errorDiv.style.borderRadius = '12px';
        }
        toast('⚠️ Límites superados. Aumentalos en Configuración.', 'error');
        return;
    }
    
    // Emitir
    const btn = document.getElementById('btnEmitirLoteConfirmado');
    const originalText = btn?.innerHTML;
    if (btn) {
        btn.innerHTML = '<span class="material-icons" style="font-size:15px!important">hourglass_empty</span> Procesando...';
        btn.disabled = true;
    }
    
    if (errorDiv) errorDiv.style.display = 'none';
    
    try {
        let result;
        if (window._modoPruebaLote === true) {
            await new Promise(resolve => setTimeout(resolve, 1500));
            result = { success: true, emitidos: _lotePrevio?.total || 0, modo: 'prueba' };
            toast(`🧪 SIMULACIÓN: ${result.emitidos} comprobantes (no se emitieron realmente)`, 'info');
            cerrarModalLote();
        } else {
            const response = await fetch('/api/emitir-lote', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ desde, hasta })
            });
            result = await response.json();
            if (result.success) {
                toast(`✅ ${result.emitidos} comprobantes emitidos en lote`, 'success');
                cerrarModalLote();
                location.reload();
            } else {
                throw new Error(result.error || 'Error al emitir el lote');
            }
        }
    } catch (err) {
        if (errorDiv) {
            errorDiv.innerText = err.message;
            errorDiv.style.display = 'block';
            errorDiv.style.background = 'rgba(255,61,87,0.1)';
            errorDiv.style.border = '1px solid rgba(255,61,87,0.3)';
            errorDiv.style.padding = '12px';
            errorDiv.style.borderRadius = '10px';
        }
        volverPasoSeleccionLote();
    } finally {
        if (btn) {
            btn.innerHTML = originalText;
            btn.disabled = false;
        }
    }
}

// ========== TOGGLE MODO PRUEBA ==========

function toggleModoPruebaLote() {
    window._modoPruebaLote = !window._modoPruebaLote;
    const mensaje = window._modoPruebaLote 
        ? '🧪 Modo PRUEBA activado - NO se emitirán facturas reales'
        : '🔴 Modo REAL activado - Se emitirán facturas contra AFIP';
    toast(mensaje, window._modoPruebaLote ? 'info' : 'warn');
    console.log(`Modo lote: ${window._modoPruebaLote ? 'PRUEBA' : 'REAL'}`);
}

console.log(`🧪 Modo prueba inicial: ${window._modoPruebaLote ? 'ACTIVADO' : 'DESACTIVADO'}`);

// ==================== LÍMITES CONFIGURABLES ====================

// Cargar límites desde localStorage a inputs
function cargarLimitesLote() {
    try {
        const guardados = localStorage.getItem('koi_limites_lote');
        if (guardados) {
            const limites = JSON.parse(guardados);
            window._limitesConfig = limites;
            
            const inputFacturas = document.getElementById('cfgMaxFacturas');
            const inputMonto = document.getElementById('cfgMaxMonto');
            const inputDias = document.getElementById('cfgMaxDias');
            const switchFacturas = document.getElementById('switchLimiteFacturas');
            const switchMonto = document.getElementById('switchLimiteMonto');
            const switchDias = document.getElementById('switchLimiteDias');
            
            if (inputFacturas) inputFacturas.value = limites.maxFacturas ?? 20;
            if (inputMonto) inputMonto.value = limites.maxMonto ?? 1000000;
            if (inputDias) inputDias.value = limites.maxDias ?? 90;
            if (switchFacturas) switchFacturas.checked = limites.activarFacturas !== false;
            if (switchMonto) switchMonto.checked = limites.activarMonto !== false;
            if (switchDias) switchDias.checked = limites.activarDias !== false;
            
            if (typeof toggleLimiteFacturas === 'function') toggleLimiteFacturas(switchFacturas?.checked);
            if (typeof toggleLimiteMonto === 'function') toggleLimiteMonto(switchMonto?.checked);
            if (typeof toggleLimiteDias === 'function') toggleLimiteDias(switchDias?.checked);
            
            console.log('✅ Límites cargados:', window._limitesConfig);
        } else {
            window._limitesConfig = { 
                maxFacturas: 20, 
                maxMonto: 1000000, 
                maxDias: 90,
                activarFacturas: true,
                activarMonto: true,
                activarDias: true
            };
            if (document.getElementById('switchLimiteFacturas')) {
                document.getElementById('switchLimiteFacturas').checked = true;
                document.getElementById('switchLimiteMonto').checked = true;
                document.getElementById('switchLimiteDias').checked = true;
            }
        }
    } catch(e) {
        console.warn('Error cargando límites:', e);
    }
}

// Guardar límites (SIN TOAST - silencioso)
function guardarLimitesLote() {
    const inputFacturas = document.getElementById('cfgMaxFacturas');
    const inputMonto = document.getElementById('cfgMaxMonto');
    const inputDias = document.getElementById('cfgMaxDias');
    const switchFacturas = document.getElementById('switchLimiteFacturas');
    const switchMonto = document.getElementById('switchLimiteMonto');
    const switchDias = document.getElementById('switchLimiteDias');
    
    const maxFacturas = parseInt(inputFacturas?.value) || 20;
    const maxMonto = parseFloat(inputMonto?.value) || 1000000;
    const maxDias = parseInt(inputDias?.value) || 90;
    const activarFacturas = switchFacturas?.checked ?? true;
    const activarMonto = switchMonto?.checked ?? true;
    const activarDias = switchDias?.checked ?? true;
    
    if (activarFacturas && (maxFacturas < 1 || maxFacturas > 500)) {
        toast('El máximo de facturas debe estar entre 1 y 500', 'error');
        return;
    }
    if (activarMonto && maxMonto < 0) {
        toast('El monto máximo no puede ser negativo', 'error');
        return;
    }
    if (activarDias && (maxDias < 1 || maxDias > 365)) {
        toast('Los días máximos deben estar entre 1 y 365', 'error');
        return;
    }
    
    window._limitesConfig = { maxFacturas, maxMonto, maxDias, activarFacturas, activarMonto, activarDias };
    localStorage.setItem('koi_limites_lote', JSON.stringify(window._limitesConfig));
    
    console.log('✅ Límites guardados:', window._limitesConfig);
}

// Auto-guardado silencioso
function initAutoGuardadoLimites() {
    const inputs = ['cfgMaxFacturas', 'cfgMaxMonto', 'cfgMaxDias'];
    inputs.forEach(id => {
        const input = document.getElementById(id);
        if (input) {
            input.removeEventListener('input', guardarLimitesLote);
            input.addEventListener('input', guardarLimitesLote);
            input.removeEventListener('change', guardarLimitesLote);
            input.addEventListener('change', guardarLimitesLote);
        }
    });
    
    const switches = ['switchLimiteFacturas', 'switchLimiteMonto', 'switchLimiteDias'];
    switches.forEach(id => {
        const sw = document.getElementById(id);
        if (sw) {
            sw.removeEventListener('change', guardarLimitesLote);
            sw.addEventListener('change', guardarLimitesLote);
        }
    });
    
    console.log('✅ Auto-guardado silencioso de límites configurado');
}

// ========== TOGGLE DE LÍMITES ==========

function toggleLimiteFacturas(activado) {
    const campo = document.getElementById('campoMaxFacturas');
    if (campo) {
        campo.style.opacity = activado ? '1' : '0.5';
        const input = document.getElementById('cfgMaxFacturas');
        if (input) input.disabled = !activado;
    }
}

function toggleLimiteMonto(activado) {
    const campo = document.getElementById('campoMaxMonto');
    if (campo) {
        campo.style.opacity = activado ? '1' : '0.5';
        const input = document.getElementById('cfgMaxMonto');
        if (input) input.disabled = !activado;
    }
}

function toggleLimiteDias(activado) {
    const campo = document.getElementById('campoMaxDias');
    if (campo) {
        campo.style.opacity = activado ? '1' : '0.5';
        const input = document.getElementById('cfgMaxDias');
        if (input) input.disabled = !activado;
    }
}

// Inicializar límites
cargarLimitesLote();
// ========== ONBOARDING POST-LOGIN (NUEVO - SIN ROMPER EXISTENTE) ==========

// Función para verificar si el usuario tiene tiendas conectadas
async function verificarTiendasConectadas() {
    console.log('🔍 Verificando tiendas conectadas...');
    try {
        const res = await fetch('/api/integrations', { 
            method: 'GET',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' }
        });
        
        if (!res.ok) {
            console.error('Error en /api/integrations:', res.status);
            return false;
        }
        
        const data = await res.json();
        const integraciones = data.integrations || [];
        console.log('📦 Integraciones encontradas:', integraciones.length);
        return integraciones.length > 0;
    } catch (err) {
        console.error('❌ Error al verificar tiendas:', err);
        return false;
    }
}

// Función para mostrar onboarding (solo si no tiene tiendas)
async function mostrarPantallaOnboardingSiNecesario() {
    console.log('🔄 Verificando si mostrar onboarding...');
    
    const tieneTiendas = await verificarTiendasConectadas();
    
    if (!tieneTiendas) {
        console.log('🚀 Usuario sin tiendas → Mostrando onboarding');
        
        // Ocultar todas las vistas
        document.querySelectorAll('.content').forEach(v => v.style.display = 'none');
        
        // Mostrar vista negocio
        const vistaNegocio = document.getElementById('vista-negocio');
        if (vistaNegocio) vistaNegocio.style.display = 'block';
        
        // Mostrar versión onboarding, ocultar versión normal
        const onboardingDiv = document.getElementById('onboardingNegocio');
        const normalDiv = document.getElementById('negocioNormal');
        
        if (onboardingDiv) onboardingDiv.style.display = 'block';
        if (normalDiv) normalDiv.style.display = 'none';
        
        // Configurar botón continuar (deshabilitado hasta conectar)
        const btnContinuar = document.getElementById('btnContinuarOnboarding');
        if (btnContinuar) {
            btnContinuar.disabled = true;
            btnContinuar.style.opacity = '0.4';
            btnContinuar.onclick = () => {
                console.log('➡️ Continuar a ARCA');
                mostrarVista('arca');
            };
        }
        
        // Configurar botón más tarde
        const btnMasTarde = document.getElementById('btnConfigurarMasTarde');
        if (btnMasTarde) {
            btnMasTarde.onclick = () => {
                console.log('⏰ Configurar más tarde');
                mostrarVista('dashboard');
            };
        }
        
        // Cargar nombre del usuario
        try {
            const res = await fetch('/api/me', { credentials: 'include' });
            const data = await res.json();
            const userNameSpan = document.getElementById('onboardingUserName');
            if (userNameSpan && data.user) {
                userNameSpan.textContent = data.user.nombre?.split(' ')[0] || data.user.email?.split('@')[0] || 'usuario';
            }
        } catch(e) {
            console.error('Error cargando nombre:', e);
        }
        
        // Escuchar conexiones exitosas para habilitar continuar
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'childList' || mutation.type === 'characterData') {
                    const conectados = document.querySelectorAll('[id^="onboarding-desc-"]');
                    let algunaConectada = false;
                    conectados.forEach(desc => {
                        if (desc.innerHTML.includes('✓ Conectado')) algunaConectada = true;
                    });
                    if (algunaConectada && btnContinuar) {
                        btnContinuar.disabled = false;
                        btnContinuar.style.opacity = '1';
                        observer.disconnect();
                    }
                }
            });
        });
        observer.observe(document.body, { childList: true, subtree: true, characterData: true });
        
    } else {
        console.log('✅ Usuario ya tiene tiendas → No mostrar onboarding');
    }
}
// ========== FUNCIÓN DE ONBOARDING AUTOMÁTICO ==========
async function mostrarOnboardingSiNecesario() {
    console.log('🔍 Verificando si mostrar onboarding...');
    
    try {
        const res = await fetch('/api/integrations', { credentials: 'include' });
        const data = await res.json();
        const integraciones = data.integrations || [];
        
        if (integraciones.length === 0) {
            console.log('🚀 Usuario sin tiendas → Mostrando onboarding');
            
            const onboardingDiv = document.getElementById('onboardingNegocio');
            const normalDiv = document.getElementById('negocioNormal');
            const vistaNegocio = document.getElementById('vista-negocio');
            
            // Ocultar todas las vistas
            document.querySelectorAll('.content').forEach(v => v.style.display = 'none');
            
            if (vistaNegocio) vistaNegocio.style.display = 'block';
            if (onboardingDiv) onboardingDiv.style.display = 'block';
            if (normalDiv) normalDiv.style.display = 'none';
            
            // Cargar nombre del usuario
            try {
                const userRes = await fetch('/api/me', { credentials: 'include' });
                const userData = await userRes.json();
                const userNameSpan = document.getElementById('onboardingUserName');
                if (userNameSpan && userData.user) {
                    userNameSpan.textContent = userData.user.nombre?.split(' ')[0] || userData.user.email?.split('@')[0] || 'usuario';
                }
            } catch(e) {
                console.error('Error cargando nombre:', e);
            }
        } else {
            console.log('✅ Usuario con', integraciones.length, 'tienda(s), no mostrar onboarding');
        }
    } catch(err) {
        console.error('Error verificando integraciones:', err);
    }
}
// ========== TOGGLE CATEGORÍA  ==========
function toggleCategoriaField() {
    const condicionSelect = document.getElementById('cfgCondicionFiscal2');
    const categoriaGroup = document.getElementById('categoriaGroup2');
    
    if (condicionSelect && categoriaGroup) {
        const esMonotributo = condicionSelect.value === 'monotributo';
        categoriaGroup.style.display = esMonotributo ? 'block' : 'none';
    }
}
// ============================================================
//  ARCA - KOI Comunicación (Unificada con cancelación)
// ============================================================

// Variable para saber si ya se guardó la fecha (solo una vez)
let _fechaVinculacionGuardada = localStorage.getItem('koi_fecha_vinculacion_arca') !== null;

async function cargarEstadoARCA() {
    console.log('🔄 KOI: Cargando estado ARCA...');
    
    try {
        const res = await fetch('/api/me/arca-status', { 
            credentials: 'include',
            cache: 'no-cache',
            headers: { 'Cache-Control': 'no-cache' }
        });
        const data = await res.json();
        
        console.log('📊 Estado ARCA recibido:', data);
        
        // 👇 GUARDAR FECHA DE VINCULACIÓN (localStorage + MongoDB)
        if (data.ok && data.conectada && data.status === 'vinculado' && !_fechaVinculacionGuardada) {
            const fechaVinculacion = new Date().toISOString();
            
            // 1. Guardar en localStorage (backup rápido)
            localStorage.setItem('koi_fecha_vinculacion_arca', fechaVinculacion);
            console.log('✅ Fecha guardada en localStorage:', new Date(fechaVinculacion).toLocaleString());
            
            // 2. Guardar en MongoDB (persistente)
            try {
                const updateRes = await fetch('/api/me/settings', {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ 
                        fechaVinculacionARCA: fechaVinculacion 
                    })
                });
                
                if (updateRes.ok) {
                    console.log('✅ Fecha guardada en MongoDB');
                } else {
                    const errorData = await updateRes.json();
                    console.warn('⚠️ Error guardando en MongoDB:', errorData);
                }
            } catch(e) {
                console.warn('⚠️ No se pudo guardar en MongoDB:', e.message);
            }
            
            _fechaVinculacionGuardada = true;
        }
        
        if (data.ok) {
            const conectada = data.conectada;
            const tieneCUIT = data.tieneCUIT;
            const tieneClave = data.tieneClave;
            const status = data.status;
            const cuit = data.cuit || '';
            
            // Elementos DOM
            const statusDot = document.getElementById('arcaStatusDot');
            const statusText = document.getElementById('arcaStatusText');
            const btnContainer = document.getElementById('arcaButtonContainer');
            const cuitInput = document.getElementById('arcaCuit');
            const claveInput = document.getElementById('arcaClave');
            const mensajeDiv = document.getElementById('arcaMensaje');
            const progressDiv = document.getElementById('arcaProgress');
            
            // Mostrar CUIT si existe
            if (cuitInput && cuit) {
                cuitInput.value = cuit;
            }
            
            // 🔗 CASO 3: Vinculado (ARCA conectada)
            if (conectada) {
                console.log('✅ Estado: VINCULADO');
                if (statusDot) statusDot.className = 'status-dot vinculado';
                if (statusText) statusText.innerHTML = '<i class="fas fa-check-circle"></i> ARCA activa';
                
                if (btnContainer) {
                    btnContainer.innerHTML = `
                        <button class="btn-arca-sync" id="btnDesconectarArca" 
                                style="background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.3); color: #F87171;">
                            <i class="fas fa-unlink"></i> Desconectar ARCA
                        </button>
                    `;
                    const btn = document.getElementById('btnDesconectarArca');
                    if (btn) btn.addEventListener('click', desconectarArca);
                }
                
                if (cuitInput) {
                    cuitInput.disabled = true;
                }
                if (claveInput) {
                    claveInput.value = '';
                    claveInput.disabled = true;
                }
                if (mensajeDiv) {
                    mensajeDiv.style.display = 'flex';
                    mensajeDiv.className = 'arca-mensaje success';
                    mensajeDiv.innerHTML = `
                        <i class="fas fa-rocket"></i>
                        <div style="flex:1">
                            <strong>🚀 ¡ARCA vinculada!</strong><br>
                            Ahora podés emitir y enviar comprobantes automáticamente. Todo funciona solo.
                        </div>
                    `;
                }
                if (progressDiv) progressDiv.style.display = 'none';
            }
            // 🧠 CASO 2: Datos enviados pero aún no vinculado (PROCESANDO)
            else if (tieneCUIT && tieneClave && status !== 'vinculado') {
                console.log('⏳ Estado: PROCESANDO');
                if (statusDot) statusDot.className = 'status-dot procesando';
                if (statusText) statusText.innerHTML = '<i class="fas fa-clock"></i> En revisión';
                
                // Botón de cancelación habilitado + botón deshabilitado
                if (btnContainer) {
                    btnContainer.innerHTML = `
                        <button class="btn-arca-sync" id="btnCancelarSolicitud" 
                                style="background: rgba(255, 179, 0, 0.15); border: 1px solid rgba(255, 179, 0, 0.3); color: #F5A623; margin-bottom: 10px;">
                            <i class="fas fa-times-circle"></i> Cancelar solicitud
                        </button>
                        <button class="btn-arca-sync" id="btnDatosEnviados" disabled
                                style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: var(--text-3); opacity: 0.6;">
                            <i class="fas fa-check-circle"></i> Datos enviados
                        </button>
                    `;
                    const btn = document.getElementById('btnCancelarSolicitud');
                    if (btn) btn.addEventListener('click', cancelarSolicitudARCA);
                }
                
                if (cuitInput) cuitInput.disabled = true;
                if (claveInput) claveInput.disabled = true;
                if (mensajeDiv) {
                    mensajeDiv.style.display = 'flex';
                    mensajeDiv.className = 'arca-mensaje info';
                    mensajeDiv.innerHTML = `
                        <i class="fas fa-brain"></i>
                        <div style="flex:1">
                            <strong>🧠 KOI recibió tus datos</strong><br>
                            Estamos validando tu información con ARCA. El proceso puede tomar hasta <strong>24 horas</strong>.<br>
                            <span style="color: #F5A623; font-size: 12px; display: inline-block; margin-top: 8px;">
                                <i class="fas fa-info-circle"></i> ¿Te equivocaste? Podés cancelar y volver a intentar.
                            </span>
                        </div>
                        <div class="mensaje-spinner"></div>
                    `;
                }
                if (progressDiv) progressDiv.style.display = 'none';
            }
            // 🐟 CASO 1: Sin datos - Invitación a conectar
            else {
                console.log('📝 Estado: PENDIENTE');
                if (statusDot) statusDot.className = 'status-dot pendiente';
                if (statusText) statusText.innerHTML = '<i class="fas fa-plug"></i> Listo para conectar';
                
                if (btnContainer) {
                    btnContainer.innerHTML = `
                        <button class="btn-arca-sync" id="btnArcaSync">
                            <i class="fas fa-sync-alt"></i> Sincronizar con ARCA
                        </button>
                    `;
                    const btn = document.getElementById('btnArcaSync');
                    if (btn) btn.addEventListener('click', iniciarSyncArca);
                }
                
                if (cuitInput) {
                    cuitInput.disabled = false;
                    cuitInput.value = '';
                }
                if (claveInput) {
                    claveInput.disabled = false;
                    claveInput.value = '';
                }
                if (mensajeDiv) {
                    mensajeDiv.style.display = 'flex';
                    mensajeDiv.className = 'arca-mensaje warning';
                    mensajeDiv.innerHTML = `
                        <i class="fas fa-fish"></i>
                        <div style="flex:1">
                            <strong>🐟 Conectá tu cuenta de ARCA</strong><br>
                            Ingresá tu CUIT y Clave Fiscal. KOI se encarga de todo el proceso de vinculación.
                        </div>
                    `;
                }
                if (progressDiv) progressDiv.style.display = 'none';
            }
        }
    } catch (error) {
        console.error('❌ KOI Error:', error);
        // Mostrar estado de error
        const statusDot = document.getElementById('arcaStatusDot');
        const statusText = document.getElementById('arcaStatusText');
        if (statusDot) statusDot.className = 'status-dot offline';
        if (statusText) statusText.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Error de conexión';
    }
}
// ============================================================
//  CANCELAR SOLICITUD ARCA (CASO 2 -> vuelve a CASO 1)
// ============================================================

async function cancelarSolicitudARCA() {
    console.log('❌ Cancelando solicitud ARCA...');
    
    const confirmar = confirm('⚠️ ¿Cancelar la solicitud de vinculación?\n\nSe eliminarán tu CUIT y Clave Fiscal. Podrás volver a ingresarlos cuando quieras.');
    
    if (!confirmar) return;
    
    const btn = document.getElementById('btnCancelarSolicitud');
    const textoOriginal = btn ? btn.innerHTML : '';
    
    try {
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-pulse"></i> Cancelando...';
        }
        
        // Eliminar CUIT y Clave Fiscal
        await fetch('/api/me/settings', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ cuit: '' })
        });
        
        await fetch('/api/me/settings', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ arcaClave: '' })
        });
        
        // También llamar al endpoint de desconexión por si acaso
        await fetch('/api/me/desconectar-arca', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include'
        });
        
        console.log('✅ Solicitud cancelada correctamente');
        
        // Recargar estado (volverá al CASO 1)
        await cargarEstadoARCA();
        
        // Mostrar mensaje de éxito
        const mensajeDiv = document.getElementById('arcaMensaje');
        if (mensajeDiv) {
            mensajeDiv.style.display = 'flex';
            mensajeDiv.className = 'arca-mensaje success';
            mensajeDiv.innerHTML = `
                <i class="fas fa-check-circle"></i>
                <div style="flex:1">
                    <strong>✅ Solicitud cancelada</strong><br>
                    Podés volver a ingresar tus datos cuando quieras.
                </div>
            `;
            setTimeout(() => {
                cargarEstadoARCA();
            }, 3000);
        }
        
    } catch (error) {
        console.error('❌ Error al cancelar:', error);
        const mensajeDiv = document.getElementById('arcaMensaje');
        if (mensajeDiv) {
            mensajeDiv.style.display = 'flex';
            mensajeDiv.className = 'arca-mensaje error';
            mensajeDiv.innerHTML = `
                <i class="fas fa-exclamation-circle"></i>
                <div style="flex:1">
                    <strong>❌ Error al cancelar</strong><br>
                    ${error.message}. Por favor intentá de nuevo.
                </div>
            `;
        }
        await cargarEstadoARCA();
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = textoOriginal;
        }
    }
}

// ============================================================
//  DESCONECTAR ARCA (CASO 3 -> vuelve a CASO 1)
// ============================================================

async function desconectarArca() {
    console.log('🔓 Desconectando ARCA...');
    
    const confirmar = confirm('⚠️ ¿Estás seguro que querés desconectar ARCA?\n\nSe eliminarán tu CUIT y Clave Fiscal guardados. Podrás volver a conectarte cuando quieras.');
    
    if (!confirmar) return;
    
    const btn = document.getElementById('btnDesconectarArca');
    const textoOriginal = btn ? btn.innerHTML : '';
    
    try {
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-pulse"></i> Desconectando...';
        }
        
        const response = await fetch('/api/me/desconectar-arca', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include'
        });
        
        const data = await response.json();
        
        if (data.ok) {
            console.log('✅ ARCA desconectada correctamente');
            
            // Recargar estado (volverá al CASO 1)
            await cargarEstadoARCA();
            
            const mensajeDiv = document.getElementById('arcaMensaje');
            if (mensajeDiv) {
                mensajeDiv.style.display = 'flex';
                mensajeDiv.className = 'arca-mensaje success';
                mensajeDiv.innerHTML = `
                    <i class="fas fa-check-circle"></i>
                    <div style="flex:1">
                        <strong>✅ ARCA desconectada</strong><br>
                        Podés volver a conectar tu cuenta cuando quieras.
                    </div>
                `;
            }
        } else {
            throw new Error(data.error || 'Error al desconectar');
        }
    } catch (error) {
        console.error('❌ Error al desconectar ARCA:', error);
        const mensajeDiv = document.getElementById('arcaMensaje');
        if (mensajeDiv) {
            mensajeDiv.style.display = 'flex';
            mensajeDiv.className = 'arca-mensaje error';
            mensajeDiv.innerHTML = `
                <i class="fas fa-exclamation-circle"></i>
                <div style="flex:1">
                    <strong>❌ Error al desconectar</strong><br>
                    ${error.message}. Por favor intentá de nuevo.
                </div>
            `;
        }
        await cargarEstadoARCA();
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = textoOriginal;
        }
    }
}

// ============================================================
//  SINCRONIZAR / CONECTAR ARCA (CASO 1 -> pasa a CASO 2)
// ============================================================

async function iniciarSyncArca() {
    const cuitInput = document.getElementById('arcaCuit');
    const claveInput = document.getElementById('arcaClave');
    const cuit = cuitInput?.value.trim();
    const clave = claveInput?.value;
    
    if (!cuit) {
        mostrarMensaje('Por favor ingresa tu CUIT', 'warning');
        return;
    }
    
    if (!clave) {
        mostrarMensaje('Por favor ingresa tu Clave Fiscal', 'warning');
        return;
    }
    
    const cuitLimpio = cuit.replace(/\D/g, '');
    if (cuitLimpio.length !== 11) {
        mostrarMensaje('El CUIT debe tener 11 dígitos', 'warning');
        return;
    }
    
    const btnContainer = document.getElementById('arcaButtonContainer');
    if (btnContainer) {
        btnContainer.innerHTML = `
            <button class="btn-arca-sync" disabled style="opacity: 0.6;">
                <i class="fas fa-spinner fa-pulse"></i> Enviando datos...
            </button>
        `;
    }
    
    try {
        // Guardar CUIT
        await fetch('/api/me/settings', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ cuit: cuitLimpio })
        });
        
        // Guardar Clave Fiscal
        await fetch('/api/me/settings', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ arcaClave: clave })
        });
        
        mostrarMensaje('✅ Datos enviados correctamente. KOI comenzará el proceso de vinculación.', 'success');
        
        // Recargar estado (pasará a CASO 2 - Procesando)
        setTimeout(() => {
            cargarEstadoARCA();
        }, 1000);
        
    } catch (error) {
        console.error('Error:', error);
        mostrarMensaje('❌ Error al enviar los datos. Por favor intentá de nuevo.', 'error');
        cargarEstadoARCA();
    }
}

// ============================================================
//  MOSTRAR MENSAJE (helper)
// ============================================================

function mostrarMensaje(mensaje, tipo) {
    const mensajeDiv = document.getElementById('arcaMensaje');
    if (!mensajeDiv) {
        if (typeof toast === 'function') {
            toast(mensaje, tipo);
        } else {
            alert(mensaje);
        }
        return;
    }
    
    mensajeDiv.style.display = 'flex';
    mensajeDiv.className = `arca-mensaje ${tipo}`;
    mensajeDiv.innerHTML = `<i class="fas ${tipo === 'success' ? 'fa-check-circle' : (tipo === 'error' ? 'fa-exclamation-circle' : 'fa-info-circle')}"></i> ${mensaje}`;
    
    setTimeout(() => {
        if (mensajeDiv.innerHTML.includes(mensaje)) {
            cargarEstadoARCA();
        }
    }, 5000);
}

// ============================================================
//  CONFIGURAR BOTÓN ARCA (gestión de eventos unificada)
// ============================================================

function configurarBotonArca() {
    // Esta función ya no es necesaria porque los eventos se asignan
    // directamente en cargarEstadoARCA() al crear los botones.
    // Se mantiene por compatibilidad.
    console.log('🔧 configurarBotonArca() llamado - los eventos se manejan en cargarEstadoARCA()');
    return true;
}

// ============================================================
//  INICIALIZACIÓN DE LA VISTA ARCA
// ============================================================

function initVistaArca() {
    console.log('🔧 initVistaArca() ejecutándose');
    
    const vistaArca = document.getElementById('vista-arca');
    if (!vistaArca) {
        console.log('❌ No se encontró #vista-arca');
        return;
    }
    
    // Cargar estado inmediatamente si está visible
    if (vistaArca.style.display !== 'none') {
        console.log('👁️ Vista ARCA visible, cargando estado...');
        cargarEstadoARCA();
    } else {
        console.log('👁️ Vista ARCA oculta, se cargará cuando se muestre');
    }
    
    // Observar cambios de visibilidad
    const observer = new MutationObserver(() => {
        if (vistaArca.style.display !== 'none') {
            console.log('👁️ Vista ARCA se hizo visible, cargando estado...');
            cargarEstadoARCA();
        }
    });
    
    observer.observe(vistaArca, { attributes: true });
    console.log('✅ Observer configurado');
}

// ============================================================
//  INICIALIZACIÓN GLOBAL
// ============================================================

// Solo inicializar una vez
let arcaInicializado = false;

document.addEventListener('DOMContentLoaded', () => {
    if (arcaInicializado) return;
    arcaInicializado = true;
    
    console.log('🚀 DOM listo, inicializando ARCA...');
    setTimeout(() => {
        initVistaArca();
        
        // Detectar cambios de pestaña en el sidebar
        const tabs = document.querySelectorAll('.nav-item');
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                setTimeout(() => {
                    const vistaArca = document.getElementById('vista-arca');
                    if (vistaArca && vistaArca.style.display !== 'none') {
                        cargarEstadoARCA();
                    }
                }, 150);
            });
        });
    }, 500);
});
// ============================================================
//  ONBOARDING ARCA (VERSIÓN COMPLETA Y CORREGIDA)
// ============================================================

// Asegurar que el contenedor de botones existe
function asegurarContenedorBotonesArca() {
  let container = document.getElementById('onboardingArcaButtonContainer');
  if (!container) {
    console.log('📦 Creando contenedor de botones ARCA...');
    const arcaCard = document.querySelector('#onboardingArca .arca-card');
    if (arcaCard) {
      container = document.createElement('div');
      container.id = 'onboardingArcaButtonContainer';
      container.style.marginTop = '16px';
      
      const mensajeDiv = document.getElementById('onboardingArcaMensaje');
      if (mensajeDiv) {
        arcaCard.insertBefore(container, mensajeDiv);
      } else {
        arcaCard.appendChild(container);
      }
      console.log('✅ Contenedor de botones creado');
    }
  }
  return container;
}

// Mostrar onboarding de ARCA (tiene tiendas, falta ARCA)
function mostrarOnboardingArca() {
  console.log('🔄 Mostrando onboarding ARCA...');
  
  const onboardingTiendas = document.getElementById('onboardingNegocio');
  const onboardingArca = document.getElementById('onboardingArca');
  const negocioNormal = document.getElementById('negocioNormal');
  const vistaNegocio = document.getElementById('vista-negocio');
  
  // Ocultar todas las otras vistas
  document.querySelectorAll('.content').forEach(v => v.style.display = 'none');
  
  // Mostrar SOLO la vista negocio con onboarding ARCA
  if (vistaNegocio) vistaNegocio.style.display = 'block';
  if (onboardingArca) onboardingArca.style.display = 'block';
  if (onboardingTiendas) onboardingTiendas.style.display = 'none';
  if (negocioNormal) negocioNormal.style.display = 'none';
  
  // Asegurar que el contenedor de botones existe
  asegurarContenedorBotonesArca();
  
  // Scroll automático al onboarding ARCA
  setTimeout(() => {
    if (onboardingArca) {
      onboardingArca.scrollIntoView({ behavior: 'smooth', block: 'start' });
      window.scrollTo({ top: 0, behavior: 'smooth' });
      console.log('📜 Scroll al onboarding ARCA');
    }
  }, 100);
  
  // Configurar eventos
  configurarOnboardingArca();
  
  // Cargar estado actual
  cargarEstadoOnboardingArca();
}

// Cargar estado actual del onboarding ARCA
async function cargarEstadoOnboardingArca() {
  try {
    const res = await fetch('/api/me/arca-status', { 
      credentials: 'include',
      cache: 'no-cache'
    });
    const estado = await res.json();
    
    console.log('📊 Estado ARCA en onboarding:', estado);
    
    if (estado.ok && estado.conectada) {
      mostrarEstadoCompletadoOnboardingArca();
    } else if (estado.tieneCUIT && estado.tieneClave && estado.status !== 'vinculado') {
      console.log('⏳ Onboarding ARCA: datos enviados, esperando vinculación manual');
      
      const cuitInput = document.getElementById('onboardingArcaCuit');
      if (cuitInput && estado.cuit) {
        cuitInput.value = estado.cuit;
      }
      
      mostrarEstadoProcesandoOnboardingArca();
    } else {
      restaurarOnboardingArcaInicial();
    }
  } catch (error) {
    console.error('Error cargando estado onboarding ARCA:', error);
  }
}

// Configurar eventos del onboarding ARCA
function configurarOnboardingArca() {
  console.log('🔧 Configurando eventos del onboarding ARCA...');
  
  asegurarContenedorBotonesArca();
  
  const btnContainer = document.getElementById('onboardingArcaButtonContainer');
  const btnMasTarde = document.getElementById('btnOnboardingArcaMasTarde');
  const btnContinuar = document.getElementById('btnOnboardingArcaContinuar');
  
  if (btnContainer) {
    let syncBtn = document.getElementById('btnOnboardingArcaSync');
    
    if (!syncBtn) {
      btnContainer.innerHTML = `
        <button id="btnOnboardingArcaSync" class="btn-arca-sync" style="width: 100%; padding: 12px; background: linear-gradient(135deg, #a855f7, #7c3aed); color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: 700; display: flex; align-items: center; justify-content: center; gap: 8px;">
          <span class="material-icons" style="font-size: 16px;">sync</span>
          Sincronizar con ARCA
        </button>
      `;
      syncBtn = document.getElementById('btnOnboardingArcaSync');
      console.log('✅ Botón sincronizar creado');
    }
    
    if (syncBtn) {
      const newSyncBtn = syncBtn.cloneNode(true);
      syncBtn.parentNode.replaceChild(newSyncBtn, syncBtn);
      
      newSyncBtn.onclick = async function() {
        console.log('🖱️ Botón ONBOARDING ARCA clickeado');
        
        const cuitInput = document.getElementById('onboardingArcaCuit');
        const claveInput = document.getElementById('onboardingArcaClave');
        
        const cuit = cuitInput?.value.trim();
        const clave = claveInput?.value;
        
        if (!cuit) {
          mostrarMensajeOnboardingArca('Por favor ingresa tu CUIT', 'warning');
          return;
        }
        
        if (!clave) {
          mostrarMensajeOnboardingArca('Por favor ingresa tu Clave Fiscal', 'warning');
          return;
        }
        
        const cuitLimpio = cuit.replace(/\D/g, '');
        if (cuitLimpio.length !== 11) {
          mostrarMensajeOnboardingArca('El CUIT debe tener 11 dígitos', 'warning');
          return;
        }
        
        this.disabled = true;
        this.innerHTML = '<span class="material-icons" style="font-size:16px!important">hourglass_empty</span> Enviando...';
        
        try {
          await fetch('/api/me/settings', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ cuit: cuitLimpio })
          });
          
          await fetch('/api/me/settings', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ arcaClave: clave })
          });
          
          console.log('✅ Datos guardados correctamente');
          mostrarEstadoProcesandoOnboardingArca();
          
        } catch (error) {
          console.error('Error:', error);
          mostrarMensajeOnboardingArca('❌ Error al enviar los datos', 'error');
          this.disabled = false;
          this.innerHTML = '<span class="material-icons" style="font-size:16px!important">sync</span> Sincronizar con ARCA';
        }
      };
      console.log('✅ Evento onclick asignado');
    }
  }
  
  if (btnMasTarde) {
    const newBtn = btnMasTarde.cloneNode(true);
    btnMasTarde.parentNode.replaceChild(newBtn, btnMasTarde);
    newBtn.onclick = () => mostrarVista('dashboard');
    console.log('✅ Botón "Configurar más tarde" configurado');
  }
  
  if (btnContinuar) {
    btnContinuar.textContent = 'Continuar →';
    const newBtn = btnContinuar.cloneNode(true);
    btnContinuar.parentNode.replaceChild(newBtn, btnContinuar);
    newBtn.onclick = () => mostrarVista('dashboard');
    console.log('✅ Botón "Continuar" configurado');
  }
}

// Mostrar estado "PROCESANDO" en el onboarding ARCA
function mostrarEstadoProcesandoOnboardingArca() {
  console.log('⏳ Mostrando estado PROCESANDO en onboarding ARCA');
  
  const cuitInput = document.getElementById('onboardingArcaCuit');
  const claveInput = document.getElementById('onboardingArcaClave');
  const btnContainer = document.getElementById('onboardingArcaButtonContainer');
  const mensajeDiv = document.getElementById('onboardingArcaMensaje');
  const btnContinuar = document.getElementById('btnOnboardingArcaContinuar');
  
  if (cuitInput) cuitInput.disabled = true;
  if (claveInput) claveInput.disabled = true;
  
  if (btnContinuar) {
    btnContinuar.disabled = true;
    btnContinuar.style.opacity = '0.5';
    btnContinuar.style.cursor = 'not-allowed';
  }
  
  if (btnContainer) {
    btnContainer.innerHTML = `
      <button id="btnCancelarSolicitudOnboarding" class="btn-arca-sync" 
              style="background: rgba(255, 179, 0, 0.15); border: 1px solid rgba(255, 179, 0, 0.3); color: #F5A623; margin-bottom: 10px; width: 100%; padding: 12px; border-radius: 8px; cursor: pointer; font-weight: 700;">
        <i class="fas fa-times-circle"></i> Cancelar solicitud
      </button>
      <button id="btnDatosEnviadosOnboarding" class="btn-arca-sync" disabled
              style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: #888; opacity: 0.6; width: 100%; padding: 12px; border-radius: 8px;">
        <i class="fas fa-check-circle"></i> Datos enviados
      </button>
    `;
    
    const cancelBtn = document.getElementById('btnCancelarSolicitudOnboarding');
    if (cancelBtn) cancelBtn.onclick = () => cancelarSolicitudOnboardingArca();
  }
  
  if (mensajeDiv) {
    mensajeDiv.style.display = 'block';
    mensajeDiv.className = 'arca-mensaje info';
    mensajeDiv.innerHTML = `
      <i class="fas fa-brain"></i>
      <div style="flex:1">
        <strong>🧠 KOI recibió tus datos</strong><br>
        Estamos validando tu información con ARCA. El proceso puede tomar hasta <strong>24 horas</strong>.<br>
        <span style="color: #F5A623; font-size: 12px; display: inline-block; margin-top: 8px;">
          <i class="fas fa-info-circle"></i> ¿Te equivocaste? Podés <strong id="cancelarOnboardingLink" style="cursor:pointer;text-decoration:underline;">cancelar y volver a intentar</strong>.
        </span>
      </div>
      <div class="mensaje-spinner"></div>
    `;
    
    const cancelLink = document.getElementById('cancelarOnboardingLink');
    if (cancelLink) cancelLink.onclick = () => cancelarSolicitudOnboardingArca();
  }
}

// Mostrar estado "COMPLETADO" en el onboarding ARCA
function mostrarEstadoCompletadoOnboardingArca() {
  console.log('✅ Mostrando estado COMPLETADO en onboarding ARCA');
  
  const cuitInput = document.getElementById('onboardingArcaCuit');
  const claveInput = document.getElementById('onboardingArcaClave');
  const btnContainer = document.getElementById('onboardingArcaButtonContainer');
  const mensajeDiv = document.getElementById('onboardingArcaMensaje');
  const btnContinuar = document.getElementById('btnOnboardingArcaContinuar');
  
  if (cuitInput) cuitInput.disabled = true;
  if (claveInput) claveInput.disabled = true;
  if (btnContainer) btnContainer.innerHTML = '';
  
  if (btnContinuar) {
    btnContinuar.disabled = false;
    btnContinuar.style.opacity = '1';
    btnContinuar.style.cursor = 'pointer';
    btnContinuar.style.background = '#00e676';
    btnContinuar.style.color = '#0a0e1a';
    btnContinuar.textContent = 'Continuar →';
  }
  
  if (mensajeDiv) {
    mensajeDiv.style.display = 'block';
    mensajeDiv.className = 'arca-mensaje success';
    mensajeDiv.innerHTML = `
      <i class="fas fa-check-circle"></i>
      <div style="flex:1">
        <strong>✅ ARCA vinculada correctamente</strong><br>
        Tu cuenta ya está autorizada para emitir comprobantes electrónicos.<br>
        ¡Ya podés comenzar a facturar!
      </div>
    `;
  }
}

// Cancelar solicitud desde onboarding ARCA
async function cancelarSolicitudOnboardingArca() {
  console.log('❌ Cancelando solicitud ARCA desde onboarding...');
  
  const confirmar = confirm('⚠️ ¿Cancelar la solicitud de vinculación?\n\nSe eliminarán tu CUIT y Clave Fiscal. Podrás volver a ingresarlos cuando quieras.');
  if (!confirmar) return;
  
  try {
    const cancelBtn = document.getElementById('btnCancelarSolicitudOnboarding');
    if (cancelBtn) {
      cancelBtn.disabled = true;
      cancelBtn.innerHTML = '<i class="fas fa-spinner fa-pulse"></i> Cancelando...';
    }
    
    await fetch('/api/me/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ cuit: '' })
    });
    
    await fetch('/api/me/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ arcaClave: '' })
    });
    
    await fetch('/api/me/desconectar-arca', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include'
    });
    
    console.log('✅ Solicitud cancelada correctamente');
    restaurarOnboardingArcaInicial();
    
  } catch (error) {
    console.error('❌ Error al cancelar:', error);
    mostrarMensajeOnboardingArca('❌ Error al cancelar la solicitud', 'error');
  }
}

// Restaurar onboarding ARCA a estado inicial
function restaurarOnboardingArcaInicial() {
  console.log('🔄 Restaurando onboarding ARCA a estado inicial');
  
  const cuitInput = document.getElementById('onboardingArcaCuit');
  const claveInput = document.getElementById('onboardingArcaClave');
  const mensajeDiv = document.getElementById('onboardingArcaMensaje');
  const btnContinuar = document.getElementById('btnOnboardingArcaContinuar');
  
  asegurarContenedorBotonesArca();
  
  const btnContainer = document.getElementById('onboardingArcaButtonContainer');
  if (btnContainer) {
    btnContainer.innerHTML = `
      <button id="btnOnboardingArcaSync" class="btn-arca-sync" style="width: 100%; padding: 12px; background: linear-gradient(135deg, #a855f7, #7c3aed); color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: 700; display: flex; align-items: center; justify-content: center; gap: 8px;">
        <span class="material-icons" style="font-size: 16px;">sync</span>
        Sincronizar con ARCA
      </button>
    `;
    
    const newBtn = document.getElementById('btnOnboardingArcaSync');
    if (newBtn) {
      newBtn.onclick = async () => {
        const cuit = cuitInput?.value.trim();
        const clave = claveInput?.value;
        
        if (!cuit) {
          mostrarMensajeOnboardingArca('Por favor ingresa tu CUIT', 'warning');
          return;
        }
        
        if (!clave) {
          mostrarMensajeOnboardingArca('Por favor ingresa tu Clave Fiscal', 'warning');
          return;
        }
        
        const cuitLimpio = cuit.replace(/\D/g, '');
        if (cuitLimpio.length !== 11) {
          mostrarMensajeOnboardingArca('El CUIT debe tener 11 dígitos', 'warning');
          return;
        }
        
        newBtn.disabled = true;
        newBtn.innerHTML = '<span class="material-icons" style="font-size:16px!important">hourglass_empty</span> Enviando...';
        
        try {
          await fetch('/api/me/settings', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ cuit: cuitLimpio })
          });
          
          await fetch('/api/me/settings', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ arcaClave: clave })
          });
          
          mostrarEstadoProcesandoOnboardingArca();
          
        } catch (error) {
          console.error('Error:', error);
          mostrarMensajeOnboardingArca('❌ Error al enviar los datos', 'error');
          newBtn.disabled = false;
          newBtn.innerHTML = '<span class="material-icons" style="font-size:16px!important">sync</span> Sincronizar con ARCA';
        }
      };
    }
  }
  
  if (cuitInput) {
    cuitInput.disabled = false;
    cuitInput.value = '';
  }
  if (claveInput) {
    claveInput.disabled = false;
    claveInput.value = '';
  }
  
  if (btnContinuar) {
    btnContinuar.disabled = true;
    btnContinuar.style.opacity = '0.5';
    btnContinuar.style.cursor = 'not-allowed';
    btnContinuar.style.background = '';
    btnContinuar.style.color = '';
    btnContinuar.textContent = 'Continuar →';
  }
  
  if (mensajeDiv) {
    mensajeDiv.style.display = 'none';
    mensajeDiv.innerHTML = '';
  }
  
  console.log('✅ Onboarding ARCA restaurado a estado inicial');
}

// Mostrar mensaje en onboarding ARCA
function mostrarMensajeOnboardingArca(mensaje, tipo) {
  const mensajeDiv = document.getElementById('onboardingArcaMensaje');
  if (!mensajeDiv) return;
  
  const oldSpinner = mensajeDiv.querySelector('.mensaje-spinner');
  if (oldSpinner) oldSpinner.remove();
  
  mensajeDiv.style.display = 'block';
  mensajeDiv.className = `arca-mensaje ${tipo}`;
  
  if (tipo === 'info') {
    mensajeDiv.innerHTML = `
      <i class="fas fa-brain"></i>
      <div style="flex:1">
        <strong>🧠 KOI recibió tus datos</strong><br>
        ${mensaje}<br>
        <span style="color: #F5A623; font-size: 12px; display: inline-block; margin-top: 8px;">
          <i class="fas fa-info-circle"></i> ¿Te equivocaste? Podés <strong id="cancelarOnboardingLink" style="cursor:pointer;text-decoration:underline;">cancelar y volver a intentar</strong>.
        </span>
      </div>
      <div class="mensaje-spinner"></div>
    `;
    const cancelLink = document.getElementById('cancelarOnboardingLink');
    if (cancelLink) cancelLink.onclick = () => cancelarSolicitudOnboardingArca();
  } else {
    mensajeDiv.innerHTML = `<i class="fas ${tipo === 'success' ? 'fa-check-circle' : (tipo === 'error' ? 'fa-exclamation-circle' : 'fa-info-circle')}"></i> ${mensaje}`;
  }
  
  if (tipo !== 'info') {
    setTimeout(() => {
      if (mensajeDiv.innerHTML.includes(mensaje)) mensajeDiv.style.display = 'none';
    }, 5000);
  }
}

// Toggle visibilidad de clave en onboarding ARCA
function toggleOnboardingClave() {
  const input = document.getElementById('onboardingArcaClave');
  const icon = document.getElementById('onboardingEyeIcon');
  if (input.type === 'password') {
    input.type = 'text';
    icon.textContent = 'visibility_off';
  } else {
    input.type = 'password';
    icon.textContent = 'visibility';
  }
}
// ============================================================
//  MOSTRAR ONBOARDING DE TIENDAS
// ============================================================

function mostrarOnboardingTiendas() {
  console.log('🏪 Mostrando onboarding de TIENDAS');
  
  const vistaNegocio = document.getElementById('vista-negocio');
  const onboardingTiendas = document.getElementById('onboardingNegocio');
  const onboardingArca = document.getElementById('onboardingArca');
  const negocioNormal = document.getElementById('negocioNormal');
  
  document.querySelectorAll('.content').forEach(v => v.style.display = 'none');
  
  if (vistaNegocio) vistaNegocio.style.display = 'block';
  if (onboardingTiendas) onboardingTiendas.style.display = 'block';
  if (onboardingArca) onboardingArca.style.display = 'none';
  if (negocioNormal) negocioNormal.style.display = 'none';
  
  actualizarNombreUsuarioOnboarding();
}

// ============================================================
//  ACTUALIZAR NOMBRE DE USUARIO EN ONBOARDING
// ============================================================

async function actualizarNombreUsuarioOnboarding() {
  try {
    const userRes = await fetch('/api/me', { credentials: 'include' });
    const userData = await userRes.json();
    const userNameSpan = document.getElementById('onboardingUserName');
    if (userNameSpan && userData.user) {
      userNameSpan.textContent = userData.user.nombre?.split(' ')[0] || userData.user.email?.split('@')[0] || 'usuario';
    }
  } catch(e) {
    console.error('Error cargando nombre:', e);
  }
}

// ============================================================
//  MOSTRAR VISTA NORMAL DE MI NEGOCIO
// ============================================================

async function mostrarVistaNormalNegocio() {
    console.log('🏪 Mostrando vista normal de Mi Negocio');
    
    const vistaNegocio = document.getElementById('vista-negocio');
    const onboardingTiendas = document.getElementById('onboardingNegocio');
    const onboardingArca = document.getElementById('onboardingArca');
    const negocioNormal = document.getElementById('negocioNormal');
    
    if (!vistaNegocio) return;
    
    vistaNegocio.style.display = 'block';
    
    if (onboardingTiendas) onboardingTiendas.style.display = 'none';
    if (onboardingArca) onboardingArca.style.display = 'none';
    if (negocioNormal) negocioNormal.style.display = 'block';
    
    // 👇 AGREGAR ESTA LÍNEA - Genera las cards con logos oficiales
    generarCardsPlataformas();
    
    await cargarIntegraciones();
}

// ============================================================
//  FUNCIÓN PRINCIPAL DE DECISIÓN
// ============================================================

async function mostrarPantallaInicial() {
  console.log('🎯 === MOSTRAR PANTALLA INICIAL ===');
  
  try {
    console.log('📡 1. Consultando /api/integrations...');
    const resIntegraciones = await fetch('/api/integrations', { 
      credentials: 'include',
      cache: 'no-cache'
    });
    
    const dataIntegraciones = await resIntegraciones.json();
    const integraciones = dataIntegraciones.integrations || [];
    const tieneTiendas = integraciones.length > 0;
    
    console.log('📊 Tiendas encontradas:', integraciones.length);
    
    if (!tieneTiendas) {
      console.log('🎯 [CASO 1] Sin tiendas → Mostrando onboarding de TIENDAS');
      mostrarOnboardingTiendas();
    } else {
      console.log('📡 2. Consultando /api/me/arca-status...');
      const resARCA = await fetch('/api/me/arca-status', { 
        credentials: 'include',
        cache: 'no-cache'
      });
      
      const estadoARCA = await resARCA.json();
const arcaConectada = estadoARCA.status === 'vinculado';
      
      console.log('📊 ARCA conectada:', arcaConectada);
      
      if (!arcaConectada) {
        console.log('🎯 [CASO 2A] Tiene tiendas + ARCA pendiente → Mostrando onboarding de ARCA');
        mostrarOnboardingArca();
      } else {
        console.log('🎯 [CASO 3] Todo conectado (tiendas + ARCA) → Verificando estado del plan');
        
        // Verificar si ya pasó por onboarding de plan
        const yaPasoPlan = localStorage.getItem('koi_onboarding_plan_completado') === 'true';
        
        if (!yaPasoPlan) {
          console.log('🎯 [CASO 3A] Plan no elegido → Mostrando onboarding de MI PLAN');
          mostrarOnboardingPlan();
        } else {
          console.log('🎯 [CASO 3B] Plan ya elegido → Mostrando Dashboard');
          mostrarVista('dashboard');
        }
      }
    }
    
  } catch (error) {
    console.error('❌ Error en mostrarPantallaInicial:', error);
    mostrarVista('dashboard');
  }
}
// ==========================================
// GENERADOR DE CARDS CON LOGOS OFICIALES
// ==========================================

function generarCardsPlataformas() {
    const container = document.getElementById('negPlataformas');
    if (!container) {
        console.error('❌ No se encuentra #negPlataformas');
        return;
    }
    
    container.innerHTML = '';
    container.style.display = 'grid';
    container.style.gap = '20px';
    container.style.gridTemplateColumns = 'repeat(auto-fill, minmax(280px, 1fr))';

    const platforms = [
        { 
            id: 'mercadolibre', 
            name: 'Mercado Libre', 
            badge: 'OAuth',
            logoUrl: 'https://logotyp.us/file/mercadolibre.svg',
            bgColor: '#FFE600'
        },
        { 
            id: 'woocommerce', 
            name: 'WooCommerce', 
            badge: 'OAuth',
            logoUrl: 'https://cdn.worldvectorlogo.com/logos/woocommerce.svg',
            bgColor: '#7F54B3'
        },
        { 
            id: 'tiendanube', 
            name: 'Tienda Nube', 
            badge: 'Token',
            svg: `<svg width="44" height="44" viewBox="0 0 44 44" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <rect width="44" height="44" rx="12" fill="#1EAAF1"/>
                    <g transform="translate(14, 14) scale(1.1)">
                        <path d="M10.25 2.24a5.79 5.79 0 0 0-4 1.63 4.48 4.48 0 1 0 0 8.26 5.76 5.76 0 1 0 4-9.89zm0 10.24A4.49 4.49 0 0 1 5.76 8H4.48a5.74 5.74 0 0 0 .89 3.07 3.29 3.29 0 0 1-.88.13 3.2 3.2 0 0 1 0-6.4A3.2 3.2 0 0 1 7.69 8H9a4.42 4.42 0 0 0-1.63-3.43 4.48 4.48 0 1 1 2.88 7.91z" fill="white"/>
                    </g>
                </svg>`
        },
        { 
            id: 'empretienda', 
            name: 'Empretienda', 
            badge: 'Token',
            svg: `<svg width="44" height="44" viewBox="0 0 44 44" fill="none">
                    <rect width="44" height="44" rx="12" fill="#00C37A"/>
                    <path d="M10 22h24" stroke="white" stroke-width="2.2" stroke-linecap="round"/>
                    <path d="M22 10L10 22h24L22 10z" fill="white" opacity=".9"/>
                    <rect x="17" y="22" width="10" height="12" rx="2" fill="white"/>
                    <rect x="20" y="27" width="4" height="7" rx="1" fill="#00C37A"/>
                </svg>`
        },
        { 
            id: 'rappi', 
            name: 'Rappi', 
            badge: 'Token',
            svg: `<svg width="44" height="44" viewBox="0 0 44 44" fill="none">
                    <rect width="44" height="44" rx="12" fill="#FF441F"/>
                    <rect x="10" y="16" width="24" height="20" rx="4" fill="white"/>
                    <path d="M15 13a7 7 0 0 1 14 0" stroke="white" stroke-width="2.4" stroke-linecap="round" fill="none"/>
                    <path d="M17 22v8M17 22h5a2.5 2.5 0 0 1 0 5h-5m5 0l3 3" stroke="#FF441F" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>`
        },
        { 
            id: 'vtex', 
            name: 'VTEX', 
            badge: 'Token',
            svg: `<svg width="44" height="44" viewBox="0 0 44 44" fill="none">
                    <rect width="44" height="44" rx="12" fill="#F71963"/>
                    <path d="M5 13l5.5 13L16 13" stroke="white" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
                    <path d="M18 13h7M21.5 13v13" stroke="white" stroke-width="2.4" stroke-linecap="round"/>
                    <path d="M27 13h7M27 19.5h5M27 26h7" stroke="white" stroke-width="2.4" stroke-linecap="round"/>
                    <path d="M36 13l5 13M41 13l-5 13" stroke="white" stroke-width="2.4" stroke-linecap="round"/>
                </svg>`
        }
    ];

    platforms.forEach(p => {
        const card = document.createElement('div');
        card.className = 'neg-card';
        card.id = `card-${p.id}`;
        card.setAttribute('data-plataforma', p.id);

        let logoHtml = '';
        if (p.logoUrl) {
            logoHtml = `<img src="${p.logoUrl}" 
                         alt="${p.name}" 
                         style="width:44px; height:44px; object-fit:contain; background:${p.bgColor || 'transparent'}; border-radius:12px; padding:${p.id === 'mercadolibre' ? '4px' : '0'};"
                         onerror="this.style.display='none'; this.parentElement.innerHTML='${p.svg || `<div style='width:44px; height:44px; background:#333; border-radius:12px; display:flex; align-items:center; justify-content:center; color:white; font-size:18px;'>${p.name.charAt(0)}</div>`}'">`;
        } else {
            logoHtml = p.svg;
        }

        card.innerHTML = `
            <div class="neg-card-top">
                <div class="neg-card-logo">
                    ${logoHtml}
                </div>
                <div class="neg-card-toggle-wrap">
                    <label class="neg-toggle">
                        <input type="checkbox" id="toggle-${p.id}" onchange="toggleIntegracion('${p.id}', this.checked)">
                        <span class="neg-toggle-track"></span>
                    </label>
                </div>
            </div>
            <div class="neg-card-info">
                <div class="neg-card-name">${p.name}</div>
                <div class="neg-card-desc" id="desc-${p.id}">Sin conectar</div>
            </div>
            <div class="neg-card-footer">
                <span class="neg-card-badge neg-badge-${p.badge === 'OAuth' ? 'oauth' : 'token'}">${p.badge}</span>
                <button class="neg-card-btn" onclick="abrirConexion('${p.id}')">Configurar</button>
            </div>
        `;
        container.appendChild(card);
    });
    
    console.log(`✅ ${platforms.length} cards generadas con logos oficiales`);
}

// ============================================================
//  ONBOARDING PLAN (MI PLAN) - FUNCIONES
// ============================================================

// ============================================================
//  OBTENER FECHA DE VINCULACIÓN ARCA (desde backend real)
// ============================================================

let _fechaLogMostrado = false;

async function obtenerFechaVinculacionARCA() {
    // 1. Verificar si ya tenemos fecha en localStorage (cache rápido)
    let fechaARCA = localStorage.getItem('koi_fecha_vinculacion_arca');
    
    // 2. Si no hay en localStorage, consultar al backend
    if (!fechaARCA) {
        try {
            console.log('🔍 Consultando fecha real de vinculación ARCA al backend...');
            const res = await fetch('/api/me/arca-status', { 
                credentials: 'include',
                cache: 'no-cache',
                headers: { 'Cache-Control': 'no-cache' }
            });
            const data = await res.json();
            
            if (data.fechaVinculacion) {
                fechaARCA = data.fechaVinculacion;
                localStorage.setItem('koi_fecha_vinculacion_arca', fechaARCA);
                console.log('✅ Fecha real obtenida del backend:', new Date(fechaARCA).toLocaleString());
                _fechaLogMostrado = true;
            } else {
                console.log('⚠️ El backend no tiene fecha de vinculación ARCA');
                return null;
            }
        } catch(e) {
            console.warn('⚠️ Error consultando backend:', e.message);
            fechaARCA = new Date().toISOString();
            console.log('📅 Usando fecha local (fallback):', new Date(fechaARCA).toLocaleString());
        }
    } else {
        // 👇 Solo mostrar el log una vez, no cada segundo
        if (!_fechaLogMostrado) {
            console.log('📅 Fecha desde localStorage:', new Date(fechaARCA).toLocaleString());
            _fechaLogMostrado = true;
        }
    }
    
    return fechaARCA ? new Date(fechaARCA) : null;
}

// ============================================================
//  MOSTRAR ONBOARDING PLAN (VERSIÓN MODERNA - FONDO NEGRO)
//  - Muestra diseño ACTIVO o EXPIRADO según fecha
//  - Los estilos están en index.css
// ============================================================

function mostrarOnboardingPlan() {
    console.log('💳 Mostrando onboarding de MI PLAN');
    
    const vistaOnboardingPlan = document.getElementById('vista-onboarding-plan');
    if (!vistaOnboardingPlan) return;
    
    // Ocultar otras vistas pero mantener sidebar
    document.querySelectorAll('.content').forEach(v => {
        if (v.id !== 'vista-onboarding-plan') {
            v.style.display = 'none';
        }
    });
    
    // Asegurar que el sidebar sea visible
    const sidebar = document.querySelector('.sidebar');
    if (sidebar) sidebar.style.display = '';
    
    // Inyectar HTML con bloque de estado moderno
    vistaOnboardingPlan.innerHTML = `
        <div class="plan-unified-container">
            <div class="koi-unified-header">
                <div class="koi-unified-icon" style="display: none;">K</div>
            </div>

            <!-- ===== BLOQUE DE ESTADO MODERNO (FONDO NEGRO) ===== -->
            <div class="status-card-modern" id="statusCard">
                <div class="status-badge" id="statusBadge">🔹 PERÍODO DE CORTESÍA</div>
                <div class="status-days-container">
                    <span class="status-days-number" id="statusDaysNumber">--</span>
                    <span class="status-days-label">días</span>
                </div>
                <div class="status-days-sub" id="statusDaysSub">de prueba gratuita</div>
                <div class="status-progress-container">
                    <div class="status-progress-bar" id="statusProgressBar" style="--progress: 0%"></div>
                    <span class="status-progress-label" id="statusProgressLabel">0% restante</span>
                </div>
                <div class="status-expiry" id="statusExpiry">⏱️ Cargando...</div>
            </div>

            <div class="timers-unified-section" id="timersSection">
                <div class="timer-unified-item">
                    <span class="timer-unified-label">⏱️ Tiempo restante de tu período de cortesía:</span>
                    <span class="timer-unified-value" id="countdownTimer">--d --h --m</span>
                </div>
                <div class="timer-unified-item offer-timer" id="offerTimer">
                    <span class="timer-unified-label">⚡ Tiempo para asegurar 60 días:</span>
                    <span class="timer-unified-value" id="offerCountdown">--d --h --m</span>
                </div>
            </div>

            <div class="breakdown-unified-box" id="breakdownBox">
                <div class="breakdown-unified-row">
                    <div>
                        <div class="breakdown-unified-label">🎁 30 días de cortesía</div>
                        <div class="breakdown-unified-sub">✅ ya disponibles · por ser parte de KOI</div>
                    </div>
                    <div class="breakdown-unified-price">$0</div>
                </div>
                <div class="plus-unified-icon">＋</div>
                <div class="breakdown-unified-row">
                    <div>
                        <div class="breakdown-unified-label">⚡ 30 días extra</div>
                        <div class="breakdown-unified-sub">⚡ si suscribís dentro de los próximos 7 días</div>
                    </div>
                    <div class="breakdown-unified-price">$0</div>
                </div>
                <hr class="divider-unified-dashed">
                <div class="total-unified-row">
                    <div>
                        <div class="total-unified-label">📋 TOTAL</div>
                        <div class="total-unified-sub">Primer pago recién en 2 meses</div>
                    </div>
                    <div class="total-unified-price">60 DÍAS → $0</div>
                </div>
                <div class="acumulation-unified-note">
                    ✨ Los 30 días extra se suman AUTOMÁTICAMENTE al finalizar tus 30 días base
                </div>
            </div>

            <div class="price-unified-card">
                <div class="price-unified-top-bar"></div>
                <div class="price-unified-inner">
                    <div class="price-unified-eyebrow">PLAN ÚNICO · MENSUAL</div>
                    <div class="price-unified-amount">
                        <span class="price-unified-cur">$</span>
                        <span class="price-unified-num">40.000</span>
                        <span class="price-unified-period">/ mes</span>
                    </div>
                    <div class="price-unified-note">Sin permanencia · Cancelás cuando querés</div>
                    <div class="price-unified-divider"></div>
                    <div class="price-unified-features">
                        <div class="price-unified-feature">
                            <div class="price-unified-check"><svg viewBox="0 0 12 12" fill="none"><path d="M2 6L5 9L10 3" stroke="#22C55E" stroke-width="2" stroke-linecap="round"/></svg></div>
                            <span class="price-unified-feature-text">Facturas ilimitadas (A, B y C)</span>
                        </div>
                        <div class="price-unified-feature">
                            <div class="price-unified-check"><svg viewBox="0 0 12 12" fill="none"><path d="M2 6L5 9L10 3" stroke="#22C55E" stroke-width="2" stroke-linecap="round"/></svg></div>
                            <span class="price-unified-feature-text">Facturación automática o manual</span>
                        </div>
                        <div class="price-unified-feature">
                            <div class="price-unified-check"><svg viewBox="0 0 12 12" fill="none"><path d="M2 6L5 9L10 3" stroke="#22C55E" stroke-width="2" stroke-linecap="round"/></svg></div>
                            <span class="price-unified-feature-text">Envío automático de comprobantes</span>
                        </div>
                        <div class="price-unified-feature">
                            <div class="price-unified-check"><svg viewBox="0 0 12 12" fill="none"><path d="M2 6L5 9L10 3" stroke="#22C55E" stroke-width="2" stroke-linecap="round"/></svg></div>
                            <span class="price-unified-feature-text">Multi-integración simultánea</span>
                        </div>
                        <div class="price-unified-feature">
                            <div class="price-unified-check"><svg viewBox="0 0 12 12" fill="none"><path d="M2 6L5 9L10 3" stroke="#22C55E" stroke-width="2" stroke-linecap="round"/></svg></div>
                            <span class="price-unified-feature-text">Soporte por WhatsApp</span>
                        </div>
                    </div>
                    <button class="price-unified-btn" id="btnSuscripcionMercadoPago">
                        <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M9 2L15 9 9 16M2 9h12" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/></svg>
                        Suscribirme ahora →
                    </button>
                    <div class="price-unified-footnote">Débito automático · Mercado Pago</div>
                </div>
            </div>

            <div class="terms-unified-text">
                Al suscribirte, aceptás nuestros <a href="#">Términos y Condiciones</a> y <a href="#">Política de Privacidad</a>
            </div>

            <div class="policy-unified-card">
                <div class="policy-unified-header"><span>🔒</span><strong>Política de cancelación</strong></div>
                <div class="policy-unified-item"><div class="policy-dot-green-unified"></div><div class="policy-text-unified"><strong>Durante los 60 días de cortesía:</strong> si cancelás, <span class="highlight-red-unified">perdés el acceso INMEDIATAMENTE</span>.</div></div>
                <div class="policy-unified-item"><div class="policy-dot-orange-unified"></div><div class="policy-text-unified"><strong>Una vez que empezás a pagar:</strong> si cancelás, <span class="highlight-green-unified">seguís usando KOI hasta que termine el mes que ya pagaste</span>.</div></div>
                <div class="example-unified-box"><p>💡 <strong>Ejemplo:</strong> Si cancelás el día 45 de tus 60 días de cortesía, perdés el acceso al instante.<br>En cambio, si ya pagaste un mes y cancelás, seguís facturando hasta que termine ese mes.</p></div>
            </div>
        </div>
    `;
    
    // Mostrar la vista
    vistaOnboardingPlan.style.display = 'block';
    
    // Actualizar UI según estado (activo/expirado)
    actualizarUIUnificada();
    
    // Configurar botón
    configurarBotonesPlan();
}

// ============================================================
//  ACTUALIZAR UI UNIFICADA (CON BLOQUE MODERNO Y FONDO NEGRO)
// ============================================================

async function actualizarUIUnificada() {
    const fechaVinculacion = await obtenerFechaVinculacionARCA();
    const suscripcionActiva = await verificarEstadoSuscripcion();
    
    // Elementos del nuevo bloque moderno
    const badgeEl = document.getElementById('statusBadge');
    const daysNumberEl = document.getElementById('statusDaysNumber');
    const daysSubEl = document.getElementById('statusDaysSub');
    const progressBarEl = document.getElementById('statusProgressBar');
    const progressLabelEl = document.getElementById('statusProgressLabel');
    const expiryEl = document.getElementById('statusExpiry');
    const statusCard = document.getElementById('statusCard');
    const timersSection = document.getElementById('timersSection');
    const breakdownBox = document.getElementById('breakdownBox');
    const countdownEl = document.getElementById('countdownTimer');
    const offerCountdownEl = document.getElementById('offerCountdown');
    const offerTimer = document.getElementById('offerTimer');
    const priceCard = document.querySelector('.price-unified-card');
    const container = document.querySelector('.plan-unified-container');
    const subscribeBtn = document.getElementById('btnSuscripcionMercadoPago');
    
    // ========== CASO 1: SUSCRIPCIÓN ACTIVA ==========
    if (suscripcionActiva) {
        if (badgeEl) badgeEl.textContent = '✅ SUSCRIPCIÓN ACTIVA';
        if (daysNumberEl) daysNumberEl.textContent = '∞';
        if (daysSubEl) daysSubEl.textContent = 'disfrutá de KOI sin límites';
        if (statusCard) statusCard.className = 'status-card-modern status-active';
        if (timersSection) timersSection.style.display = 'none';
        if (breakdownBox) breakdownBox.style.display = 'none';
        if (progressBarEl) progressBarEl.style.setProperty('--progress', '100%');
        if (progressLabelEl) progressLabelEl.textContent = '100% activo';
        if (expiryEl) expiryEl.innerHTML = '✅ Suscripción activa · renovación automática';
        if (priceCard) {
            priceCard.classList.remove('price-expired');
            priceCard.style.border = '';
            priceCard.style.boxShadow = '';
        }
        if (container) container.classList.remove('plan-expired');
        if (subscribeBtn) {
            subscribeBtn.innerHTML = '✅ Suscripción activa';
            subscribeBtn.disabled = true;
            subscribeBtn.style.opacity = '0.6';
        }
        return;
    }
    
    // ========== CASO 2: Sin fecha de vinculación ==========
    if (!fechaVinculacion) {
        if (badgeEl) badgeEl.textContent = '⚠️ CONFIGURACIÓN PENDIENTE';
        if (daysNumberEl) daysNumberEl.textContent = '--';
        if (daysSubEl) daysSubEl.textContent = 'vinculá ARCA para comenzar tu prueba';
        if (statusCard) statusCard.className = 'status-card-modern status-warning';
        if (timersSection) timersSection.style.display = 'none';
        if (breakdownBox) breakdownBox.style.display = 'none';
        if (progressBarEl) progressBarEl.style.setProperty('--progress', '0%');
        if (progressLabelEl) progressLabelEl.textContent = '0%';
        if (expiryEl) expiryEl.innerHTML = '⚠️ Vinculá ARCA para comenzar tu prueba gratuita';
        if (priceCard) priceCard.classList.add('price-expired');
        if (container) container.classList.add('plan-expired');
        if (subscribeBtn) {
            subscribeBtn.innerHTML = '🔌 Conectar ARCA primero →';
            subscribeBtn.disabled = true;
        }
        return;
    }
    
    // ========== Calcular estado de cortesía ==========
    const hoy = new Date();
    hoy.setUTCHours(0, 0, 0, 0);
    
    const finCortesia = new Date(fechaVinculacion);
    finCortesia.setUTCHours(23, 59, 59, 999);
    finCortesia.setUTCDate(finCortesia.getUTCDate() + 30);
    
    const expirado = finCortesia.getTime() < hoy.getTime();
    const diasRestantes = Math.ceil((finCortesia - hoy) / (1000 * 60 * 60 * 24));
    const diasCorrectos = Math.max(diasRestantes, 0);
    
    // Calcular oferta de 7 días (CORREGIDO)
    const finOferta = new Date(fechaVinculacion);
    finOferta.setDate(finOferta.getDate() + 7);
    finOferta.setHours(23, 59, 59, 999);
    const ofertaActiva = hoy.getTime() <= finOferta.getTime();
    
    // ========== CASO 3: CORTESÍA EXPIRADA ==========
    if (expirado) {
        if (badgeEl) badgeEl.textContent = '⛔ PERÍODO EXPIRADO';
        if (daysNumberEl) daysNumberEl.textContent = '0';
        if (daysSubEl) daysSubEl.textContent = 'período de prueba finalizado';
        if (statusCard) statusCard.className = 'status-card-modern status-expired';
        if (timersSection) timersSection.style.display = 'none';
        if (breakdownBox) breakdownBox.style.display = 'none';
        if (countdownEl) countdownEl.textContent = '0d 0h 0m';
        if (progressBarEl) progressBarEl.style.setProperty('--progress', '0%');
        if (progressLabelEl) progressLabelEl.textContent = '0% restante';
        if (expiryEl) expiryEl.innerHTML = '⛔ Período de prueba finalizado · Suscribite para continuar';
        if (priceCard) {
            priceCard.classList.add('price-expired');
            priceCard.style.border = '2px solid rgba(255,61,87,0.4)';
        }
        if (container) container.classList.add('plan-expired');
        if (subscribeBtn) {
            subscribeBtn.innerHTML = 'Suscribirme ahora →';
            subscribeBtn.disabled = false;
        }
        if (offerTimer) offerTimer.style.display = 'none';
        
    // ========== CASO 4: CORTESÍA ACTIVA ==========
    } else {
        const porcentaje = Math.min(Math.round((diasCorrectos / 30) * 100), 100);
        
        if (badgeEl) badgeEl.textContent = '🔹 PERÍODO DE CORTESÍA';
        if (daysNumberEl) daysNumberEl.textContent = diasCorrectos;
        if (daysSubEl) daysSubEl.textContent = 'de prueba gratuita';
        if (statusCard) statusCard.className = 'status-card-modern';
        if (timersSection) timersSection.style.display = 'block';
        if (priceCard) {
            priceCard.classList.remove('price-expired');
            priceCard.style.border = '';
            priceCard.style.boxShadow = '';
        }
        if (container) container.classList.remove('plan-expired');
        if (subscribeBtn) {
            subscribeBtn.innerHTML = 'Suscribirme ahora →';
            subscribeBtn.disabled = false;
        }
        if (progressBarEl) progressBarEl.style.setProperty('--progress', porcentaje + '%');
        if (progressLabelEl) progressLabelEl.textContent = `${porcentaje}% restante`;
        
        // Calcular fecha de vencimiento
        const fechaVencimiento = new Date();
        fechaVencimiento.setDate(fechaVencimiento.getDate() + diasCorrectos);
        const fechaStr = fechaVencimiento.toLocaleDateString('es-AR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        });
        if (expiryEl) expiryEl.innerHTML = `⏱️ Vence en ${diasCorrectos} días · ${fechaStr}`;
        
        // Actualizar timer de cortesía
        if (countdownEl) {
            const dias = Math.floor(diasCorrectos);
            const horas = Math.floor((diasCorrectos - dias) * 24);
            countdownEl.textContent = `${dias}d ${horas.toString().padStart(2, '0')}h`;
        }
        
        // 👇 LÓGICA: Oferta de 7 días
        if (ofertaActiva) {
            if (breakdownBox) breakdownBox.style.display = 'block';
            if (offerTimer) offerTimer.style.display = 'flex';
            
            // Actualizar timer de oferta
            if (offerCountdownEl) {
                const diffOferta = finOferta - hoy;
                const diasOferta = Math.floor(diffOferta / (1000 * 60 * 60 * 24));
                const horasOferta = Math.floor((diffOferta % 86400000) / 3600000);
                offerCountdownEl.textContent = `${diasOferta}d ${horasOferta.toString().padStart(2, '0')}h`;
            }
            
            // Actualizar texto del total a 60 días
            const totalLabel = document.querySelector('.total-unified-label');
            const totalPrice = document.querySelector('.total-unified-price');
            if (totalLabel) totalLabel.innerHTML = '📋 TOTAL';
            if (totalPrice) totalPrice.innerHTML = '60 DÍAS → $0';
            
        } else {
            if (breakdownBox) breakdownBox.style.display = 'none';
            if (offerTimer) offerTimer.style.display = 'none';
            
            // Actualizar texto del total a 30 días
            const totalLabel = document.querySelector('.total-unified-label');
            const totalPrice = document.querySelector('.total-unified-price');
            if (totalLabel) totalLabel.innerHTML = '📋 PERÍODO DE PRUEBA';
            if (totalPrice) totalPrice.innerHTML = '30 DÍAS → $0';
        }
    }
}
// ============================================================
//  CONFIGURAR BOTONES DEL ONBOARDING (Mercado Pago REAL)
// ============================================================

function configurarBotonesPlan() {
    const btnSuscripcion = document.getElementById('btnSuscripcionMercadoPago');
    
    if (!btnSuscripcion) {
        console.warn('⚠️ Botón de suscripción no encontrado');
        return;
    }
    
    // Limpiar eventos anteriores clonando el botón
    const newBtn = btnSuscripcion.cloneNode(true);
    btnSuscripcion.parentNode.replaceChild(newBtn, btnSuscripcion);
    
    newBtn.onclick = async function(e) {
        e.preventDefault();
        console.log('💳 Iniciando suscripción con Mercado Pago');
        
        // Guardar estado de carga
        const originalText = this.innerHTML;
        
        // Mostrar loading
        this.innerHTML = '<span style="animation:spin 0.8s linear infinite; display:inline-block;">🔄</span> Procesando...';
        this.disabled = true;
        
        try {
            // Crear preferencia de pago en backend
            const response = await fetch('/api/suscripcion/crear', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    monto: 40000,
                    moneda: 'ARS'
                })
            });
            
            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.error || 'Error al crear la suscripción');
            }
            
            if (data.init_point) {
                // Guardar que el onboarding está completado
                localStorage.setItem('koi_onboarding_plan_completado', 'true');
                
                // Mostrar toast de éxito
                if (typeof toast === 'function') {
                    toast('🎁 Redirigiendo a Mercado Pago...', 'success');
                }
                
                // Redirigir a Mercado Pago
                window.location.href = data.init_point;
            } else {
                throw new Error('No se recibió el link de pago');
            }
            
        } catch (error) {
            console.error('❌ Error en suscripción:', error);
            
            if (typeof toast === 'function') {
                toast('❌ Error: ' + error.message, 'error');
            } else {
                alert('Error: ' + error.message);
            }
            
            // Restaurar botón
            this.innerHTML = originalText;
            this.disabled = false;
        }
    };
    
    console.log('✅ Botón de suscripción a Mercado Pago configurado');
}

function guardarOnboardingPlanCompletado() {
    localStorage.setItem('koi_onboarding_plan_completado', 'true');
    console.log('✅ Onboarding de plan marcado como completado');
}

// ============================================================
//  VERIFICAR ESTADO DE SUSCRIPCIÓN AL CARGAR
// ============================================================

async function verificarEstadoSuscripcion() {
    try {
        const res = await fetch('/api/suscripcion/estado', { credentials: 'include' });
        const data = await res.json();
        
        if (data.activa) {
            localStorage.setItem('koi_onboarding_plan_completado', 'true');
            console.log('✅ Suscripción activa detectada');
            return true;
        } else {
            console.log('⚠️ Sin suscripción activa');
            return false;
        }
    } catch (error) {
        console.error('Error verificando suscripción:', error);
        return false;
    }
}
// ============================================================
//  MOSTRAR VISTA DE SUSCRIPCIÓN ACTIVA (VERSIÓN CORRECTA)
// ============================================================

function mostrarSuscripcionActiva() {
    console.log('💳 Mostrando vista de Suscripción Activa');
    
    document.querySelectorAll('.content').forEach(el => el.style.display = 'none');
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    
    let vistaSuscripcion = document.getElementById('vista-suscripcion');
    if (!vistaSuscripcion) {
        vistaSuscripcion = document.createElement('div');
        vistaSuscripcion.id = 'vista-suscripcion';
        vistaSuscripcion.className = 'content';
        document.querySelector('.main').appendChild(vistaSuscripcion);
    }
    
    vistaSuscripcion.style.display = 'block';
    document.getElementById('nav-estado').classList.add('active');
    
    // Mostrar loading
    vistaSuscripcion.innerHTML = `
        <div style="display:flex;justify-content:center;align-items:center;padding:60px">
            <div class="susc-spinner"></div>
            <span style="margin-left:12px;color:var(--text-2)">Cargando suscripción...</span>
        </div>
    `;
    
    // Esperar a que el DOM se actualice
    setTimeout(() => {
        cargarDatosSuscripcion();
    }, 50);
}

// ============================================================
//  CARGAR DATOS DE SUSCRIPCIÓN - VERSIÓN CORRECTA CON GRID
// ============================================================

async function cargarDatosSuscripcion() {
    try {
        console.log('✅ [VERSIÓN CORRECTA CON GRID]');
        const vistaSuscripcion = document.getElementById('vista-suscripcion');
        
        if (!vistaSuscripcion || vistaSuscripcion.style.display !== 'block') {
            console.log('Vista no visible');
            return;
        }
        
        // Loader inicial
        vistaSuscripcion.innerHTML = `
            <div style="display:flex;justify-content:center;align-items:center;padding:60px">
                <div class="susc-spinner"></div>
                <span>Cargando...</span>
            </div>`;
        
        // Peticiones en paralelo
        const [userRes, ordersRes] = await Promise.all([
            fetch('/api/me', { credentials: 'include' }),
            fetch('/api/orders?limit=10&status=invoiced', { credentials: 'include' }).catch(() => null)
        ]);

        const userData = await userRes.json();
        const user = userData.user;
        const settings = user?.settings || {};
        
        const formatDate = (d) => d ? new Date(d).toLocaleDateString('es-AR').replace(/\//g, ' / ') : '—';
        
        // Procesar órdenes para el historial
        let facturasEmitidas = 0;
        let historialHTML = '';
        let totalPagado = 0;
        let cantidadPagos = 0;

        if (ordersRes) {
            const ordersData = await ordersRes.json();
            if (ordersData.pagination) facturasEmitidas = ordersData.pagination.total || 0;
            
            const ordenes = ordersData.orders || [];
            cantidadPagos = ordenes.length;

            if (cantidadPagos === 0) {
                historialHTML = `<tr><td colspan="4" style="text-align:center; padding:20px;">No tenés pagos registrados aún.</td></tr>`;
            } else {
                ordenes.forEach(order => {
                    const montoFormateado = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(order.total);
                    totalPagado += order.total;
                    
                    historialHTML += `
                        <tr>
                            <td>${formatDate(order.createdAt)}</td>
                            <td>${montoFormateado}</td>
                            <td><span class="chip-paid"><span class="chip-dot"></span> Pagado</span></td>
                            <td><a href="#" class="btn-ver-comprobante" data-id="${order._id}">📄 Ver</a></td>
                        </tr>`;
                });
            }
        } else {
            facturasEmitidas = 1207;
            historialHTML = `<tr><td colspan="4" style="text-align:center; padding:20px;">Error al cargar el historial.</td></tr>`;
        }
        
        const totalFormateado = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(totalPagado);

        // Inyección del HTML CON ESTRUCTURA DE DOS COLUMNAS
        vistaSuscripcion.innerHTML = `
            <div class="suscripcion-container">
                <div class="suscripcion-header">
                    <h1>MI SUSCRIPCIÓN</h1>
                    <p>Gestioná tu plan y revisá tu historial de pagos</p>
                </div>
                <div class="suscripcion-grid">
                    
                    <!-- COLUMNA IZQUIERDA -->
                    <div class="suscripcion-col-left">
                        <div class="suscripcion-card status-card">
                            <div class="status-top">
                                <div class="badge-active"><span class="dot-live"></span> Suscripción activa</div>
                                <div class="plan-badge">PRO</div>
                            </div>
                            <div class="plan-price-sub">$40.000 / mes · renovación automática</div>
                            <div class="detail-box">
                                <div class="detail-row"><span>📅 Próximo pago</span><span>${formatDate(settings.proximoPago)}</span></div>
                                <div class="detail-row"><span>💳 Método de pago</span><span>Mastercard •••• 0604</span></div>
                                <div class="detail-row"><span>📅 Activo desde</span><span>${formatDate(settings.fechaUltimoPago || user.creadoEn)}</span></div>
                                <div class="detail-row"><span>📄 Facturas emitidas</span><span class="green">${facturasEmitidas.toLocaleString()}</span></div>
                            </div>
                            <div class="suscripcion-actions">
                                <button class="btn-suscripcion download" id="btnDescargarComprobante">📄 Descargar comprobante</button>
                                <button class="btn-suscripcion cancel" id="btnCancelarSuscripcion">❌ Cancelar suscripción</button>
                            </div>
                        </div>
                        
                        <div class="suscripcion-card">
                            <div class="sec-label">💳 Método de pago</div>
                            <div class="card-face-wrap">
                                <div class="card-face"><div class="card-chip"></div><div class="card-mc"><span></span><span></span></div></div>
                                <div><div class="card-number">Mastercard •••• 0604</div><div class="card-meta">Vence 11/26 · ${(user.nombre || 'Usuario').toUpperCase()}</div></div>
                            </div>
                            <button class="btn-suscripcion ghost" id="btnCambiarMetodo">🔄 Cambiar método de pago</button>
                        </div>
                    </div>
                    
                    <!-- COLUMNA DERECHA -->
                    <div class="suscripcion-col-right">
                        <div class="suscripcion-card historial-card">
                            <div class="sec-label">📋 Historial de pagos</div>
                            <div class="history-table-wrapper">
                                <table class="history-table">
                                    <thead><tr><th>FECHA</th><th>MONTO</th><th>ESTADO</th><th></th></tr></thead>
                                    <tbody>
                                        ${historialHTML}
                                    </tbody>
                                </table>
                            </div>
                            <div class="table-footer">Total: ${totalFormateado} · ${cantidadPagos} pagos</div>
                        </div>
                        
                        <div class="suscripcion-card support-card">
                            <div class="sec-label">🛟 ¿Necesitás ayuda?</div>
                            <div class="support-links">
                                <a href="mailto:hola@koi-factura.lat" class="support-link">📧 hola@koi-factura.lat</a>
                                <a href="#" class="support-link" id="btnWhatsApp">💬 Soporte por WhatsApp</a>
                            </div>
                        </div>
                    </div>

                </div>
            </div>
        `;
        
        // Forzar estilos del grid
        const grid = document.querySelector('.suscripcion-grid');
        if (grid) {
            grid.style.display = 'grid';
            grid.style.gridTemplateColumns = '1fr 1fr';
            grid.style.gap = '24px';
        }
        
        // Event Listeners
        document.getElementById('btnDescargarComprobante')?.addEventListener('click', descargarComprobante);
        document.getElementById('btnCancelarSuscripcion')?.addEventListener('click', cancelarSuscripcion);
        document.getElementById('btnCambiarMetodo')?.addEventListener('click', cambiarMetodoPago);
        
        // Listeners para los botones "Ver" del historial
        document.querySelectorAll('.btn-ver-comprobante').forEach(enlace => {
            enlace.addEventListener('click', (e) => {
                e.preventDefault();
                const orderId = e.target.getAttribute('data-id');
                if (orderId) {
                    window.open(`/api/orders/${orderId}/pdf`, '_blank');
                }
            });
        });
        
        console.log('✅ Grid de dos columnas inyectado correctamente');
        
    } catch(error) {
        console.error('Error general en cargarDatosSuscripcion:', error);
    }
}

// ============================================================
//  FUNCIONES AUXILIARES
// ============================================================

function formatSuscripcionDate(dateString) {
    if (!dateString) return '—';
    const date = new Date(dateString);
    return date.toLocaleDateString('es-AR', { 
        day: '2-digit', 
        month: '2-digit', 
        year: 'numeric' 
    }).replace(/\//g, ' / ');
}

function renderPaymentHistoryRows(history) {
    if (!history.length) {
        return `<tr><td colspan="5" style="text-align:center;padding:32px;color:var(--text-3)">No hay pagos registrados</td></tr>`;
    }
    
    return history.map(p => `
        <tr>
            <td>${p.date}</td>
            <td class="num">$${p.amount.toLocaleString()}</td>
            <td class="muted">${p.method}</td>
            <td><span class="chip-paid"><span class="chip-dot"></span> Pagado</span></td>
            <td><a href="#" class="receipt-link" onclick="verComprobantePago('${p.date}'); return false;"><i class="ti ti-file-text"></i> Ver</a></td>
        </tr>
    `).join('');
}

async function descargarComprobante() {
    if (typeof toast === 'function') {
        toast('📄 Generando comprobante...', 'info');
    }
    // Redirigir al PDF del último comprobante
    setTimeout(() => {
        window.open('/api/orders/ultimo/pdf', '_blank');
    }, 500);
}

async function cancelarSuscripcion() {
    const confirmar = confirm('¿Estás seguro que querés cancelar tu suscripción?\n\nSe mantendrá activa hasta el fin del período actual.');
    
    if (!confirmar) return;
    
    if (typeof toast === 'function') {
        toast('Procesando cancelación...', 'info');
    }
    
    try {
        const response = await fetch('/api/suscripcion/cancelar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include'
        });
        
        const data = await response.json();
        
        if (data.ok) {
            if (typeof toast === 'function') {
                toast('✅ Suscripción cancelada. Seguirás activo hasta fin de mes.', 'success');
            }
            // Actualizar estado local
            localStorage.setItem('koi_onboarding_plan_completado', 'false');
            localStorage.setItem('koi_suscripcion_activa', 'false');
            setTimeout(() => location.reload(), 2000);
        } else {
            if (typeof toast === 'function') {
                toast('❌ Error: ' + data.error, 'error');
            }
        }
    } catch (error) {
        console.error('Error cancelando:', error);
        if (typeof toast === 'function') {
            toast('Error al cancelar: ' + error.message, 'error');
        }
    }
}

async function cambiarMetodoPago() {
    if (typeof toast === 'function') {
        toast('🔄 Redirigiendo a Mercado Pago para actualizar tu método de pago...', 'info');
    }
    setTimeout(() => {
        window.open('https://www.mercadopago.com.ar', '_blank');
    }, 500);
}

function verComprobantePago(fecha) {
    if (typeof toast === 'function') {
        toast(`📄 Descargando comprobante del ${fecha}...`, 'info');
    }
    window.open('/api/orders/ultimo/pdf', '_blank');
}
// ==========================================
// FUNCIONES PARA VISTA CONFIGURACIÓN (NUEVAS)
// ==========================================

// Guardar perfil (reemplaza la función existente)
window.guardarPerfil = async function() {
  const statusDiv = document.getElementById('cfgSaveStatus');
  if (statusDiv) {
    statusDiv.classList.add('visible');
    setTimeout(() => statusDiv.classList.remove('visible'), 2000);
  }
  
  const perfil = {
    nombre: document.getElementById('cfgNombre')?.value || '',
    condicionFiscal: document.getElementById('cfgCondicionFiscal')?.value || '',
    categoria: document.getElementById('cfgCategoria')?.value || '',
    cuit: document.getElementById('cfgCuit')?.value || '',
    email: document.getElementById('cfgEmail')?.value || ''
  };
  
  console.log('Perfil guardado:', perfil);
  
  try {
    const res = await fetch('/api/me/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        nombre: perfil.nombre,
        condicionFiscal: perfil.condicionFiscal,
        categoria: perfil.categoria,
        cuit: perfil.cuit,
        email: perfil.email
      })
    });
    
    if (res.ok) {
      if (typeof toast === 'function') toast('✅ Perfil guardado', 'success');
    } else {
      console.warn('Error al guardar en backend');
    }
  } catch(e) {
    console.warn('Error:', e.message);
  }
};

// Toggle límite facturas
window.toggleLimiteFacturas = function(checked) {
  const input = document.getElementById('cfgMaxFacturas');
  if (input) input.disabled = !checked;
};

// Toggle límite monto
window.toggleLimiteMonto = function(checked) {
  const input = document.getElementById('cfgMaxMonto');
  if (input) input.disabled = !checked;
};

// Toggle límite días
window.toggleLimiteDias = function(checked) {
  const input = document.getElementById('cfgMaxDias');
  if (input) input.disabled = !checked;
};

// Mostrar/ocultar categoría monotributo
function toggleCategoriaField() {
  const condicionSelect = document.getElementById('cfgCondicionFiscal');
  const categoriaGroup = document.getElementById('categoriaGroup');
  
  if (condicionSelect && categoriaGroup) {
    categoriaGroup.style.display = condicionSelect.value === 'monotributo' ? 'flex' : 'none';
  }
}

// Inicializar eventos de configuración
function initConfigEvents() {
  const condicionSelect = document.getElementById('cfgCondicionFiscal');
  if (condicionSelect) {
    condicionSelect.removeEventListener('change', toggleCategoriaField);
    condicionSelect.addEventListener('change', toggleCategoriaField);
    toggleCategoriaField();
  }
}

// Llamar a initConfigEvents cuando se carga la vista
if (document.getElementById('vista-config')) {
  setTimeout(initConfigEvents, 100);
}

function renderMono(d) {
  // Usar los nuevos campos de facturación acumulada
  const totalAcumulado = d.facturacionAcumulada || d.monoFacturado || 0;
  const limiteAnual = d.limiteAnual || d.monoLimite || 13862982.24;
  const porcentaje = d.porcentajeAnual || (totalAcumulado / limiteAnual) * 100;
  const categoria = d.categoria || d.monoCategoria || 'C';
  
  // Actualizar el título de la tarjeta
  document.getElementById('monoCat').textContent = `Cat ${categoria}`;
  document.getElementById('monoMes').textContent = d.monoMes || 'Período: últimos 12 meses';
  
  // Actualizar el valor de facturación acumulada
  document.getElementById('monoVal').textContent = 
    new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(totalAcumulado);
  document.getElementById('monoLimVal').textContent = ars(limiteAnual);
  
  // Calcular y actualizar la barra de progreso
  const pct = Math.min(porcentaje, 100);
  const fill = document.getElementById('progFill');
  const pctEl = document.getElementById('progPct');
  
  requestAnimationFrame(() => { fill.style.width = pct.toFixed(1) + '%'; });
  
  let cls = '', pc = '';
  if (pct >= 90) { cls = 'crit'; pc = 'crit'; }
  else if (pct >= 70) { cls = 'warn'; pc = 'warn'; }
  
  fill.className = `prog-fill ${cls}`;
  pctEl.textContent = pct.toFixed(1) + '%'; 
  pctEl.className = `prog-pct ${pc}`;
  
  document.getElementById('progMes').textContent = `${pct.toFixed(1)}% del límite anual utilizado`;
}
// Función para ir a la sección de comprobantes filtrando pendientes
function irAComprobantesPendientes() {
  // Cambiar a la vista de comprobantes
  mostrarVista('comprobantes');
  
  // Aplicar filtro de pendientes después de un pequeño delay
  setTimeout(() => {
    // Buscar y activar el botón de filtro "Sin emitir"
    const btnPendiente = document.querySelector('.filtro-btn[onclick*="pendiente"]');
    if (btnPendiente) {
      btnPendiente.click();
    } else {
      // Fallback: buscar por texto
      const botones = document.querySelectorAll('.filtro-btn');
      botones.forEach(btn => {
        if (btn.textContent.includes('Sin emitir') || btn.textContent.includes('pendiente')) {
          btn.click();
        }
      });
    }
  }, 300);
}
// ============================================================
//  SISTEMA DE NOTIFICACIONES - KOI (CON SONIDO Y BADGE)
// ============================================================

let _notificaciones = [];
let _notificacionesNoLeidas = 0;
let _pollingInterval = null;
const NOTIFICACIONES_POLLING_INTERVAL = 30000;

// ============================================================
//  AUDIO — CONTEXTO ÚNICO COMPARTIDO
// ============================================================

let _audioCtx = null;

function _getAudioCtx() {
    if (!_audioCtx) {
        _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    return _audioCtx;
}

function _tocarNota(ctx, frecuencia, inicioOffset, duracion) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.value = frecuencia;
    const t = ctx.currentTime + inicioOffset;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.25, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duracion);
    osc.start(t);
    osc.stop(t + duracion);
}

function _reproducirTono() {
    try {
        const ctx = _getAudioCtx();
        if (ctx.state === 'suspended') {
            console.warn('⚠️ AudioContext suspendido: el usuario aún no interactuó con la página.');
            return;
        }
        _tocarNota(ctx, 880, 0, 0.18);
        _tocarNota(ctx, 1100, 0.18, 0.15);
        console.log('🔊 Sonido reproducido (Web Audio API)');
    } catch (e) {
        console.warn('⚠️ Error reproduciendo tono:', e);
    }
}

function reproducirSonidoNotificacion() {
    const audio = new Audio('/sounds/notification.mp3');
    audio.volume = 0.5;

    let fallbackUsado = false;
    const fallback = () => {
        if (fallbackUsado) return;
        fallbackUsado = true;
        _reproducirTono();
    };

    audio.onerror = fallback;      // archivo no encontrado / CORS / formato
    audio.play().catch(fallback);  // autoplay bloqueado por el navegador
}

// Desbloquear el AudioContext compartido con el primer gesto del usuario
function _activarAudioCtx() {
    try {
        const ctx = _getAudioCtx();
        if (ctx.state === 'suspended') {
            ctx.resume().then(() => console.log('🔊 AudioContext desbloqueado'));
        }
    } catch (e) {
        console.warn('⚠️ Error activando AudioContext:', e);
    }
}

document.addEventListener('click', _activarAudioCtx, { once: true });
document.addEventListener('touchstart', _activarAudioCtx, { once: true });
document.addEventListener('keydown', _activarAudioCtx, { once: true });

// ============================================================
//  OBTENER NOTIFICACIONES
// ============================================================
window.obtenerNotificaciones = async function() {
    try {
        const res = await fetch('/api/notifications', {
            credentials: 'include',
            headers: { 'Cache-Control': 'no-cache' }
        });

        if (!res.ok) {
            if (res.status === 401) return [];
            throw new Error(`HTTP ${res.status}`);
        }

        const data = await res.json();
        _notificaciones = data.notifications || [];
        _notificacionesNoLeidas = data.noLeidas || 0;

        actualizarBadgeNotificaciones();
        return _notificaciones;
    } catch (error) {
        console.warn('⚠️ Error obteniendo notificaciones:', error.message);
        return [];
    }
};

// ============================================================
//  ACTUALIZAR BADGE
// ============================================================
function actualizarBadgeNotificaciones() {
    const badge = document.getElementById('notifBadge');
    if (!badge) return;

    if (_notificacionesNoLeidas > 0) {
        badge.textContent = _notificacionesNoLeidas > 99 ? '99+' : _notificacionesNoLeidas;
        badge.style.display = 'flex';
        badge.classList.remove('hidden');
    } else {
        badge.style.display = 'none';
        badge.classList.add('hidden');
    }
}

// ============================================================
//  MOSTRAR TOAST CON SONIDO
// ============================================================
function mostrarToastNotificacion(notificacion) {
    if (!notificacion) return;

    try {
        reproducirSonidoNotificacion();
    } catch (e) {
        console.warn('⚠️ Error reproduciendo sonido en toast:', e);
    }

    if (typeof toast === 'function') {
        const icono = getIconoNotificacion(notificacion.tipo);
        toast(`${icono} ${notificacion.titulo}: ${notificacion.mensaje}`, notificacion.tipo || 'info');
    } else {
        console.log(`🔔 ${notificacion.titulo}: ${notificacion.mensaje}`);
    }
}

// ============================================================
//  FORMATO DE FECHA
// ============================================================
function formatFechaNotificacion(fecha) {
    if (!fecha) return 'Recién';
    const ahora = new Date();
    const notifDate = new Date(fecha);
    const diffMs = ahora - notifDate;
    const diffMin = Math.floor(diffMs / 60000);
    const diffHoras = Math.floor(diffMs / 3600000);
    const diffDias = Math.floor(diffMs / 86400000);

    if (diffMin < 1) return 'Ahora mismo';
    if (diffMin < 60) return `Hace ${diffMin} min`;
    if (diffHoras < 24) return `Hace ${diffHoras} h`;
    if (diffDias === 1) return 'Ayer';
    if (diffDias < 7) return `Hace ${diffDias} días`;
    return notifDate.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// ============================================================
//  OBTENER ICONO
// ============================================================
function getIconoNotificacion(tipo) {
    const iconos = {
        info: 'ℹ️',
        success: '✅',
        warning: '⚠️',
        error: '❌',
        factura: '📄',
        cae: '🏷️',
        sistema: '⚙️',
        suscripcion: '💳',
        integracion: '🔗',
        arca: '🏛️'
    };
    return iconos[tipo] || '📬';
}

// ============================================================
//  MARCAR NOTIFICACIÓN COMO LEÍDA
// ============================================================
window.marcarNotificacionComoLeida = async function(id) {
    if (!id) return;
    try {
        const res = await fetch(`/api/notifications/${id}/read`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' }
        });
        if (res.ok) {
            const notif = _notificaciones.find(n => n._id === id);
            if (notif && !notif.leida) {
                notif.leida = true;
                _notificacionesNoLeidas = Math.max(0, _notificacionesNoLeidas - 1);
                actualizarBadgeNotificaciones();
            }
        }
    } catch (error) {
        console.warn('Error marcando notificación:', error);
    }
};

// ============================================================
//  MARCAR TODAS COMO LEÍDAS
// ============================================================
window.marcarTodasComoLeidas = async function() {
    if (_notificacionesNoLeidas === 0) return;
    try {
        const res = await fetch('/api/notifications/read-all', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' }
        });
        if (res.ok) {
            _notificaciones.forEach(n => { n.leida = true; });
            _notificacionesNoLeidas = 0;
            actualizarBadgeNotificaciones();
        }
    } catch (error) {
        console.warn('Error marcando todas:', error);
    }
};

// ============================================================
//  MOSTRAR MODAL DE NOTIFICACIONES
// ============================================================
// ============================================================
//  MOSTRAR MODAL DE NOTIFICACIONES (SIEMPRE ACTUALIZADO)
// ============================================================

window.mostrarNotificacionesCentro = async function() {
    console.log('🔔 [NOTIF] Abriendo panel de notificaciones...');
    
    // 👇 SIEMPRE OBTENER DATOS FRESCOS
    await obtenerNotificaciones();
    
    // Eliminar modales anteriores
    document.querySelectorAll('.notif-centro, .notif-overlay-koi').forEach(el => el.remove());

    const overlay = document.createElement('div');
    overlay.className = 'notif-overlay-koi';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(6,8,16,0.75);backdrop-filter:blur(8px);z-index:99998;';
    overlay.onclick = function() {
        this.remove();
        document.querySelector('.notif-centro')?.remove();
    };
    document.body.appendChild(overlay);

    // Estado vacío
    if (!_notificaciones || _notificaciones.length === 0) {
        const modal = document.createElement('div');
        modal.className = 'notif-centro';
        modal.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:400px;max-width:94vw;background:#0e1119;border:1px solid rgba(255,107,0,0.18);border-radius:18px;z-index:99999;padding:40px;text-align:center;';
        modal.innerHTML = `
            <div style="font-size:48px;margin-bottom:16px;">🔔</div>
            <div style="color:#e8e8f0;font-size:18px;font-weight:600;">No hay notificaciones</div>
            <div style="color:#6a6f82;font-size:14px;margin-top:8px;">Las notificaciones aparecerán aquí</div>
            <button onclick="this.closest('.notif-centro').remove();document.querySelector('.notif-overlay-koi')?.remove();"
                style="margin-top:20px;background:linear-gradient(135deg,#ff6b00,#e05500);border:none;border-radius:10px;color:#fff;font-weight:600;font-size:14px;cursor:pointer;padding:10px 24px;">
                Cerrar
            </button>
        `;
        document.body.appendChild(modal);
        console.log('✅ [NOTIF] Modal vacío mostrado');
        return;
    }

    const modal = document.createElement('div');
    modal.className = 'notif-centro';
    modal.style.cssText = [
        'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);',
        'width:520px;max-width:94vw;max-height:82vh;',
        'background:#0e1119;',
        'border:1px solid rgba(255,107,0,0.18);',
        'border-radius:18px;z-index:99999;',
        'box-shadow:0 32px 64px rgba(0,0,0,0.65),0 0 0 1px rgba(255,107,0,0.06);',
        'overflow:hidden;display:flex;flex-direction:column;'
    ].join('');

    // — Header —
    const header = document.createElement('div');
    header.className = 'notif-header';
    header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:20px 22px 16px;border-bottom:1px solid rgba(255,255,255,0.04);flex-shrink:0;';
    header.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;font-weight:700;font-size:16px;color:#f0f0f5;">
            <span style="font-size:18px;">🔔</span>
            Notificaciones
            <span style="background:linear-gradient(135deg,#ff6b00,#ff8c00);color:#fff;padding:3px 12px;border-radius:20px;font-size:11px;font-weight:700;box-shadow:0 2px 10px rgba(255,107,0,0.3);">
                ${_notificacionesNoLeidas || 0} nuevas
            </span>
        </div>
        <button onclick="this.closest('.notif-centro').remove();document.querySelector('.notif-overlay-koi')?.remove();"
            style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.06);color:#555a6e;width:34px;height:34px;font-size:15px;cursor:pointer;border-radius:10px;display:flex;align-items:center;justify-content:center;">
            ✕
        </button>
    `;
    modal.appendChild(header);

    // — Lista —
    const list = document.createElement('div');
    list.className = 'notif-list';
    list.style.cssText = [
        'padding:10px 8px 8px 14px;',
        'overflow-y:auto;flex:1;',
        'scrollbar-width:thin;',
        'scrollbar-color:#ff6b00 rgba(255,255,255,0.03);'
    ].join('');

    // Scrollbar webkit
    const scrollStyle = document.createElement('style');
    scrollStyle.textContent = `
        .notif-list::-webkit-scrollbar { width: 4px; }
        .notif-list::-webkit-scrollbar-track { background: rgba(255,255,255,0.03); border-radius: 4px; margin: 8px 0; }
        .notif-list::-webkit-scrollbar-thumb { background: #ff6b00; border-radius: 4px; }
        .notif-list::-webkit-scrollbar-thumb:hover { background: #ff8c00; }
    `;
    document.head.appendChild(scrollStyle);

    const iconColorMap = {
        success: { color: '#ff8c00', bg: 'rgba(255,140,0,0.10)' },
        warning: { color: '#ff6b00', bg: 'rgba(255,107,0,0.10)' },
        error: { color: '#f87171', bg: 'rgba(248,113,113,0.10)' },
        info: { color: '#63b3ed', bg: 'rgba(99,179,237,0.10)' }
    };
    const iconEmojiMap = { success: '✅', warning: '⚠️', error: '❌', info: 'ℹ️' };

    _notificaciones.forEach(n => {
        const isUnread = !n.leida;
        const tipo = n.tipo || 'info';
        const { color, bg } = iconColorMap[tipo] || iconColorMap.info;

        const item = document.createElement('div');
        item.className = `notif-item${isUnread ? ' unread' : ''}`;
        item.style.cssText = [
            'display:flex;align-items:flex-start;gap:12px;',
            'padding:12px 14px;',
            isUnread ? 'padding-left:18px;' : '',
            'margin-bottom:4px;border-radius:12px;cursor:pointer;',
            'transition:background 0.2s;position:relative;',
            isUnread
                ? 'background:rgba(255,107,0,0.035);border:1px solid rgba(255,107,0,0.08);'
                : 'border:1px solid transparent;'
        ].join('');

        if (isUnread) {
            const bar = document.createElement('div');
            bar.style.cssText = 'position:absolute;top:10px;left:0;bottom:10px;width:3px;background:linear-gradient(180deg,rgba(255,107,0,0.2),rgba(255,140,0,0.7),rgba(255,107,0,0.2));border-radius:0 3px 3px 0;';
            item.appendChild(bar);
        }

        item.innerHTML += `
            <div style="width:36px;height:36px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0;background:${bg};color:${color};">
                ${iconEmojiMap[tipo] || 'ℹ️'}
            </div>
            <div style="flex:1;min-width:0;">
                <div style="font-weight:600;font-size:13.5px;color:#e8e8f0;margin-bottom:2px;">${n.titulo || 'Sin título'}</div>
                <div style="font-size:12.5px;color:#6a6f82;line-height:1.5;">${n.mensaje || ''}</div>
                <div style="font-size:11px;color:#3d4055;margin-top:4px;font-weight:500;">${formatFechaNotificacion(n.fechaCreacion)}</div>
            </div>
            ${isUnread ? '<div style="width:7px;height:7px;background:#ff6b00;border-radius:50%;flex-shrink:0;margin-top:9px;box-shadow:0 0 8px rgba(255,107,0,0.5);"></div>' : ''}
        `;

        item.addEventListener('mouseenter', () => {
            item.style.background = isUnread
                ? 'rgba(255,107,0,0.07)'
                : 'rgba(255,255,255,0.04)';
        });
        item.addEventListener('mouseleave', () => {
            item.style.background = isUnread
                ? 'rgba(255,107,0,0.035)'
                : 'transparent';
        });

        item.onclick = () => {
            marcarNotificacionComoLeida(n._id);
            setTimeout(() => {
                document.querySelector('.notif-centro')?.remove();
                document.querySelector('.notif-overlay-koi')?.remove();
                mostrarNotificacionesCentro();
            }, 300);
        };

        list.appendChild(item);
    });

    modal.appendChild(list);

    // — Footer —
    const footer = document.createElement('div');
    footer.className = 'notif-footer';
    footer.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:12px 22px 18px;border-top:1px solid rgba(255,255,255,0.04);background:rgba(0,0,0,0.15);flex-shrink:0;flex-wrap:wrap;gap:8px;';
    footer.innerHTML = `
        <span style="font-size:12.5px;color:#4a4f62;font-weight:500;">
            ${_notificaciones.length} notificaciones · ${_notificacionesNoLeidas || 0} sin leer
        </span>
        <div style="display:flex;gap:8px;">
            <button onclick="marcarTodasComoLeidas().then(()=>{setTimeout(()=>{document.querySelector('.notif-centro')?.remove();document.querySelector('.notif-overlay-koi')?.remove();mostrarNotificacionesCentro();},300)})"
                style="background:linear-gradient(135deg,#ff6b00,#e05500);border:none;border-radius:10px;color:#fff;font-weight:600;font-size:12.5px;cursor:pointer;padding:8px 18px;box-shadow:0 2px 10px rgba(255,107,0,0.2);">
                ✓ Marcar todas
            </button>
            <button onclick="this.closest('.notif-centro').remove();document.querySelector('.notif-overlay-koi')?.remove();"
                style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:10px;color:#55596a;font-weight:500;font-size:12.5px;cursor:pointer;padding:8px 18px;">
                Cerrar
            </button>
        </div>
    `;
    modal.appendChild(footer);

    document.body.appendChild(modal);
    console.log('✅ [NOTIF] Modal mostrado con', _notificaciones.length, 'notificaciones');
};
// ============================================================
//  POLLING DE NOTIFICACIONES
// ============================================================
function iniciarPollingNotificaciones() {
    if (_pollingInterval) {
        clearInterval(_pollingInterval);
        _pollingInterval = null;
    }

    obtenerNotificaciones();

    _pollingInterval = setInterval(async () => {
        try {
            const res = await fetch('/api/notifications', {
                credentials: 'include',
                headers: { 'Cache-Control': 'no-cache' }
            });

            if (!res.ok) return;

            const data = await res.json();
            const nuevasNotificaciones = data.notificaciones || [];
            const nuevasNoLeidas = data.noLeidas || 0;

            const idsActuales = new Set(_notificaciones.map(n => n._id));
            const notificacionesNuevas = nuevasNotificaciones.filter(n => !idsActuales.has(n._id));

            _notificaciones = nuevasNotificaciones;
            const cambioNoLeidas = nuevasNoLeidas - _notificacionesNoLeidas;
            _notificacionesNoLeidas = nuevasNoLeidas;

            actualizarBadgeNotificaciones();

            if (cambioNoLeidas > 0) {
                notificacionesNuevas
                    .filter(n => !n.leida)
                    .forEach(n => mostrarToastNotificacion(n));
            }

            const panel = document.getElementById('notifPanel');
            if (panel && panel.classList.contains('open')) {
                renderizarNotificacionesEnPanel(_notificaciones);
            }

        } catch (error) {
            console.warn('⚠️ Error en polling de notificaciones:', error.message);
        }
    }, NOTIFICACIONES_POLLING_INTERVAL);
}

// ============================================================
//  INICIALIZAR
// ============================================================
function initSistemaNotificaciones() {
    console.log('🔔 Inicializando sistema de notificaciones...');
    obtenerNotificaciones();

    const notifBtn = document.getElementById('notifBtn');
    if (notifBtn) {
        const newBtn = notifBtn.cloneNode(true);
        notifBtn.parentNode.replaceChild(newBtn, notifBtn);
        newBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            mostrarNotificacionesCentro();
        });
        console.log('✅ Botón de notificaciones configurado');
    }

    iniciarPollingNotificaciones();
    console.log('✅ Sistema de notificaciones inicializado');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(initSistemaNotificaciones, 500));
} else {
    setTimeout(initSistemaNotificaciones, 500);
}
// ============================================================
//  INICIALIZAR FILTRO "TODOS" EN COMPROBANTES
// ============================================================

function initFiltroTodos() {
    // Asegurar que _filtroTipo sea 'todos'
    if (typeof _filtroTipo !== 'undefined') {
        _filtroTipo = 'todos';
    }
    
    // Activar visualmente el botón "Todos"
    document.querySelectorAll('.filtro-btn').forEach(b => b.classList.remove('active'));
    const btnTodos = document.querySelector('.filtro-btn#ftodos') || 
                     document.querySelector('.filtro-btn[onclick*="todos"]') ||
                     document.querySelector('.filtro-btn:first-child');
    if (btnTodos) {
        btnTodos.classList.add('active');
        console.log('✅ Filtro "Todos" activado por defecto');
    }
    
    // Recargar comprobantes si la función existe
    if (typeof cargarTodosComprobantes === 'function') {
        cargarTodosComprobantes(1, '');
    }
}


// Ejecutar al cargar la página
document.addEventListener('DOMContentLoaded', function() {
    setTimeout(function() {
        const vistaComprobantes = document.getElementById('vista-comprobantes');
        if (vistaComprobantes && vistaComprobantes.style.display !== 'none') {
            initFiltroTodos();
        }
    }, 500);
});
// ============================================================
//  REPORTE MENSUAL PARA EL CONTADOR
//  Agregar al final de index.js
// ============================================================

let _reporteMes = new Date().getMonth();
let _reporteAnio = new Date().getFullYear();
let _reporteDatos = null;
let _reporteComprobantes = [];

// Cargar reporte
async function cargarReporte() {
  console.log('📊 Cargando reporte mensual...');
  await cargarDatosUsuarioReporte();
  await cargarDatosReporte();
}

// Cargar datos del usuario
async function cargarDatosUsuarioReporte() {
  try {
    const res = await fetch('/api/me', { credentials: 'include' });
    const data = await res.json();
    const user = data.user;
    const settings = user?.settings || {};
    
    const nombreNegocio = user?.nombre || settings?.razonSocial || 'Mi Negocio';
    const cuit = settings?.cuit || 'XX-XXXXXXXX-X';
    const categoria = settings?.categoria || 'C';
    const condicionFiscal = settings?.condicionFiscal || 'responsable_inscripto';
    
    const elNegocio = document.getElementById('rptNegocioNombre');
    const elCondicion = document.getElementById('rptCondicionFiscal');
    const elSubtitle = document.getElementById('rptDocSubtitle');
    const elNotaNegocio = document.getElementById('rptNotaNegocio');
    const elCatLimite = document.getElementById('rptCatLimiteLabel');
    
    if (elNegocio) elNegocio.textContent = `${nombreNegocio} · Categoría ${categoria}`;
    if (elCondicion) elCondicion.textContent = condicionFiscal === 'monotributo' ? 'Monotributista' : 'Responsable Inscripto';
    if (elSubtitle) elSubtitle.textContent = `${nombreNegocio} · CUIT ${cuit} · ${condicionFiscal === 'monotributo' ? 'Monotributista Cat. ' + categoria : 'Responsable Inscripto'}`;
    if (elNotaNegocio) elNotaNegocio.textContent = nombreNegocio;
    if (elCatLimite) elCatLimite.textContent = categoria;
    
    window._reporteUsuario = { nombreNegocio, cuit, categoria, condicionFiscal };
    
  } catch (error) {
    console.error('Error cargando usuario:', error);
  }
}

// Cargar datos del reporte
async function cargarDatosReporte() {
  const mes = _reporteMes;
  const anio = _reporteAnio;
  
  // 👇 SINCRONIZAR CON window
  window._reporteMes = mes;
  window._reporteAnio = anio;
  console.log(`📊 Reporte cargado para: ${mes + 1}/${anio}`);
  
  // 🔥 SINCRONIZAR EL BOTÓN ACTIVO CON window._reporteMes
  const btnActivo = document.querySelector('.month-btn-report.active');
  if (btnActivo) {
    const mesActual = btnActivo.getAttribute('data-mes');
    if (mesActual !== null && parseInt(mesActual) !== mes) {
      console.log(`🔧 Sincronizando botón: data-mes ${mesActual} → ${mes}`);
      btnActivo.setAttribute('data-mes', mes);
      btnActivo.setAttribute('data-anio', anio);
    }
  } else {
    // Si no hay botón activo, buscar el que corresponde al mes
    document.querySelectorAll('.month-btn-report').forEach(btn => {
      const btnMes = btn.getAttribute('data-mes');
      if (btnMes !== null && parseInt(btnMes) === mes) {
        btn.classList.add('active');
        btn.setAttribute('data-anio', anio);
        console.log(`🔧 Activando botón para mes ${mes + 1}`);
      } else {
        btn.classList.remove('active');
      }
    });
  }
  
  const fechaInicio = new Date(anio, mes, 1);
  const fechaFin = new Date(anio, mes + 1, 0);
  
  const desde = fechaInicio.toISOString().split('T')[0];
  const hasta = fechaFin.toISOString().split('T')[0];
  
  const nombreMes = fechaInicio.toLocaleString('es-AR', { month: 'long', year: 'numeric' });
  const mesCapitalizado = nombreMes.charAt(0).toUpperCase() + nombreMes.slice(1);
  
  const elPeriodTitle = document.getElementById('rptPeriodTitle');
  const elDocTitle = document.getElementById('rptDocTitle');
  const elTableMes = document.getElementById('rptTableMes');
  
  if (elPeriodTitle) elPeriodTitle.textContent = mesCapitalizado;
  if (elDocTitle) elDocTitle.textContent = `Reporte de ${mesCapitalizado}`;
  if (elTableMes) elTableMes.textContent = mesCapitalizado;
  
  try {
    const ordersRes = await fetch(`/api/orders?desde=${desde}&hasta=${hasta}&limit=200`, { credentials: 'include' });
    const ordersData = await ordersRes.json();
    const orders = ordersData.orders || [];
    
    const statsRes = await fetch('/api/stats/dashboard', { credentials: 'include' });
    const statsData = await statsRes.json();
    
    const comprobantes = orders.filter(o => o.status === 'invoiced' || o.caeNumber);
    const pendientes = orders.filter(o => o.status === 'pending_invoice' || o.status === 'error_afip');
    
    const totalFacturado = comprobantes.reduce((sum, o) => sum + (o.amount || 0), 0);
    const totalPendientes = pendientes.length;
    
    const acumulado12 = statsData.facturacionAcumulada || 0;
    const limiteCategoria = statsData.limiteAnual || 21113697;
    const porcentaje = limiteCategoria > 0 ? (acumulado12 / limiteCategoria) * 100 : 0;
    const margen = limiteCategoria - acumulado12;
    const categoria = statsData.categoria || window._reporteUsuario?.categoria || 'C';
    
    const elTotalFacturado = document.getElementById('rptTotalFacturado');
    const elTotalComprobantes = document.getElementById('rptTotalComprobantes');
    const elAcumulado = document.getElementById('rptAcumulado');
    const elPorcentajeCategoria = document.getElementById('rptPorcentajeCategoria');
    const elPendientesCAE = document.getElementById('rptPendientesCAE');
    
    if (elTotalFacturado) elTotalFacturado.textContent = `$${totalFacturado.toLocaleString()}`;
    if (elTotalComprobantes) elTotalComprobantes.textContent = `${comprobantes.length} comprobantes`;
    if (elAcumulado) elAcumulado.textContent = `$${acumulado12.toLocaleString()}`;
    if (elPorcentajeCategoria) elPorcentajeCategoria.textContent = `${porcentaje.toFixed(1)}% del límite Cat. ${categoria}`;
    if (elPendientesCAE) elPendientesCAE.textContent = totalPendientes;
    
    const elCatFacturado = document.getElementById('rptCatFacturado');
    const elCatLimite = document.getElementById('rptCatLimite');
    const elCatProgress = document.getElementById('rptCatProgress');
    const elCatPct = document.getElementById('rptCatPct');
    
    if (elCatFacturado) elCatFacturado.textContent = `$${acumulado12.toLocaleString()}`;
    if (elCatLimite) elCatLimite.textContent = `$${limiteCategoria.toLocaleString()}`;
    if (elCatProgress) elCatProgress.style.width = `${Math.min(porcentaje, 100)}%`;
    if (elCatPct) elCatPct.textContent = `${porcentaje.toFixed(1)}% utilizado · Margen disponible: $${margen.toLocaleString()}`;
    
    renderizarTablaReporte(comprobantes);
    
    _reporteDatos = {
      mes: mesCapitalizado,
      anio,
      totalFacturado,
      totalComprobantes: comprobantes.length,
      acumulado12,
      limiteCategoria,
      porcentaje,
      margen,
      categoria,
      comprobantes,
      pendientes: totalPendientes
    };
    
  } catch (error) {
    console.error('Error cargando datos del reporte:', error);
    const loading = document.getElementById('rptLoadingComprobantes');
    if (loading) loading.innerHTML = '❌ Error al cargar los datos';
  }
}

// Renderizar tabla de comprobantes
function renderizarTablaReporte(comprobantes) {
  const tbody = document.getElementById('rptComprobantesBody');
  const loading = document.getElementById('rptLoadingComprobantes');
  const table = document.getElementById('rptComprobantesTable');
  
  if (!comprobantes || comprobantes.length === 0) {
    if (loading) {
      loading.style.display = 'block';
      loading.innerHTML = 'No hay comprobantes emitidos en este período';
    }
    if (table) table.style.display = 'none';
    return;
  }
  
  if (loading) loading.style.display = 'none';
  if (table) table.style.display = 'table';
  
  let html = '';
  let total = 0;
  
  comprobantes.forEach((o, i) => {
    const monto = o.amount || 0;
    total += monto;
    const nroComp = o.nroFormatted || o.externalId || '—';
    const cliente = o.customerName || 'Sin nombre';
    const caeDisplay = o.caeNumber || '—';
    const caeVto = o.caeExpiry ? new Date(o.caeExpiry).toLocaleDateString('es-AR') : '—';
    const altClass = i % 2 === 0 ? '' : 'alt';
    
    html += `
      <tr class="${altClass}">
        <td>${nroComp}</td>
        <td>${cliente}</td>
        <td class="mono">${caeDisplay}</td>
        <td class="date">${caeVto}</td>
        <td>$${monto.toLocaleString()}</td>
      </tr>
    `;
  });
  
  html += `
    <tr class="total">
      <td colspan="4">Total del período</td>
      <td>$${total.toLocaleString()}</td>
    </tr>
  `;
  
  if (tbody) tbody.innerHTML = html;
}

function cambiarMesReporte(mes, btn) {
    console.log(`📅 Cambiando a: ${mes + 1} (${btn.textContent.trim()})`);
    
    // Actualizar variables globales
    const anio = new Date().getFullYear();
    window._reporteMes = mes;
    window._reporteAnio = anio;
    _reporteMes = mes;
    _reporteAnio = anio;
    
    // Actualizar UI de botones
    document.querySelectorAll('.month-btn-report').forEach(b => b.classList.remove('active'));
    if (btn) {
        btn.classList.add('active');
        // 👇 FORZAR la actualización de data-mes y data-anio
        btn.setAttribute('data-mes', mes);
        btn.setAttribute('data-anio', anio);
    }
    
    console.log(`✅ window._reporteMes = ${window._reporteMes}, window._reporteAnio = ${window._reporteAnio}`);
    
    const ahora = new Date();
    if (mes > ahora.getMonth() && anio === ahora.getFullYear()) {
        console.log('⚠️ Mes futuro, no hay datos');
        if (typeof toast === 'function') {
            toast('📅 No hay datos para meses futuros', 'warn');
        }
        return;
    }
    
    // Recargar datos del reporte
    cargarDatosReporte();
}

// Actualizar preview
function actualizarPreviewReporte() {
  const chkComp = document.getElementById('rptChkComprobantes');
  const chkCat = document.getElementById('rptChkCategoria');
  const chkNC = document.getElementById('rptChkNC');
  
  const seccionComp = document.getElementById('rptSeccionComprobantes');
  const seccionCat = document.getElementById('rptSeccionCategoria');
  
  if (seccionComp) seccionComp.style.display = chkComp?.checked ? '' : 'none';
  if (seccionCat) seccionCat.style.display = chkCat?.checked ? '' : 'none';
  
  // Notas de crédito
  const rows = document.querySelectorAll('#rptComprobantesBody tr');
  rows.forEach(row => {
    if (row.classList.contains('total')) return;
    const firstTd = row.querySelector('td');
    if (firstTd) {
      const isNC = firstTd.textContent?.startsWith('NC');
      if (isNC) {
        row.style.display = chkNC?.checked ? '' : 'none';
      }
    }
  });
}

// Actualizar nota
function actualizarNotaReporte() {
  const texto = document.getElementById('rptNotaContador')?.value.trim() || '';
  const seccion = document.getElementById('rptSeccionNota');
  const preview = document.getElementById('rptNotaPreview');
  
  if (seccion && preview) {
    if (texto) {
      preview.textContent = texto;
      seccion.style.display = '';
    } else {
      seccion.style.display = 'none';
    }
  }
}

// Editar contador
function editarContador() {
  alert('Podés cambiar el email del contador en Configuración > Contador');
}

// ============================================================
//  ENVIAR REPORTE AL CONTADOR - VERSIÓN CORREGIDA
//  Usa el mes seleccionado en la UI (botón activo)
// ============================================================

async function enviarReporteContador() {
  const btn = document.getElementById('rptBtnEnviar');
  if (!btn) return;
  
  const originalText = btn.innerHTML;
  
  btn.disabled = true;
  btn.innerHTML = '<span class="material-icons" style="font-size:16px;animation:spin 1s linear infinite;">sync</span> Enviando...';
  
  try {
    // 👇 1. OBTENER EL MES DESDE EL BOTÓN ACTIVO (FUENTE DE VERDAD)
    let mesSeleccionado = null;
    let anioSeleccionado = new Date().getFullYear();
    
    // Buscar el botón de mes activo en la UI
    const btnActivo = document.querySelector('.month-btn-report.active');
    if (btnActivo) {
      const mesAttr = btnActivo.getAttribute('data-mes');
      if (mesAttr !== null) {
        mesSeleccionado = parseInt(mesAttr);
        console.log(`📊 Mes seleccionado desde UI: ${mesSeleccionado + 1}`);
      }
    }
    
    // Si no se encontró en la UI, usar window._reporteMes
    if (mesSeleccionado === null) {
      mesSeleccionado = window._reporteMes !== undefined ? window._reporteMes : new Date().getMonth();
      console.log(`📊 Mes desde window._reporteMes: ${mesSeleccionado + 1}`);
    }
    
    // 👇 2. OBTENER EL AÑO (también desde la UI)
    if (btnActivo) {
      const anioAttr = btnActivo.getAttribute('data-anio');
      if (anioAttr) {
        anioSeleccionado = parseInt(anioAttr);
      }
    }
    
    // Si no hay año en la UI, usar window._reporteAnio
    if (anioSeleccionado === new Date().getFullYear() && window._reporteAnio !== undefined) {
      anioSeleccionado = window._reporteAnio;
    }
    
    console.log(`📤 Enviando reporte para: ${mesSeleccionado + 1}/${anioSeleccionado}`);
    
    // 👇 3. OBTENER EL RESTO DE LOS DATOS
    const nota = document.getElementById('rptNotaContador')?.value?.trim() || '';
    const emailContador = document.getElementById('rptContadorEmailInput')?.value?.trim() || '';
    const nombreContador = document.getElementById('rptContadorNombreInput')?.value?.trim() || '';
    
    const incluirComprobantes = document.getElementById('rptChkComprobantes')?.checked ?? true;
    const incluirCategoria = document.getElementById('rptChkCategoria')?.checked ?? true;
    const incluirNC = document.getElementById('rptChkNC')?.checked ?? false;
    
    // Validar email
    if (!emailContador || !emailContador.includes('@')) {
      if (typeof toast === 'function') toast('⚠️ Configurá el email del contador', 'error');
      btn.disabled = false;
      btn.innerHTML = originalText;
      return;
    }
    
    // 👇 4. CONSTRUIR PAYLOAD CON EL MES CORRECTO
    const reporteData = {
      mes: mesSeleccionado,  // 0 = Enero, 1 = Febrero, etc.
      anio: anioSeleccionado,
      nota: nota,
      contadorEmail: emailContador,
      contadorNombre: nombreContador,
      incluirComprobantes: incluirComprobantes,
      incluirCategoria: incluirCategoria,
      incluirNC: incluirNC
    };
    
    console.log('📤 Payload final:', reporteData);
    
    const res = await fetch('/api/reports/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(reporteData)
    });
    
    const data = await res.json();
    
    if (data.ok) {
      const nombreMes = new Date(anioSeleccionado, mesSeleccionado, 1).toLocaleString('es-AR', { month: 'long' });
      if (typeof toast === 'function') {
        toast(`✅ Reporte de ${nombreMes} ${anioSeleccionado} enviado a ${emailContador}`, 'success');
      }
      
      btn.innerHTML = '<span class="material-icons" style="font-size:16px;">check</span> Reporte enviado';
      btn.style.background = 'rgba(61,184,122,0.2)';
      btn.style.border = '1px solid rgba(61,184,122,0.3)';
      btn.style.color = '#3db87a';
      
      const ultimoEnvio = document.getElementById('rptUltimoEnvio');
      if (ultimoEnvio) {
        const nombreMesCapitalizado = nombreMes.charAt(0).toUpperCase() + nombreMes.slice(1);
        ultimoEnvio.textContent = `${nombreMesCapitalizado} ${anioSeleccionado} - ${new Date().toLocaleString('es-AR')}`;
      }
      
      setTimeout(() => {
        btn.style.background = '';
        btn.style.border = '';
        btn.style.color = '';
        btn.innerHTML = originalText;
        btn.disabled = false;
      }, 3000);
    } else {
      throw new Error(data.error || 'Error al enviar');
    }
  } catch (error) {
    console.error('Error enviando reporte:', error);
    if (typeof toast === 'function') toast('❌ Error al enviar: ' + error.message, 'error');
    
    btn.innerHTML = '<span class="material-icons" style="font-size:16px;">error</span> Error al enviar';
    btn.style.background = 'rgba(239,68,68,0.2)';
    btn.style.border = '1px solid rgba(239,68,68,0.3)';
    btn.style.color = '#f87171';
    
    setTimeout(() => {
      btn.style.background = '';
      btn.style.border = '';
      btn.style.color = '';
      btn.innerHTML = originalText;
      btn.disabled = false;
    }, 3000);
  }
}
// Inicializar reporte
function initReporte() {
  const vistaReporte = document.getElementById('vista-reporte');
  if (vistaReporte && vistaReporte.style.display !== 'none') {
    cargarReporte();
  }
}
// ============================================================
//  CONTADOR - VERSIÓN CON INPUTS (DEFINITIVA)
// ============================================================

// === CARGAR DATOS DEL CONTADOR EN LOS INPUTS ===
async function cargarContadorInputs() {
    try {
        const res = await fetch('/api/me', { credentials: 'include' });
        const data = await res.json();
        const user = data.user;
        const email = user?.settings?.contadorEmail || '';
        const nombre = user?.settings?.contadorNombre || '';
        
        const nombreInput = document.getElementById('rptContadorNombreInput');
        const emailInput = document.getElementById('rptContadorEmailInput');
        const avatarEl = document.getElementById('rptContadorAvatar');
        
        if (nombreInput) {
            nombreInput.value = nombre || 'Carlos García';
        }
        if (emailInput) {
            emailInput.value = email || 'cargar email del contador';
        }
        if (avatarEl) {
            const nombreMostrar = nombre || 'C';
            avatarEl.textContent = nombreMostrar.charAt(0).toUpperCase();
        }
        console.log('✅ Contador cargado en inputs:', { nombre, email });
    } catch (e) {
        console.error('Error cargando contador:', e);
    }
}

// === GUARDAR CONTADOR DESDE INPUTS ===
async function guardarContadorInputs() {
    const nombreInput = document.getElementById('rptContadorNombreInput');
    const emailInput = document.getElementById('rptContadorEmailInput');
    const msg = document.getElementById('contadorGuardadoMsg');
    const btn = document.getElementById('btnGuardarContador');
    
    const nombre = nombreInput?.value?.trim() || '';
    const email = emailInput?.value?.trim() || '';
    
    if (!email || !email.includes('@')) {
        if (typeof toast === 'function') toast('❌ Email inválido', 'error');
        if (msg) {
            msg.textContent = '❌ Email inválido';
            msg.style.color = '#f87171';
            msg.style.display = 'inline';
            setTimeout(() => { msg.style.display = 'none'; }, 3000);
        }
        return;
    }
    
    if (!nombre) {
        if (typeof toast === 'function') toast('❌ Ingresá un nombre', 'error');
        return;
    }
    
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '⏳ Guardando...';
    }
    
    try {
        const res = await fetch('/api/me/settings', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                contadorEmail: email,
                contadorNombre: nombre
            })
        });
        
        const data = await res.json();
        
        if (data.ok) {
            if (typeof toast === 'function') toast('✅ Contador guardado', 'success');
            if (msg) {
                msg.textContent = '✅ Guardado';
                msg.style.color = '#00e676';
                msg.style.display = 'inline';
                setTimeout(() => { msg.style.display = 'none'; }, 3000);
            }
            const avatarEl = document.getElementById('rptContadorAvatar');
            if (avatarEl) {
                avatarEl.textContent = nombre.charAt(0).toUpperCase();
            }
            console.log('✅ Contador guardado:', { nombre, email });
        } else {
            throw new Error(data.error || 'Error al guardar');
        }
    } catch (e) {
        console.error('❌ Error:', e);
        if (typeof toast === 'function') toast('❌ Error al guardar', 'error');
        if (msg) {
            msg.textContent = '❌ Error';
            msg.style.color = '#f87171';
            msg.style.display = 'inline';
            setTimeout(() => { msg.style.display = 'none'; }, 3000);
        }
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M2 7l3 3 7-7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                Guardar contador
            `;
        }
    }
}

// === CONECTAR BOTÓN GUARDAR ===
function conectarBotonGuardarContador() {
    const btn = document.getElementById('btnGuardarContador');
    if (btn) {
        btn.onclick = guardarContadorInputs;
        console.log('✅ Botón guardar contador conectado');
    }
}

// === INICIALIZAR CONTADOR CON INPUTS ===
function initContadorInputs() {
    console.log('🔧 Inicializando contador con inputs...');
    cargarContadorInputs();
    conectarBotonGuardarContador();
}

// === INICIALIZAR REPORTE COMPLETO (con inputs) ===
function initReporteCompleto() {
    console.log('📊 Inicializando reporte completo...');
    initContadorInputs();
    
    const btn = document.getElementById('rptBtnEnviar');
    if (btn) {
        // Remover onclick del HTML si existe
        btn.removeAttribute('onclick');
        
        // Remover event listeners anteriores
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);
        
        newBtn.addEventListener('click', async function(e) {
            e.preventDefault();
            e.stopPropagation();
            
            console.log('🖱️ Click en ENVIAR REPORTE');
            
            // 👇 1. OBTENER MES (PRIORIDAD: window._reporteMes)
            let mesSeleccionado = null;
            let anioSeleccionado = new Date().getFullYear();
            
            // 🔥 PRIORIDAD 1: window._reporteMes (actualizado por cambiarMesReporte)
            if (window._reporteMes !== undefined && window._reporteMes !== null) {
                mesSeleccionado = window._reporteMes;
                console.log(`📊 Usando window._reporteMes: ${mesSeleccionado + 1}`);
            }
            
            // 🔥 PRIORIDAD 2: data-mes del botón activo
            if (mesSeleccionado === null) {
                const btnActivo = document.querySelector('.month-btn-report.active');
                if (btnActivo) {
                    const mesAttr = btnActivo.getAttribute('data-mes');
                    if (mesAttr !== null) {
                        mesSeleccionado = parseInt(mesAttr);
                        console.log(`📊 Usando data-mes del botón: ${mesSeleccionado + 1}`);
                    } else {
                        // Si no tiene data-mes, extraer del texto
                        const texto = btnActivo.textContent.trim();
                        const mesesMap = {
                            'Ene': 0, 'Feb': 1, 'Mar': 2, 'Abr': 3,
                            'May': 4, 'Jun': 5, 'Jul': 6, 'Ago': 7,
                            'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dic': 11
                        };
                        if (mesesMap[texto] !== undefined) {
                            mesSeleccionado = mesesMap[texto];
                            console.log(`📊 Mes extraído del texto: ${texto} → ${mesSeleccionado + 1}`);
                        }
                    }
                }
            }
            
            // 🔥 PRIORIDAD 3: fallback - mes actual
            if (mesSeleccionado === null) {
                mesSeleccionado = new Date().getMonth();
                console.log(`📊 Usando mes actual (fallback): ${mesSeleccionado + 1}`);
            }
            
            // Año
            if (window._reporteAnio !== undefined && window._reporteAnio !== null) {
                anioSeleccionado = window._reporteAnio;
            } else {
                const btnActivo = document.querySelector('.month-btn-report.active');
                if (btnActivo) {
                    const anioAttr = btnActivo.getAttribute('data-anio');
                    if (anioAttr !== null) {
                        anioSeleccionado = parseInt(anioAttr);
                    }
                }
            }
            
            const nombreMes = new Date(anioSeleccionado, mesSeleccionado, 1).toLocaleString('es-AR', { month: 'long' });
            console.log(`✅ MES FINAL SELECCIONADO: ${mesSeleccionado + 1} (${nombreMes}) ${anioSeleccionado}`);
            
            // 👇 2. LEER EL RESTO DE LOS DATOS
            const emailInput = document.getElementById('rptContadorEmailInput');
            const email = emailInput?.value?.trim() || '';
            const nombreContador = document.getElementById('rptContadorNombreInput')?.value?.trim() || '';
            const nota = document.getElementById('rptNotaContador')?.value?.trim() || '';
            
            const incluirComprobantes = document.getElementById('rptChkComprobantes')?.checked ?? true;
            const incluirCategoria = document.getElementById('rptChkCategoria')?.checked ?? true;
            const incluirNC = document.getElementById('rptChkNC')?.checked ?? false;
            
            if (!email || !email.includes('@')) {
                if (typeof toast === 'function') toast('⚠️ Configurá el email del contador', 'error');
                emailInput?.focus();
                return;
            }
            
            const originalText = this.innerHTML;
            this.disabled = true;
            this.innerHTML = '<span style="animation:spin 1s linear infinite;">🔄</span> Enviando...';
            this.style.opacity = '0.7';
            
            try {
                // 👇 3. CONSTRUIR PAYLOAD
                const payload = {
                    contadorEmail: email,
                    contadorNombre: nombreContador,
                    nota: nota,
                    mes: mesSeleccionado,
                    anio: anioSeleccionado,
                    incluirComprobantes: incluirComprobantes,
                    incluirCategoria: incluirCategoria,
                    incluirNC: incluirNC
                };
                
                console.log('📤 Enviando payload:', payload);
                
                const res = await fetch('/api/reports/send', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify(payload)
                });
                
                const data = await res.json();
                console.log('📥 Respuesta:', data);
                
                if (data.ok) {
                    const nombreMesCapitalizado = nombreMes.charAt(0).toUpperCase() + nombreMes.slice(1);
                    
                    if (typeof toast === 'function') {
                        toast(`✅ Reporte de ${nombreMesCapitalizado} ${anioSeleccionado} enviado a ${email}`, 'success');
                    }
                    
                    this.innerHTML = '✅ Enviado';
                    this.style.background = 'rgba(0,230,118,0.15)';
                    this.style.border = '1px solid rgba(0,230,118,0.3)';
                    this.style.color = '#00e676';
                    
                    const ultimoEnvio = document.getElementById('rptUltimoEnvio');
                    if (ultimoEnvio) {
                        ultimoEnvio.textContent = `${nombreMesCapitalizado} ${anioSeleccionado} - ${new Date().toLocaleString('es-AR')}`;
                    }
                    
                    setTimeout(() => {
                        this.innerHTML = originalText;
                        this.style.background = '';
                        this.style.border = '';
                        this.style.color = '';
                        this.disabled = false;
                        this.style.opacity = '1';
                    }, 3000);
                } else {
                    throw new Error(data.error || 'Error al enviar');
                }
            } catch (error) {
                console.error('❌ Error:', error);
                if (typeof toast === 'function') toast('❌ Error al enviar: ' + error.message, 'error');
                this.innerHTML = '❌ Error';
                this.style.background = 'rgba(239,68,68,0.15)';
                this.style.border = '1px solid rgba(239,68,68,0.3)';
                this.style.color = '#f87171';
                
                setTimeout(() => {
                    this.innerHTML = originalText;
                    this.style.background = '';
                    this.style.border = '';
                    this.style.color = '';
                    this.disabled = false;
                    this.style.opacity = '1';
                }, 3000);
            }
        });
        
        console.log('✅ Botón Enviar reporte conectado');
    } else {
        console.warn('⚠️ Botón rptBtnEnviar no encontrado');
    }
    
    console.log('✅ Reporte completo inicializado');
}
// ── FILTROS ──
let filtrosActivos = {
  plataforma: [],
  estado: ['emitido'],
  tipo: ['factura_c'],
  emision: ['automatica'],
  envio: [],  // 
  fechaDesde: '',
  fechaHasta: ''
};

function abrirModalFiltros() {
    console.log('🟢 abrirModalFiltros() ejecutada');
    
    const modal = document.getElementById('modalFiltros');
    const overlay = document.getElementById('modalFiltrosOverlay');
    
    if (modal && overlay) {
        // SOLO AGREGAR LA CLASE - EL CSS HACE EL RESTO
        modal.classList.add('open');
        overlay.classList.add('open');
        console.log('✅ Clases .open agregadas');
        
        sincronizarCheckboxes();
    } else {
        console.error('❌ Modal o overlay no encontrados');
    }
}

function cerrarModalFiltros() {
    console.log('🔴 cerrarModalFiltros() ejecutada');
    
    const modal = document.getElementById('modalFiltros');
    const overlay = document.getElementById('modalFiltrosOverlay');
    
    if (modal && overlay) {
        // SOLO REMOVER LA CLASE - EL CSS HACE EL RESTO
        modal.classList.remove('open');
        overlay.classList.remove('open');
        console.log('✅ Clases .open removidas');
    }
    
    aplicarFiltros();
}

function sincronizarCheckboxes() {
  // Plataformas
  document.querySelectorAll('.filtro-plataforma input').forEach(cb => {
    cb.checked = filtrosActivos.plataforma.includes(cb.value);
  });
  
  // Estados
  document.querySelectorAll('.filtro-check[data-estado] input').forEach(cb => {
    cb.checked = filtrosActivos.estado.includes(cb.value);
  });
  
  // Tipos
  document.querySelectorAll('.filtro-check[data-tipo] input').forEach(cb => {
    cb.checked = filtrosActivos.tipo.includes(cb.value);
  });
  
  // Emisión
  document.querySelectorAll('.filtro-check[data-emision] input').forEach(cb => {
    cb.checked = filtrosActivos.emision.includes(cb.value);
  });
  
  // 👇 NUEVO: Envío
  document.querySelectorAll('.filtro-check[data-envio] input').forEach(cb => {
    cb.checked = filtrosActivos.envio.includes(cb.value);
  });
  
  // Fechas
  const desde = document.getElementById('filtroFechaDesde');
  const hasta = document.getElementById('filtroFechaHasta');
  if (desde) desde.value = filtrosActivos.fechaDesde || '';
  if (hasta) hasta.value = filtrosActivos.fechaHasta || '';
  
  // Actualizar clases visuales
  actualizarClasesCheckboxes();
}

function actualizarClasesCheckboxes() {
  // Plataformas
  document.querySelectorAll('.filtro-plataforma').forEach(label => {
    const cb = label.querySelector('input');
    label.classList.toggle('active', cb.checked);
  });
  
  // Checks
  document.querySelectorAll('.filtro-check').forEach(label => {
    const cb = label.querySelector('input');
    label.classList.toggle('active', cb.checked);
  });
}

function aplicarFiltros() {
  // Recolectar plataformas
  const plataforma = [];
  document.querySelectorAll('.filtro-plataforma input:checked').forEach(cb => {
    plataforma.push(cb.value);
  });
  
  // Recolectar estados
  const estado = [];
  document.querySelectorAll('.filtro-check[data-estado] input:checked').forEach(cb => {
    estado.push(cb.value);
  });
  
  // Recolectar tipos
  const tipo = [];
  document.querySelectorAll('.filtro-check[data-tipo] input:checked').forEach(cb => {
    tipo.push(cb.value);
  });
  
  // Recolectar emisión
  const emision = [];
  document.querySelectorAll('.filtro-check[data-emision] input:checked').forEach(cb => {
    emision.push(cb.value);
  });
  
  // 👇 NUEVO: Recolectar envío
  const envio = [];
  document.querySelectorAll('.filtro-check[data-envio] input:checked').forEach(cb => {
    envio.push(cb.value);
  });
  
  // Fechas
  const fechaDesde = document.getElementById('filtroFechaDesde')?.value || '';
  const fechaHasta = document.getElementById('filtroFechaHasta')?.value || '';
  
  // 👇 ACTUALIZAR con envio
  filtrosActivos = { plataforma, estado, tipo, emision, envio, fechaDesde, fechaHasta };
  
  actualizarTagsFiltros();
  filtrarComprobantesConFiltros();
}

function actualizarTagsFiltros() {
  const container = document.getElementById('filtrosActivos');
  const badge = document.getElementById('filtroBadge');
  if (!container) return;
  
  const totalActivos = 
    filtrosActivos.plataforma.length + 
    filtrosActivos.estado.length + 
    filtrosActivos.tipo.length +
    filtrosActivos.emision.length +
    filtrosActivos.envio.length; // 👈 AGREGAR
  
  // Mostrar/ocultar badge
  if (badge) {
    const defaultActive = 
      filtrosActivos.estado.length === 1 && filtrosActivos.estado[0] === 'emitido' &&
      filtrosActivos.tipo.length === 1 && filtrosActivos.tipo[0] === 'factura_c' &&
      filtrosActivos.emision.length === 1 && filtrosActivos.emision[0] === 'automatica' &&
      filtrosActivos.plataforma.length === 0 &&
      filtrosActivos.envio.length === 0; // 👈 AGREGAR
    
    if (totalActivos > 0 && !defaultActive) {
      badge.style.display = 'inline';
      badge.textContent = totalActivos;
    } else {
      badge.style.display = 'none';
    }
  }
  
  // Generar tags
  let html = '';
  
  const labels = {
    'woo': 'WooCommerce',
    'mercadolibre': 'Mercado Libre',
    'tiendanube': 'Tienda Nube',
    'empretienda': 'Empretienda',
    'rappi': 'Rappi',
    'vtex': 'VTEX',
    'emitido': 'Emitido',
    'pendiente': 'Sin emitir',
    'error': 'Error',
    'factura_c': 'Factura C',
    'factura_a': 'Factura A',
    'factura_b': 'Factura B',
    'nota_credito': 'Nota Crédito',
    'automatica': 'Automática',
    'manual': 'Manual',
    'enviado': '📧 Enviado',           // 👈 NUEVO
    'no_enviado': '📧 No enviado',     // 👈 NUEVO
    'pendiente_envio': '⏳ Pendiente envío' // 👈 NUEVO
  };
  
  // Tags de plataforma
  filtrosActivos.plataforma.forEach(p => {
    html += `<span class="filtro-tag">
      ${labels[p] || p}
      <span class="material-icons" onclick="quitarFiltro('plataforma','${p}')">close</span>
    </span>`;
  });
  
  // Tags de estado
  filtrosActivos.estado.forEach(e => {
    html += `<span class="filtro-tag">
      ${labels[e] || e}
      <span class="material-icons" onclick="quitarFiltro('estado','${e}')">close</span>
    </span>`;
  });
  
  // Tags de tipo
  filtrosActivos.tipo.forEach(t => {
    html += `<span class="filtro-tag">
      ${labels[t] || t}
      <span class="material-icons" onclick="quitarFiltro('tipo','${t}')">close</span>
    </span>`;
  });
  
  // Tags de emisión
  filtrosActivos.emision.forEach(e => {
    html += `<span class="filtro-tag">
      ${labels[e] || e}
      <span class="material-icons" onclick="quitarFiltro('emision','${e}')">close</span>
    </span>`;
  });
  
  // 👇 NUEVO: Tags de envío
  filtrosActivos.envio.forEach(e => {
    html += `<span class="filtro-tag">
      ${labels[e] || e}
      <span class="material-icons" onclick="quitarFiltro('envio','${e}')">close</span>
    </span>`;
  });
  
  container.innerHTML = html;
}

function quitarFiltro(grupo, valor) {
  const index = filtrosActivos[grupo].indexOf(valor);
  if (index > -1) {
    filtrosActivos[grupo].splice(index, 1);
  }
  
  // Actualizar checkboxes
  document.querySelectorAll('.filtro-plataforma input, .filtro-check input').forEach(cb => {
    if (cb.value === valor) cb.checked = false;
  });
  
  actualizarClasesCheckboxes();
  actualizarTagsFiltros();
  filtrarComprobantesConFiltros();
}

function limpiarFiltros() {
  filtrosActivos = {
    plataforma: [],
    estado: ['emitido'],
    tipo: ['factura_c'],
    emision: ['automatica'],
    envio: [],  // 👈 AGREGAR ESTO
    fechaDesde: '',
    fechaHasta: ''
  };
  
  // Desmarcar todos
  document.querySelectorAll('.filtro-plataforma input, .filtro-check input').forEach(cb => {
    cb.checked = false;
  });
  
  // Marcar defaults
  document.querySelectorAll('.filtro-check[data-estado] input[value="emitido"]').forEach(cb => cb.checked = true);
  document.querySelectorAll('.filtro-check[data-tipo] input[value="factura_c"]').forEach(cb => cb.checked = true);
  document.querySelectorAll('.filtro-check[data-emision] input[value="automatica"]').forEach(cb => cb.checked = true);
  
  // Limpiar fechas
  const desde = document.getElementById('filtroFechaDesde');
  const hasta = document.getElementById('filtroFechaHasta');
  if (desde) desde.value = '';
  if (hasta) hasta.value = '';
  
  actualizarClasesCheckboxes();
  actualizarTagsFiltros();
  filtrarComprobantesConFiltros();
}

function filtrarComprobantesConFiltros() {
  const filas = document.querySelectorAll('#manualesBody tr');
  let total = 0;
  let count = 0;
  
  filas.forEach(fila => {
    let mostrar = true;
    
    // Obtener datos de la fila desde data attributes
    const origen = fila.dataset.origen || '';
    const estado = fila.dataset.estado || '';
    const tipo = fila.dataset.tipo || '';
    const emision = fila.dataset.emision || '';
    
    // Filtrar por plataforma
    if (filtrosActivos.plataforma.length > 0) {
      if (!filtrosActivos.plataforma.includes(origen)) mostrar = false;
    }
    
    // Filtrar por estado
    if (filtrosActivos.estado.length > 0 && mostrar) {
      if (!filtrosActivos.estado.includes(estado)) mostrar = false;
    }
    
    // Filtrar por tipo
    if (filtrosActivos.tipo.length > 0 && mostrar) {
      if (!filtrosActivos.tipo.includes(tipo)) mostrar = false;
    }
    
    // Filtrar por emisión
    if (filtrosActivos.emision.length > 0 && mostrar) {
      if (!filtrosActivos.emision.includes(emision)) mostrar = false;
    }
    
    // Filtrar por fechas (si tenés fecha en la fila)
    if (mostrar && filtrosActivos.fechaDesde) {
      const fechaFila = fila.dataset.fecha || '';
      if (fechaFila && fechaFila < filtrosActivos.fechaDesde) mostrar = false;
    }
    if (mostrar && filtrosActivos.fechaHasta) {
      const fechaFila = fila.dataset.fecha || '';
      if (fechaFila && fechaFila > filtrosActivos.fechaHasta) mostrar = false;
    }
    
    fila.style.display = mostrar ? '' : 'none';
    
    if (mostrar) {
      const montoCell = fila.querySelector('td:nth-child(6)');
      if (montoCell) {
        const monto = parseFloat(montoCell.textContent.replace(/[$,.]/g, ''));
        if (!isNaN(monto)) {
          total += monto;
          count++;
        }
      }
    }
  });
  
  // Actualizar totales
  const totalesDiv = document.getElementById('compTotales');
  if (totalesDiv) {
    totalesDiv.innerHTML = `
      <div><strong>${count}</strong> comprobantes</div>
      <div>Total: <strong>$${total.toLocaleString()}</strong></div>
    `;
  }
}

// ── INICIALIZACIÓN DE FILTROS ──
document.addEventListener('DOMContentLoaded', function() {
  console.log('🔧 Inicializando eventos de filtros...');
  
  // 1. Eventos para plataformas
  document.querySelectorAll('.filtro-plataforma input').forEach(cb => {
    cb.addEventListener('change', function() {
      const label = this.closest('.filtro-plataforma');
      if (label) {
        label.classList.toggle('active', this.checked);
      }
    });
  });
  
  // 2. Eventos para checks
  document.querySelectorAll('.filtro-check input').forEach(cb => {
    cb.addEventListener('change', function() {
      const label = this.closest('.filtro-check');
      if (label) {
        label.classList.toggle('active', this.checked);
      }
    });
  });
  
  // 3. 👇 NUEVO: Inicializar evento del botón filtrar
  const btnFiltrar = document.querySelector('.filtro-btn-filtrar');
  if (btnFiltrar) {
    // Remover onclick del HTML si existe
    btnFiltrar.removeAttribute('onclick');
    // Agregar evento moderno
    btnFiltrar.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      console.log('🖱️ CLICK en botón Filtrar');
      if (typeof abrirModalFiltros === 'function') {
        abrirModalFiltros();
      } else {
        console.error('❌ abrirModalFiltros no está definida');
      }
    });
    console.log('✅ Evento click del botón Filtrar inicializado');
  } else {
    console.warn('⚠️ Botón .filtro-btn-filtrar no encontrado');
  }
  
  console.log('✅ Eventos de filtros inicializados correctamente');
});

// ── BÚSQUEDA COMBINADA CON FILTROS ──
// Guardar referencia a la función original si existe
const filtrarComprobantesOriginal = window.filtrarComprobantes;

// Reemplazar la función de búsqueda
window.filtrarComprobantes = function() {
  console.log('🔍 Ejecutando búsqueda combinada con filtros...');
  
  // PASO 1: Aplicar filtros primero (si la función existe)
  if (typeof filtrarComprobantesConFiltros === 'function') {
    filtrarComprobantesConFiltros();
  } else {
    console.warn('⚠️ filtrarComprobantesConFiltros no está definida');
  }
  
  // PASO 2: Aplicar búsqueda por texto
  const busqueda = document.getElementById('compBuscar')?.value?.trim()?.toLowerCase() || '';
  const filas = document.querySelectorAll('#manualesBody tr');
  
  if (!busqueda) {
    // Si no hay búsqueda, solo mostrar las filas que pasaron los filtros
    filas.forEach(fila => {
      // Si la fila tiene display:none por filtros, mantenerlo
      // Si no, asegurar que esté visible
      if (fila.style.display === 'none') {
        // Ya está oculta por filtros, mantener
      } else {
        fila.style.display = '';
      }
    });
    console.log('🔍 Búsqueda vacía - mostrando solo filtros aplicados');
    return;
  }
  
  // Aplicar búsqueda sobre las filas ya filtradas
  let filasVisibles = 0;
  filas.forEach(fila => {
    // Si la fila ya está oculta por filtros, no la mostramos
    if (fila.style.display === 'none') {
      return;
    }
    
    const texto = fila.textContent.toLowerCase();
    if (texto.includes(busqueda)) {
      fila.style.display = '';
      filasVisibles++;
    } else {
      fila.style.display = 'none';
    }
  });
  
  console.log(`🔍 Búsqueda: "${busqueda}" - ${filasVisibles} filas coinciden`);
  
  // Actualizar contador de resultados si existe la función
  if (typeof actualizarContadorResultados === 'function') {
    actualizarContadorResultados();
  }
};
// ============================================================
//  ENVÍO AUTOMÁTICO DE REPORTE - PRIMER DÍA HÁBIL DE CADA MES
// ============================================================

// Verificar si un día es hábil (Lunes a Viernes)
function esDiaHabil(fecha) {
    const dia = fecha.getDay();
    return dia >= 1 && dia <= 5;
}

// Calcular el primer día hábil del mes
function obtenerPrimerDiaHabil(mes, anio) {
    const anioActual = anio || new Date().getFullYear();
    const mesActual = mes !== undefined ? mes : new Date().getMonth();
    
    for (let dia = 1; dia <= 7; dia++) {
        const fecha = new Date(anioActual, mesActual, dia);
        if (esDiaHabil(fecha)) {
            return fecha;
        }
    }
    return new Date(anioActual, mesActual, 1);
}

// Verificar si hoy es el primer día hábil del mes
function esPrimerDiaHabil() {
    const hoy = new Date();
    const primerDiaHabil = obtenerPrimerDiaHabil(hoy.getMonth(), hoy.getFullYear());
    return hoy.toDateString() === primerDiaHabil.toDateString();
}

// Enviar reporte del mes anterior (usa la función existente enviarReporteContador)
async function enviarReporteDelMesAnterior(emailContador, mes, anio) {
    console.log('📊 Enviando reporte automático del mes anterior...');
    
    try {
        // Obtener nombre del contador
        const userRes = await fetch('/api/me', { credentials: 'include' });
        const userData = await userRes.json();
        const nombreContador = userData.user?.settings?.contadorNombre || 'Contador';
        
        // Construir payload
        const payload = {
            contadorEmail: emailContador,
            contadorNombre: nombreContador,
            mes: mes,
            anio: anio,
            nota: `Reporte automático del mes anterior (${new Date(anio, mes, 1).toLocaleString('es-AR', { month: 'long', year: 'numeric' })})`,
            incluirComprobantes: true,
            incluirCategoria: true,
            incluirNC: false,
            automatico: true
        };
        
        console.log('📤 Enviando payload:', payload);
        
        const response = await fetch('/api/reports/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(payload)
        });
        
        const result = await response.json();
        
        if (result.ok) {
            const mesKey = `${anio}-${mes.toString().padStart(2, '0')}`;
            localStorage.setItem('ultimoEnvioReporte', mesKey);
            console.log(`✅ Reporte del mes ${mesKey} enviado automáticamente a ${emailContador}`);
            
            if (typeof toast === 'function') {
                toast(`📊 Reporte mensual enviado a ${emailContador}`, 'success');
            }
            
            // Actualizar el último envío en la UI
            const ultimoEnvioEl = document.getElementById('rptUltimoEnvio');
            if (ultimoEnvioEl) {
                ultimoEnvioEl.textContent = new Date().toLocaleString('es-AR');
            }
            
            return true;
        } else {
            console.error('❌ Error enviando reporte:', result.error);
            return false;
        }
    } catch (error) {
        console.error('❌ Error en envío automático:', error);
        return false;
    }
}

// Función principal para verificar y enviar
async function verificarYEnviarReporteAutomatico(force = false) {
    console.log('🔍 Verificando envío automático de reporte...');
    
    // 1. Verificar que el switch esté activo
    const switchReporte = document.getElementById('switchEnvioReporte');
    if (!switchReporte || !switchReporte.checked) {
        console.log('🔇 Envío automático de reporte desactivado');
        return;
    }
    
    // 2. Verificar ARCA
    try {
        const arcaRes = await fetch('/api/me/arca-status', { credentials: 'include' });
        const arcaData = await arcaRes.json();
        if (!arcaData.conectada) {
            console.log('⚠️ ARCA no vinculada, no se envía reporte');
            return;
        }
    } catch(e) {
        console.warn('⚠️ Error verificando ARCA:', e);
        return;
    }
    
    // 3. Verificar email del contador
    let emailContador = '';
    try {
        const userRes = await fetch('/api/me', { credentials: 'include' });
        const userData = await userRes.json();
        emailContador = userData.user?.settings?.contadorEmail || '';
        if (!emailContador || !emailContador.includes('@')) {
            console.warn('⚠️ Email del contador no configurado');
            return;
        }
    } catch(e) {
        console.warn('⚠️ Error verificando email:', e);
        return;
    }
    
    // 4. Calcular mes anterior
    const hoy = new Date();
    const mesAnterior = hoy.getMonth() - 1;
    const anioAnterior = hoy.getFullYear();
    const mes = mesAnterior < 0 ? 11 : mesAnterior;
    const anio = mesAnterior < 0 ? anioAnterior - 1 : anioAnterior;
    const mesKey = `${anio}-${mes.toString().padStart(2, '0')}`;
    
    // 5. Verificar si ya se envió
    const ultimoEnvio = localStorage.getItem('ultimoEnvioReporte');
    if (ultimoEnvio === mesKey && !force) {
        console.log(`📊 Reporte del mes ${mesKey} ya fue enviado`);
        return;
    }
    
    // 6. Enviar si es primer día hábil o es forzado
    if (esPrimerDiaHabil() || force) {
        console.log(`📊 Enviando reporte del mes ${mesKey}...`);
        await enviarReporteDelMesAnterior(emailContador, mes, anio);
    } else {
        console.log(`⏳ El envío automático se hará el primer día hábil del próximo mes (${obtenerPrimerDiaHabil(hoy.getMonth() + 1, hoy.getFullYear()).toLocaleDateString('es-AR')})`);
    }
}

// Manejador del switch de reporte
async function handleSwitchReporte(checked) {
    console.log(`📊 Switch de reporte: ${checked ? 'ACTIVADO' : 'DESACTIVADO'}`);
    
    // 🔒 GUARDAR EL ESTADO ACTUAL DE envioAuto
    const swEnvioAuto = document.getElementById('switchEnvioAuto');
    const estadoOriginalEnvioAuto = swEnvioAuto?.checked;
    console.log(`🔒 Estado original de envioAuto: ${estadoOriginalEnvioAuto}`);
    
    // 📌 BLOQUEAR recargas de configuración
    window._bloquearRecargaConfig = true;
    console.log('🔒 Recarga de configuración bloqueada');
    
    try {
        // Guardar el estado del reporte
        await guardarSwitch('envioReporteAuto', checked);
        console.log(`✅ Reporte guardado: ${checked}`);
        
        // ⏳ Esperar a que el backend procese
        await new Promise(resolve => setTimeout(resolve, 300));
        
        // 🔍 VERIFICAR que envioAuto no se perdió
        const verifyRes = await fetch('/api/me', { credentials: 'include' });
        const verifyData = await verifyRes.json();
        const envioAutoBackend = verifyData.user?.settings?.envioAuto;
        
        console.log(`📊 Verificación: envioAuto en backend = ${envioAutoBackend}`);
        console.log(`📊 Verificación: envioAuto en UI = ${swEnvioAuto?.checked}`);
        
        // 🔧 RESTAURAR envioAuto si se perdió (en UI o backend)
        if (swEnvioAuto && swEnvioAuto.checked !== estadoOriginalEnvioAuto) {
            console.log(`🔧 Restaurando envioAuto UI a: ${estadoOriginalEnvioAuto}`);
            swEnvioAuto.checked = estadoOriginalEnvioAuto;
        }
        
        if (envioAutoBackend !== estadoOriginalEnvioAuto) {
            console.log(`🔧 Restaurando envioAuto backend a: ${estadoOriginalEnvioAuto}`);
            await guardarSwitch('envioAuto', estadoOriginalEnvioAuto);
        }
        
        // Si se activó, verificar envío pendiente
        if (checked) {
            console.log('📊 Switch activado, verificando envío pendiente...');
            setTimeout(() => {
                verificarYEnviarReporteAutomatico(true);
            }, 1500);
        }
        
    } catch (error) {
        console.error('❌ Error en handleSwitchReporte:', error);
    } finally {
        // 🔓 DESBLOQUEAR recargas de configuración
        setTimeout(() => {
            window._bloquearRecargaConfig = false;
            console.log('🔓 Recarga de configuración desbloqueada');
        }, 500);
    }
}

// Inicializar el envío automático
function initEnvioAutomaticoReporte() {
    console.log('📊 Inicializando envío automático de reporte...');
    
    // Verificar al cargar la página
    setTimeout(() => {
        verificarYEnviarReporteAutomatico(false);
    }, 3000);
    
    // Verificar cada hora
    setInterval(() => {
        verificarYEnviarReporteAutomatico(false);
    }, 3600000); // 1 hora
}
// ============================================================
//  MANEJADOR ESPECÍFICO PARA EL SWITCH DE REPORTE
//  - Previene interferencia con otros switches
// ============================================================

let _reporteTimeout = null;

// Enviar email automático después de emitir
async function enviarMailAutomatico(orderId) {
    try {
        // Verificar switch en UI
        const swEnvioAuto = document.getElementById('switchEnvioAuto');
        const envioAutoActivo = swEnvioAuto ? swEnvioAuto.checked : false;
        
        // Verificar switch en backend
        const userRes = await fetch('/api/me', { credentials: 'include' });
        const userData = await userRes.json();
        const envioAutoBackend = userData.user?.settings?.envioAuto === true;
        
        const debeEnviar = envioAutoActivo || envioAutoBackend;
        
        if (!debeEnviar) {
            console.log('📧 Envío automático desactivado');
            return;
        }
        
        console.log(`📧 Enviando comprobante automáticamente...`);
        await enviarMail(orderId);
        
    } catch(e) {
        console.error('❌ Error en envío automático:', e.message);
    }
}



// Exponer funciones globalmente
window.verificarYEnviarReporteAutomatico = verificarYEnviarReporteAutomatico;
window.handleSwitchReporte = handleSwitchReporte;
window.initEnvioAutomaticoReporte = initEnvioAutomaticoReporte;

console.log('✅ Función de búsqueda combinada con filtros inicializada');
// ============================================================
// ============================================================
//  EXPORTS GLOBALES
// ============================================================
window.obtenerNotificaciones = obtenerNotificaciones;
window.marcarNotificacionComoLeida = marcarNotificacionComoLeida;
window.marcarTodasComoLeidas = marcarTodasComoLeidas;
window.mostrarNotificacionesCentro = mostrarNotificacionesCentro;
window.reproducirSonidoNotificacion = reproducirSonidoNotificacion;
window.cargarDatosSuscripcion = cargarDatosSuscripcion;
window.mostrarVista = mostrarVista;
window.guardarEmailContador = guardarEmailContador;
window.guardarNombreContador = guardarNombreContador;
window.initReporteCompleto = initReporteCompleto;
window.cargarContadorGuardado = cargarContadorGuardado;
window.initContadorEditable = initContadorEditable;
window.initReporte = initReporte;
// 👇 AGREGAR ESTA LÍNEA
window.enviarReporteContador = enviarReporteContador;
window._bloquearRecargaConfig = false;