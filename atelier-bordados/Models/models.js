/**
 * ATELIER HILO — Motor 3D PBR Optimizado (7 Prendas & Gorros) + Procesador Dual IA
 * Optimizaciones aplicadas:
 * 1. Carga bajo demanda (lazy load) de la prenda activa + precarga diferida en idle (requestIdleCallback).
 * 2. Caché en memoria de modelos 3D (garmentModelCache) y deduplicación de promesas en vuelo (garmentLoadPromises).
 * 3. Horneado (baking) de mallas GLTF a geometría estática (elimina ~390 nodos de huesos SkinnedMesh en long-shirt).
 * 4. Mapa de profundidad superficial precalculado (garmentDepthCache) con interpolación bilineal O(1) (< 0.1ms)
 *    para posicionar/escalar el logotipo a 60 FPS sin lanzar 441 Raycasters por evento de slider.
 * 5. Ciclo único de requestAnimationFrame con pausa automática por visibilitychange e IntersectionObserver.
 * 6. Redimensionamiento de logos subidos (máx 512px) y exportación toDataURL diferida sin bloquear el hilo principal.
 */

const GARMENT_CATALOG = {
    'long-shirt': {
        name: 'Camisa Manga Larga Oxford',
        basePrice: 890,
        weave: 'oxford',
        weaveLabel: 'TRAMA OXFORD 100% ALGODÓN EGIPCIO',
        category: 'tops',
        cameraZ: 4.15,
        cameraY: 0.12,
        logoZ: 0.345,
        defaultPos: { x: 0.18, y: 0.28, scale: 0.23 }
    },
    'short-shirt': {
        name: 'Camisa Manga Corta Popelina',
        basePrice: 790,
        weave: 'oxford',
        weaveLabel: 'POPELINA FINA DE ALTA DENSIDAD',
        category: 'tops',
        cameraZ: 4.05,
        cameraY: 0.12,
        logoZ: 0.345,
        defaultPos: { x: 0.22, y: 0.20, scale: 0.26 }
    },
    'tshirt': {
        name: 'Playera Crewneck Heavyweight',
        basePrice: 520,
        weave: 'jersey',
        weaveLabel: 'PUNTO JERSEY PEINADO 280 GSM',
        category: 'tops',
        cameraZ: 8.0,
        cameraY: 0.10,
        logoZ: 0.340,
        defaultPos: { x: 0.27, y: 0.51, scale: 0.34 }
    },
    'polo': {
        name: 'Playera Tipo Polo Piqué',
        basePrice: 650,
        weave: 'pique',
        weaveLabel: 'TEJIDO PIQUÉ DOBLE PANAL',
        category: 'tops',
        cameraZ: 4.0,
        cameraY: 0.12,
        logoZ: 0.345,
        defaultPos: { x: 0.22, y: 0.42, scale: 0.26 }
    },
    'hoodie': {
        name: 'Hoodie Boxy 450 GSM',
        basePrice: 1150,
        weave: 'fleece',
        weaveLabel: 'FELPA FRANCESA PESADA 450 GSM',
        category: 'tops',
        cameraZ: 4.25,
        cameraY: 0.15,
        logoZ: 0.365,
        defaultPos: { x: 0.0, y: 0.18, scale: 0.38 }
    },
    'cap': {
        name: 'Gorra Estructurada 6 Paneles',
        basePrice: 450,
        weave: 'twill',
        weaveLabel: 'SARGA DE ALGODÓN CEPILLADO',
        category: 'headwear',
        cameraZ: 2.65,
        cameraY: 0.06,
        logoZ: 0.525,
        defaultPos: { x: 0.0, y: -0.08, scale: 0.37 }
    },
    'beanie': {
        name: 'Gorro Beanie Fisherman',
        basePrice: 420,
        weave: 'rib',
        weaveLabel: 'PUNTO ACANALADO LANA MERINO',
        category: 'headwear',
        cameraZ: 2.55,
        cameraY: 0.05,
        logoZ: 0.545,
        defaultPos: { x: 0.0, y: -0.17, scale: 0.28 }
    }
};

// Configuración de normalización y horneado para modelos GLTF externos (rutas relativas compatibles con Live Server, Express y Vercel)
const GLTF_GARMENT_CONFIG = {
    'long-shirt': {
        url: '../assets/models/long-shirt.gltf',
        rotateX: Math.PI / 2,
        fitMode: 'maxDim',
        targetSize: 1.8,
        yOffset: 0.1
    },
    'tshirt': {
        url: '../assets/models/tshirt.gltf',
        rotateX: 0,
        fitMode: 'sizeY',
        targetSize: 1.8,
        yOffset: 0.1
    },
    'polo': {
        url: '../assets/models/polo.gltf',
        rotateX: 0,
        fitMode: 'maxDim',
        targetSize: 1.8,
        yOffset: 0.1
    },
    'cap': {
        url: '../assets/models/cap.gltf',
        rotateX: 0,
        fitMode: 'sizeY',
        targetSize: 0.75,
        yOffset: -0.05
    }
};

const orderState = {
    garmentType: 'long-shirt',
    garmentName: 'Camisa Manga Larga Oxford',
    basePrice: 890,
    price: 890,
    fabricColor: '#1c1c1e',
    fabricColorName: 'Textura Original 3D',
    useOriginalTextureColor: true,
    technique: 'embroidery',
    techniqueName: 'Bordado 3D de Alta Precisión',
    logoX: 0.18,
    logoY: 0.28,
    logoScale: 0.23,
    stitchDensity: 3,
    stitchCount: 4200,
    printAreaCm2: 85,
    removeWhiteBg: true,
    embroideryDataUrl: null,
    rawLogoDataUrl: null
};

// Resolutor de rutas de texturas para cargar siempre los archivos reales en assets/models/textures*
const TEXTURE_FOLDER_REMAP = [
    { match: /textures\/(Lining_diffuse\.png|Shirt_specularGlossiness\.png|Shirt_normal\.png)$/i, folder: 'textures long shirt' },
    { match: /textures\/(Polo_LV2_lambert1_baseColor\.jpeg|Polo_LV2_lambert1_metallicRoughness\.png|Polo_LV2_lambert1_normal\.png)$/i, folder: 'textures polo' },
    { match: /textures\/(material_normal\.png|Baseball_Cap_baseColor\.png|Baseball_Cap_metallicRoughness\.png)$/i, folder: 'textures cap' }
];

const globalModelManager = new THREE.LoadingManager();
globalModelManager.setURLModifier((url) => {
    let resolved = url;
    // Si alguna ruta venía con /assets/models/ absoluta, convertirla a relativa ../assets/models/ para Live Server
    if (resolved.startsWith('/assets/models/')) {
        resolved = '..' + resolved;
    }
    for (const rule of TEXTURE_FOLDER_REMAP) {
        if (rule.match.test(resolved)) {
            resolved = resolved.replace(/textures\//i, `${rule.folder}/`);
            break;
        }
    }
    return encodeURI(decodeURI(resolved));
});

const gltfLoader = new THREE.GLTFLoader(globalModelManager);

// Cachés en memoria para cambio instantáneo entre prendas (< 1ms)
const garmentModelCache = new Map();
const garmentLoadPromises = new Map();
const garmentDepthCache = new Map();
const weaveTextureCache = {};

let activeGarmentNode = null;
let activeLoadToken = 0;
let idlePreloadScheduled = false;

let scene, camera, renderer, garmentGroup, shadowPlane;
let fabricMaterial, secondaryMaterial, accentMetalMaterial, buttonMaterial, innerNeckMaterial, logoMesh;
let bumpCanvas, sharedProcessCanvas, sharedSampleCanvas, logoTexture, logoBumpTexture;
let isDragging = false;
let previousMousePosition = { x: 0, y: 0 };
let targetRotationY = 0;
let targetRotationX = 0.06;
let targetCameraZ = 4.15;
let targetCameraY = 0.12;
let isWireframe = false;
let uploadedSourceImage = null;

// Control de ciclo de animación único y ahorro de energía
let animationFrameId = null;
let isViewportVisible = true;
let isDocumentVisible = !document.hidden;
let logoTransformRafId = null;
let resizeRafId = null;
let deferredExportTimer = null;
let logoDataUrlDirty = true;

const surfaceRaycaster = new THREE.Raycaster();
const rayOrigin = new THREE.Vector3();
const rayDir = new THREE.Vector3(0, 0, -1);

document.addEventListener('DOMContentLoaded', () => {
    restoreSavedStateIfAny();
    initOffscreenCanvases();
    initThreeJS();
    initUIEvents();
    setupRenderLifecycleObservers();

    if (orderState.rawLogoDataUrl) {
        const savedImg = new Image();
        savedImg.onload = () => {
            const optimizedImg = downsampleImageToCanvas(savedImg, 512);
            uploadedSourceImage = optimizedImg;
            analyzeLogoWithAI(optimizedImg, false);
            renderLogoEffect(optimizedImg);
        };
        savedImg.src = orderState.rawLogoDataUrl;
    } else {
        createDefaultEmbroideryBadge();
    }
});

function restoreSavedStateIfAny() {
    try {
        const urlParams = new URLSearchParams(window.location.search);
        const garmentFromUrl = urlParams.get('garment');

        const savedRaw = localStorage.getItem('atelier_custom_order');
        const saved = savedRaw ? JSON.parse(savedRaw) : {};

        const requestedGarment = (garmentFromUrl && GARMENT_CATALOG[garmentFromUrl])
            ? garmentFromUrl
            : (saved.garmentType && GARMENT_CATALOG[saved.garmentType] ? saved.garmentType : null);

        if (requestedGarment) {
            orderState.garmentType = requestedGarment;
            const info = GARMENT_CATALOG[requestedGarment];
            orderState.garmentName = info.name;
            orderState.basePrice = info.basePrice;
            const useSavedPos = !garmentFromUrl || garmentFromUrl === saved.garmentType;
            orderState.logoX = (useSavedPos && typeof saved.logoX === 'number') ? saved.logoX : info.defaultPos.x;
            orderState.logoY = (useSavedPos && typeof saved.logoY === 'number') ? saved.logoY : info.defaultPos.y;
            orderState.logoScale = (useSavedPos && typeof saved.logoScale === 'number') ? saved.logoScale : info.defaultPos.scale;
        }
        if (saved.technique === 'print' || saved.technique === 'embroidery') {
            orderState.technique = saved.technique;
            orderState.techniqueName = saved.technique === 'embroidery'
                ? 'Bordado 3D de Alta Precisión'
                : 'Estampado Serigráfico / DTF HD';
        }
        // Siempre iniciar mostrando la textura original del modelo 3D de assets/models/textures*
        orderState.useOriginalTextureColor = true;
        orderState.fabricColorName = 'Textura Original 3D';
        if (saved.rawLogoDataUrl) orderState.rawLogoDataUrl = saved.rawLogoDataUrl;
    } catch (e) {
        console.warn('No se pudo restaurar estado previo:', e);
    }
}

function initOffscreenCanvases() {
    bumpCanvas = document.createElement('canvas');
    bumpCanvas.width = 320;
    bumpCanvas.height = 320;

    sharedProcessCanvas = document.createElement('canvas');
    sharedProcessCanvas.width = 320;
    sharedProcessCanvas.height = 320;

    sharedSampleCanvas = document.createElement('canvas');
    sharedSampleCanvas.width = 96;
    sharedSampleCanvas.height = 96;
}

/**
 * Reduce imágenes excesivamente grandes (ej. 4000x4000px) a un tamaño óptimo (máx 512px)
 * para evitar bloqueos de CPU y saturación de memoria / localStorage.
 */
function downsampleImageToCanvas(imgElement, maxDim = 512) {
    const w = imgElement.naturalWidth || imgElement.width || 320;
    const h = imgElement.naturalHeight || imgElement.height || 320;
    if (w <= maxDim && h <= maxDim) return imgElement;

    const scale = Math.min(maxDim / w, maxDim / h);
    const targetW = Math.max(1, Math.round(w * scale));
    const targetH = Math.max(1, Math.round(h * scale));

    const c = document.createElement('canvas');
    c.width = targetW;
    c.height = targetH;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(imgElement, 0, 0, targetW, targetH);
    return c;
}

function getWeaveBumpTexture(weaveType) {
    if (weaveTextureCache[weaveType]) return weaveTextureCache[weaveType];

    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const ctx = c.getContext('2d');

    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, 128, 128);

    if (weaveType === 'oxford' || weaveType === 'jersey') {
        const step = weaveType === 'oxford' ? 4 : 3;
        for (let y = 0; y < 128; y += step) {
            for (let x = 0; x < 128; x += step) {
                const bright = ((x + y) % (step * 2) === 0) ? 165 : 95;
                ctx.fillStyle = `rgb(${bright},${bright},${bright})`;
                ctx.fillRect(x, y, step - 1, step - 1);
            }
        }
    } else if (weaveType === 'pique') {
        for (let y = 0; y < 128; y += 6) {
            for (let x = 0; x < 128; x += 6) {
                const offset = (y % 12 === 0) ? 0 : 3;
                ctx.fillStyle = '#dcdcdc';
                ctx.beginPath();
                ctx.arc(x + offset, y, 2.1, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    } else if (weaveType === 'fleece') {
        for (let y = 0; y < 128; y += 2) {
            for (let x = 0; x < 128; x += 2) {
                const v = 115 + ((x * 3 + y * 5) % 45);
                ctx.fillStyle = `rgb(${v},${v},${v})`;
                ctx.fillRect(x, y, 2, 2);
            }
        }
    } else if (weaveType === 'twill') {
        ctx.strokeStyle = '#c8c8c8';
        ctx.lineWidth = 2;
        for (let i = -128; i < 256; i += 5) {
            ctx.beginPath();
            ctx.moveTo(i, 0);
            ctx.lineTo(i + 128, 128);
            ctx.stroke();
        }
    } else if (weaveType === 'rib') {
        for (let x = 0; x < 128; x += 8) {
            const grad = ctx.createLinearGradient(x, 0, x + 8, 0);
            grad.addColorStop(0, '#353535');
            grad.addColorStop(0.5, '#f0f0f0');
            grad.addColorStop(1, '#353535');
            ctx.fillStyle = grad;
            ctx.fillRect(x, 0, 8, 128);
        }
    }

    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    const repeatCount = weaveType === 'rib' ? 10 : 18;
    tex.repeat.set(repeatCount, repeatCount);
    weaveTextureCache[weaveType] = tex;
    return tex;
}

function setViewportLoaderVisible(visible, text = 'Preparando prenda 3D...') {
    const loader = document.getElementById('viewport-loader');
    const label = document.getElementById('viewport-loader-text');
    if (!loader) return;
    if (label && text) label.textContent = text;
    loader.classList.toggle('hidden', !visible);
}

function initThreeJS() {
    const container = document.getElementById('canvas3d-wrapper');
    const width = container.clientWidth || 600;
    const height = container.clientHeight || 580;

    scene = new THREE.Scene();

    camera = new THREE.PerspectiveCamera(34, width / height, 0.1, 100);
    const initialSpecs = GARMENT_CATALOG[orderState.garmentType];
    targetCameraZ = getResponsiveCameraZ(orderState.garmentType);
    targetCameraY = initialSpecs.cameraY;
    camera.position.set(0, targetCameraY, targetCameraZ);

    renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance'
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    // Usamos shadowPlane de contacto pre-renderizado para ahorrar la pasada de shadowMap de 35k triángulos por frame
    renderer.shadowMap.enabled = false;
    container.appendChild(renderer.domElement);

    const hemiLight = new THREE.HemisphereLight(0xfffdf9, 0xd7d0c5, 0.68);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfff7eb, 0.95);
    keyLight.position.set(3.2, 4.8, 4.2);
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xeef2ff, 0.42);
    fillLight.position.set(-3.5, 1.8, 2.5);
    scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0xffeacc, 0.48);
    rimLight.position.set(0, 3.5, -4.0);
    scene.add(rimLight);

    const initialBump = getWeaveBumpTexture(initialSpecs.weave);

    fabricMaterial = new THREE.MeshStandardMaterial({
        color: new THREE.Color(orderState.fabricColor),
        roughness: 0.82,
        metalness: 0.04,
        bumpMap: initialBump,
        bumpScale: 0.016
    });

    secondaryMaterial = new THREE.MeshStandardMaterial({
        color: new THREE.Color(orderState.fabricColor).offsetHSL(0, 0, 0.025),
        roughness: 0.74,
        metalness: 0.05,
        bumpMap: initialBump,
        bumpScale: 0.02
    });

    buttonMaterial = new THREE.MeshStandardMaterial({
        color: 0xf4f1ea,
        roughness: 0.25,
        metalness: 0.15
    });

    accentMetalMaterial = new THREE.MeshStandardMaterial({
        color: 0xc5a880,
        roughness: 0.22,
        metalness: 0.82
    });

    innerNeckMaterial = new THREE.MeshStandardMaterial({
        color: 0x111111,
        roughness: 0.9
    });

    garmentGroup = new THREE.Group();
    scene.add(garmentGroup);

    // Malla de sombra de contacto (0 costo de recalculo por frame)
    const shadowCanvas = document.createElement('canvas');
    shadowCanvas.width = 128;
    shadowCanvas.height = 128;
    const sCtx = shadowCanvas.getContext('2d');
    const radGrad = sCtx.createRadialGradient(64, 64, 6, 64, 64, 60);
    radGrad.addColorStop(0, 'rgba(0,0,0,0.26)');
    radGrad.addColorStop(1, 'rgba(0,0,0,0)');
    sCtx.fillStyle = radGrad;
    sCtx.fillRect(0, 0, 128, 128);

    const shadowTex = new THREE.CanvasTexture(shadowCanvas);
    shadowPlane = new THREE.Mesh(
        new THREE.PlaneGeometry(2.2, 1.2),
        new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false })
    );
    shadowPlane.rotation.x = -Math.PI / 2;
    shadowPlane.position.y = -1.08;
    scene.add(shadowPlane);

    // Malla de logotipo 3D reutilizable
    const embroideryCanvas = document.getElementById('embroidery-canvas');
    logoTexture = new THREE.CanvasTexture(embroideryCanvas);
    logoTexture.generateMipmaps = false;
    logoTexture.minFilter = THREE.LinearFilter;

    logoBumpTexture = new THREE.CanvasTexture(bumpCanvas);
    logoBumpTexture.generateMipmaps = false;
    logoBumpTexture.minFilter = THREE.LinearFilter;

    const logoGeo = new THREE.PlaneGeometry(1, 1, 20, 20);
    const isEmbroidery = orderState.technique === 'embroidery';

    const logoMat = new THREE.MeshStandardMaterial({
        map: logoTexture,
        bumpMap: logoBumpTexture,
        bumpScale: isEmbroidery ? 0.045 : 0.008,
        transparent: true,
        roughness: isEmbroidery ? 0.36 : 0.64,
        metalness: isEmbroidery ? 0.16 : 0.03,
        depthWrite: false,
        depthTest: true,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4
    });

    logoMesh = new THREE.Mesh(logoGeo, logoMat);
    logoMesh.renderOrder = 10;
    garmentGroup.add(logoMesh);

    buildGarmentModel(orderState.garmentType);
    handleResponsiveViewport();

    container.addEventListener('pointerdown', (e) => {
        isDragging = true;
        previousMousePosition = { x: e.clientX, y: e.clientY };
        if (container.setPointerCapture) {
            try { container.setPointerCapture(e.pointerId); } catch (_) {}
        }
    });

    window.addEventListener('pointermove', (e) => {
        if (!isDragging) return;
        const deltaX = e.clientX - previousMousePosition.x;
        const deltaY = e.clientY - previousMousePosition.y;
        targetRotationY += deltaX * 0.0085;
        targetRotationX = Math.max(-0.42, Math.min(0.48, targetRotationX + deltaY * 0.0055));
        previousMousePosition = { x: e.clientX, y: e.clientY };
    }, { passive: true });

    window.addEventListener('pointerup', () => { isDragging = false; }, { passive: true });
    window.addEventListener('pointercancel', () => { isDragging = false; }, { passive: true });

    container.addEventListener('wheel', (e) => {
        e.preventDefault();
        targetCameraZ = Math.max(1.85, Math.min(9.0, targetCameraZ + e.deltaY * 0.002));
    }, { passive: false });

    window.addEventListener('resize', () => {
        if (resizeRafId) cancelAnimationFrame(resizeRafId);
        resizeRafId = requestAnimationFrame(handleResponsiveViewport);
    });

    startRenderLoop();
}

/**
 * Pausa automáticamente el ciclo WebGL cuando la pestaña no está activa
 * o cuando el contenedor 3D sale de la vista del usuario.
 */
function setupRenderLifecycleObservers() {
    document.addEventListener('visibilitychange', () => {
        isDocumentVisible = !document.hidden;
        if (isDocumentVisible && isViewportVisible) {
            startRenderLoop();
        } else {
            stopRenderLoop();
        }
    });

    const container = document.getElementById('canvas3d-wrapper');
    if (container && 'IntersectionObserver' in window) {
        const observer = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                isViewportVisible = entry.isIntersecting;
                if (isDocumentVisible && isViewportVisible) {
                    startRenderLoop();
                } else {
                    stopRenderLoop();
                }
            });
        }, { threshold: 0.05 });
        observer.observe(container);
    }
}

function startRenderLoop() {
    if (animationFrameId !== null) return;
    animationFrameId = requestAnimationFrame(animate3D);
}

function stopRenderLoop() {
    if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }
}

function animate3D() {
    if (!isDocumentVisible || !isViewportVisible) {
        animationFrameId = null;
        return;
    }

    animationFrameId = requestAnimationFrame(animate3D);

    const time = performance.now() * 0.0014;
    garmentGroup.position.y = Math.sin(time) * 0.025;

    garmentGroup.rotation.y += (targetRotationY - garmentGroup.rotation.y) * 0.09;
    garmentGroup.rotation.x += (targetRotationX - garmentGroup.rotation.x) * 0.09;

    camera.position.z += (targetCameraZ - camera.position.z) * 0.08;
    camera.position.y += (targetCameraY - camera.position.y) * 0.08;

    renderer.render(scene, camera);
}

function getResponsiveCameraZ(type) {
    const spec = GARMENT_CATALOG[type] || GARMENT_CATALOG['long-shirt'];
    const isHeadwear = spec.category === 'headwear';
    if (window.innerWidth < 768) {
        return isHeadwear ? 3.35 : Math.max(5.4, spec.cameraZ);
    } else if (window.innerWidth <= 1024) {
        return isHeadwear ? 2.95 : Math.max(4.65, spec.cameraZ);
    }
    return spec.cameraZ;
}

function handleResponsiveViewport() {
    const container = document.getElementById('canvas3d-wrapper');
    if (!container || !camera || !renderer) return;

    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || 340;

    camera.aspect = w / h;
    targetCameraZ = getResponsiveCameraZ(orderState.garmentType);
    camera.position.z = targetCameraZ;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h);
}

// Remueve la prenda activa del grupo sin destruir las geometrías cacheadas en garmentModelCache
function detachCurrentGarmentNode() {
    if (!garmentGroup) return;
    if (activeGarmentNode && activeGarmentNode.parent === garmentGroup) {
        garmentGroup.remove(activeGarmentNode);
    }
    activeGarmentNode = null;
    for (let i = garmentGroup.children.length - 1; i >= 0; i--) {
        const child = garmentGroup.children[i];
        if (child !== logoMesh) {
            garmentGroup.remove(child);
        }
    }
}

/**
 * Precalcula una cuadrícula de profundidad frontal (37x37) una sola vez por prenda.
 * Así updateLogoTransform() interpola Z en O(1) (<0.08ms) sin lanzar 441 rayos en cada movimiento de slider.
 */
function ensureGarmentDepthGrid(type, modelNode) {
    if (garmentDepthCache.has(type)) {
        return garmentDepthCache.get(type);
    }

    const cols = 37;
    const rows = 37;
    const minX = -0.68, maxX = 0.68;
    const minY = -0.75, maxY = 0.85;
    const stepX = (maxX - minX) / (cols - 1);
    const stepY = (maxY - minY) / (rows - 1);

    const isPolo = type === 'polo';
    const isTshirt = type === 'tshirt';
    const isHeadwear = type === 'cap' || type === 'beanie';
    let fallbackCenterZ = 0.285;
    if (isPolo) fallbackCenterZ = 0.38;
    else if (isTshirt) fallbackCenterZ = 0.36;
    else if (isHeadwear) fallbackCenterZ = 0.52;

    modelNode.updateMatrixWorld(true);
    const meshes = [];
    modelNode.traverse((child) => {
        if (child.isMesh) meshes.push(child);
    });

    const zValues = new Float32Array(cols * rows);

    for (let r = 0; r < rows; r++) {
        const wy = minY + r * stepY;
        for (let c = 0; c < cols; c++) {
            const wx = minX + c * stepX;
            rayOrigin.set(wx, wy, 2.5);
            rayDir.set(0, 0, -1);
            surfaceRaycaster.set(rayOrigin, rayDir);
            const hits = surfaceRaycaster.intersectObjects(meshes, false);
            if (hits.length > 0) {
                zValues[r * cols + c] = hits[0].point.z;
            } else {
                const distSq = wx * wx + wy * wy;
                zValues[r * cols + c] = fallbackCenterZ - distSq * 0.22;
            }
        }
    }

    const gridObj = { cols, rows, minX, maxX, minY, maxY, stepX, stepY, zValues, fallbackCenterZ };
    garmentDepthCache.set(type, gridObj);
    return gridObj;
}

function sampleDepthFromGrid(grid, wx, wy) {
    if (!grid) return 0.32;
    const clampedX = Math.max(grid.minX, Math.min(grid.maxX, wx));
    const clampedY = Math.max(grid.minY, Math.min(grid.maxY, wy));

    const gx = (clampedX - grid.minX) / grid.stepX;
    const gy = (clampedY - grid.minY) / grid.stepY;

    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const x1 = Math.min(grid.cols - 1, x0 + 1);
    const y1 = Math.min(grid.rows - 1, y0 + 1);

    const tx = gx - x0;
    const ty = gy - y0;

    const z00 = grid.zValues[y0 * grid.cols + x0];
    const z10 = grid.zValues[y0 * grid.cols + x1];
    const z01 = grid.zValues[y1 * grid.cols + x0];
    const z11 = grid.zValues[y1 * grid.cols + x1];

    const z0 = z00 * (1 - tx) + z10 * tx;
    const z1 = z01 * (1 - tx) + z11 * tx;
    return z0 * (1 - ty) + z1 * ty;
}

/**
 * Hornea un modelo GLTF en un grupo estático plano (eliminando los ~390 huesos de SkinnedMesh)
 * y CONSERVA sus materiales y texturas originales de assets/models/textures*.
 */
function normalizeAndBakeGltfScene(gltfScene, type) {
    const cfg = GLTF_GARMENT_CONFIG[type];
    if (cfg.rotateX) {
        gltfScene.rotation.set(cfg.rotateX, 0, 0);
    }
    gltfScene.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(gltfScene);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());

    let refDim = size.y;
    if (cfg.fitMode === 'maxDim') {
        refDim = Math.max(size.x, size.y, size.z);
    }
    const targetScale = refDim > 0.001 ? cfg.targetSize / refDim : 1.0;

    gltfScene.scale.set(targetScale, targetScale, targetScale);
    gltfScene.position.set(
        -center.x * targetScale,
        (-center.y * targetScale) + cfg.yOffset,
        -center.z * targetScale
    );
    gltfScene.updateMatrixWorld(true);

    const bakedGroup = new THREE.Group();
    bakedGroup.name = `garment_${type}`;

    const spec = GARMENT_CATALOG[type] || GARMENT_CATALOG['long-shirt'];
    const fallbackWeaveBump = getWeaveBumpTexture(spec.weave);

    const prepareGltfMaterial = (mat) => {
        if (!mat) return fabricMaterial;
        mat.side = THREE.DoubleSide;
        mat.wireframe = isWireframe;
        if (!mat.userData) mat.userData = {};
        if (!mat.userData.originalColor && mat.color) {
            mat.userData.originalColor = mat.color.clone();
        }
        mat.userData.hasOriginalTexture = Boolean(mat.map || mat.normalMap || mat.roughnessMap || mat.metalnessMap);
        // Si el modelo GLTF no trae texturas de imagen (ej. tshirt.gltf), aplicarle bump de trama textil
        if (!mat.map && !mat.normalMap && !mat.bumpMap) {
            mat.bumpMap = fallbackWeaveBump;
            mat.bumpScale = 0.016;
        }
        mat.needsUpdate = true;
        return mat;
    };

    gltfScene.traverse((child) => {
        if (child.isMesh && child.geometry) {
            const bakedGeo = child.geometry.clone();
            // Eliminar atributos de skinning para liberar GPU y descartar los 390 huesos
            bakedGeo.deleteAttribute('skinIndex');
            bakedGeo.deleteAttribute('skinWeight');
            bakedGeo.applyMatrix4(child.matrixWorld);
            bakedGeo.computeVertexNormals();
            bakedGeo.computeBoundingBox();
            bakedGeo.computeBoundingSphere();

            let finalMaterial = fabricMaterial;
            if (child.material) {
                if (Array.isArray(child.material)) {
                    finalMaterial = child.material.map(prepareGltfMaterial);
                } else {
                    finalMaterial = prepareGltfMaterial(child.material);
                }
            }

            const mesh = new THREE.Mesh(bakedGeo, finalMaterial);
            bakedGroup.add(mesh);

            // Liberar únicamente la geometría temporal del loader (conservando materiales y texturas)
            child.geometry.dispose();
        }
    });

    return bakedGroup;
}

function loadOrGetGarmentNode(type) {
    if (garmentModelCache.has(type)) {
        return Promise.resolve(garmentModelCache.get(type));
    }

    if (garmentLoadPromises.has(type)) {
        return garmentLoadPromises.get(type);
    }

    // Modelos procedurales (instantáneos, se construyen y cachean en memoria)
    if (!GLTF_GARMENT_CONFIG[type]) {
        const procGroup = new THREE.Group();
        procGroup.name = `garment_${type}`;
        if (type === 'beanie') {
            buildFishermanBeanie(procGroup);
        } else {
            buildAnatomicalTop(type, procGroup);
        }
        garmentModelCache.set(type, procGroup);
        ensureGarmentDepthGrid(type, procGroup);
        return Promise.resolve(procGroup);
    }

    // Modelos GLTF externos: descarga única + horneado + caché
    const cfg = GLTF_GARMENT_CONFIG[type];
    const promise = new Promise((resolve, reject) => {
        gltfLoader.load(
            cfg.url,
            (gltf) => {
                try {
                    const bakedGroup = normalizeAndBakeGltfScene(gltf.scene, type);
                    garmentModelCache.set(type, bakedGroup);
                    ensureGarmentDepthGrid(type, bakedGroup);
                    garmentLoadPromises.delete(type);
                    resolve(bakedGroup);
                } catch (err) {
                    garmentLoadPromises.delete(type);
                    reject(err);
                }
            },
            undefined,
            (error) => {
                garmentLoadPromises.delete(type);
                reject(error);
            }
        );
    });

    garmentLoadPromises.set(type, promise);
    return promise;
}

/**
 * Precarga silenciosa en segundo plano de las demás prendas GLTF durante tiempos muertos del navegador,
 * para que cuando el usuario cambie de prenda el cambio sea de 0ms.
 */
function scheduleIdlePreload() {
    if (idlePreloadScheduled) return;
    idlePreloadScheduled = true;

    const queue = Object.keys(GLTF_GARMENT_CONFIG).filter(t => !garmentModelCache.has(t));
    const scheduleNext = (fn) => {
        if ('requestIdleCallback' in window) {
            window.requestIdleCallback(fn, { timeout: 2500 });
        } else {
            setTimeout(fn, 650);
        }
    };

    function preloadNext() {
        if (!queue.length) return;
        if (document.hidden) {
            setTimeout(preloadNext, 1500);
            return;
        }
        const nextType = queue.shift();
        if (garmentModelCache.has(nextType)) {
            scheduleNext(preloadNext);
            return;
        }
        loadOrGetGarmentNode(nextType)
            .catch(() => {})
            .finally(() => {
                setTimeout(() => scheduleNext(preloadNext), 400);
            });
    }

    setTimeout(() => scheduleNext(preloadNext), 700);
}

function buildGarmentModel(type) {
    const loadToken = ++activeLoadToken;
    const spec = GARMENT_CATALOG[type] || GARMENT_CATALOG['long-shirt'];
    const weaveBump = getWeaveBumpTexture(spec.weave);

    fabricMaterial.bumpMap = weaveBump;
    fabricMaterial.bumpScale = type === 'beanie' ? 0.038 : (type === 'polo' ? 0.024 : 0.016);
    fabricMaterial.needsUpdate = true;

    secondaryMaterial.bumpMap = weaveBump;
    secondaryMaterial.bumpScale = type === 'beanie' ? 0.045 : 0.022;
    secondaryMaterial.needsUpdate = true;

    targetCameraZ = getResponsiveCameraZ(type);
    targetCameraY = spec.cameraY;

    if (type === 'cap') {
        shadowPlane.position.y = -0.45;
        shadowPlane.scale.set(0.75, 0.75, 1);
    } else if (type === 'beanie') {
        shadowPlane.position.y = -0.60;
        shadowPlane.scale.set(0.72, 0.72, 1);
    } else {
        shadowPlane.position.y = -1.08;
        shadowPlane.scale.set(1, 1, 1);
    }

    // Si ya está en caché, el cambio es instantáneo (< 1ms) sin mostrar spinner
    if (garmentModelCache.has(type)) {
        setViewportLoaderVisible(false);
        detachCurrentGarmentNode();
        activeGarmentNode = garmentModelCache.get(type);
        garmentGroup.add(activeGarmentNode);
        updateAllGarmentColors(orderState.fabricColor);
        updateLogoTransform();
        scheduleIdlePreload();
        return;
    }

    setViewportLoaderVisible(true, `Cargando ${spec.name}...`);

    loadOrGetGarmentNode(type)
        .then((modelNode) => {
            if (loadToken !== activeLoadToken) return;
            detachCurrentGarmentNode();
            activeGarmentNode = modelNode;
            garmentGroup.add(modelNode);
            updateAllGarmentColors(orderState.fabricColor);
            updateLogoTransform();
            setViewportLoaderVisible(false);
            scheduleIdlePreload();
        })
        .catch((err) => {
            console.error(`Error cargando modelo ${type}, usando respaldo anatómico:`, err);
            if (loadToken !== activeLoadToken) return;
            detachCurrentGarmentNode();
            const fallbackGroup = new THREE.Group();
            if (type === 'cap') {
                buildBaseballCap(fallbackGroup);
            } else {
                buildAnatomicalTop(type, fallbackGroup);
            }
            garmentModelCache.set(type, fallbackGroup);
            ensureGarmentDepthGrid(type, fallbackGroup);
            activeGarmentNode = fallbackGroup;
            garmentGroup.add(fallbackGroup);
            updateLogoTransform();
            setViewportLoaderVisible(false);
        });
}

function updateAllGarmentColors(hexColor) {
    const isOriginalMode = !hexColor || hexColor === 'original' || orderState.useOriginalTextureColor;
    const targetColor = new THREE.Color(isOriginalMode ? '#1c1c1e' : hexColor);

    fabricMaterial.color.set(targetColor);
    secondaryMaterial.color.set(targetColor).offsetHSL(0, 0, 0.025);

    if (activeGarmentNode) {
        activeGarmentNode.traverse((child) => {
            if (!child.isMesh || !child.material) return;
            const mats = Array.isArray(child.material) ? child.material : [child.material];
            mats.forEach((mat) => {
                if (!mat || mat === fabricMaterial || mat === secondaryMaterial || mat === buttonMaterial || mat === accentMetalMaterial || mat === innerNeckMaterial) {
                    return;
                }
                if (mat.color) {
                    if (isOriginalMode && mat.userData?.originalColor) {
                        mat.color.copy(mat.userData.originalColor);
                    } else if (!isOriginalMode) {
                        mat.color.set(targetColor);
                    }
                    mat.needsUpdate = true;
                }
            });
        });
    }
}

/**
 * Proyecta la malla del logotipo sobre la superficie curva de la prenda usando el
 * mapa de profundidad cacheado en O(1) (< 0.08ms), manteniendo 60 FPS al arrastrar sliders.
 */
function updateLogoTransform() {
    if (!logoMesh || !garmentGroup) return;

    logoMesh.position.set(0, 0, 0);
    logoMesh.rotation.set(0, 0, 0);

    const geo = logoMesh.geometry;
    const pos = geo.attributes.position;
    const count = pos.count;
    const gridSegs = 20;
    const cols = gridSegs + 1;

    const depthGrid = garmentDepthCache.get(orderState.garmentType) ||
        (activeGarmentNode ? ensureGarmentDepthGrid(orderState.garmentType, activeGarmentNode) : null);

    const rawZ = new Float32Array(count);
    const worldXArr = new Float32Array(count);
    const worldYArr = new Float32Array(count);

    for (let i = 0; i < count; i++) {
        const ix = i % cols;
        const iy = Math.floor(i / cols);
        const u = (ix / gridSegs) - 0.5;
        const v = 0.5 - (iy / gridSegs);

        const wx = orderState.logoX + u * orderState.logoScale;
        const wy = orderState.logoY + v * orderState.logoScale;
        worldXArr[i] = wx;
        worldYArr[i] = wy;

        rawZ[i] = sampleDepthFromGrid(depthGrid, wx, wy);
    }

    const surfaceOffset = orderState.technique === 'embroidery' ? 0.005 : 0.002;

    for (let iy = 0; iy < cols; iy++) {
        for (let ix = 0; ix < cols; ix++) {
            const idx = iy * cols + ix;
            let sum = 0, n = 0;
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const nx = ix + dx;
                    const ny = iy + dy;
                    if (nx >= 0 && nx < cols && ny >= 0 && ny < cols) {
                        sum += rawZ[ny * cols + nx];
                        n++;
                    }
                }
            }
            const smoothZ = sum / n;
            const finalZ = Math.max(rawZ[idx], smoothZ) + surfaceOffset;
            pos.setXYZ(idx, worldXArr[idx], worldYArr[idx], finalZ);
        }
    }

    pos.needsUpdate = true;
    geo.computeVertexNormals();
}

function scheduleLogoTransformUpdate() {
    if (logoTransformRafId) return;
    logoTransformRafId = requestAnimationFrame(() => {
        logoTransformRafId = null;
        updateLogoTransform();
    });
}

function buildAnatomicalTop(type, targetContainer = garmentGroup) {
    const isHoodie = type === 'hoodie';
    const isTshirt = type === 'tshirt';
    const torsoW = isHoodie ? 1.28 : (isTshirt ? 1.24 : 1.18);
    const torsoH = isHoodie ? 1.56 : 1.58;
    const torsoD = isHoodie ? 0.50 : 0.46;

    const torsoGeo = new THREE.BoxGeometry(torsoW, torsoH, torsoD, 24, 24, 12);
    const pos = torsoGeo.attributes.position;

    for (let i = 0; i < pos.count; i++) {
        let x = pos.getX(i);
        let y = pos.getY(i);
        let z = pos.getZ(i);

        const edgeFactor = Math.abs(x) / (torsoW * 0.5);
        z *= (1 - Math.pow(edgeFactor, 2.4) * 0.28);

        if (z > 0) {
            const chestCurve = Math.cos(x * 1.45) * 0.068;
            const verticalDrape = Math.sin((y + 0.8) * 1.8) * 0.025;
            z += chestCurve + verticalDrape;
        } else {
            z -= Math.cos(x * 1.4) * 0.035;
        }

        if (!isHoodie && y < 0.2 && y > -0.6) {
            x *= 0.96 + Math.abs(y) * 0.04;
        }

        if (y > 0.62) {
            y -= Math.pow(Math.abs(x), 1.35) * 0.18;
        }

        pos.setXYZ(i, x, y, z);
    }
    torsoGeo.computeVertexNormals();
    const torsoMesh = new THREE.Mesh(torsoGeo, fabricMaterial);
    targetContainer.add(torsoMesh);

    const innerNeck = new THREE.Mesh(
        new THREE.CylinderGeometry(0.21, 0.21, 0.16, 24),
        innerNeckMaterial
    );
    innerNeck.position.set(0, 0.76, 0);
    targetContainer.add(innerNeck);

    if (type === 'long-shirt' || type === 'short-shirt') {
        const isLong = type === 'long-shirt';
        buildTailoredSleeves(isLong, false, false, targetContainer);
        buildFoldedShirtCollar(targetContainer);

        const placket = new THREE.Mesh(
            new THREE.BoxGeometry(0.085, 1.50, 0.025),
            secondaryMaterial
        );
        placket.position.set(0, -0.02, 0.265);
        targetContainer.add(placket);

        const btnGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.012, 14);
        for (let b = 0; b < 6; b++) {
            const btn = new THREE.Mesh(btnGeo, buttonMaterial);
            btn.rotation.x = Math.PI / 2;
            btn.position.set(0, 0.52 - b * 0.22, 0.282);
            targetContainer.add(btn);
        }
    } else if (type === 'hoodie') {
        buildTailoredSleeves(true, true, false, targetContainer);

        const hoodOuter = new THREE.Mesh(
            new THREE.SphereGeometry(0.41, 24, 20),
            secondaryMaterial
        );
        hoodOuter.scale.set(1.12, 1.05, 0.98);
        hoodOuter.position.set(0, 0.94, -0.09);
        targetContainer.add(hoodOuter);

        const hoodCollar = new THREE.Mesh(
            new THREE.TorusGeometry(0.26, 0.065, 12, 24, Math.PI * 1.15),
            secondaryMaterial
        );
        hoodCollar.rotation.set(1.3, 0, -0.22);
        hoodCollar.position.set(0, 0.77, 0.06);
        targetContainer.add(hoodCollar);

        const cordGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.36, 10);
        const agletGeo = new THREE.CylinderGeometry(0.014, 0.012, 0.045, 10);
        [-0.09, 0.09].forEach(xCord => {
            const cord = new THREE.Mesh(cordGeo, secondaryMaterial);
            cord.position.set(xCord, 0.53, 0.285);
            targetContainer.add(cord);

            const aglet = new THREE.Mesh(agletGeo, accentMetalMaterial);
            aglet.position.set(xCord, 0.34, 0.285);
            targetContainer.add(aglet);
        });

        const pocketGeo = new THREE.BoxGeometry(0.78, 0.38, 0.055, 8, 8, 4);
        const pPos = pocketGeo.attributes.position;
        for (let i = 0; i < pPos.count; i++) {
            const py = pPos.getY(i);
            let px = pPos.getX(i);
            if (py > 0.02) px *= 0.82;
            pPos.setX(i, px);
        }
        pocketGeo.computeVertexNormals();
        const pocket = new THREE.Mesh(pocketGeo, secondaryMaterial);
        pocket.position.set(0, -0.40, 0.268);
        targetContainer.add(pocket);

        const waistRib = new THREE.Mesh(
            new THREE.BoxGeometry(torsoW * 0.97, 0.14, torsoD * 0.94),
            secondaryMaterial
        );
        waistRib.position.set(0, -0.78, 0);
        targetContainer.add(waistRib);
    }
}

function buildFoldedShirtCollar(targetContainer = garmentGroup) {
    const band = new THREE.Mesh(
        new THREE.CylinderGeometry(0.245, 0.265, 0.16, 24, 1, true),
        secondaryMaterial
    );
    band.position.set(0, 0.80, 0);
    targetContainer.add(band);

    const lapelGeo = new THREE.BoxGeometry(0.19, 0.13, 0.025);
    [-1, 1].forEach(dir => {
        const lapel = new THREE.Mesh(lapelGeo, secondaryMaterial);
        lapel.position.set(dir * 0.115, 0.75, 0.245);
        lapel.rotation.z = dir * -0.28;
        lapel.rotation.y = dir * 0.32;
        lapel.rotation.x = 0.18;
        targetContainer.add(lapel);
    });
}

function buildTailoredSleeves(isLong, isRelaxed = false, hasPoloRib = false, targetContainer = garmentGroup) {
    const sleeveLen = isLong ? 1.18 : (isRelaxed ? 0.54 : 0.46);
    const topRadius = isRelaxed ? 0.245 : 0.215;
    const bottomRadius = isLong ? 0.145 : (isRelaxed ? 0.205 : 0.18);

    const shoulderCapGeo = new THREE.SphereGeometry(topRadius * 0.98, 16, 16);
    const sleeveCylGeo = new THREE.CylinderGeometry(topRadius, bottomRadius, sleeveLen, 20, 8);
    const cuffH = isLong ? 0.13 : 0.06;
    const cuffGeo = (isLong || hasPoloRib)
        ? new THREE.CylinderGeometry(bottomRadius * 1.03, bottomRadius * 1.01, cuffH, 20)
        : null;

    [-1, 1].forEach(side => {
        const sleeveGroup = new THREE.Group();

        const shoulderCap = new THREE.Mesh(shoulderCapGeo, fabricMaterial);
        shoulderCap.position.set(0, sleeveLen * 0.46, 0);
        sleeveGroup.add(shoulderCap);

        const sleeveCyl = new THREE.Mesh(sleeveCylGeo, fabricMaterial);
        sleeveGroup.add(sleeveCyl);

        if (cuffGeo) {
            const cuff = new THREE.Mesh(cuffGeo, secondaryMaterial);
            cuff.position.set(0, -sleeveLen * 0.5 + cuffH * 0.3, 0);
            sleeveGroup.add(cuff);
        }

        const posX = isLong ? side * 0.85 : side * 0.74;
        const posY = isLong ? 0.15 : 0.42;
        const angleZ = isLong ? side * 0.39 : side * 0.48;

        sleeveGroup.position.set(posX, posY, 0);
        sleeveGroup.rotation.z = angleZ;
        targetContainer.add(sleeveGroup);
    });
}

function buildBaseballCap(targetContainer = garmentGroup) {
    const capGroup = new THREE.Group();

    const crownGeo = new THREE.SphereGeometry(0.50, 32, 20, 0, Math.PI * 2, 0, Math.PI * 0.56);
    const cPos = crownGeo.attributes.position;
    for (let i = 0; i < cPos.count; i++) {
        let x = cPos.getX(i);
        let y = cPos.getY(i);
        let z = cPos.getZ(i);
        if (z > 0 && y > 0.08) {
            y += z * 0.07;
        }
        cPos.setXYZ(i, x, y, z);
    }
    crownGeo.computeVertexNormals();
    const crown = new THREE.Mesh(crownGeo, fabricMaterial);
    crown.position.y = -0.14;
    capGroup.add(crown);

    const seamGeo = new THREE.TorusGeometry(0.502, 0.005, 6, 24, Math.PI * 0.52);
    for (let p = 0; p < 6; p++) {
        const angle = (p * Math.PI) / 3;
        const seam = new THREE.Mesh(seamGeo, secondaryMaterial);
        seam.position.y = -0.14;
        seam.rotation.y = angle;
        seam.rotation.z = Math.PI / 2;
        capGroup.add(seam);
    }

    const topButton = new THREE.Mesh(
        new THREE.CylinderGeometry(0.042, 0.042, 0.025, 16),
        secondaryMaterial
    );
    topButton.position.set(0, 0.38, 0);
    capGroup.add(topButton);

    const sweatBand = new THREE.Mesh(
        new THREE.TorusGeometry(0.49, 0.024, 12, 36),
        secondaryMaterial
    );
    sweatBand.rotation.x = Math.PI / 2;
    sweatBand.position.set(0, -0.14, 0);
    capGroup.add(sweatBand);

    const visorGeo = new THREE.BoxGeometry(0.86, 0.028, 0.54, 24, 4, 12);
    const vPos = visorGeo.attributes.position;
    for (let i = 0; i < vPos.count; i++) {
        let vx = vPos.getX(i);
        let vy = vPos.getY(i);
        let vz = vPos.getZ(i);

        const frontFactor = (vz + 0.27) / 0.54;
        vx *= (1 - Math.pow(frontFactor, 1.9) * 0.28);
        vy -= Math.pow(vx, 2) * 0.42;
        vy -= frontFactor * 0.09;

        vPos.setXYZ(i, vx, vy, vz);
    }
    visorGeo.computeVertexNormals();
    const visor = new THREE.Mesh(visorGeo, secondaryMaterial);
    visor.position.set(0, -0.11, 0.54);
    capGroup.add(visor);

    targetContainer.add(capGroup);
}

function buildFishermanBeanie(targetContainer = garmentGroup) {
    const beanieGroup = new THREE.Group();

    const domeGeo = new THREE.SphereGeometry(0.47, 32, 24, 0, Math.PI * 2, 0, Math.PI * 0.62);
    const dPos = domeGeo.attributes.position;
    for (let i = 0; i < dPos.count; i++) {
        let x = dPos.getX(i);
        let y = dPos.getY(i);
        let z = dPos.getZ(i);

        const angle = Math.atan2(z, x);
        const ribWave = Math.sin(angle * 28) * 0.008;
        const pinch = y > 0.25 ? Math.cos(angle * 4) * 0.015 : 0;
        x += Math.cos(angle) * (ribWave + pinch);
        z += Math.sin(angle) * (ribWave + pinch);
        y *= 1.12;
        dPos.setXYZ(i, x, y, z);
    }
    domeGeo.computeVertexNormals();
    const dome = new THREE.Mesh(domeGeo, fabricMaterial);
    dome.position.y = -0.12;
    beanieGroup.add(dome);

    const cuffGeo = new THREE.CylinderGeometry(0.495, 0.485, 0.27, 40, 10);
    const cPos = cuffGeo.attributes.position;
    for (let i = 0; i < cPos.count; i++) {
        let x = cPos.getX(i);
        let y = cPos.getY(i);
        let z = cPos.getZ(i);
        const angle = Math.atan2(z, x);
        const rib = Math.sin(angle * 32) * 0.011;
        const edgeRound = Math.cos((y / 0.135) * 1.1) * 0.018;
        x += Math.cos(angle) * (rib + edgeRound);
        z += Math.sin(angle) * (rib + edgeRound);
        cPos.setXYZ(i, x, y, z);
    }
    cPos.needsUpdate = true;
    cuffGeo.computeVertexNormals();

    const cuff = new THREE.Mesh(cuffGeo, secondaryMaterial);
    cuff.position.set(0, -0.17, 0);
    beanieGroup.add(cuff);

    targetContainer.add(beanieGroup);
}

function analyzeLogoWithAI(imgElement, autoSwitchIfRecommended = false) {
    const sCtx = sharedSampleCanvas.getContext('2d');
    sCtx.clearRect(0, 0, 96, 96);
    sCtx.drawImage(imgElement, 0, 0, 96, 96);
    const data = sCtx.getImageData(0, 0, 96, 96).data;

    const colorBuckets = new Set();

    for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
        const isWhiteBg = orderState.removeWhiteBg && r > 240 && g > 240 && b > 240;
        if (a > 40 && !isWhiteBg) {
            const key = `${Math.floor(r / 32)}-${Math.floor(g / 32)}-${Math.floor(b / 32)}`;
            colorBuckets.add(key);
        }
    }

    const distinctTones = colorBuckets.size;
    const diagText = document.getElementById('ai-recommendation-text');
    const confBadge = document.getElementById('ai-confidence');

    if (distinctTones > 26) {
        confBadge.textContent = `${distinctTones} tonos detectados`;
        diagText.innerHTML = 'Diseño policromático / con degradados detectado. ' +
                             'La IA recomienda <strong>Estampado HD (DTF / Serigrafía)</strong> ' +
                             'para fidelidad fotográfica o <strong>Bordado 3D</strong> para texturizado artístico.';
        if (autoSwitchIfRecommended) {
            setTechniqueMode('print');
        }
    } else {
        confBadge.textContent = 'Vectorial / Sólido';
        const hilos = Math.max(1, Math.min(12, Math.round(distinctTones / 2)));
        diagText.innerHTML = `Logotipo de trazos definidos (${hilos} hilos base). ` +
                             `Ideal tanto para <strong>Bordado 3D con relieve</strong> ` +
                             `como para <strong>Estampado Serigráfico</strong>.`;
    }
}

/**
 * Exporta el canvas de bordado a Base64 de forma diferida (en idle) o bajo demanda al guardar carrito,
 * evitando bloquear 50-150ms el hilo principal durante cambios interactivos.
 */
function ensureEmbroideryDataUrl() {
    if (!logoDataUrlDirty && orderState.embroideryDataUrl) {
        return orderState.embroideryDataUrl;
    }
    const canvas = document.getElementById('embroidery-canvas');
    if (canvas) {
        orderState.embroideryDataUrl = canvas.toDataURL('image/png');
        logoDataUrlDirty = false;
    }
    return orderState.embroideryDataUrl;
}

function scheduleDeferredLogoExport() {
    logoDataUrlDirty = true;
    clearTimeout(deferredExportTimer);
    deferredExportTimer = setTimeout(() => {
        if ('requestIdleCallback' in window) {
            window.requestIdleCallback(() => ensureEmbroideryDataUrl(), { timeout: 1200 });
        } else {
            ensureEmbroideryDataUrl();
        }
    }, 350);
}

function renderLogoEffect(imgElement) {
    if (!imgElement) return;

    const canvas = document.getElementById('embroidery-canvas');
    const ctx = canvas.getContext('2d');
    const bCtx = bumpCanvas.getContext('2d');
    const size = canvas.width;

    ctx.clearRect(0, 0, size, size);
    bCtx.fillStyle = '#000000';
    bCtx.fillRect(0, 0, size, size);

    const tempCtx = sharedProcessCanvas.getContext('2d');
    tempCtx.clearRect(0, 0, size, size);

    const imgW = imgElement.width || imgElement.naturalWidth || 320;
    const imgH = imgElement.height || imgElement.naturalHeight || 320;
    const scale = Math.min((size - 32) / imgW, (size - 32) / imgH);
    const drawW = imgW * scale;
    const drawH = imgH * scale;
    const offsetX = (size - drawW) / 2;
    const offsetY = (size - drawH) / 2;

    tempCtx.drawImage(imgElement, offsetX, offsetY, drawW, drawH);
    const srcImgData = tempCtx.getImageData(0, 0, size, size);
    const imgData = srcImgData.data;

    if (orderState.removeWhiteBg) {
        for (let i = 0; i < imgData.length; i += 4) {
            const r = imgData[i], g = imgData[i + 1], b = imgData[i + 2];
            if (r > 242 && g > 242 && b > 242) {
                imgData[i + 3] = 0;
            } else if (r > 225 && g > 225 && b > 225) {
                imgData[i + 3] = Math.round(imgData[i + 3] * 0.35);
            }
        }
        tempCtx.putImageData(srcImgData, 0, 0);
    }

    if (orderState.technique === 'embroidery') {
        const step = parseInt(orderState.stitchDensity, 10);
        let stitches = 0;

        ctx.shadowColor = 'rgba(0, 0, 0, 0.48)';
        ctx.shadowBlur = 2.0;
        ctx.shadowOffsetX = 1.1;
        ctx.shadowOffsetY = 1.1;
        ctx.lineWidth = step * 0.82;
        ctx.lineCap = 'round';

        bCtx.lineWidth = step * 0.85;
        bCtx.lineCap = 'round';

        for (let y = 0; y < size; y += step) {
            for (let x = 0; x < size; x += step) {
                const idx = (y * size + x) * 4;
                const a = imgData[idx + 3];

                if (a > 45) {
                    stitches++;
                    const r = imgData[idx];
                    const g = imgData[idx + 1];
                    const b = imgData[idx + 2];

                    const threadWave = Math.sin((x * 0.35) + (y * 0.25));
                    const shine = threadWave > 0 ? 22 : -14;
                    const tr = Math.min(255, Math.max(0, r + shine));
                    const tg = Math.min(255, Math.max(0, g + shine));
                    const tb = Math.min(255, Math.max(0, b + shine));

                    const jitter = Math.sin(x * 0.6 + y * 0.4) * 0.85;
                    const x1 = x - step * 0.48;
                    const y1 = y - step * 0.36 + jitter;
                    const x2 = x + step * 0.48;
                    const y2 = y + step * 0.36 - jitter;

                    ctx.strokeStyle = `rgb(${tr}, ${tg}, ${tb})`;
                    ctx.beginPath();
                    ctx.moveTo(x1, y1);
                    ctx.lineTo(x2, y2);
                    ctx.stroke();

                    const bumpVal = threadWave > 0 ? 245 : 175;
                    bCtx.strokeStyle = `rgb(${bumpVal},${bumpVal},${bumpVal})`;
                    bCtx.beginPath();
                    bCtx.moveTo(x1, y1);
                    bCtx.lineTo(x2, y2);
                    bCtx.stroke();
                }
            }
        }

        orderState.stitchCount = Math.max(1200, stitches * 3);
        document.getElementById('preview-mode-title').textContent = 'MATRIZ DE PUNTADAS IA';
        document.getElementById('stitch-count').textContent = `~${orderState.stitchCount.toLocaleString()} puntadas`;

    } else {
        ctx.shadowColor = 'rgba(0, 0, 0, 0.12)';
        ctx.shadowBlur = 1;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;

        ctx.drawImage(sharedProcessCanvas, 0, 0);

        const printFinish = parseInt(orderState.stitchDensity, 10);
        const printData = ctx.getImageData(0, 0, size, size);
        const pPixels = printData.data;
        let inkPixels = 0;

        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const idx = (y * size + x) * 4;
                const a = pPixels[idx + 3];
                if (a > 35) {
                    inkPixels++;
                    if (printFinish >= 5 && ((x + y) % 3 === 0)) {
                        pPixels[idx + 3] = Math.round(a * 0.78);
                    } else {
                        pPixels[idx] = Math.min(255, Math.round(pPixels[idx] * 1.04));
                        pPixels[idx + 1] = Math.min(255, Math.round(pPixels[idx + 1] * 1.04));
                        pPixels[idx + 2] = Math.min(255, Math.round(pPixels[idx + 2] * 1.04));
                    }
                }
            }
        }
        ctx.putImageData(printData, 0, 0);
        bCtx.drawImage(sharedProcessCanvas, 0, 0);

        const cmSide = Math.round(orderState.logoScale * 35);
        orderState.printAreaCm2 = Math.round((inkPixels / (size * size)) * (cmSide * cmSide) * 1.4) + 18;
        document.getElementById('preview-mode-title').textContent = 'MATRIZ SERIGRÁFICA / DTF IA';
        document.getElementById('stitch-count').textContent = `300 DPI • ~${orderState.printAreaCm2} cm²`;
    }

    scheduleDeferredLogoExport();
    updateDynamicPricing();

    if (logoMesh) {
        const isEmb = orderState.technique === 'embroidery';
        logoMesh.material.bumpScale = isEmb ? 0.045 : 0.008;
        logoMesh.material.roughness = isEmb ? 0.36 : 0.64;
        logoMesh.material.metalness = isEmb ? 0.16 : 0.03;
        logoMesh.material.map.needsUpdate = true;
        logoMesh.material.bumpMap.needsUpdate = true;
        logoMesh.material.needsUpdate = true;
    }
}

function createDefaultEmbroideryBadge() {
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = 320;
    tempCanvas.height = 320;
    const tCtx = tempCanvas.getContext('2d');

    tCtx.strokeStyle = '#C8A46E';
    tCtx.lineWidth = 16;
    tCtx.beginPath();
    tCtx.arc(160, 160, 108, 0, Math.PI * 2);
    tCtx.stroke();

    tCtx.strokeStyle = '#C8A46E';
    tCtx.lineWidth = 5;
    tCtx.beginPath();
    tCtx.arc(160, 160, 92, 0, Math.PI * 2);
    tCtx.stroke();

    tCtx.fillStyle = '#C8A46E';
    tCtx.font = 'bold 112px Georgia';
    tCtx.textAlign = 'center';
    tCtx.textBaseline = 'middle';
    tCtx.fillText('AH', 160, 165);

    uploadedSourceImage = tempCanvas;
    renderLogoEffect(tempCanvas);
}

function setTechniqueMode(tech) {
    orderState.technique = tech;
    orderState.techniqueName = tech === 'embroidery'
        ? 'Bordado 3D de Alta Precisión'
        : 'Estampado Serigráfico / DTF HD';

    document.querySelectorAll('.tech-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.technique === tech);
    });

    const pill = document.getElementById('viewport-tech-pill');
    const densityTitle = document.getElementById('density-label-title');
    const densityOutput = document.getElementById('val-density');

    if (tech === 'embroidery') {
        pill.innerHTML = 'TÉCNICA ACTIVA: <strong>BORDADO 3D</strong>';
        densityTitle.textContent = 'Densidad de Hilo (Relieve IA)';
        const labels = { 2: 'Ultra Fina', 3: 'Alta', 4: 'Media', 5: 'Gruesa', 6: 'Rústica' };
        densityOutput.textContent = labels[orderState.stitchDensity] || 'Alta';
    } else {
        pill.innerHTML = 'TÉCNICA ACTIVA: <strong>ESTAMPADO HD (DTF / SERIGRAFÍA)</strong>';
        densityTitle.textContent = 'Acabado de Tinta Textil';
        const printLabels = { 2: 'DTF Ultra HD', 3: 'Serigrafía Satinada', 4: 'Plastisol Mate', 5: 'Tacto Cero', 6: 'Vintage Halftone' };
        densityOutput.textContent = printLabels[orderState.stitchDensity] || 'Serigrafía Satinada';
    }

    if (uploadedSourceImage) {
        renderLogoEffect(uploadedSourceImage);
    }
}

function updatePresetButtonsForGarment(type) {
    const presetRow = document.getElementById('preset-row');
    if (type === 'cap' || type === 'beanie') {
        presetRow.innerHTML = `
            <button type="button" class="btn-preset active" data-pos="front-center">Frente Central</button>
            <button type="button" class="btn-preset" data-pos="side-left">Lateral Izq.</button>
            <button type="button" class="btn-preset" data-pos="side-right">Lateral Der.</button>
        `;
    } else {
        presetRow.innerHTML = `
            <button type="button" class="btn-preset active" data-pos="left-chest">Pecho Izq.</button>
            <button type="button" class="btn-preset" data-pos="center">Centro</button>
            <button type="button" class="btn-preset" data-pos="right-chest">Pecho Der.</button>
        `;
    }
    bindPresetButtons();
}

function bindPresetButtons() {
    document.querySelectorAll('.btn-preset').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.btn-preset').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            const pos = btn.dataset.pos;
            const isBeanie = orderState.garmentType === 'beanie';
            const isPolo = orderState.garmentType === 'polo';
            const isTshirt = orderState.garmentType === 'tshirt';
            const isLongShirt = orderState.garmentType === 'long-shirt';

            if (pos === 'left-chest') {
                if (isLongShirt) {
                    orderState.logoX = 0.18;
                    orderState.logoY = 0.28;
                    orderState.logoScale = 0.23;
                } else {
                    orderState.logoX = isPolo ? 0.22 : (isTshirt ? 0.25 : 0.27);
                    orderState.logoY = isPolo ? 0.42 : (isTshirt ? 0.48 : 0.51);
                    orderState.logoScale = 0.26;
                }
            } else if (pos === 'center') {
                if (isLongShirt) {
                    orderState.logoX = 0.00;
                    orderState.logoY = 0.24;
                    orderState.logoScale = 0.26;
                } else {
                    orderState.logoX = 0.0;
                    orderState.logoY = isPolo ? 0.28 : 0.41;
                    orderState.logoScale = isPolo ? 0.38 : 0.44;
                }
            } else if (pos === 'right-chest') {
                if (isLongShirt) {
                    orderState.logoX = -0.18;
                    orderState.logoY = 0.28;
                    orderState.logoScale = 0.23;
                } else {
                    orderState.logoX = isPolo ? -0.22 : (isTshirt ? -0.25 : -0.27);
                    orderState.logoY = isPolo ? 0.42 : (isTshirt ? 0.48 : 0.51);
                    orderState.logoScale = isPolo ? 0.26 : 0.34;
                }
            } else if (pos === 'front-center') {
                orderState.logoX = 0.0;
                orderState.logoY = isBeanie ? -0.17 : -0.08;
                orderState.logoScale = isBeanie ? 0.28 : 0.37;
            } else if (pos === 'side-left') {
                orderState.logoX = 0.22;
                orderState.logoY = isBeanie ? -0.17 : 0.04;
                orderState.logoScale = 0.22;
            } else if (pos === 'side-right') {
                orderState.logoX = -0.22;
                orderState.logoY = isBeanie ? -0.17 : 0.04;
                orderState.logoScale = 0.22;
            }

            syncSlidersWithState();
            scheduleLogoTransformUpdate();
            updateDynamicPricing();
        });
    });
}

function syncSlidersWithState() {
    document.getElementById('logo-x').value = orderState.logoX;
    document.getElementById('logo-y').value = orderState.logoY;
    document.getElementById('logo-scale').value = orderState.logoScale;
    document.getElementById('val-x').textContent = orderState.logoX.toFixed(2);
    document.getElementById('val-y').textContent = orderState.logoY.toFixed(2);
    const cm = Math.round(orderState.logoScale * 35);
    document.getElementById('val-scale').textContent = `${cm} cm`;
}

function updateDynamicPricing() {
    const scaleSurcharge = orderState.logoScale > 0.35
        ? Math.round((orderState.logoScale - 0.35) * 320)
        : 0;
    const techAdjustment = orderState.technique === 'embroidery' ? 0 : -30;
    orderState.price = Math.max(350, orderState.basePrice + scaleSurcharge + techAdjustment);

    const priceEl = document.getElementById('live-total-price');
    if (priceEl) {
        priceEl.textContent = `$${orderState.price.toLocaleString()} MXN`;
    }
}

function initUIEvents() {
    document.querySelectorAll('.garment-card').forEach(c => {
        c.classList.toggle('active', c.dataset.model === orderState.garmentType);
    });
    const initSpec = GARMENT_CATALOG[orderState.garmentType];
    document.getElementById('current-garment-label').textContent = `PRENDA: ${initSpec.name.toUpperCase()}`;
    document.getElementById('current-weave-label').textContent = `TEXTURA: ${initSpec.weaveLabel}`;
    updatePresetButtonsForGarment(orderState.garmentType);
    syncSlidersWithState();
    setTechniqueMode(orderState.technique);

    document.querySelectorAll('.cat-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.cat-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            const filter = tab.dataset.filter;
            document.querySelectorAll('.garment-card').forEach(card => {
                if (filter === 'all' || card.dataset.category === filter) {
                    card.classList.remove('hidden');
                } else {
                    card.classList.add('hidden');
                }
            });
        });
    });

    document.querySelectorAll('.garment-card').forEach(card => {
        // Prefetch al pasar el cursor sobre la tarjeta para que al hacer clic ya esté en caché
        card.addEventListener('pointerenter', () => {
            const hoverModelKey = card.dataset.model;
            if (hoverModelKey && GLTF_GARMENT_CONFIG[hoverModelKey] && !garmentModelCache.has(hoverModelKey)) {
                loadOrGetGarmentNode(hoverModelKey).catch(() => {});
            }
        }, { passive: true });

        card.addEventListener('click', () => {
            document.querySelectorAll('.garment-card').forEach(c => c.classList.remove('active'));
            card.classList.add('active');

            const modelKey = card.dataset.model;
            const spec = GARMENT_CATALOG[modelKey];
            orderState.garmentType = modelKey;
            orderState.garmentName = spec.name;
            orderState.basePrice = spec.basePrice;
            orderState.logoX = spec.defaultPos.x;
            orderState.logoY = spec.defaultPos.y;
            orderState.logoScale = spec.defaultPos.scale;

            // Al cambiar a un modelo GLTF con texturas propias, mostrar su textura original 3D por defecto
            if (GLTF_GARMENT_CONFIG[modelKey]) {
                orderState.useOriginalTextureColor = true;
                orderState.fabricColorName = 'Textura Original 3D';
                document.querySelectorAll('.swatch').forEach(s => {
                    s.classList.toggle('active', s.dataset.color === 'original');
                });
                const colorLabel = document.getElementById('fabric-color-name');
                if (colorLabel) colorLabel.textContent = 'Textura Original 3D';
            }

            document.getElementById('current-garment-label').textContent = `PRENDA: ${spec.name.toUpperCase()}`;
            document.getElementById('current-weave-label').textContent = `TEXTURA: ${spec.weaveLabel}`;

            updatePresetButtonsForGarment(modelKey);
            syncSlidersWithState();
            targetRotationY = 0;
            buildGarmentModel(modelKey);
            updateDynamicPricing();
        });
    });

    document.querySelectorAll('.tech-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            setTechniqueMode(btn.dataset.technique);
        });
    });

    document.querySelectorAll('.swatch').forEach(swatch => {
        swatch.addEventListener('click', () => {
            document.querySelectorAll('.swatch').forEach(s => s.classList.remove('active'));
            swatch.classList.add('active');

            const chosenColor = swatch.dataset.color;
            if (chosenColor === 'original') {
                orderState.useOriginalTextureColor = true;
                orderState.fabricColor = '#1c1c1e';
                orderState.fabricColorName = swatch.dataset.name || 'Textura Original 3D';
            } else {
                orderState.useOriginalTextureColor = false;
                orderState.fabricColor = chosenColor;
                orderState.fabricColorName = swatch.dataset.name;
            }
            document.getElementById('fabric-color-name').textContent = swatch.dataset.name;

            updateAllGarmentColors(chosenColor);
        });
    });

    document.getElementById('reset-camera-btn').addEventListener('click', () => {
        targetRotationY = 0;
        targetRotationX = 0.06;
        targetCameraZ = getResponsiveCameraZ(orderState.garmentType);
    });

    document.getElementById('toggle-wireframe-btn').addEventListener('click', (e) => {
        isWireframe = !isWireframe;
        e.currentTarget.classList.toggle('active', isWireframe);
        fabricMaterial.wireframe = isWireframe;
        secondaryMaterial.wireframe = isWireframe;
        if (activeGarmentNode) {
            activeGarmentNode.traverse((child) => {
                if (!child.isMesh || !child.material) return;
                const mats = Array.isArray(child.material) ? child.material : [child.material];
                mats.forEach(m => {
                    if (m) m.wireframe = isWireframe;
                });
            });
        }
    });

    document.getElementById('remove-bg-toggle').addEventListener('change', (e) => {
        orderState.removeWhiteBg = e.target.checked;
        if (uploadedSourceImage) {
            renderLogoEffect(uploadedSourceImage);
        }
    });

    const fileInput = document.getElementById('logo-upload');
    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const aiStatus = document.getElementById('ai-status');
        aiStatus.classList.remove('hidden');

        const reader = new FileReader();
        reader.onload = (event) => {
            const img = new Image();
            img.onload = () => {
                // Escalar a máx 512px antes de analizar y guardar en localStorage
                const optimizedCanvas = downsampleImageToCanvas(img, 512);
                uploadedSourceImage = optimizedCanvas;
                orderState.rawLogoDataUrl = optimizedCanvas.toDataURL
                    ? optimizedCanvas.toDataURL('image/png')
                    : event.target.result;

                requestAnimationFrame(() => {
                    analyzeLogoWithAI(optimizedCanvas, false);
                    renderLogoEffect(optimizedCanvas);
                    aiStatus.classList.add('hidden');
                    targetRotationY = 0;
                });
            };
            img.src = event.target.result;
        };
        reader.readAsDataURL(file);
    });

    document.getElementById('logo-x').addEventListener('input', (e) => {
        orderState.logoX = parseFloat(e.target.value);
        document.getElementById('val-x').textContent = orderState.logoX.toFixed(2);
        scheduleLogoTransformUpdate();
    });

    document.getElementById('logo-y').addEventListener('input', (e) => {
        orderState.logoY = parseFloat(e.target.value);
        document.getElementById('val-y').textContent = orderState.logoY.toFixed(2);
        scheduleLogoTransformUpdate();
    });

    document.getElementById('logo-scale').addEventListener('input', (e) => {
        orderState.logoScale = parseFloat(e.target.value);
        const cm = Math.round(orderState.logoScale * 35);
        document.getElementById('val-scale').textContent = `${cm} cm`;
        scheduleLogoTransformUpdate();
        updateDynamicPricing();
    });

    document.getElementById('stitch-density').addEventListener('input', (e) => {
        orderState.stitchDensity = parseInt(e.target.value, 10);
        setTechniqueMode(orderState.technique);
    });

    function getCartItems() {
        try {
            const raw = localStorage.getItem('cartItems');
            const parsed = raw ? JSON.parse(raw) : [];
            return Array.isArray(parsed) ? parsed : [];
        } catch (_) {
            return [];
        }
    }

    function updateNavbarCartBadge() {
        const cta = document.getElementById('nav-cart-cta');
        if (!cta) return;
        const items = getCartItems();
        const totalQty = items.reduce((acc, item) => acc + (parseInt(item.quantity, 10) || 1), 0);
        cta.textContent = `Mi Carrito (${totalQty}) →`;
    }

    function addCurrentOrderToCart() {
        ensureEmbroideryDataUrl();
        const items = getCartItems();
        const newItem = {
            id: `ITEM-${Date.now().toString(36)}-${Math.floor(Math.random() * 900 + 100)}`,
            garmentType: orderState.garmentType,
            garmentName: orderState.garmentName,
            technique: orderState.technique,
            techniqueName: orderState.techniqueName,
            unitPrice: orderState.price,
            price: orderState.price,
            quantity: 1,
            fabricColor: orderState.fabricColor,
            fabricColorName: orderState.fabricColorName,
            logoX: orderState.logoX,
            logoY: orderState.logoY,
            logoScale: orderState.logoScale,
            stitchDensity: orderState.stitchDensity,
            stitchCount: orderState.stitchCount,
            printAreaCm2: orderState.printAreaCm2,
            embroideryDataUrl: orderState.embroideryDataUrl
        };

        items.push(newItem);
        localStorage.setItem('cartItems', JSON.stringify(items));
        localStorage.setItem('atelier_custom_order', JSON.stringify(orderState));
        updateNavbarCartBadge();
        return items.length;
    }

    updateNavbarCartBadge();

    let addedCurrentItem = false;
    const addToCartBtn = document.getElementById('add-to-cart-btn');
    const toastEl = document.getElementById('cart-feedback-toast');

    if (addToCartBtn) {
        addToCartBtn.addEventListener('click', () => {
            const count = addCurrentOrderToCart();
            addedCurrentItem = true;
            if (toastEl) {
                toastEl.textContent = `✓ ${orderState.garmentName} agregado (${count} artículo${count > 1 ? 's' : ''} en tu carrito).`;
                toastEl.classList.remove('hidden');
                setTimeout(() => toastEl.classList.add('hidden'), 3200);
            }
        });
    }

    document.getElementById('continue-order-btn').addEventListener('click', () => {
        ensureEmbroideryDataUrl();
        const currentCart = getCartItems();
        if (!addedCurrentItem || currentCart.length === 0) {
            addCurrentOrderToCart();
        } else {
            localStorage.setItem('atelier_custom_order', JSON.stringify(orderState));
        }
        window.location.href = '../login/login.html';
    });
}

// Cargar prendas extra creadas desde el Panel Admin con modelo 3D asignado
async function loadAdmin3DProducts() {
    try {
        const res = await fetch('/api/products');
        if (!res.ok) return;
        const products = await res.json();
        const custom3D = products.filter(p => p.model3d && p.model3d !== 'none' && GARMENT_CATALOG[p.model3d]);
        if (!custom3D.length) return;

        const list = document.getElementById('garment-list');
        if (!list) return;

        let indexCount = list.querySelectorAll('.garment-card').length;

        custom3D.forEach(p => {
            indexCount++;
            const base = GARMENT_CATALOG[p.model3d];
            const btn = document.createElement('button');
            btn.className = 'garment-card';
            btn.dataset.model = p.model3d;
            btn.dataset.category = base.category;
            btn.dataset.customId = p.id;
            btn.innerHTML = `
                <span class="garment-index">${String(indexCount).padStart(2, '0')}</span>
                <div class="garment-info">
                    <strong>${p.name}</strong>
                    <small>${p.description || base.weaveLabel}</small>
                </div>
                <span class="garment-price">$${Number(p.price).toLocaleString()}</span>
            `;

            btn.addEventListener('click', () => {
                const baseCard = list.querySelector(`.garment-card[data-model="${p.model3d}"]:not([data-custom-id])`);
                if (baseCard) baseCard.click();

                list.querySelectorAll('.garment-card').forEach(c => c.classList.remove('active'));
                btn.classList.add('active');

                orderState.garmentName = p.name;
                orderState.basePrice = Number(p.price);
                orderState.price = Number(p.price);

                if (typeof updateDynamicPricing === 'function') updateDynamicPricing();
            });

            list.appendChild(btn);
        });

        const allTab = document.querySelector('.cat-tab[data-filter="all"]');
        if (allTab) allTab.textContent = `Todos (${indexCount})`;
    } catch (err) {
        console.warn('No se pudieron cargar productos 3D del admin:', err);
    }
}

window.addEventListener('DOMContentLoaded', loadAdmin3DProducts);
