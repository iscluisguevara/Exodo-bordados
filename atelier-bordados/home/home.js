/**
 * ATELIER HILO — Home: Selector de Técnica (Bordado 3D vs Estampado HD) + Laboratorio Comparador IA
 * Sincroniza el estado con ../Models/models.html y ../login/login.html mediante localStorage.
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
    removeWhiteBg: true,
    stitchCount: 4200,
    printAreaCm2: 85,
    rawLogoDataUrl: null,
    embroideryDataUrl: null
};

let currentHomeImage = null;

document.addEventListener('DOMContentLoaded', () => {
    loadExistingOrderState();
    initHomeDefaultLogo();
    initHomeEvents();
    handleResponsiveViewport();
    window.addEventListener('resize', handleResponsiveViewport);
});

/**
 * Adapta lienzos y, en caso de existir visor 3D activo en la vista, actualiza aspect ratio y distancia Z móvil
 */
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
            currentHomeImage = savedImg;
            runDualAIComparison(savedImg);
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

    const img = new Image();
    img.onload = () => {
        currentHomeImage = img;
        runDualAIComparison(img);
    };
    img.src = temp.toDataURL();
}

/**
 * Procesa la imagen simultáneamente en ambos motores (Bordado 3D y Estampado HD)
 * y diagnostica cuál técnica se adapta mejor según la complejidad cromática.
 */
function runDualAIComparison(imgElement) {
    const size = 260;
    const srcCanvas = document.createElement('canvas');
    srcCanvas.width = size;
    srcCanvas.height = size;
    const srcCtx = srcCanvas.getContext('2d');

    const scale = Math.min((size - 28) / imgElement.width, (size - 28) / imgElement.height);
    const drawW = imgElement.width * scale;
    const drawH = imgElement.height * scale;
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
                embCtx.lineWidth = step * 0.8;
                embCtx.lineCap = 'round';
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
    printCtx.drawImage(srcCanvas, 0, 0);

    // Simular micro-trama textil sobre la tinta para que se vea integrado a la tela
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

    homeState.embroideryDataUrl = (homeState.technique === 'embroidery' ? embCanvas : printCanvas).toDataURL('image/png');
    saveHomeState();
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

    const embCanvas = document.getElementById('home-embroidery-canvas');
    const printCanvas = document.getElementById('home-print-canvas');
    if (embCanvas && printCanvas) {
        homeState.embroideryDataUrl = (tech === 'embroidery' ? embCanvas : printCanvas).toDataURL('image/png');
    }

    if (persist) saveHomeState();
}

function saveHomeState() {
    localStorage.setItem('atelier_custom_order', JSON.stringify(homeState));
}

function initHomeEvents() {
    // Selección en las tarjetas grandes de Técnica
    document.querySelectorAll('.technique-choice-card').forEach(card => {
        card.addEventListener('click', () => {
            selectTechniqueOnHome(card.dataset.technique);
        });
    });

    // Selección haciendo clic en cualquiera de los 2 paneles de vista previa IA
    document.querySelectorAll('.comp-panel').forEach(panel => {
        panel.addEventListener('click', () => {
            selectTechniqueOnHome(panel.dataset.selectTech);
        });
    });

    // Subida de logotipo en Home
    const uploadInput = document.getElementById('home-logo-upload');
    uploadInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (ev) => {
            homeState.rawLogoDataUrl = ev.target.result;
            const img = new Image();
            img.onload = () => {
                currentHomeImage = img;
                runDualAIComparison(img);
            };
            img.src = ev.target.result;
        };
        reader.readAsDataURL(file);
    });

    // Checkbox de recorte de fondo blanco
    document.getElementById('home-remove-bg').addEventListener('change', (e) => {
        homeState.removeWhiteBg = e.target.checked;
        if (currentHomeImage) {
            runDualAIComparison(currentHomeImage);
        }
    });

    // Tarjetas de las 7 prendas -> abren directamente esa prenda en ../Models/models.html
    document.querySelectorAll('.catalog-item').forEach(item => {
        item.addEventListener('click', () => {
            homeState.garmentType = item.dataset.garment;
            saveHomeState();
            window.location.href = '../Models/models.html';
        });
    });

    // Botón principal ir al Estudio 3D
    document.getElementById('go-to-3d-btn').addEventListener('click', () => {
        saveHomeState();
    });
}
