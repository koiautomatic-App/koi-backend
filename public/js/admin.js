/**
 * KOI Admin Panel - JavaScript
 * Versión: 4.0 - Admin solo gestiona estado y punto de venta
 */

// ============================================================
//  DOM Elements
// ============================================================
const sidebar = document.getElementById('sidebar');
const refreshBtn = document.getElementById('refreshBtn');
const exportBtn = document.getElementById('exportBtn');
const healthBtn = document.getElementById('healthBtn');
const logoutBtn = document.getElementById('logoutBtn');
const maintenanceBtn = document.getElementById('maintenanceBtn');
const clearCacheBtn = document.getElementById('clearCacheBtn');
const healthModal = document.getElementById('healthModal');
const closeHealthModalBtn = document.getElementById('closeHealthModalBtn');
const apiBaseUrlInput = document.getElementById('apiBaseUrl');

// Variable global para el modal de clave
let claveModal = null;

// ============================================================
//  Toast Notifications
// ============================================================
function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    const icon = type === 'success' ? 'fa-check-circle' : 
                 type === 'error' ? 'fa-exclamation-circle' : 
                 type === 'warning' ? 'fa-exclamation-triangle' : 'fa-info-circle';
    toast.innerHTML = `<i class="fas ${icon}"></i> ${message}`;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

// ============================================================
//  Helper Functions
// ============================================================
function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

function formatDate(dateString) {
    if (!dateString) return '—';
    const date = new Date(dateString);
    return date.toLocaleDateString('es-AR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

// ============================================================
//  MOSTRAR CLAVE ARCA DESENCRIPTADA
// ============================================================
function mostrarClaveArca(userId, userEmail, userName) {
    if (!claveModal) {
        claveModal = document.createElement('div');
        claveModal.className = 'modal-overlay';
        claveModal.id = 'claveModal';
        claveModal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h2><i class="fas fa-key"></i> Clave ARCA del usuario</h2>
                    <button class="modal-close" id="closeClaveModalBtn">&times;</button>
                </div>
                <div class="modal-body">
                    <p><strong><i class="fas fa-user"></i> Usuario:</strong> <span id="claveModalUserName"></span></p>
                    <p><strong><i class="fas fa-envelope"></i> Email:</strong> <span id="claveModalUserEmail"></span></p>
                    <div class="clave-box">
                        <strong><i class="fas fa-lock-open"></i> Clave desencriptada:</strong><br>
                        <code id="claveModalUserClave">---</code>
                    </div>
                    <button class="btn-copiar" id="copiarClaveModalBtn">
                        <i class="fas fa-copy"></i> Copiar clave al portapapeles
                    </button>
                    <p style="margin-top: 16px; font-size: 0.7rem; color: #f59e0b; text-align: center;">
                        <i class="fas fa-shield-alt"></i> Esta clave es visible solo para el administrador.
                    </p>
                </div>
            </div>
        `;
        document.body.appendChild(claveModal);
        
        const closeBtn = document.getElementById('closeClaveModalBtn');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                claveModal.classList.remove('active');
            });
        }
        
        claveModal.addEventListener('click', (e) => {
            if (e.target === claveModal) {
                claveModal.classList.remove('active');
            }
        });
        
        const copiarBtn = document.getElementById('copiarClaveModalBtn');
        if (copiarBtn) {
            copiarBtn.addEventListener('click', async () => {
                const claveText = document.getElementById('claveModalUserClave').textContent;
                if (claveText && !claveText.includes('❌') && !claveText.includes('Cargando') && !claveText.includes('No hay')) {
                    await navigator.clipboard.writeText(claveText);
                    showToast('✅ Clave copiada al portapapeles', 'success');
                } else {
                    showToast('No hay clave para copiar', 'warning');
                }
            });
        }
    }
    
    document.getElementById('claveModalUserName').textContent = userName || userEmail;
    document.getElementById('claveModalUserEmail').textContent = userEmail;
    document.getElementById('claveModalUserClave').textContent = 'Cargando...';
    claveModal.classList.add('active');
    
    fetch(`/api/admin/user/${userId}/arca-clave`, { credentials: 'include' })
        .then(res => res.json())
        .then(data => {
            if (data.ok && data.tieneClave) {
                document.getElementById('claveModalUserClave').textContent = data.clave;
                showToast('✅ Clave cargada correctamente', 'success');
            } else {
                document.getElementById('claveModalUserClave').textContent = '❌ No hay clave ARCA registrada para este usuario';
            }
        })
        .catch(err => {
            console.error('Error al obtener clave:', err);
            document.getElementById('claveModalUserClave').textContent = '❌ Error al cargar la clave';
            showToast('Error al cargar la clave', 'error');
        });
}

// ============================================================
//  Actualizar Punto de Venta ARCA
// ============================================================
window.actualizarPtoVenta = async function(userId, ptoVenta) {
    const valor = parseInt(ptoVenta);
    if (isNaN(valor) || valor < 1 || valor > 9999) {
        showToast('El punto de venta debe ser un número entre 1 y 9999', 'warning');
        fetchPendientes();
        return;
    }
    
    try {
        const res = await fetch('/api/admin/actualizar-pto-venta', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, arcaPtoVta: valor })
        });
        
        const data = await res.json();
        
        if (data.ok) {
            showToast(`✅ Punto de venta ${valor} actualizado`, 'success');
            fetchPendientes();
        } else {
            showToast(data.error || 'Error al actualizar punto de venta', 'error');
            fetchPendientes();
        }
    } catch (error) {
        console.error('Error:', error);
        showToast('Error de conexión', 'error');
        fetchPendientes();
    }
};

// ============================================================
//  Cargar Estadísticas
// ============================================================
async function loadStats() {
    try {
        const res = await fetch('/api/admin/stats');
        const data = await res.json();
        if (data.ok) {
            const totalUsersEl = document.getElementById('totalUsers');
            const afipLinkedEl = document.getElementById('afipLinked');
            const pendingUsersEl = document.getElementById('pendingUsers');
            const invoicesTodayEl = document.getElementById('invoicesToday');
            
            if (totalUsersEl) totalUsersEl.textContent = data.totalUsers || 0;
            if (afipLinkedEl) afipLinkedEl.textContent = data.afipLinked || 0;
            if (pendingUsersEl) pendingUsersEl.textContent = data.pendingUsers || 0;
            if (invoicesTodayEl) invoicesTodayEl.textContent = data.invoicesToday || 0;
        }
    } catch (error) {
        console.error('Error loading stats:', error);
    }
}

// ============================================================
//  Cargar Usuarios
// ============================================================
async function fetchPendientes() {
    const tbody = document.getElementById('listaPendientes');
    if (!tbody) return;
    
    tbody.innerHTML = '<tr class="loading-row"><td colspan="8"><i class="fas fa-spinner fa-pulse"></i> Cargando usuarios...<\/td><\/tr>';
    
    try {
        const usersRes = await fetch('/api/admin/users');
        const usersData = await usersRes.json();
        
        if (!usersData.ok || !usersData.users) {
            tbody.innerHTML = '<tr class="error-row"><td colspan="8"><i class="fas fa-exclamation-triangle"></i> Error al cargar usuarios<\/td><\/tr>';
            return;
        }
        
        let integrationsMap = {};
        try {
            const integrationsRes = await fetch('/api/admin/integrations');
            const integrationsData = await integrationsRes.json();
            if (integrationsData.ok && integrationsData.integrations) {
                integrationsData.integrations.forEach(integration => {
                    const userId = integration.userId;
                    if (!integrationsMap[userId]) {
                        integrationsMap[userId] = [];
                    }
                    integrationsMap[userId].push(integration);
                });
            }
        } catch (err) {
            console.warn('Error cargando integraciones:', err);
        }
        
        if (usersData.users.length === 0) {
            tbody.innerHTML = '<tr class="empty-row"><td colspan="8"><i class="fas fa-inbox"></i> No hay usuarios registrados<\/td><\/tr>';
            return;
        }
        
        tbody.innerHTML = usersData.users.map(user => {
            user.integrations = integrationsMap[user._id] || [];
            
            // ✅ Usa arcaStatus desde la base de datos
            const arcaVinculado = user.settings?.arcaStatus === 'vinculado';
            
            const arcaStatusHtml = arcaVinculado 
                ? '<span class="badge-arca ok"><i class="fas fa-check-circle"></i> Vinculado</span>'
                : '<span class="badge-arca pending"><i class="fas fa-clock"></i> Pendiente</span>';
            
            const tiendas = user.integrations || [];
            let tiendasHtml = '';
            if (tiendas.length === 0) {
                tiendasHtml = '<span class="badge-tiendas pending"><i class="fas fa-store"></i> Pendiente</span>';
            } else {
                const tiendasNombres = tiendas.map(t => {
                    switch(t.platform) {
                        case 'woocommerce': return 'WooCommerce';
                        case 'mercadolibre': return 'Mercado Libre';
                        case 'tiendanube': return 'Tienda Nube';
                        default: return t.platform || 'Tienda';
                    }
                }).join(', ');
                tiendasHtml = `<span class="badge-tiendas ok"><i class="fas fa-check-circle"></i> ${tiendasNombres}</span>`;
            }
            
            const facturasEmitidas = user.stats?.totalFacturas || 0;
            const statusCuentaHtml = facturasEmitidas > 0
                ? '<span class="badge-status facturando"><i class="fas fa-file-invoice-dollar"></i> Facturando</span>'
                : '<span class="badge-status pendiente"><i class="fas fa-hourglass-half"></i> Pendiente</span>';
            
            const cuitValue = user.settings?.cuit || '—';
            const tieneClave = user.settings?.arcaClave ? true : false;
            const nombreUsuario = user.nombre || user.email?.split('@')[0] || 'Sin nombre';
            
            const candadoIcon = tieneClave 
                ? '<i class="fas fa-lock" style="color: #00e676;" title="Clave guardada"></i>'
                : '<i class="fas fa-lock-open" style="color: #fbbf24;" title="Sin clave"></i>';
            
            const llaveIcon = tieneClave
                ? `<button class="btn-icon-key" onclick="mostrarClaveArca('${user._id}', '${escapeHtml(user.email)}', '${escapeHtml(nombreUsuario)}')" title="Ver Clave ARCA">
                    <i class="fas fa-key"></i>
                   </button>`
                : '';
            
            const puntoVentaValor = user.settings?.arcaPtoVta || '';
            
            const plan = user.plan || 'free';
            const esAbonado = plan === 'pro' || plan === 'paid' || plan === 'premium';
            const planHtml = esAbonado 
                ? '<span class="plan-badge pro"><i class="fas fa-crown"></i> Abonado</span>'
                : '<span class="plan-badge free"><i class="fas fa-leaf"></i> Free</span>';
            
            // ✅ Botones de acción (solo cambian el estado)
            const botonesAccion = arcaVinculado
                ? `<button class="btn-desvincular" type="button" onclick="desvincularArca('${user._id}')">
                    <i class="fas fa-unlink"></i> Desvincular
                   </button>`
                : `<button class="btn-vincular" type="button" onclick="vincularArca('${user._id}')">
                    <i class="fas fa-link"></i> Vincular
                   </button>`;
            
            return `
                <tr data-user-id="${user._id}">
                    <td style="vertical-align: middle;">
                        <div class="user-cell">
                            <span class="user-name">${escapeHtml(nombreUsuario)}</span>
                            <span class="user-email">${escapeHtml(user.email || '—')}</span>
                        </div>
                    </td>
                    
                    <td style="vertical-align: middle;">
                        <div class="cuit-info">
                            <code class="cuit-code">${cuitValue}</code>
                            <div class="clave-info">
                                ${candadoIcon}
                                <span class="text-muted">${tieneClave ? 'Clave guardada' : 'Sin clave'}</span>
                                ${llaveIcon}
                            </div>
                        </div>
                    </td>
                    
                    <td class="text-center" style="vertical-align: middle;">${arcaStatusHtml}</td>
                    <td style="vertical-align: middle;">${tiendasHtml}</td>
                    <td style="vertical-align: middle;">${statusCuentaHtml}</td>
                    
                    <td class="text-center" style="vertical-align: middle;">
                        <input type="number" class="pto-input" value="${puntoVentaValor}" 
                               onchange="actualizarPtoVenta('${user._id}', this.value)"
                               style="width: 80px; text-align: center;">
                    </td>
                    
                    <td style="vertical-align: middle;">${planHtml}</td>
                    
                    <!-- ===== ACCIONES CON BOTÓN DE NOTIFICACIÓN ===== -->
                    <td class="text-right" style="vertical-align: middle;">
                        <div class="action-buttons" style="display: flex; gap: 6px; justify-content: flex-end; flex-wrap: wrap;">
                            ${botonesAccion}
                            <button class="btn-ver-detalle" type="button" onclick="verDetalleUsuario('${user._id}')" title="Ver detalle">
                                <i class="fas fa-eye"></i>
                            </button>
                            <button class="btn-notificar" type="button" onclick="abrirModalNotificacion('${user._id}', '${escapeHtml(user.nombre || user.email)}')" title="Enviar notificación">
                                <i class="fas fa-bell"></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
        
    } catch (error) {
        console.error('Error:', error);
        tbody.innerHTML = '<tr class="error-row"><td colspan="8"><i class="fas fa-exclamation-triangle"></i> Error de conexión<\/td><\/tr>';
    }
}

// ============================================================
//  Ver Detalle de Usuario
// ============================================================
window.verDetalleUsuario = async function(userId) {
    try {
        const res = await fetch(`/api/admin/users/${userId}`);
        const data = await res.json();
        
        if (!data.ok || !data.user) {
            showToast('Error al obtener datos del usuario', 'error');
            return;
        }
        
        const user = data.user;
        
        let tiendasLista = 'Ninguna';
        try {
            const integrationsRes = await fetch('/api/admin/integrations');
            const integrationsData = await integrationsRes.json();
            if (integrationsData.ok && integrationsData.integrations) {
                const userIntegrations = integrationsData.integrations.filter(i => i.userId === userId);
                if (userIntegrations.length > 0) {
                    tiendasLista = userIntegrations.map(t => t.platform).join(', ');
                }
            }
        } catch(e) {}
        
        const totalFacturas = user.stats?.totalFacturas || 0;
        const totalMonto = user.stats?.totalMonto || 0;
        const arcaStatus = user.settings?.arcaStatus === 'vinculado' ? 'Vinculado' : 'Pendiente';
        
        alert(`
📋 DETALLE DE USUARIO
━━━━━━━━━━━━━━━━━━━━━━━━━━
👤 Nombre: ${user.nombre || '—'}
📧 Email: ${user.email || '—'}
🏢 CUIT: ${user.settings?.cuit || '—'}
🔐 Clave ARCA: ${user.settings?.arcaClave ? '✓ Guardada' : '✗ No registrada'}
🔗 Estado ARCA: ${arcaStatus}
📌 Punto Venta: ${user.settings?.arcaPtoVta || '1'}
🛒 Tiendas: ${tiendasLista}
💰 Facturas emitidas: ${totalFacturas}
💵 Monto total: $${totalMonto.toLocaleString()}
📅 Registro: ${new Date(user.createdAt).toLocaleDateString()}
        `);
    } catch (error) {
        showToast('Error al obtener detalle', 'error');
    }
};

// ============================================================
//  Vincular ARCA (solo cambia el estado - NO pide datos)
// ============================================================
window.vincularArca = async function(userId) {
    try {
        // Obtener datos del usuario para mostrar información
        const usersRes = await fetch('/api/admin/users', { credentials: 'include' });
        const usersData = await usersRes.json();
        const user = usersData.users.find(u => u._id === userId);
        
        if (!user) {
            showToast('Error: No se encontraron datos del usuario', 'error');
            return;
        }
        
        const cuitActual = user.settings?.cuit || 'No configurado';
        const tieneClave = user.settings?.arcaClave ? '✓ Sí' : '✗ No';
        
        // Confirmar vinculación
        const confirmar = confirm(`⚠️ ¿Vincular ARCA para ${user.email}?\n\n📋 CUIT: ${cuitActual}\n🔐 Clave Fiscal: ${tieneClave}\n\nEl usuario ya debe haber completado sus datos de ARCA.`);
        
        if (!confirmar) return;
        
        showToast('Vinculando ARCA...', 'info');
        
        const res = await fetch('/api/admin/vincular-arca', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId })
        });
        
        const data = await res.json();
        
        if (data.ok) {
            showToast('✅ ARCA vinculado correctamente', 'success');
            fetchPendientes();
            loadStats();
        } else {
            showToast(data.error || 'Error al vincular ARCA', 'error');
        }
    } catch (error) {
        console.error('Error:', error);
        showToast('Error de conexión', 'error');
    }
};

// ============================================================
//  Desvincular ARCA (solo cambia el estado)
// ============================================================
window.desvincularArca = async function(userId) {
    if (!confirm('⚠️ ¿Desvincular ARCA de este usuario?\n\nEl usuario mantendrá su CUIT y Clave Fiscal guardados, pero se desactivará la vinculación.')) return;
    
    try {
        const res = await fetch('/api/admin/desvincular-arca', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId })
        });
        
        const data = await res.json();
        
        if (data.ok) {
            showToast('✅ ARCA desvinculado correctamente', 'success');
            fetchPendientes();
            loadStats();
        } else {
            showToast(data.error || 'Error al desvincular ARCA', 'error');
        }
    } catch (error) {
        console.error('Error:', error);
        showToast('Error de conexión', 'error');
    }
};

// ============================================================
//  Cargar Logs
// ============================================================
async function loadLogs() {
    const tbody = document.getElementById('logsList');
    if (!tbody) return;
    
    tbody.innerHTML = '<tr class="loading-row"><td colspan="4"><i class="fas fa-spinner fa-pulse"></i> Cargando logs...<\/td><\/tr>';
    
    try {
        const res = await fetch('/api/admin/logs');
        const data = await res.json();
        
        if (!data.ok || !data.logs) {
            tbody.innerHTML = '<tr class="error-row"><td colspan="4"><i class="fas fa-exclamation-triangle"></i> Error al cargar logs<\/td><\/tr>';
            return;
        }
        
        if (data.logs.length === 0) {
            tbody.innerHTML = '<tr class="empty-row"><td colspan="4"><i class="fas fa-inbox"></i> No hay logs registrados<\/td><\/tr>';
            return;
        }
        
        tbody.innerHTML = data.logs.map(log => `
            <tr>
                <td style="white-space: nowrap;">${formatDate(log.createdAt)}</td>
                <td>${escapeHtml(log.userEmail || 'Sistema')}</td>
                <td>${escapeHtml(log.action)}</td>
                <td>${escapeHtml(log.detail || '')}</td>
            </tr>
        `).join('');
    } catch (error) {
        console.error('Error:', error);
        tbody.innerHTML = '<tr class="error-row"><td colspan="4"><i class="fas fa-exclamation-triangle"></i> Error de conexión<\/td><\/tr>';
    }
}

// ============================================================
//  Exportar CSV
// ============================================================
function exportarCSV() {
    showToast('Generando archivo CSV...', 'info');
    fetch('/api/admin/export-csv')
        .then(res => res.blob())
        .then(blob => {
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `usuarios_${new Date().toISOString().slice(0, 19)}.csv`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);
            showToast('Exportación completada', 'success');
        })
        .catch(() => showToast('Error al exportar', 'error'));
}

// ============================================================
//  Health Check
// ============================================================
function openHealthModal() {
    if (healthModal) healthModal.classList.add('active');
    checkHealth();
}

function closeHealthModal() {
    if (healthModal) healthModal.classList.remove('active');
}

async function checkHealth() {
    try {
        const res = await fetch('/api/admin/health');
        const data = await res.json();
        
        const dbEl = document.getElementById('dbStatus');
        const afipEl = document.getElementById('afipStatus');
        const emailEl = document.getElementById('emailStatus');
        const apiEl = document.getElementById('apiStatus');
        const memEl = document.getElementById('memoryStatus');
        const uptimeEl = document.getElementById('uptimeStatus');
        
        if (dbEl) {
            dbEl.textContent = data.db ? '🟢 Online' : '🔴 Offline';
            dbEl.className = `health-badge ${data.db ? 'ok' : 'error'}`;
        }
        
        if (afipEl) {
            afipEl.textContent = data.afip ? '🟢 Conectado' : '⚠️ No disponible';
            afipEl.className = `health-badge ${data.afip ? 'ok' : 'warning'}`;
        }
        
        if (emailEl) {
            emailEl.textContent = data.email ? '🟢 Activo' : '⚠️ No disponible';
            emailEl.className = `health-badge ${data.email ? 'ok' : 'warning'}`;
        }
        
        if (apiEl) {
            apiEl.textContent = data.api ? '🟢 Activa' : '🔴 Inactiva';
            apiEl.className = `health-badge ${data.api ? 'ok' : 'error'}`;
        }
        
        if (memEl) {
            const memPercent = data.memoryUsage || 0;
            memEl.textContent = memPercent < 70 ? `🟢 ${memPercent}% usado` : memPercent < 90 ? `🟡 ${memPercent}% usado` : `🔴 ${memPercent}% usado`;
            memEl.className = `health-badge ${memPercent < 70 ? 'ok' : memPercent < 90 ? 'warning' : 'error'}`;
        }
        
        if (uptimeEl) {
            const uptime = data.uptime || 0;
            const hours = Math.floor(uptime / 3600);
            const minutes = Math.floor((uptime % 3600) / 60);
            uptimeEl.textContent = `${hours}h ${minutes}m`;
            uptimeEl.className = 'health-badge ok';
        }
        
    } catch (error) {
        console.error('Health check error:', error);
        showToast('Error al obtener estado del sistema', 'error');
    }
}

// ============================================================
//  Configuración
// ============================================================
function toggleMaintenance() {
    fetch('/api/admin/toggle-maintenance', { method: 'POST' })
        .then(res => res.json())
        .then(data => {
            showToast(data.message || 'Modo mantenimiento cambiado', 'info');
        })
        .catch(() => showToast('Error', 'error'));
}

function clearCache() {
    fetch('/api/admin/clear-cache', { method: 'POST' })
        .then(res => res.json())
        .then(data => {
            showToast(data.message || 'Caché limpiado', 'success');
        })
        .catch(() => showToast('Error', 'error'));
}

// ============================================================
//  Cerrar Sesión
// ============================================================
function cerrarSesion() {
    fetch('/auth/logout').then(() => {
        window.location.href = '/login';
    });
}

// ============================================================
//  Switch de Tabs
// ============================================================
function switchTab(tabId) {
    document.querySelectorAll('.nav-item').forEach(item => {
        if (item.getAttribute('data-tab') === tabId) {
            item.classList.add('active');
        } else {
            item.classList.remove('active');
        }
    });
    
    document.querySelectorAll('.tab-btn').forEach(btn => {
        if (btn.getAttribute('data-tab') === tabId) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
    
    document.querySelectorAll('.tab-pane').forEach(pane => {
        if (pane.id === `tab-${tabId}`) {
            pane.classList.add('active');
        } else {
            pane.classList.remove('active');
        }
    });
    
    if (tabId === 'usuarios') {
        fetchPendientes();
    } else if (tabId === 'logs') {
        loadLogs();
    }
}

// ============================================================
//  Event Listeners
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    loadStats();
    fetchPendientes();
    
    document.querySelectorAll('.nav-item[data-tab]').forEach(item => {
        item.addEventListener('click', () => {
            const tab = item.getAttribute('data-tab');
            switchTab(tab);
        });
    });
    
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.getAttribute('data-tab');
            switchTab(tab);
        });
    });
    
    if (refreshBtn) refreshBtn.addEventListener('click', () => fetchPendientes());
    if (exportBtn) exportBtn.addEventListener('click', () => exportarCSV());
    if (healthBtn) healthBtn.addEventListener('click', () => openHealthModal());
    if (logoutBtn) logoutBtn.addEventListener('click', () => cerrarSesion());
    if (maintenanceBtn) maintenanceBtn.addEventListener('click', () => toggleMaintenance());
    if (clearCacheBtn) clearCacheBtn.addEventListener('click', () => clearCache());
    if (closeHealthModalBtn) closeHealthModalBtn.addEventListener('click', () => closeHealthModal());
    
    if (healthModal) {
        healthModal.addEventListener('click', (e) => {
            if (e.target === healthModal) closeHealthModal();
        });
    }
});

window.toggleSidebar = function() {
    if (sidebar) sidebar.classList.toggle('mobile-open');
};

// ✅ Actualización cada 20 minutos (1200000 ms)
setInterval(() => {
    const usuariosTab = document.getElementById('tab-usuarios');
    if (usuariosTab && usuariosTab.classList.contains('active')) {
        fetchPendientes();
    }
    loadStats();
}, 1200000);
// ============================================================
//  NOTIFICACIONES - ADMIN
// ============================================================

let userIdNotificacion = null;

// Abrir modal para enviar notificación a un usuario
function abrirModalNotificacion(userId, userName) {
    userIdNotificacion = userId;
    
    // Crear el modal si no existe
    let modal = document.getElementById('modalNotificacion');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'modalNotificacion';
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h2><i class="fas fa-bell" style="color: #f5a623;"></i> Enviar notificación</h2>
                    <button class="modal-close" id="closeNotifModalBtn">&times;</button>
                </div>
                <div class="modal-body">
                    <div style="margin-bottom: 16px;">
                        <p style="font-size: 13px; color: #8888aa;">
                            <strong id="notifUserName">Usuario</strong>
                        </p>
                    </div>
                    <div class="cfg-field" style="margin-bottom: 16px;">
                        <label class="cfg-label" style="font-size: 11px; font-weight: 700; color: #44445a; text-transform: uppercase; letter-spacing: 1.5px; display: block; margin-bottom: 6px;">Tipo de notificación</label>
                        <select id="notifTipo" class="cfg-input" style="width: 100%; padding: 10px 14px; background: #17172a; border: 1px solid rgba(255,255,255,0.055); border-radius: 8px; color: #f0f0fa; font-size: 13px;">
                            <option value="info">ℹ️ Informativa</option>
                            <option value="success">✅ Éxito</option>
                            <option value="warning">⚠️ Advertencia</option>
                            <option value="update">🔄 Actualización</option>
                            <option value="promo">🎁 Promoción</option>
                        </select>
                    </div>
                    <div class="cfg-field">
                        <label class="cfg-label" style="font-size: 11px; font-weight: 700; color: #44445a; text-transform: uppercase; letter-spacing: 1.5px; display: block; margin-bottom: 6px;">Mensaje</label>
                        <textarea id="notifMensaje" class="cfg-input" rows="4" placeholder="Escribe el mensaje que quieres enviar al usuario..." style="width: 100%; padding: 10px 14px; background: #17172a; border: 1px solid rgba(255,255,255,0.055); border-radius: 8px; color: #f0f0fa; font-size: 13px; resize: vertical; min-height: 100px; font-family: 'Inter', sans-serif;"></textarea>
                    </div>
                    <div id="notifError" style="display:none; color: #ff3d57; font-size: 12px; margin-top: 8px; padding: 8px 12px; background: rgba(255,61,87,0.08); border-radius: 6px;"></div>
                </div>
                <div class="modal-footer" style="display: flex; justify-content: flex-end; gap: 12px; padding: 16px 24px; border-top: 1px solid rgba(255,255,255,0.055);">
                    <button class="btn-cancel" onclick="cerrarModalNotificacion()" style="padding: 9px 18px; border-radius: 8px; background: transparent; border: 1px solid rgba(255,255,255,0.055); color: #8888aa; cursor: pointer; font-size: 13px; font-weight: 600;">Cancelar</button>
                    <button class="btn-registrar" id="btnEnviarNotif" onclick="enviarNotificacionAdmin()" style="padding: 9px 20px; border-radius: 8px; background: linear-gradient(135deg, #e8622a, #f5a623); border: none; color: white; font-weight: 700; cursor: pointer; font-size: 13px; display: inline-flex; align-items: center; gap: 8px; transition: all 0.2s ease;">
                        <i class="fas fa-paper-plane"></i>
                        Enviar notificación
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        
        // Cerrar al hacer clic fuera
        modal.addEventListener('click', function(e) {
            if (e.target === modal) {
                cerrarModalNotificacion();
            }
        });
        
        // Cerrar con la X
        const closeBtn = document.getElementById('closeNotifModalBtn');
        if (closeBtn) {
            closeBtn.addEventListener('click', cerrarModalNotificacion);
        }
    }
    
    // Actualizar datos
    document.getElementById('notifUserName').textContent = `Enviando a: ${userName}`;
    document.getElementById('notifMensaje').value = '';
    document.getElementById('notifError').style.display = 'none';
    
    modal.classList.add('active');
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    
    setTimeout(() => {
        document.getElementById('notifMensaje').focus();
    }, 200);
}

// Cerrar modal de notificación
function cerrarModalNotificacion() {
    const modal = document.getElementById('modalNotificacion');
    if (modal) {
        modal.classList.remove('active');
        modal.style.display = 'none';
        document.body.style.overflow = '';
    }
    userIdNotificacion = null;
}

// Enviar notificación desde el admin
async function enviarNotificacionAdmin() {
    const mensaje = document.getElementById('notifMensaje').value.trim();
    const tipo = document.getElementById('notifTipo').value;
    const errorDiv = document.getElementById('notifError');
    const btn = document.getElementById('btnEnviarNotif');
    
    // Validar
    if (!mensaje) {
        errorDiv.textContent = 'Escribí un mensaje para enviar.';
        errorDiv.style.display = 'block';
        document.getElementById('notifMensaje').focus();
        return;
    }
    
    if (mensaje.length < 5) {
        errorDiv.textContent = 'El mensaje debe tener al menos 5 caracteres.';
        errorDiv.style.display = 'block';
        return;
    }
    
    if (!userIdNotificacion) {
        errorDiv.textContent = 'Error: No se identificó al usuario.';
        errorDiv.style.display = 'block';
        return;
    }
    
    // Deshabilitar botón
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-pulse"></i> Enviando...';
    errorDiv.style.display = 'none';
    
    try {
        const response = await fetch('/api/admin/notifications/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ 
                userId: userIdNotificacion, 
                mensaje, 
                tipo 
            })
        });
        
        const data = await response.json();
        
        if (data.ok) {
            showToast(`✅ Notificación enviada correctamente`, 'success');
            cerrarModalNotificacion();
            // Recargar la tabla para actualizar
            fetchPendientes();
        } else {
            errorDiv.textContent = data.error || 'Error al enviar la notificación';
            errorDiv.style.display = 'block';
        }
    } catch (error) {
        console.error('Error:', error);
        errorDiv.textContent = 'Error de conexión. Intentá de nuevo.';
        errorDiv.style.display = 'block';
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-paper-plane"></i> Enviar notificación';
    }
}
