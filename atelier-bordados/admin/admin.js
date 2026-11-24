const STAGES = [
    'Cotización',
    'Diseño aprobado',
    'En producción',
    'En bordado o impresión',
    'Empaque',
    'Enviado',
    'Entregado'
];

document.addEventListener('DOMContentLoaded', () => {
    setupTabs();
    loadAllDashboardData();
    setupForms();
});

function setupTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
            btn.classList.add('active');
            const targetPanel = document.getElementById(`tab-${btn.dataset.tab}`);
            if (targetPanel) targetPanel.classList.add('active');
        });
    });
}

async function loadAllDashboardData() {
    const [orders, products, inventory, coupons, quotes] = await Promise.all([
        fetch('/api/orders').then(r => r.ok ? r.json() : []).catch(() => []),
        fetch('/api/products').then(r => r.ok ? r.json() : []).catch(() => []),
        fetch('/api/inventory').then(r => r.ok ? r.json() : []).catch(() => []),
        fetch('/api/coupons').then(r => r.ok ? r.json() : []).catch(() => []),
        fetch('/api/quotes').then(r => r.ok ? r.json() : []).catch(() => [])
    ]);

    renderKPIs(orders, inventory, quotes);
    renderOrders(orders);
    renderProducts(products);
    renderInventory(inventory);
    renderCoupons(coupons);
    renderReports(orders, quotes);
}

function renderKPIs(orders, inventory, quotes) {
    const totalSales = orders.reduce((acc, o) => acc + (Number(o.order?.price) || 0), 0);
    const inProd = orders.filter(o => o.status !== 'Entregado').length;
    const clients = new Set(orders.map(o => o.user?.email).filter(Boolean)).size;
    const totalStock = inventory.reduce((acc, i) => acc + (Number(i.stock) || 0), 0);

    document.getElementById('kpi-sales').textContent = `$${totalSales.toLocaleString()} MXN`;
    document.getElementById('kpi-orders').textContent = orders.length;
    document.getElementById('kpi-production').textContent = inProd;
    document.getElementById('kpi-quotes').textContent = quotes.length;
    document.getElementById('kpi-clients').textContent = clients;
    document.getElementById('kpi-stock').textContent = `${totalStock} u.`;
}

function renderOrders(orders) {
    const tbody = document.getElementById('orders-tbody');
    if (!orders.length) {
        tbody.innerHTML = '<tr><td colspan="6">Aún no hay pedidos registrados.</td></tr>';
        return;
    }

    tbody.innerHTML = orders.map(o => {
        const currentStatus = STAGES.includes(o.status) ? o.status : 'En producción';
        const options = STAGES.map(s => `<option value="${s}" ${s === currentStatus ? 'selected' : ''}>${s}</option>`).join('');
        const imgHtml = o.order?.embroideryImageUrl
            ? `<a href="${o.order.embroideryImageUrl}" target="_blank">Ver PNG</a>`
            : 'N/A';

        return `
            <tr>
                <td><strong>${o.orderId}</strong></td>
                <td>${o.user?.name || ''}<br><small>${o.user?.email || ''}</small></td>
                <td>${o.order?.garmentName || ''}<br><small>${o.order?.techniqueName || ''}</small></td>
                <td>${imgHtml}</td>
                <td>$${Number(o.order?.price || 0).toLocaleString()} MXN</td>
                <td>
                    <select onchange="updateOrderStatus('${o.orderId}', this.value)">
                        ${options}
                    </select>
                </td>
            </tr>
        `;
    }).join('');
}

async function updateOrderStatus(folio, status) {
    await fetch(`/api/orders/${folio}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
    });
    loadAllDashboardData();
}

function renderProducts(products) {
    const tbody = document.getElementById('products-tbody');
    if (!products.length) {
        tbody.innerHTML = '<tr><td colspan="6">No hay productos registrados.</td></tr>';
        return;
    }

    tbody.innerHTML = products.map(p => `
        <tr>
            <td>${p.id}</td>
            <td><strong>${p.name}</strong></td>
            <td>${p.category}</td>
            <td>$${Number(p.price).toLocaleString()} MXN</td>
            <td>${p.description || ''}</td>
            <td><button class="btn-danger" onclick="deleteProduct('${p.id}')">Eliminar</button></td>
        </tr>
    `).join('');
}

async function deleteProduct(id) {
    await fetch(`/api/products/${id}`, { method: 'DELETE' });
    loadAllDashboardData();
}

function renderInventory(inventory) {
    const tbody = document.getElementById('inventory-tbody');
    if (!inventory.length) {
        tbody.innerHTML = '<tr><td colspan="6">No hay insumos en inventario.</td></tr>';
        return;
    }

    tbody.innerHTML = inventory.map(item => {
        const low = Number(item.stock) <= Number(item.minStock);
        return `
            <tr>
                <td>${item.id}</td>
                <td><strong>${item.item}</strong></td>
                <td>${item.stock} ${item.unit}</td>
                <td>${item.minStock} ${item.unit}</td>
                <td><span class="${low ? 'badge-low' : 'badge-ok'}">${low ? 'Stock Bajo' : 'Disponible'}</span></td>
                <td>
                    <input type="number" id="stk-${item.id}" value="${item.stock}" style="width:70px; padding:4px;">
                    <button class="btn-small" onclick="updateStock('${item.id}')">Guardar</button>
                </td>
            </tr>
        `;
    }).join('');
}

async function updateStock(id) {
    const stock = document.getElementById(`stk-${id}`).value;
    await fetch(`/api/inventory/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stock })
    });
    loadAllDashboardData();
}

function renderCoupons(coupons) {
    const tbody = document.getElementById('coupons-tbody');
    if (!coupons.length) {
        tbody.innerHTML = '<tr><td colspan="4">No hay cupones activos.</td></tr>';
        return;
    }

    tbody.innerHTML = coupons.map(c => `
        <tr>
            <td><strong>${c.code}</strong></td>
            <td>${c.discountPercent}%</td>
            <td>${c.description || ''}</td>
            <td><button class="btn-danger" onclick="deleteCoupon('${c.code}')">Eliminar</button></td>
        </tr>
    `).join('');
}

async function deleteCoupon(code) {
    await fetch(`/api/coupons/${code}`, { method: 'DELETE' });
    loadAllDashboardData();
}

function renderReports(orders, quotes) {
    const prodCounts = {};
    const clientCounts = {};

    orders.forEach(o => {
        const g = o.order?.garmentName || 'Otro';
        prodCounts[g] = (prodCounts[g] || 0) + 1;
        const c = o.user?.name || 'Cliente';
        clientCounts[c] = (clientCounts[c] || 0) + 1;
    });

    document.getElementById('report-top-products').innerHTML =
        Object.entries(prodCounts).map(([k, v]) => `<li><strong>${k}</strong>: ${v} pedido(s)</li>`).join('') || '<li>Sin ventas aún</li>';

    document.getElementById('report-top-clients').innerHTML =
        Object.entries(clientCounts).map(([k, v]) => `<li><strong>${k}</strong>: ${v} compra(s)</li>`).join('') || '<li>Sin clientes aún</li>';

    document.getElementById('report-quotes-list').innerHTML =
        quotes.map(q => `<li><strong>${q.quoteId}</strong> - ${q.name} (${q.category}): ${q.details || q.notes || ''}</li>`).join('') || '<li>Sin cotizaciones especiales</li>';
}

function setupForms() {
    document.getElementById('product-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        await fetch('/api/products', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: document.getElementById('prod-name').value.trim(),
                category: document.getElementById('prod-category').value,
                price: document.getElementById('prod-price').value,
                description: document.getElementById('prod-desc').value.trim()
            })
        });
        e.target.reset();
        loadAllDashboardData();
    });

    document.getElementById('coupon-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        await fetch('/api/coupons', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                code: document.getElementById('coup-code').value.trim(),
                discountPercent: document.getElementById('coup-percent').value,
                description: document.getElementById('coup-desc').value.trim()
            })
        });
        e.target.reset();
        loadAllDashboardData();
    });
}