/**
 * ATELIER HILO / ÉXODO BORDADOS — Backend API (Node.js + Express)
 * Preparado para desarrollo local y producción en AWS EC2 (Ubuntu + Nginx + PM2)
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { OAuth2Client } = require('google-auth-library');

const app = express();
const PORT = process.env.PORT || 3000;
const APP_URL = (process.env.APP_URL || `http://localhost:${PORT}`).replace(/\/+$/, '');
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'TU_GOOGLE_CLIENT_ID.apps.googleusercontent.com';
const AUTH_SECRET = process.env.AUTH_SECRET || 'atelier_hilo_dev_secret_cambia_en_produccion';
const TAX_RATE = Number.isFinite(Number(process.env.TAX_RATE)) ? Number(process.env.TAX_RATE) : 0.16;

const VALID_ROLES = ['Administrador', 'Diseñador', 'Producción', 'Ventas', 'Cliente'];
const VALID_PAYMENT_METHODS = ['card', 'transfer', 'paypal', 'branch'];

const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

// Rutas de almacenamiento persistente en disco
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const DATA_DIR = path.join(__dirname, 'data');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const COUPONS_FILE = path.join(DATA_DIR, 'coupons.json');

const DEFAULT_COUPONS = [
    {
        code: 'EXODO10',
        type: 'percentage',
        value: 10,
        minSubtotal: 0,
        active: true,
        expiresAt: '2027-12-31T23:59:59.000Z',
        description: '10% de descuento en tu pedido personalizado'
    },
    {
        code: 'ATELIER150',
        type: 'fixed',
        value: 150,
        minSubtotal: 600,
        active: true,
        expiresAt: '2027-12-31T23:59:59.000Z',
        description: '$150 MXN de descuento en compras desde $600 MXN'
    },
    {
        code: 'MAYOREO20',
        type: 'percentage',
        value: 20,
        minSubtotal: 2000,
        active: true,
        expiresAt: '2027-12-31T23:59:59.000Z',
        description: '20% de descuento en pedidos de mayoreo desde $2,000 MXN'
    },
    {
        code: 'EXPIRADO50',
        type: 'percentage',
        value: 50,
        minSubtotal: 0,
        active: true,
        expiresAt: '2025-01-01T00:00:00.000Z',
        description: 'Cupón de prueba vencido'
    }
];

// Asegurar que las carpetas uploads/ y data/ y sus JSON existan al arrancar
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(ORDERS_FILE)) {
    fs.writeFileSync(ORDERS_FILE, JSON.stringify([], null, 2), 'utf8');
}
if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, JSON.stringify([], null, 2), 'utf8');
}
if (!fs.existsSync(COUPONS_FILE)) {
    fs.writeFileSync(COUPONS_FILE, JSON.stringify(DEFAULT_COUPONS, null, 2), 'utf8');
}

// Utilidades de lectura/escritura JSON y criptografía (sin dependencias extra)
function readJsonArray(filePath, fallback = []) {
    try {
        if (!fs.existsSync(filePath)) return fallback;
        const raw = fs.readFileSync(filePath, 'utf8');
        return raw.trim() ? JSON.parse(raw) : fallback;
    } catch (err) {
        console.error(`Error leyendo ${filePath}:`, err.message);
        return fallback;
    }
}

function writeJsonArray(filePath, data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
    const derivedKey = crypto.scryptSync(password, salt, 64).toString('hex');
    return `${salt}:${derivedKey}`;
}

function verifyPassword(password, storedHash) {
    if (!storedHash || !storedHash.includes(':')) return false;
    const [salt, originalHex] = storedHash.split(':');
    const derivedBuf = crypto.scryptSync(password, salt, 64);
    const originalBuf = Buffer.from(originalHex, 'hex');
    if (derivedBuf.length !== originalBuf.length) return false;
    return crypto.timingSafeEqual(derivedBuf, originalBuf);
}

function createSessionToken(user) {
    const payload = {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        iat: Date.now()
    };
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = crypto
        .createHmac('sha256', AUTH_SECRET)
        .update(encoded)
        .digest('base64url');
    return `${encoded}.${signature}`;
}

function verifySessionToken(token) {
    if (!token || !token.includes('.')) return null;
    const [encoded, signature] = token.split('.');
    const expectedSig = crypto
        .createHmac('sha256', AUTH_SECRET)
        .update(encoded)
        .digest('base64url');
    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
        return null;
    }
    try {
        return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    } catch (_) {
        return null;
    }
}

function sanitizeUser(user) {
    return {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role || 'Cliente',
        authProvider: user.authProvider || 'local',
        billing: user.billing || null,
        createdAt: user.createdAt
    };
}

function normalizeBilling(billing) {
    if (!billing || typeof billing !== 'object') return null;
    const cleaned = {
        razonSocial: String(billing.razonSocial || '').trim(),
        rfc: String(billing.rfc || '').trim().toUpperCase(),
        billingEmail: String(billing.billingEmail || '').trim(),
        fiscalAddress: String(billing.fiscalAddress || '').trim(),
        postalCode: String(billing.postalCode || '').trim()
    };
    const hasAnyValue = Object.values(cleaned).some(Boolean);
    return hasAnyValue ? cleaned : null;
}

function evaluateCoupon(codeInput, subtotal) {
    const normalizedCode = String(codeInput || '').trim().toUpperCase();
    if (!normalizedCode) {
        return { valid: false, status: 400, error: 'Ingresa un código de cupón.' };
    }
    const coupons = readJsonArray(COUPONS_FILE, DEFAULT_COUPONS);
    const coupon = coupons.find(c => String(c.code).toUpperCase() === normalizedCode);

    if (!coupon) {
        return { valid: false, status: 404, error: `El cupón "${normalizedCode}" no existe.` };
    }
    if (!coupon.active) {
        return { valid: false, status: 400, error: `El cupón "${normalizedCode}" está inactivo.` };
    }
    if (coupon.expiresAt && new Date(coupon.expiresAt).getTime() < Date.now()) {
        return { valid: false, status: 400, error: `El cupón "${normalizedCode}" ha expirado.` };
    }
    const numericSubtotal = Number(subtotal) || 0;
    if (coupon.minSubtotal && numericSubtotal < coupon.minSubtotal) {
        return {
            valid: false,
            status: 400,
            error: `El cupón "${normalizedCode}" requiere un subtotal mínimo de $${coupon.minSubtotal.toLocaleString()} MXN.`
        };
    }

    let discountAmount = 0;
    if (coupon.type === 'percentage') {
        discountAmount = Math.round((numericSubtotal * (Number(coupon.value) / 100)) * 100) / 100;
    } else {
        discountAmount = Math.min(numericSubtotal, Number(coupon.value) || 0);
    }

    return {
        valid: true,
        status: 200,
        coupon: {
            code: coupon.code,
            type: coupon.type,
            value: coupon.value,
            description: coupon.description,
            expiresAt: coupon.expiresAt
        },
        discountAmount
    };
}

function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
    const decoded = verifySessionToken(token);
    if (!decoded) {
        return res.status(401).json({
            success: false,
            error: 'Sesión no válida o expirada. Inicia sesión nuevamente.'
        });
    }
    req.authUser = decoded;
    next();
}

function requireRole(allowedRoles) {
    return (req, res, next) => {
        if (!req.authUser || !allowedRoles.includes(req.authUser.role)) {
            return res.status(403).json({
                success: false,
                error: 'No tienes permisos suficientes para esta operación.'
            });
        }
        next();
    };
}

// Middlewares globales
app.use(cors());
// Límite de 15MB crítico para recibir embroideryDataUrl en Base64 sin error 413
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// Servir archivos estáticos del frontend para pruebas unificadas en http://localhost:3000
app.use('/home', express.static(path.join(__dirname, '../home')));
app.use('/login', express.static(path.join(__dirname, '../login')));
app.use('/Models', express.static(path.join(__dirname, '../Models')));
app.use('/footer', express.static(path.join(__dirname, '../footer')));
app.use('/assets', express.static(path.join(__dirname, '../assets')));
app.use('/api/uploads', express.static(UPLOADS_DIR));

// Redirección raíz hacia /home/index.html
app.get('/', (req, res) => {
    res.redirect('/home/index.html');
});

// ============================================================================
// SECCIÓN SUPERIOR API: SALUD, CONFIG, AUTH/ROLES, USUARIOS, CUPONES, ÓRDENES Y PAGOS
// (Mantener rutas administrativas únicamente en la sección inferior antes de app.listen)
// ============================================================================

/**
 * 1. ENDPOINT DE SALUD DEL SERVIDOR (Healthcheck para AWS EC2 / Nginx)
 */
app.get('/api/health', (req, res) => {
    res.status(200).json({
        status: 'ok',
        appUrl: APP_URL,
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development'
    });
});

/**
 * 1B. CONFIGURACIÓN PÚBLICA (Permite sincronizar APP_URL, GOOGLE_CLIENT_ID e IVA en dev/prod)
 */
app.get('/api/config/public', (req, res) => {
    const isGoogleConfigured =
        Boolean(GOOGLE_CLIENT_ID) &&
        GOOGLE_CLIENT_ID !== 'TU_GOOGLE_CLIENT_ID.apps.googleusercontent.com';

    res.status(200).json({
        appUrl: APP_URL,
        googleClientId: isGoogleConfigured ? GOOGLE_CLIENT_ID : null,
        taxRate: TAX_RATE,
        roles: VALID_ROLES
    });
});

/**
 * 2A. REGISTRO DE CLIENTES / USUARIOS CON CORREO, CONTRASEÑA, ROL Y FACTURACIÓN (RF-03 / RF-15)
 */
app.post('/api/auth/register', (req, res) => {
    try {
        const { name, email, password, role, billing } = req.body || {};

        if (!name || !email || !password) {
            return res.status(400).json({
                success: false,
                error: 'Nombre, correo electrónico y contraseña son obligatorio.'
            });
        }

        const normalizedEmail = String(email).trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
            return res.status(400).json({
                success: false,
                error: 'El formato del correo electrónico no es válido.'
            });
        }

        if (String(password).length < 6) {
            return res.status(400).json({
                success: false,
                error: 'La contraseña debe tener al menos 6 caracteres.'
            });
        }

        const assignedRole = VALID_ROLES.includes(role) ? role : 'Cliente';
        const users = readJsonArray(USERS_FILE, []);
        const existing = users.find(u => u.email === normalizedEmail);

        if (existing) {
            return res.status(400).json({
                success: false,
                error: 'Ya existe una cuenta registrada con ese correo electrónico.'
            });
        }

        const newUser = {
            id: `USR-${Date.now().toString(36).toUpperCase()}`,
            name: String(name).trim(),
            email: normalizedEmail,
            passwordHash: hashPassword(String(password)),
            role: assignedRole,
            authProvider: 'local',
            billing: normalizeBilling(billing),
            createdAt: new Date().toISOString()
        };

        users.push(newUser);
        writeJsonArray(USERS_FILE, users);

        const safeUser = sanitizeUser(newUser);
        const token = createSessionToken(safeUser);

        return res.status(201).json({
            success: true,
            verified: true,
            token,
            user: safeUser
        });
    } catch (error) {
        console.error('Error en /api/auth/register:', error);
        return res.status(500).json({
            success: false,
            error: 'Error interno al registrar el usuario.'
        });
    }
});

/**
 * 2B. INICIO DE SESIÓN CON CORREO Y CONTRASEÑA (RF-03 / RF-15)
 */
app.post('/api/auth/login', (req, res) => {
    try {
        const { email, password } = req.body || {};

        if (!email || !password) {
            return res.status(400).json({
                success: false,
                error: 'Ingresa correo electrónico y contraseña.'
            });
        }

        const normalizedEmail = String(email).trim().toLowerCase();
        const users = readJsonArray(USERS_FILE, []);
        const user = users.find(u => u.email === normalizedEmail);

        if (!user || !verifyPassword(String(password), user.passwordHash)) {
            return res.status(401).json({
                success: false,
                error: 'Correo o contraseña incorrectos.'
            });
        }

        const safeUser = sanitizeUser(user);
        const token = createSessionToken(safeUser);

        return res.status(200).json({
            success: true,
            verified: true,
            token,
            user: safeUser
        });
    } catch (error) {
        console.error('Error en /api/auth/login:', error);
        return res.status(500).json({
            success: false,
            error: 'Error interno al iniciar sesión.'
        });
    }
});

/**
 * 2C. AUTENTICACIÓN CON GOOGLE (OAuth 2.0 / Modo Demo Local + Sincronización de Rol y Facturación)
 */
app.post('/api/auth/google', async (req, res) => {
    try {
        const { credential, googleJwt, name, email, role, billing } = req.body || {};
        const token = credential || googleJwt;

        if (!token) {
            return res.status(400).json({
                verified: false,
                error: 'No se recibió el token de autenticación (credential / googleJwt).'
            });
        }

        const isPlaceholderClientId =
            !GOOGLE_CLIENT_ID ||
            GOOGLE_CLIENT_ID === 'TU_GOOGLE_CLIENT_ID.apps.googleusercontent.com';

        let resolvedName = name || 'Cliente Verificado (Google OAuth)';
        let resolvedEmail = (email || 'cliente.verificado@gmail.com').trim().toLowerCase();
        let mode = 'demo_or_unconfigured_client';
        let picture = null;
        let sub = null;

        if (token === 'DEV_LOCAL_TOKEN_SIMULATED' || isPlaceholderClientId) {
            if (token !== 'DEV_LOCAL_TOKEN_SIMULATED' && token.split('.').length === 3) {
                try {
                    const payloadJson = Buffer.from(token.split('.')[1], 'base64url').toString('utf8');
                    const decoded = JSON.parse(payloadJson);
                    resolvedName = decoded.name || resolvedName;
                    resolvedEmail = (decoded.email || resolvedEmail).trim().toLowerCase();
                } catch (_) {}
            }
        } else {
            const ticket = await googleClient.verifyIdToken({
                idToken: token,
                audience: GOOGLE_CLIENT_ID
            });
            const payload = ticket.getPayload();
            resolvedName = payload.name || resolvedName;
            resolvedEmail = (payload.email || resolvedEmail).trim().toLowerCase();
            picture = payload.picture || null;
            sub = payload.sub || null;
            mode = 'google_verified';
        }

        // Sincronizar o crear usuario en users.json para persistir rol y datos fiscales
        const users = readJsonArray(USERS_FILE, []);
        let existingUser = users.find(u => u.email === resolvedEmail);
        const requestedRole = VALID_ROLES.includes(role) ? role : null;
        const normalizedBilling = normalizeBilling(billing);

        if (!existingUser) {
            existingUser = {
                id: `USR-${Date.now().toString(36).toUpperCase()}`,
                name: resolvedName,
                email: resolvedEmail,
                passwordHash: null,
                role: requestedRole || 'Cliente',
                authProvider: 'google',
                billing: normalizedBilling,
                createdAt: new Date().toISOString()
            };
            users.push(existingUser);
            writeJsonArray(USERS_FILE, users);
        } else {
            let changed = false;
            if (requestedRole && existingUser.role !== requestedRole) {
                existingUser.role = requestedRole;
                changed = true;
            }
            if (normalizedBilling) {
                existingUser.billing = normalizedBilling;
                changed = true;
            }
            if (changed) writeJsonArray(USERS_FILE, users);
        }

        const safeUser = {
            ...sanitizeUser(existingUser),
            picture,
            sub
        };
        const sessionToken = createSessionToken(safeUser);

        return res.status(200).json({
            verified: true,
            mode,
            token: sessionToken,
            user: safeUser
        });
    } catch (error) {
        console.error('Error al verificar token de Google:', error.message);
        return res.status(401).json({
            verified: false,
            error: 'Token de Google inválido o expirado.',
            details: error.message
        });
    }
});

/**
 * 2D. PERFIL DEL USUARIO AUTENTICADO: CONSULTA Y ACTUALIZACIÓN DE FACTURACIÓN / ROL (RF-03 / RF-15)
 */
app.get('/api/users/me', requireAuth, (req, res) => {
    const users = readJsonArray(USERS_FILE, []);
    const user = users.find(u => u.email === req.authUser.email);
    if (!user) {
        return res.status(404).json({ success: false, error: 'Usuario no encontrado.' });
    }
    return res.status(200).json({ success: true, user: sanitizeUser(user) });
});

app.put('/api/users/me', requireAuth, (req, res) => {
    try {
        const { name, role, billing } = req.body || {};
        const users = readJsonArray(USERS_FILE, []);
        const userIndex = users.findIndex(u => u.email === req.authUser.email);

        if (userIndex === -1) {
            return res.status(404).json({ success: false, error: 'Usuario no encontrado.' });
        }

        if (name && String(name).trim()) {
            users[userIndex].name = String(name).trim();
        }
        if (role && VALID_ROLES.includes(role)) {
            users[userIndex].role = role;
        }
        if (billing !== undefined) {
            users[userIndex].billing = normalizeBilling(billing);
        }

        writeJsonArray(USERS_FILE, users);
        const safeUser = sanitizeUser(users[userIndex]);
        const refreshedToken = createSessionToken(safeUser);

        return res.status(200).json({
            success: true,
            token: refreshedToken,
            user: safeUser
        });
    } catch (error) {
        console.error('Error actualizando perfil:', error);
        return res.status(500).json({ success: false, error: 'No se pudo actualizar el perfil.' });
    }
});

/**
 * 3. VALIDACIÓN DE CUPONES DE DESCUENTO (RF-13)
 */
app.post('/api/coupons/validate', (req, res) => {
    const { code, subtotal } = req.body || {};
    const evaluation = evaluateCoupon(code, subtotal);

    if (!evaluation.valid) {
        return res.status(evaluation.status).json({
            valid: false,
            error: evaluation.error
        });
    }

    return res.status(200).json({
        valid: true,
        coupon: evaluation.coupon,
        discountAmount: evaluation.discountAmount,
        message: `Cupón ${evaluation.coupon.code} aplicado: ${evaluation.coupon.description}`
    });
});

/**
 * 4. REGISTRO DE PEDIDOS (CARRITO MÚLTIPLE O PRENDA INDIVIDUAL) + PAGOS + FACTURACIÓN + NOTIFICACIÓN (RF-06, RF-08, RF-12, RF-13, RF-16)
 */
app.post('/api/orders', (req, res) => {
    try {
        const { user, items, order, billing, payment, couponCode, createdAt } = req.body || {};

        if (!user || !user.name || !user.email) {
            return res.status(400).json({
                success: false,
                error: 'Faltan los datos del usuario autenticado (user.name, user.email).'
            });
        }

        // Normalizar artículos: soporta arreglo `items` (RF-06) o `order` individual heredado
        const rawItems = Array.isArray(items) && items.length > 0
            ? items
            : (order ? [order] : []);

        if (rawItems.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'El carrito está vacío. Agrega al menos un artículo para confirmar la orden.'
            });
        }

        // Validar método de pago si se envió
        const paymentMethod = (payment && payment.method) ? String(payment.method) : 'branch';
        if (!VALID_PAYMENT_METHODS.includes(paymentMethod)) {
            return res.status(400).json({
                success: false,
                error: `Método de pago no soportado: ${paymentMethod}.`
            });
        }

        // Generar folio único de orden: AH-2026-XXXX
        const existingOrders = readJsonArray(ORDERS_FILE, []);
        let folio = '';
        do {
            const randomDigits = Math.floor(1000 + Math.random() * 9000);
            folio = `AH-2026-${randomDigits}`;
        } while (existingOrders.some(o => o.orderId === folio));

        // Procesar cada artículo del carrito y guardar su archivo PNG en uploads/
        const processedItems = [];
        let subtotal = 0;

        for (let idx = 0; idx < rawItems.length; idx++) {
            const item = rawItems[idx];

            if (!item || !item.garmentType || !item.garmentName || typeof item.price === 'undefined' || !item.fabricColor) {
                return res.status(400).json({
                    success: false,
                    error: `Faltan datos obligatorios en el artículo #${idx + 1} del carrito.`
                });
            }

            const quantity = Math.max(1, parseInt(item.quantity, 10) || 1);
            const unitPrice = Number(item.unitPrice !== undefined ? item.unitPrice : item.price);
            if (Number.isNaN(unitPrice) || unitPrice < 0) {
                return res.status(400).json({
                    success: false,
                    error: `El precio del artículo #${idx + 1} no es válido.`
                });
            }

            let savedImageRelativeUrl = null;
            if (item.embroideryDataUrl && typeof item.embroideryDataUrl === 'string') {
                const base64Match = item.embroideryDataUrl.match(/^data:image\/([a-zA-Z0-9+]+);base64,(.+)$/);
                if (base64Match && base64Match[2]) {
                    const imageBuffer = Buffer.from(base64Match[2], 'base64');
                    const suffix = rawItems.length === 1 ? '' : `-${idx + 1}`;
                    const fileName = `${folio}${suffix}.png`;
                    const filePath = path.join(UPLOADS_DIR, fileName);
                    fs.writeFileSync(filePath, imageBuffer);
                    savedImageRelativeUrl = `/api/uploads/${fileName}`;
                }
            }

            const lineTotal = Math.round(unitPrice * quantity * 100) / 100;
            subtotal += lineTotal;

            processedItems.push({
                itemIndex: idx + 1,
                garmentType: item.garmentType,
                garmentName: item.garmentName,
                technique: item.technique || 'embroidery',
                techniqueName: item.techniqueName || 'Bordado 3D de Alta Precisión',
                unitPrice,
                quantity,
                lineTotal,
                fabricColor: item.fabricColor,
                fabricColorName: item.fabricColorName || null,
                logoX: Number(item.logoX ?? 0.22),
                logoY: Number(item.logoY ?? 0.20),
                logoScale: Number(item.logoScale ?? 0.26),
                stitchDensity: Number(item.stitchDensity ?? 3),
                stitchCount: Number(item.stitchCount ?? 4200),
                printAreaCm2: item.printAreaCm2 ? Number(item.printAreaCm2) : null,
                embroideryImageUrl: savedImageRelativeUrl
            });
        }

        // Revalidar cupón en el servidor para garantizar integridad de totales
        let appliedCoupon = null;
        let discount = 0;
        if (couponCode) {
            const couponResult = evaluateCoupon(couponCode, subtotal);
            if (!couponResult.valid) {
                return res.status(couponResult.status).json({
                    success: false,
                    error: couponResult.error
                });
            }
            appliedCoupon = couponResult.coupon;
            discount = couponResult.discountAmount;
        }

        const taxableBase = Math.max(0, subtotal - discount);
        const tax = Math.round(taxableBase * TAX_RATE * 100) / 100;
        const total = Math.round((taxableBase + tax) * 100) / 100;

        // Sanitizar datos de pago (nunca almacenar números de tarjeta completos ni CVV)
        const paymentStatusMap = {
            card: 'PAGADO_SIMULADO',
            paypal: 'PAGADO_SIMULADO',
            transfer: 'PENDIENTE_COMPROBANTE_SPEI',
            branch: 'PENDIENTE_PAGO_SUCURSAL'
        };

        const sanitizedPayment = {
            method: paymentMethod,
            methodLabel: (payment && payment.methodLabel) ? String(payment.methodLabel) : paymentMethod,
            status: paymentStatusMap[paymentMethod],
            reference: (payment && payment.reference) ? String(payment.reference) : `REF-${folio}`,
            cardLast4: (paymentMethod === 'card' && payment && payment.cardLast4) ? String(payment.cardLast4).slice(-4) : null,
            cardHolder: (paymentMethod === 'card' && payment && payment.cardHolder) ? String(payment.cardHolder).trim() : null,
            paypalEmail: (paymentMethod === 'paypal' && payment && payment.paypalEmail) ? String(payment.paypalEmail).trim() : null
        };

        const normalizedBilling = normalizeBilling(billing);
        const orderTimestamp = createdAt || new Date().toISOString();

        const emailNotification = {
            simulated: true,
            to: user.email,
            billingCopyTo: normalizedBilling && normalizedBilling.billingEmail ? normalizedBilling.billingEmail : null,
            subject: `Confirmación de Pedido ${folio} — Atelier Hilo × Éxodo Bordados`,
            sentAt: new Date().toISOString(),
            preview: `Hola ${user.name}, recibimos tu orden ${folio} con ${processedItems.length} artículo(s) por un total de $${total.toLocaleString()} MXN.`
        };

        const orderRecord = {
            orderId: folio,
            createdAt: orderTimestamp,
            status: 'EN_COLA_DE_TALLER',
            user: {
                name: user.name,
                email: user.email,
                role: VALID_ROLES.includes(user.role) ? user.role : 'Cliente'
            },
            billing: normalizedBilling,
            items: processedItems,
            // Campo `order` conservado por compatibilidad con consumidores previos
            order: processedItems[0],
            pricing: {
                subtotal,
                discount,
                taxRate: TAX_RATE,
                tax,
                total,
                currency: 'MXN',
                coupon: appliedCoupon
            },
            payment: sanitizedPayment,
            emailNotification
        };

        existingOrders.push(orderRecord);
        writeJsonArray(ORDERS_FILE, existingOrders);

        return res.status(201).json({
            success: true,
            orderId: folio,
            embroideryImageUrl: processedItems[0].embroideryImageUrl,
            orderRecord,
            emailNotification,
            message: 'Orden registrada en taller'
        });
    } catch (error) {
        console.error('Error al registrar la orden:', error);
        return res.status(500).json({
            success: false,
            error: 'Error interno al guardar la orden en el servidor.',
            details: error.message
        });
    }
});

/**
 * 5. CONSULTA DE ÓRDENES (GET /api/orders y GET /api/orders/:orderId)
 */
app.get('/api/orders', (req, res) => {
    try {
        const orders = readJsonArray(ORDERS_FILE, []);
        const authHeader = req.headers.authorization || '';
        const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
        const decoded = verifySessionToken(token);

        // Si viene autenticado como Cliente, filtra solo sus órdenes; otros roles ven todas
        if (decoded && decoded.role === 'Cliente') {
            return res.status(200).json(orders.filter(o => o.user && o.user.email === decoded.email));
        }
        return res.status(200).json(orders);
    } catch (error) {
        console.error('Error al leer orders.json:', error);
        return res.status(500).json({
            success: false,
            error: 'No se pudo leer el historial de órdenes.'
        });
    }
});

// =========================================================================
// 5. ENDPOINTS DE ADMINISTRACIÓN, CATÁLOGO, INVENTARIO Y CUPONES (SEBASTIÁN)
// =========================================================================
const PRODUCTS_FILE = path.join(DATA_DIR, 'products.json');
const INVENTORY_FILE = path.join(DATA_DIR, 'inventory.json');
const QUOTES_FILE = path.join(DATA_DIR, 'quotes.json');

function initJsonFile(filePath, defaultData) {
    if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, JSON.stringify(defaultData, null, 2), 'utf8');
    }
}

initJsonFile(PRODUCTS_FILE, [
    { id: 'PRD-01', name: 'Camisa Manga Larga Oxford', category: 'Bordado en playeras', price: 890, description: 'Algodón Egipcio 100% con cuello estructurado.' },
    { id: 'PRD-02', name: 'Camisa Manga Corta', category: 'Bordado en playeras', price: 790, description: 'Popelina fina respirable de corte contemporáneo.' },
    { id: 'PRD-03', name: 'Playera Crewneck Heavyweight', category: 'Bordado en playeras', price: 520, description: 'Jersey peinado 280 GSM.' },
    { id: 'PRD-04', name: 'Playera Tipo Polo Piqué', category: 'Bordado en playeras', price: 650, description: 'Tejido piqué doble panal.' },
    { id: 'PRD-05', name: 'Hoodie Boxy 450 GSM', category: 'Bordado en playeras', price: 1150, description: 'Felpa francesa pesada.' },
    { id: 'PRD-06', name: 'Gorra Estructurada 6 Paneles', category: 'Bordado en gorras', price: 450, description: 'Sarga de algodón cepillado.' },
    { id: 'PRD-07', name: 'Gorro Beanie Fisherman', category: 'Bordado en gorras', price: 420, description: 'Tejido de punto acanalado.' },
    { id: 'PRD-08', name: 'Taza Cerámica Personalizada 11oz', category: 'Tazas personalizadas', price: 180, description: 'Sublimación HD resistente al microondas.' },
    { id: 'PRD-09', name: 'Vaso Térmico Acero 20oz', category: 'Vasos personalizados', price: 320, description: 'Grabado láser o impresión UV de alta durabilidad.' },
    { id: 'PRD-10', name: 'Tarjetas de Presentación (100 pzas)', category: 'Tarjetas de presentación', price: 290, description: 'Papel couché 350g con laminado mate.' },
    { id: 'PRD-11', name: 'Lona Publicitaria Front 13oz (m²)', category: 'Lonas publicitarias', price: 220, description: 'Impresión gran formato resistente a exterior.' },
    { id: 'PRD-12', name: 'Plumas y Artículos Promocionales (50 pzas)', category: 'Artículos promocionales', price: 650, description: 'Serigrafía a 1 tinta para eventos o empresas.' }
]);

initJsonFile(INVENTORY_FILE, [
    { id: 'INV-01', item: 'Playeras Lisas (Surtido Tallas)', stock: 140, minStock: 30, unit: 'pzas' },
    { id: 'INV-02', item: 'Gorras 6 Paneles Base', stock: 85, minStock: 20, unit: 'pzas' },
    { id: 'INV-03', item: 'Tazas Blancas Sublimables 11oz', stock: 200, minStock: 50, unit: 'pzas' },
    { id: 'INV-04', item: 'Vasos Térmicos 20oz', stock: 45, minStock: 15, unit: 'pzas' },
    { id: 'INV-05', item: 'Conos de Hilo Bordado Rayón', stock: 60, minStock: 15, unit: 'conos' },
    { id: 'INV-06', item: 'Rollo Lona Front 13oz', stock: 12, minStock: 3, unit: 'rollos' }
]);

initJsonFile(QUOTES_FILE, []);

// Servir carpeta /admin
app.use('/admin', express.static(path.join(__dirname, '../admin')));

// CRUD de Productos y Servicios
app.get('/api/products', (req, res) => res.json(readJsonArray(PRODUCTS_FILE, [])));

app.post('/api/products', (req, res) => {
    const products = readJsonArray(PRODUCTS_FILE, []);
    const { name, category, price, description, model3d } = req.body;
    if (!name || !category || !price) return res.status(400).json({ error: 'Faltan campos obligatorios' });
    const newProduct = {
        id: `PRD-${String(Date.now()).slice(-4)}`,
        name,
        category,
        price: Number(price),
        description: description || '',
        model3d: model3d || 'none'
    };
    products.push(newProduct);
    writeJsonArray(PRODUCTS_FILE, products);
    res.status(201).json(newProduct);
});

app.put('/api/products/:id', (req, res) => {
    const products = readJsonArray(PRODUCTS_FILE, []);
    const idx = products.findIndex(p => p.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Producto no encontrado' });
    products[idx] = { ...products[idx], ...req.body, price: Number(req.body.price ?? products[idx].price) };
    writeJsonArray(PRODUCTS_FILE, products);
    res.json(products[idx]);
});

app.delete('/api/products/:id', (req, res) => {
    const products = readJsonArray(PRODUCTS_FILE, []).filter(p => p.id !== req.params.id);
    writeJsonArray(PRODUCTS_FILE, products);
    res.json({ success: true });
});

// Seguimiento y actualización de estado de pedidos
app.get('/api/orders/:orderId', (req, res) => {
    try {
        const orders = readJsonArray(ORDERS_FILE, []);
        const found = orders.find(o => o.orderId.toUpperCase() === req.params.orderId.toUpperCase());
        if (!found) {
            return res.status(404).json({
                success: false,
                error: `Orden ${req.params.orderId} no encontrada.`
            });
        }
        return res.status(200).json({ success: true, order: found });
    } catch (error) {
        console.error('Error buscando orden:', error);
        return res.status(500).json({ success: false, error: 'Error al consultar la orden.' });
    }
});

app.patch('/api/orders/:folio/status', (req, res) => {
    const orders = readJsonArray(ORDERS_FILE, []);
    const idx = orders.findIndex(o => o.orderId === req.params.folio);
    if (idx === -1) return res.status(404).json({ error: 'Pedido no encontrado' });
    orders[idx].status = req.body.status;
    writeJsonArray(ORDERS_FILE, orders);
    res.json({ success: true, order: orders[idx] });
});

// Inventario
app.get('/api/inventory', (req, res) => res.json(readJsonArray(INVENTORY_FILE, [])));

app.patch('/api/inventory/:id', (req, res) => {
    const inv = readJsonArray(INVENTORY_FILE, []);
    const idx = inv.findIndex(i => i.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Insumo no encontrado' });
    inv[idx].stock = Number(req.body.stock);
    writeJsonArray(INVENTORY_FILE, inv);
    res.json(inv[idx]);
});

// Promociones y Cupones (compatible con el validador de checkout)
app.get('/api/coupons', (req, res) => {
    const coupons = readJsonArray(COUPONS_FILE, DEFAULT_COUPONS).map(c => ({
        ...c,
        discountPercent: c.discountPercent ?? (c.type === 'percentage' ? c.value : 0)
    }));
    res.json(coupons);
});

app.post('/api/coupons', (req, res) => {
    const coupons = readJsonArray(COUPONS_FILE, DEFAULT_COUPONS);
    const { code, discountPercent, description } = req.body;
    if (!code || !discountPercent) return res.status(400).json({ error: 'Código y porcentaje obligatorios' });
    const newCoupon = {
        code: String(code).toUpperCase().trim(),
        type: 'percentage',
        value: Number(discountPercent),
        discountPercent: Number(discountPercent),
        minSubtotal: 0,
        active: true,
        expiresAt: '2027-12-31T23:59:59.000Z',
        description: description || ''
    };
    coupons.push(newCoupon);
    writeJsonArray(COUPONS_FILE, coupons);
    res.status(201).json(newCoupon);
});

app.delete('/api/coupons/:code', (req, res) => {
    const coupons = readJsonArray(COUPONS_FILE, DEFAULT_COUPONS).filter(c => c.code !== req.params.code);
    writeJsonArray(COUPONS_FILE, coupons);
    res.json({ success: true });
});

// Solicitudes de Cotización Especial
app.get('/api/quotes', (req, res) => res.json(readJsonArray(QUOTES_FILE, [])));

app.post('/api/quotes', (req, res) => {
    const quotes = readJsonArray(QUOTES_FILE, []);
    const quoteId = `COT-2026-${Math.floor(1000 + Math.random() * 9000)}`;
    const newQuote = {
        quoteId,
        createdAt: new Date().toISOString(),
        status: 'Cotización',
        ...req.body
    };
    quotes.push(newQuote);
    writeJsonArray(QUOTES_FILE, quotes);
    res.status(201).json({ success: true, quoteId, quote: newQuote });
});

app.listen(PORT, () => {
    console.log(`==================================================================`);
    console.log(`  ATELIER HILO / ÉXODO BORDADOS — Backend Activo en Puerto ${PORT}`);
    console.log(`  App URL:         ${APP_URL}`);
    console.log(`  Frontend Home:   ${APP_URL}/home/index.html`);
    console.log(`  Panel Admin:     ${APP_URL}/admin/admin.html`);
    console.log(`  Estudio 3D:      ${APP_URL}/Models/models.html`);
    console.log(`  Checkout Login:  ${APP_URL}/login/login.html`);
    console.log(`  Healthcheck API: ${APP_URL}/api/health`);
    console.log(`==================================================================`);
});
