<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>KOI · Facturación</title>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&family=Space+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet"/>
  <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet"/>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js"></script>

  <style>
    :root {
      --bg:           #080810;
      --bg-2:         #0d0d1a;
      --surface:      #111120;
      --card:         #13131f;
      --card-2:       #17172a;
      --border:       rgba(255,255,255,0.055);
      --border-2:     rgba(255,255,255,0.09);
      --green:        #00e676;
      --green-dim:    #00c853;
      --green-glow:   rgba(0,230,118,0.18);
      --green-soft:   rgba(0,230,118,0.08);
      --orange:       #e8622a;
      --orange-2:     #f5a623;
      --orange-glow:  rgba(232,98,42,0.22);
      --orange-soft:  rgba(232,98,42,0.10);
      --red:          #ff3d57;
      --yellow:       #ffb300;
      --blue:         #2979ff;
      --text-1:       #f0f0fa;
      --text-2:       #8888aa;
      --text-3:       #44445a;
      --font-ui:      'Plus Jakarta Sans', sans-serif;
      --font-num:     'Space Grotesk', sans-serif;
      --r-sm:  8px; --r-md:  14px; --r-lg:  18px; --r-xl:  24px;
      --sh-card: 0 4px 24px rgba(0,0,0,0.5);
      --sh-glow: 0 0 28px rgba(0,230,118,0.22);
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { height: 100%; }
    body {
      background: var(--bg);
      color: var(--text-1);
      font-family: var(--font-ui);
      font-size: 13px;
      line-height: 1.5;
      min-height: 100vh;
      position: relative;
    }

    /* LAYOUT */
    .shell { display: flex; min-height: 100vh; height: 100%; position: relative; }

    /* SIDEBAR */
    .sidebar {
      width: 220px; flex-shrink: 0;
      background: var(--card);
      border-right: 1px solid var(--border);
      display: flex; flex-direction: column;
      padding: 24px 0 20px;
      position: sticky; top: 0;
      height: 100vh; overflow: hidden;
    }
    .sidebar-logo {
      display: flex; align-items: center; gap: 10px;
      padding: 0 20px 28px;
      border-bottom: 1px solid var(--border);
      margin-bottom: 12px;
    }
    .logo-mark {
      width: 36px; height: 36px; border-radius: 10px;
      background: linear-gradient(135deg, var(--orange), var(--orange-2), var(--green));
      display: flex; align-items: center; justify-content: center;
      font-size: 19px; box-shadow: 0 0 28px rgba(232,98,42,.35); flex-shrink: 0;
    }
    .logo-name { font-weight: 800; font-size: 16px; color: var(--text-1); }
    .logo-sub  { font-size: 9px; font-weight: 500; color: var(--text-3); letter-spacing: 1.4px; text-transform: uppercase; }
    .nav-section {
      padding: 6px 12px 4px; font-size: 9px; font-weight: 700;
      letter-spacing: 2px; text-transform: uppercase; color: var(--text-3); margin-top: 8px;
    }
    .nav-item {
      display: flex; align-items: center; gap: 10px;
      padding: 9px 20px; color: var(--text-2);
      cursor: pointer; font-weight: 500; font-size: 13px;
      transition: all 0.18s; position: relative;
      margin: 1px 8px; border-radius: var(--r-sm);
    }
    .nav-item:hover { background: rgba(255,255,255,0.04); color: var(--text-1); }
    .nav-item.active { background: var(--green-soft); color: var(--green); }
    .nav-item.active::before {
      content:''; position:absolute; left:0; top:20%; bottom:20%;
      width:3px; background: var(--green); border-radius: 0 3px 3px 0;
      box-shadow: 0 0 10px rgba(0,230,118,.5); margin-left: -8px;
    }
    .nav-icon { font-size: 17px !important; opacity: 0.8; }
    .nav-badge {
      margin-left: auto; background: var(--red); color: #fff;
      font-size: 9px; font-weight: 700; padding: 2px 6px; border-radius: 999px;
    }
    .sidebar-footer { margin-top: auto; padding: 16px 20px 0; border-top: 1px solid var(--border); }

    .server-status {
      display: flex; align-items: center; gap: 8px;
      padding: 10px 12px; border-radius: var(--r-sm);
      background: var(--card-2); border: 1px solid var(--border);
      cursor: pointer; transition: border-color 0.2s;
    }
    .server-status:hover { border-color: var(--border-2); }
    .status-dot {
      width: 8px; height: 8px; border-radius: 50%;
      background: var(--green); box-shadow: 0 0 8px var(--green);
      animation: pulse 2s infinite; flex-shrink: 0;
    }
    .status-dot.offline  { background: var(--red); box-shadow: 0 0 8px var(--red); }
    .status-dot.checking { background: var(--yellow); box-shadow: 0 0 8px var(--yellow); }
    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
    .status-info { flex:1; min-width:0; }
    .status-label { font-weight: 600; font-size: 12px; color: var(--text-1); }
    .status-sub   { font-size: 10px; color: var(--text-3); }

    /* MAIN */
    .main { flex:1; overflow-x:hidden; display:flex; flex-direction:column; }

    /* TOPBAR */
    .topbar {
      display: grid;
      grid-template-columns: 1fr auto 1fr;
      align-items: center;
      padding: 10px 24px;
      border-bottom: 1px solid var(--border);
      background: var(--card);
      position: sticky; top:0; z-index:10;
      box-shadow: 0 1px 0 rgba(232,98,42,.08);
      gap: 16px;
    }
    .topbar-right { justify-content: flex-end; }
    .topbar-left { display:flex; flex-direction:column; gap:2px; }
    .topbar-title { font-weight: 700; font-size: 15px; color: var(--text-1); }
    .topbar-sub   { font-size: 10px; color: var(--text-3); letter-spacing:.3px; }
    .topbar-right { display:flex; align-items:center; gap:10px; }
    .topbar-status {
      display:flex; align-items:center; gap:7px;
      padding:6px 13px; border-radius:999px;
      background:var(--card-2); border:1px solid var(--border);
      font-size:12px; font-weight:600; color:var(--text-2);
      cursor:pointer; transition:border-color .2s;
    }
    .topbar-status:hover { border-color:rgba(0,230,118,.25); color:var(--text-1); }

    .topbar-period-wrap {
      position: relative; display: flex; justify-content: center;
    }
    .topbar-period-btn {
      display:inline-flex; align-items:center; gap:8px;
      padding:7px 16px; border-radius:var(--r-sm);
      background:rgba(232,98,42,.09);
      border:1px solid rgba(232,98,42,.25);
      color:var(--orange-2);
      font-family:var(--font-ui); font-weight:600; font-size:13px;
      cursor:pointer; white-space:nowrap; transition:all .18s;
      letter-spacing:0.1px;
    }
    .topbar-period-btn:hover {
      background:rgba(232,98,42,.16);
      border-color:rgba(232,98,42,.4);
      box-shadow:0 2px 12px rgba(232,98,42,.2);
    }
    .topbar-cal-dropdown {
      position:absolute; top:calc(100% + 10px); left:50%;
      transform:translateX(-50%);
      width:380px;
      background:var(--card); border:1px solid rgba(232,98,42,.18);
      border-radius:var(--r-lg);
      box-shadow:0 20px 48px rgba(0,0,0,.7), 0 0 0 1px rgba(232,98,42,.08);
      z-index:999; padding:18px 18px 14px;
      display:none; animation:fadeUp .18s ease;
    }
    .topbar-cal-dropdown.open { display:block; }

    .tcal-presets { display:flex; gap:6px; flex-wrap:wrap; margin-bottom:0; }
    .tcal-preset {
      padding:5px 14px; border-radius:999px;
      background:rgba(255,255,255,.04); border:1px solid var(--border);
      color:var(--text-2); font-family:var(--font-ui); font-weight:600;
      font-size:11px; cursor:pointer; transition:all .14s;
    }
    .tcal-preset:hover { border-color:rgba(232,98,42,.3); color:var(--orange-2); }
    .tcal-preset.active {
      background:rgba(232,98,42,.12); border-color:rgba(232,98,42,.4);
      color:var(--orange-2);
    }

    .tcal-divider { height:1px; background:var(--border); margin:14px 0 12px; }

    .tcal-custom-lbl {
      font-size:9px; font-weight:700; letter-spacing:2px;
      text-transform:uppercase; color:var(--text-3); margin-bottom:10px;
    }
    .tcal-custom-inputs { display:flex; align-items:center; gap:8px; }
    .tcal-custom-inputs > div { flex:1; }
    .tcal-arrow { color:var(--text-3); font-size:14px; flex-shrink:0; padding-top:16px; }
    .tcal-input-lbl { font-size:10px; color:var(--text-3); margin-bottom:4px; font-weight:600; letter-spacing:.5px; }
    .tcal-input { background:var(--card-2) !important; font-size:12px; padding:7px 10px; }

    .tcal-active-label {
      font-size:10px; color:rgba(232,98,42,.5); text-align:center;
      margin-top:10px; font-weight:600; letter-spacing:.5px;
      min-height:14px;
    }

    /* CONTENT */
    .content { padding: 22px 24px 40px; animation: fadeUp .4s ease both; }
    @keyframes fadeUp { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:translateY(0)} }

    .sec-label {
      font-size:10px; font-weight:700; letter-spacing:2px;
      text-transform:uppercase; color:var(--text-3); margin-bottom:12px;
    }

    /* MONO */
    .mono-card {
      background: var(--card); border: 1px solid var(--border);
      border-radius: var(--r-xl); padding: 22px 24px 20px;
      margin-bottom: 20px; position: relative; overflow: hidden;
      box-shadow: var(--sh-card);
    }
    .mono-card::after {
      content:''; position:absolute; top:-60px; right:-60px;
      width:220px; height:220px; border-radius:50%;
      background: radial-gradient(circle,rgba(232,98,42,.05) 0%,rgba(0,230,118,.04) 60%,transparent 100%);
      pointer-events:none;
    }
    .mono-top { display:flex; justify-content:space-between; align-items:center; margin-bottom:18px; }
    .mono-left h3 { font-weight:700; font-size:14px; color:var(--text-1); }
    .mono-left p  { font-size:11px; color:var(--text-3); margin-top:2px; }
    .cat-chip {
      display:inline-flex; align-items:center; gap:6px;
      padding:5px 14px; border-radius:999px;
      background:var(--green-soft); border:1px solid rgba(0,230,118,.2);
      color:var(--green); font-size:12px; font-weight:700; font-family:var(--font-num);
    }
    .cat-dot { width:6px;height:6px;border-radius:50%;background:var(--green);box-shadow:0 0 6px var(--green); }
    .mono-numbers { display:flex; justify-content:space-between; align-items:flex-end; margin-bottom:14px; }
    .mono-amount {
      font-family:var(--font-num); font-weight:700;
      font-size:32px; color:var(--text-1); letter-spacing:-1px; line-height:1;
    }
    .mono-amount span { font-size:15px; color:var(--text-3); font-weight:500; }
    .mono-limit-box { text-align:right; }
    .mono-limit-val { font-family:var(--font-num); font-size:14px; font-weight:600; color:var(--text-2); }
    .mono-limit-lbl { font-size:10px; color:var(--text-3); }
    .prog-track {
      width:100%; height:7px; background:rgba(255,255,255,.05);
      border-radius:999px; overflow:hidden; margin-bottom:10px;
    }
    .prog-fill {
      height:100%; border-radius:999px;
      background:linear-gradient(90deg,var(--orange),var(--orange-2),var(--green));
      box-shadow:0 0 12px rgba(0,230,118,.6);
      transition:width 1.2s cubic-bezier(.34,1.56,.64,1);
      position:relative;
    }
    .prog-fill.warn { background:linear-gradient(90deg,#ff9800,var(--yellow)); box-shadow:0 0 12px rgba(255,179,0,.6); }
    .prog-fill.crit { background:linear-gradient(90deg,#e53935,var(--red)); box-shadow:0 0 12px rgba(255,61,87,.6); }
    .prog-meta { display:flex; justify-content:space-between; align-items:center; }
    .prog-pct  { font-family:var(--font-num); font-weight:700; font-size:13px; color:var(--green); }
    .prog-mes  { font-size:11px; color:var(--text-3); }

    /* METRICS */
    .metrics-row { display:grid; grid-template-columns:repeat(3,1fr); gap:14px; margin-bottom:20px; }
    .metric-card {
      background:var(--card); border:1px solid var(--border);
      border-radius:var(--r-lg); padding:16px 14px 14px;
      box-shadow:var(--sh-card);
      transition:transform .2s,border-color .2s,box-shadow .2s;
      position:relative; overflow:visible; min-width:0;
    }
    .metric-card:hover {
      transform:translateY(-3px);
      border-color:rgba(0,230,118,.15);
      box-shadow:0 8px 32px rgba(0,0,0,.6),0 0 0 1px rgba(0,230,118,.08);
    }
    .mc-icon-wrap { width:36px;height:36px;border-radius:10px;display:flex;align-items:center;justify-content:center;margin-bottom:14px;font-size:17px; }
    .mc-today .mc-icon-wrap { background:var(--green-soft); }
    .mc-pend  .mc-icon-wrap { background:rgba(255,179,0,.08); }
    .mc-month .mc-icon-wrap { background:var(--orange-soft); }
    .mc-label { font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:var(--text-3);margin-bottom:6px; }
    .mc-value { font-family:var(--font-num);font-weight:700;font-size:clamp(14px,2vw,20px);color:var(--text-1);letter-spacing:-.5px;line-height:1.1;margin-bottom:6px;word-break:break-word; }
    .mc-delta { font-size:11px;font-weight:500;color:var(--text-3);display:flex;align-items:center;gap:3px; }
    .mc-delta.up   { color:var(--green); }
    .mc-delta.down { color:var(--red); }
    .mc-delta.warn { color:var(--yellow); }

    /* BOTTOM ROW */
    .bottom-row { display:grid; grid-template-columns:1fr 1fr; gap:14px; }

    /* CHART */
    .chart-card {
      background:var(--card); border:1px solid var(--border);
      border-radius:var(--r-xl); padding:20px 20px 14px; box-shadow:var(--sh-card);
      position:relative; overflow:hidden;
    }
    .chart-header { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:18px; }
    .chart-title { font-weight:700; font-size:14px; color:var(--text-1); }
    .chart-sub   { font-size:11px; color:var(--text-3); margin-top:2px; }
    .chart-total { text-align:right; }
    .chart-total-val { font-family:var(--font-num);font-weight:700;font-size:clamp(13px,1.8vw,18px);color:var(--green);letter-spacing:-.5px; }
    .chart-wrap  { position:relative; height:160px; }

    /* COMPROBANTES */
    .comp-card {
      background:var(--card); border:1px solid var(--border);
      border-radius:var(--r-xl); overflow:hidden; box-shadow:var(--sh-card);
      display:flex; flex-direction:column;
    }
    .comp-head {
      display:flex; align-items:center; justify-content:space-between;
      padding:18px 20px 14px; border-bottom:1px solid var(--border);
    }
    .comp-head-title { font-weight:700; font-size:14px; color:var(--text-1); }
    .comp-badge {
      padding:3px 9px; border-radius:999px;
      background:var(--green-soft); color:var(--green);
      font-size:11px; font-weight:700; border:1px solid rgba(0,230,118,.15);
    }
    .comp-scroll { flex:1; overflow-y:auto; max-height:420px; }
    .comp-row {
      display:flex; align-items:center; gap:10px;
      padding:11px 20px; border-bottom:1px solid var(--border);
      transition:background .14s;
    }
    .comp-row:hover { background:rgba(255,255,255,.02); }
    .cae-dot { width:7px;height:7px;border-radius:50%;flex-shrink:0; }
    .cae-ok   { background:var(--green); box-shadow:0 0 6px rgba(0,230,118,.7); }
    .cae-pend { background:var(--yellow); box-shadow:0 0 6px rgba(255,179,0,.7); }
    .cae-err  { background:var(--red);   box-shadow:0 0 6px rgba(255,61,87,.7); }
    .comp-info { flex:1; min-width:0; }
    .comp-cliente { font-weight:600;font-size:12px;color:var(--text-1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
    .comp-meta    { font-size:10px;color:var(--text-3);margin-top:1px; }
    .comp-monto   { font-family:var(--font-num);font-weight:700;font-size:12px;color:var(--text-1);margin-right:8px; }
    .comp-actions { display:flex; gap:4px; }
    .act-btn {
      width:28px;height:28px;border-radius:7px;
      background:var(--card-2); border:1px solid var(--border);
      color:var(--text-3); font-size:12px; cursor:pointer;
      display:flex;align-items:center;justify-content:center;
      transition:all .16s;
    }
    .act-btn:hover { background:var(--green-soft); border-color:rgba(0,230,118,.25); color:var(--green); }

    /* ACTION BAR */
    .ab-btn {
      display:inline-flex; align-items:center; gap:7px;
      padding:9px 18px; border-radius:var(--r-sm);
      font-family:var(--font-ui); font-weight:600; font-size:13px;
      cursor:pointer; border:none; transition:all .18s;
    }
    .ab-btn.primary { background:var(--green); color:#080810; }
    .ab-btn.secondary { background:var(--card-2); color:var(--text-1); border:1px solid var(--border); }

    /* CONFIG PANEL */
    .cfg-overlay {
      position:fixed; inset:0; background:rgba(0,0,0,0.65);
      z-index:100; opacity:0; pointer-events:none; transition:opacity .3s;
    }
    .cfg-overlay.open { opacity:1; pointer-events:all; }
    .cfg-panel {
      position:fixed; top:0; right:0; bottom:0; width:480px; max-width:100%;
      background:var(--card); border-left:1px solid var(--border);
      z-index:101; display:flex; flex-direction:column;
      transform:translateX(100%); transition:transform .35s cubic-bezier(.4,0,.2,1);
    }
    .cfg-panel.open { transform:translateX(0); }
    .cfg-panel-header { display:flex; align-items:center; justify-content:space-between; padding:20px 24px; border-bottom:1px solid var(--border); }
    .cfg-body { flex:1; overflow-y:auto; padding:24px 24px 40px; }
    .cfg-section { background:var(--card-2); border:1px solid var(--border); border-radius:var(--r-lg); padding:20px; margin-bottom:16px; position:relative; overflow:hidden; }
    .cfg-label { font-size:10px; font-weight:700; letter-spacing:1.5px; text-transform:uppercase; color:var(--text-3); }
    .cfg-input { width:100%; background:var(--card); border:1px solid var(--border); border-radius:var(--r-sm); color:var(--text-1); font-family:var(--font-ui); font-size:13px; padding:10px 14px; outline:none; }
    .input-wrap-cfg { position:relative; }
    .eye-btn-cfg { position:absolute; right:12px; top:50%; transform:translateY(-50%); background:none; border:none; cursor:pointer; color:var(--text-3); }

    /* SWITCHES CLAUDE-COMPATIBLE */
    .cfg-switch-row { display:flex; align-items:center; justify-content:space-between; background:var(--card); border:1px solid var(--border); border-radius:var(--r-md); padding:12px 16px; margin-top:4px; }
    .sw { position:relative; width:42px; height:24px; flex-shrink:0; }
    .sw input { opacity:0; width:0; height:0; position:absolute; }
    .sw-track { position:absolute; inset:0; background:var(--card-2); border:1px solid var(--border-2); border-radius:999px; cursor:pointer; transition:background .2s; }
    .sw-track::after { content:''; position:absolute; width:16px; height:16px; left:3px; top:3px; background:var(--text-3); border-radius:50%; transition:transform .2s; }
    .sw input:checked + .sw-track { background:var(--green-soft); border-color:rgba(0,230,118,0.35); }
    .sw input:checked + .sw-track::after { transform:translateX(18px); background:var(--green); }

    .btn-cfg-save { width:100%; padding:13px; border-radius:var(--r-sm); margin-top:18px; background:var(--green); border:none; font-weight:700; cursor:pointer; }
    .btn-cfg-sync { width:100%; padding:13px; border-radius:var(--r-sm); border:none; margin-top:18px; background:linear-gradient(135deg,#a855f7,#7c3aed); color:#fff; font-weight:700; cursor:pointer; }

    /* TOAST */
    #toast-wrap { position:fixed; bottom:24px; right:24px; z-index:9999; display:flex; flex-direction:column; gap:10px; pointer-events:none; }
    .toast { padding:12px 20px; border-radius:var(--r-md); background:var(--card-2); border-left:4px solid var(--green); color:var(--text-1); font-weight:600; box-shadow:0 10px 30px rgba(0,0,0,0.5); animation:toastIn .3s ease forwards; pointer-events:all; display:flex; align-items:center; gap:10px; }
    .toast.error { border-left-color:var(--red); }
    @keyframes toastIn { from{opacity:0;transform:translateX(50px)} to{opacity:1;transform:translateX(0)} }
  </style>
</head>

<body>
  <div class="shell">
    <aside class="sidebar">
      <div class="sidebar-logo">
        <div class="logo-mark"><span class="material-icons" style="color:#080810; font-size:22px;">bolt</span></div>
        <div class="logo-text"><div class="logo-name">KOI</div><div class="logo-sub">Facturación</div></div>
      </div>
      <div class="nav-section">Dashboard</div>
      <div class="nav-item active" onclick="mostrarVista('resumen')"><span class="material-icons nav-icon">dashboard</span> Panel General</div>
      <div class="nav-item" onclick="mostrarVista('ventas')"><span class="material-icons nav-icon">receipt_long</span> Ventas <span class="nav-badge" id="badgeVentas">...</span></div>
      <div class="nav-section">Herramientas</div>
      <div class="nav-item" onclick="mostrarVista('arca')"><span class="material-icons nav-icon">account_balance</span> ARCA / AFIP</div>
      <div class="nav-item" onclick="mostrarVista('negocio')"><span class="material-icons nav-icon">storefront</span> Mi Negocio</div>
      <div class="nav-section">Cuenta</div>
      <div class="nav-item" onclick="toggleConfig()"><span class="material-icons nav-icon">settings</span> Configuración</div>
      <div class="nav-item" style="color:var(--red)" onclick="cerrarSesion()"><span class="material-icons nav-icon">logout</span> Salir</div>
      <div class="sidebar-footer">
        <div class="server-status">
          <div class="status-dot" id="serverDot"></div>
          <div class="status-info"><div class="status-label" id="serverLabel">Conectando...</div></div>
        </div>
      </div>
    </aside>

    <main class="main">
      <header class="topbar">
        <div class="topbar-left"><div class="topbar-title" id="viewTitle">Panel General</div><div class="topbar-sub" id="viewSub">Sono Handmade</div></div>
        <div class="topbar-period-wrap">
          <button class="topbar-period-btn" onclick="togglePeriodDropdown()"><span class="material-icons" style="font-size:16px;">calendar_today</span> <span id="periodLabel">Este mes</span> <span class="material-icons">expand_more</span></button>
          <div class="topbar-cal-dropdown" id="periodDropdown"><div class="tcal-presets" id="periodPresets"></div></div>
        </div>
        <div class="topbar-right"><div class="topbar-status" id="arcaStatusBadge" onclick="mostrarVista('arca')"><div class="status-dot offline"></div> ARCA Offline</div></div>
      </header>

      <div id="content" class="content">
        <div id="v-resumen">
          <div class="mono-card">
            <div class="mono-top"><div class="mono-left"><h3 id="monoCat">Categoría -</h3><p>Límite Anual</p></div><div class="cat-chip">VIGENTE</div></div>
            <div class="mono-numbers"><div class="mono-amount" id="monoFact"><span>$</span> 0</div><div class="mono-limit-val" id="monoLimit">$ 0</div></div>
            <div class="prog-track"><div class="prog-fill" id="monoBar" style="width: 0%"></div></div>
            <div class="prog-meta"><div class="prog-pct" id="monoPct">0%</div><div class="prog-mes" id="monoMes">Período</div></div>
          </div>
          <div class="metrics-row">
            <div class="metric-card mc-today"><div class="mc-label">Hoy</div><div class="mc-value" id="valHoy">$ 0</div><div id="deltaHoy" class="mc-delta">...</div></div>
            <div class="metric-card mc-pend"><div class="mc-label">Pendientes</div><div class="mc-value" id="valPend">0</div><div id="deltaPend" class="mc-delta">...</div></div>
            <div class="metric-card mc-month"><div class="mc-label">Mes</div><div class="mc-value" id="valMes">$ 0</div><div id="deltaMes" class="mc-delta">...</div></div>
          </div>
          <div class="bottom-row">
            <div class="chart-card"><div class="chart-header"><div class="chart-title">Facturación</div><div class="chart-total-val" id="chartTotal">$ 0</div></div><div class="chart-wrap"><canvas id="mainChart"></canvas></div></div>
            <div class="comp-card"><div class="comp-head"><div class="comp-head-title">Últimas Ventas</div><div class="comp-badge" id="valVentasTotal">0</div></div><div class="comp-scroll" id="tablaHome"></div></div>
          </div>
        </div>

        <div id="v-arca" style="display:none">
          <div class="sec-label">AFIP</div>
          <div class="cfg-section">
            <h4 style="margin-bottom:10px;">Vincular CUIT Maestro</h4>
            <button class="btn-arca-sync" onclick="toggleConfig()">Ir a Configuración</button>
          </div>
        </div>

        <div id="v-negocio" style="display:none">
          <div class="sec-label">Integraciones</div>
          <div class="cfg-section">
            <div class="cfg-switch-row">
              <div><div class="cfg-switch-title">Facturación Automática</div><div class="cfg-switch-sub">Emitir CAE al recibir pago</div></div>
              <label class="sw"><input type="checkbox" id="swFactAuto" onchange="guardarSwitch('factAuto', this.checked)"><span class="sw-track"></span></label>
            </div>
            <div class="cfg-switch-row">
              <div><div class="cfg-switch-title">Envío de Email</div><div class="cfg-switch-sub">Enviar PDF al cliente</div></div>
              <label class="sw"><input type="checkbox" id="swEnvioEmail" onchange="guardarSwitch('envioAuto', this.checked)"><span class="sw-track"></span></label>
            </div>
          </div>
        </div>
      </div>
    </main>

    <div class="cfg-overlay" id="cfgOverlay" onclick="toggleConfig()"></div>
    <div class="cfg-panel" id="cfgPanel">
      <div class="cfg-panel-header"><h3>Configuración</h3><button onclick="toggleConfig()">Cerrar</button></div>
      <div class="cfg-body">
        <div class="cfg-section">
          <label class="cfg-label">Nombre</label><input type="text" id="cfgNombre" class="cfg-input">
          <button class="btn-cfg-save" onclick="guardarPerfil()">Guardar Perfil</button>
        </div>
        <div class="cfg-section">
          <label class="cfg-label">CUIT</label><input type="text" id="arcaCuit" class="cfg-input">
          <label class="cfg-label">Clave Fiscal</label>
          <div class="input-wrap-cfg"><input type="password" id="arcaClave" class="cfg-input"><button class="eye-btn-cfg" onclick="toggleClave()">👁️</button></div>
          <button class="btn-cfg-sync" id="btnArcaSync" onclick="sincronizarARCA()">Sincronizar AFIP</button>
        </div>
      </div>
    </div>
    <div id="toast-wrap"></div>
  </div>

  <script>
    /* ── CLIENTE API ── */
    const api = {
      async get(url) {
        const r = await fetch(url);
        if (!r.ok) throw new Error(r.status);
        return r.json();
      },
      async post(url, data) {
        const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        const res = await r.json();
        if (!r.ok) throw new Error(res.error || 'Error');
        return res;
      },
      async patch(url, data) {
        const r = await fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        const res = await r.json();
        if (!r.ok) throw new Error(res.error || 'Error');
        return res;
      }
    };

    /* ── VISTAS ── */
    function mostrarVista(id) {
      ['resumen', 'arca', 'negocio'].forEach(v => {
        const el = document.getElementById(`v-${v}`);
        if(el) el.style.display = (v === id) ? 'block' : 'none';
      });
      if (id === 'negocio') cargarConfigVista();
    }

    function toggleConfig() {
      document.getElementById('cfgOverlay').classList.toggle('open');
      document.getElementById('cfgPanel').classList.toggle('open');
      if (document.getElementById('cfgPanel').classList.contains('open')) cargarPerfilEnForm();
    }

    function toggleClave() {
      const input = document.getElementById('arcaClave');
      input.type = input.type === 'password' ? 'text' : 'password';
    }

    /* ── DASHBOARD ── */
    let myChart = null;
    async function _recargarDashConPeriodo() {
      try {
        const data = await api.get('/api/dashboard');
        renderDashboard(data);
      } catch (e) { console.error("Error dash", e); }
    }

    function renderDashboard(data) {
      document.getElementById('monoCat').innerText = `Categoría ${data.monoCategoria || 'C'}`;
      document.getElementById('monoFact').innerText = `$ ${(data.monoFacturado || 0).toLocaleString()}`;
      document.getElementById('valHoy').innerText = `$ ${(data.hoyFacturado || 0).toLocaleString()}`;
      document.getElementById('valPend').innerText = data.pendientesCAE || 0;
      document.getElementById('valMes').innerText = `$ ${(data.mesFacturado || 0).toLocaleString()}`;
      
      const tabla = document.getElementById('tablaHome');
      tabla.innerHTML = '';
      (data.ventas || []).forEach(v => {
        const row = document.createElement('div');
        row.className = 'comp-row';
        row.innerHTML = `
          <div class="cae-dot ${v.status === 'done' ? 'cae-ok' : 'cae-pend'}"></div>
          <div class="comp-info"><div>${v.customer}</div><div class="comp-meta">$ ${v.total.toLocaleString()}</div></div>
          <div class="comp-actions">
            ${v.status !== 'done' ? `<button class="act-btn" onclick="emitir('${v._id}')">⚡</button>` : '✅'}
          </div>
        `;
        tabla.appendChild(row);
      });
    }

    async function emitir(orderId) {
      try {
        toast('Emitiendo CAE...', 'info');
        const res = await api.post(`/api/orders/${orderId}/emitir`, {});
        if (res.ok) {
          toast('Factura generada!', 'success');
          _recargarDashConPeriodo();
        }
      } catch (e) { toast(e.message, 'error'); }
    }

    /* ── CONFIG ── */
    async function cargarPerfilEnForm() {
      try {
        const { user } = await api.get('/api/me');
        document.getElementById('cfgNombre').value = user.name || '';
        document.getElementById('arcaCuit').value = user.settings?.cuit || '';
      } catch (e) {}
    }

    async function guardarPerfil() {
      try {
        await api.patch('/api/me', { name: document.getElementById('cfgNombre').value });
        toast('Perfil guardado');
      } catch (e) { toast(e.message, 'error'); }
    }

    async function sincronizarARCA() {
      try {
        const cuit = document.getElementById('arcaCuit').value;
        const clave = document.getElementById('arcaClave').value;
        await api.post('/api/arca/vincular', { cuit, clave });
        toast('AFIP Vinculado');
        renderStatus(true);
      } catch (e) { toast(e.message, 'error'); }
    }

    async function cargarConfigVista() {
      try {
        const { user } = await api.get('/api/me');
        document.getElementById('swFactAuto').checked = !!user.settings?.factAuto;
        document.getElementById('swEnvioEmail').checked = !!user.settings?.envioAuto;
      } catch (e) {}
    }

    async function guardarSwitch(key, value) {
      try {
        await api.patch('/api/me/settings', { [key]: value });
        toast('Guardado');
      } catch (e) { toast('Error', 'error'); }
    }

    function renderStatus(online) {
      const dot = document.querySelector('#arcaStatusBadge .status-dot');
      const badge = document.getElementById('arcaStatusBadge');
      if (online) {
        dot.className = 'status-dot';
        badge.innerText = 'ARCA Online';
      }
    }

    function toast(msg, type = 'success') {
      const wrap = document.getElementById('toast-wrap');
      const t = document.createElement('div');
      t.className = `toast ${type === 'error' ? 'error' : ''}`;
      t.innerText = msg;
      wrap.appendChild(t);
      setTimeout(() => t.remove(), 3000);
    }

    window.addEventListener('DOMContentLoaded', () => {
      _recargarDashConPeriodo();
      api.get('/api/me').then(res => {
        if (res.user.settings?.arcaStatus === 'vinculado') renderStatus(true);
      }).catch(() => {});
    });

    function cerrarSesion() { window.location.href = '/api/auth/logout'; }
  </script>
</body>
</html>
