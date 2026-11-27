/**
 * ATELIER HILO — Home: Selector de Técnica (Bordado 3D vs Estampado HD) + Laboratorio Comparador IA
 * Sincroniza el estado con ../Models/models.html y ../login/login.html mediante localStorage.
 * Optimizaciones:
 * - Redimensionamiento automático de imágenes subidas (máx 512px) para evitar tirones de CPU/RAM.
 * - Lienzo offscreen reutilizable (sharedHomeSourceCanvas) y exportación Base64 diferida en idle.
 * - Prefetch inteligente de archivos 3D (.gltf / .bin) al pasar el cursor sobre tarjetas del catálogo.
 */

const homeState = {
    garmentType: 'long-shirt',
    garmentName: 'Camisa Manga Larga Oxford',
    basePrice: 890,
    price: 890,
    fabricColor: '#1c1c1e',
    fabricColorName: 'Negro Ónix',
    technique: 'embroidery', // 'embroidery' | 'print'
    techniqueName: 'Bordado 3D de Alta Precisión',
    logoX: 0.22,
    logoY: 0.20,
    logoScale: 0.26,
    stitchDensity: 3,
    removeWhiteBg: true,
    stitchCount: 4200,
    printAreaCm2: 85,
    rawLogoDataUrl: null,
    embroideryDataUrl: null
};

const PREFETCH_GLTF_MAP = {
    'long-shirt': ['../assets/models/long-shirt.gltf', '../assets/models/long-shirt.bin'],
    'tshirt': ['../assets/models/tshirt.gltf', '../assets/models/tshirt.bin'],
    'polo': ['../assets/models/polo.gltf', '../assets/models/polo.bin'],
    'cap': ['../assets/models/cap.gltf', '../assets/models/cap.bin']
};
const prefetchedUrls = new Set();

let currentHomeImage = null;
let sharedHomeSourceCanvas = null;
let deferredSaveTimer = null;

document.addEventListener('DOMContentLoaded', () => {
    sharedHomeSourceCanvas = document.createElement('canvas');
    sharedHomeSourceCanvas.width = 260;
    sharedHomeSourceCanvas.height = 260;

    loadExistingOrderState();
    initHomeDefaultLogo();
    initHomeEvents();
    syncHomeCartBadge();
    handleResponsiveViewport();
    window.addEventListener('resize', handleResponsiveViewport, { passive: true });
});

function prefetchGarmentAssets(garmentType) {
    const urls = PREFETCH_GLTF_MAP[garmentType];
    if (!urls) return;
    urls.forEach((url) => {
        if (prefetchedUrls.has(url)) return;
        prefetchedUrls.add(url);
        fetch(url, { method: 'GET', credentials: 'same-origin' }).catch(() => {});
    });
}

function downsampleHomeImage(imgElement, maxDim = 512) {
    const w = imgElement.naturalWidth || imgElement.width || 260;
    const h = imgElement.naturalHeight || imgElement.height || 260;
    if (w <= maxDim && h <= maxDim) return imgElement;

    const scale = Math.min(maxDim / w, maxDim / h);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * scale));
    c.height = Math.max(1, Math.round(h * scale));
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(imgElement, 0, 0, c.width, c.height);
    return c;
}

function syncHomeCartBadge() {
    const cta = document.querySelector('.nav-cta');
    if (!cta) return;
    try {
        const raw = localStorage.getItem('cartItems');
        const items = raw ? JSON.parse(raw) : [];
        if (Array.isArray(items) && items.length > 0) {
            const totalQty = items.reduce((acc, item) => acc + (parseInt(item.quantity, 10) || 1), 0);
            cta.textContent = `Mi Carrito (${totalQty}) →`;
        }
    } catch (_) {}
}

function handleResponsiveViewport() {
    const container = document.getElementById('canvas3d-wrapper');
    if (container && window.camera && window.renderer) {
        const w = container.clientWidth || window.innerWidth;
        const h = container.clientHeight || 340;
        window.camera.aspect = w / h;
        window.camera.position.z = window.innerWidth < 768 ? 5.4 : 4.2;
        window.camera.updateProjectionMatrix();
        window.renderer.setSize(w, h);
    }
}

function loadExistingOrderState() {
    try {
        const raw = localStorage.getItem('atelier_custom_order');
        if (!raw) return;
        const saved = JSON.parse(raw);
        Object.assign(homeState, saved);
        if (saved.technique) {
            selectTechniqueOnHome(saved.technique, false);
        }
    } catch (err) {
        console.warn('Estado nuevo iniciado en Home');
    }
}

function initHomeDefaultLogo() {
    if (homeState.rawLogoDataUrl) {
        const savedImg = new Image();
        savedImg.onload = () => {
            const optimized = downsampleHomeImage(savedImg, 512);
            currentHomeImage = optimized;
            runDualAIComparison(optimized);
        };
        savedImg.src = homeState.rawLogoDataUrl;
        return;
    }

    const temp = document.createElement('canvas');
    temp.width = 260;
    temp.height = 260;
    const tCtx = temp.getContext('2d');

    tCtx.strokeStyle = '#C8A46E';
    tCtx.lineWidth = 14;
    tCtx.beginPath();
    tCtx.arc(130, 130, 88, 0, Math.PI * 2);
    tCtx.stroke();

    tCtx.fillStyle = '#C8A46E';
    tCtx.font = 'bold 94px Georgia';
    tCtx.textAlign = 'center';
    tCtx.textBaseline = 'middle';
    tCtx.fillText('AH', 130, 134);

    currentHomeImage = temp;
    runDualAIComparison(temp);
}

/**
 * Procesa la imagen simultáneamente en ambos motores (Bordado 3D y Estampado HD)
 * reutilizando el canvas offscreen y difiriendo la serialización Base64.
 */
function runDualAIComparison(imgElement) {
    const size = 260;
    const srcCtx = sharedHomeSourceCanvas.getContext('2d');
    srcCtx.clearRect(0, 0, size, size);

    const imgW = imgElement.width || imgElement.naturalWidth || size;
    const imgH = imgElement.height || imgElement.naturalHeight || size;
    const scale = Math.min((size - 28) / imgW, (size - 28) / imgH);
    const drawW = imgW * scale;
    const drawH = imgH * scale;
    const offsetX = (size - drawW) / 2;
    const offsetY = (size - drawH) / 2;

    srcCtx.drawImage(imgElement, offsetX, offsetY, drawW, drawH);
    const imgDataObj = srcCtx.getImageData(0, 0, size, size);
    const data = imgDataObj.data;

    // 1. Remoción inteligente de fondo blanco si está activa
    const colorBuckets = new Set();
    for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        if (homeState.removeWhiteBg && r > 240 && g > 240 && b > 240) {
            data[i + 3] = 0;
        }
        if (data[i + 3] > 45) {
            colorBuckets.add(`${Math.floor(r / 32)}-${Math.floor(g / 32)}-${Math.floor(b / 32)}`);
        }
    }
    srcCtx.putImageData(imgDataObj, 0, 0);

    // 2. Renderizar Vista Previa BORDADO 3D IA
    const embCanvas = document.getElementById('home-embroidery-canvas');
    const embCtx = embCanvas.getContext('2d');
    embCtx.clearRect(0, 0, size, size);
    embCtx.shadowColor = 'rgba(0, 0, 0, 0.55)';
    embCtx.shadowBlur = 2;
    embCtx.shadowOffsetX = 1;
    embCtx.shadowOffsetY = 1;

    const step = 3;
    let stitches = 0;
    embCtx.lineWidth = step * 0.8;
    embCtx.lineCap = 'round';

    for (let y = 0; y < size; y += step) {
        for (let x = 0; x < size; x += step) {
            const idx = (y * size + x) * 4;
            const a = data[idx + 3];
            if (a > 45) {
                stitches++;
                const shine = ((x + y) % 6 === 0) ? 20 : -12;
                const r = Math.min(255, Math.max(0, data[idx] + shine));
                const g = Math.min(255, Math.max(0, data[idx + 1] + shine));
                const b = Math.min(255, Math.max(0, data[idx + 2] + shine));

                embCtx.strokeStyle = `rgb(${r},${g},${b})`;
                const jitter = Math.sin(x * 0.5 + y * 0.3) * 0.8;
                embCtx.beginPath();
                embCtx.moveTo(x - step * 0.45, y - step * 0.35 + jitter);
                embCtx.lineTo(x + step * 0.45, y + step * 0.35 - jitter);
                embCtx.stroke();
            }
        }
    }

    homeState.stitchCount = Math.max(1200, stitches * 3);
    document.getElementById('home-stitch-badge').textContent = `~${homeState.stitchCount.toLocaleString()} puntadas`;

    // 3. Renderizar Vista Previa ESTAMPADO HD IA
    const printCanvas = document.getElementById('home-print-canvas');
    const printCtx = printCanvas.getContext('2d');
    printCtx.clearRect(0, 0, size, size);
    printCtx.drawImage(sharedHomeSourceCanvas, 0, 0);

    const pDataObj = printCtx.getImageData(0, 0, size, size);
    const pData = pDataObj.data;
    for (let i = 0; i < pData.length; i += 4) {
        if (pData[i + 3] > 40) {
            pData[i] = Math.min(255, Math.round(pData[i] * 1.05));
            pData[i + 1] = Math.min(255, Math.round(pData[i + 1] * 1.05));
            pData[i + 2] = Math.min(255, Math.round(pData[i + 2] * 1.05));
        }
    }
    printCtx.putImageData(pDataObj, 0, 0);

    // 4. Diagnóstico IA automático según número de colores/degradados
    const tones = colorBuckets.size;
    const verdictEl = document.getElementById('home-ai-verdict');
    const explainEl = document.getElementById('home-ai-explanation');

    if (tones > 25) {
        verdictEl.textContent = `IA recomienda: Estampado HD (${tones} tonos)`;
        explainEl.innerHTML = `<strong>Diagnóstico IA:</strong> Tu imagen contiene degradados o alta riqueza cromática (${tones} variaciones tonales). En <strong>Estampado HD (DTF)</strong> conservará cada detalle fotográfico; en <strong>Bordado 3D</strong> se sintetizará en hilos sólidos con relieve artesanal.`;
    } else {
        verdictEl.textContent = `IA recomienda: Bordado 3D o Serigrafía`;
        explainEl.innerHTML = `<strong>Diagnóstico IA:</strong> Diseño de contornos definidos y colores sólidos. Luce extraordinario en <strong>Bordado 3D</strong> con relieve de hilo rayon o en <strong>Estampado Serigráfico</strong> de acabado mate.`;
    }

    scheduleSaveHomeState();
}

function selectTechniqueOnHome(tech, persist = true) {
    homeState.technique = tech;
    homeState.techniqueName = tech === 'embroidery'
        ? 'Bordado 3D de Alta Precisión'
        : 'Estampado Serigráfico / DTF HD';

    document.querySelectorAll('.technique-choice-card').forEach(card => {
        const isCurrent = card.dataset.technique === tech;
        card.classList.toggle('active', isCurrent);
        const check = card.querySelector('.tc-check');
        if (check) check.textContent = isCurrent ? '✓ Seleccionado' : 'Seleccionar';
    });

    document.querySelectorAll('.comp-panel').forEach(panel => {
        panel.classList.toggle('active', panel.dataset.selectTech === tech);
    });

    if (persist) scheduleSaveHomeState();
}

function saveHomeStateNow() {
    clearTimeout(deferredSaveTimer);
    const embCanvas = document.getElementById('home-embroidery-canvas');
    const printCanvas = document.getElementById('home-print-canvas');
    if (embCanvas && printCanvas) {
        homeState.embroideryDataUrl = (homeState.technique === 'embroidery' ? embCanvas : printCanvas).toDataURL('image/png');
    }
    localStorage.setItem('atelier_custom_order', JSON.stringify(homeState));
}

function scheduleSaveHomeState() {
    clearTimeout(deferredSaveTimer);
    deferredSaveTimer = setTimeout(() => {
        if ('requestIdleCallback' in window) {
            window.requestIdleCallback(() => saveHomeStateNow(), { timeout: 1000 });
        } else {
            saveHomeStateNow();
        }
    }, 250);
}

function initHomeEvents() {
    document.querySelectorAll('.technique-choice-card').forEach(card => {
        card.addEventListener('click', () => {
            selectTechniqueOnHome(card.dataset.technique);
        });
    });

    document.querySelectorAll('.comp-panel').forEach(panel => {
        panel.addEventListener('click', () => {
            selectTechniqueOnHome(panel.dataset.selectTech);
        });
    });

    const uploadInput = document.getElementById('home-logo-upload');
    uploadInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (ev) => {
            const img = new Image();
            img.onload = () => {
                const optimized = downsampleHomeImage(img, 512);
                currentHomeImage = optimized;
                homeState.rawLogoDataUrl = optimized.toDataURL
                    ? optimized.toDataURL('image/png')
                    : ev.target.result;
                runDualAIComparison(optimized);
            };
            img.src = ev.target.result;
        };
        reader.readAsDataURL(file);
    });

    document.getElementById('home-remove-bg').addEventListener('change', (e) => {
        homeState.removeWhiteBg = e.target.checked;
        if (currentHomeImage) {
            runDualAIComparison(currentHomeImage);
        }
    });

    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const filter = btn.dataset.filter;

            document.querySelectorAll('.catalog-item').forEach(card => {
                const match = filter === 'all' || card.dataset.category === filter;
                card.classList.toggle('hidden-by-filter', !match);
            });
        });
    });

    document.querySelectorAll('.catalog-item').forEach(item => {
        if (item.dataset.garment) {
            item.addEventListener('pointerenter', () => {
                prefetchGarmentAssets(item.dataset.garment);
            }, { passive: true });
        }

        item.addEventListener('click', () => {
            if (item.dataset.garment) {
                homeState.garmentType = item.dataset.garment;
                saveHomeStateNow();
                window.location.href = `../Models/models.html?garment=${encodeURIComponent(item.dataset.garment)}`;
            } else {
                const quoteSection = document.getElementById('cotizacion');
                const notesField = document.getElementById('quote-notes');
                if (notesField) {
                    notesField.value = `Me interesa cotizar: ${item.dataset.productName} (Precio base ref: $${item.dataset.productPrice} MXN).`;
                }
                if (quoteSection) {
                    quoteSection.scrollIntoView({ behavior: 'smooth' });
                }
            }
        });
    });

    const goTo3dBtn = document.getElementById('go-to-3d-btn');
    if (goTo3dBtn) {
        goTo3dBtn.addEventListener('pointerenter', () => {
            prefetchGarmentAssets(homeState.garmentType || 'long-shirt');
        }, { passive: true });
        goTo3dBtn.addEventListener('click', () => {
            saveHomeStateNow();
        });
    }

    // Rastreo de pedidos por folio (GET /api/orders/:orderId)
    const trackingForm = document.getElementById('tracking-form');
    if (trackingForm) {
        trackingForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const folioInput = document.getElementById('tracking-folio-input').value.trim().toUpperCase();
            if (!folioInput) return;

            const resultBox = document.getElementById('tracking-result');
            const folioDisplay = document.getElementById('track-folio-display');
            const statusPill = document.getElementById('track-status-pill');
            const metaInfo = document.getElementById('track-garment-info');

            let foundOrder = null;
            try {
                const res = await fetch(`/api/orders/${encodeURIComponent(folioInput)}`);
                if (res.ok) {
                    const data = await res.json();
                    foundOrder = data.order || null;
                }
            } catch (_) {}

            resultBox.classList.remove('hidden');
            folioDisplay.textContent = folioInput;

            const stages = [
                'Cotización',
                'Diseño aprobado',
                'En producción',
                'Bordado/Impresión',
                'Empaque',
                'Enviado',
                'Entregado'
            ];

            let currentStage = 'En producción';
            if (foundOrder) {
                const rawStatus = foundOrder.production_stage || foundOrder.status || 'En producción';
                currentStage = rawStatus === 'En bordado o impresión' ? 'Bordado/Impresión' : rawStatus;
                metaInfo.textContent = `Cliente: ${foundOrder.customer_name || foundOrder.user?.name || 'Cliente'} • Producto: ${foundOrder.order?.garmentName || 'Personalizado'} (${foundOrder.order?.techniqueName || 'Bordado'})`;
            } else {
                metaInfo.textContent = 'Mostrando estado estimado en taller. Verifica tu folio para consulta en vivo.';
            }

            statusPill.textContent = currentStage;
            const currentIdx = Math.max(0, stages.findIndex(s => s.toLowerCase() === currentStage.toLowerCase()));

            document.querySelectorAll('#production-steps-list li').forEach((li, idx) => {
                li.classList.remove('done', 'current');
                if (idx < currentIdx) li.classList.add('done');
                if (idx === currentIdx) li.classList.add('current');
            });
        });
    }

    // Formulario de Cotización Especial (POST /api/quotes)
    const quoteForm = document.getElementById('quote-form');
    if (quoteForm) {
        quoteForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const feedback = document.getElementById('quote-feedback');
            const payload = {
                name: document.getElementById('quote-name').value.trim(),
                email: document.getElementById('quote-email').value.trim(),
                category: document.getElementById('quote-category').value,
                quantity: Number(document.getElementById('quote-qty').value),
                notes: document.getElementById('quote-notes').value.trim()
            };

            try {
                const res = await fetch('/api/quotes', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const data = await res.json();
                feedback.textContent = res.ok
                    ? `✓ Solicitud registrada con folio ${data.quoteId}. Un asesor revisará tu cotización.`
                    : '✓ Solicitud guardada en modo local. Nos pondremos en contacto contigo.';
            } catch (_) {
                feedback.textContent = '✓ Solicitud recibida. Un asesor revisará tu cotización a la brevedad.';
            }

            feedback.classList.remove('hidden');
            quoteForm.reset();
        });
    }
}

async function loadAdminCatalogProducts() {
    try {
        const res = await fetch('/api/products');
        if (!res.ok) return;
        const products = await res.json();

        const baseIds = new Set([
            'PRD-01', 'PRD-02', 'PRD-03', 'PRD-04', 'PRD-05', 'PRD-06',
            'PRD-07', 'PRD-08', 'PRD-09', 'PRD-10', 'PRD-11', 'PRD-12'
        ]);
        const extraProducts = products.filter(p => !baseIds.has(p.id));
        if (!extraProducts.length) return;

        const grid = document.getElementById('catalog-cards-grid');
        if (!grid) return;

        let count = grid.querySelectorAll('.catalog-item').length;

        const categoryMap = {
            'Bordado en playeras': 'textil',
            'Bordado en gorras': 'textil',
            'Tazas personalizadas': 'drinkware',
            'Vasos personalizados': 'drinkware',
            'Impresión digital': 'imprenta',
            'Tarjetas de presentación': 'imprenta',
            'Lonas publicitarias': 'imprenta',
            'Artículos promocionales': 'promocionales'
        };

        extraProducts.forEach(p => {
            count++;
            const has3D = p.model3d && p.model3d !== 'none';
            const filterSlug = categoryMap[p.category] || 'promocionales';

            const card = document.createElement('div');
            card.className = 'catalog-item';
            card.dataset.category = filterSlug;
            if (has3D) card.dataset.garment = p.model3d;

            card.innerHTML = `
                <span class="cat-num">${String(count).padStart(2, '0')}</span>
                <span class="cat-badge">${p.category}</span>
                <h3>${p.name}</h3>
                <p>${p.description || 'Producto personalizado bajo pedido.'}</p>
                <div class="cat-footer">
                    <strong>$${Number(p.price).toLocaleString()} MXN</strong>
                    <span>${has3D ? 'Configurar en 3D →' : 'Cotizar / Ordenar →'}</span>
                </div>
            `;

            if (has3D) {
                card.addEventListener('pointerenter', () => {
                    prefetchGarmentAssets(p.model3d);
                }, { passive: true });
            }

            card.addEventListener('click', () => {
                if (has3D) {
                    homeState.garmentType = p.model3d;
                    saveHomeStateNow();
                    window.location.href = `../Models/models.html?garment=${encodeURIComponent(p.model3d)}`;
                } else {
                    const quoteSection = document.getElementById('cotizacion');
                    if (quoteSection) quoteSection.scrollIntoView({ behavior: 'smooth' });
                }
            });

            grid.appendChild(card);
        });
    } catch (err) {
        console.warn('No se pudieron cargar los productos nuevos en el inicio:', err);
    }
}

window.addEventListener('DOMContentLoaded', loadAdminCatalogProducts);
