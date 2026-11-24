/**
 * ATELIER HILO / ÉXODO BORDADOS — Backend API (Node.js + Express)
 * Preparado para desarrollo local y producción en AWS EC2 (Ubuntu + Nginx + PM2)
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { OAuth2Client } = require('google-auth-library');

const app = express();
const PORT = process.env.PORT || 3000;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'TU_GOOGLE_CLIENT_ID.apps.googleusercontent.com';

const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

// Rutas de almacenamiento persistente en disco
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const DATA_DIR = path.join(__dirname, 'data');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');

// Asegurar que las carpetas uploads/ y data/ existan al arrancar
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(ORDERS_FILE)) {
    fs.writeFileSync(ORDERS_FILE, JSON.stringify([], null, 2), 'utf8');
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

/**
 * 1. ENDPOINT DE SALUD DEL SERVIDOR (Healthcheck para AWS EC2 / Nginx)
 */
app.get('/api/health', (req, res) => {
    res.status(200).json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development'
    });
});

/**
 * 2. ENDPOINT DE AUTENTICACIÓN CON GOOGLE (OAuth 2.0 / Modo Demo Local)
 */
app.post('/api/auth/google', async (req, res) => {
    try {
        const { credential, googleJwt, name, email } = req.body || {};
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

        // Modo demostración local o cuando aún no se configura GOOGLE_CLIENT_ID en .env
        if (token === 'DEV_LOCAL_TOKEN_SIMULATED' || isPlaceholderClientId) {
            let resolvedName = name || 'Cliente Verificado (Google OAuth)';
            let resolvedEmail = email || 'cliente.verificado@gmail.com';

            // Si viene un JWT con estructura estándar y el Client ID aún es placeholder, decodificar payload básico
            if (token !== 'DEV_LOCAL_TOKEN_SIMULATED' && token.split('.').length === 3) {
                try {
                    const payloadJson = Buffer.from(token.split('.')[1], 'base64url').toString('utf8');
                    const decoded = JSON.parse(payloadJson);
                    resolvedName = decoded.name || resolvedName;
                    resolvedEmail = decoded.email || resolvedEmail;
                } catch (_) {}
            }

            return res.status(200).json({
                verified: true,
                mode: 'demo_or_unconfigured_client',
                user: {
                    name: resolvedName,
                    email: resolvedEmail
                }
            });
        }

        // Verificación criptográfica real con Google Identity Services
        const ticket = await googleClient.verifyIdToken({
            idToken: token,
            audience: GOOGLE_CLIENT_ID
        });

        const payload = ticket.getPayload();
        return res.status(200).json({
            verified: true,
            mode: 'google_verified',
            user: {
                name: payload.name,
                email: payload.email,
                picture: payload.picture || null,
                sub: payload.sub
            }
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
 * 3. ENDPOINT DE REGISTRO DE PEDIDOS DE TALLER (POST /api/orders)
 */
app.post('/api/orders', (req, res) => {
    try {
        const { user, order, createdAt } = req.body || {};

        // Validar datos del usuario autenticado
        if (!user || !user.name || !user.email) {
            return res.status(400).json({
                success: false,
                error: 'Faltan los datos del usuario autenticado (user.name, user.email).'
            });
        }

        // Validar estructura obligatoria de la orden (orderState / currentOrder)
        if (!order || !order.garmentType || !order.garmentName || typeof order.price === 'undefined' || !order.fabricColor) {
            return res.status(400).json({
                success: false,
                error: 'Faltan datos obligatorios de la prenda en el objeto order.'
            });
        }

        const requiredNumericFields = ['logoX', 'logoY', 'logoScale', 'stitchDensity', 'stitchCount'];
        for (const field of requiredNumericFields) {
            if (typeof order[field] === 'undefined' || order[field] === null || Number.isNaN(Number(order[field]))) {
                return res.status(400).json({
                    success: false,
                    error: `El campo numérico order.${field} es obligatorio.`
                });
            }
        }

        if (!order.embroideryDataUrl || typeof order.embroideryDataUrl !== 'string') {
            return res.status(400).json({
                success: false,
                error: 'Falta la imagen procesada del diseño (order.embroideryDataUrl).'
            });
        }

        // Generar folio único de orden: AH-2026-XXXX
        const randomDigits = Math.floor(1000 + Math.random() * 9000);
        const folio = `AH-2026-${randomDigits}`;

        // Extraer Base64 de embroideryDataUrl y guardar el archivo físico en uploads/<folio>.png
        let savedImageRelativeUrl = null;
        const base64Match = order.embroideryDataUrl.match(/^data:image\/([a-zA-Z0-9+]+);base64,(.+)$/);

        if (base64Match && base64Match[2]) {
            const imageBuffer = Buffer.from(base64Match[2], 'base64');
            const fileName = `${folio}.png`;
            const filePath = path.join(UPLOADS_DIR, fileName);
            fs.writeFileSync(filePath, imageBuffer);
            savedImageRelativeUrl = `/api/uploads/${fileName}`;
        }

        // Construir registro limpio sin incrustar la cadena Base64 gigante en orders.json
        const orderRecord = {
            orderId: folio,
            createdAt: createdAt || new Date().toISOString(),
            status: 'EN_COLA_DE_TALLER',
            user: {
                name: user.name,
                email: user.email
            },
            order: {
                garmentType: order.garmentType,
                garmentName: order.garmentName,
                technique: order.technique || 'embroidery',
                techniqueName: order.techniqueName || 'Bordado 3D de Alta Precisión',
                price: Number(order.price),
                fabricColor: order.fabricColor,
                fabricColorName: order.fabricColorName || null,
                logoX: Number(order.logoX),
                logoY: Number(order.logoY),
                logoScale: Number(order.logoScale),
                stitchDensity: Number(order.stitchDensity),
                stitchCount: Number(order.stitchCount),
                printAreaCm2: order.printAreaCm2 ? Number(order.printAreaCm2) : null,
                embroideryImageUrl: savedImageRelativeUrl
            }
        };

        // Leer, agregar y persistir en data/orders.json
        let existingOrders = [];
        if (fs.existsSync(ORDERS_FILE)) {
            const rawContent = fs.readFileSync(ORDERS_FILE, 'utf8');
            existingOrders = rawContent.trim() ? JSON.parse(rawContent) : [];
        }

        existingOrders.push(orderRecord);
        fs.writeFileSync(ORDERS_FILE, JSON.stringify(existingOrders, null, 2), 'utf8');

        return res.status(201).json({
            success: true,
            orderId: folio,
            embroideryImageUrl: savedImageRelativeUrl,
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
 * 4. ENDPOINT DE AUDITORÍA Y CONSULTA DE ÓRDENES (GET /api/orders)
 */
app.get('/api/orders', (req, res) => {
    try {
        if (!fs.existsSync(ORDERS_FILE)) {
            return res.status(200).json([]);
        }
        const rawContent = fs.readFileSync(ORDERS_FILE, 'utf8');
        const orders = rawContent.trim() ? JSON.parse(rawContent) : [];
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
const COUPONS_FILE = path.join(DATA_DIR, 'coupons.json');
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

initJsonFile(COUPONS_FILE, [
    { code: 'EXODO10', discountPercent: 10, description: '10% de descuento en primera compra', active: true },
    { code: 'EMPRESA20', discountPercent: 20, description: '20% en pedidos corporativos', active: true }
]);

initJsonFile(QUOTES_FILE, []);

function readJson(filePath) {
    const raw = fs.readFileSync(filePath, 'utf8');
    return raw.trim() ? JSON.parse(raw) : [];
}

function writeJson(filePath, data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

// Servir carpeta /admin
app.use('/admin', express.static(path.join(__dirname, '../admin')));

// --- RF-01: CRUD de Productos y Servicios ---
app.get('/api/products', (req, res) => res.json(readJson(PRODUCTS_FILE)));

app.post('/api/products', (req, res) => {
    const products = readJson(PRODUCTS_FILE);
    const { name, category, price, description } = req.body;
    if (!name || !category || !price) return res.status(400).json({ error: 'Faltan campos obligatorios' });
    const newProduct = {
        id: `PRD-${String(Date.now()).slice(-4)}`,
        name,
        category,
        price: Number(price),
        description: description || ''
    };
    products.push(newProduct);
    writeJson(PRODUCTS_FILE, products);
    res.status(201).json(newProduct);
});

app.put('/api/products/:id', (req, res) => {
    const products = readJson(PRODUCTS_FILE);
    const idx = products.findIndex(p => p.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Producto no encontrado' });
    products[idx] = { ...products[idx], ...req.body, price: Number(req.body.price ?? products[idx].price) };
    writeJson(PRODUCTS_FILE, products);
    res.json(products[idx]);
});

app.delete('/api/products/:id', (req, res) => {
    const products = readJson(PRODUCTS_FILE).filter(p => p.id !== req.params.id);
    writeJson(PRODUCTS_FILE, products);
    res.json({ success: true });
});

// --- RF-09: Seguimiento y actualización de estado de pedidos ---
app.get('/api/orders/:folio', (req, res) => {
    const orders = readJson(ORDERS_FILE);
    const found = orders.find(o => o.orderId.toUpperCase() === req.params.folio.toUpperCase());
    if (!found) return res.status(404).json({ error: 'Folio no encontrado' });
    res.json(found);
});

app.patch('/api/orders/:folio/status', (req, res) => {
    const orders = readJson(ORDERS_FILE);
    const idx = orders.findIndex(o => o.orderId === req.params.folio);
    if (idx === -1) return res.status(404).json({ error: 'Pedido no encontrado' });
    orders[idx].status = req.body.status;
    writeJson(ORDERS_FILE, orders);
    res.json({ success: true, order: orders[idx] });
});

// --- RF-11: Inventario ---
app.get('/api/inventory', (req, res) => res.json(readJson(INVENTORY_FILE)));

app.patch('/api/inventory/:id', (req, res) => {
    const inv = readJson(INVENTORY_FILE);
    const idx = inv.findIndex(i => i.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Insumo no encontrado' });
    inv[idx].stock = Number(req.body.stock);
    writeJson(INVENTORY_FILE, inv);
    res.json(inv[idx]);
});

// --- RF-13: Promociones y Cupones ---
app.get('/api/coupons', (req, res) => res.json(readJson(COUPONS_FILE)));

app.post('/api/coupons', (req, res) => {
    const coupons = readJson(COUPONS_FILE);
    const { code, discountPercent, description } = req.body;
    if (!code || !discountPercent) return res.status(400).json({ error: 'Código y porcentaje obligatorios' });
    const newCoupon = {
        code: code.toUpperCase().trim(),
        discountPercent: Number(discountPercent),
        description: description || '',
        active: true
    };
    coupons.push(newCoupon);
    writeJson(COUPONS_FILE, coupons);
    res.status(201).json(newCoupon);
});

app.delete('/api/coupons/:code', (req, res) => {
    const coupons = readJson(COUPONS_FILE).filter(c => c.code !== req.params.code);
    writeJson(COUPONS_FILE, coupons);
    res.json({ success: true });
});

// --- RF-05: Solicitudes de Cotización Especial ---
app.get('/api/quotes', (req, res) => res.json(readJson(QUOTES_FILE)));

app.post('/api/quotes', (req, res) => {
    const quotes = readJson(QUOTES_FILE);
    const newQuote = {
        quoteId: `COT-${Math.floor(1000 + Math.random() * 9000)}`,
        createdAt: new Date().toISOString(),
        status: 'Cotización',
        ...req.body
    };
    quotes.push(newQuote);
    writeJson(QUOTES_FILE, quotes);
    res.status(201).json({ success: true, quote: newQuote });
});

app.listen(PORT, () => {
    console.log(`==================================================================`);
    console.log(`  ATELIER HILO / ÉXODO BORDADOS — Backend Activo en Puerto ${PORT}`);
    console.log(`  Frontend Home:   http://localhost:${PORT}/home/index.html`);
    console.log(`  Estudio 3D:      http://localhost:${PORT}/Models/models.html`);
    console.log(`  Checkout Login:  http://localhost:${PORT}/login/login.html`);
    console.log(`  Healthcheck API: http://localhost:${PORT}/api/health`);
    console.log(`==================================================================`);
});
