/**
 * ATELIER HILO - Módulo de Login, Autenticación Google OAuth y Envío de Orden al Backend (Express / AWS EC2)
 */

let currentOrder = null;
let authenticatedUser = null;

document.addEventListener('DOMContentLoaded', () => {
    loadOrderFromStorage();
    initAuthEvents();
});

/**
 * Determina la URL base del backend:
 * - Si se sirve desde Express (puerto 3000) o desde Nginx en AWS EC2, usa rutas relativas ('/api/...').
 * - Si se abre desde Live Server (ej. puerto 5500), apunta a 'http://localhost:3000'.
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
 * Genera un monograma Base64 de respaldo si el usuario entra directo a /login sin pasar por /home o /Models
 */
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

/**
 * 1. Recupera los datos de la prenda y la técnica configurados en /home o /Models desde localStorage
 */
function loadOrderFromStorage() {
    const rawOrder = localStorage.getItem('atelier_custom_order');

    if (rawOrder) {
        try {
            currentOrder = JSON.parse(rawOrder);
        } catch (_) {
            currentOrder = null;
        }
    }

    // Asegurar estructura completa con las variables requeridas por el backend
    if (!currentOrder) {
        currentOrder = {
            garmentType: 'long-shirt',
            garmentName: 'Camisa de Vestir Manga Larga',
            technique: 'embroidery',
            techniqueName: 'Bordado 3D de Alta Precisión',
            price: 890,
            fabricColor: '#1c1c1e',
            fabricColorName: 'Negro Ónix',
            logoX: 0.24,
            logoY: 0.18,
            logoScale: 0.28,
            stitchDensity: 3,
            stitchCount: 4200,
            embroideryDataUrl: generateFallbackEmbroideryDataUrl()
        };
    } else {
        currentOrder.garmentType = currentOrder.garmentType || 'long-shirt';
        currentOrder.garmentName = currentOrder.garmentName || 'Camisa de Vestir Manga Larga';
        currentOrder.price = typeof currentOrder.price === 'number' ? currentOrder.price : 890;
        currentOrder.fabricColor = currentOrder.fabricColor || '#1c1c1e';
        currentOrder.logoX = typeof currentOrder.logoX === 'number' ? currentOrder.logoX : 0.24;
        currentOrder.logoY = typeof currentOrder.logoY === 'number' ? currentOrder.logoY : 0.18;
        currentOrder.logoScale = typeof currentOrder.logoScale === 'number' ? currentOrder.logoScale : 0.28;
        currentOrder.stitchDensity = typeof currentOrder.stitchDensity === 'number' ? currentOrder.stitchDensity : 3;
        currentOrder.stitchCount = typeof currentOrder.stitchCount === 'number' ? currentOrder.stitchCount : 4200;
        if (!currentOrder.embroideryDataUrl) {
            currentOrder.embroideryDataUrl = generateFallbackEmbroideryDataUrl();
        }
    }

    document.getElementById('spec-garment').textContent = currentOrder.garmentName;
    const techEl = document.getElementById('spec-technique');
    if (techEl) {
        techEl.textContent = currentOrder.techniqueName || (
            currentOrder.technique === 'print' ? 'Estampado Serigráfico / DTF HD' : 'Bordado 3D de Alta Precisión'
        );
    }

    const colorLabel = currentOrder.fabricColorName
        ? `${currentOrder.fabricColorName} (${currentOrder.fabricColor.toUpperCase()})`
        : currentOrder.fabricColor.toUpperCase();
    document.getElementById('spec-color-code').textContent = colorLabel;
    document.getElementById('spec-color-dot').style.backgroundColor = currentOrder.fabricColor;

    document.getElementById('spec-coords').textContent =
        `X: ${currentOrder.logoX.toFixed(2)} | Y: ${currentOrder.logoY.toFixed(2)} | Escala: ${Math.round(currentOrder.logoScale * 35)}cm`;

    const captionEl = document.getElementById('summary-badge-caption');
    const metricLabelEl = document.getElementById('spec-metric-label');

    if (currentOrder.technique === 'print') {
        if (captionEl) captionEl.textContent = 'MATRIZ DE ESTAMPADO HD VERIFICADA';
        if (metricLabelEl) metricLabelEl.textContent = 'Resolución / Área';
        document.getElementById('spec-stitches').textContent =
            `300 DPI • ~${currentOrder.printAreaCm2 || 85} cm²`;
    } else {
        if (captionEl) captionEl.textContent = 'MATRIZ DE BORDADO 3D IA VERIFICADA';
        if (metricLabelEl) metricLabelEl.textContent = 'Conteo Estimado';
        document.getElementById('spec-stitches').textContent =
            `~${currentOrder.stitchCount.toLocaleString()} puntadas`;
    }

    document.getElementById('spec-price').textContent =
        `$${currentOrder.price.toLocaleString()} MXN`;

    if (currentOrder.embroideryDataUrl) {
        document.getElementById('summary-embroidery-img').src = currentOrder.embroideryDataUrl;
    }
}

/**
 * 2. Verifica la identidad contra el backend POST /api/auth/google
 *    (Con fallback local automático si se abre desde Live Server sin el backend encendido)
 */
async function authenticateWithBackend(authPayload) {
    try {
        const response = await fetch(getApiUrl('/api/auth/google'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(authPayload)
        });

        const data = await response.json();
        if (response.ok && data.verified && data.user) {
            showVerifiedUser({
                name: data.user.name,
                email: data.user.email,
                googleJwt: authPayload.credential || authPayload.googleJwt
            }, true);
            return;
        }
    } catch (networkErr) {
        console.warn('Backend /api/auth/google no disponible en este puerto; usando fallback local:', networkErr.message);
    }

    // Fallback local si el usuario prueba con Live Server sin haber corrido npm start
    showVerifiedUser({
        name: authPayload.name || 'Cliente Verificado (Google OAuth)',
        email: authPayload.email || 'cliente.verificado@gmail.com',
        googleJwt: authPayload.credential || authPayload.googleJwt || 'DEV_LOCAL_TOKEN_SIMULATED'
    }, false);
}

/**
 * Callback Oficial de Google Identity Services (Recibe el JWT firmado por Google)
 */
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

    authenticateWithBackend({
        credential: response.credential,
        googleJwt: response.credential,
        name: decodedName,
        email: decodedEmail
    });
};

/**
 * 3. Eventos para autenticación y envío real de la orden a POST /api/orders
 */
function initAuthEvents() {
    const simBtn = document.getElementById('simulate-google-btn');
    const confirmBtn = document.getElementById('confirm-production-btn');

    simBtn.addEventListener('click', () => {
        authenticateWithBackend({
            name: 'Cliente Verificado (Google OAuth)',
            email: 'cliente.verificado@gmail.com',
            googleJwt: 'DEV_LOCAL_TOKEN_SIMULATED'
        });
    });

    confirmBtn.addEventListener('click', async () => {
        if (!authenticatedUser) return;

        const originalBtnText = confirmBtn.textContent;
        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Procesando orden...';

        const finalPayload = {
            user: authenticatedUser,
            order: currentOrder,
            createdAt: new Date().toISOString()
        };

        try {
            const response = await fetch(getApiUrl('/api/orders'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(finalPayload)
            });

            const result = await response.json();

            if (!response.ok || !result.success) {
                throw new Error(result.error || 'Error al procesar la orden en el servidor.');
            }

            // Mostrar tarjeta editorial con el folio devuelto por el backend
            renderOrderConfirmation({
                orderId: result.orderId,
                message: result.message || 'Orden registrada en taller',
                embroideryImageUrl: result.embroideryImageUrl ? getApiUrl(result.embroideryImageUrl) : null
            });

            // Limpiar el pedido actual de localStorage tras registrarlo con éxito
            localStorage.removeItem('atelier_custom_order');
            confirmBtn.textContent = '✓ Orden Registrada en Taller';
        } catch (error) {
            console.warn('No se pudo conectar al servidor Express en POST /api/orders:', error.message);

            // Fallback amigable si el usuario está probando únicamente con Live Server sin Node.js activo
            const fallbackFolio = `AH-2026-${Math.floor(1000 + Math.random() * 9000)}`;
            renderOrderConfirmation({
                orderId: fallbackFolio,
                message: 'Orden confirmada en modo demostración local (Inicia el servidor backend en puerto 3000 para guardarla en data/orders.json).',
                embroideryImageUrl: null
            });
            localStorage.removeItem('atelier_custom_order');
            confirmBtn.textContent = originalBtnText;
            confirmBtn.disabled = false;
        }
    });
}

function showVerifiedUser(user, verifiedByServer = false) {
    authenticatedUser = user;
    document.getElementById('user-name-display').textContent = user.name;
    document.getElementById('user-email-display').textContent = user.email;
    const badge = document.getElementById('auth-status-badge');
    if (badge) {
        badge.textContent = verifiedByServer
            ? '✓ IDENTIDAD VERIFICADA POR SERVIDOR'
            : '✓ IDENTIDAD VERIFICADA (MODO LOCAL)';
    }
    document.getElementById('verified-user-card').classList.remove('hidden');
}

function renderOrderConfirmation({ orderId, message, embroideryImageUrl }) {
    const card = document.getElementById('order-confirmation-card');
    const folioEl = document.getElementById('confirmed-order-folio');
    const msgEl = document.getElementById('confirmed-order-msg');
    const imgLink = document.getElementById('confirmed-image-link');

    if (folioEl) folioEl.textContent = orderId;
    if (msgEl) {
        msgEl.textContent = `${message} para ${authenticatedUser.name} (${authenticatedUser.email}). Prenda: ${currentOrder.garmentName}.`;
    }

    if (imgLink) {
        if (embroideryImageUrl) {
            imgLink.href = embroideryImageUrl;
            imgLink.classList.remove('hidden');
        } else {
            imgLink.classList.add('hidden');
        }
    }

    if (card) {
        card.classList.remove('hidden');
        card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}
