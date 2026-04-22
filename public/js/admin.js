/**
 * KOI Admin Panel - JavaScript
 * Funcionalidades: stats, usuarios, logs, health check, export CSV
 * Versión: 2.0 - Estados Activo/Intermedio/Inactivo
 */

// ============================================================
//  DOM Elements
// ============================================================
const sidebar = document.getElementById('sidebar');
const navItems = document.querySelectorAll('.nav-item');
const tabBtns = document.querySelectorAll('.tab-btn');
const tabPanes = document.querySelectorAll('.tab-pane');
const refreshBtn = document.getElementById('refreshBtn');
const exportBtn = document.getElementById('exportBtn');
const healthBtn = document.getElementById('healthBtn');
const logoutBtn = document.getElementById('logoutBtn');
const maintenanceBtn = document.getElementById('maintenanceBtn');
const clearCacheBtn = document.getElementById('clearCacheBtn');
const healthModal = document.getElementById('healthModal');
const closeHealthModalBtn = document.getElementById('closeHealthModalBtn');

// ============================================================
//  Toast Notifications
// ============================================================
function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    const icon = type === 'success' ? 'fa-check-circle' : 
                 type === 'error' ? 'fa-exclamation-circle' : 
                 type === 'warning' ? 'fa-exclamation-triangle' : 'fa-info-circle';
    toast.innerHTML = `<i class="fas ${icon}"></i> ${message}`;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 2500);
}

// ============================================================
//  Función para determinar el estado del usuario
// ============================================================
//  Activo (🟢 Verde): Tienda conectada Y ARCA vinculado
//  Intermedio (🟡 Amarillo): Tienda conectada O ARCA vinculado (solo uno)
//  Inactivo (🔴 Rojo): Sin tienda Y sin ARCA
// ============================================================
function getEstadoUsuario(user) {
    const tiendaConectada = user.integrations && user.integrations.length > 0;
    const arcaVinculado = user.settings?.cuit && user.settings?.cuit.trim() !== '';
    
    let estado = 'inactivo';
    let estadoTexto = 'Inactivo';
    let estadoColor = 'error';
    let detalles = [];
    let tiendasList = [];
    
    if (tiendaConectada && arcaVinculado) {
        estado = 'activo';
        estadoTexto = 'Activo';
        estadoColor = 'active';
    } else if (tiendaConectada || arcaVinculado) {
        estado = 'intermedio';
        estadoTexto = 'Intermedio';
        estadoColor = 'pending';
    } else {
        estado = 'inactivo';
        estadoTexto = 'Inactivo';
        estadoColor = 'error';
    }
    
    // Detalles de conexiones
    if (tiendaConectada) {
        user.integrations.forEach(integration => {
            let nombre = integration.platform;
            switch(integration.platform) {
                case 'woocommerce': nombre = 'WooCommerce'; break;
                case 'mercadolibre': nombre = 'Mercado Libre'; break;
                case 'tiendanube': nombre = 'Tienda Nube'; break;
                case 'empretienda': nombre = 'Empretienda'; break;
                case 'rappi': nombre = 'Rappi'; break;
                case 'vtex': nombre = 'VTEX'; break;
                case 'shopify': nombre = 'Shopify'; break;
                default: nombre = integration.platform;
            }
            tiendasList.push(nombre);
        });
        detalles.push(`🛒 ${tiendasList.join(', ')}`);
    }
    
    if (arcaVinculado) {
        detalles.push(`🏛️ ARCA: ${user.settings.cuit}`);
    }
    
    if (!tiendaConectada && !arcaVinculado) {
        detalles.push('⚙️ Configuración pendiente');
    }
    
    const icono = estado === 'activo' ? 'fa-check-circle' :
                  estado === 'intermedio' ? 'fa-exclamation-triangle' : 'fa-times-circle';
    
    const iconoColor = estado === 'activo' ? '#00E676' :
                       estado === 'intermedio' ? '#FBBF24' : '#EF4444';
    
    return { estado, estadoTexto, estadoColor, detalles: detalles.join(' • '), icono, iconoColor };
}

// ============================================================
//  Cargar Estadísticas
// ============================================================
async function loadStats() {
    try {
        const res = await fetch('/api/admin/stats');
        const data = await res.json();
        if (data.ok) {
            document.getElementById('totalUsers').textContent = data.totalUsers || 0;
            document.getElementById('afipLinked').textContent = data.afipLinked || 0;
            document.getElementById('pendingUsers').textContent = data.pendingUsers || 0;
            document.getElementById('invoicesToday').textContent = data.invoicesToday || 0;
        }
    } catch (error) {
        console.error('Error loading stats:', error);
        showToast('Error al cargar estadísticas', 'error');
    }
}

// ============================================================
//  Cargar Usuarios (versión mejorada con estados)
// ============================================================
async function fetchPendientes() {
    const tbody = document.getElementById('listaPendientes');
    tbody.innerHTML = '<tr class="loading-row"><td colspan="7"><i class="fas fa-spinner fa-pulse"></i> Cargando usuarios...<\/td><\/tr>';
    
    try {
        // Obtener usuarios y sus integraciones
        const [usersRes, integrationsRes] = await Promise.all([
            fetch('/api/admin/users'),
            fetch('/api/admin/integrations')
        ]);
        
        const usersData = await usersRes.json();
        const integrationsData = await integrationsRes.json();
        
        if (!usersData.ok || !usersData.users) {
            tbody.innerHTML = '<tr class="error-row"><td colspan="7"><i class="fas fa-exclamation-triangle"></i> Error al cargar usuarios<\/td><\/tr>';
            return;
        }
        
        // Mapear integraciones por usuario
        const integrationsByUser = {};
        if (integrationsData.ok && integrationsData.integrations) {
            integrationsData.integrations.forEach(integration => {
                const userId = integration.userId;
                if (!integrationsByUser[userId]) {
                    integrationsByUser[userId] = [];
                }
                integrationsByUser[userId].push(integration);
            });
        }
        
        if (usersData.users.length === 0) {
            tbody.innerHTML = '<tr class="empty-row"><td colspan="7"><i class="fas fa-inbox"></i> No hay usuarios registrados<\/td><\/tr>';
            return;
        }
        
        tbody.innerHTML = usersData.users.map(user => {
            user.integrations = integrationsByUser[user._id] || [];
            const estado = getEstadoUsuario(user);
            
            return `
            <tr>
                <td>
                    <div class="client-name">${escapeHtml(user.nombre || 'Sin nombre')} ${escapeHtml(user.apellido || '')}</div>
                    <div class="client-email">${escapeHtml(user.email)}</div>
                </td>
                <td>
                    <div class="fiscal-data">
                        <span class="fiscal-code">${user.settings?.cuit || 'No configurado'}</span>
                        ${user.settings?.cuit ? `<button class="copy-icon" onclick="copyToClipboard('${user.settings?.cuit}')"><i class="fas fa-copy"></i></button>` : ''}
                    </div>
                    <div style="font-size: 0.7rem; color: #4B5563; margin-top: 4px;">
                        ${user.settings?.arcaClave ? '<i class="fas fa-lock"></i> Clave ARCA configurada' : '<i class="fas fa-lock-open"></i> Sin clave ARCA'}
                    </div>
                 </td>
                <td class="text-center">
                    <input type="number" class="pto-input" value="${user.settings?.puntoVenta || 1}" 
                           onchange="actualizarPtoVenta('${user._id}', this.value)">
                 </td>
                <td>
                    <div class="status-badge">
                        <i class="fas ${estado.icono}" style="color: ${estado.iconoColor}; margin-right: 6px;"></i>
                        <span class="status-text ${estado.estadoColor}">
                            ${estado.estadoTexto}
                        </span>
                    </div>
                    <div style="font-size: 0.7rem; color: #6B7280; margin-top: 4px;">
                        ${estado.detalles}
                    </div>
                 </td>
                <td>
                    <span class="status-text ${user.plan === 'pro' ? 'active' : 'inactive'}">
                        ${user.plan === 'pro' ? '<i class="fas fa-star"></i> Pro' : '<i class="fas fa-user"></i> Free'}
                    </span>
                 </td>
                <td class="text-right">
                    <div class="action-group">
                        <button class="action-btn action-btn-success" onclick="forzarSync('${user._id}')" title="Forzar sincronización con ARCA">
                            <i class="fas fa-sync-alt"></i> Sync
                        </button>
                        <button class="action-btn action-btn-error" onclick="desvincular('${user._id}')" title="Resetear configuración del usuario">
                            <i class="fas fa-unlink"></i> Reset
                        </button>
                    </div>
                 </td>
             </tr>
            `;
        }).join('');
        
    } catch (error) {
        console.error('Error:', error);
        tbody.innerHTML = '<tr class="error-row"><td colspan="7"><i class="fas fa-exclamation-triangle"></i> Error de conexión<\/td><\/tr>';
    }
}

// ============================================================
//  Cargar Logs
// ============================================================
async function loadLogs() {
    const tbody = document.getElementById('logsList');
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
                <td style="white-space: nowrap;">${new Date(log.createdAt).toLocaleString()}<\/td>
                <td>${escapeHtml(log.userEmail || 'Sistema')}<\/td>
                <td>${escapeHtml(log.action)}<\/td>
                <td>${escapeHtml(log.detail || '')}<\/td>
             </tr>
        `).join('');
    } catch (error) {
        console.error('Error:', error);
        tbody.innerHTML = '<tr class="error-row"><td colspan="4"><i class="fas fa-exclamation-triangle"></i> Error de conexión<\/td><\/tr>';
    }
}

// ============================================================
//  Acciones de Usuario
// ============================================================

// Actualizar punto de venta
window.actualizarPtoVenta = async function(userId, ptoVenta) {
    try {
        const res = await fetch('/api/admin/actualizar-pto', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, puntoVenta: parseInt(ptoVenta) })
        });
        const data = await res.json();
        if (data.ok) {
            showToast('Punto de venta actualizado', 'success');
        } else {
            showToast(data.error || 'Error al actualizar', 'error');
        }
    } catch (error) {
        showToast('Error de conexión', 'error');
    }
};

// Forzar sincronización
window.forzarSync = async function(userId) {
    showToast('Iniciando sincronización forzada...', 'info');
    try {
        const res = await fetch('/api/admin/forzar-sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId })
        });
        const data = await res.json();
        if (data.ok) {
            showToast('Sincronización forzada iniciada', 'success');
            setTimeout(() => fetchPendientes(), 2000);
        } else {
            showToast(data.error || 'Error al sincronizar', 'error');
        }
    } catch (error) {
        showToast('Error de conexión', 'error');
    }
};

// Desvincular usuario
window.desvincular = async function(userId) {
    if (!confirm('⚠️ ¿Estás seguro de que querés desvincular este usuario de AFIP?\n\nEsto eliminará su configuración fiscal y deberá volver a configurarla.')) return;
    
    try {
        const res = await fetch('/api/admin/desvincular', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId })
        });
        const data = await res.json();
        if (data.ok) {
            showToast('Usuario desvinculado correctamente', 'success');
            fetchPendientes();
        } else {
            showToast(data.error || 'Error al desvincular', 'error');
        }
    } catch (error) {
        showToast('Error de conexión', 'error');
    }
};

// Copiar al portapapeles
window.copyToClipboard = function(text) {
    if (!text || text === 'No configurado') {
        showToast('No hay CUIT para copiar', 'warning');
        return;
    }
    navigator.clipboard.writeText(text);
    showToast('CUIT copiado al portapapeles', 'success');
};

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
    healthModal.classList.add('active');
    checkHealth();
}

function closeHealthModal() {
    healthModal.classList.remove('active');
}

async function checkHealth() {
    try {
        const res = await fetch('/api/admin/health');
        const data = await res.json();
        
        const dbEl = document.getElementById('dbStatus');
        dbEl.textContent = data.db ? '🟢 Online' : '🔴 Offline';
        dbEl.className = `health-badge ${data.db ? 'up' : 'down'}`;
        
        const afipEl = document.getElementById('afipStatus');
        afipEl.textContent = data.afip ? '🟢 Conectado' : '⚠️ No disponible';
        afipEl.className = `health-badge ${data.afip ? 'up' : 'warning'}`;
        
        const emailEl = document.getElementById('emailStatus');
        emailEl.textContent = data.email ? '🟢 Activo' : '⚠️ No disponible';
        emailEl.className = `health-badge ${data.email ? 'up' : 'warning'}`;
        
        const apiEl = document.getElementById('apiStatus');
        apiEl.textContent = data.api ? '🟢 Activa' : '🔴 Inactiva';
        apiEl.className = `health-badge ${data.api ? 'up' : 'down'}`;
        
        const memEl = document.getElementById('memoryStatus');
        const memPercent = data.memoryUsage || 0;
        memEl.textContent = memPercent < 70 ? `🟢 ${memPercent}% usado` : memPercent < 90 ? `🟡 ${memPercent}% usado` : `🔴 ${memPercent}% usado`;
        memEl.className = `health-badge ${memPercent < 70 ? 'up' : memPercent < 90 ? 'warning' : 'down'}`;
        
        const uptimeEl = document.getElementById('uptimeStatus');
        const uptime = data.uptime || 0;
        const hours = Math.floor(uptime / 3600);
        const minutes = Math.floor((uptime % 3600) / 60);
        uptimeEl.textContent = `${hours}h ${minutes}m`;
        uptimeEl.className = 'health-badge up';
        
    } catch (error) {
        console.error('Health check error:', error);
        showToast('Error al obtener estado del sistema', 'error');
    }
}

// ============================================================
//  Funciones de Utilidad
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

// ============================================================
//  Switch de Tabs
// ============================================================
function switchTab(tabId) {
    // Actualizar nav items
    document.querySelectorAll('.nav-item').forEach(item => {
        if (item.getAttribute('data-tab') === tabId) {
            item.classList.add('active');
        } else {
            item.classList.remove('active');
        }
    });
    
    // Actualizar tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
        if (btn.getAttribute('data-tab') === tabId) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
    
    // Actualizar panes
    document.querySelectorAll('.tab-pane').forEach(pane => {
        if (pane.id === `tab-${tabId}`) {
            pane.classList.add('active');
        } else {
            pane.classList.remove('active');
        }
    });
    
    // Cargar datos según el tab
    if (tabId === 'usuarios') {
        fetchPendientes();
    } else if (tabId === 'logs') {
        loadLogs();
    }
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
//  Event Listeners
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    // Cargar datos iniciales
    loadStats();
    fetchPendientes();
    
    // Navegación sidebar
    document.querySelectorAll('.nav-item[data-tab]').forEach(item => {
        item.addEventListener('click', () => {
            const tab = item.getAttribute('data-tab');
            switchTab(tab);
        });
    });
    
    // Tabs
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.getAttribute('data-tab');
            switchTab(tab);
        });
    });
    
    // Botones
    if (refreshBtn) refreshBtn.addEventListener('click', () => fetchPendientes());
    if (exportBtn) exportBtn.addEventListener('click', () => exportarCSV());
    if (healthBtn) healthBtn.addEventListener('click', () => openHealthModal());
    if (logoutBtn) logoutBtn.addEventListener('click', () => cerrarSesion());
    if (maintenanceBtn) maintenanceBtn.addEventListener('click', () => toggleMaintenance());
    if (clearCacheBtn) clearCacheBtn.addEventListener('click', () => clearCache());
    if (closeHealthModalBtn) closeHealthModalBtn.addEventListener('click', () => closeHealthModal());
    
    // Cerrar modal al hacer clic fuera
    healthModal.addEventListener('click', (e) => {
        if (e.target === healthModal) closeHealthModal();
    });
});

// Sidebar mobile toggle (opcional)
window.toggleSidebar = function() {
    sidebar.classList.toggle('mobile-open');
};

// ============================================================
//  Refrescar datos periódicamente (cada 30 segundos)
// ============================================================
setInterval(() => {
    if (document.getElementById('tab-usuarios').classList.contains('active')) {
        fetchPendientes();
    }
    loadStats();
}, 30000);
