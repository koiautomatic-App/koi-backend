/**
 * KOI Admin Panel - JavaScript
 * Funcionalidades: stats, usuarios, logs, health check, export CSV
 */

// DOM Elements
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

// Toast notifications
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

// Cargar estadísticas
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

// Cargar usuarios
async function fetchPendientes() {
    const tbody = document.getElementById('listaPendientes');
    tbody.innerHTML = '<tr class="loading-row"><td colspan="6"><i class="fas fa-spinner fa-pulse"></i> Cargando usuarios...<\/td><\/tr>';
    
    try {
        const res = await fetch('/api/admin/users');
        const data = await res.json();
        
        if (!data.ok || !data.users) {
            tbody.innerHTML = '<tr class="error-row"><td colspan="6"><i class="fas fa-exclamation-triangle"></i> Error al cargar usuarios<\/td><\/tr>';
            return;
        }
        
        if (data.users.length === 0) {
            tbody.innerHTML = '<tr class="empty-row"><td colspan="6"><i class="fas fa-inbox"></i> No hay usuarios registrados<\/td><\/tr>';
            return;
        }
        
        tbody.innerHTML = data.users.map(user => `
            <tr>
                <td>
                    <div class="client-name">${escapeHtml(user.nombre || 'Sin nombre')} ${escapeHtml(user.apellido || '')}</div>
                    <div class="client-email">${escapeHtml(user.email)}</div>
                </td>
                <td>
                    <div class="fiscal-data">
                        <span class="fiscal-code">${user.settings?.cuit || 'No configurado'}</span>
                        <button class="copy-icon" onclick="copyToClipboard('${user.settings?.cuit || ''}')"><i class="fas fa-copy"></i></button>
                    </div>
                    <div style="font-size: 0.7rem; color: #4B5563; margin-top: 4px;">
                        ${user.settings?.arcaClave ? '<i class="fas fa-lock"></i> Clave configurada' : '<i class="fas fa-lock-open"></i> Sin clave ARCA'}
                    </div>
                </td>
                <td class="text-center">
                    <input type="number" class="pto-input" value="${user.settings?.puntoVenta || 1}" 
                           onchange="actualizarPtoVenta('${user._id}', this.value)">
                </td>
                <td>
                    <div class="status-badge">
                        <span class="status-dot ${user.settings?.cuit ? 'active' : 'pending'}"></span>
                        <span class="status-text ${user.settings?.cuit ? 'active' : 'pending'}">
                            ${user.settings?.cuit ? 'Vinculado' : 'Pendiente'}
                        </span>
                    </div>
                </td>
                <td>
                    <span class="status-text ${user.plan === 'pro' ? 'active' : 'inactive'}">
                        ${user.plan === 'pro' ? '<i class="fas fa-star"></i> Pro' : '<i class="fas fa-user"></i> Free'}
                    </span>
                </td>
                <td class="text-right">
                    <div class="action-group">
                        <button class="action-btn action-btn-success" onclick="forzarSync('${user._id}')">
                            <i class="fas fa-sync-alt"></i> Sync
                        </button>
                        <button class="action-btn action-btn-error" onclick="desvincular('${user._id}')">
                            <i class="fas fa-unlink"></i> Reset
                        </button>
                    </div>
                </td>
            </tr>
        `).join('');
    } catch (error) {
        console.error('Error:', error);
        tbody.innerHTML = '<tr class="error-row"><td colspan="6"><i class="fas fa-exclamation-triangle"></i> Error de conexión<\/td><\/tr>';
    }
}

// Cargar logs
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
                <td style="white-space: nowrap;">${new Date(log.createdAt).toLocaleString()}</td>
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

// Actualizar punto de venta
window.actualizarPtoVenta = async function(userId, ptoVenta) {
    try {
        const res = await fetch('/api/admin/actualizar-pto', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json'
