/**
 * EXODO / ATELIER HILO — Panel Gerencial y Gestión de Pedidos
 * Seguridad: Sin credenciales ni secretos en el cliente. Toda operación requiere sesión válida de Administrador.
 */

const STAGES = [
    'Cotización',
    'Diseño aprobado',
    'En producción',
    'Bordado/Impresión',
    'Empaque',
    'Enviado',
    'Entregado'
];

const ADMIN_TOKEN_STORAGE_KEY = 'exodo_admin_session_token';

let adminState = {
    token: sessionStorage.getItem(ADMIN_TOKEN_STORAGE_KEY) || null,
    user: null,
    orders: [],
    products: [],
    inventory: [],
    coupons: [],
    quotes: [],
    stageFilter: 'ALL',
    searchQuery: '',
    activeModalFolio: null
};

document.addEventListener('DOMContentLoaded', () => {
    setupLoginGate();
    setupTabs();
    setupOrdersToolbar();
    setupModalEvents();
    setupForms();
    verifyAdminSessionOnBoot();
});

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatCurrency(amount) {
    const num = Number(amount) || 0;
    return `$${num.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MXN`;
}

function formatDateTime(isoString) {
    if (!isoString) return '—';
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return isoString;
    return d.toLocaleDateString('es-MX', {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function getOrderTotal(order) {
    if (typeof order.total !== 'undefined') return Number(order.total) || 0;
    if (order.pricing && typeof order.pricing.total !== 'undefined') return Number(order.pricing.total) || 0;
    if (order.order && typeof order.order.price !== 'undefined') return Number(order.order.price) || 0;
    return 0;
}

function getOrderStage(order) {
    const raw = order.production_stage || order.status || 'Cotización';
    if (STAGES.includes(raw)) return raw;
    if (raw === 'En bordado o impresión') return 'Bordado/Impresión';
    return 'Cotización';
}

function getOrderFolio(order) {
    return order.folio || order.orderId || String(order.id || '');
}

async function apiFetch(url, options = {}) {
    const headers = {
        ...(options.headers || {})
    };
    if (options.body && !headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
    }
    if (adminState.token) {
        headers['Authorization'] = `Bearer ${adminState.token}`;
    }

    const response = await fetch(url, {
        ...options,
        headers,
        credentials: 'include'
    });

    if (response.status === 401 || response.status === 403) {
        if (!url.includes('/api/admin/login') && !url.includes('/api/admin/session')) {
            lockAdminPanel('Tu sesión administrativa expiró o no tiene permisos.');
        }
    }

    return response;
}

function showToast(message) {
    const toast = document.getElementById('admin-toast');
    if (!toast) return;
    toast.textContent = message;
    toast.hidden = false;
    toast.classList.remove('is-hidden');
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => {
        toast.classList.add('is-hidden');
        toast.hidden = true;
    }, 3200);
}

// ============================================================================
// 1. AUTENTICACIÓN Y BLOQUEO DE PANEL ADMINISTRATIVO
// ============================================================================
function setupLoginGate() {
    const loginForm = document.getElementById('admin-login-form');
    const toggleBtn = document.getElementById('btn-toggle-password');
    const passwordInput = document.getElementById('admin-password');
    const logoutBtn = document.getElementById('btn-admin-logout');

    if (toggleBtn && passwordInput) {
        toggleBtn.addEventListener('click', () => {
            const isPassword = passwordInput.type === 'password';
            passwordInput.type = isPassword ? 'text' : 'password';
            toggleBtn.textContent = isPassword ? 'Ocultar' : 'Ver';
        });
    }

    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const emailInput = document.getElementById('admin-email');
            const submitBtn = document.getElementById('btn-admin-submit');
            const email = emailInput.value.trim();
            const password = passwordInput.value;

            if (!email || !password) {
                showLoginError('Por favor ingresa tu correo y contraseña de Administrador.');
                return;
            }

            hideLoginError();
            submitBtn.disabled = true;
            submitBtn.textContent = 'Verificando credenciales...';

            try {
                const res = await fetch('/api/admin/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ email, password })
                });
                const data = await res.json().catch(() => ({}));

                if (!res.ok || !data.success || data.user?.role !== 'Administrador') {
                    showLoginError(data.error || 'No fue posible iniciar sesión como Administrador.');
                    return;
                }

                adminState.token = data.token;
                adminState.user = data.user;
                sessionStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, data.token);
                loginForm.reset();

                unlockAdminPanel(data.user);
                await loadAllDashboardData();
                showToast(`Bienvenido, ${data.user.name || data.user.email}`);
            } catch (_) {
                showLoginError('Error de conexión con el servidor. Verifica que el backend esté activo.');
            } finally {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Ingresar al Panel';
            }
        });
    }

    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            try {
                await apiFetch('/api/admin/logout', { method: 'POST' });
            } catch (_) {}
            lockAdminPanel();
            showToast('Sesión administrativa cerrada.');
        });
    }
}

async function verifyAdminSessionOnBoot() {
    try {
        const res = await apiFetch('/api/admin/session');
        if (!res.ok) {
            lockAdminPanel();
            return;
        }
        const data = await res.json();
        if (data && data.authenticated && data.user?.role === 'Administrador') {
            adminState.user = data.user;
            unlockAdminPanel(data.user, data.database);
            await loadAllDashboardData();
        } else {
            lockAdminPanel();
        }
    } catch (_) {
        lockAdminPanel();
    }
}

function showLoginError(msg) {
    const errBox = document.getElementById('admin-login-error');
    if (!errBox) return;
    errBox.textContent = msg;
    errBox.hidden = false;
    errBox.classList.remove('is-hidden');
}

function hideLoginError() {
    const errBox = document.getElementById('admin-login-error');
    if (!errBox) return;
    errBox.textContent = '';
    errBox.hidden = true;
    errBox.classList.add('is-hidden');
}

function unlockAdminPanel(user, dbMode) {
    const loginView = document.getElementById('admin-login-view');
    const dashboardView = document.getElementById('admin-dashboard-view');
    const userBar = document.getElementById('admin-user-bar');
    const emailPill = document.getElementById('admin-user-email');
    const dbBadge = document.getElementById('admin-db-badge');

    if (loginView) {
        loginView.classList.add('is-hidden');
        loginView.hidden = true;
    }
    if (dashboardView) {
        dashboardView.hidden = false;
        dashboardView.classList.remove('is-hidden');
    }
    if (userBar) {
        userBar.hidden = false;
        userBar.classList.remove('is-hidden');
    }
    if (emailPill && user) {
        emailPill.textContent = `${user.email} (${user.role})`;
    }
    if (dbBadge && dbMode) {
        dbBadge.textContent = dbMode === 'supabase_postgresql' ? 'Supabase PostgreSQL' : ' PostgreSQL / Local';
    }
}

function lockAdminPanel(errorMessage = '') {
    adminState.token = null;
    adminState.user = null;
    adminState.orders = [];
    sessionStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);

    const loginView = document.getElementById('admin-login-view');
    const dashboardView = document.getElementById('admin-dashboard-view');
    const userBar = document.getElementById('admin-user-bar');
    const ordersTbody = document.getElementById('orders-tbody');

    if (dashboardView) {
        dashboardView.classList.add('is-hidden');
        dashboardView.hidden = true;
    }
    if (userBar) {
        userBar.classList.add('is-hidden');
        userBar.hidden = true;
    }
    if (ordersTbody) {
        ordersTbody.innerHTML = '';
    }
    if (loginView) {
        loginView.hidden = false;
        loginView.classList.remove('is-hidden');
    }
    closeOrderModal();
    if (errorMessage) {
        showLoginError(errorMessage);
    }
}

// ============================================================================
// 2. CARGA DE DATOS PROTEGIDOS Y RENDERIZADO DEL PANEL
// ============================================================================
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

function setupOrdersToolbar() {
    const searchInput = document.getElementById('order-search-input');
    const stageFilter = document.getElementById('order-stage-filter');
    const refreshBtn = document.getElementById('btn-refresh-orders');

    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            adminState.searchQuery = e.target.value.trim().toLowerCase();
            renderOrders();
        });
    }

    if (stageFilter) {
        stageFilter.addEventListener('change', (e) => {
            adminState.stageFilter = e.target.value;
            renderStageSummaryBar();
            renderOrders();
        });
    }

    if (refreshBtn) {
        refreshBtn.addEventListener('click', async () => {
            await loadAllDashboardData();
            showToast('Pedidos sincronizados.');
        });
    }
}

async function loadAllDashboardData() {
    if (!adminState.user || adminState.user.role !== 'Administrador') return;

    const [orders, products, inventory, coupons, quotes] = await Promise.all([
        apiFetch('/api/orders').then(r => r.ok ? r.json() : []).catch(() => []),
        apiFetch('/api/products').then(r => r.ok ? r.json() : []).catch(() => []),
        apiFetch('/api/inventory').then(r => r.ok ? r.json() : []).catch(() => []),
        apiFetch('/api/coupons').then(r => r.ok ? r.json() : []).catch(() => []),
        apiFetch('/api/quotes').then(r => r.ok ? r.json() : []).catch(() => [])
    ]);

    adminState.orders = Array.isArray(orders) ? orders : [];
    adminState.products = Array.isArray(products) ? products : [];
    adminState.inventory = Array.isArray(inventory) ? inventory : [];
    adminState.coupons = Array.isArray(coupons) ? coupons : [];
    adminState.quotes = Array.isArray(quotes) ? quotes : [];

    renderKPIs();
    renderStageSummaryBar();
    renderOrders();
    renderProducts(adminState.products);
    renderInventory(adminState.inventory);
    renderCoupons(adminState.coupons);
    renderReports(adminState.orders, adminState.quotes);
}

function renderKPIs() {
    const orders = adminState.orders;
    const inventory = adminState.inventory;

    const totalSales = orders.reduce((acc, o) => acc + getOrderTotal(o), 0);
    const activeInWorkshop = orders.filter(o => getOrderStage(o) !== 'Entregado').length;
    const deliveredCount = orders.filter(o => getOrderStage(o) === 'Entregado').length;
    const clients = new Set(
        orders.map(o => (o.customer_email || o.user?.email || '').toLowerCase()).filter(Boolean)
    ).size;
    const totalStock = inventory.reduce((acc, i) => acc + (Number(i.stock) || 0), 0);

    document.getElementById('kpi-sales').textContent = formatCurrency(totalSales);
    document.getElementById('kpi-orders').textContent = orders.length;
    document.getElementById('kpi-production').textContent = activeInWorkshop;
    const deliveredEl = document.getElementById('kpi-delivered');
    if (deliveredEl) deliveredEl.textContent = deliveredCount;
    document.getElementById('kpi-clients').textContent = clients;
    document.getElementById('kpi-stock').textContent = `${totalStock} u.`;
}

function renderStageSummaryBar() {
    const bar = document.getElementById('stage-summary-bar');
    if (!bar) return;

    const counts = { ALL: adminState.orders.length };
    STAGES.forEach(s => { counts[s] = 0; });
    adminState.orders.forEach(o => {
        const st = getOrderStage(o);
        counts[st] = (counts[st] || 0) + 1;
    });

    const pills = [
        { key: 'ALL', label: 'Todos' },
        ...STAGES.map(s => ({ key: s, label: s }))
    ];

    bar.innerHTML = pills.map(p => {
        const isActive = adminState.stageFilter === p.key;
        return `
            <button type="button" class="stage-pill ${isActive ? 'active' : ''}" data-stage-pill="${escapeHtml(p.key)}">
                <span>${escapeHtml(p.label)}</span>
                <span class="stage-pill-count">${counts[p.key] || 0}</span>
            </button>
        `;
    }).join('');

    bar.querySelectorAll('[data-stage-pill]').forEach(btn => {
        btn.addEventListener('click', () => {
            adminState.stageFilter = btn.getAttribute('data-stage-pill');
            const selectEl = document.getElementById('order-stage-filter');
            if (selectEl) selectEl.value = adminState.stageFilter;
            renderStageSummaryBar();
            renderOrders();
        });
    });
}

function getFilteredOrders() {
    return adminState.orders.filter(o => {
        const stage = getOrderStage(o);
        if (adminState.stageFilter !== 'ALL' && stage !== adminState.stageFilter) {
            return false;
        }
        if (!adminState.searchQuery) return true;

        const folio = getOrderFolio(o).toLowerCase();
        const name = String(o.customer_name || o.user?.name || '').toLowerCase();
        const email = String(o.customer_email || o.user?.email || '').toLowerCase();
        const rfc = String(o.billing?.rfc || '').toLowerCase();
        const razon = String(o.billing?.razonSocial || '').toLowerCase();

        return (
            folio.includes(adminState.searchQuery) ||
            name.includes(adminState.searchQuery) ||
            email.includes(adminState.searchQuery) ||
            rfc.includes(adminState.searchQuery) ||
            razon.includes(adminState.searchQuery)
        );
    });
}

function formatPaymentBadge(order) {
    const methodMap = {
        mercadopago: 'Mercado Pago',
        card: 'Tarjeta',
        transfer: 'SPEI',
        paypal: 'PayPal',
        branch: 'Sucursal'
    };
    const method = order.payment_method || order.payment?.method || 'branch';
    const status = String(order.payment_status || order.payment?.status || 'pending');
    const upperStatus = status.toUpperCase();
    const isPaid = upperStatus === 'APPROVED' || upperStatus.includes('PAGADO');
    const badgeClass = isPaid ? 'badge-ok' : 'badge-warn';

    return `
        <div><strong>${escapeHtml(methodMap[method] || method)}</strong></div>
        <span class="${badgeClass}">${escapeHtml(status)}</span>
    `;
}

function renderOrders() {
    const tbody = document.getElementById('orders-tbody');
    if (!tbody) return;

    const filtered = getFilteredOrders();
    if (!filtered.length) {
        tbody.innerHTML = '<tr><td colspan="7">No se encontraron pedidos para los criterios seleccionados.</td></tr>';
        return;
    }

    tbody.innerHTML = filtered.map(o => {
        const folio = getOrderFolio(o);
        const currentStage = getOrderStage(o);
        const items = Array.isArray(o.items) && o.items.length > 0
            ? o.items
            : (o.order ? [o.order] : []);
        const firstItem = items[0] || {};
        const extraItemsCount = Math.max(0, items.length - 1);
        const totalUnits = items.reduce((acc, it) => acc + (Number(it.quantity) || 1), 0);

        const optionsHtml = STAGES.map(s =>
            `<option value="${escapeHtml(s)}" ${s === currentStage ? 'selected' : ''}>${escapeHtml(s)}</option>`
        ).join('');

        const rfcHtml = o.billing?.rfc
            ? `<span class="badge-rfc" title="${escapeHtml(o.billing.razonSocial || '')}">RFC: ${escapeHtml(o.billing.rfc)}</span>`
            : '<span class="sub-meta">Sin factura fiscal</span>';

        const imgUrl = firstItem.embroideryImageUrl || o.order?.embroideryImageUrl;
        const designLink = imgUrl
            ? `<a href="${escapeHtml(imgUrl)}" target="_blank" class="sub-meta">Ver arte PNG ↗</a>`
            : '';

        return `
            <tr>
                <td>
                    <strong>${escapeHtml(folio)}</strong>
                    <span class="sub-meta">${escapeHtml(formatDateTime(o.created_at || o.createdAt))}</span>
                </td>
                <td>
                    <strong>${escapeHtml(o.customer_name || o.user?.name || 'Cliente')}</strong>
                    <span class="sub-meta">${escapeHtml(o.customer_email || o.user?.email || '')}</span>
                    ${rfcHtml}
                </td>
                <td>
                    <strong>${escapeHtml(firstItem.garmentName || 'Prenda')}</strong>
                    ${extraItemsCount > 0 ? `<span class="badge-rfc">+${extraItemsCount} más</span>` : ''}
                    <span class="sub-meta">${escapeHtml(firstItem.techniqueName || 'Bordado')} · ${totalUnits} pza(s)</span>
                    ${designLink}
                </td>
                <td>${formatPaymentBadge(o)}</td>
                <td>
                    <strong>${escapeHtml(formatCurrency(getOrderTotal(o)))}</strong>
                    ${Number(o.discount || o.pricing?.discount) > 0
                        ? `<span class="sub-meta">Desc: -${escapeHtml(formatCurrency(o.discount || o.pricing?.discount))}</span>`
                        : ''}
                </td>
                <td>
                    <select class="stage-select" data-order-folio="${escapeHtml(folio)}" aria-label="Cambiar etapa de producción">
                        ${optionsHtml}
                    </select>
                </td>
                <td>
                    <button type="button" class="btn-outline" data-inspect-folio="${escapeHtml(folio)}">
                        Ver Detalle
                    </button>
                </td>
            </tr>
        `;
    }).join('');

    tbody.querySelectorAll('.stage-select').forEach(selectEl => {
        selectEl.addEventListener('change', (e) => {
            const folio = selectEl.getAttribute('data-order-folio');
            updateOrderStatus(folio, e.target.value);
        });
    });

    tbody.querySelectorAll('[data-inspect-folio]').forEach(btn => {
        btn.addEventListener('click', () => {
            openOrderDetailModal(btn.getAttribute('data-inspect-folio'));
        });
    });
}

async function updateOrderStatus(folio, status) {
    if (!STAGES.includes(status)) return;

    try {
        const res = await apiFetch(`/api/orders/${encodeURIComponent(folio)}/status`, {
            method: 'PATCH',
            body: JSON.stringify({ status })
        });
        const data = await res.json().catch(() => ({}));

        if (!res.ok || !data.success) {
            showToast(data.error || 'No se pudo actualizar la etapa.');
            return;
        }

        // Actualizar estado en memoria inmediatamente para reflejar en tabla, contadores y KPIs
        const idx = adminState.orders.findIndex(o => getOrderFolio(o) === folio);
        if (idx !== -1) {
            adminState.orders[idx] = {
                ...adminState.orders[idx],
                ...(data.order || {}),
                status,
                production_stage: status
            };
        }

        renderKPIs();
        renderStageSummaryBar();
        renderOrders();

        if (adminState.activeModalFolio === folio) {
            openOrderDetailModal(folio);
        }

        showToast(`Pedido ${folio} actualizado a "${status}"`);
    } catch (_) {
        showToast('Error de red al actualizar la etapa del pedido.');
    }
}

// ============================================================================
// 3. MODAL DE INSPECCIÓN DE DETALLE COMPLETO DEL PEDIDO
// ============================================================================
function setupModalEvents() {
    const closeBtn = document.getElementById('btn-close-modal');
    const modalBackdrop = document.getElementById('order-detail-modal');

    if (closeBtn) {
        closeBtn.addEventListener('click', closeOrderModal);
    }
    if (modalBackdrop) {
        modalBackdrop.addEventListener('click', (e) => {
            if (e.target === modalBackdrop) closeOrderModal();
        });
    }
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && adminState.activeModalFolio) {
            closeOrderModal();
        }
    });
}

function openOrderDetailModal(folio) {
    const order = adminState.orders.find(o => getOrderFolio(o) === folio);
    if (!order) return;

    adminState.activeModalFolio = folio;
    const modal = document.getElementById('order-detail-modal');
    const titleEl = document.getElementById('modal-order-title');
    const bodyEl = document.getElementById('modal-order-body');

    const currentStage = getOrderStage(order);
    const items = Array.isArray(order.items) && order.items.length > 0
        ? order.items
        : (order.order ? [order.order] : []);
    const billing = order.billing;
    const payment = order.payment || {};

    const subtotal = Number(order.subtotal ?? order.pricing?.subtotal ?? getOrderTotal(order));
    const discount = Number(order.discount ?? order.pricing?.discount ?? 0);
    const tax = Number(order.tax ?? order.pricing?.tax ?? 0);
    const total = getOrderTotal(order);
    const couponCode = order.coupon_code || order.pricing?.coupon?.code || null;

    titleEl.textContent = `Pedido ${folio}`;

    const stageOptions = STAGES.map(s =>
        `<option value="${escapeHtml(s)}" ${s === currentStage ? 'selected' : ''}>${escapeHtml(s)}</option>`
    ).join('');

    const billingHtml = billing
        ? `
            <p><strong>Razón Social:</strong> ${escapeHtml(billing.razonSocial || '—')}</p>
            <p><strong>RFC:</strong> ${escapeHtml(billing.rfc || '—')}</p>
            <p><strong>Correo Fiscal:</strong> ${escapeHtml(billing.billingEmail || '—')}</p>
            <p><strong>Dirección Fiscal:</strong> ${escapeHtml(billing.fiscalAddress || '—')}</p>
            <p><strong>C.P.:</strong> ${escapeHtml(billing.postalCode || '—')}</p>
        `
        : '<p>El cliente no solicitó factura fiscal para este pedido.</p>';

    const itemsRowsHtml = items.map((item, index) => {
        const unitPrice = Number(item.unitPrice ?? item.price ?? 0);
        const qty = Math.max(1, parseInt(item.quantity, 10) || 1);
        const lineTotal = Number(item.lineTotal ?? unitPrice * qty);
        const colorHex = item.fabricColor || '#181818';
        const colorName = item.fabricColorName || colorHex;
        const imgLink = item.embroideryImageUrl
            ? `<a href="${escapeHtml(item.embroideryImageUrl)}" target="_blank">Abrir PNG ↗</a>`
            : 'Sin vista previa';

        return `
            <tr>
                <td>${index + 1}</td>
                <td>
                    <strong>${escapeHtml(item.garmentName || 'Prenda')}</strong>
                    <span class="sub-meta">Tipo: ${escapeHtml(item.garmentType || 'custom')}</span>
                </td>
                <td>
                    ${escapeHtml(item.techniqueName || 'Bordado 3D')}
                    <span class="sub-meta">Puntadas: ${Number(item.stitchCount || 0).toLocaleString()} · Densidad: ${escapeHtml(item.stitchDensity || 3)}</span>
                </td>
                <td>
                    <span class="color-dot" style="background:${escapeHtml(colorHex)};"></span>
                    ${escapeHtml(colorName)}
                </td>
                <td>${qty}</td>
                <td>${escapeHtml(formatCurrency(unitPrice))}</td>
                <td><strong>${escapeHtml(formatCurrency(lineTotal))}</strong></td>
                <td>${imgLink}</td>
            </tr>
        `;
    }).join('');

    bodyEl.innerHTML = `
        <div class="detail-grid">
            <div class="detail-box">
                <h4>Cliente y Contacto</h4>
                <p><strong>Nombre:</strong> ${escapeHtml(order.customer_name || order.user?.name || '—')}</p>
                <p><strong>Correo:</strong> ${escapeHtml(order.customer_email || order.user?.email || '—')}</p>
                <p><strong>Fecha:</strong> ${escapeHtml(formatDateTime(order.created_at || order.createdAt))}</p>
            </div>

            <div class="detail-box">
                <h4>Datos de Facturación</h4>
                ${billingHtml}
            </div>

            <div class="detail-box">
                <h4>Pago y Etapa de Taller</h4>
                <p><strong>Método:</strong> ${escapeHtml(payment.methodLabel || order.payment_method || '—')}</p>
                <p><strong>Estado Pago:</strong> ${escapeHtml(order.payment_status || payment.status || '—')}</p>
                <p><strong>Referencia:</strong> ${escapeHtml(payment.reference || `REF-${folio}`)}</p>
                <div style="margin-top:0.65rem;">
                    <label for="modal-stage-select" style="font-size:0.74rem;font-weight:700;display:block;margin-bottom:0.3rem;">ETAPA DE PRODUCCIÓN:</label>
                    <select id="modal-stage-select" class="stage-select" style="width:100%;">
                        ${stageOptions}
                    </select>
                </div>
            </div>
        </div>

        <h4 class="detail-items-title">Artículos del Pedido (${items.length})</h4>
        <div class="table-wrap">
            <table>
                <thead>
                    <tr>
                        <th>#</th>
                        <th>Prenda</th>
                        <th>Técnica / Especificación</th>
                        <th>Color</th>
                        <th>Cant.</th>
                        <th>P. Unitario</th>
                        <th>Importe</th>
                        <th>Diseño</th>
                    </tr>
                </thead>
                <tbody>
                    ${itemsRowsHtml}
                </tbody>
            </table>
        </div>

        <div class="financial-summary">
            <div>Subtotal: <strong>${escapeHtml(formatCurrency(subtotal))}</strong></div>
            <div>Descuento ${couponCode ? `(${escapeHtml(couponCode)})` : ''}: <strong>-${escapeHtml(formatCurrency(discount))}</strong></div>
            <div>IVA (16%): <strong>${escapeHtml(formatCurrency(tax))}</strong></div>
            <div class="grand-total">Total: ${escapeHtml(formatCurrency(total))}</div>
        </div>
    `;

    const modalStageSelect = document.getElementById('modal-stage-select');
    if (modalStageSelect) {
        modalStageSelect.addEventListener('change', (e) => {
            updateOrderStatus(folio, e.target.value);
        });
    }

    modal.hidden = false;
    modal.classList.remove('is-hidden');
}

function closeOrderModal() {
    adminState.activeModalFolio = null;
    const modal = document.getElementById('order-detail-modal');
    if (modal) {
        modal.classList.add('is-hidden');
        modal.hidden = true;
    }
}

// ============================================================================
// 4. MÓDULOS COMPLEMENTARIOS DEL PANEL (CATÁLOGO, INVENTARIO, CUPONES, REPORTES)
// ============================================================================
function renderProducts(products) {
    const tbody = document.getElementById('products-tbody');
    if (!tbody) return;
    if (!products.length) {
        tbody.innerHTML = '<tr><td colspan="6">No hay productos registrados.</td></tr>';
        return;
    }

    tbody.innerHTML = products.map(p => `
        <tr>
            <td>${escapeHtml(p.id)}</td>
            <td><strong>${escapeHtml(p.name)}</strong></td>
            <td>${escapeHtml(p.category)}</td>
            <td>$${Number(p.price).toLocaleString()} MXN</td>
            <td>${escapeHtml(p.description || '')}</td>
            <td><button class="btn-danger" data-del-prod="${escapeHtml(p.id)}" data-del-name="${escapeHtml(p.name)}">Eliminar</button></td>
        </tr>
    `).join('');

    tbody.querySelectorAll('[data-del-prod]').forEach(btn => {
        btn.addEventListener('click', () => {
            deleteProduct(btn.getAttribute('data-del-prod'), btn.getAttribute('data-del-name'));
        });
    });
}

async function deleteProduct(id, name) {
    const confirmed = confirm(`¿Estás seguro de que quieres eliminar "${name}"?\nEsta acción no se puede deshacer.`);
    if (!confirmed) return;

    await apiFetch(`/api/products/${encodeURIComponent(id)}`, { method: 'DELETE' });
    loadAllDashboardData();
}

function renderInventory(inventory) {
    const tbody = document.getElementById('inventory-tbody');
    if (!tbody) return;
    if (!inventory.length) {
        tbody.innerHTML = '<tr><td colspan="6">No hay insumos en inventario.</td></tr>';
        return;
    }

    tbody.innerHTML = inventory.map(item => {
        const low = Number(item.stock) <= Number(item.minStock);
        return `
            <tr>
                <td>${escapeHtml(item.id)}</td>
                <td><strong>${escapeHtml(item.item)}</strong></td>
                <td>${escapeHtml(item.stock)} ${escapeHtml(item.unit)}</td>
                <td>${escapeHtml(item.minStock)} ${escapeHtml(item.unit)}</td>
                <td><span class="${low ? 'badge-low' : 'badge-ok'}">${low ? 'Stock Bajo' : 'Disponible'}</span></td>
                <td>
                    <input type="number" id="stk-${escapeHtml(item.id)}" value="${escapeHtml(item.stock)}" style="width:70px; padding:4px;">
                    <button class="btn-small" data-save-stock="${escapeHtml(item.id)}">Guardar</button>
                </td>
            </tr>
        `;
    }).join('');

    tbody.querySelectorAll('[data-save-stock]').forEach(btn => {
        btn.addEventListener('click', () => {
            updateStock(btn.getAttribute('data-save-stock'));
        });
    });
}

async function updateStock(id) {
    const inputEl = document.getElementById(`stk-${id}`);
    if (!inputEl) return;
    await apiFetch(`/api/inventory/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ stock: inputEl.value })
    });
    loadAllDashboardData();
    showToast(`Inventario ${id} actualizado.`);
}

function renderCoupons(coupons) {
    const tbody = document.getElementById('coupons-tbody');
    if (!tbody) return;
    if (!coupons.length) {
        tbody.innerHTML = '<tr><td colspan="4">No hay cupones activos.</td></tr>';
        return;
    }

    tbody.innerHTML = coupons.map(c => `
        <tr>
            <td><strong>${escapeHtml(c.code)}</strong></td>
            <td>${escapeHtml(c.discountPercent ?? c.value)}%</td>
            <td>${escapeHtml(c.description || '')}</td>
            <td><button class="btn-danger" data-del-coupon="${escapeHtml(c.code)}">Eliminar</button></td>
        </tr>
    `).join('');

    tbody.querySelectorAll('[data-del-coupon]').forEach(btn => {
        btn.addEventListener('click', () => {
            deleteCoupon(btn.getAttribute('data-del-coupon'));
        });
    });
}

async function deleteCoupon(code) {
    await apiFetch(`/api/coupons/${encodeURIComponent(code)}`, { method: 'DELETE' });
    loadAllDashboardData();
}

function renderReports(orders, quotes) {
    const prodCounts = {};
    const clientCounts = {};

    orders.forEach(o => {
        const items = Array.isArray(o.items) && o.items.length > 0 ? o.items : (o.order ? [o.order] : []);
        items.forEach(it => {
            const g = it.garmentName || 'Otro';
            prodCounts[g] = (prodCounts[g] || 0) + (Number(it.quantity) || 1);
        });
        const c = o.customer_name || o.user?.name || 'Cliente';
        clientCounts[c] = (clientCounts[c] || 0) + 1;
    });

    document.getElementById('report-top-products').innerHTML =
        Object.entries(prodCounts).map(([k, v]) => `<li><strong>${escapeHtml(k)}</strong>: ${v} unidad(es)</li>`).join('') || '<li>Sin ventas aún</li>';

    document.getElementById('report-top-clients').innerHTML =
        Object.entries(clientCounts).map(([k, v]) => `<li><strong>${escapeHtml(k)}</strong>: ${v} pedido(s)</li>`).join('') || '<li>Sin clientes aún</li>';

    document.getElementById('report-quotes-list').innerHTML =
        quotes.map(q => `<li><strong>${escapeHtml(q.quoteId)}</strong> - ${escapeHtml(q.name)} (${escapeHtml(q.category)}): ${escapeHtml(q.details || q.notes || '')}</li>`).join('') || '<li>Sin cotizaciones especiales</li>';
}

function setupForms() {
    const productForm = document.getElementById('product-form');
    const couponForm = document.getElementById('coupon-form');

    if (productForm) {
        productForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            await apiFetch('/api/products', {
                method: 'POST',
                body: JSON.stringify({
                    name: document.getElementById('prod-name').value.trim(),
                    category: document.getElementById('prod-category').value,
                    price: document.getElementById('prod-price').value,
                    description: document.getElementById('prod-desc').value.trim(),
                    model3d: document.getElementById('prod-model3d').value
                })
            });
            e.target.reset();
            loadAllDashboardData();
        });
    }

    if (couponForm) {
        couponForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            await apiFetch('/api/coupons', {
                method: 'POST',
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
}
