/**
 * ATELIER HILO / ÉXODO BORDADOS — Backend API (Node.js + Express + Supabase PostgreSQL + Mercado Pago)
 * Preparado para desarrollo local, producción en AWS EC2 y despliegue serverless en Vercel
 */

const path = require('path');
const fs = require('fs');

// Cargar variables desde .env únicamente si no están ya definidas en el entorno (Vercel / EC2)
const envFilePath = path.join(__dirname, '.env');
if (!process.env.VERCEL && fs.existsSync(envFilePath)) {
    require('dotenv').config({ path: envFilePath, override: false });
} else {
    require('dotenv').config({ override: false });
}

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');

let Pool = null;
try {
    ({ Pool } = require('pg'));
} catch (_) {
    console.warn('[AVISO] El paquete "pg" no está instalado aún. Ejecuta "npm install" en /backend para conexión directa a PostgreSQL.');
}

let MercadoPagoConfig = null;
let Preference = null;
let Payment = null;
try {
    ({ MercadoPagoConfig, Preference, Payment } = require('mercadopago'));
} catch (_) {
    console.warn('[AVISO] El paquete "mercadopago" no está instalado aún. Ejecuta "npm install mercadopago" en /backend.');
}

const app = express();
const IS_SERVERLESS = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const PORT = process.env.PORT || 3000;
const APP_URL = (process.env.APP_URL || `http://localhost:${PORT}`).replace(/\/+$/, '');
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'TU_GOOGLE_CLIENT_ID.apps.googleusercontent.com';
const AUTH_SECRET = process.env.AUTH_SECRET || 'atelier_hilo_dev_secret_cambia_en_produccion';
const TAX_RATE = Number.isFinite(Number(process.env.TAX_RATE)) ? Number(process.env.TAX_RATE) : 0.16;

// Credenciales de Mercado Pago desde variables de entorno (MP_ACCESS_TOKEN jamás se expone al frontend)
const MP_ACCESS_TOKEN = String(process.env.MP_ACCESS_TOKEN || '').trim();
const MP_PUBLIC_KEY = String(process.env.MP_PUBLIC_KEY || '').trim();
const IS_MP_CONFIGURED = Boolean(
    MercadoPagoConfig &&
    Preference &&
    MP_ACCESS_TOKEN &&
    !MP_ACCESS_TOKEN.includes('TU_MP_ACCESS_TOKEN')
);

function getMercadoPagoClient() {
    if (!IS_MP_CONFIGURED) return null;
    return new MercadoPagoConfig({
        accessToken: MP_ACCESS_TOKEN,
        options: { timeout: 10000 }
    });
}

// Configuración exclusiva del Administrador desde variables de entorno (.env)
const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || '').trim();
const ADMIN_PASSWORD_HASH = String(process.env.ADMIN_PASSWORD_HASH || '').trim();
const ADMIN_COOKIE_NAME = 'exodo_admin_token';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 horas

const VALID_ROLES = ['Administrador', 'Diseñador', 'Producción', 'Ventas', 'Cliente'];
const NON_ADMIN_ROLES = ['Diseñador', 'Producción', 'Ventas', 'Cliente'];
const VALID_PAYMENT_METHODS = ['mercadopago', 'card', 'transfer', 'paypal', 'branch'];

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
// CONEXIÓN A SUPABASE (PostgreSQL Shared Pooler puerto 6543 con SSL)
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
          max: Number(process.env.PG_POOL_MAX) || (IS_SERVERLESS ? 3 : 10),
          idleTimeoutMillis: 30000,
          connectionTimeoutMillis: 8000,
          query_timeout: 10000,
          statement_timeout: 10000
      })
    : null;

if (dbPool) {
    dbPool.on('error', (err) => {
        console.error('[Supabase Pool Error]:', err.message);
    });
}

// Rutas de almacenamiento local (solo lectura en Vercel; escritura local solo en desarrollo/EC2)
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const DATA_DIR = path.join(__dirname, 'data');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const COUPONS_FILE = path.join(DATA_DIR, 'coupons.json');

const DEFAULT_COUPONS = [
    {
        code: 'EXODO10',
        discount_type: 'percentage',
        type: 'percentage',
        discount_value: 10,
        value: 10,
        min_subtotal: 0,
        minSubtotal: 0,
        active: true,
        expires_at: '2027-12-31T23:59:59.000Z',
        expiresAt: '2027-12-31T23:59:59.000Z',
        description: '10% de descuento en tu pedido personalizado'
    },
    {
        code: 'ATELIER150',
        discount_type: 'fixed',
        type: 'fixed',
        discount_value: 150,
        value: 150,
        min_subtotal: 600,
        minSubtotal: 600,
        active: true,
        expires_at: '2027-12-31T23:59:59.000Z',
        expiresAt: '2027-12-31T23:59:59.000Z',
        description: '$150 MXN de descuento en compras desde $600 MXN'
    },
    {
        code: 'MAYOREO20',
        discount_type: 'percentage',
        type: 'percentage',
        discount_value: 20,
        value: 20,
        min_subtotal: 2000,
        minSubtotal: 2000,
        active: true,
        expires_at: '2027-12-31T23:59:59.000Z',
        expiresAt: '2027-12-31T23:59:59.000Z',
        description: '20% de descuento en pedidos de mayoreo desde $2,000 MXN'
    },
    {
        code: 'EXPIRADO50',
        discount_type: 'percentage',
        type: 'percentage',
        discount_value: 50,
        value: 50,
        min_subtotal: 0,
        minSubtotal: 0,
        active: true,
        expires_at: '2025-01-01T00:00:00.000Z',
        expiresAt: '2025-01-01T00:00:00.000Z',
        description: 'Cupón de prueba vencido'
    }
];

if (!IS_SERVERLESS) {
    try {
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
    } catch (fsErr) {
        console.warn('[Filesystem Init]: Entorno sin escritura local persistente, usando Supabase PostgreSQL:', fsErr.message);
    }
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
    if (IS_SERVERLESS) return;
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
        console.warn(`[Filesystem Warning] No se pudo escribir en ${filePath}:`, err.message);
    }
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
            methodLabel: paymentDetails.methodLabel || (paymentMethod === 'mercadopago' ? 'Mercado Pago Checkout Pro' : paymentMethod),
            status: paymentStatus,
            reference: paymentDetails.reference || `REF-${folio}`,
            preferenceId: paymentDetails.preferenceId || null,
            paymentId: paymentDetails.paymentId || null,
            init_point: paymentDetails.init_point || null,
            sandbox_init_point: paymentDetails.sandbox_init_point || null,
            cardLast4: paymentDetails.cardLast4 || null,
            cardHolder: paymentDetails.cardHolder || null,
            paypalEmail: paymentDetails.paypalEmail || null
        }
    };
}

function mapCouponRowToRecord(row) {
    if (!row) return null;
    const code = String(row.code || '').trim().toUpperCase();
    const discountType = (row.discount_type || row.type || 'percentage') === 'fixed' ? 'fixed' : 'percentage';
    const discountValue = Number(row.discount_value ?? row.value ?? row.discountPercent ?? 0);
    const minSubtotal = Number(row.min_subtotal ?? row.minSubtotal ?? 0);
    const active = row.active !== undefined ? Boolean(row.active) : true;
    const expiresAt = row.expires_at
        ? new Date(row.expires_at).toISOString()
        : (row.expiresAt || '2027-12-31T23:59:59.000Z');
    const description = String(row.description || '').trim();

    return {
        code,
        discount_type: discountType,
        type: discountType,
        discount_value: discountValue,
        value: discountValue,
        discountPercent: discountType === 'percentage' ? discountValue : 0,
        min_subtotal: minSubtotal,
        minSubtotal,
        active,
        expires_at: expiresAt,
        expiresAt,
        description
    };
}

// ============================================================================
// CAPA DE PERSISTENCIA: SUPABASE POSTGRESQL (users, coupons, orders)
// ============================================================================
function ensureLocalAdminAccount() {
    if (IS_SERVERLESS || !ADMIN_EMAIL || !ADMIN_PASSWORD_HASH) return;
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

let dbInitPromise = null;

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
            CREATE TABLE IF NOT EXISTS public.coupons (
                code VARCHAR(50) PRIMARY KEY,
                discount_type VARCHAR(20) NOT NULL DEFAULT 'percentage',
                discount_value NUMERIC(12, 2) NOT NULL DEFAULT 0,
                min_subtotal NUMERIC(12, 2) NOT NULL DEFAULT 0,
                active BOOLEAN NOT NULL DEFAULT TRUE,
                expires_at TIMESTAMPTZ DEFAULT '2027-12-31T23:59:59.000Z',
                description TEXT DEFAULT '',
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
                payment_status VARCHAR(80) NOT NULL DEFAULT 'pending',
                payment_details JSONB DEFAULT NULL,
                production_stage VARCHAR(60) NOT NULL DEFAULT 'Cotización',
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        `);

        for (const c of DEFAULT_COUPONS) {
            await dbPool.query(
                `INSERT INTO public.coupons (
                    code, discount_type, discount_value, min_subtotal, active, expires_at, description
                ) VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT (code) DO NOTHING`,
                [
                    c.code,
                    c.discount_type || c.type,
                    c.discount_value ?? c.value,
                    c.min_subtotal ?? c.minSubtotal ?? 0,
                    Boolean(c.active),
                    c.expires_at || c.expiresAt,
                    c.description || ''
                ]
            );
        }

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
        console.log('[Supabase PostgreSQL] Conexión verificada, tablas (users, coupons, orders) y Administrador asegurados.');
    } catch (err) {
        console.error('[Supabase PostgreSQL] Error al inicializar esquema:', err.message);
        throw err;
    }
}

function ensureDbReady() {
    if (!dbPool) return Promise.resolve();
    if (!dbInitPromise) {
        dbInitPromise = ensureSupabaseDatabaseAndAdmin().catch((err) => {
            dbInitPromise = null;
            console.error('[Supabase PostgreSQL] Fallo en inicialización diferida:', err.message);
        });
    }
    return dbInitPromise;
}

ensureDbReady();

async function findUserByEmail(email) {
    const cleanEmail = String(email || '').trim();
    if (!cleanEmail) return null;

    if (dbPool) {
        try {
            await ensureDbReady();
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

    if (IS_SERVERLESS && ADMIN_EMAIL && cleanEmail.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
        return {
            id: 'USR-ADMIN-SUP-01',
            name: 'Administrador General Éxodo',
            email: ADMIN_EMAIL,
            passwordHash: ADMIN_PASSWORD_HASH,
            role: 'Administrador',
            authProvider: 'local',
            googleId: null,
            googleOauthDisabled: true,
            billing: null
        };
    }

    const users = readJsonArray(USERS_FILE, []);
    return users.find(u => String(u.email || '').toLowerCase() === cleanEmail.toLowerCase()) || null;
}

async function saveOrUpdateUser(userObj) {
    const billing = normalizeBilling(userObj.billing);
    if (dbPool) {
        try {
            await ensureDbReady();
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
            if (IS_SERVERLESS) return;
        } catch (err) {
            console.error('[Supabase saveOrUpdateUser Error]:', err.message);
        }
    }

    if (!IS_SERVERLESS) {
        const users = readJsonArray(USERS_FILE, []);
        const idx = users.findIndex(u => String(u.email || '').toLowerCase() === String(userObj.email || '').toLowerCase());
        if (idx === -1) {
            users.push({ ...userObj, billing });
        } else {
            users[idx] = { ...users[idx], ...userObj, billing };
        }
        writeJsonArray(USERS_FILE, users);
    }
}

async function generateUniqueOrderFolio() {
    for (let attempt = 0; attempt < 15; attempt++) {
        const randomDigits = Math.floor(1000 + Math.random() * 9000);
        const candidate = `AH-2026-${randomDigits}`;

        if (dbPool) {
            try {
                await ensureDbReady();
                const { rows } = await dbPool.query(
                    'SELECT 1 FROM public.orders WHERE UPPER(folio) = UPPER($1) LIMIT 1',
                    [candidate]
                );
                if (rows.length === 0) return candidate;
                continue;
            } catch (err) {
                console.error('[Supabase generateUniqueOrderFolio Error]:', err.message);
            }
        }

        const existingOrders = readJsonArray(ORDERS_FILE, []);
        if (!existingOrders.some(o => (o.folio || o.orderId) === candidate)) {
            return candidate;
        }
    }
    return `AH-2026-${Date.now().toString().slice(-4)}`;
}

async function listOrdersFromStore() {
    if (dbPool) {
        try {
            await ensureDbReady();
            const { rows } = await dbPool.query(
                'SELECT * FROM public.orders ORDER BY created_at DESC, id DESC'
            );
            return rows.map(mapOrderRowToRecord);
        } catch (err) {
            console.error('[Supabase listOrdersFromStore Error]:', err.message);
        }
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
        try {
            await ensureDbReady();
            const { rows } = await dbPool.query(
                'SELECT * FROM public.orders WHERE UPPER(folio) = UPPER($1) OR CAST(id AS TEXT) = $1 LIMIT 1',
                [lookup]
            );
            if (rows.length > 0) return mapOrderRowToRecord(rows[0]);
        } catch (err) {
            console.error('[Supabase getOrderFromStore Error]:', err.message);
        }
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
        try {
            await ensureDbReady();
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
                if (!IS_SERVERLESS) {
                    const existingOrders = readJsonArray(ORDERS_FILE, []);
                    existingOrders.unshift(savedFromDb);
                    writeJsonArray(ORDERS_FILE, existingOrders);
                }
                return savedFromDb;
            }
        } catch (err) {
            console.error('[Supabase insertOrderIntoStore Error]:', err.message);
            if (IS_SERVERLESS) throw err;
        }
    }

    if (!IS_SERVERLESS) {
        const existingOrders = readJsonArray(ORDERS_FILE, []);
        existingOrders.unshift(normalized);
        writeJsonArray(ORDERS_FILE, existingOrders);
    }
    return normalized;
}

async function updateOrderPaymentInStore(idOrFolio, paymentStatus, paymentPatch = {}) {
    const lookup = String(idOrFolio || '').trim();
    if (!lookup) return null;

    const existing = await getOrderFromStore(lookup);
    const mergedPayment = {
        ...(existing ? existing.payment : {}),
        ...paymentPatch,
        status: paymentStatus
    };

    let updatedOrder = null;

    if (dbPool) {
        try {
            await ensureDbReady();
            const { rows } = await dbPool.query(
                `UPDATE public.orders
                 SET payment_status = $1,
                     payment_details = $2,
                     updated_at = NOW()
                 WHERE UPPER(folio) = UPPER($3) OR CAST(id AS TEXT) = $3
                 RETURNING *`,
                [paymentStatus, JSON.stringify(mergedPayment), lookup]
            );
            if (rows.length > 0) {
                updatedOrder = mapOrderRowToRecord(rows[0]);
            }
        } catch (err) {
            console.error('[Supabase updateOrderPaymentInStore Error]:', err.message);
        }
    }

    if (!IS_SERVERLESS) {
        const localOrders = readJsonArray(ORDERS_FILE, []);
        const idx = localOrders.findIndex(
            o =>
                String(o.folio || o.orderId || '').toUpperCase() === lookup.toUpperCase() ||
                String(o.id || '') === lookup
        );
        if (idx !== -1) {
            localOrders[idx].payment_status = paymentStatus;
            localOrders[idx].payment = {
                ...(localOrders[idx].payment || {}),
                ...mergedPayment
            };
            writeJsonArray(ORDERS_FILE, localOrders);
            if (!updatedOrder) {
                updatedOrder = mapOrderRowToRecord(localOrders[idx]);
            }
        }
    }

    return updatedOrder;
}

async function updateOrderStageInStore(idOrFolio, newStage) {
    const lookup = String(idOrFolio || '').trim();
    let updatedOrder = null;

    if (dbPool) {
        try {
            await ensureDbReady();
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
        } catch (err) {
            console.error('[Supabase updateOrderStageInStore Error]:', err.message);
        }
    }

    if (!IS_SERVERLESS) {
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
    }

    return updatedOrder;
}

async function listCouponsFromStore() {
    if (dbPool) {
        try {
            await ensureDbReady();
            const { rows } = await dbPool.query(
                'SELECT * FROM public.coupons ORDER BY created_at ASC, code ASC'
            );
            if (rows.length > 0) {
                return rows.map(mapCouponRowToRecord);
            }
        } catch (err) {
            console.error('[Supabase listCouponsFromStore Error]:', err.message);
        }
    }
    return readJsonArray(COUPONS_FILE, DEFAULT_COUPONS).map(mapCouponRowToRecord);
}

async function getCouponFromStore(codeInput) {
    const normalizedCode = String(codeInput || '').trim().toUpperCase();
    if (!normalizedCode) return null;

    if (dbPool) {
        try {
            await ensureDbReady();
            const { rows } = await dbPool.query(
                'SELECT * FROM public.coupons WHERE UPPER(code) = UPPER($1) LIMIT 1',
                [normalizedCode]
            );
            if (rows.length > 0) {
                return mapCouponRowToRecord(rows[0]);
            }
            return null;
        } catch (err) {
            console.error('[Supabase getCouponFromStore Error]:', err.message);
        }
    }

    const coupons = readJsonArray(COUPONS_FILE, DEFAULT_COUPONS).map(mapCouponRowToRecord);
    return coupons.find(c => c.code === normalizedCode) || null;
}

async function createCouponInStore({ code, discountType, discountValue, minSubtotal, description }) {
    const cleanCode = String(code || '').trim().toUpperCase();
    const type = discountType === 'fixed' ? 'fixed' : 'percentage';
    const val = Number(discountValue) || 0;
    const minSub = Number(minSubtotal) || 0;
    const expiresAt = '2027-12-31T23:59:59.000Z';
    const desc = String(description || '').trim();

    if (dbPool) {
        try {
            await ensureDbReady();
            const { rows } = await dbPool.query(
                `INSERT INTO public.coupons (
                    code, discount_type, discount_value, min_subtotal, active, expires_at, description
                ) VALUES ($1, $2, $3, $4, TRUE, $5, $6)
                ON CONFLICT (code) DO UPDATE SET
                    discount_type = EXCLUDED.discount_type,
                    discount_value = EXCLUDED.discount_value,
                    min_subtotal = EXCLUDED.min_subtotal,
                    active = TRUE,
                    description = EXCLUDED.description,
                    updated_at = NOW()
                RETURNING *`,
                [cleanCode, type, val, minSub, expiresAt, desc]
            );
            if (rows.length > 0) {
                const record = mapCouponRowToRecord(rows[0]);
                if (!IS_SERVERLESS) {
                    const local = readJsonArray(COUPONS_FILE, DEFAULT_COUPONS).filter(c => String(c.code).toUpperCase() !== cleanCode);
                    local.push(record);
                    writeJsonArray(COUPONS_FILE, local);
                }
                return record;
            }
        } catch (err) {
            console.error('[Supabase createCouponInStore Error]:', err.message);
        }
    }

    const newCoupon = mapCouponRowToRecord({
        code: cleanCode,
        discount_type: type,
        discount_value: val,
        min_subtotal: minSub,
        active: true,
        expires_at: expiresAt,
        description: desc
    });

    if (!IS_SERVERLESS) {
        const coupons = readJsonArray(COUPONS_FILE, DEFAULT_COUPONS).filter(c => String(c.code).toUpperCase() !== cleanCode);
        coupons.push(newCoupon);
        writeJsonArray(COUPONS_FILE, coupons);
    }
    return newCoupon;
}

async function deleteCouponFromStore(codeInput) {
    const cleanCode = String(codeInput || '').trim().toUpperCase();
    if (!cleanCode) return false;

    if (dbPool) {
        try {
            await ensureDbReady();
            await dbPool.query('DELETE FROM public.coupons WHERE UPPER(code) = UPPER($1)', [cleanCode]);
        } catch (err) {
            console.error('[Supabase deleteCouponFromStore Error]:', err.message);
        }
    }

    if (!IS_SERVERLESS) {
        const coupons = readJsonArray(COUPONS_FILE, DEFAULT_COUPONS).filter(
            c => String(c.code).toUpperCase() !== cleanCode
        );
        writeJsonArray(COUPONS_FILE, coupons);
    }
    return true;
}

async function evaluateCoupon(codeInput, subtotal) {
    const normalizedCode = String(codeInput || '').trim().toUpperCase();
    if (!normalizedCode) {
        return { valid: false, status: 400, error: 'Ingresa un código de cupón.' };
    }

    const coupon = await getCouponFromStore(normalizedCode);

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
    if (coupon.discount_type === 'percentage') {
        discountAmount = Math.round((numericSubtotal * (Number(coupon.discount_value) / 100)) * 100) / 100;
    } else {
        discountAmount = Math.min(numericSubtotal, Number(coupon.discount_value) || 0);
    }

    return {
        valid: true,
        status: 200,
        coupon: {
            code: coupon.code,
            discount_type: coupon.discount_type,
            type: coupon.discount_type,
            discount_value: coupon.discount_value,
            value: coupon.discount_value,
            minSubtotal: coupon.minSubtotal,
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
 * 1. ENDPOINT DE SALUD DEL SERVIDOR Y VERIFICACIÓN DE CONEXIÓN A SUPABASE
 */
app.get('/api/health', async (req, res) => {
    let dbConnected = false;
    let dbError = null;
    if (dbPool) {
        try {
            await dbPool.query('SELECT 1');
            dbConnected = true;
        } catch (err) {
            dbError = err.message;
        }
    }

    res.status(200).json({
        status: 'ok',
        appUrl: APP_URL,
        serverless: IS_SERVERLESS,
        database: IS_SUPABASE_CONFIGURED ? 'supabase_postgresql' : 'local_json_fallback',
        databaseConnected: dbConnected,
        databaseError: dbError,
        mercadoPagoConfigured: IS_MP_CONFIGURED,
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development'
    });
});

/**
 * 1B. CONFIGURACIÓN PÚBLICA (Sin exponer jamás MP_ACCESS_TOKEN, DATABASE_URL ni credenciales administrativas)
 */
app.get('/api/config/public', (req, res) => {
    const isGoogleConfigured =
        Boolean(GOOGLE_CLIENT_ID) &&
        GOOGLE_CLIENT_ID !== 'TU_GOOGLE_CLIENT_ID.apps.googleusercontent.com';

    res.status(200).json({
        appUrl: APP_URL,
        googleClientId: isGoogleConfigured ? GOOGLE_CLIENT_ID : null,
        mpPublicKey: MP_PUBLIC_KEY || null,
        mercadoPagoEnabled: IS_MP_CONFIGURED,
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
 * 3. VALIDACIÓN DE CUPONES DE DESCUENTO EN SUPABASE (RF-13)
 */
app.post('/api/coupons/validate', async (req, res) => {
    try {
        const { code, subtotal } = req.body || {};
        const evaluation = await evaluateCoupon(code, subtotal);

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
    } catch (error) {
        console.error('Error en POST /api/coupons/validate:', error);
        return res.status(500).json({
            valid: false,
            error: 'No se pudo validar el cupón en este momento.'
        });
    }
});

/**
 * Utilidad compartida para validar artículos del carrito, cupón en Supabase y totales en el servidor
 */
async function prepareValidatedOrderItemsAndPricing({ rawItems, couponCode, folio }) {
    const processedItems = [];
    let subtotal = 0;

    for (let idx = 0; idx < rawItems.length; idx++) {
        const item = rawItems[idx];

        if (!item || !item.garmentType || !item.garmentName || typeof (item.unitPrice ?? item.price) === 'undefined' || !item.fabricColor) {
            return {
                ok: false,
                status: 400,
                error: `Faltan datos obligatorios en el artículo #${idx + 1} del carrito.`
            };
        }

        const quantity = Math.max(1, parseInt(item.quantity, 10) || 1);
        const unitPrice = Number(item.unitPrice !== undefined ? item.unitPrice : item.price);
        if (Number.isNaN(unitPrice) || unitPrice < 0) {
            return {
                ok: false,
                status: 400,
                error: `El precio del artículo #${idx + 1} no es válido.`
            };
        }

        let savedImageRelativeUrl = item.embroideryImageUrl || null;
        if (item.embroideryDataUrl && typeof item.embroideryDataUrl === 'string') {
            const base64Match = item.embroideryDataUrl.match(/^data:image\/([a-zA-Z0-9+]+);base64,(.+)$/);
            if (base64Match && base64Match[2]) {
                if (!IS_SERVERLESS) {
                    try {
                        const imageBuffer = Buffer.from(base64Match[2], 'base64');
                        const suffix = rawItems.length === 1 ? '' : `-${idx + 1}`;
                        const fileName = `${folio}${suffix}.png`;
                        const filePath = path.join(UPLOADS_DIR, fileName);
                        fs.writeFileSync(filePath, imageBuffer);
                        savedImageRelativeUrl = `/api/uploads/${fileName}`;
                    } catch (_) {
                        savedImageRelativeUrl = item.embroideryDataUrl;
                    }
                } else {
                    savedImageRelativeUrl = item.embroideryDataUrl;
                }
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

    subtotal = Math.round(subtotal * 100) / 100;

    let appliedCoupon = null;
    let discount = 0;
    if (couponCode) {
        const couponResult = await evaluateCoupon(couponCode, subtotal);
        if (!couponResult.valid) {
            return {
                ok: false,
                status: couponResult.status,
                error: couponResult.error
            };
        }
        appliedCoupon = couponResult.coupon;
        discount = couponResult.discountAmount;
    }

    const taxableBase = Math.max(0, subtotal - discount);
    const tax = Math.round(taxableBase * TAX_RATE * 100) / 100;
    const total = Math.round((taxableBase + tax) * 100) / 100;

    return {
        ok: true,
        processedItems,
        subtotal,
        discount,
        tax,
        total,
        appliedCoupon
    };
}

function resolveDynamicAppUrl(req) {
    if (process.env.APP_URL && String(process.env.APP_URL).trim()) {
        return String(process.env.APP_URL).trim().replace(/\/+$/, '');
    }
    const originHeader = req.headers.origin;
    if (originHeader && /^https?:\/\//i.test(originHeader)) {
        return originHeader.replace(/\/+$/, '');
    }
    const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
    const host = (req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`).split(',')[0].trim();
    return `${proto}://${host}`.replace(/\/+$/, '');
}

/**
 * 4. REGISTRO DE PEDIDOS EN SUPABASE (POST /api/orders)
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

        const folio = await generateUniqueOrderFolio();
        const validation = await prepareValidatedOrderItemsAndPricing({
            rawItems,
            couponCode,
            folio
        });

        if (!validation.ok) {
            return res.status(validation.status).json({
                success: false,
                error: validation.error
            });
        }

        const { processedItems, subtotal, discount, tax, total, appliedCoupon } = validation;

        const paymentStatusMap = {
            mercadopago: 'pending',
            card: 'PAGADO_SIMULADO',
            paypal: 'PAGADO_SIMULADO',
            transfer: 'PENDIENTE_COMPROBANTE_SPEI',
            branch: 'PENDIENTE_PAGO_SUCURSAL'
        };

        const sanitizedPayment = {
            method: paymentMethod,
            methodLabel: (payment && payment.methodLabel) ? String(payment.methodLabel) : paymentMethod,
            status: (payment && payment.status) ? String(payment.status) : paymentStatusMap[paymentMethod],
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
            folio,
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
// 4B. INTEGRACIÓN DE PAGOS CON MERCADO PAGO (/api/payments/...)
// ============================================================================

/**
 * POST /api/payments/create-preference
 * 1. Recibe los artículos del carrito, datos del cliente/facturación y el código de cupón.
 * 2. Valida el cupón contra la tabla public.coupons en Supabase y calcula subtotal, descuento, IVA y total en el servidor.
 * 3. Genera un folio único (AH-2026-XXXX) y guarda el pedido en public.orders con payment_status = 'pending' y production_stage = 'Cotización'.
 * 4. Crea la preferencia de pago en Mercado Pago con back_urls (success, failure, pending) dinámicas y devuelve init_point / sandbox_init_point y el folio.
 */
app.post('/api/payments/create-preference', async (req, res) => {
    try {
        const { user, items, order, billing, couponCode, createdAt } = req.body || {};

        if (!user || !user.name || !user.email) {
            return res.status(400).json({
                success: false,
                error: 'Inicia sesión o proporciona nombre y correo del cliente antes de pagar con Mercado Pago.'
            });
        }

        const rawItems = Array.isArray(items) && items.length > 0
            ? items
            : (order ? [order] : []);

        if (rawItems.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'El carrito está vacío. Agrega al menos un artículo antes de proceder al pago.'
            });
        }

        const folio = await generateUniqueOrderFolio();
        const validation = await prepareValidatedOrderItemsAndPricing({
            rawItems,
            couponCode,
            folio
        });

        if (!validation.ok) {
            return res.status(validation.status).json({
                success: false,
                error: validation.error
            });
        }

        const { processedItems, subtotal, discount, tax, total, appliedCoupon } = validation;
        const normalizedBilling = normalizeBilling(billing);
        const orderTimestamp = createdAt || new Date().toISOString();
        const baseUrl = resolveDynamicAppUrl(req);

        const backUrls = {
            success: `${baseUrl}/login/login.html?mp_status=approved&folio=${encodeURIComponent(folio)}`,
            failure: `${baseUrl}/login/login.html?mp_status=rejected&folio=${encodeURIComponent(folio)}`,
            pending: `${baseUrl}/login/login.html?mp_status=pending&folio=${encodeURIComponent(folio)}`
        };

        const initialPaymentDetails = {
            method: 'mercadopago',
            methodLabel: 'Mercado Pago Checkout Pro',
            status: 'pending',
            reference: `MP-${folio}`,
            preferenceId: null,
            init_point: null,
            sandbox_init_point: null
        };

        // Guardar orden inicial en Supabase con payment_status = 'pending' y etapa = 'Cotización'
        let savedOrder = await insertOrderIntoStore({
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
            payment_method: 'mercadopago',
            payment_status: 'pending',
            payment: initialPaymentDetails
        });

        // Construir items para Mercado Pago asegurando que el importe total cobrado coincida exactamente con "total"
        let mpItems = [];
        if (discount === 0 && tax > 0) {
            mpItems = processedItems.map((it) => ({
                id: `${folio}-${it.itemIndex}`,
                title: `${it.garmentName} (${it.techniqueName})`,
                description: `Color: ${it.fabricColorName || it.fabricColor} • Cant: ${it.quantity}`,
                category_id: 'fashion',
                quantity: Number(it.quantity),
                unit_price: Number(Number(it.unitPrice).toFixed(2)),
                currency_id: 'MXN'
            }));
            mpItems.push({
                id: `${folio}-IVA`,
                title: `IVA (${Math.round(TAX_RATE * 100)}%) — Orden ${folio}`,
                description: 'Impuesto al Valor Agregado',
                category_id: 'others',
                quantity: 1,
                unit_price: Number(Number(tax).toFixed(2)),
                currency_id: 'MXN'
            });
        } else {
            const summaryLabel = processedItems
                .map(it => `${it.quantity}x ${it.garmentName}`)
                .join(', ')
                .slice(0, 180);
            mpItems = [
                {
                    id: folio,
                    title: `Pedido ${folio} — ${summaryLabel}`,
                    description: `Subtotal $${subtotal.toFixed(2)}${appliedCoupon ? ` - Cupón ${appliedCoupon.code} ($${discount.toFixed(2)})` : ''} + IVA ($${tax.toFixed(2)})`,
                    category_id: 'fashion',
                    quantity: 1,
                    unit_price: Number(Number(total).toFixed(2)),
                    currency_id: 'MXN'
                }
            ];
        }

        let preferenceId = null;
        let initPoint = null;
        let sandboxInitPoint = null;
        let simulatedSandbox = false;

        const mpClient = getMercadoPagoClient();
        if (mpClient) {
            const preferenceApi = new Preference(mpClient);
            const preferenceBody = {
                items: mpItems,
                payer: {
                    name: String(user.name).trim(),
                    email: String(user.email).trim()
                },
                external_reference: folio,
                back_urls: backUrls,
                auto_return: 'approved',
                statement_descriptor: 'EXODO BORDADOS',
                metadata: {
                    folio,
                    customer_email: user.email,
                    coupon_code: appliedCoupon ? appliedCoupon.code : null,
                    subtotal,
                    discount,
                    tax,
                    total
                }
            };

            let mpResponse = null;
            try {
                mpResponse = await preferenceApi.create({ body: preferenceBody });
            } catch (mpErr) {
                // En desarrollo local con http://localhost, algunas cuentas de MP rechazan auto_return en HTTP no-SSL.
                // Reintentamos automáticamente sin auto_return para no bloquear pruebas locales.
                const errMsg = String(mpErr?.message || '');
                if (/auto_return|back_url/i.test(errMsg)) {
                    const fallbackBody = { ...preferenceBody };
                    delete fallbackBody.auto_return;
                    mpResponse = await preferenceApi.create({ body: fallbackBody });
                } else {
                    throw mpErr;
                }
            }

            preferenceId = mpResponse.id || null;
            initPoint = mpResponse.init_point || null;
            sandboxInitPoint = mpResponse.sandbox_init_point || mpResponse.init_point || null;
        } else {
            // Modo sandbox local simulado si aún no se ha configurado MP_ACCESS_TOKEN en .env
            simulatedSandbox = true;
            preferenceId = `PREF-SANDBOX-${folio}-${Date.now().toString(36).toUpperCase()}`;
            sandboxInitPoint = `${backUrls.success}&preference_id=${encodeURIComponent(preferenceId)}&payment_id=SIM-${Date.now()}&status=approved&collection_status=approved`;
            initPoint = sandboxInitPoint;
        }

        const updatedOrder = await updateOrderPaymentInStore(folio, 'pending', {
            method: 'mercadopago',
            methodLabel: 'Mercado Pago Checkout Pro',
            reference: preferenceId ? `MP-${preferenceId}` : `MP-${folio}`,
            preferenceId,
            init_point: initPoint,
            sandbox_init_point: sandboxInitPoint
        });

        if (updatedOrder) {
            savedOrder = updatedOrder;
        }

        return res.status(201).json({
            success: true,
            folio,
            orderId: folio,
            preferenceId,
            init_point: initPoint,
            sandbox_init_point: sandboxInitPoint,
            back_urls: backUrls,
            simulatedSandbox,
            pricing: {
                subtotal,
                discount,
                taxRate: TAX_RATE,
                tax,
                total,
                currency: 'MXN',
                coupon: appliedCoupon
            },
            orderRecord: savedOrder,
            message: 'Preferencia de Mercado Pago creada y pedido registrado en Supabase.'
        });
    } catch (error) {
        console.error('Error en POST /api/payments/create-preference:', error);
        return res.status(500).json({
            success: false,
            error: 'No se pudo generar la preferencia de pago en Mercado Pago.',
            details: error.message
        });
    }
});

/**
 * POST /api/payments/confirm-return
 * Verifica el retorno del usuario desde las back_urls de Mercado Pago (success, failure, pending),
 * actualiza el estado del pago en la tabla public.orders de Supabase y devuelve el registro para imprimir el recibo.
 */
app.post('/api/payments/confirm-return', async (req, res) => {
    try {
        const {
            folio,
            external_reference,
            payment_id,
            collection_id,
            status,
            collection_status,
            mp_status,
            preference_id,
            payment_type
        } = req.body || {};

        const targetFolio = String(folio || external_reference || '').trim().toUpperCase();
        if (!targetFolio) {
            return res.status(400).json({
                success: false,
                error: 'Falta el folio del pedido para confirmar el estado del pago.'
            });
        }

        const existingOrder = await getOrderFromStore(targetFolio);
        if (!existingOrder) {
            return res.status(404).json({
                success: false,
                error: `No se encontró el pedido con folio ${targetFolio} en Supabase.`
            });
        }

        const resolvedPaymentId = String(payment_id || collection_id || '').trim() || null;
        let rawStatus = String(status || collection_status || mp_status || 'pending').trim().toLowerCase();

        // Si tenemos un payment_id real numérico y MP_ACCESS_TOKEN configurado, consultamos a Mercado Pago para confirmar
        const mpClient = getMercadoPagoClient();
        if (mpClient && Payment && resolvedPaymentId && /^\d+$/.test(resolvedPaymentId)) {
            try {
                const paymentApi = new Payment(mpClient);
                const mpPayment = await paymentApi.get({ id: resolvedPaymentId });
                if (mpPayment && mpPayment.status) {
                    rawStatus = String(mpPayment.status).toLowerCase();
                }
            } catch (verifyErr) {
                console.warn(`[Mercado Pago Verify Warning] No se pudo consultar payment_id ${resolvedPaymentId}:`, verifyErr.message);
            }
        }

        let normalizedPaymentStatus = 'pending';
        if (['approved', 'success', ' accredited'].includes(rawStatus)) {
            normalizedPaymentStatus = 'approved';
        } else if (['rejected', 'failure', 'cancelled', 'canceled', 'charged_back', 'refunded'].includes(rawStatus)) {
            normalizedPaymentStatus = 'rejected';
        } else {
            normalizedPaymentStatus = 'pending';
        }

        const updatedOrder = await updateOrderPaymentInStore(targetFolio, normalizedPaymentStatus, {
            method: 'mercadopago',
            methodLabel: 'Mercado Pago Checkout Pro',
            status: normalizedPaymentStatus,
            paymentId: resolvedPaymentId || existingOrder.payment?.paymentId || null,
            preferenceId: preference_id || existingOrder.payment?.preferenceId || null,
            paymentType: payment_type || null,
            reference: resolvedPaymentId
                ? `MP-PAY-${resolvedPaymentId}`
                : (existingOrder.payment?.reference || `MP-${targetFolio}`)
        });

        const finalOrder = updatedOrder || existingOrder;
        const emailNotification = {
            simulated: true,
            to: finalOrder.customer_email,
            billingCopyTo: finalOrder.billing?.billingEmail || null,
            subject: `Comprobante de Pedido ${finalOrder.folio} (${normalizedPaymentStatus.toUpperCase()}) — Atelier Hilo × Éxodo Bordados`,
            sentAt: new Date().toISOString()
        };

        return res.status(200).json({
            success: true,
            folio: finalOrder.folio,
            orderId: finalOrder.folio,
            paymentStatus: normalizedPaymentStatus,
            orderRecord: finalOrder,
            emailNotification
        });
    } catch (error) {
        console.error('Error en POST /api/payments/confirm-return:', error);
        return res.status(500).json({
            success: false,
            error: 'Error al confirmar el estado del pago del pedido.'
        });
    }
});

/**
 * POST /api/payments/webhook
 * Webhook oficial para notificaciones asíncronas de Mercado Pago.
 */
app.post('/api/payments/webhook', async (req, res) => {
    try {
        const topic = req.query?.topic || req.query?.type || req.body?.type || req.body?.topic;
        const dataId = req.query?.['data.id'] || req.query?.id || req.body?.data?.id;

        if ((topic === 'payment' || req.body?.action?.startsWith('payment.')) && dataId) {
            const mpClient = getMercadoPagoClient();
            if (mpClient && Payment && /^\d+$/.test(String(dataId))) {
                const paymentApi = new Payment(mpClient);
                const mpPayment = await paymentApi.get({ id: String(dataId) });
                const folio = mpPayment?.external_reference || mpPayment?.metadata?.folio;
                const mpStatus = String(mpPayment?.status || 'pending').toLowerCase();

                if (folio) {
                    const normalizedStatus = mpStatus === 'approved'
                        ? 'approved'
                        : (['rejected', 'cancelled'].includes(mpStatus) ? 'rejected' : 'pending');

                    await updateOrderPaymentInStore(folio, normalizedStatus, {
                        method: 'mercadopago',
                        methodLabel: 'Mercado Pago Checkout Pro',
                        paymentId: String(dataId),
                        reference: `MP-PAY-${dataId}`
                    });
                }
            }
        }

        return res.status(200).json({ received: true });
    } catch (error) {
        console.error('Error en POST /api/payments/webhook:', error.message);
        return res.status(200).json({ received: true, warning: error.message });
    }
});

// ============================================================================
// 5. SECCIÓN DE ADMINISTRACIÓN Y GESTIÓN DE PEDIDOS (PROTEGIDA CON ROL ADMIN)
// ============================================================================
const PRODUCTS_FILE = path.join(DATA_DIR, 'products.json');
const INVENTORY_FILE = path.join(DATA_DIR, 'inventory.json');
const QUOTES_FILE = path.join(DATA_DIR, 'quotes.json');

function initJsonFile(filePath, defaultData) {
    if (IS_SERVERLESS) return;
    try {
        if (!fs.existsSync(filePath)) {
            fs.writeFileSync(filePath, JSON.stringify(defaultData, null, 2), 'utf8');
        }
    } catch (_) {}
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
 * Permite consulta por folio exacto (AH-2026-XXXX) para seguimiento y comprobante post-pago,
 * o consulta autenticada por ID para el propietario o Administrador.
 */
app.get('/api/orders/:orderId', async (req, res) => {
    try {
        const lookup = String(req.params.orderId || '').trim();
        const found = await getOrderFromStore(lookup);
        if (!found) {
            return res.status(404).json({
                success: false,
                error: `Pedido ${lookup} no encontrado.`
            });
        }

        const isExactFolioLookup = /^AH-\d{4}-\d{4,}$/i.test(lookup);
        if (!isExactFolioLookup) {
            const token = extractTokenFromRequest(req);
            const decoded = verifySessionToken(token);
            if (!decoded) {
                return res.status(401).json({
                    success: false,
                    error: 'Inicia sesión o proporciona el folio completo del pedido.'
                });
            }
            const isOwner =
                String(found.customer_email || '').toLowerCase() ===
                String(decoded.email || '').toLowerCase();
            if (decoded.role !== 'Administrador' && !isOwner) {
                return res.status(403).json({
                    success: false,
                    error: 'No tienes permiso para inspeccionar este pedido.'
                });
            }
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

// Promociones y Cupones en Supabase (Protegido para Administrador; la tienda valida mediante POST /api/coupons/validate)
app.get('/api/coupons', requireAdmin, async (req, res) => {
    try {
        const coupons = await listCouponsFromStore();
        res.json(coupons);
    } catch (error) {
        console.error('Error en GET /api/coupons:', error);
        res.status(500).json({ error: 'No se pudieron consultar los cupones.' });
    }
});

app.post('/api/coupons', requireAdmin, async (req, res) => {
    try {
        const { code, discountPercent, discount_type, discount_value, min_subtotal, description } = req.body || {};
        const resolvedValue = Number(discount_value ?? discountPercent);
        if (!code || !resolvedValue) {
            return res.status(400).json({ error: 'Código y valor de descuento obligatorios' });
        }
        const created = await createCouponInStore({
            code,
            discountType: discount_type || 'percentage',
            discountValue: resolvedValue,
            minSubtotal: Number(min_subtotal) || 0,
            description: description || ''
        });
        res.status(201).json(created);
    } catch (error) {
        console.error('Error en POST /api/coupons:', error);
        res.status(500).json({ error: 'No se pudo crear el cupón.' });
    }
});

app.delete('/api/coupons/:code', requireAdmin, async (req, res) => {
    try {
        await deleteCouponFromStore(req.params.code);
        res.json({ success: true });
    } catch (error) {
        console.error('Error en DELETE /api/coupons/:code:', error);
        res.status(500).json({ error: 'No se pudo eliminar el cupón.' });
    }
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

// Escuchar únicamente cuando se ejecuta directamente como servidor standalone (Local / EC2)
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`==================================================================`);
        console.log(`  ATELIER HILO / ÉXODO BORDADOS — Backend Activo en Puerto ${PORT}`);
        console.log(`  App URL:         ${APP_URL}`);
        console.log(`  Base de Datos:   ${IS_SUPABASE_CONFIGURED ? 'Supabase PostgreSQL (SSL)' : 'Local JSON Fallback (Configura DATABASE_URL en .env)'}`);
        console.log(`  Mercado Pago:    ${IS_MP_CONFIGURED ? 'SDK Oficial Activo' : 'Modo Sandbox Local (Configura MP_ACCESS_TOKEN en .env)'}`);
        console.log(`  Frontend Home:   ${APP_URL}/home/index.html`);
        console.log(`  Panel Admin:     ${APP_URL}/admin/admin.html`);
        console.log(`  Estudio 3D:      ${APP_URL}/Models/models.html`);
        console.log(`  Checkout Login:  ${APP_URL}/login/login.html`);
        console.log(`  Healthcheck API: ${APP_URL}/api/health`);
        console.log(`==================================================================`);
    });
}

// Exportar instancia de Express para compatibilidad serverless con Vercel
module.exports = app;
