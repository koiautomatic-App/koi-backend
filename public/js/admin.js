// Admin JS - KOI Factura

// Mostrar toast de notificación
function mostrarToast(mensaje, tipo = 'success') {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast toast-${tipo}`;
    toast.textContent = mensaje;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

// Copiar texto al portapapeles
async function copiarTexto(texto, label) {
    try {
        await navigator.clipboard.writeText(texto);
        mostrarToast(`${label} copiado al portapapeles`, 'success');
    } catch (err) {
        mostrarToast('Error al copiar', 'error');
    }
}

// Escape HTML para prevenir XSS
function escapeHtml(str) {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Obtener clase para el estado
function getStatusClass(status) {
    const classes = {
        'vinculado': 'vinculado',
        'pendiente': 'pendiente',
        'error': 'error',
        'desvinculado': 'desvinculado',
        'en_proceso': 'en_proceso'
    };
    return classes[status] || 'pendiente';
}

// Obtener texto legible del estado
function getStatusText(status) {
    const textos = {
        'vinculado': '✓ Vinculado',
        'pendiente': '⏳ Pendiente',
        'error': '✗ Error',
        'desvinculado': '○ Desvinculado',
        'en_proceso': '⟳ En proceso'
    };
    return textos[status] || status;
}

// Cargar lista de usuarios pendientes
async function fetchPendientes() {
    const tbody = document.getElementById('listaPendientes');
    if (!tbody) return;
    
    tbody.innerHTML = '<tr class="loading-row"><td colspan="5">Cargando usuarios...</td></tr>';
    
    try {
        const res = await fetch('/api/admin/pendientes');
        const data = await res.json();
        
        if (!data.ok) {
            tbody.innerHTML = `<tr class="error-row"><td colspan="5">Error: ${data.error || 'No autorizado'}</td></tr>`;
            mostrarToast(data.error || 'Error al cargar usuarios', 'error');
            return;
        }
        
        if (!data.lista || data.lista.length === 0) {
            tbody.innerHTML = '<tr class="empty-row"><td colspan="5">No hay usuarios con CUIT registrados</td></tr>';
            return;
        }
        
        tbody.innerHTML = data.lista.map(item => {
            const statusClass = getStatusClass(item.status);
            const statusText = getStatusText(item.status);
            
            return `
            <tr>
                <td>
                    <div class="client-name">${escapeHtml(item.cliente)}</div>
                    <div class="client-email">${escapeHtml(item.email)}</div>
                </td>
                <td>
                    <div class="fiscal-data">
                        <span class="fiscal-code">${escapeHtml(item.cuit)}</span>
                        <button class="copy-icon" onclick="copiarTexto('${escapeHtml(item.cuit)}', 'CUIT')">📋</button>
                    </div>
                    <div class="fiscal-data">
                        <span class="fiscal-code">${escapeHtml(item.claveFiscal)}</span>
                        <button class="copy-icon" onclick="copiarTexto('${escapeHtml(item.claveFiscal)}', 'Clave fiscal')">📋</button>
                    </div>
                </td>
                <td class="text-center">
                    <input type="number" id="pv-${item.id}" value="${item.puntoVenta || 1}" class="pto-input">
                </td>
                <td>
                    <div class="status-badge">
                        <span class="status-dot ${statusClass}"></span>
                        <span class="status-text ${statusClass}">${statusText}</span>
                    </div>
                    ${item.notas ? `<div class="nota-text">${escapeHtml(item.notas)}</div>` : ''}
                </td>
                <td class="text-right">
                    <div class="action-group">
                        <button class="action-btn action-btn-success" onclick="updateStatus('${item.id}', 'vinculado')">Vincular OK</button>
                        <button class="action-btn action-btn-error" onclick="updateStatus('${item.id}', 'error')">Error</button>
                        <button class="action-btn action-btn-unlink" onclick="updateStatus('${item.id}', 'desvinculado')">Desvincular</button>
                    </div>
                </td>
            </tr>
            `;
        }).join('');
    } catch (error) {
        console.error('Error:', error);
        tbody.innerHTML = `<tr class="error-row"><td colspan="5">Error de conexión: ${error.message}</td></tr>`;
        mostrarToast('Error de conexión con el servidor', 'error');
    }
}

// Actualizar estado de un usuario
async function updateStatus(userId, nuevoStatus) {
    const ptoVta = document.getElementById(`pv-${userId}`).value;
    
    let mensajePredeterminado = '';
    if (nuevoStatus === 'vinculado') mensajePredeterminado = 'Vinculación aprobada - Cliente puede facturar';
    if (nuevoStatus === 'error') mensajePredeterminado = 'Error en la vinculación - Revisar datos';
    if (nuevoStatus === 'desvinculado') mensajePredeterminado = 'Usuario desvinculado del sistema';
    
    const notas = prompt("Notas para el cliente (opcional):", mensajePredeterminado);
    if (notas === null) return;
    
    try {
        const res = await fetch('/api/admin/update-status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                userId, 
                nuevoStatus, 
                notas: notas || mensajePredeterminado,
                puntoVenta: ptoVta
            })
        });
        
        const data = await res.json();
        
        if (res.ok) {
            mostrarToast(`✅ Usuario actualizado a "${nuevoStatus}"`, 'success');
            fetchPendientes();
        } else {
            mostrarToast(`❌ Error: ${data.error || 'No se pudo actualizar'}`, 'error');
        }
    } catch (error) {
        mostrarToast(`❌ Error de red: ${error.message}`, 'error');
    }
}

// Exportar lista a CSV
function exportarCSV() {
    mostrarToast('📄 Exportando CSV...', 'success');
    setTimeout(() => {
        window.location.href = '/api/admin/exportar-csv';
    }, 500);
}

// Inicializar al cargar la página
document.addEventListener('DOMContentLoaded', () => {
    fetchPendientes();
    // Auto-refresh cada 30 segundos
    setInterval(fetchPendientes, 30000);
});
