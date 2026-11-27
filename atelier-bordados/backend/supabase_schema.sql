-- =============================================================================
-- ATELIER HILO / ÉXODO BORDADOS — Esquema PostgreSQL para Supabase
-- Ejecutar este script completo en el SQL Editor de Supabase
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. TABLA DE USUARIOS (Clientes, Personal y Administrador)
CREATE TABLE IF NOT EXISTS public.users (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash TEXT,
    role VARCHAR(50) NOT NULL DEFAULT 'Cliente'
        CHECK (role IN ('Administrador', 'Diseñador', 'Producción', 'Ventas', 'Cliente')),
    auth_provider VARCHAR(50) NOT NULL DEFAULT 'local'
        CHECK (auth_provider IN ('local', 'google')),
    google_id VARCHAR(255) UNIQUE NULL,
    google_oauth_disabled BOOLEAN NOT NULL DEFAULT FALSE,
    billing_razon_social VARCHAR(255) NULL,
    billing_rfc VARCHAR(20) NULL,
    billing_email VARCHAR(255) NULL,
    billing_fiscal_address TEXT NULL,
    billing_postal_code VARCHAR(15) NULL,
    billing JSONB DEFAULT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Regla crítica: Ninguna cuenta con rol Administrador puede vincularse a Google OAuth
    CONSTRAINT chk_admin_isolated_from_google CHECK (
        role <> 'Administrador'
        OR (google_id IS NULL AND auth_provider = 'local' AND google_oauth_disabled = TRUE)
    )
);

CREATE INDEX IF NOT EXISTS idx_users_email_lower ON public.users (LOWER(email));
CREATE INDEX IF NOT EXISTS idx_users_role ON public.users (role);

-- 2. TABLA DE PEDIDOS (Gestión de Producción y Taller)
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
    production_stage VARCHAR(60) NOT NULL DEFAULT 'Cotización'
        CHECK (production_stage IN (
            'Cotización',
            'Diseño aprobado',
            'En producción',
            'Bordado/Impresión',
            'Empaque',
            'Enviado',
            'Entregado'
        )),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_folio ON public.orders (folio);
CREATE INDEX IF NOT EXISTS idx_orders_stage ON public.orders (production_stage);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON public.orders (created_at DESC);

-- 3. SEED DE CUENTA EXCLUSIVA DE ADMINISTRADOR
-- Nota de seguridad: La contraseña se almacena exclusivamente como hash criptográfico (scrypt 64-byte)
-- con google_id = NULL, auth_provider = 'local' y google_oauth_disabled = TRUE.
INSERT INTO public.users (
    id,
    name,
    email,
    password_hash,
    role,
    auth_provider,
    google_id,
    google_oauth_disabled,
    billing
) VALUES (
    'USR-ADMIN-SUP-01',
    'Administrador General Éxodo',
    'Admin1Sup@exodoadmin1.com',
    'e8a4f2c91b7d3056a9c2e4f180b3d7a5:cca5076d361c7b272ec55d2215601cf36f84a64fbcc12f332b52ef488f3cad10e3074cda2bb4702aa76ec91c16a376602fd681fe1c22e296c746e285b09d1d79',
    'Administrador',
    'local',
    NULL,
    TRUE,
    NULL
)
ON CONFLICT (email) DO UPDATE SET
    password_hash = EXCLUDED.password_hash,
    role = 'Administrador',
    auth_provider = 'local',
    google_id = NULL,
    google_oauth_disabled = TRUE,
    updated_at = NOW();

-- 4. SEED DE PEDIDOS INICIALES PARA PRUEBAS EN EL PANEL ADMINISTRATIVO
INSERT INTO public.orders (
    folio,
    customer_name,
    customer_email,
    customer_role,
    billing,
    items,
    subtotal,
    discount,
    tax,
    total,
    coupon_code,
    payment_method,
    payment_status,
    payment_details,
    production_stage,
    created_at
) VALUES
(
    'AH-2026-5250',
    'Valeria Montes de Oca',
    'valeria.montes@corporativomx.com',
    'Cliente',
    '{
        "razonSocial": "Corporativo Textil Montes S.A. de C.V.",
        "rfc": "CTM210415AB9",
        "billingEmail": "facturacion@corporativomx.com",
        "fiscalAddress": "Av. Paseo de la Reforma 412, Piso 8, Cuauhtémoc, CDMX",
        "postalCode": "06600"
    }'::jsonb,
    '[
        {
            "itemIndex": 1,
            "garmentType": "long-shirt",
            "garmentName": "Camisa Manga Larga Oxford",
            "technique": "embroidery",
            "techniqueName": "Bordado 3D de Alta Precisión",
            "unitPrice": 890,
            "quantity": 2,
            "lineTotal": 1780,
            "fabricColor": "#5c242b",
            "fabricColorName": "Vino Burdeos",
            "stitchDensity": 3,
            "stitchCount": 5907,
            "printAreaCm2": 85,
            "embroideryImageUrl": "/api/uploads/AH-2026-5250.png"
        }
    ]'::jsonb,
    1780.00,
    178.00,
    256.32,
    1858.32,
    'EXODO10',
    'card',
    'PAGADO_SIMULADO',
    '{
        "method": "card",
        "methodLabel": "Tarjeta de Crédito / Débito",
        "status": "PAGADO_SIMULADO",
        "reference": "REF-AH-2026-5250",
        "cardLast4": "4821",
        "cardHolder": "VALERIA MONTES"
    }'::jsonb,
    'Empaque',
    '2026-11-23T23:58:30.074Z'
),
(
    'AH-2026-7814',
    'Sebastián Cárdenas',
    'scardenas@studionorte.mx',
    'Cliente',
    '{
        "razonSocial": "Studio Norte Diseño S.C.",
        "rfc": "SND190822KL4",
        "billingEmail": "contabilidad@studionorte.mx",
        "fiscalAddress": "Calz. del Valle 350, San Pedro Garza García, N.L.",
        "postalCode": "66220"
    }'::jsonb,
    '[
        {
            "itemIndex": 1,
            "garmentType": "hoodie",
            "garmentName": "Hoodie Boxy 450 GSM",
            "technique": "embroidery",
            "techniqueName": "Bordado 3D de Alta Precisión",
            "unitPrice": 1150,
            "quantity": 4,
            "lineTotal": 4600,
            "fabricColor": "#1b2432",
            "fabricColorName": "Azul Medianoche",
            "stitchDensity": 4,
            "stitchCount": 7420,
            "printAreaCm2": 110,
            "embroideryImageUrl": null
        },
        {
            "itemIndex": 2,
            "garmentType": "cap",
            "garmentName": "Gorra Estructurada 6 Paneles",
            "technique": "embroidery",
            "techniqueName": "Bordado Frontal Alto Relieve",
            "unitPrice": 450,
            "quantity": 4,
            "lineTotal": 1800,
            "fabricColor": "#181818",
            "fabricColorName": "Negro Ónix",
            "stitchDensity": 3,
            "stitchCount": 4100,
            "printAreaCm2": 48,
            "embroideryImageUrl": null
        }
    ]'::jsonb,
    6400.00,
    1280.00,
    819.20,
    5939.20,
    'MAYOREO20',
    'transfer',
    'PENDIENTE_COMPROBANTE_SPEI',
    '{
        "method": "transfer",
        "methodLabel": "Transferencia SPEI",
        "status": "PENDIENTE_COMPROBANTE_SPEI",
        "reference": "SPEI-7814-EXODO"
    }'::jsonb,
    'Bordado/Impresión',
    '2026-11-25T16:20:00.000Z'
),
(
    'AH-2026-9042',
    'Mariana Villarreal',
    'mariana.v@boutiqueaura.com',
    'Cliente',
    NULL,
    '[
        {
            "itemIndex": 1,
            "garmentType": "polo",
            "garmentName": "Playera Tipo Polo Piqué",
            "technique": "embroidery",
            "techniqueName": "Bordado Institucional Pecho",
            "unitPrice": 650,
            "quantity": 3,
            "lineTotal": 1950,
            "fabricColor": "#f4f1ea",
            "fabricColorName": "Marfil Crudo",
            "stitchDensity": 3,
            "stitchCount": 3850,
            "printAreaCm2": 64,
            "embroideryImageUrl": null
        }
    ]'::jsonb,
    1950.00,
    150.00,
    288.00,
    2088.00,
    'ATELIER150',
    'paypal',
    'PAGADO_SIMULADO',
    '{
        "method": "paypal",
        "methodLabel": "PayPal Express",
        "status": "PAGADO_SIMULADO",
        "reference": "PP-9042-EXODO",
        "paypalEmail": "mariana.v@boutiqueaura.com"
    }'::jsonb,
    'Cotización',
    '2026-11-26T14:10:00.000Z'
)
ON CONFLICT (folio) DO NOTHING;
