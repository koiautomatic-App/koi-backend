async function fetchPendientes() {
    const tbody = document.getElementById('listaPendientes');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="5">Cargando...</td></tr>';
    try {
        const res = await fetch('/api/admin/pendientes');
        const data = await res.json();
        if (!data.ok) throw new Error(data.error);
        if (!data.lista || data.lista.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5">No hay usuarios</td></tr>';
            return;
        }
        tbody.innerHTML = data.lista.map(item => `
            <tr>
                <td>${item.cliente}<br><small>${item.email}</small></td>
                <td>${item.cuit}<br>${item.claveFiscal}</td>
                <td><input type="number" id="pv-${item.id}" value="${item.puntoVenta || 1}"></td>
                <td>${item.status}</td>
                <td>
                    <button onclick="updateStatus('${item.id}', 'vinculado')">Vincular OK</button>
                    <button onclick="updateStatus('${item.id}', 'error')">Error</button>
                    <button onclick="updateStatus('${item.id}', 'desvinculado')">Desvincular</button>
                </td>
            </tr>
        `).join('');
    } catch(e) {
        tbody.innerHTML = '<tr><td colspan="5">Error: ' + e.message + '</td></tr>';
    }
}

async function updateStatus(userId, nuevoStatus) {
    const ptoVta = document.getElementById(`pv-${userId}`).value;
    const notas = prompt("Notas:");
    if (notas === null) return;
    try {
        const res = await fetch('/api/admin/update-status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, nuevoStatus, notas, puntoVenta: ptoVta })
        });
        if (res.ok) {
            alert("Actualizado");
            fetchPendientes();
        } else {
            alert("Error");
        }
    } catch(e) {
        alert("Error de red");
    }
}

document.addEventListener('DOMContentLoaded', fetchPendientes);
