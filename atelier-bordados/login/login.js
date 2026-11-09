/**
 * ATELIER HILO - Módulo de Login y Recuperación de Estado (localStorage + Google OAuth)
 */

let currentOrder = null;
let authenticatedUser = null;

document.addEventListener('DOMContentLoaded', () => {
    loadOrderFromStorage();
    initAuthEvents();
});

/**
 * 1. Recupera los datos de la prenda y la técnica (Bordado 3D o Estampado HD) configurados en /home y /Models
 */
function loadOrderFromStorage() {
    const rawOrder = localStorage.getItem('atelier_custom_order');
    if (!rawOrder) return;

    currentOrder = JSON.parse(rawOrder);

    document.getElementById('spec-garment').textContent = currentOrder.garmentName || 'Camisa Manga Larga Oxford';
    document.getElementById('spec-technique').textContent = currentOrder.techniqueName || (
        currentOrder.technique === 'print' ? 'Estampado Serigráfico / DTF HD' : 'Bordado 3D de Alta Precisión'
    );

    const colorLabel = currentOrder.fabricColorName
        ? `${currentOrder.fabricColorName} (${currentOrder.fabricColor.toUpperCase()})`
        : currentOrder.fabricColor.toUpperCase();
    document.getElementById('spec-color-code').textContent = colorLabel;
    document.getElementById('spec-color-dot').style.backgroundColor = currentOrder.fabricColor || '#1c1c1e';

    const lx = typeof currentOrder.logoX === 'number' ? currentOrder.logoX : 0.22;
    const ly = typeof currentOrder.logoY === 'number' ? currentOrder.logoY : 0.20;
    const lScale = typeof currentOrder.logoScale === 'number' ? currentOrder.logoScale : 0.28;

    document.getElementById('spec-coords').textContent =
        `X: ${lx.toFixed(2)} | Y: ${ly.toFixed(2)} | Tamaño: ${Math.round(lScale * 35)}cm`;

    if (currentOrder.technique === 'print') {
        document.getElementById('summary-badge-caption').textContent = 'MATRIZ DE ESTAMPADO HD VERIFICADA';
        document.getElementById('spec-metric-label').textContent = 'Resolución / Área';
        document.getElementById('spec-stitches').textContent =
            `300 DPI • ~${currentOrder.printAreaCm2 || 85} cm²`;
    } else {
        document.getElementById('summary-badge-caption').textContent = 'MATRIZ DE BORDADO 3D IA VERIFICADA';
        document.getElementById('spec-metric-label').textContent = 'Conteo Estimado';
        document.getElementById('spec-stitches').textContent =
            `~${(currentOrder.stitchCount || 4200).toLocaleString()} puntadas`;
    }

    document.getElementById('spec-price').textContent =
        `$${(currentOrder.price || 890).toLocaleString()} MXN`;

    if (currentOrder.embroideryDataUrl) {
        document.getElementById('summary-embroidery-img').src = currentOrder.embroideryDataUrl;
    }
}

/**
 * 2. Callback Oficial de Google Identity Services (Recibe el JWT firmado por Google)
 */
window.handleGoogleCredentialResponse = function (response) {
    const base64Url = response.credential.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(window.atob(base64));

    showVerifiedUser({
        name: payload.name,
        email: payload.email,
        googleJwt: response.credential
    });
};

/**
 * 3. Eventos para modo de prueba local en VS Code y envío de orden
 */
function initAuthEvents() {
    document.getElementById('simulate-google-btn').addEventListener('click', () => {
        showVerifiedUser({
            name: 'Cliente Verificado (Google OAuth)',
            email: 'cliente.verificado@gmail.com',
            googleJwt: 'DEV_LOCAL_TOKEN_SIMULATED'
        });
    });

    document.getElementById('confirm-production-btn').addEventListener('click', async () => {
        const finalPayload = {
            user: authenticatedUser,
            order: currentOrder,
            createdAt: new Date().toISOString()
        };

        console.log('Payload listo para enviar a AWS EC2:', finalPayload);
        const techText = currentOrder && currentOrder.technique === 'print' ? 'Estampado HD' : 'Bordado 3D';
        alert(`¡Pedido confirmado para ${authenticatedUser.name}!\n\nPrenda: ${currentOrder ? currentOrder.garmentName : 'Personalizada'}\nTécnica: ${techText}\nRevisa la consola (F12) para ver el JSON que recibirá tu servidor en AWS EC2.`);
    });
}

function showVerifiedUser(user) {
    authenticatedUser = user;
    document.getElementById('user-name-display').textContent = user.name;
    document.getElementById('user-email-display').textContent = user.email;
    document.getElementById('verified-user-card').classList.remove('hidden');
}
