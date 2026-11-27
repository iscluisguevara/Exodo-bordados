/**
 * ATELIER HILO / ÉXODO BORDADOS — Backend API (Node.js + Express + Supabase PostgreSQL)
 * Preparado para desarrollo local, Supabase (PostgreSQL SSL) y producción en AWS EC2
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');
const { OAuth2Client } = require('google-auth-library');

let Pool = null;
try {
    ({ Pool } = require('pg'));
} catch (_) {
    console.warn('[AVISO] El paquete "pg" no está instalado aún. Ejecuta "npm install" en /backend para conexión directa a PostgreSQL.');
}

const app = express();
const PORT = process.env.PORT || 3000;
const APP_URL = (process.env.APP_URL || `http://localhost:${PORT}`).replace(/\/+$/, '');
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'TU_GOOGLE_CLIENT_ID.apps.googleusercontent.com';
const AUTH_SECRET = process.env.AUTH_SECRET || 'atelier_hilo_dev_secret_cambia_en_produccion';
const TAX_RATE = Number.isFinite(Number(process.env.TAX_RATE)) ? Number(process.env.TAX_RATE) : 0.16;

// Configuración exclusiva del Administrador desde variables de entorno (.env)
const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || '').trim();
const ADMIN_PASSWORD_HASH = String(process.env.ADMIN_PASSWORD_HASH || '').trim();
const ADMIN_COOKIE_NAME = 'exodo_admin_token';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 horas

const VALID_ROLES = ['Administrador', 'Diseñador', 'Producción', 'Ventas', 'Cliente'];
const NON_ADMIN_ROLES = ['Diseñador', 'Producción', 'Ventas', 'Cliente'];
const VALID_PAYMENT_METHODS = ['card', 'transfer', 'paypal', 'branch'];

// Etapas oficiales de producción para pedidos
const PRODUCTION_STAGES = [
    'Cotización',
    'Diseño aprobado',
    'En producción',
    'Bordado/Impresión',
    'Empaque',
    'Enviado',
    'Entregado'
];

const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

// ============================================================================
// CONEXIÓN A SUPABASE (PostgreSQL con SSL y consultas parametrizadas)
// ============================================================================
const RAW_DATABASE_URL = String(process.env.DATABASE_URL || '').trim();
const IS_SUPABASE_CONFIGURED = Boolean(
    Pool &&
    RAW_DATABASE_URL &&
    /^postgres(ql)?:\/\//i.test(RAW_DATABASE_URL) &&
    !RAW_DATABASE_URL.includes('[TU_PASSWORD_DB]') &&
    !RAW_DATABASE_URL.includes('[DB-PASSWORD]')
);

const dbPool = IS_SUPABASE_CONFIGURED
    ? new Pool({
          connectionString: RAW_DATABASE_URL,
          ssl: { rejectUnauthorized: false },
          max: 10,
          idleTimeoutMillis: 30000,
          connectionTimeoutMillis: 8000
      })
    : null;

if (dbPool) {
    dbPool.on('error', (err) => {
        console.error('[Supabase Pool Error]:', err.message);
    });
}

// Rutas de almacenamiento persistente local (respaldo y archivos subidos)
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

// ============================================================================
// UTILIDADES CRIPTOGRÁFICAS, SESIONES Y NORMALIZACIÓN
// ============================================================================
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
    if (!storedHash || typeof storedHash !== 'string' || !storedHash.includes(':')) return false;
    const [salt, originalHex] = storedHash.split(':');
    if (!salt || !originalHex) return false;
    const derivedBuf = crypto.scryptSync(password, salt, 64);
    const originalBuf = Buffer.from(originalHex, 'hex');
    if (derivedBuf.length !== originalBuf.length) return false;
    return crypto.timingSafeEqual(derivedBuf, originalBuf);
}

function isReservedAdminEmail(email) {
    if (!email || !ADMIN_EMAIL) return false;
    return String(email).trim().toLowerCase() === ADMIN_EMAIL.toLowerCase();
}

function createSessionToken(user) {
    const now = Date.now();
    const payload = {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        authProvider: user.authProvider || 'local',
        iat: now,
        exp: now + SESSION_TTL_MS
    };
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = crypto
        .createHmac('sha256', AUTH_SECRET)
        .update(encoded)
        .digest('base64url');
    return `${encoded}.${signature}`;
}

function verifySessionToken(token) {
    if (!token || typeof token !== 'string' || !token.includes('.')) return null;
    const [encoded, signature] = token.split('.');
    if (!encoded || !signature) return null;
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
        const decoded = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
        if (decoded.exp && Date.now() > decoded.exp) {
            return null;
        }
        return decoded;
    } catch (_) {
        return null;
    }
}

function parseCookies(cookieHeader = '') {
    const cookies = {};
    if (!cookieHeader) return cookies;
    cookieHeader.split(';').forEach(pair => {
        const idx = pair.indexOf('=');
        if (idx > -1) {
            const key = pair.slice(0, idx).trim();
            const val = decodeURIComponent(pair.slice(idx + 1).trim());
            cookies[key] = val;
        }
    });
    return cookies;
}

function extractTokenFromRequest(req) {
    const authHeader = req.headers.authorization || '';
    if (authHeader.startsWith('Bearer ')) {
        const bearer = authHeader.slice(7).trim();
        if (bearer) return bearer;
    }
    const cookies = parseCookies(req.headers.cookie || '');
    return cookies[ADMIN_COOKIE_NAME] || null;
}

function setAdminSessionCookie(res, token) {
    const maxAgeSec = Math.floor(SESSION_TTL_MS / 1000);
    const isProd = process.env.NODE_ENV === 'production';
    const cookieParts = [
        `${ADMIN_COOKIE_NAME}=${encodeURIComponent(token)}`,
        'Path=/',
        'HttpOnly',
        'SameSite=Lax',
        `Max-Age=${maxAgeSec}`
    ];
    if (isProd) cookieParts.push('Secure');
    res.setHeader('Set-Cookie', cookieParts.join('; '));
}

function clearAdminSessionCookie(res) {
    res.setHeader(
        'Set-Cookie',
        `${ADMIN_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
    );
}

function sanitizeUser(user) {
    return {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role || 'Cliente',
        authProvider: user.authProvider || user.auth_provider || 'local',
        billing: user.billing || null,
        createdAt: user.createdAt || user.created_at
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

function normalizeProductionStage(stage) {
    const raw = String(stage || '').trim();
    if (PRODUCTION_STAGES.includes(raw)) return raw;
    if (raw === 'En bordado o impresión') return 'Bordado/Impresión';
    if (raw === 'EN_COLA_DE_TALLER') return 'Cotización';
    return 'Cotización';
}

function mapOrderRowToRecord(row) {
    if (!row) return null;
    const folio = row.folio || row.orderId || `AH-2026-${row.id || '0000'}`;
    const rawItems = Array.isArray(row.items) && row.items.length > 0
        ? row.items
        : (row.order ? [row.order] : []);

    const normalizedItems = rawItems.map((item, idx) => {
        const unitPrice = Number(item.unitPrice ?? item.price ?? 0);
        const quantity = Math.max(1, parseInt(item.quantity, 10) || 1);
        const lineTotal = Number(item.lineTotal ?? (unitPrice * quantity));
        return {
            itemIndex: item.itemIndex || idx + 1,
            garmentType: item.garmentType || 'custom',
            garmentName: item.garmentName || 'Prenda Personalizada',
            technique: item.technique || 'embroidery',
            techniqueName: item.techniqueName || 'Bordado 3D de Alta Precisión',
            unitPrice,
            price: unitPrice,
            quantity,
            lineTotal,
            fabricColor: item.fabricColor || '#181818',
            fabricColorName: item.fabricColorName || null,
            logoX: Number(item.logoX ?? 0.22),
            logoY: Number(item.logoY ?? 0.20),
            logoScale: Number(item.logoScale ?? 0.26),
            stitchDensity: Number(item.stitchDensity ?? 3),
            stitchCount: Number(item.stitchCount ?? 4200),
            printAreaCm2: item.printAreaCm2 ? Number(item.printAreaCm2) : null,
            embroideryImageUrl: item.embroideryImageUrl || null
        };
    });

    const primaryItem = normalizedItems[0] || {
        garmentName: 'Pedido Personalizado',
        techniqueName: 'Bordado / Impresión',
        unitPrice: 0,
        price: 0,
        quantity: 1,
        lineTotal: 0
    };

    const computedSubtotal = normalizedItems.reduce((acc, i) => acc + Number(i.lineTotal || 0), 0);
    const subtotal = Number(row.subtotal ?? row.pricing?.subtotal ?? computedSubtotal);
    const discount = Number(row.discount ?? row.pricing?.discount ?? 0);
    const tax = Number(row.tax ?? row.pricing?.tax ?? 0);
    const total = Number(row.total ?? row.pricing?.total ?? (subtotal - discount + tax));

    const customerName = row.customer_name || row.user?.name || 'Cliente';
    const customerEmail = row.customer_email || row.user?.email || '';
    const customerRole = row.customer_role || row.user?.role || 'Cliente';

    const paymentDetails = row.payment_details || row.payment || {};
    const paymentMethod = row.payment_method || paymentDetails.method || 'branch';
    const paymentStatus = row.payment_status || paymentDetails.status || 'PENDIENTE';
    const productionStage = normalizeProductionStage(row.production_stage || row.status);
    const createdAt = row.created_at
        ? new Date(row.created_at).toISOString()
        : (row.createdAt || new Date().toISOString());

    return {
        id: row.id || folio,
        folio,
        orderId: folio,
        created_at: createdAt,
        createdAt,
        production_stage: productionStage,
        status: productionStage,
        customer_name: customerName,
        customer_email: customerEmail,
        user: {
            name: customerName,
            email: customerEmail,
            role: customerRole
        },
        billing: row.billing || null,
        items: normalizedItems,
        order: primaryItem,
        subtotal,
        discount,
        tax,
        total,
        coupon_code: row.coupon_code || row.pricing?.coupon?.code || null,
        pricing: {
            subtotal,
            discount,
            taxRate: TAX_RATE,
            tax,
            total,
            currency: 'MXN',
            coupon: row.pricing?.coupon || (row.coupon_code ? { code: row.coupon_code } : null)
        },
        payment_method: paymentMethod,
        payment_status: paymentStatus,
        payment: {
            method: paymentMethod,
            methodLabel: paymentDetails.methodLabel || paymentMethod,
            status: paymentStatus,
            reference: paymentDetails.reference || `REF-${folio}`,
            cardLast4: paymentDetails.cardLast4 || null,
            cardHolder: paymentDetails.cardHolder || null,
            paypalEmail: paymentDetails.paypalEmail || null
        }
    };
}

// ============================================================================
// CAPA DE PERSISTENCIA: SUPABASE POSTGRESQL + RESPALDO LOCAL SINCRONIZADO
// ============================================================================
function ensureLocalAdminAccount() {
    if (!ADMIN_EMAIL || !ADMIN_PASSWORD_HASH) return;
    const users = readJsonArray(USERS_FILE, []);
    const idx = users.findIndex(u => String(u.email || '').toLowerCase() === ADMIN_EMAIL.toLowerCase());
    const adminRecord = {
        id: 'USR-ADMIN-SUP-01',
        name: 'Administrador General Éxodo',
        email: ADMIN_EMAIL,
        passwordHash: ADMIN_PASSWORD_HASH,
        role: 'Administrador',
        authProvider: 'local',
        googleId: null,
        googleOauthDisabled: true,
        billing: null,
        createdAt: idx !== -1 && users[idx].createdAt ? users[idx].createdAt : new Date().toISOString()
    };
    if (idx === -1) {
        users.push(adminRecord);
    } else {
        users[idx] = { ...users[idx], ...adminRecord };
    }
    writeJsonArray(USERS_FILE, users);
}

async function ensureSupabaseDatabaseAndAdmin() {
    ensureLocalAdminAccount();
    if (!dbPool) return;
    try {
        await dbPool.query(`
            CREATE TABLE IF NOT EXISTS public.users (
                id VARCHAR(64) PRIMARY KEY,
                name VARCHAR(150) NOT NULL,
                email VARCHAR(255) UNIQUE NOT NULL,
                password_hash TEXT,
                role VARCHAR(50) NOT NULL DEFAULT 'Cliente',
                auth_provider VARCHAR(50) NOT NULL DEFAULT 'local',
                google_id VARCHAR(255) UNIQUE NULL,
                google_oauth_disabled BOOLEAN NOT NULL DEFAULT FALSE,
                billing_razon_social VARCHAR(255) NULL,
                billing_rfc VARCHAR(20) NULL,
                billing_email VARCHAR(255) NULL,
                billing_fiscal_address TEXT NULL,
                billing_postal_code VARCHAR(15) NULL,
                billing JSONB DEFAULT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        `);

        await dbPool.query(`
            CREATE TABLE IF NOT EXISTS public.orders (
                id BIGSERIAL PRIMARY KEY,
                folio VARCHAR(32) UNIQUE NOT NULL,
                customer_name VARCHAR(150) NOT NULL,
                customer_email VARCHAR(255) NOT NULL,
                customer_role VARCHAR(50) NOT NULL DEFAULT 'Cliente',
                billing JSONB DEFAULT NULL,
                items JSONB NOT NULL DEFAULT '[]'::jsonb,
                subtotal NUMERIC(12, 2) NOT NULL DEFAULT 0,
                discount NUMERIC(12, 2) NOT NULL DEFAULT 0,
                tax NUMERIC(12, 2) NOT NULL DEFAULT 0,
                total NUMERIC(12, 2) NOT NULL DEFAULT 0,
                coupon_code VARCHAR(50) DEFAULT NULL,
                payment_method VARCHAR(50) NOT NULL DEFAULT 'branch',
                payment_status VARCHAR(80) NOT NULL DEFAULT 'PENDIENTE_PAGO_SUCURSAL',
                payment_details JSONB DEFAULT NULL,
                production_stage VARCHAR(60) NOT NULL DEFAULT 'Cotización',
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        `);

        if (ADMIN_EMAIL && ADMIN_PASSWORD_HASH) {
            await dbPool.query(
                `INSERT INTO public.users (
                    id, name, email, password_hash, role, auth_provider, google_id, google_oauth_disabled, billing
                ) VALUES ($1, $2, $3, $4, 'Administrador', 'local', NULL, TRUE, NULL)
                ON CONFLICT (email) DO UPDATE SET
                    password_hash = EXCLUDED.password_hash,
                    role = 'Administrador',
                    auth_provider = 'local',
                    google_id = NULL,
                    google_oauth_disabled = TRUE,
                    updated_at = NOW()`,
                ['USR-ADMIN-SUP-01', 'Administrador General Éxodo', ADMIN_EMAIL, ADMIN_PASSWORD_HASH]
            );
        }
        console.log('[Supabase PostgreSQL] Conexión verificada y cuenta Administrador asegurada.');
    } catch (err) {
        console.error('[Supabase PostgreSQL] Error al inicializar esquema:', err.message);
    }
}

ensureSupabaseDatabaseAndAdmin();

async function findUserByEmail(email) {
    const cleanEmail = String(email || '').trim();
    if (!cleanEmail) return null;

    if (dbPool) {
        try {
            const { rows } = await dbPool.query(
                'SELECT * FROM public.users WHERE LOWER(email) = LOWER($1) LIMIT 1',
                [cleanEmail]
            );
            if (rows.length > 0) {
                const r = rows[0];
                return {
                    id: r.id,
                    name: r.name,
                    email: r.email,
                    passwordHash: r.password_hash,
                    role: r.role,
                    authProvider: r.auth_provider || 'local',
                    googleId: r.google_id || null,
                    googleOauthDisabled: Boolean(r.google_oauth_disabled),
                    billing: r.billing || null,
                    createdAt: r.created_at
                };
            }
        } catch (err) {
            console.error('[Supabase findUserByEmail Error]:', err.message);
        }
    }

    const users = readJsonArray(USERS_FILE, []);
    return users.find(u => String(u.email || '').toLowerCase() === cleanEmail.toLowerCase()) || null;
}

async function saveOrUpdateUser(userObj) {
    const billing = normalizeBilling(userObj.billing);
    if (dbPool) {
        try {
            await dbPool.query(
                `INSERT INTO public.users (
                    id, name, email, password_hash, role, auth_provider, google_id, google_oauth_disabled,
                    billing_razon_social, billing_rfc, billing_email, billing_fiscal_address, billing_postal_code, billing
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
                ON CONFLICT (email) DO UPDATE SET
                    name = EXCLUDED.name,
                    role = EXCLUDED.role,
                    billing_razon_social = EXCLUDED.billing_razon_social,
                    billing_rfc = EXCLUDED.billing_rfc,
                    billing_email = EXCLUDED.billing_email,
                    billing_fiscal_address = EXCLUDED.billing_fiscal_address,
                    billing_postal_code = EXCLUDED.billing_postal_code,
                    billing = EXCLUDED.billing,
                    updated_at = NOW()`,
                [
                    userObj.id,
                    userObj.name,
                    userObj.email,
                    userObj.passwordHash || null,
                    userObj.role || 'Cliente',
                    userObj.authProvider || 'local',
                    userObj.googleId || null,
                    Boolean(userObj.googleOauthDisabled),
                    billing ? billing.razonSocial : null,
                    billing ? billing.rfc : null,
                    billing ? billing.billingEmail : null,
                    billing ? billing.fiscalAddress : null,
                    billing ? billing.postalCode : null,
                    billing ? JSON.stringify(billing) : null
                ]
            );
        } catch (err) {
            console.error('[Supabase saveOrUpdateUser Error]:', err.message);
        }
    }

    const users = readJsonArray(USERS_FILE, []);
    const idx = users.findIndex(u => String(u.email || '').toLowerCase() === String(userObj.email || '').toLowerCase());
    if (idx === -1) {
        users.push({ ...userObj, billing });
    } else {
        users[idx] = { ...users[idx], ...userObj, billing };
    }
    writeJsonArray(USERS_FILE, users);
}

async function listOrdersFromStore() {
    if (dbPool) {
        const { rows } = await dbPool.query(
            'SELECT * FROM public.orders ORDER BY created_at DESC, id DESC'
        );
        return rows.map(mapOrderRowToRecord);
    }
    const localOrders = readJsonArray(ORDERS_FILE, []);
    return localOrders
        .map(mapOrderRowToRecord)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

async function getOrderFromStore(idOrFolio) {
    const lookup = String(idOrFolio || '').trim();
    if (!lookup) return null;

    if (dbPool) {
        const { rows } = await dbPool.query(
            'SELECT * FROM public.orders WHERE UPPER(folio) = UPPER($1) OR CAST(id AS TEXT) = $1 LIMIT 1',
            [lookup]
        );
        if (rows.length > 0) return mapOrderRowToRecord(rows[0]);
    }

    const localOrders = readJsonArray(ORDERS_FILE, []);
    const found = localOrders.find(
        o =>
            String(o.folio || o.orderId || '').toUpperCase() === lookup.toUpperCase() ||
            String(o.id || '') === lookup
    );
    return found ? mapOrderRowToRecord(found) : null;
}

async function insertOrderIntoStore(orderRecord) {
    const normalized = mapOrderRowToRecord(orderRecord);

    if (dbPool) {
        const { rows } = await dbPool.query(
            `INSERT INTO public.orders (
                folio, customer_name, customer_email, customer_role, billing, items,
                subtotal, discount, tax, total, coupon_code,
                payment_method, payment_status, payment_details, production_stage, created_at
            ) VALUES (
                $1, $2, $3, $4, $5, $6,
                $7, $8, $9, $10, $11,
                $12, $13, $14, $15, $16
            ) RETURNING *`,
            [
                normalized.folio,
                normalized.customer_name,
                normalized.customer_email,
                normalized.user.role || 'Cliente',
                normalized.billing ? JSON.stringify(normalized.billing) : null,
                JSON.stringify(normalized.items),
                normalized.subtotal,
                normalized.discount,
                normalized.tax,
                normalized.total,
                normalized.coupon_code,
                normalized.payment_method,
                normalized.payment_status,
                JSON.stringify(normalized.payment),
                normalized.production_stage,
                normalized.createdAt
            ]
        );
        if (rows.length > 0) {
            const savedFromDb = mapOrderRowToRecord(rows[0]);
            const existingOrders = readJsonArray(ORDERS_FILE, []);
            existingOrders.unshift(savedFromDb);
            writeJsonArray(ORDERS_FILE, existingOrders);
            return savedFromDb;
        }
    }

    const existingOrders = readJsonArray(ORDERS_FILE, []);
    existingOrders.unshift(normalized);
    writeJsonArray(ORDERS_FILE, existingOrders);
    return normalized;
}

async function updateOrderStageInStore(idOrFolio, newStage) {
    const lookup = String(idOrFolio || '').trim();
    let updatedOrder = null;

    if (dbPool) {
        const { rows } = await dbPool.query(
            `UPDATE public.orders
             SET production_stage = $1, updated_at = NOW()
             WHERE UPPER(folio) = UPPER($2) OR CAST(id AS TEXT) = $2
             RETURNING *`,
            [newStage, lookup]
        );
        if (rows.length > 0) {
            updatedOrder = mapOrderRowToRecord(rows[0]);
        }
    }

    const localOrders = readJsonArray(ORDERS_FILE, []);
    const idx = localOrders.findIndex(
        o =>
            String(o.folio || o.orderId || '').toUpperCase() === lookup.toUpperCase() ||
            String(o.id || '') === lookup
    );
    if (idx !== -1) {
        localOrders[idx].status = newStage;
        localOrders[idx].production_stage = newStage;
        writeJsonArray(ORDERS_FILE, localOrders);
        if (!updatedOrder) {
            updatedOrder = mapOrderRowToRecord(localOrders[idx]);
        }
    }

    return updatedOrder;
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

// ============================================================================
// MIDDLEWARES DE AUTENTICACIÓN Y CONTROL DE ACCESO POR ROL
// ============================================================================
function requireAuth(req, res, next) {
    const token = extractTokenFromRequest(req);
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

function requireAdmin(req, res, next) {
    const token = extractTokenFromRequest(req);
    const decoded = verifySessionToken(token);
    if (!decoded) {
        return res.status(401).json({
            success: false,
            error: 'Autenticación de Administrador requerida.'
        });
    }
    if (decoded.role !== 'Administrador' || decoded.authProvider === 'google') {
        return res.status(403).json({
            success: false,
            error: 'Acceso denegado. Esta operación requiere rol exclusivo de Administrador.'
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
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// Servir archivos estáticos del frontend
app.use('/home', express.static(path.join(__dirname, '../home')));
app.use('/login', express.static(path.join(__dirname, '../login')));
app.use('/Models', express.static(path.join(__dirname, '../Models')));
app.use('/footer', express.static(path.join(__dirname, '../footer')));
app.use('/assets', express.static(path.join(__dirname, '../assets')));
app.use('/api/uploads', express.static(UPLOADS_DIR));

app.get('/', (req, res) => {
    res.redirect('/home/index.html');
});

// ============================================================================
// SECCIÓN SUPERIOR API: SALUD, CONFIG, AUTH CLIENTES, PERFIL, CUPONES Y CHECKOUT
// ============================================================================

/**
 * 1. ENDPOINT DE SALUD DEL SERVIDOR
 */
app.get('/api/health', (req, res) => {
    res.status(200).json({
        status: 'ok',
        appUrl: APP_URL,
        database: IS_SUPABASE_CONFIGURED ? 'supabase_postgresql' : 'local_json_fallback',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development'
    });
});

/**
 * 1B. CONFIGURACIÓN PÚBLICA (Sin exponer jamás credenciales ni correos administrativos)
 */
app.get('/api/config/public', (req, res) => {
    const isGoogleConfigured =
        Boolean(GOOGLE_CLIENT_ID) &&
        GOOGLE_CLIENT_ID !== 'TU_GOOGLE_CLIENT_ID.apps.googleusercontent.com';

    res.status(200).json({
        appUrl: APP_URL,
        googleClientId: isGoogleConfigured ? GOOGLE_CLIENT_ID : null,
        taxRate: TAX_RATE,
        roles: NON_ADMIN_ROLES,
        productionStages: PRODUCTION_STAGES
    });
});

/**
 * 2A. REGISTRO DE CLIENTES / USUARIOS (Bloquea auto-asignación de rol Administrador)
 */
app.post('/api/auth/register', async (req, res) => {
    try {
        const { name, email, password, role, billing } = req.body || {};

        if (!name || !email || !password) {
            return res.status(400).json({
                success: false,
                error: 'Nombre, correo electrónico y contraseña son obligatorios.'
            });
        }

        const normalizedEmail = String(email).trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
            return res.status(400).json({
                success: false,
                error: 'El formato del correo electrónico no es válido.'
            });
        }

        if (isReservedAdminEmail(normalizedEmail)) {
            return res.status(403).json({
                success: false,
                error: 'Este correo electrónico está reservado y no puede registrarse por esta vía.'
            });
        }

        if (String(password).length < 6) {
            return res.status(400).json({
                success: false,
                error: 'La contraseña debe tener al menos 6 caracteres.'
            });
        }

        // Nunca permitir que un registro público otorgue el rol Administrador
        const assignedRole = NON_ADMIN_ROLES.includes(role) ? role : 'Cliente';
        const existing = await findUserByEmail(normalizedEmail);

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
            googleId: null,
            googleOauthDisabled: false,
            billing: normalizeBilling(billing),
            createdAt: new Date().toISOString()
        };

        await saveOrUpdateUser(newUser);

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
 * 2B. INICIO DE SESIÓN GENERAL CON CORREO Y CONTRASEÑA
 */
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body || {};

        if (!email || !password) {
            return res.status(400).json({
                success: false,
                error: 'Ingresa correo electrónico y contraseña.'
            });
        }

        const user = await findUserByEmail(email);

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
 * 2C. AUTENTICACIÓN CON GOOGLE OAUTH 2.0 (Estrictamente aislada de cuentas Administrador)
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
                    sub = decoded.sub || null;
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

        // REGLA CRÍTICA: Bloquear cualquier intento de usar Google OAuth con la cuenta de Administrador
        if (isReservedAdminEmail(resolvedEmail)) {
            return res.status(403).json({
                verified: false,
                error: 'La cuenta de Administrador está aislada y no permite inicio de sesión mediante Google OAuth.'
            });
        }

        let existingUser = await findUserByEmail(resolvedEmail);
        if (existingUser && (existingUser.role === 'Administrador' || existingUser.googleOauthDisabled)) {
            return res.status(403).json({
                verified: false,
                error: 'Esta cuenta tiene deshabilitado el acceso con Google OAuth.'
            });
        }

        // Google OAuth jamás puede otorgar el rol Administrador
        const requestedRole = NON_ADMIN_ROLES.includes(role) ? role : null;
        const normalizedBilling = normalizeBilling(billing);

        if (!existingUser) {
            existingUser = {
                id: `USR-${Date.now().toString(36).toUpperCase()}`,
                name: resolvedName,
                email: resolvedEmail,
                passwordHash: null,
                role: requestedRole || 'Cliente',
                authProvider: 'google',
                googleId: sub || `google_${Date.now()}`,
                googleOauthDisabled: false,
                billing: normalizedBilling,
                createdAt: new Date().toISOString()
            };
        } else {
            if (requestedRole && existingUser.role !== 'Administrador') {
                existingUser.role = requestedRole;
            }
            if (normalizedBilling) {
                existingUser.billing = normalizedBilling;
            }
        }

        await saveOrUpdateUser(existingUser);

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
 * 2D. PERFIL DEL USUARIO AUTENTICADO
 */
app.get('/api/users/me', requireAuth, async (req, res) => {
    const user = await findUserByEmail(req.authUser.email);
    if (!user) {
        return res.status(404).json({ success: false, error: 'Usuario no encontrado.' });
    }
    return res.status(200).json({ success: true, user: sanitizeUser(user) });
});

app.put('/api/users/me', requireAuth, async (req, res) => {
    try {
        const { name, role, billing } = req.body || {};
        const user = await findUserByEmail(req.authUser.email);

        if (!user) {
            return res.status(404).json({ success: false, error: 'Usuario no encontrado.' });
        }

        if (name && String(name).trim()) {
            user.name = String(name).trim();
        }
        // Solo permitir cambio entre roles no-administrativos desde perfil de cliente
        if (role && NON_ADMIN_ROLES.includes(role) && user.role !== 'Administrador') {
            user.role = role;
        }
        if (billing !== undefined) {
            user.billing = normalizeBilling(billing);
        }

        await saveOrUpdateUser(user);
        const safeUser = sanitizeUser(user);
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
 * 4. REGISTRO DE PEDIDOS EN SUPABASE + RESPALDO LOCAL (POST /api/orders)
 */
app.post('/api/orders', async (req, res) => {
    try {
        const { user, items, order, billing, payment, couponCode, createdAt } = req.body || {};

        if (!user || !user.name || !user.email) {
            return res.status(400).json({
                success: false,
                error: 'Faltan los datos del usuario autenticado (user.name, user.email).'
            });
        }

        const rawItems = Array.isArray(items) && items.length > 0
            ? items
            : (order ? [order] : []);

        if (rawItems.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'El carrito está vacío. Agrega al menos un artículo para confirmar la orden.'
            });
        }

        const paymentMethod = (payment && payment.method) ? String(payment.method) : 'branch';
        if (!VALID_PAYMENT_METHODS.includes(paymentMethod)) {
            return res.status(400).json({
                success: false,
                error: `Método de pago no soportado: ${paymentMethod}.`
            });
        }

        const existingOrders = readJsonArray(ORDERS_FILE, []);
        let folio = '';
        do {
            const randomDigits = Math.floor(1000 + Math.random() * 9000);
            folio = `AH-2026-${randomDigits}`;
        } while (existingOrders.some(o => (o.folio || o.orderId) === folio));

        const processedItems = [];
        let subtotal = 0;

        for (let idx = 0; idx < rawItems.length; idx++) {
            const item = rawItems[idx];

            if (!item || !item.garmentType || !item.garmentName || typeof (item.unitPrice ?? item.price) === 'undefined' || !item.fabricColor) {
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
                price: unitPrice,
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

        const savedOrder = await insertOrderIntoStore({
            folio,
            orderId: folio,
            createdAt: orderTimestamp,
            production_stage: 'Cotización',
            status: 'Cotización',
            customer_name: user.name,
            customer_email: user.email,
            user: {
                name: user.name,
                email: user.email,
                role: VALID_ROLES.includes(user.role) ? user.role : 'Cliente'
            },
            billing: normalizedBilling,
            items: processedItems,
            order: processedItems[0],
            subtotal,
            discount,
            tax,
            total,
            coupon_code: appliedCoupon ? appliedCoupon.code : null,
            pricing: {
                subtotal,
                discount,
                taxRate: TAX_RATE,
                tax,
                total,
                currency: 'MXN',
                coupon: appliedCoupon
            },
            payment_method: paymentMethod,
            payment_status: sanitizedPayment.status,
            payment: sanitizedPayment,
            emailNotification
        });

        return res.status(201).json({
            success: true,
            orderId: folio,
            embroideryImageUrl: processedItems[0].embroideryImageUrl,
            orderRecord: savedOrder,
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

// ============================================================================
// 5. SECCIÓN DE ADMINISTRACIÓN Y GESTIÓN DE PEDIDOS (PROTEGIDA CON ROL ADMIN)
// ============================================================================
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

// Servir archivos estáticos de /admin
app.use('/admin', express.static(path.join(__dirname, '../admin')));

/**
 * 5A. AUTENTICACIÓN EXCLUSIVA DE ADMINISTRADOR (POST /api/admin/login)
 * Verifica correo y contraseña contra Supabase / hash en .env y exige role === 'Administrador'
 */
app.post('/api/admin/login', async (req, res) => {
    try {
        const { email, password } = req.body || {};

        if (!email || !password) {
            return res.status(400).json({
                success: false,
                error: 'Ingresa el correo y la contraseña de Administrador.'
            });
        }

        const cleanEmail = String(email).trim();
        const user = await findUserByEmail(cleanEmail);

        if (!user || !verifyPassword(String(password), user.passwordHash)) {
            return res.status(401).json({
                success: false,
                error: 'Credenciales inválidas. Verifica tu correo y contraseña.'
            });
        }

        if (user.role !== 'Administrador') {
            return res.status(403).json({
                success: false,
                error: 'Acceso denegado. Esta cuenta no posee privilegios de Administrador.'
            });
        }

        if (user.authProvider === 'google' || user.googleId) {
            return res.status(403).json({
                success: false,
                error: 'Cuenta inválida para administración: el acceso administrativo está aislado de Google OAuth.'
            });
        }

        const safeAdmin = sanitizeUser(user);
        const token = createSessionToken(safeAdmin);
        setAdminSessionCookie(res, token);

        return res.status(200).json({
            success: true,
            token,
            user: safeAdmin
        });
    } catch (error) {
        console.error('Error en POST /api/admin/login:', error);
        return res.status(500).json({
            success: false,
            error: 'Error interno al autenticar Administrador.'
        });
    }
});

/**
 * 5B. VERIFICACIÓN DE SESIÓN ACTIVA DE ADMINISTRADOR (GET /api/admin/session)
 */
app.get('/api/admin/session', requireAdmin, (req, res) => {
    return res.status(200).json({
        authenticated: true,
        user: {
            id: req.authUser.id,
            name: req.authUser.name,
            email: req.authUser.email,
            role: req.authUser.role
        },
        database: IS_SUPABASE_CONFIGURED ? 'supabase_postgresql' : 'local_json_fallback',
        stages: PRODUCTION_STAGES
    });
});

/**
 * 5C. CIERRE DE SESIÓN DE ADMINISTRADOR (POST /api/admin/logout)
 */
app.post('/api/admin/logout', (req, res) => {
    clearAdminSessionCookie(res);
    return res.status(200).json({
        success: true,
        message: 'Sesión administrativa cerrada correctamente.'
    });
});

/**
 * 5D. LISTADO DE PEDIDOS (GET /api/orders)
 * Protegido: Exige sesión válida. Si es Administrador devuelve todos los pedidos desde Supabase;
 * si es Cliente autenticado devuelve únicamente sus propios pedidos.
 */
app.get('/api/orders', requireAuth, async (req, res) => {
    try {
        const allOrders = await listOrdersFromStore();

        if (req.authUser.role === 'Administrador') {
            return res.status(200).json(allOrders);
        }

        if (req.authUser.role === 'Cliente') {
            const clientEmail = String(req.authUser.email || '').toLowerCase();
            return res.status(200).json(
                allOrders.filter(o => String(o.customer_email || o.user?.email || '').toLowerCase() === clientEmail)
            );
        }

        return res.status(403).json({
            success: false,
            error: 'Se requiere rol de Administrador para consultar el listado general de pedidos.'
        });
    } catch (error) {
        console.error('Error en GET /api/orders:', error);
        return res.status(500).json({
            success: false,
            error: 'No se pudo consultar el listado de pedidos.'
        });
    }
});

/**
 * 5E. DETALLE DE UN PEDIDO POR FOLIO O ID (GET /api/orders/:orderId)
 */
app.get('/api/orders/:orderId', requireAuth, async (req, res) => {
    try {
        const found = await getOrderFromStore(req.params.orderId);
        if (!found) {
            return res.status(404).json({
                success: false,
                error: `Pedido ${req.params.orderId} no encontrado.`
            });
        }

        const isOwner =
            String(found.customer_email || '').toLowerCase() ===
            String(req.authUser.email || '').toLowerCase();

        if (req.authUser.role !== 'Administrador' && !isOwner) {
            return res.status(403).json({
                success: false,
                error: 'No tienes permiso para inspeccionar este pedido.'
            });
        }

        return res.status(200).json({ success: true, order: found });
    } catch (error) {
        console.error('Error en GET /api/orders/:orderId:', error);
        return res.status(500).json({
            success: false,
            error: 'Error al consultar el detalle del pedido.'
        });
    }
});

/**
 * 5F. ACTUALIZACIÓN DE ETAPA DE PRODUCCIÓN EN SUPABASE (PATCH /api/orders/:id/status)
 * Exclusivo para Administrador. Valida que la etapa pertenezca a las 7 etapas oficiales.
 */
app.patch('/api/orders/:id/status', requireAdmin, async (req, res) => {
    try {
        const orderKey = req.params.id;
        const requestedStage = String(req.body?.status || req.body?.production_stage || '').trim();

        if (!PRODUCTION_STAGES.includes(requestedStage)) {
            return res.status(400).json({
                success: false,
                error: `Etapa de producción inválida: "${requestedStage}". Etapas permitidas: ${PRODUCTION_STAGES.join(', ')}.`
            });
        }

        const updatedOrder = await updateOrderStageInStore(orderKey, requestedStage);
        if (!updatedOrder) {
            return res.status(404).json({
                success: false,
                error: `Pedido "${orderKey}" no encontrado.`
            });
        }

        return res.status(200).json({
            success: true,
            order: updatedOrder,
            message: `Etapa del pedido ${updatedOrder.folio} actualizada a "${requestedStage}".`
        });
    } catch (error) {
        console.error('Error en PATCH /api/orders/:id/status:', error);
        return res.status(500).json({
            success: false,
            error: 'No se pudo actualizar la etapa del pedido.'
        });
    }
});

// CRUD de Productos y Servicios (Lectura pública para tienda; escritura protegida para Administrador)
app.get('/api/products', (req, res) => res.json(readJsonArray(PRODUCTS_FILE, [])));

app.post('/api/products', requireAdmin, (req, res) => {
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

app.put('/api/products/:id', requireAdmin, (req, res) => {
    const products = readJsonArray(PRODUCTS_FILE, []);
    const idx = products.findIndex(p => p.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Producto no encontrado' });
    products[idx] = { ...products[idx], ...req.body, price: Number(req.body.price ?? products[idx].price) };
    writeJsonArray(PRODUCTS_FILE, products);
    res.json(products[idx]);
});

app.delete('/api/products/:id', requireAdmin, (req, res) => {
    const products = readJsonArray(PRODUCTS_FILE, []).filter(p => p.id !== req.params.id);
    writeJsonArray(PRODUCTS_FILE, products);
    res.json({ success: true });
});

// Inventario (Protegido para Administrador)
app.get('/api/inventory', requireAdmin, (req, res) => res.json(readJsonArray(INVENTORY_FILE, [])));

app.patch('/api/inventory/:id', requireAdmin, (req, res) => {
    const inv = readJsonArray(INVENTORY_FILE, []);
    const idx = inv.findIndex(i => i.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Insumo no encontrado' });
    inv[idx].stock = Number(req.body.stock);
    writeJsonArray(INVENTORY_FILE, inv);
    res.json(inv[idx]);
});

// Promociones y Cupones (Protegido para Administrador; la tienda valida mediante POST /api/coupons/validate)
app.get('/api/coupons', requireAdmin, (req, res) => {
    const coupons = readJsonArray(COUPONS_FILE, DEFAULT_COUPONS).map(c => ({
        ...c,
        discountPercent: c.discountPercent ?? (c.type === 'percentage' ? c.value : 0)
    }));
    res.json(coupons);
});

app.post('/api/coupons', requireAdmin, (req, res) => {
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

app.delete('/api/coupons/:code', requireAdmin, (req, res) => {
    const coupons = readJsonArray(COUPONS_FILE, DEFAULT_COUPONS).filter(c => c.code !== req.params.code);
    writeJsonArray(COUPONS_FILE, coupons);
    res.json({ success: true });
});

// Solicitudes de Cotización Especial
app.get('/api/quotes', requireAdmin, (req, res) => res.json(readJsonArray(QUOTES_FILE, [])));

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
    console.log(`  Base de Datos:   ${IS_SUPABASE_CONFIGURED ? 'Supabase PostgreSQL (SSL)' : 'Local JSON Fallback (Configura DATABASE_URL en .env)'}`);
    console.log(`  Frontend Home:   ${APP_URL}/home/index.html`);
    console.log(`  Panel Admin:     ${APP_URL}/admin/admin.html`);
    console.log(`  Estudio 3D:      ${APP_URL}/Models/models.html`);
    console.log(`  Checkout Login:  ${APP_URL}/login/login.html`);
    console.log(`  Healthcheck API: ${APP_URL}/api/health`);
    console.log(`==================================================================`);
});
