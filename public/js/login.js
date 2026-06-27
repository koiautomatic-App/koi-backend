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
// INICIALIZAR SELECTOR
// ============================================================

function initCountrySelector() {
  const container = document.getElementById('countrySelector');
  if (!container) return;

  container.innerHTML = `
    <div class="country-selector-wrapper">
      <button class="country-selector-btn" id="countryBtn">
        <span class="country-placeholder">🌎 Selecciona tu país</span>
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
    <div class="country-message" id="countryMessage" style="display:none;"></div>
  `;

  // Eventos
  const btn = document.getElementById('countryBtn');
  const dropdown = document.getElementById('countryDropdown');

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdown.classList.toggle('open');
    btn.classList.toggle('open');
  });

  document.addEventListener('click', () => {
    dropdown.classList.remove('open');
    btn.classList.remove('open');
  });

  document.querySelectorAll('.country-option').forEach(opt => {
    opt.addEventListener('click', () => {
      const code = opt.dataset.code;
      const country = COUNTRIES.find(c => c.code === code);
      if (country) {
        selectCountry(country);
        dropdown.classList.remove('open');
        btn.classList.remove('open');
      }
    });
  });
}

// ============================================================
// SELECCIONAR PAÍS
// ============================================================

function selectCountry(country) {
  selectedCountry = country;
  isBlocked = !SUPPORTED_COUNTRIES.includes(country.code);

  const btn = document.getElementById('countryBtn');
  const msg = document.getElementById('countryMessage');
  const pLogin = document.getElementById('pLogin');
  const pReg = document.getElementById('pReg');

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

  if (isBlocked) {
    msg.style.display = 'block';
    msg.className = 'country-message country-message-blocked';
    msg.innerHTML = `
      <strong>⛔ País no disponible</strong>
      <p>Koi se encuentra en fase de desarrollo y por el momento solo está disponible en Argentina.</p>
      <p><strong>¡Pronto llegaremos a más países!</strong></p>
      <button onclick="location.reload()" style="margin-top:12px;padding:8px 16px;background:rgba(249,115,22,0.2);border:0.5px solid rgba(249,115,22,0.3);border-radius:8px;color:#FB923C;cursor:pointer;">Intentar de nuevo</button>
    `;
    if (pLogin) pLogin.style.display = 'none';
    if (pReg) pReg.style.display = 'none';
  } else {
    msg.style.display = 'none';
    if (pLogin) pLogin.style.display = 'block';
    if (pReg) pReg.style.display = 'block';
  }
}

// ============================================================
// MODIFICAR LOGIN Y REGISTER PARA ENVIAR PAÍS
// ============================================================

// Guardar referencia a las funciones originales
const originalLogin = window.login;
const originalRegister = window.register;

// Modificar login
window.login = async function() {
  if (isBlocked || !selectedCountry) {
    err('Selecciona un país válido antes de continuar.');
    return;
  }
  
  const email = document.getElementById('lEmail').value.trim();
  const pass = document.getElementById('lPass').value;
  
  if (!email || !pass) return err('Completá email y contraseña.');
  
  load('btnL','spL','lblL', true);
  try {
    const res = await fetch('/auth/login', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        email,
        password: pass,
        pais: selectedCountry.code  // 👈 ENVIAR PAÍS
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al ingresar');
    ok('¡Bienvenido! Redirigiendo…');
    setTimeout(() => location.href = '/dashboard', 800);
  } catch(e) { err(e.message); }
  finally { load('btnL','spL','lblL', false); }
};

// Modificar register
window.register = async function() {
  if (isBlocked || !selectedCountry) {
    err('Selecciona un país válido antes de continuar.');
    return;
  }
  
  const nombre = document.getElementById('rNombre').value.trim();
  const apellido = document.getElementById('rApellido').value.trim();
  const email = document.getElementById('rEmail').value.trim();
  const pass = document.getElementById('rPass').value;
  
  if (!nombre || !email || !pass) return err('Completá todos los campos.');
  if (pass.length < 8) return err('La contraseña debe tener al menos 8 caracteres.');
  if (!email.includes('@')) return err('El email no es válido.');
  
  load('btnR','spR','lblR', true);
  try {
    const res = await fetch('/auth/register', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        nombre,
        apellido,
        email,
        password: pass,
        pais: selectedCountry.code  // 👈 ENVIAR PAÍS
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al registrarse');
    ok('¡Cuenta creada! Ya podés ingresar.');
    setTimeout(() => {
      switchTab('login');
      document.getElementById('lEmail').value = email;
    }, 1200);
  } catch(e) { err(e.message); }
  finally { load('btnR','spR','lblR', false); }
};

// ============================================================
// INICIALIZAR
// ============================================================

document.addEventListener('DOMContentLoaded', initCountrySelector);