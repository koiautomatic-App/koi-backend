// public/js/login.js
// ============================================================
// CONFIGURACIÓN
// ============================================================

const SUPPORTED_COUNTRIES = ['AR'];

const COUNTRIES = [
  { code: 'AR', name: 'Argentina', flag: '🇦🇷' },
  { code: 'MX', name: 'México', flag: '🇲🇽' },
  { code: 'CO', name: 'Colombia', flag: '🇨🇴' },
  { code: 'CL', name: 'Chile', flag: '🇨🇱' },
  { code: 'PE', name: 'Perú', flag: '🇵🇪' },
  { code: 'BR', name: 'Brasil', flag: '🇧🇷' },
  { code: 'UY', name: 'Uruguay', flag: '🇺🇾' },
  { code: 'PY', name: 'Paraguay', flag: '🇵🇾' },
  { code: 'BO', name: 'Bolivia', flag: '🇧🇴' },
  { code: 'VE', name: 'Venezuela', flag: '🇻🇪' },
  { code: 'EC', name: 'Ecuador', flag: '🇪🇨' },
  { code: 'GT', name: 'Guatemala', flag: '🇬🇹' },
  { code: 'HN', name: 'Honduras', flag: '🇭🇳' },
  { code: 'NI', name: 'Nicaragua', flag: '🇳🇮' },
  { code: 'CR', name: 'Costa Rica', flag: '🇨🇷' },
  { code: 'PA', name: 'Panamá', flag: '🇵🇦' },
  { code: 'DO', name: 'Rep. Dominicana', flag: '🇩🇴' },
  { code: 'PR', name: 'Puerto Rico', flag: '🇵🇷' },
];

let selectedCountry = null;
let isBlocked = false;

// ============================================================
// OCULTAR/MOSTRAR FORMULARIOS
// ============================================================

function hideAllForms() {
  console.log('🔍 [LOGIN] Ocultando todos los formularios');
  
  const pLogin = document.getElementById('pLogin');
  const pReg = document.getElementById('pReg');
  const tabs = document.querySelector('.tabs');
  const googleBtn = document.querySelector('.btn-google');
  const orSep = document.querySelector('.or-sep');

  if (pLogin) pLogin.style.display = 'none';
  if (pReg) pReg.style.display = 'none';
  if (tabs) tabs.style.display = 'none';
  if (googleBtn) googleBtn.style.display = 'none';
  if (orSep) orSep.style.display = 'none';
  
  console.log('✅ [LOGIN] Formularios ocultados');
}

function showAllForms() {
  console.log('🔍 [LOGIN] Mostrando formularios');
  
  const pLogin = document.getElementById('pLogin');
  const pReg = document.getElementById('pReg');
  const tabs = document.querySelector('.tabs');
  const googleBtn = document.querySelector('.btn-google');
  const orSep = document.querySelector('.or-sep');

  // Mostrar tabs y elementos comunes
  if (tabs) tabs.style.display = 'flex';
  if (googleBtn) googleBtn.style.display = 'flex';
  if (orSep) orSep.style.display = 'flex';
  
  // 👇 SOLO MOSTRAR EL PANEL ACTIVO
  // Verificar cuál tiene la clase 'active'
  const loginActive = pLogin?.classList.contains('active');
  const regActive = pReg?.classList.contains('active');
  
  console.log(`   loginActive: ${loginActive}, regActive: ${regActive}`);
  
  if (pLogin) {
    pLogin.style.display = loginActive ? 'block' : 'none';
    console.log(`   pLogin: ${loginActive ? 'mostrado' : 'ocultado'}`);
  }
  if (pReg) {
    pReg.style.display = regActive ? 'block' : 'none';
    console.log(`   pReg: ${regActive ? 'mostrado' : 'ocultado'}`);
  }
  
  console.log('✅ [LOGIN] Formularios mostrados correctamente');
}

// ============================================================
// INICIALIZAR SELECTOR
// ============================================================

function initCountrySelector() {
  console.log('🚀 [LOGIN] initCountrySelector() iniciado');
  
  const container = document.getElementById('countrySelector');
  if (!container) {
    console.error('❌ [LOGIN] No se encontró #countrySelector');
    return;
  }
  console.log('✅ [LOGIN] #countrySelector encontrado');

  // 👇 OCULTAR FORMULARIOS AL CARGAR LA PÁGINA
  hideAllForms();

  container.innerHTML = `
    <div class="country-selector-wrapper">
      <button class="country-selector-btn" id="countryBtn">
        <span class="country-placeholder">
          <span class="icon">🌎</span>
          Selecciona tu país
        </span>
        <svg class="country-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M6 9l6 6 6-6"/>
        </svg>
      </button>
      <div class="country-dropdown" id="countryDropdown">
        ${COUNTRIES.map(c => `
          <button class="country-option" data-code="${c.code}">
            <span class="country-flag">${c.flag}</span>
            <span class="country-name">${c.name}</span>
            ${c.code === 'AR' ? '<span class="country-badge">Disponible</span>' : ''}
          </button>
        `).join('')}
      </div>
    </div>
    <div class="country-message" id="countryMessage"></div>
  `;
  console.log('✅ [LOGIN] Selector HTML inyectado');

  const btn = document.getElementById('countryBtn');
  const dropdown = document.getElementById('countryDropdown');

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdown.classList.toggle('open');
    btn.classList.toggle('open');
    console.log(`🔄 [LOGIN] Dropdown ${dropdown.classList.contains('open') ? 'abierto' : 'cerrado'}`);
  });

  document.addEventListener('click', () => {
    if (dropdown.classList.contains('open')) {
      dropdown.classList.remove('open');
      btn.classList.remove('open');
      console.log('🔄 [LOGIN] Dropdown cerrado por click fuera');
    }
  });

  document.querySelectorAll('.country-option').forEach(opt => {
    opt.addEventListener('click', () => {
      const code = opt.dataset.code;
      const country = COUNTRIES.find(c => c.code === code);
      console.log(`🖱️ [LOGIN] País seleccionado: ${code} - ${country?.name}`);
      if (country) {
        selectCountry(country);
        dropdown.classList.remove('open');
        btn.classList.remove('open');
      }
    });
  });
  
  console.log('✅ [LOGIN] Event listeners configurados');
}

// ============================================================
// SELECCIONAR PAÍS
// ============================================================

function selectCountry(country) {
  console.log(`📌 [LOGIN] selectCountry() - País: ${country.code} - ${country.name}`);
  
  selectedCountry = country;
  isBlocked = !SUPPORTED_COUNTRIES.includes(country.code);
  
  console.log(`   isBlocked: ${isBlocked}`);
  console.log(`   SUPPORTED_COUNTRIES:`, SUPPORTED_COUNTRIES);

  const btn = document.getElementById('countryBtn');
  const msg = document.getElementById('countryMessage');

  // Actualizar botón
  btn.innerHTML = `
    <span class="country-selected">
      <span class="country-flag">${country.flag}</span>
      <span class="country-name">${country.name}</span>
      ${isBlocked ? '<span class="country-blocked">⛔ No disponible</span>' : ''}
    </span>
    <svg class="country-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M6 9l6 6 6-6"/>
    </svg>
  `;
  console.log('✅ [LOGIN] Botón actualizado');

  if (isBlocked) {
    // 🔒 PAÍS BLOQUEADO - OCULTAR TODO
    console.log('🚫 [LOGIN] PAÍS BLOQUEADO - Ocultando formularios');
    
    msg.style.display = 'block';
    msg.className = 'country-message country-message-blocked';
    msg.innerHTML = `
      <div style="display:flex;align-items:flex-start;gap:14px;">
        <span class="blocked-icon">⛔</span>
        <div>
          <span class="blocked-title">País no disponible</span>
          <p class="blocked-text">Koi se encuentra en fase de desarrollo y por el momento solo está disponible en <strong style="color:#F9FAFB;">Argentina</strong>.</p>
          <p class="blocked-sub">¡Pronto llegaremos a más países!</p>
          <button class="btn-retry" onclick="location.reload()">Intentar de nuevo</button>
        </div>
      </div>
    `;
    console.log('✅ [LOGIN] Mensaje de bloqueo mostrado');
    
    hideAllForms();

  } else {
    // ✅ PAÍS VÁLIDO - MOSTRAR TODO
    console.log('✅ [LOGIN] PAÍS VÁLIDO - Mostrando formularios');
    
    msg.style.display = 'none';
    msg.innerHTML = '';
    console.log('✅ [LOGIN] Mensaje ocultado');
    
    showAllForms();
    
    // Activar tab de login por defecto
    switchTab('login');
    console.log('✅ [LOGIN] Tab login activado');
  }
}

// ============================================================
// FUNCIONES DE SWITCH TAB - CORREGIDAS
// ============================================================

// Sobrescribir switchTab
window.switchTab = function(tab) {
  console.log(`🔄 [LOGIN] switchTab() - ${tab}`);
  
  const pLogin = document.getElementById('pLogin');
  const pReg = document.getElementById('pReg');
  const tabs = document.querySelectorAll('.tab');
  
  // Solo cambiar si Argentina está seleccionado
  if (selectedCountry && !isBlocked) {
    if (tab === 'login') {
      // Mostrar login, ocultar registro
      if (pLogin) {
        pLogin.style.display = 'block';
        pLogin.classList.add('active');
      }
      if (pReg) {
        pReg.style.display = 'none';
        pReg.classList.remove('active');
      }
      if (tabs[0]) tabs[0].classList.add('active');
      if (tabs[1]) tabs[1].classList.remove('active');
      document.getElementById('formTitle').textContent = 'Bienvenido';
      document.getElementById('formSub').textContent = 'Ingresá a tu cuenta';
      console.log('✅ [LOGIN] Mostrando formulario de login');
    } else if (tab === 'register') {
      // Mostrar registro, ocultar login
      if (pLogin) {
        pLogin.style.display = 'none';
        pLogin.classList.remove('active');
      }
      if (pReg) {
        pReg.style.display = 'block';
        pReg.classList.add('active');
      }
      if (tabs[0]) tabs[0].classList.remove('active');
      if (tabs[1]) tabs[1].classList.add('active');
      document.getElementById('formTitle').textContent = 'Empezá gratis';
      document.getElementById('formSub').textContent = '30 días de cortesía, sin tarjeta';
      console.log('✅ [LOGIN] Mostrando formulario de registro');
    }
    clearMsg();
  } else {
    console.warn('⚠️ [LOGIN] No se puede cambiar tab sin país seleccionado');
  }
};

// ============================================================
// MODIFICAR LOGIN Y REGISTER PARA ENVIAR PAÍS
// ============================================================

window.login = async function() {
  console.log('🔑 [LOGIN] login() ejecutado');
  console.log(`   isBlocked: ${isBlocked}`);
  console.log(`   selectedCountry: ${selectedCountry?.code || 'null'}`);
  
  if (isBlocked || !selectedCountry) {
    console.warn('⚠️ [LOGIN] Bloqueado o sin país seleccionado');
    err('Selecciona un país válido antes de continuar.');
    return;
  }
  
  const email = document.getElementById('lEmail').value.trim();
  const pass = document.getElementById('lPass').value;
  
  console.log(`   Email: ${email}`);
  
  if (!email || !pass) {
    console.warn('⚠️ [LOGIN] Email o contraseña vacíos');
    return err('Completá email y contraseña.');
  }
  
  load('btnL','spL','lblL', true);
  try {
    console.log(`📤 [LOGIN] Enviando petición con país: ${selectedCountry.code}`);
    const res = await fetch('/auth/login', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        email,
        password: pass,
        pais: selectedCountry.code
      })
    });
    const data = await res.json();
    console.log(`📥 [LOGIN] Respuesta:`, data);
    if (!res.ok) throw new Error(data.error || 'Error al ingresar');
    ok('¡Bienvenido! Redirigiendo…');
    setTimeout(() => location.href = '/dashboard', 800);
  } catch(e) { 
    console.error(`❌ [LOGIN] Error: ${e.message}`);
    err(e.message); 
  }
  finally { load('btnL','spL','lblL', false); }
};

window.register = async function() {
  console.log('📝 [REGISTER] register() ejecutado');
  console.log(`   isBlocked: ${isBlocked}`);
  console.log(`   selectedCountry: ${selectedCountry?.code || 'null'}`);
  
  if (isBlocked || !selectedCountry) {
    console.warn('⚠️ [REGISTER] Bloqueado o sin país seleccionado');
    err('Selecciona un país válido antes de continuar.');
    return;
  }
  
  const nombre = document.getElementById('rNombre').value.trim();
  const apellido = document.getElementById('rApellido').value.trim();
  const email = document.getElementById('rEmail').value.trim();
  const pass = document.getElementById('rPass').value;
  
  console.log(`   Email: ${email}`);
  
  if (!nombre || !email || !pass) {
    console.warn('⚠️ [REGISTER] Campos obligatorios faltantes');
    return err('Completá todos los campos.');
  }
  if (pass.length < 8) {
    console.warn('⚠️ [REGISTER] Contraseña muy corta');
    return err('La contraseña debe tener al menos 8 caracteres.');
  }
  if (!email.includes('@')) {
    console.warn('⚠️ [REGISTER] Email inválido');
    return err('El email no es válido.');
  }
  
  load('btnR','spR','lblR', true);
  try {
    console.log(`📤 [REGISTER] Enviando petición con país: ${selectedCountry.code}`);
    const res = await fetch('/auth/register', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        nombre,
        apellido,
        email,
        password: pass,
        pais: selectedCountry.code
      })
    });
    const data = await res.json();
    console.log(`📥 [REGISTER] Respuesta:`, data);
    if (!res.ok) throw new Error(data.error || 'Error al registrarse');
    ok('¡Cuenta creada! Ya podés ingresar.');
    setTimeout(() => {
      switchTab('login');
      document.getElementById('lEmail').value = email;
    }, 1200);
  } catch(e) { 
    console.error(`❌ [REGISTER] Error: ${e.message}`);
    err(e.message); 
  }
  finally { load('btnR','spR','lblR', false); }
};

// ============================================================
// INICIALIZAR
// ============================================================

console.log('🚀 [LOGIN] Script login.js cargado');
document.addEventListener('DOMContentLoaded', initCountrySelector);