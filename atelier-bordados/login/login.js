/**
 * ATELIER HILO / ÉXODO BORDADOS
 * Módulo Checkout: Auth (Correo/Contraseña + Google OAuth), Roles (RF-15), Facturación (RF-03),
 * Carrito Múltiple (RF-06), Cupones (RF-13), Pagos Simulados (RF-08), Comprobante Imprimible y Notificaciones (RF-12/RF-16)
 */

const STORAGE_KEYS = {
    CART: 'cartItems',
    LEGACY_ORDER: 'atelier_custom_order',
    SESSION: 'atelier_auth_session',
    COUPON: 'atelier_active_coupon',
    LAST_MP_ORDER: 'atelier_last_mp_order'
};

const LOCAL_FALLBACK_COUPONS = [
    { code: 'EXODO10', type: 'percentage', value: 10, minSubtotal: 0, active: true, expiresAt: '2027-12-31T23:59:59.000Z', description: '10% de descuento en tu pedido personalizado' },
    { code: 'ATELIER150', type: 'fixed', value: 150, minSubtotal: 600, active: true, expiresAt: '2027-12-31T23:59:59.000Z', description: '$150 MXN de descuento desde $600 MXN' },
    { code: 'MAYOREO20', type: 'percentage', value: 20, minSubtotal: 2000, active: true, expiresAt: '2027-12-31T23:59:59.000Z', description: '20% de descuento desde $2,000 MXN' }
];

const ROLE_DESCRIPTIONS = {
    Administrador: 'Control total: acceso a gestión de órdenes, usuarios, precios y reportes de taller.',
    Diseñador: 'Acceso a matrices de bordado/estampado, digitalización IA y archivos PNG de producción.',
    Producción: 'Acceso a cola de taller, especificaciones de puntadas y seguimiento de lotes.',
    Ventas: 'Acceso a cotizaciones, pedidos de clientes y aplicación de cupones comerciales.',
    Cliente: 'Cuenta personal: realiza pedidos, guarda datos de facturación y descarga tus recibos.'
};

const PAYMENT_LABELS = {
    mercadopago: 'Mercado Pago Checkout Pro',
    card: 'Tarjeta de Crédito / Débito (Simulado)',
    transfer: 'Transferencia Bancaria SPEI',
    paypal: 'PayPal (Simulado)',
    branch: 'Pago en Sucursal Matamoros'
};

let cartItems = [];
let authenticatedUser = null;
let sessionToken = null;
let appliedCoupon = null;
let selectedPaymentMethod = 'mercadopago';
let taxRate = 0.16;
let lastConfirmedOrder = null;

document.addEventListener('DOMContentLoaded', async () => {
    await loadPublicConfig();
    loadCartFromStorage();
    restoreSessionFromStorage();
    initAuthEvents();
    initCartAndCouponEvents();
    initPaymentAndCheckoutEvents();
    renderCart();
    await handleMercadoPagoReturnIfPresent();
});

/**
 * Determina la URL base del backend compatible con desarrollo local (Live Server / Express) y producción (AWS EC2 / APP_URL)
 */
function getApiUrl(endpointPath) {
    const { protocol, hostname, port } = window.location;
    if (protocol === 'file:') {
        return `http://localhost:3000${endpointPath}`;
    }
    if ((hostname === 'localhost' || hostname === '127.0.0.1') && port && port !== '3000') {
        return `http://localhost:3000${endpointPath}`;
    }
    return endpointPath;
}

/**
 * Carga configuración pública del backend (GOOGLE_CLIENT_ID y TAX_RATE) para compatibilidad dev/prod
 */
async function loadPublicConfig() {
    try {
        const res = await fetch(getApiUrl('/api/config/public'));
        if (!res.ok) return;
        const cfg = await res.json();
        if (typeof cfg.taxRate === 'number') {
            taxRate = cfg.taxRate;
        }
        if (cfg.googleClientId) {
            const gOnload = document.getElementById('g_id_onload');
            if (gOnload) {
                gOnload.setAttribute('data-client_id', cfg.googleClientId);
            }
        }
    } catch (_) {
        // Fallback silencioso si se previsualiza sin backend activo
    }
}

function generateFallbackEmbroideryDataUrl() {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 256;
    const ctx = c.getContext('2d');
    ctx.strokeStyle = '#C8A46E';
    ctx.lineWidth = 12;
    ctx.beginPath();
    ctx.arc(128, 128, 86, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#C8A46E';
    ctx.font = 'bold 88px Georgia';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('AH', 128, 132);
    return c.toDataURL('image/png');
}

/* ============================================================================
   1. CARRITO DE COMPRAS MÚLTIPLE (RF-06)
   ============================================================================ */
function normalizeCartItem(raw) {
    const unitPrice = Number(raw.unitPrice !== undefined ? raw.unitPrice : raw.price) || 890;
    return {
        id: raw.id || `ITEM-${Date.now().toString(36)}-${Math.floor(Math.random() * 900 + 100)}`,
        garmentType: raw.garmentType || 'long-shirt',
        garmentName: raw.garmentName || 'Camisa Manga Larga Oxford',
        technique: raw.technique || 'embroidery',
        techniqueName: raw.techniqueName || (raw.technique === 'print' ? 'Estampado Serigráfico / DTF HD' : 'Bordado 3D de Alta Precisión'),
        unitPrice,
        price: unitPrice,
        quantity: Math.max(1, parseInt(raw.quantity, 10) || 1),
        fabricColor: raw.fabricColor || '#1c1c1e',
        fabricColorName: raw.fabricColorName || 'Negro Ónix',
        logoX: typeof raw.logoX === 'number' ? raw.logoX : 0.22,
        logoY: typeof raw.logoY === 'number' ? raw.logoY : 0.20,
        logoScale: typeof raw.logoScale === 'number' ? raw.logoScale : 0.26,
        stitchDensity: typeof raw.stitchDensity === 'number' ? raw.stitchDensity : 3,
        stitchCount: typeof raw.stitchCount === 'number' ? raw.stitchCount : 4200,
        printAreaCm2: raw.printAreaCm2 || 85,
        embroideryDataUrl: raw.embroideryDataUrl || generateFallbackEmbroideryDataUrl()
    };
}

function loadCartFromStorage() {
    try {
        const rawCart = localStorage.getItem(STORAGE_KEYS.CART);
        if (rawCart) {
            const parsed = JSON.parse(rawCart);
            if (Array.isArray(parsed) && parsed.length > 0) {
                cartItems = parsed.map(normalizeCartItem);
            }
        }
    } catch (_) {
        cartItems = [];
    }

    // Compatibilidad con estado heredado de una sola prenda ('atelier_custom_order')
    if (cartItems.length === 0) {
        try {
            const legacyRaw = localStorage.getItem(STORAGE_KEYS.LEGACY_ORDER);
            if (legacyRaw) {
                cartItems = [normalizeCartItem(JSON.parse(legacyRaw))];
                saveCartToStorage();
            }
        } catch (_) {}
    }

    // Restaurar cupón activo si existía
    try {
        const savedCoupon = localStorage.getItem(STORAGE_KEYS.COUPON);
        if (savedCoupon) appliedCoupon = JSON.parse(savedCoupon);
    } catch (_) {
        appliedCoupon = null;
    }
}

function saveCartToStorage() {
    localStorage.setItem(STORAGE_KEYS.CART, JSON.stringify(cartItems));
    if (cartItems.length > 0) {
        localStorage.setItem(STORAGE_KEYS.LEGACY_ORDER, JSON.stringify(cartItems[0]));
    } else {
        localStorage.removeItem(STORAGE_KEYS.LEGACY_ORDER);
    }
}

function calculateTotals() {
    const subtotal = cartItems.reduce((sum, item) => sum + (item.unitPrice * item.quantity), 0);
    let discount = 0;

    if (appliedCoupon && subtotal > 0) {
        if (appliedCoupon.minSubtotal && subtotal < appliedCoupon.minSubtotal) {
            discount = 0;
        } else if (appliedCoupon.type === 'percentage') {
            discount = Math.round((subtotal * (appliedCoupon.value / 100)) * 100) / 100;
        } else {
            discount = Math.min(subtotal, Number(appliedCoupon.value) || 0);
        }
    }

    const taxable = Math.max(0, subtotal - discount);
    const tax = Math.round(taxable * taxRate * 100) / 100;
    const total = Math.round((taxable + tax) * 100) / 100;

    return { subtotal, discount, tax, total };
}

function renderCart() {
    const listEl = document.getElementById('cart-items-list');
    const emptyEl = document.getElementById('cart-empty-state');
    const countPill = document.getElementById('cart-items-count');

    const totalPieces = cartItems.reduce((acc, item) => acc + item.quantity, 0);
    countPill.textContent = `${totalPieces} ${totalPieces === 1 ? 'artículo' : 'artículos'}`;

    if (cartItems.length === 0) {
        listEl.innerHTML = '';
        emptyEl.classList.remove('hidden');
    } else {
        emptyEl.classList.add('hidden');
        listEl.innerHTML = cartItems.map((item, idx) => {
            const lineSubtotal = item.unitPrice * item.quantity;
            const techShort = item.technique === 'print' ? 'Estampado HD' : 'Bordado 3D';
            return `
                <article class="cart-item-card" data-item-id="${item.id}">
                    <div class="cart-item-thumb">
                        <img src="${item.embroideryDataUrl}" alt="${escapeHtml(item.garmentName)}">
                    </div>
                    <div class="cart-item-body">
                        <div class="cart-item-top">
                            <span class="cart-item-title">${escapeHtml(item.garmentName)}</span>
                            <button type="button" class="btn-remove-item" data-action="remove" data-index="${idx}" title="Eliminar artículo">✕</button>
                        </div>
                        <div class="cart-item-meta">
                            <span class="color-dot" style="background:${item.fabricColor};"></span>
                            <span>${escapeHtml(item.fabricColorName)}</span>
                            <span>•</span>
                            <span>${techShort}</span>
                            <span>•</span>
                            <span>$${item.unitPrice.toLocaleString()} c/u</span>
                        </div>
                        <div class="cart-item-controls">
                            <div class="qty-stepper">
                                <button type="button" class="qty-btn" data-action="dec" data-index="${idx}" aria-label="Disminuir cantidad">−</button>
                                <span class="qty-value">${item.quantity}</span>
                                <button type="button" class="qty-btn" data-action="inc" data-index="${idx}" aria-label="Aumentar cantidad">+</button>
                            </div>
                            <span class="cart-item-subtotal">$${lineSubtotal.toLocaleString()} MXN</span>
                        </div>
                    </div>
                </article>
            `;
        }).join('');
    }

    updateTotalsUI();
}

function updateTotalsUI() {
    const { subtotal, discount, tax, total } = calculateTotals();
    document.getElementById('summary-subtotal').textContent = `$${subtotal.toLocaleString()} MXN`;
    document.getElementById('summary-tax').textContent = `$${tax.toLocaleString()} MXN`;
    document.getElementById('summary-total').textContent = `$${total.toLocaleString()} MXN`;

    const discountRow = document.getElementById('summary-discount-row');
    if (appliedCoupon && discount > 0) {
        discountRow.classList.remove('hidden');
        document.getElementById('applied-coupon-badge').textContent = appliedCoupon.code;
        document.getElementById('summary-discount').textContent = `-$${discount.toLocaleString()} MXN`;
    } else {
        discountRow.classList.add('hidden');
    }
}

function initCartAndCouponEvents() {
    // Delegación de eventos para incrementar, decrementar y eliminar artículos
    document.getElementById('cart-items-list').addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-action]');
        if (!btn) return;
        const idx = parseInt(btn.dataset.index, 10);
        if (Number.isNaN(idx) || !cartItems[idx]) return;

        const action = btn.dataset.action;
        if (action === 'inc') {
            cartItems[idx].quantity += 1;
        } else if (action === 'dec') {
            if (cartItems[idx].quantity > 1) {
                cartItems[idx].quantity -= 1;
            } else {
                cartItems.splice(idx, 1);
            }
        } else if (action === 'remove') {
            cartItems.splice(idx, 1);
        }

        saveCartToStorage();
        renderCart();
    });

    // Aplicar cupón de descuento contra backend POST /api/coupons/validate
    const applyBtn = document.getElementById('apply-coupon-btn');
    const couponInput = document.getElementById('coupon-code-input');
    const feedbackEl = document.getElementById('coupon-feedback');

    applyBtn.addEventListener('click', async () => {
        const code = couponInput.value.trim().toUpperCase();
        const { subtotal } = calculateTotals();

        if (!code) {
            showCouponFeedback('Ingresa un código de cupón.', false);
            return;
        }
        if (subtotal <= 0) {
            showCouponFeedback('Agrega al menos un artículo al carrito primero.', false);
            return;
        }

        applyBtn.disabled = true;
        applyBtn.textContent = '...';

        try {
            const res = await fetch(getApiUrl('/api/coupons/validate'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code, subtotal })
            });
            const data = await res.json();

            if (!res.ok || !data.valid) {
                appliedCoupon = null;
                localStorage.removeItem(STORAGE_KEYS.COUPON);
                showCouponFeedback(data.error || 'Cupón no válido.', false);
            } else {
                appliedCoupon = data.coupon;
                localStorage.setItem(STORAGE_KEYS.COUPON, JSON.stringify(appliedCoupon));
                showCouponFeedback(data.message || `Cupón ${data.coupon.code} aplicado.`, true);
            }
        } catch (_) {
            // Fallback local si el servidor no está levantado en pruebas de Live Server
            const found = LOCAL_FALLBACK_COUPONS.find(c => c.code === code);
            if (!found) {
                showCouponFeedback(`El cupón "${code}" no existe.`, false);
            } else if (found.minSubtotal && subtotal < found.minSubtotal) {
                showCouponFeedback(`Requiere subtotal mínimo de $${found.minSubtotal.toLocaleString()} MXN.`, false);
            } else {
                appliedCoupon = found;
                localStorage.setItem(STORAGE_KEYS.COUPON, JSON.stringify(appliedCoupon));
                showCouponFeedback(`Cupón ${found.code} aplicado (modo local).`, true);
            }
        } finally {
            applyBtn.disabled = false;
            applyBtn.textContent = 'Aplicar';
            updateTotalsUI();
        }
    });

    document.getElementById('remove-coupon-btn').addEventListener('click', () => {
        appliedCoupon = null;
        localStorage.removeItem(STORAGE_KEYS.COUPON);
        couponInput.value = '';
        feedbackEl.classList.add('hidden');
        updateTotalsUI();
    });
}

function showCouponFeedback(msg, isOk) {
    const el = document.getElementById('coupon-feedback');
    el.textContent = msg;
    el.className = `coupon-feedback ${isOk ? 'ok' : 'err'}`;
}

/* ============================================================================
   2. AUTENTICACIÓN, ROLES Y DATOS DE FACTURACIÓN (RF-03 y RF-15)
   ============================================================================ */
function restoreSessionFromStorage() {
    try {
        const raw = localStorage.getItem(STORAGE_KEYS.SESSION);
        if (!raw) return;
        const saved = JSON.parse(raw);
        if (saved && saved.user && saved.user.email) {
            sessionToken = saved.token || null;
            applyAuthenticatedSession(saved.user, saved.verifiedByServer !== false, false);
        }
    } catch (_) {}
}

function persistSession(user, token, verifiedByServer) {
    localStorage.setItem(STORAGE_KEYS.SESSION, JSON.stringify({
        user,
        token,
        verifiedByServer
    }));
}

function showAuthError(message) {
    const el = document.getElementById('auth-error-banner');
    if (!message) {
        el.classList.add('hidden');
        el.textContent = '';
        return;
    }
    el.textContent = message;
    el.classList.remove('hidden');
}

function applyAuthenticatedSession(user, verifiedByServer = true, shouldPersist = true) {
    authenticatedUser = {
        id: user.id || null,
        name: user.name,
        email: user.email,
        role: user.role || 'Cliente',
        billing: user.billing || null,
        googleJwt: user.googleJwt || null
    };

    if (shouldPersist) {
        persistSession(authenticatedUser, sessionToken, verifiedByServer);
    }

    document.getElementById('auth-forms-section').classList.add('hidden');
    document.getElementById('verified-user-card').classList.remove('hidden');
    document.getElementById('billing-section').classList.remove('hidden');
    document.getElementById('payment-section').classList.remove('hidden');

    document.getElementById('user-name-display').textContent = authenticatedUser.name;
    document.getElementById('user-email-display').textContent = authenticatedUser.email;
    document.getElementById('user-role-badge').textContent = authenticatedUser.role;
    document.getElementById('role-access-note').textContent =
        ROLE_DESCRIPTIONS[authenticatedUser.role] || ROLE_DESCRIPTIONS.Cliente;

    document.getElementById('auth-status-badge').textContent = verifiedByServer
        ? '✓ SESIÓN VERIFICADA POR SERVIDOR'
        : '✓ SESIÓN ACTIVA (MODO LOCAL)';

    // Precargar datos de facturación si el usuario ya los tenía guardados
    if (authenticatedUser.billing) {
        const b = authenticatedUser.billing;
        document.getElementById('billing-razon').value = b.razonSocial || '';
        document.getElementById('billing-rfc').value = b.rfc || '';
        document.getElementById('billing-cp').value = b.postalCode || '';
        document.getElementById('billing-email').value = b.billingEmail || authenticatedUser.email;
        document.getElementById('billing-address').value = b.fiscalAddress || '';
    } else {
        document.getElementById('billing-email').value = authenticatedUser.email;
    }

    document.getElementById('paypal-email').value = authenticatedUser.email;
}

async function authenticateWithGoogleBackend(authPayload) {
    showAuthError('');
    try {
        const response = await fetch(getApiUrl('/api/auth/google'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(authPayload)
        });

        const data = await response.json();
        if (response.ok && data.verified && data.user) {
            sessionToken = data.token || null;
            applyAuthenticatedSession({
                ...data.user,
                googleJwt: authPayload.credential || authPayload.googleJwt
            }, true);
            return;
        }
        showAuthError(data.error || 'No se pudo verificar la sesión con Google.');
    } catch (_) {
        // Fallback local si se prueba sin backend activo
        applyAuthenticatedSession({
            name: authPayload.name || 'Cliente Verificado (Google OAuth)',
            email: authPayload.email || 'cliente.verificado@gmail.com',
            role: authPayload.role || 'Cliente',
            googleJwt: authPayload.credential || authPayload.googleJwt || 'DEV_LOCAL_TOKEN_SIMULATED'
        }, false);
    }
}

window.handleGoogleCredentialResponse = function (response) {
    let decodedName = 'Usuario Google';
    let decodedEmail = '';
    try {
        const base64Url = response.credential.split('.')[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const payload = JSON.parse(window.atob(base64));
        decodedName = payload.name || decodedName;
        decodedEmail = payload.email || decodedEmail;
    } catch (_) {}

    const selectedRole = document.getElementById('demo-role-select')?.value || 'Cliente';
    authenticateWithGoogleBackend({
        credential: response.credential,
        googleJwt: response.credential,
        name: decodedName,
        email: decodedEmail,
        role: selectedRole
    });
};

function initAuthEvents() {
    // Alternar pestañas Iniciar Sesión / Crear Cuenta
    document.querySelectorAll('.auth-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            const mode = tab.dataset.authTab;
            document.getElementById('login-form').classList.toggle('hidden', mode !== 'login');
            document.getElementById('register-form').classList.toggle('hidden', mode !== 'register');
            showAuthError('');
        });
    });

    // Submit: Iniciar Sesión con correo y contraseña
    document.getElementById('login-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        showAuthError('');
        const email = document.getElementById('login-email').value.trim();
        const password = document.getElementById('login-password').value;

        try {
            const res = await fetch(getApiUrl('/api/auth/login'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                showAuthError(data.error || 'Correo o contraseña incorrectos.');
                return;
            }
            sessionToken = data.token;
            applyAuthenticatedSession(data.user, true);
        } catch (_) {
            showAuthError('No se pudo conectar con el servidor. Inicia el backend (npm start) o usa "Demo Google Local".');
        }
    });

    // Submit: Registro de cliente/usuario con rol
    document.getElementById('register-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        showAuthError('');
        const name = document.getElementById('register-name').value.trim();
        const email = document.getElementById('register-email').value.trim();
        const password = document.getElementById('register-password').value;
        const role = document.getElementById('register-role').value;

        try {
            const res = await fetch(getApiUrl('/api/auth/register'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, email, password, role })
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                showAuthError(data.error || 'No se pudo completar el registro.');
                return;
            }
            sessionToken = data.token;
            applyAuthenticatedSession(data.user, true);
        } catch (_) {
            // Fallback local si el backend no está encendido
            applyAuthenticatedSession({ name, email, role }, false);
        }
    });

    // Botón Demo Google Local
    document.getElementById('simulate-google-btn').addEventListener('click', () => {
        const selectedRole = document.getElementById('demo-role-select').value || 'Cliente';
        authenticateWithGoogleBackend({
            name: `Usuario Demo (${selectedRole})`,
            email: `${selectedRole.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')}@atelier-demo.com`,
            role: selectedRole,
            googleJwt: 'DEV_LOCAL_TOKEN_SIMULATED'
        });
    });

    // Cerrar sesión
    document.getElementById('logout-btn').addEventListener('click', () => {
        authenticatedUser = null;
        sessionToken = null;
        localStorage.removeItem(STORAGE_KEYS.SESSION);
        document.getElementById('verified-user-card').classList.add('hidden');
        document.getElementById('billing-section').classList.add('hidden');
        document.getElementById('payment-section').classList.add('hidden');
        document.getElementById('auth-forms-section').classList.remove('hidden');
    });

    // Toggle campos de facturación
    document.getElementById('require-invoice-toggle').addEventListener('change', (e) => {
        document.getElementById('billing-fields').classList.toggle('hidden', !e.target.checked);
    });
}

/* ============================================================================
   3. MÉTODOS DE PAGO, ENVÍO DE ORDEN, NOTIFICACIÓN Y RECIBO (RF-08, RF-12, RF-16)
   ============================================================================ */
function showCheckoutError(msg) {
    const el = document.getElementById('checkout-error-banner');
    if (!msg) {
        el.classList.add('hidden');
        el.textContent = '';
        return;
    }
    el.textContent = msg;
    el.classList.remove('hidden');
}

function collectAndValidateBilling() {
    const wantsInvoice = document.getElementById('require-invoice-toggle').checked;
    if (!wantsInvoice) return { valid: true, billing: null };

    const razonSocial = document.getElementById('billing-razon').value.trim();
    const rfc = document.getElementById('billing-rfc').value.trim().toUpperCase();
    const postalCode = document.getElementById('billing-cp').value.trim();
    const billingEmail = document.getElementById('billing-email').value.trim();
    const fiscalAddress = document.getElementById('billing-address').value.trim();

    if (!razonSocial) {
        return { valid: false, error: 'Ingresa la Razón Social o Nombre Fiscal para facturar.' };
    }
    if (!/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(rfc)) {
        return { valid: false, error: 'El RFC debe tener un formato válido de 12 o 13 caracteres (ej. XAXX010101000).' };
    }
    if (!/^\d{5}$/.test(postalCode)) {
        return { valid: false, error: 'El Código Postal fiscal debe tener 5 dígitos.' };
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(billingEmail)) {
        return { valid: false, error: 'Ingresa un correo de facturación válido.' };
    }

    return {
        valid: true,
        billing: { razonSocial, rfc, postalCode, billingEmail, fiscalAddress }
    };
}

function collectAndValidatePayment() {
    const base = {
        method: selectedPaymentMethod,
        methodLabel: PAYMENT_LABELS[selectedPaymentMethod]
    };

    if (selectedPaymentMethod === 'card') {
        const holder = document.getElementById('card-holder').value.trim();
        const rawNumber = document.getElementById('card-number').value.replace(/\s+/g, '');
        const expiry = document.getElementById('card-expiry').value.trim();
        const cvv = document.getElementById('card-cvv').value.trim();

        if (!holder) return { valid: false, error: 'Ingresa el nombre del titular de la tarjeta.' };
        if (!/^\d{16}$/.test(rawNumber)) return { valid: false, error: 'El número de tarjeta simulado debe contener 16 dígitos.' };
        if (!/^(0[1-9]|1[0-2])\/\d{2}$/.test(expiry)) return { valid: false, error: 'La vigencia debe tener formato MM/AA (ej. 12/28).' };
        if (!/^\d{3,4}$/.test(cvv)) return { valid: false, error: 'El CVV debe tener 3 o 4 dígitos.' };

        // Nunca se envían ni guardan el número completo ni el CVV
        return {
            valid: true,
            payment: {
                ...base,
                cardHolder: holder,
                cardLast4: rawNumber.slice(-4),
                reference: `CARD-****${rawNumber.slice(-4)}`
            }
        };
    }

    if (selectedPaymentMethod === 'paypal') {
        const ppEmail = document.getElementById('paypal-email').value.trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ppEmail)) {
            return { valid: false, error: 'Ingresa un correo válido para el pago simulado con PayPal.' };
        }
        return {
            valid: true,
            payment: { ...base, paypalEmail: ppEmail, reference: `PP-${Date.now().toString(36).toUpperCase()}` }
        };
    }

    if (selectedPaymentMethod === 'transfer') {
        return {
            valid: true,
            payment: { ...base, reference: 'SPEI-CLABE-012818001548960723' }
        };
    }

    return {
        valid: true,
        payment: { ...base, reference: 'SUCURSAL-MATAMOROS-87350' }
    };
}

function initPaymentAndCheckoutEvents() {
    // Formato automático visual en campo de tarjeta y vigencia
    const cardNumberInput = document.getElementById('card-number');
    cardNumberInput.addEventListener('input', (e) => {
        const digits = e.target.value.replace(/\D/g, '').slice(0, 16);
        e.target.value = digits.replace(/(\d{4})(?=\d)/g, '$1 ');
    });

    const cardExpiryInput = document.getElementById('card-expiry');
    cardExpiryInput.addEventListener('input', (e) => {
        const digits = e.target.value.replace(/\D/g, '').slice(0, 4);
        e.target.value = digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits;
    });

    // Selección de método de pago
    document.querySelectorAll('.payment-option').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.payment-option').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            selectedPaymentMethod = btn.dataset.payment;

            ['mercadopago', 'card', 'transfer', 'paypal', 'branch'].forEach(method => {
                const panel = document.getElementById(`pay-panel-${method}`);
                if (panel) panel.classList.toggle('hidden', method !== selectedPaymentMethod);
            });

            const confirmBtn = document.getElementById('confirm-production-btn');
            if (confirmBtn) {
                confirmBtn.textContent = selectedPaymentMethod === 'mercadopago'
                    ? 'Confirmar y Pagar con Mercado Pago →'
                    : 'Confirmar y Registrar Pedido →';
            }
            showCheckoutError('');
        });
    });

    // Botón directo de Mercado Pago dentro de su panel
    const mpPayBtn = document.getElementById('pay-mercadopago-btn');
    if (mpPayBtn) {
        mpPayBtn.addEventListener('click', () => {
            selectedPaymentMethod = 'mercadopago';
            document.getElementById('confirm-production-btn').click();
        });
    }

    // Confirmar pedido y enviar a POST /api/payments/create-preference (Mercado Pago) o POST /api/orders
    const confirmBtn = document.getElementById('confirm-production-btn');
    confirmBtn.textContent = selectedPaymentMethod === 'mercadopago'
        ? 'Confirmar y Pagar con Mercado Pago →'
        : 'Confirmar y Registrar Pedido →';

    confirmBtn.addEventListener('click', async () => {
        showCheckoutError('');

        if (!authenticatedUser) {
            showCheckoutError('Inicia sesión o regístrate antes de confirmar tu orden.');
            return;
        }
        if (cartItems.length === 0) {
            showCheckoutError('Tu carrito está vacío. Agrega al menos una prenda en el Estudio 3D.');
            return;
        }

        const billingCheck = collectAndValidateBilling();
        if (!billingCheck.valid) {
            showCheckoutError(billingCheck.error);
            return;
        }

        // Persistir datos fiscales en el perfil del usuario si hay sesión con token
        if (billingCheck.billing && sessionToken) {
            try {
                await fetch(getApiUrl('/api/users/me'), {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${sessionToken}`
                    },
                    body: JSON.stringify({ billing: billingCheck.billing })
                });
            } catch (_) {}
        }

        // Flujo 1: Pago con Mercado Pago (POST /api/payments/create-preference)
        if (selectedPaymentMethod === 'mercadopago') {
            const originalText = confirmBtn.textContent;
            confirmBtn.disabled = true;
            confirmBtn.textContent = 'Generando preferencia en Mercado Pago...';
            if (mpPayBtn) {
                mpPayBtn.disabled = true;
                mpPayBtn.textContent = 'Conectando con Mercado Pago...';
            }

            try {
                const mpPayload = {
                    user: authenticatedUser,
                    items: cartItems,
                    order: cartItems[0],
                    billing: billingCheck.billing,
                    couponCode: appliedCoupon ? appliedCoupon.code : null,
                    createdAt: new Date().toISOString()
                };

                const response = await fetch(getApiUrl('/api/payments/create-preference'), {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {})
                    },
                    body: JSON.stringify(mpPayload)
                });

                const result = await response.json();
                if (!response.ok || !result.success) {
                    throw new Error(result.error || 'No se pudo iniciar el checkout con Mercado Pago.');
                }

                if (result.orderRecord) {
                    localStorage.setItem(STORAGE_KEYS.LAST_MP_ORDER, JSON.stringify(result.orderRecord));
                }

                const checkoutUrl = result.init_point || result.sandbox_init_point;
                if (checkoutUrl) {
                    window.location.href = checkoutUrl;
                    return;
                }

                throw new Error('Mercado Pago no devolvió una URL de pago válida.');
            } catch (err) {
                showCheckoutError(err.message || 'Error al conectar con Mercado Pago.');
                confirmBtn.disabled = false;
                confirmBtn.textContent = originalText;
                if (mpPayBtn) {
                    mpPayBtn.disabled = false;
                    mpPayBtn.textContent = 'Pagar con Mercado Pago →';
                }
                return;
            }
        }

        // Flujo 2: Otros métodos de pago (Tarjeta directa simulada, SPEI, PayPal, Sucursal)
        const paymentCheck = collectAndValidatePayment();
        if (!paymentCheck.valid) {
            showCheckoutError(paymentCheck.error);
            return;
        }

        const originalBtnText = confirmBtn.textContent;
        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Procesando orden...';

        const finalPayload = {
            user: authenticatedUser,
            items: cartItems,
            order: cartItems[0],
            billing: billingCheck.billing,
            payment: paymentCheck.payment,
            couponCode: appliedCoupon ? appliedCoupon.code : null,
            createdAt: new Date().toISOString()
        };

        try {
            const response = await fetch(getApiUrl('/api/orders'), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {})
                },
                body: JSON.stringify(finalPayload)
            });

            const result = await response.json();
            if (!response.ok || !result.success) {
                throw new Error(result.error || 'Error al registrar la orden en el servidor.');
            }

            lastConfirmedOrder = result.orderRecord;
            populatePrintableReceipt(lastConfirmedOrder);
            renderOrderConfirmation({
                orderId: result.orderId,
                message: result.message || 'Orden registrada en taller',
                paymentStatus: lastConfirmedOrder?.payment_status || lastConfirmedOrder?.payment?.status || 'REGISTRADO',
                embroideryImageUrl: result.embroideryImageUrl ? getApiUrl(result.embroideryImageUrl) : null,
                emailNotification: result.emailNotification
            });

            // Limpiar carrito y cupón tras éxito
            cartItems = [];
            appliedCoupon = null;
            localStorage.removeItem(STORAGE_KEYS.CART);
            localStorage.removeItem(STORAGE_KEYS.LEGACY_ORDER);
            localStorage.removeItem(STORAGE_KEYS.COUPON);
            renderCart();
            confirmBtn.textContent = '✓ Orden Registrada en Taller';
        } catch (error) {
            console.warn('Error conectando con POST /api/orders, activando fallback local:', error.message);

            const totals = calculateTotals();
            const fallbackFolio = `AH-2026-${Math.floor(1000 + Math.random() * 9000)}`;
            const fallbackRecord = {
                orderId: fallbackFolio,
                folio: fallbackFolio,
                createdAt: new Date().toISOString(),
                user: authenticatedUser,
                billing: billingCheck.billing,
                items: cartItems.map((it, i) => ({
                    itemIndex: i + 1,
                    ...it,
                    lineTotal: it.unitPrice * it.quantity
                })),
                pricing: { ...totals, taxRate, coupon: appliedCoupon },
                payment: { ...paymentCheck.payment, status: 'CONFIRMADO_MODO_LOCAL' }
            };

            lastConfirmedOrder = fallbackRecord;
            populatePrintableReceipt(fallbackRecord);
            renderOrderConfirmation({
                orderId: fallbackFolio,
                message: 'Orden confirmada en modo local',
                paymentStatus: 'CONFIRMADO_MODO_LOCAL',
                embroideryImageUrl: null,
                emailNotification: {
                    to: authenticatedUser.email,
                    subject: `Confirmación de Pedido ${fallbackFolio}`,
                    sentAt: new Date().toISOString()
                }
            });

            cartItems = [];
            appliedCoupon = null;
            localStorage.removeItem(STORAGE_KEYS.CART);
            localStorage.removeItem(STORAGE_KEYS.LEGACY_ORDER);
            localStorage.removeItem(STORAGE_KEYS.COUPON);
            renderCart();
            confirmBtn.textContent = originalBtnText;
            confirmBtn.disabled = false;
        }
    });

    // Botón Descargar / Imprimir Recibo (RF-12)
    document.getElementById('print-receipt-btn').addEventListener('click', () => {
        if (lastConfirmedOrder) {
            populatePrintableReceipt(lastConfirmedOrder);
        }
        window.print();
    });
}

/**
 * Procesa el retorno desde las back_urls de Mercado Pago (?mp_status=approved|pending|rejected&folio=AH-2026-XXXX)
 */
async function handleMercadoPagoReturnIfPresent() {
    const params = new URLSearchParams(window.location.search);
    const folio = (params.get('folio') || params.get('external_reference') || '').trim();
    const mpStatus = params.get('mp_status') || params.get('status') || params.get('collection_status');

    if (!folio && !mpStatus) return;

    const returnPayload = {
        folio,
        external_reference: params.get('external_reference'),
        mp_status: params.get('mp_status'),
        status: params.get('status'),
        collection_status: params.get('collection_status'),
        payment_id: params.get('payment_id'),
        collection_id: params.get('collection_id'),
        preference_id: params.get('preference_id'),
        payment_type: params.get('payment_type')
    };

    try {
        const res = await fetch(getApiUrl('/api/payments/confirm-return'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(returnPayload)
        });
        const data = await res.json();

        if (res.ok && data.success && data.orderRecord) {
            const orderRecord = data.orderRecord;
            lastConfirmedOrder = orderRecord;

            // Asegurar que la vista muestre los datos del cliente si volvió de una redirección externa
            if (!authenticatedUser && orderRecord.user) {
                applyAuthenticatedSession(orderRecord.user, true, false);
            }

            populatePrintableReceipt(orderRecord);

            const statusMessages = {
                approved: 'Pago aprobado en Mercado Pago y orden confirmada en taller',
                pending: 'Orden registrada en Supabase con pago pendiente de acreditación en Mercado Pago',
                rejected: 'El pago en Mercado Pago fue rechazado o cancelado. Tu folio quedó registrado como pendiente'
            };

            const firstImg = orderRecord.items && orderRecord.items[0] ? orderRecord.items[0].embroideryImageUrl : null;
            renderOrderConfirmation({
                orderId: orderRecord.folio || orderRecord.orderId,
                message: statusMessages[data.paymentStatus] || 'Orden procesada con Mercado Pago',
                paymentStatus: data.paymentStatus || orderRecord.payment_status,
                embroideryImageUrl: firstImg && !firstImg.startsWith('data:') ? getApiUrl(firstImg) : null,
                emailNotification: data.emailNotification
            });

            if (data.paymentStatus === 'approved' || data.paymentStatus === 'pending') {
                cartItems = [];
                appliedCoupon = null;
                localStorage.removeItem(STORAGE_KEYS.CART);
                localStorage.removeItem(STORAGE_KEYS.LEGACY_ORDER);
                localStorage.removeItem(STORAGE_KEYS.COUPON);
                renderCart();
            }
        }
    } catch (err) {
        console.warn('No se pudo confirmar el retorno de Mercado Pago con el servidor, usando respaldo local:', err);
        try {
            const cachedRaw = localStorage.getItem(STORAGE_KEYS.LAST_MP_ORDER);
            if (cachedRaw) {
                const cachedOrder = JSON.parse(cachedRaw);
                lastConfirmedOrder = cachedOrder;
                populatePrintableReceipt(cachedOrder);
                renderOrderConfirmation({
                    orderId: cachedOrder.folio || cachedOrder.orderId || folio,
                    message: 'Retorno de Mercado Pago recibido',
                    paymentStatus: mpStatus || 'pending',
                    embroideryImageUrl: null,
                    emailNotification: {
                        to: cachedOrder.user?.email || '',
                        subject: `Comprobante de Pedido ${cachedOrder.folio || folio}`,
                        sentAt: new Date().toISOString()
                    }
                });
            }
        } catch (_) {}
    } finally {
        // Limpiar query params de la barra de direcciones sin recargar la página
        if (window.history && window.history.replaceState) {
            window.history.replaceState({}, document.title, window.location.pathname);
        }
    }
}

function renderOrderConfirmation({ orderId, message, paymentStatus, embroideryImageUrl, emailNotification }) {
    const card = document.getElementById('order-confirmation-card');
    const customerName = authenticatedUser?.name || lastConfirmedOrder?.user?.name || 'Cliente';
    const customerEmail = authenticatedUser?.email || lastConfirmedOrder?.user?.email || '';

    document.getElementById('confirmed-order-folio').textContent = orderId;
    document.getElementById('confirmed-order-msg').textContent =
        `${message} para ${customerName}${customerEmail ? ` (${customerEmail})` : ''}.`;

    const statusBadge = document.getElementById('confirmed-payment-status-badge');
    if (statusBadge) {
        const rawSt = String(paymentStatus || 'pending').toLowerCase();
        if (rawSt === 'approved' || rawSt.includes('pagado')) {
            statusBadge.textContent = '✓ PAGO APROBADO';
            statusBadge.className = 'mp-status-pill approved';
        } else if (rawSt === 'rejected') {
            statusBadge.textContent = '✕ PAGO RECHAZADO';
            statusBadge.className = 'mp-status-pill rejected';
        } else {
            statusBadge.textContent = '⏳ PAGO PENDIENTE';
            statusBadge.className = 'mp-status-pill pending';
        }
    }

    const noticeDetail = document.getElementById('email-notice-detail');
    if (emailNotification) {
        const sentTime = new Date(emailNotification.sentAt).toLocaleString('es-MX');
        noticeDetail.textContent =
            `Destinatario: ${emailNotification.to} • Asunto: "${emailNotification.subject}" • Enviado: ${sentTime}`;
    }

    const imgLink = document.getElementById('confirmed-image-link');
    if (embroideryImageUrl) {
        imgLink.href = embroideryImageUrl;
        imgLink.classList.remove('hidden');
    } else {
        imgLink.classList.add('hidden');
    }

    card.classList.remove('hidden');
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function populatePrintableReceipt(record) {
    if (!record) return;

    document.getElementById('receipt-folio').textContent = record.orderId;
    document.getElementById('receipt-date').textContent = new Date(record.createdAt).toLocaleString('es-MX');
    document.getElementById('receipt-user-name').textContent = record.user.name;
    document.getElementById('receipt-user-email').textContent = record.user.email;
    document.getElementById('receipt-user-role').textContent = record.user.role || 'Cliente';

    const billingEl = document.getElementById('receipt-billing-block');
    if (record.billing) {
        billingEl.innerHTML = `
            <p><strong>Razón Social:</strong> ${escapeHtml(record.billing.razonSocial)}</p>
            <p><strong>RFC:</strong> ${escapeHtml(record.billing.rfc)} • <strong>CP:</strong> ${escapeHtml(record.billing.postalCode)}</p>
            <p><strong>Correo Fiscal:</strong> ${escapeHtml(record.billing.billingEmail)}</p>
            ${record.billing.fiscalAddress ? `<p><strong>Domicilio:</strong> ${escapeHtml(record.billing.fiscalAddress)}</p>` : ''}
        `;
    } else {
        billingEl.innerHTML = '<p>Sin datos fiscales solicitados (Venta público en general).</p>';
    }

    const tbody = document.getElementById('receipt-items-tbody');
    tbody.innerHTML = (record.items || []).map((item, idx) => `
        <tr>
            <td>${idx + 1}</td>
            <td><strong>${escapeHtml(item.garmentName)}</strong><br><small>${escapeHtml(item.techniqueName || '')}</small></td>
            <td>Color: ${escapeHtml(item.fabricColorName || item.fabricColor)}<br>Pos: X ${Number(item.logoX).toFixed(2)}, Y ${Number(item.logoY).toFixed(2)}</td>
            <td>${item.quantity}</td>
            <td>$${Number(item.unitPrice).toLocaleString()} MXN</td>
            <td><strong>$${Number(item.lineTotal).toLocaleString()} MXN</strong></td>
        </tr>
    `).join('');

    document.getElementById('receipt-payment-method').textContent = record.payment?.methodLabel || record.payment?.method || 'Sucursal';
    document.getElementById('receipt-payment-status').textContent = record.payment?.status || 'REGISTRADO';
    document.getElementById('receipt-payment-ref').textContent = record.payment?.reference || record.orderId;

    const p = record.pricing || { subtotal: 0, discount: 0, tax: 0, total: 0 };
    document.getElementById('receipt-subtotal').textContent = `$${Number(p.subtotal).toLocaleString()} MXN`;
    document.getElementById('receipt-tax').textContent = `$${Number(p.tax).toLocaleString()} MXN`;
    document.getElementById('receipt-total').textContent = `$${Number(p.total).toLocaleString()} MXN`;

    const discRow = document.getElementById('receipt-discount-row');
    if (p.discount && p.discount > 0) {
        discRow.style.display = 'flex';
        document.getElementById('receipt-discount').textContent =
            `-$${Number(p.discount).toLocaleString()} MXN${p.coupon ? ` (${p.coupon.code})` : ''}`;
    } else {
        discRow.style.display = 'none';
    }
}

function escapeHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
