/* ════════════════════════════════════════════════════════
   KOI-FACTURA v3.3 — Dashboard JS
   Compatible con server.js v3.3 (Render Secret Files)
   ════════════════════════════════════════════════════════ */

/* ── MOCK fallback ─── */
const MOCK = {
  serverOnline:true, monoCategoria:'C', monoFacturado:0, monoLimite:2432364,
  monoMes:'Sin datos aún', hoyFacturado:0, hoyDelta:'', hoyTipo:'',
  pendientesCAE:0, pendDelta:'Al día ✓', pendTipo:'up',
  mesFacturado:0, mesDelta:'0 facturas', mesTipo:'up',
  chartTotal:0, chartDias:[], chartVentas:[], comprobantes:[],
};

/* ── HELPERS ─── */
const ars      = n => new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS',maximumFractionDigits:0}).format(n);
const arsShort = n => n>=1e6?`$${(n/1e6).toFixed(2)}M`:n>=1e3?`$${(n/1e3).toFixed(0)}k`:`$${n}`;
const ICONS    = {success:'check_circle',error:'error',info:'info',warn:'warning'};

function toast(msg,type='info'){
  const el=document.createElement('div');
  el.className=`toast ${type}`;
  el.innerHTML=`<span class="material-icons" style="font-size:15px">${ICONS[type]||'info'}</span> ${msg}`;
  document.getElementById('toasts').appendChild(el);
  setTimeout(()=>el.remove(),3500);
}

/* ── HTTP ─── */
const api={
  async _fetch(method,path,body){
    const opts={method,credentials:'include',headers:{'Content-Type':'application/json'}};
    if(body) opts.body=JSON.stringify(body);
    const res=await fetch(path,opts);
    if(!res.ok){const e=await res.json().catch(()=>({error:res.statusText}));throw new Error(e.error||`HTTP ${res.status}`);}
    return res.json();
  },
  get:(path)=>api._fetch('GET',path),
  post:(path,body)=>api._fetch('POST',path,body),
  patch:(path,body)=>api._fetch('PATCH',path,body),
  del:(path)=>api._fetch('DELETE',path),
};

/* ── STATUS ─── */
function renderStatus(online){
  ['sidebarDot','topbarDot','estadoAfipDot'].forEach(id=>{
    const el=document.getElementById(id);
    if(el) el.className=`status-dot ${online?'':'offline'}`;
  });
  const sl=document.getElementById('sidebarLabel');
  if(sl) sl.textContent=online?'Activo':'Sin conexión';
  const tl=document.getElementById('topbarLabel');
  if(tl) tl.textContent=online?'AFIP Activo':'Sin conexión';
}

/* ── RENDER DASHBOARD ─── */
function renderMono(d){
  document.getElementById('monoCat').textContent=`Cat ${d.monoCategoria}`;
  document.getElementById('monoMes').textContent=d.monoMes;
  const ps=document.getElementById('topbarPeriod');
  if(ps) ps.textContent=d.monoMes;
  document.getElementById('monoVal').textContent=new Intl.NumberFormat('es-AR',{maximumFractionDigits:0}).format(d.monoFacturado);
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
    const el=document.getElementById(id); if(!el) return;
    el.textContent=val; el.className='mc-value';
    const dd=document.getElementById(did); if(!dd) return;
    dd.textContent=delta; dd.className=`mc-delta ${tipo}`;
  };
  set('mcHoy', ars(d.hoyFacturado), 'dcHoy', d.hoyDelta, d.hoyTipo);
  set('mcPend', d.pendientesCAE,    'dcPend',d.pendDelta,d.pendTipo);
  set('mcMes',  ars(d.mesFacturado),'dcMes', d.mesDelta, d.mesTipo);
  if(d.pendientesCAE>0){const el=document.getElementById('mcPend');if(el)el.style.color='var(--yellow)';}
  const nb=document.getElementById('navBadge');
  if(nb) nb.textContent=d.pendientesCAE||0;
}

let chartInst=null;
function renderChart(d){
  const tv=document.getElementById('chartTotal');
  if(tv) tv.textContent=arsShort(d.chartTotal||0);
  const canvas=document.getElementById('salesChart');
  if(!canvas) return;
  const ctx=canvas.getContext('2d');
  const grad=ctx.createLinearGradient(0,0,0,160);
  grad.addColorStop(0,'rgba(0,230,118,0.28)');
  grad.addColorStop(1,'rgba(0,230,118,0)');
  if(chartInst) chartInst.destroy();
  chartInst=new Chart(ctx,{
    type:'line',
    data:{labels:d.chartDias,datasets:[{data:d.chartVentas,fill:true,backgroundColor:grad,borderColor:'#00e676',borderWidth:2,pointRadius:0,pointHoverRadius:5,pointHoverBackgroundColor:'#00e676',tension:0.45}]},
    options:{
      responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false},tooltip:{backgroundColor:'#17172a',borderColor:'rgba(0,230,118,0.2)',borderWidth:1,titleColor:'#8888aa',bodyColor:'#f0f0fa',padding:10,callbacks:{label:c=>` ${ars(c.raw)}`}}},
      scales:{
        x:{grid:{color:'rgba(255,255,255,0.04)',drawBorder:false},ticks:{color:'#44445a',font:{family:'Plus Jakarta Sans',size:10}}},
        y:{grid:{color:'rgba(255,255,255,0.04)',drawBorder:false},ticks:{color:'#44445a',font:{family:'Space Grotesk',size:10},callback:v=>arsShort(v)}},
      },
    },
  });
}

function renderComps(lista){
  const badge=document.getElementById('compBadge');
  if(badge) badge.textContent=lista.length;
  const cont=document.getElementById('compList');
  if(!cont) return;
  if(!lista.length){cont.innerHTML=`<div style="padding:30px;text-align:center;color:var(--text-3);font-size:12px">Sin ventas en este período</div>`;return;}
  cont.innerHTML=lista.map((c,i)=>{
    const emitido=c.estado==='cae-ok';
    const btnEmitir=emitido
      ?`<button class="act-btn act-done" disabled title="CAE emitido ✓"><svg width='13' height='13' viewBox='0 0 14 14' fill='none'><path d='M2.5 7l3 3 6-6' stroke='currentColor' stroke-width='1.4' stroke-linecap='round'/></svg></button>`
      :`<button class="act-btn" title="Emitir CAE" onclick="emitir('${c._id||c.id}')"><svg width='13' height='13' viewBox='0 0 14 14' fill='none'><path d='M7 1.5l5.5 10H1.5L7 1.5z' stroke='currentColor' stroke-width='1.3' stroke-linejoin='round'/><path d='M7 5.5v3' stroke='currentColor' stroke-width='1.3' stroke-linecap='round'/><circle cx='7' cy='10' r='.6' fill='currentColor'/></svg></button>`;
    
    // 👇 NUEVO: Generar HTML de items si existen
    const itemsHtml = c.itemsSummary 
      ? `<div class="comp-items" style="font-size:10px; color:var(--text-3); margin-top:4px;">🛒 ${c.itemsSummary}</div>`
      : (c.concepto ? `<div class="comp-items" style="font-size:10px; color:var(--text-3); margin-top:4px;">📝 ${c.concepto}</div>` : '');
    
    return `<div class="comp-row" style="animation-delay:${i*55}ms">
      <div class="cae-dot ${c.estado}"></div>
      <div class="comp-info">
        <div class="comp-cliente">${c.cliente}</div>
        <div class="comp-meta">${c.tipo} · ${c.fecha}</div>
        ${itemsHtml}
      </div>
      <div class="comp-monto">${ars(c.monto)}</div>
      <div class="comp-actions">
        <button class="act-btn" title="Ver PDF" onclick="verPDF('${c._id||c.id}')"><svg width="13" height="13" viewBox="0 0 14 14" fill="none"><rect x="2" y="1" width="8" height="11" rx="1.5" stroke="currentColor" stroke-width="1.3"/><path d="M4 4.5h4M4 6.5h4M4 8.5h2.5" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg></button>
        ${btnEmitir}
        <button class="act-btn" title="Enviar mail" onclick="enviarMail('${c._id||c.id}')"><svg width="13" height="13" viewBox="0 0 14 14" fill="none"><rect x="1.5" y="3" width="11" height="8" rx="1.5" stroke="currentColor" stroke-width="1.3"/><path d="M1.5 5l5.5 3.5L12.5 5" stroke="currentColor" stroke-width="1.2"/></svg></button>
      </div>
    </div>`;
  }).join('');
}

function cargarDashboard(data){
  const d=data||MOCK;
  renderStatus(d.serverOnline);
  renderMono(d);
  renderMetrics(d);
  renderChart(d);
  renderComps(d.comprobantes);
}

/* ── ADAPTAR RESPUESTA API ─── */
function adaptarStats(raw){
  if(!raw) return null;
  const ahora=new Date();
  const mesNom=ahora.toLocaleString('es-AR',{month:'long'});
  const anio=ahora.getFullYear();

  const ventasPorDia={};
  (raw.ultimas||[]).forEach(o=>{
    const fecha=o.orderDate?new Date(o.orderDate):(o.createdAt?new Date(o.createdAt):null);
    if(!fecha) return;
    const dia=fecha.toLocaleDateString('es-AR',{day:'2-digit'});
    ventasPorDia[dia]=(ventasPorDia[dia]||0)+(o.amount||0);
  });
  const dias=Object.keys(ventasPorDia).sort().slice(-14);

  const comprobantes=(raw.ultimas||[]).slice(0,20).map(o=>{
    const fecha=o.orderDate?new Date(o.orderDate):(o.createdAt?new Date(o.createdAt):null);
    return {
      id:o.externalId||o._id, _id:o._id,
      cliente:o.customerName||'Sin nombre',
      tipo:o.platform||'Venta',
      fecha:fecha?fecha.toLocaleDateString('es-AR'):'—',
      monto:o.amount||0,
      estado:o.status==='invoiced'?'cae-ok':'cae-pend',
      origen:o.platform==='manual'?'manual':'woo',
    };
  });

  return {
    serverOnline:true,
    monoCategoria:'C',
    monoFacturado:raw.totalMonto||0,
    monoLimite:2432364,
    monoMes:`Período: ${mesNom.charAt(0).toUpperCase()+mesNom.slice(1)} ${anio}`,
    hoyFacturado:raw.hoyMonto||0,
    hoyDelta:raw.hoyCount?`${raw.hoyCount} venta${raw.hoyCount!==1?'s':''} hoy`:'Sin ventas hoy',
    hoyTipo:raw.hoyMonto>0?'up':'',
    pendientesCAE:raw.pendientes||0,
    pendDelta:raw.pendientes>0?`${raw.pendientes} sin emitir`:'Al día ✓',
    pendTipo:raw.pendientes>0?'warn':'up',
    mesFacturado:raw.facturadoMonto||0,
    mesDelta:`${raw.facturadoCount||0} con CAE emitido`,
    mesTipo:'up',
    chartTotal:raw.totalMonto||0,
    chartDias:dias,
    chartVentas:dias.map(d=>Math.round(ventasPorDia[d]||0)),
    comprobantes,
  };
}

/* ── PERÍODO DASHBOARD ─── */
let _dashDesde=null, _dashHasta=null;

function _initDashPeriod(){
  const hoy=new Date();
  _dashDesde=new Date(hoy.getFullYear(),hoy.getMonth(),1);
  _dashHasta=new Date(hoy.getFullYear(),hoy.getMonth()+1,0);
  _syncDashInputs();
  _updatePeriodLabel('Este mes');
}

function _syncDashInputs(){
  const toISO=d=>d?d.toISOString().split('T')[0]:'';
  const ed=document.getElementById('dashDesde'); if(ed) ed.value=toISO(_dashDesde);
  const eh=document.getElementById('dashHasta'); if(eh) eh.value=toISO(_dashHasta);
}

function _updatePeriodLabel(label){
  const el=document.getElementById('dashPeriodoLabel'); if(el) el.textContent=label;
  const sub=document.getElementById('chartSub');        if(sub) sub.textContent=label;
}

function toggleDashCalendario(){
  const dd=document.getElementById('dashCalDropdown');
  dd.classList.toggle('open');
  if(dd.classList.contains('open')){
    setTimeout(()=>document.addEventListener('click',function _c(e){
      const w=document.querySelector('.topbar-period-wrap');
      if(w&&!w.contains(e.target)){dd.classList.remove('open');document.removeEventListener('click',_c);}
    }),10);
  }
}

function aplicarDashPreset(preset,btn){
  document.querySelectorAll('#dashCalDropdown .tcal-preset').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  const hoy=new Date(),y=hoy.getFullYear(),m=hoy.getMonth();
  const LABELS={mes:'Este mes',ant:'Mes anterior',trim:'Trimestre',anio:'Este año',todo:'Todo'};
  if(preset==='mes')  {_dashDesde=new Date(y,m,1);          _dashHasta=new Date(y,m+1,0);}
  if(preset==='ant')  {_dashDesde=new Date(y,m-1,1);        _dashHasta=new Date(y,m,0);}
  if(preset==='trim') {const ts=Math.floor(m/3)*3;_dashDesde=new Date(y,ts,1);_dashHasta=new Date(y,ts+3,0);}
  if(preset==='anio') {_dashDesde=new Date(y,0,1);          _dashHasta=new Date(y,11,31);}
  if(preset==='todo') {_dashDesde=null;                     _dashHasta=null;}
  _syncDashInputs();
  _updatePeriodLabel(LABELS[preset]||'Período');
  document.getElementById('dashCalDropdown').classList.remove('open');
  _recargarDashConPeriodo();
}

function aplicarDashRangoCustom(){
  const d=document.getElementById('dashDesde').value;
  const h=document.getElementById('dashHasta').value;
  if(!d||!h) return;
  _dashDesde=new Date(d); _dashHasta=new Date(h+'T23:59:59');
  document.querySelectorAll('#dashCalDropdown .tcal-preset').forEach(b=>b.classList.remove('active'));
  const fmt=dt=>dt.toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit',year:'2-digit'});
  _updatePeriodLabel(`${fmt(_dashDesde)} → ${fmt(_dashHasta)}`);
  document.getElementById('dashCalDropdown').classList.remove('open');
  _recargarDashConPeriodo();
}

/* ── RECARGA DASHBOARD CON PERÍODO — pasa desde/hasta al server ─── */
async function _recargarDashConPeriodo(){
  const params=new URLSearchParams();
  if(_dashDesde) params.set('desde',_dashDesde.toISOString().split('T')[0]);
  if(_dashHasta) params.set('hasta',_dashHasta.toISOString().split('T')[0]);
  const url='/api/stats/dashboard'+(params.toString()?'?'+params.toString():'');
  try{
    const raw=await api.get(url);
    const data=adaptarStats(raw);
    if(!data) return;
    if(_dashDesde&&_dashHasta){
      const fmt=dt=>dt.toLocaleDateString('es-AR',{day:'2-digit',month:'long',year:'numeric'});
      data.monoMes=`Período: ${fmt(_dashDesde)} → ${fmt(_dashHasta)}`;
    } else {
      data.monoMes='Período: Todo el historial';
    }
    cargarDashboard(data);
  } catch(e){
    console.warn('Dashboard error:',e.message);
    cargarDashboard(MOCK);
  }
}

/* ── VISTAS ─── */
let vistaActual='dashboard';

function mostrarVista(v){
  vistaActual=v;
  document.querySelectorAll('.content').forEach(el=>el.style.display='none');
  document.querySelectorAll('.nav-item').forEach(el=>el.classList.remove('active'));
  const map={
    dashboard:   {id:'vista-dashboard',   nav:'nav-dashboard'},
    comprobantes:{id:'vista-comprobantes',nav:'nav-comprobantes',fn:()=>{if(!_rangoDesde)_iniciarPeriodo();cargarTodosComprobantes();}},
    negocio:     {id:'vista-negocio',     nav:'nav-negocio',     fn:cargarIntegraciones},
    arca:        {id:'vista-arca',         nav:'nav-arca',         fn:verificarEstadoArca},
    config:      {id:'vista-config',       nav:'nav-config',       fn:cargarConfigVista},
    estado:      {id:'vista-estado',       nav:'nav-estado',       fn:verificarSuscripcion},
  };
  const vista=map[v]; if(!vista) return;
  const el=document.getElementById(vista.id); if(el) el.style.display='block';
  const nav=document.getElementById(vista.nav); if(nav) nav.classList.add('active');
  if(vista.fn) vista.fn();
}

/* ── CONFIG ─── */
async function cargarConfigVista(){
  try{
    const {user}=await api.get('/api/me');
    if(!user) return;
    const s=user.settings||{};
    const n2=document.getElementById('cfgNombre2');   if(n2)  n2.value  =user.nombre ||'';
    const c2=document.getElementById('cfgCuit2');      if(c2)  c2.value  =s.cuit      ||'';
    const e2=document.getElementById('cfgEmail2');     if(e2)  e2.value  =user.email  ||'';
    const cat2=document.getElementById('cfgCategoria2');if(cat2)cat2.value=s.categoria ||'C';
    // Cargar estado real de los switches
    const swF=document.getElementById('switchFactAuto2');  if(swF)  swF.checked =s.factAuto !==false;
    const swE=document.getElementById('switchEnvioAuto2'); if(swE)  swE.checked =s.envioAuto!==false;
  }catch(e){console.warn('cargarConfigVista:',e.message);}
}

async function guardarPerfilVista(){
  try{
    const nombre   =document.getElementById('cfgNombre2')?.value.trim()||'';
    const cuit     =document.getElementById('cfgCuit2')?.value.trim()||'';
    const categoria=document.getElementById('cfgCategoria2')?.value||'C';
    await api.patch('/api/me/settings',{nombre,cuit,categoria});
    const st=document.getElementById('cfgSaveStatus2');
    if(st){st.style.display='flex';setTimeout(()=>st.style.display='none',2500);}
    toast('Perfil guardado','success');
  }catch(e){toast('Error: '+e.message,'error');}
}

/* guardarSwitch — guarda factAuto o envioAuto via PATCH /api/me/settings */
async function guardarSwitch(key,value){
  try{
    await api.patch('/api/me/settings',{[key]:value});
    const st=document.getElementById('cfgAutoStatus2');
    if(st){st.style.display='flex';setTimeout(()=>st.style.display='none',2000);}
    const nombre=key==='factAuto'?'Facturación automática':'Envío automático';
    toast(`${nombre} ${value?'activado':'desactivado'}`,value?'success':'warn');
  }catch(e){
    toast('Error al guardar: '+e.message,'error');
    // revertir toggle
    const swId=key==='factAuto'?'switchFactAuto2':'switchEnvioAuto2';
    const sw=document.getElementById(swId); if(sw) sw.checked=!value;
  }
}

/* ── ARCA ─── */
function toggleClave(){
  const inp=document.getElementById('arcaClave');
  const ico=document.getElementById('cfgEyeIcon');
  if(!inp) return;
  if(inp.type==='password'){inp.type='text';if(ico)ico.innerText='visibility_off';}
  else{inp.type='password';if(ico)ico.innerText='visibility';}
}

async function verificarEstadoArca(){
  try{const {user}=await api.get('/api/me');actualizarEstadoARCA(user);}
  catch(e){console.warn('verificarEstadoArca:',e.message);}
}

function actualizarEstadoARCA(user){
  const s=user?.settings||{};
  const badge=document.getElementById('arcaStatusBadge');
  const inputC=document.getElementById('arcaCuit');
  const inputK=document.getElementById('arcaClave');
  const btn=document.getElementById('btnArcaSync');

  if(s.arcaStatus==='vinculado'){
    if(badge) badge.innerHTML=`<div class="status-dot" style="background:#10b981;box-shadow:0 0 6px #10b981"></div><span style="color:#10b981">Vinculado ✓</span>`;
    if(inputC){inputC.value=s.cuit||'';inputC.disabled=true;}
    if(inputK){inputK.placeholder='••••••••';inputK.disabled=true;}
    if(btn){btn.innerHTML='<span class="material-icons" style="font-size:16px!important">check_circle</span> Vinculado correctamente';btn.style.background='rgba(16,185,129,0.12)';btn.style.color='#10b981';btn.disabled=true;}
  } else if(s.arcaStatus==='pendiente'||s.arcaStatus==='en_proceso'){
    if(badge) badge.innerHTML=`<div class="status-dot checking"></div><span style="color:#f59e0b">Verificando…</span>`;
    if(inputC){inputC.value=s.cuit||'';inputC.disabled=true;}
    if(inputK){inputK.placeholder='••••••••';inputK.disabled=true;}
    if(btn){btn.innerHTML='<span class="material-icons" style="font-size:16px!important">hourglass_top</span> Pendiente de revisión';btn.disabled=true;}
  } else {
    if(badge) badge.innerHTML=`<div class="status-dot checking"></div><span>Sin vincular</span>`;
    if(inputC) inputC.disabled=false;
    if(inputK) inputK.disabled=false;
    if(btn)    btn.disabled=false;
  }
}

async function iniciarSyncArca(){
  const cuit=(document.getElementById('arcaCuit')?.value||'').trim();
  const clave=(document.getElementById('arcaClave')?.value||'').trim();
  if(!cuit||!clave){toast('Ingresá CUIT y Clave Fiscal','warn');return;}

  const btn=document.getElementById('btnArcaSync');
  const prog=document.getElementById('arcaProgress');
  if(btn) btn.disabled=true;
  if(prog) prog.style.display='block';

  try{
    const res=await api.patch('/api/me/arca',{cuit,arcaClave:clave});
    if(!res.ok) throw new Error(res.error||'Error del servidor');
    // Animación de pasos
    const steps=['astep1','astep2','astep3','astep4','astep5'];
    const labels=['Validando CUIT…','Registrando con AFIP…','Verificando certificados…','Configurando punto de venta…','¡Enviado!'];
    let cur=0;
    const next=()=>{
      if(cur>0){const p=document.getElementById(steps[cur-1]);if(p){p.classList.remove('active');p.classList.add('done');}}
      if(cur>=steps.length){
        const t=document.getElementById('arcaProgressTitle');if(t)t.textContent='¡Solicitud enviada!';
        const sp=document.getElementById('arcaSpinner');if(sp)sp.style.display='none';
        actualizarEstadoARCA({settings:{arcaStatus:'pendiente',cuit}});
        toast('✅ Datos enviados. El equipo validará tu vinculación en hasta 24hs.','success');
        return;
      }
      const s=document.getElementById(steps[cur]);if(s)s.classList.add('active');
      const t=document.getElementById('arcaProgressTitle');if(t)t.textContent=labels[cur];
      cur++; setTimeout(next,700);
    };
    next();
  }catch(e){
    toast('❌ Error: '+e.message,'error');
    if(btn) btn.disabled=false;
    if(prog) prog.style.display='none';
  }
}

/* ── EMITIR CAE ─── */
async function emitir(orderId){
  if(!orderId) return;
  try{
    const btn=document.querySelector(`[onclick="emitir('${orderId}')"]`);
    if(btn){btn.disabled=true;btn.innerHTML='<span style="font-size:10px">…</span>';}
    const res=await api.post(`/api/orders/${orderId}/emitir`,{});
    if(res.ok){
      toast(`✅ CAE emitido: ${res.cae}`,'success');
      setTimeout(_recargarDashConPeriodo,600);
      if(vistaActual==='comprobantes') setTimeout(cargarTodosComprobantes,800);
    }
  }catch(e){
    toast('❌ '+e.message,'error');
    const btn=document.querySelector(`[onclick="emitir('${orderId}')"]`);
    if(btn){
      btn.disabled=false;
      btn.innerHTML=`<svg width='13' height='13' viewBox='0 0 14 14' fill='none'><path d='M7 1.5l5.5 10H1.5L7 1.5z' stroke='currentColor' stroke-width='1.3' stroke-linejoin='round'/><path d='M7 5.5v3' stroke='currentColor' stroke-width='1.3' stroke-linecap='round'/><circle cx='7' cy='10' r='.6' fill='currentColor'/></svg>`;
    }
  }
}

/* ── COMPROBANTES ─── */
let _todosComp=[], _filtroTipo='todos', _rangoDesde=null, _rangoHasta=null;

function _parseFecha(str){
  if(!str) return 0;
  const p=str.split('/');
  if(p.length===3){
    const y=p[2].length===2?`20${p[2]}`:p[2];
    return new Date(`${y}-${p[1]}-${p[0]}`).getTime()||0;
  }
  return 0;
}

function _iniciarPeriodo(){
  const hoy=new Date();
  _rangoDesde=new Date(hoy.getFullYear(),hoy.getMonth(),1);
  _rangoHasta=new Date(hoy.getFullYear(),hoy.getMonth()+1,0);
  const d=document.getElementById('calDesde');const h=document.getElementById('calHasta');
  if(d) d.value=_rangoDesde.toISOString().split('T')[0];
  if(h) h.value=_rangoHasta.toISOString().split('T')[0];
}

async function cargarTodosComprobantes(){
  const tbody=document.getElementById('manualesBody');
  if(tbody) tbody.innerHTML=`<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--text-3)">Cargando…</td></tr>`;
  try{
    const raw=await api.get('/api/orders?limit=200');
    _todosComp=(raw.orders||[]).map(o=>{
      const fecha=o.orderDate?new Date(o.orderDate):(o.createdAt?new Date(o.createdAt):null);
      return{
        id:o.externalId||o._id, _id:o._id,
        cliente:o.customerName||'Sin nombre',
        email:o.customerEmail||'',
        concepto:o.concepto||o.platform||'',
        fecha:fecha?fecha.toLocaleDateString('es-AR'):'—',
        tipo:'Factura C',
        monto:o.amount||0,
        estado:o.status==='invoiced'?'emitido':(o.status==='error_afip'?'error':'pendiente'),
        origen:o.platform==='manual'?'manual':'woo',
      };
    }).sort((a,b)=>_parseFecha(b.fecha)-_parseFecha(a.fecha));
    filtrarComprobantes();
  }catch(e){
    if(tbody) tbody.innerHTML=`<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--red)">Error: ${e.message}</td></tr>`;
  }
}

function setFiltro(tipo,btn){
  _filtroTipo=tipo;
  document.querySelectorAll('.filtro-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  filtrarComprobantes();
}

function filtrarComprobantes(){
  const q=(document.getElementById('compBuscar')?.value||'').toLowerCase();
  const clr=document.getElementById('btnClearSearch');if(clr) clr.style.display=q?'flex':'none';
  const lista=_todosComp.filter(c=>{
    if(_filtroTipo==='factura'   &&c.tipo!=='Factura C')        return false;
    if(_filtroTipo==='pendiente' &&c.estado!=='pendiente')       return false;
    if(_filtroTipo==='manual'    &&c.origen!=='manual')          return false;
    if(_filtroTipo==='woo'       &&c.origen==='manual')          return false;
    const ts=_parseFecha(c.fecha);
    if(_rangoDesde&&ts<_rangoDesde.getTime()) return false;
    if(_rangoHasta&&ts>_rangoHasta.getTime()) return false;
    if(q){const hay=[c.id,c.cliente,c.concepto,c.fecha].join(' ').toLowerCase();if(!hay.includes(q))return false;}
    return true;
  });
  renderComprobantes(lista);
}

function limpiarBusqueda(){
  const el=document.getElementById('compBuscar');if(el)el.value='';
  const clr=document.getElementById('btnClearSearch');if(clr)clr.style.display='none';
  filtrarComprobantes();
}

function renderComprobantes(lista){
  const tbody=document.getElementById('manualesBody');
  if(!lista.length){
    if(tbody) tbody.innerHTML=`<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--text-3)">Sin comprobantes</td></tr>`;
    renderTotalesComp([]);return;
  }
  if(tbody) tbody.innerHTML=lista.map((c,i)=>{
    const estadoChip=c.estado==='emitido'
      ?`<span class="estado-chip ok">● Emitido</span>`
      :c.estado==='error'
      ?`<span class="estado-chip anulado">✕ Error AFIP</span>`
      :`<span class="estado-chip pend">◌ Pendiente</span>`;
    const origenPill=c.origen==='manual'
      ?`<span style="font-size:9px;font-weight:700;color:var(--yellow);background:rgba(255,179,0,.1);padding:2px 7px;border-radius:4px;border:1px solid rgba(255,179,0,.2)">MAN</span>`
      :`<span style="font-size:9px;font-weight:700;color:#7b8cde;background:rgba(123,140,222,.1);padding:2px 7px;border-radius:4px;border:1px solid rgba(123,140,222,.2)">PLT</span>`;
    const emitidoBtn=c.estado==='emitido'
      ?`<button class="act-btn act-done" disabled title="CAE emitido ✓"><svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M2.5 7l3 3 6-6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg></button>`
      :`<button class="act-btn" title="Emitir CAE" onclick="emitir('${c._id||c.id}')"><svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M7 1.5l5.5 10H1.5L7 1.5z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M7 5.5v3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><circle cx="7" cy="10" r=".6" fill="currentColor"/></svg></button>`;
    return `<tr style="animation:rowIn .3s ease ${i*35}ms both">
      <td style="text-align:center">${origenPill}</td>
      <td style="font-family:var(--font-num);font-size:11px;font-weight:600">${c.id}</td>
      <td><div style="font-weight:600;font-size:12px">${c.cliente}</div>${c.email?`<div style="font-size:10px;color:var(--text-3)">${c.email}</div>`:''}</td>
      <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:var(--text-2)">${c.concepto}</td>
      <td style="font-size:12px;color:var(--text-3)">${c.fecha}</td>
      <td style="text-align:right;font-family:var(--font-num);font-weight:700;font-size:13px">${ars(c.monto)}</td>
      <td style="text-align:center">${estadoChip}</td>
      <td style="text-align:center"><div class="comp-actions" style="justify-content:center">
        <button class="act-btn" title="Ver PDF" onclick="verPDF('${c._id||c.id}')"><svg width="13" height="13" viewBox="0 0 14 14" fill="none"><rect x="2" y="1" width="8" height="11" rx="1.5" stroke="currentColor" stroke-width="1.3"/><path d="M4 4.5h4M4 6.5h4M4 8.5h2.5" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg></button>
        ${emitidoBtn}
        <button class="act-btn" title="Enviar mail" onclick="enviarMail('${c._id||c.id}')"><svg width="13" height="13" viewBox="0 0 14 14" fill="none"><rect x="1.5" y="3" width="11" height="8" rx="1.5" stroke="currentColor" stroke-width="1.3"/><path d="M1.5 5l5.5 3.5L12.5 5" stroke="currentColor" stroke-width="1.2"/></svg></button>
      </div></td>
    </tr>`;
  }).join('');
  renderTotalesComp(lista);
}

function renderTotalesComp(lista){
  const activos=lista.filter(c=>c.estado!=='anulado');
  const total=activos.reduce((s,c)=>s+c.monto,0);
  const pend=activos.filter(c=>c.estado==='pendiente').length;
  const woo=activos.filter(c=>c.origen!=='manual').length;
  const man=activos.filter(c=>c.origen==='manual').length;
  const el=document.getElementById('compTotales');
  if(!el) return;
  el.innerHTML=`
    <div class="total-chip">${activos.length} comprobante${activos.length!==1?'s':''}</div>
    <div class="total-chip">Total: <strong>${ars(total)}</strong></div>
    <div class="total-chip">Plataformas: <strong>${woo}</strong> · Manuales: <strong>${man}</strong></div>
    ${pend?`<div class="total-chip" style="border-color:rgba(255,179,0,.3);color:var(--yellow)">${pend} pendiente${pend!==1?'s':''} de emitir</div>`:''}`;
}

/* ── CALENDARIO COMPROBANTES ─── */
function toggleCalendario(){
  const dd=document.getElementById('calDropdown');
  const btn=document.getElementById('btnPeriodo');
  const open=dd.classList.toggle('open');
  btn.classList.toggle('active',open);
  if(open){setTimeout(()=>document.addEventListener('click',function _c(e){
    const w=document.querySelector('.comp-periodo-wrap');
    if(w&&!w.contains(e.target)){dd.classList.remove('open');btn.classList.remove('active');document.removeEventListener('click',_c);}
  }),10);}
}

function aplicarPreset(preset,btn){
  document.querySelectorAll('.cal-preset').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  const hoy=new Date(),y=hoy.getFullYear(),m=hoy.getMonth();
  if(preset==='mes')  {_rangoDesde=new Date(y,m,1);   _rangoHasta=new Date(y,m+1,0);  document.getElementById('btnPeriodoLabel').textContent='Este mes';}
  if(preset==='ant')  {_rangoDesde=new Date(y,m-1,1); _rangoHasta=new Date(y,m,0);    document.getElementById('btnPeriodoLabel').textContent='Mes anterior';}
  if(preset==='trim') {const ts=Math.floor(m/3)*3;_rangoDesde=new Date(y,ts,1);_rangoHasta=new Date(y,ts+3,0);document.getElementById('btnPeriodoLabel').textContent='Trimestre';}
  if(preset==='anio') {_rangoDesde=new Date(y,0,1);   _rangoHasta=new Date(y,11,31);  document.getElementById('btnPeriodoLabel').textContent='Este año';}
  if(preset==='todo') {_rangoDesde=null;              _rangoHasta=null;               document.getElementById('btnPeriodoLabel').textContent='Todo';}
  filtrarComprobantes();
}

function aplicarRangoCustom(){
  const d=document.getElementById('calDesde')?.value;
  const h=document.getElementById('calHasta')?.value;
  if(!d&&!h) return;
  _rangoDesde=d?new Date(d):null;
  _rangoHasta=h?new Date(h+'T23:59:59'):null;
  document.querySelectorAll('.cal-preset').forEach(b=>b.classList.remove('active'));
  if(d){
    const fmt=dt=>dt.toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit'});
    document.getElementById('btnPeriodoLabel').textContent=_rangoHasta?`${fmt(_rangoDesde)} → ${fmt(_rangoHasta)}`:`Desde ${fmt(_rangoDesde)}`;
  }
  filtrarComprobantes();
}

/* ── MODAL NUEVA EMISIÓN ─── */
function abrirNuevaEmision(){
  document.getElementById('modalOverlay').classList.add('open');
  document.getElementById('modalEmision').classList.add('open');
  document.getElementById('emError').style.display='none';
  ['emCliente','emEmail','emConcepto','emMonto'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  const t=document.getElementById('emTipo');if(t)t.value='Factura C';
  setTimeout(()=>document.getElementById('emCliente')?.focus(),100);
}

function cerrarNuevaEmision(){
  document.getElementById('modalOverlay').classList.remove('open');
  document.getElementById('modalEmision').classList.remove('open');
}

async function registrarEmision(){
  const cliente =(document.getElementById('emCliente')?.value||'').trim();
  const email   =(document.getElementById('emEmail')?.value||'').trim();
  const concepto=(document.getElementById('emConcepto')?.value||'').trim();
  const monto   =parseFloat(document.getElementById('emMonto')?.value||'0');
  const errEl   =document.getElementById('emError');

  if(!cliente||!concepto||!monto){errEl.textContent='Completá los campos obligatorios.';errEl.style.display='block';return;}
  if(email&&!email.includes('@')){errEl.textContent='El email no es válido.';errEl.style.display='block';return;}
  if(monto<=0){errEl.textContent='El monto debe ser mayor a 0.';errEl.style.display='block';return;}

  errEl.style.display='none';
  const btn=document.getElementById('btnRegistrar');
  btn.disabled=true;
  btn.innerHTML='<span class="material-icons" style="font-size:14px!important">sync</span> Registrando…';

  try{
    const res=await api.post('/api/orders/manual',{cliente,email,concepto,monto});
    toast('✅ Venta registrada'+(res.message?'. '+res.message:''),'success');
    cerrarNuevaEmision();
    _recargarDashConPeriodo();
    if(vistaActual==='comprobantes') setTimeout(cargarTodosComprobantes,500);
  }catch(e){
    errEl.textContent='Error: '+e.message;
    errEl.style.display='block';
  }finally{
    btn.disabled=false;
    btn.innerHTML='<span class="material-icons" style="font-size:15px!important">save</span> Registrar';
  }
}

/* ── MI NEGOCIO ─── */
let _plataformaActual=null;

async function cargarIntegraciones(){
  const cont=document.getElementById('negIntegraciones');
  try{
    const {integrations:list}=await api.get('/api/integrations');
    const connected={};(list||[]).forEach(i=>{connected[i.platform]=i;});
    ['woocommerce','mercadolibre','tiendanube','empretienda','rappi','vtex'].forEach(p=>{
      const tog=document.getElementById('toggle-'+p);
      const desc=document.getElementById('desc-'+p);
      const card=document.getElementById('card-'+p);
      const intg=connected[p];
      if(tog) tog.checked=!!(intg&&intg.status==='active');
      if(card) card.classList.toggle('is-active',!!(intg&&intg.status==='active'));
      if(desc){desc.textContent=intg?(intg.status==='active'?`✓ ${intg.storeName||intg.storeId}`:'⚠ Error de conexión'):'Sin conectar';desc.style.color=(intg&&intg.status==='active')?'var(--green)':'';}
    });
    if(!list||!list.length){
      cont.innerHTML=`<div class="neg-empty"><span class="material-icons" style="font-size:32px;opacity:.3">store_off</span><span>Todavía no conectaste ninguna tienda</span></div>`;
      return;
    }
    const LOGOS={woocommerce:'🛍',tiendanube:'☁️',mercadolibre:'🛒',empretienda:'🏪',rappi:'🛵',vtex:'⚡'};
    cont.innerHTML=list.map(i=>`
      <div class="neg-integration">
        <div class="neg-integration-logo">${LOGOS[i.platform]||'🔗'}</div>
        <div class="neg-integration-info">
          <div class="neg-integration-name">${i.storeName||i.storeId}</div>
          <div class="neg-integration-url">${i.platform} · ${i.storeUrl||i.storeId}</div>
        </div>
        <span class="neg-integration-status ${i.status==='active'?'neg-status-ok':'neg-status-error'}">${i.status==='active'?'● Activa':'✕ Error'}</span>
        <button class="neg-disconnect-btn" onclick="desconectar('${i._id}')">Desconectar</button>
      </div>`).join('');
  }catch(e){
    if(cont) cont.innerHTML=`<div style="color:var(--text-3);font-size:12px;padding:20px">Error: ${e.message}</div>`;
  }
}

async function desconectar(id){
  if(!confirm('¿Desconectar esta tienda?')) return;
  try{await api.del(`/api/integrations/${id}`);toast('Tienda desconectada','warn');cargarIntegraciones();}
  catch(e){toast('Error: '+e.message,'error');}
}

function toggleIntegracion(platform,enabled){
  const card=document.getElementById('card-'+platform);
  if(card) card.classList.toggle('is-active',enabled);
}

function abrirConexion(plataforma){
  _plataformaActual=plataforma;
  document.getElementById('negMsgError').style.display='none';
  document.querySelectorAll('[id^="negForm"]').forEach(f=>f.style.display='none');
  const NOMBRES={woocommerce:'WooCommerce',mercadolibre:'Mercado Libre',tiendanube:'Tienda Nube',empretienda:'Empretienda',rappi:'Rappi',vtex:'VTEX'};
  document.getElementById('negModalTitle').innerHTML=`<span class="material-icons" style="color:var(--orange-2)">link</span> Conectar ${NOMBRES[plataforma]||plataforma}`;
  const forms={woocommerce:'negFormWoo',mercadolibre:'negFormML',tiendanube:'negFormTN',empretienda:'negFormEM',rappi:'negFormRappi',vtex:'negFormVTEX'};
  const fid=forms[plataforma];if(fid) document.getElementById(fid).style.display='block';
  document.getElementById('lblConectar').textContent=['woocommerce','mercadolibre'].includes(plataforma)?'Ir a autorizar →':'Conectar';
  document.getElementById('negModalOverlay').classList.add('open');
  document.getElementById('negModal').classList.add('open');
}

function cerrarConexion(){
  document.getElementById('negModalOverlay').classList.remove('open');
  document.getElementById('negModal').classList.remove('open');
  _plataformaActual=null;
}

async function confirmarConexion(){
  const btn=document.getElementById('btnConectar');
  const err=document.getElementById('negMsgError');
  err.style.display='none'; btn.disabled=true;
  try{
    switch(_plataformaActual){
      case'woocommerce':{
        const url=document.getElementById('wooStoreUrl')?.value.trim();
        if(!url) throw new Error('Ingresá la URL de tu tienda.');
        if(!url.startsWith('http')) throw new Error('La URL debe comenzar con http://');
        window.location.href=`/auth/woo/connect?store_url=${encodeURIComponent(url)}`; return;
      }
      case'mercadolibre':{ window.location.href='/auth/ml/connect'; return; }
      case'tiendanube':{
        const storeId=document.getElementById('tnStoreId')?.value.trim();
        const storeName=document.getElementById('tnStoreName')?.value.trim();
        const apiToken=document.getElementById('tnApiToken')?.value.trim();
        if(!storeId||!apiToken) throw new Error('Completá Store ID y API Token.');
        await api.post('/api/integrations/tiendanube',{storeId,storeName,apiToken});
        toast('✅ Tienda Nube conectada','success'); cerrarConexion(); cargarIntegraciones(); break;
      }
      case'empretienda':{
        const storeId=document.getElementById('emSlug')?.value.trim();
        const apiToken=document.getElementById('emApiToken')?.value.trim();
        if(!storeId||!apiToken) throw new Error('Completá slug y API Token.');
        await api.post('/api/integrations/empretienda',{storeId,apiToken});
        toast('✅ Empretienda conectada','success'); cerrarConexion(); cargarIntegraciones(); break;
      }
      case'rappi':{
        const storeId=document.getElementById('rappiId')?.value.trim();
        const storeName=document.getElementById('rappiName')?.value.trim();
        const apiToken=document.getElementById('rappiToken')?.value.trim();
        if(!storeId||!apiToken) throw new Error('Completá Restaurant ID y API Token.');
        await api.post('/api/integrations/rappi',{storeId,storeName,apiToken});
        toast('✅ Rappi conectado','success'); cerrarConexion(); cargarIntegraciones(); break;
      }
      case'vtex':{
        const accountName=document.getElementById('vtexAccount')?.value.trim();
        const apiKey=document.getElementById('vtexAppKey')?.value.trim();
        const apiToken=document.getElementById('vtexAppToken')?.value.trim();
        if(!accountName||!apiKey||!apiToken) throw new Error('Completá todos los campos.');
        await api.post('/api/integrations/vtex',{storeId:accountName,storeUrl:`https://${accountName}.myvtex.com`,apiKey,apiToken});
        toast('✅ VTEX conectado','success'); cerrarConexion(); cargarIntegraciones(); break;
      }
    }
  }catch(e){err.textContent=e.message;err.style.display='block';}
  finally{btn.disabled=false;}
}

/* ── SUSCRIPCIÓN ─── */
async function verificarSuscripcion(){
  try{
    const {user}=await api.get('/api/me');
    if(user?.plan==='pro') mostrarSuscripcionActiva(user.creadoEn);
    else{
      document.getElementById('susc-activa').style.display='none';
      document.getElementById('susc-inactiva').style.display='block';
      document.getElementById('susc-cargando').style.display='none';
    }
  }catch{document.getElementById('susc-inactiva').style.display='block';}
}

function mostrarSuscripcionActiva(fechaAlta){
  document.getElementById('susc-activa').style.display='block';
  document.getElementById('susc-inactiva').style.display='none';
  document.getElementById('susc-cargando').style.display='none';
  if(fechaAlta){const el=document.getElementById('susc-fecha-alta');if(el)el.textContent='Activa desde '+new Date(fechaAlta).toLocaleDateString('es-AR');}
}

async function iniciarSuscripcion(){
  document.getElementById('susc-inactiva').style.display='none';
  document.getElementById('susc-cargando').style.display='block';
  try{
    const res=await api.post('/api/suscripcion/crear',{});
    if(res?.url) window.open(res.url,'_blank');
    else { toast('Demo: redirigiendo a Mercado Pago…','info'); window.open('https://www.mercadopago.com.ar','_blank'); }
  }catch{
    toast('Demo: redirigiendo a Mercado Pago…','info');
    window.open('https://www.mercadopago.com.ar','_blank');
  }finally{
    document.getElementById('susc-cargando').style.display='none';
    document.getElementById('susc-inactiva').style.display='block';
  }
}

function cancelarSuscripcion(){if(!confirm('¿Cancelar la suscripción a KOI?')) return;toast('Procesando cancelación…','info');}

/* ── SIDEBAR MOBILE ─── */
function toggleSidebar(){
  const s=document.querySelector('.sidebar');
  const o=document.getElementById('mobOverlay');
  const b=document.getElementById('mobHamburger');
  const open=s.classList.toggle('mob-open');
  o.classList.toggle('visible',open);
  b.classList.toggle('is-open',open);
  document.body.style.overflow=open?'hidden':'';
}
function cerrarSidebar(){
  document.querySelector('.sidebar').classList.remove('mob-open');
  document.getElementById('mobOverlay').classList.remove('visible');
  document.getElementById('mobHamburger').classList.remove('is-open');
  document.body.style.overflow='';
}

/* ── MISC ─── */
function conmutarEstado(){
  const dot=document.getElementById('sidebarDot');
  const on=!dot.classList.contains('offline');
  renderStatus(!on);
  toast(!on?'AFIP: activo':'AFIP: pausado',!on?'success':'warn');
}
function verPDF(id)   { toast('PDF: próximamente disponible','info'); }
function enviarMail(id){ toast('Envío de mail: configurar proveedor de email','info'); }
function exportarIvaVentas(){ toast('Exportando IVA Ventas…','info'); }

/* ── INIT ─── */
document.addEventListener('DOMContentLoaded',async()=>{
  // Mobile sidebar
  document.querySelectorAll('.nav-item').forEach(item=>{
    item.addEventListener('click',()=>{if(window.innerWidth<=720)cerrarSidebar();});
  });

  // OAuth return
  const params=new URLSearchParams(window.location.search);
  if(params.get('woo')==='connected'){
    toast('✅ WooCommerce conectado. Sincronizando historial…','success');
    history.replaceState({},'','/dashboard');
    mostrarVista('negocio'); return;
  }
  if(params.get('ml')==='connected'){
    toast('✅ Mercado Libre conectado. Sincronizando historial…','success');
    history.replaceState({},'','/dashboard');
    mostrarVista('negocio'); return;
  }
  if(params.get('error')==='ml_failed'){
    toast('Error al conectar Mercado Libre','error');
    history.replaceState({},'','/dashboard');
  }

  // Inicializar período
  _initDashPeriod();

  // Cargar usuario
  try{
    const {user}=await api.get('/api/me');
    window.currentUser=user;
    // Estado AFIP en topbar
    if(user?.settings?.arcaStatus==='vinculado') renderStatus(true);
  }catch(e){
    if(e.message.includes('401')||e.message.includes('autenticado')){
      window.location.href='/login'; return;
    }
  }

  // Dashboard inicial
  await _recargarDashConPeriodo();

  // Estado AFIP en background
  api.get('/api/afip/estado')
    .then(r=>renderStatus(r.online))
    .catch(()=>renderStatus(false));
});
