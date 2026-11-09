/**
 * ATELIER HILO — Motor 3D PBR (7 Prendas & Gorros) + Procesador Dual IA (Bordado 3D vs Estampado HD)
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
        defaultPos: { x: 0.22, y: 0.20, scale: 0.26 }
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
        cameraZ: 4.0,
        cameraY: 0.10,
        logoZ: 0.340,
        defaultPos: { x: 0.0, y: 0.14, scale: 0.42 }
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
        defaultPos: { x: 0.22, y: 0.20, scale: 0.25 }
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
        defaultPos: { x: 0.0, y: 0.06, scale: 0.32 }
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

// Estado global sincronizado con localStorage
const orderState = {
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
    stitchCount: 4200,
    printAreaCm2: 85,
    removeWhiteBg: true,
    embroideryDataUrl: null,
    rawLogoDataUrl: null
};

// Variables Three.js
let scene, camera, renderer, garmentGroup, shadowPlane;
let fabricMaterial, secondaryMaterial, accentMetalMaterial, buttonMaterial, logoMesh;
let bumpCanvas, logoTexture, logoBumpTexture;
let isDragging = false;
let previousMousePosition = { x: 0, y: 0 };
let targetRotationY = 0;
let targetRotationX = 0.06;
let targetCameraZ = 4.15;
let targetCameraY = 0.12;
let isWireframe = false;
let uploadedSourceImage = null;
const weaveTextureCache = {};

document.addEventListener('DOMContentLoaded', () => {
    restoreSavedStateIfAny();
    initOffscreenBumpCanvas();
    initThreeJS();
    initUIEvents();

    if (orderState.rawLogoDataUrl) {
        const savedImg = new Image();
        savedImg.onload = () => {
            uploadedSourceImage = savedImg;
            analyzeLogoWithAI(savedImg, false);
            renderLogoEffect(savedImg);
        };
        savedImg.src = orderState.rawLogoDataUrl;
    } else {
        createDefaultEmbroideryBadge();
    }
});

/**
 * Restaura selección previa desde Home si el usuario eligió técnica o prenda allá
 */
function restoreSavedStateIfAny() {
    try {
        const savedRaw = localStorage.getItem('atelier_custom_order');
        if (!savedRaw) return;
        const saved = JSON.parse(savedRaw);

        if (saved.garmentType && GARMENT_CATALOG[saved.garmentType]) {
            orderState.garmentType = saved.garmentType;
            const info = GARMENT_CATALOG[saved.garmentType];
            orderState.garmentName = info.name;
            orderState.basePrice = info.basePrice;
            orderState.logoX = typeof saved.logoX === 'number' ? saved.logoX : info.defaultPos.x;
            orderState.logoY = typeof saved.logoY === 'number' ? saved.logoY : info.defaultPos.y;
            orderState.logoScale = typeof saved.logoScale === 'number' ? saved.logoScale : info.defaultPos.scale;
        }
        if (saved.technique === 'print' || saved.technique === 'embroidery') {
            orderState.technique = saved.technique;
            orderState.techniqueName = saved.technique === 'embroidery'
                ? 'Bordado 3D de Alta Precisión'
                : 'Estampado Serigráfico / DTF HD';
        }
        if (saved.fabricColor) {
            orderState.fabricColor = saved.fabricColor;
        }
        if (saved.fabricColorName) {
            orderState.fabricColorName = saved.fabricColorName;
        }
        if (saved.rawLogoDataUrl) {
            orderState.rawLogoDataUrl = saved.rawLogoDataUrl;
        }
    } catch (e) {
        console.warn('No se pudo restaurar estado previo:', e);
    }
}

function initOffscreenBumpCanvas() {
    bumpCanvas = document.createElement('canvas');
    bumpCanvas.width = 320;
    bumpCanvas.height = 320;
}

/**
 * 1. TEXTURAS MICRO-TEJIDO PROCEDURALES (PBR BUMP MAPS)
 * Genera mapas de relieve reales para algodón Oxford, Piqué, Felpa, Sarga y Punto Acanalado
 */
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
        // Panal hexagonal piqué para Polo
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
        // Sarga suave y grano de felpa pesada
        for (let y = 0; y < 128; y += 2) {
            for (let x = 0; x < 128; x += 2) {
                const v = 115 + ((x * 3 + y * 5) % 45);
                ctx.fillStyle = `rgb(${v},${v},${v})`;
                ctx.fillRect(x, y, 2, 2);
            }
        }
    } else if (weaveType === 'twill') {
        // Sarga diagonal 45° para Gorra
        ctx.strokeStyle = '#c8c8c8';
        ctx.lineWidth = 2;
        for (let i = -128; i < 256; i += 5) {
            ctx.beginPath();
            ctx.moveTo(i, 0);
            ctx.lineTo(i + 128, 128);
            ctx.stroke();
        }
    } else if (weaveType === 'rib') {
        // Acanalado vertical profundo para Gorro Beanie
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

/**
 * 2. CONFIGURACIÓN DEL ESCENARIO 3D (THREE.JS) CON ILUMINACIÓN DE ESTUDIO
 */
function initThreeJS() {
    const container = document.getElementById('canvas3d-wrapper');
    const width = container.clientWidth;
    const height = container.clientHeight;

    scene = new THREE.Scene();

    camera = new THREE.PerspectiveCamera(34, width / height, 0.1, 100);
    const initialSpecs = GARMENT_CATALOG[orderState.garmentType];
    targetCameraZ = initialSpecs.cameraZ;
    targetCameraY = initialSpecs.cameraY;
    camera.position.set(0, targetCameraY, targetCameraZ);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    // Iluminación de estudio de 4 puntos para resaltar costuras y relieve de bordado
    const hemiLight = new THREE.HemisphereLight(0xfffdf9, 0xd7d0c5, 0.65);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfff7eb, 0.95);
    keyLight.position.set(3.2, 4.8, 4.2);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.width = 1024;
    keyLight.shadow.mapSize.height = 1024;
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xeef2ff, 0.42);
    fillLight.position.set(-3.5, 1.8, 2.5);
    scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0xffeacc, 0.48);
    rimLight.position.set(0, 3.5, -4.0);
    scene.add(rimLight);

    // Materiales PBR con textura de tejido
    const initialBump = getWeaveBumpTexture(initialSpecs.weave);

    fabricMaterial = new THREE.MeshStandardMaterial({
        color: new THREE.Color(orderState.fabricColor),
        roughness: 0.80,
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

    garmentGroup = new THREE.Group();
    scene.add(garmentGroup);

    // Sombra de contacto suave bajo la prenda
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

    buildGarmentModel(orderState.garmentType);
    handleResponsiveViewport();

    // Interacción de rotación y zoom en el visor (Mouse + Pantalla Táctil con pointer events)
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
    });

    window.addEventListener('pointerup', () => {
        isDragging = false;
    });

    window.addEventListener('pointercancel', () => {
        isDragging = false;
    });

    container.addEventListener('wheel', (e) => {
        e.preventDefault();
        targetCameraZ = Math.max(1.85, Math.min(6.2, targetCameraZ + e.deltaY * 0.002));
    }, { passive: false });

    window.addEventListener('resize', handleResponsiveViewport);

    animate3D();
}

/**
 * Calcula la distancia óptima de cámara Z según el ancho de pantalla (Mobile-First)
 * En celulares (< 768px) aleja la cámara a 5.4 para que las mangas largas nunca salgan recortadas.
 */
function getResponsiveCameraZ(type) {
    const spec = GARMENT_CATALOG[type] || GARMENT_CATALOG['long-shirt'];
    const isHeadwear = spec.category === 'headwear';
    if (window.innerWidth < 768) {
        return isHeadwear ? 3.35 : 5.4;
    } else if (window.innerWidth <= 1024) {
        return isHeadwear ? 2.95 : 4.65;
    }
    return spec.cameraZ;
}

/**
 * Ajusta aspect ratio, tamaño del WebGLRenderer y posición Z de cámara en cambios de pantalla/orientación
 */
function handleResponsiveViewport() {
    const container = document.getElementById('canvas3d-wrapper');
    if (!container || !camera || !renderer) return;

    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || 340;

    camera.aspect = w / h;
    targetCameraZ = getResponsiveCameraZ(orderState.garmentType);
    camera.position.z = targetCameraZ;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
}

/**
 * 3. ESCULTOR ANATÓMICO DE LOS 7 MODELOS 3D REALISTAS
 */
function buildGarmentModel(type) {
    while (garmentGroup.children.length > 0) {
        garmentGroup.remove(garmentGroup.children[0]);
    }

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
        buildBaseballCap();
        shadowPlane.position.y = -0.58;
        shadowPlane.scale.set(0.75, 0.75, 1);
    } else if (type === 'beanie') {
        buildFishermanBeanie();
        shadowPlane.position.y = -0.60;
        shadowPlane.scale.set(0.72, 0.72, 1);
    } else {
        buildAnatomicalTop(type);
        shadowPlane.position.y = -1.08;
        shadowPlane.scale.set(1, 1, 1);
    }

    // Crear la malla subdividida (20x20) que se adhiere milimétricamente a la superficie 3D (Shrinkwrap)
    const embroideryCanvas = document.getElementById('embroidery-canvas');
    logoTexture = new THREE.CanvasTexture(embroideryCanvas);
    logoBumpTexture = new THREE.CanvasTexture(bumpCanvas);

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
    updateLogoTransform();
}

/**
 * Construye prendas superiores con escultura anatómica, cuellos realistas, puños y botones
 */
function buildAnatomicalTop(type) {
    const isHoodie = type === 'hoodie';
    const isTshirt = type === 'tshirt';
    const torsoW = isHoodie ? 1.28 : (isTshirt ? 1.24 : 1.18);
    const torsoH = isHoodie ? 1.56 : 1.58;
    const torsoD = isHoodie ? 0.50 : 0.46;

    const torsoGeo = new THREE.BoxGeometry(torsoW, torsoH, torsoD, 28, 28, 14);
    const pos = torsoGeo.attributes.position;

    for (let i = 0; i < pos.count; i++) {
        let x = pos.getX(i);
        let y = pos.getY(i);
        let z = pos.getZ(i);

        // Redondeo cilíndrico de los costados del torso
        const edgeFactor = Math.abs(x) / (torsoW * 0.5);
        z *= (1 - Math.pow(edgeFactor, 2.4) * 0.28);

        // Volumen pectoral y caída natural del tejido
        if (z > 0) {
            const chestCurve = Math.cos(x * 1.45) * 0.068;
            const verticalDrape = Math.sin((y + 0.8) * 1.8) * 0.025;
            z += chestCurve + verticalDrape;
        } else {
            // Curvatura suave de espalda alta
            z -= Math.cos(x * 1.4) * 0.035;
        }

        // Entalle ligero en cintura (excepto corte boxy de hoodie)
        if (!isHoodie && y < 0.2 && y > -0.6) {
            x *= 0.96 + Math.abs(y) * 0.04;
        }

        // Caída anatómica de hombros
        if (y > 0.62) {
            y -= Math.pow(Math.abs(x), 1.35) * 0.18;
        }

        pos.setXYZ(i, x, y, z);
    }
    torsoGeo.computeVertexNormals();
    const torsoMesh = new THREE.Mesh(torsoGeo, fabricMaterial);
    torsoMesh.castShadow = true;
    torsoMesh.receiveShadow = true;
    garmentGroup.add(torsoMesh);

    // Interior oscuro del cuello
    const innerNeck = new THREE.Mesh(
        new THREE.CylinderGeometry(0.21, 0.21, 0.16, 32),
        new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 })
    );
    innerNeck.position.set(0, 0.76, 0);
    garmentGroup.add(innerNeck);

    // Variantes específicas por tipo de prenda superior
    if (type === 'long-shirt' || type === 'short-shirt') {
        const isLong = type === 'long-shirt';
        buildTailoredSleeves(isLong, false);
        buildFoldedShirtCollar();

        // Tapeta central sastrera
        const placket = new THREE.Mesh(
            new THREE.BoxGeometry(0.085, 1.50, 0.025),
            secondaryMaterial
        );
        placket.position.set(0, -0.02, 0.265);
        garmentGroup.add(placket);

        // Botones nacarados a lo largo de la camisa
        for (let b = 0; b < 6; b++) {
            const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.012, 16), buttonMaterial);
            btn.rotation.x = Math.PI / 2;
            btn.position.set(0, 0.52 - b * 0.22, 0.282);
            garmentGroup.add(btn);
        }

    } else if (type === 'tshirt') {
        // Playera Crewneck Heavyweight: cuello redondo acanalado grueso + mangas relajadas
        const crewCollar = new THREE.Mesh(
            new THREE.TorusGeometry(0.235, 0.042, 18, 40),
            secondaryMaterial
        );
        crewCollar.rotation.x = Math.PI / 2 + 0.18;
        crewCollar.position.set(0, 0.76, 0.03);
        garmentGroup.add(crewCollar);

        buildTailoredSleeves(false, true);

        // Dobladillo inferior con doble pespunte
        const bottomHem = new THREE.Mesh(
            new THREE.BoxGeometry(torsoW * 0.99, 0.07, torsoD * 0.96),
            secondaryMaterial
        );
        bottomHem.position.set(0, -0.77, 0);
        garmentGroup.add(bottomHem);

    } else if (type === 'polo') {
        buildFoldedShirtCollar();
        buildTailoredSleeves(false, false, true);

        // Aletilla de 3 botones de Polo
        const poloPlacket = new THREE.Mesh(
            new THREE.BoxGeometry(0.105, 0.42, 0.03),
            secondaryMaterial
        );
        poloPlacket.position.set(0, 0.48, 0.265);
        garmentGroup.add(poloPlacket);

        for (let b = 0; b < 3; b++) {
            const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.012, 16), buttonMaterial);
            btn.rotation.x = Math.PI / 2;
            btn.position.set(0, 0.60 - b * 0.12, 0.285);
            garmentGroup.add(btn);
        }

    } else if (type === 'hoodie') {
        buildTailoredSleeves(true, true);

        // Capucha escultórica de doble panel
        const hoodOuter = new THREE.Mesh(
            new THREE.SphereGeometry(0.41, 32, 28),
            secondaryMaterial
        );
        hoodOuter.scale.set(1.12, 1.05, 0.98);
        hoodOuter.position.set(0, 0.94, -0.09);
        garmentGroup.add(hoodOuter);

        // Cuello envolvente frontal de la capucha
        const hoodCollar = new THREE.Mesh(
            new THREE.TorusGeometry(0.26, 0.065, 16, 32, Math.PI * 1.15),
            secondaryMaterial
        );
        hoodCollar.rotation.set(1.3, 0, -0.22);
        hoodCollar.position.set(0, 0.77, 0.06);
        garmentGroup.add(hoodCollar);

        // Cordones de algodón con herrajes metálicos (aglets)
        [-0.09, 0.09].forEach(xCord => {
            const cord = new THREE.Mesh(
                new THREE.CylinderGeometry(0.012, 0.012, 0.36, 12),
                secondaryMaterial
            );
            cord.position.set(xCord, 0.53, 0.285);
            garmentGroup.add(cord);

            const aglet = new THREE.Mesh(
                new THREE.CylinderGeometry(0.014, 0.012, 0.045, 12),
                accentMetalMaterial
            );
            aglet.position.set(xCord, 0.34, 0.285);
            garmentGroup.add(aglet);
        });

        // Bolsillo canguro biselado
        const pocketGeo = new THREE.BoxGeometry(0.78, 0.38, 0.055, 8, 8, 4);
        const pPos = pocketGeo.attributes.position;
        for (let i = 0; i < pPos.count; i++) {
            const py = pPos.getY(i);
            let px = pPos.getX(i);
            if (py > 0.02) px *= 0.82; // Entrada inclinada para las manos
            pPos.setX(i, px);
        }
        pocketGeo.computeVertexNormals();
        const pocket = new THREE.Mesh(pocketGeo, secondaryMaterial);
        pocket.position.set(0, -0.40, 0.268);
        garmentGroup.add(pocket);

        // Pretina acanalada inferior
        const waistRib = new THREE.Mesh(
            new THREE.BoxGeometry(torsoW * 0.97, 0.14, torsoD * 0.94),
            secondaryMaterial
        );
        waistRib.position.set(0, -0.78, 0);
        garmentGroup.add(waistRib);
    }
}

/**
 * Construye cuello camisero con banda y solapas dobladas
 */
function buildFoldedShirtCollar() {
    const band = new THREE.Mesh(
        new THREE.CylinderGeometry(0.245, 0.265, 0.16, 32, 1, true),
        secondaryMaterial
    );
    band.position.set(0, 0.80, 0);
    garmentGroup.add(band);

    // Solapas izquierda y derecha del cuello
    [-1, 1].forEach(dir => {
        const lapel = new THREE.Mesh(
            new THREE.BoxGeometry(0.19, 0.13, 0.025),
            secondaryMaterial
        );
        lapel.position.set(dir * 0.115, 0.75, 0.245);
        lapel.rotation.z = dir * -0.28;
        lapel.rotation.y = dir * 0.32;
        lapel.rotation.x = 0.18;
        garmentGroup.add(lapel);
    });
}

/**
 * Construye mangas esculpidas con puños realistas
 */
function buildTailoredSleeves(isLong, isRelaxed = false, hasPoloRib = false) {
    const sleeveLen = isLong ? 1.18 : (isRelaxed ? 0.54 : 0.46);
    const topRadius = isRelaxed ? 0.245 : 0.215;
    const bottomRadius = isLong ? 0.145 : (isRelaxed ? 0.205 : 0.18);

    [-1, 1].forEach(side => {
        const sleeveGroup = new THREE.Group();

        // Hombro redondeado para unión sin huecos
        const shoulderCap = new THREE.Mesh(
            new THREE.SphereGeometry(topRadius * 0.98, 20, 20),
            fabricMaterial
        );
        shoulderCap.position.set(0, sleeveLen * 0.46, 0);
        sleeveGroup.add(shoulderCap);

        const sleeveCyl = new THREE.Mesh(
            new THREE.CylinderGeometry(topRadius, bottomRadius, sleeveLen, 28, 12),
            fabricMaterial
        );
        sleeveCyl.castShadow = true;
        sleeveGroup.add(sleeveCyl);

        // Puño sastrero o rib acanalado
        if (isLong || hasPoloRib) {
            const cuffH = isLong ? 0.13 : 0.06;
            const cuff = new THREE.Mesh(
                new THREE.CylinderGeometry(bottomRadius * 1.03, bottomRadius * 1.01, cuffH, 28),
                secondaryMaterial
            );
            cuff.position.set(0, -sleeveLen * 0.5 + cuffH * 0.3, 0);
            sleeveGroup.add(cuff);
        }

        const posX = isLong ? side * 0.85 : side * 0.74;
        const posY = isLong ? 0.15 : 0.42;
        const angleZ = isLong ? side * 0.39 : side * 0.48;

        sleeveGroup.position.set(posX, posY, 0);
        sleeveGroup.rotation.z = angleZ;
        garmentGroup.add(sleeveGroup);
    });
}

/**
 * Construye el modelo 3D de Gorra Estructurada de 6 Paneles (Baseball / Snapback)
 */
function buildBaseballCap() {
    const capGroup = new THREE.Group();

    // Corona semiesférica de 6 paneles
    const crownGeo = new THREE.SphereGeometry(0.50, 36, 24, 0, Math.PI * 2, 0, Math.PI * 0.56);
    const cPos = crownGeo.attributes.position;
    for (let i = 0; i < cPos.count; i++) {
        let x = cPos.getX(i);
        let y = cPos.getY(i);
        let z = cPos.getZ(i);
        // Frente estructurado ligeramente más alto (perfil Pro-Crown)
        if (z > 0 && y > 0.08) {
            y += z * 0.07;
        }
        cPos.setXYZ(i, x, y, z);
    }
    crownGeo.computeVertexNormals();
    const crown = new THREE.Mesh(crownGeo, fabricMaterial);
    crown.position.y = -0.14;
    crown.castShadow = true;
    capGroup.add(crown);

    // Costuras de los 6 paneles y ojales de ventilación
    for (let p = 0; p < 6; p++) {
        const angle = (p * Math.PI) / 3;
        const seam = new THREE.Mesh(
            new THREE.TorusGeometry(0.502, 0.005, 8, 28, Math.PI * 0.52),
            secondaryMaterial
        );
        seam.position.y = -0.14;
        seam.rotation.y = angle;
        seam.rotation.z = Math.PI / 2;
        capGroup.add(seam);
    }

    // Botón superior forrado (Squatchee)
    const topButton = new THREE.Mesh(
        new THREE.CylinderGeometry(0.042, 0.042, 0.025, 20),
        secondaryMaterial
    );
    topButton.position.set(0, 0.38, 0);
    capGroup.add(topButton);

    // Banda inferior de ajuste
    const sweatBand = new THREE.Mesh(
        new THREE.TorusGeometry(0.49, 0.024, 14, 42),
        secondaryMaterial
    );
    sweatBand.rotation.x = Math.PI / 2;
    sweatBand.position.set(0, -0.14, 0);
    capGroup.add(sweatBand);

    // Visera curva anatómica con costuras concéntricas
    const visorGeo = new THREE.BoxGeometry(0.86, 0.028, 0.54, 28, 4, 16);
    const vPos = visorGeo.attributes.position;
    for (let i = 0; i < vPos.count; i++) {
        let vx = vPos.getX(i);
        let vy = vPos.getY(i);
        let vz = vPos.getZ(i);

        // Redondear la punta delantera de la visera
        const frontFactor = (vz + 0.27) / 0.54;
        vx *= (1 - Math.pow(frontFactor, 1.9) * 0.28);

        // Curvatura transversal clásica de visera
        vy -= Math.pow(vx, 2) * 0.42;
        // Inclinación frontal hacia abajo
        vy -= frontFactor * 0.09;

        vPos.setXYZ(i, vx, vy, vz);
    }
    visorGeo.computeVertexNormals();
    const visor = new THREE.Mesh(visorGeo, secondaryMaterial);
    visor.position.set(0, -0.11, 0.54);
    visor.castShadow = true;
    capGroup.add(visor);

    garmentGroup.add(capGroup);
}

/**
 * Construye el modelo 3D de Gorro Tejido Beanie (Fisherman Ribbed)
 */
function buildFishermanBeanie() {
    const beanieGroup = new THREE.Group();

    // Cúpula tejida con pliegues superiores
    const domeGeo = new THREE.SphereGeometry(0.47, 36, 28, 0, Math.PI * 2, 0, Math.PI * 0.62);
    const dPos = domeGeo.attributes.position;
    for (let i = 0; i < dPos.count; i++) {
        let x = dPos.getX(i);
        let y = dPos.getY(i);
        let z = dPos.getZ(i);

        const angle = Math.atan2(z, x);
        // Surcos verticales del tejido de punto y pinzas superiores
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
    dome.castShadow = true;
    beanieGroup.add(dome);

    // Doblez frontal grueso (Folded Cuff) donde va el bordado o parche
    const cuffGeo = new THREE.CylinderGeometry(0.495, 0.485, 0.27, 48, 12);
    const cPos = cuffGeo.attributes.position;
    for (let i = 0; i < cPos.count; i++) {
        let x = cPos.getX(i);
        let y = cPos.getY(i);
        let z = cPos.getZ(i);
        const angle = Math.atan2(z, x);
        // Textura acanalada pronunciada en el doblez
        const rib = Math.sin(angle * 32) * 0.011;
        // Suavizado de los bordes superior e inferior del doblez
        const edgeRound = Math.cos((y / 0.135) * 1.1) * 0.018;
        x += Math.cos(angle) * (rib + edgeRound);
        z += Math.sin(angle) * (rib + edgeRound);
        cPos.setXYZ(i, x, y, z);
    }
    cPos.needsUpdate = true;
    cuffGeo.computeVertexNormals();

    const cuff = new THREE.Mesh(cuffGeo, secondaryMaterial);
    cuff.position.set(0, -0.17, 0);
    cuff.castShadow = true;
    beanieGroup.add(cuff);

    garmentGroup.add(beanieGroup);
}

const surfaceRaycaster = new THREE.Raycaster();
const rayOrigin = new THREE.Vector3();
const rayDir = new THREE.Vector3(0, 0, -1);

/**
 * Proyecta cada vértice de la malla del logotipo directamente sobre la superficie 3D de la prenda (Shrinkwrap).
 * Así el bordado/estampado abraza la curvatura exacta del pecho, pliegues, gorra o beanie sin flotar ni hundirse.
 */
function updateLogoTransform() {
    if (!logoMesh || !garmentGroup) return;

    // Guardar transformación actual del grupo para lanzar rayos en espacio local canónico
    const savedPosY = garmentGroup.position.y;
    const savedRotX = garmentGroup.rotation.x;
    const savedRotY = garmentGroup.rotation.y;

    garmentGroup.position.y = 0;
    garmentGroup.rotation.set(0, 0, 0);
    garmentGroup.updateMatrixWorld(true);

    const targetMeshes = garmentGroup.children.filter(child => child !== logoMesh);

    const geo = logoMesh.geometry;
    const pos = geo.attributes.position;
    const gridSegs = 20;
    const cols = gridSegs + 1;
    const count = pos.count;

    // 1. Obtener Z de referencia en el centro del logotipo
    rayOrigin.set(orderState.logoX, orderState.logoY, 2.0);
    surfaceRaycaster.set(rayOrigin, rayDir);
    const centerHits = surfaceRaycaster.intersectObjects(targetMeshes, true);
    const fallbackZ = (orderState.garmentType === 'cap' || orderState.garmentType === 'beanie') ? 0.49 : 0.285;
    const centerZ = centerHits.length > 0 ? centerHits[0].point.z : fallbackZ;

    const rawZ = new Float32Array(count);
    const worldXArr = new Float32Array(count);
    const worldYArr = new Float32Array(count);

    // 2. Proyectar cada vértice de la cuadrícula 21x21 sobre la capa frontal de la prenda
    for (let i = 0; i < count; i++) {
        const ix = i % cols;
        const iy = Math.floor(i / cols);
        const u = (ix / gridSegs) - 0.5;
        const v = 0.5 - (iy / gridSegs);

        const wx = orderState.logoX + u * orderState.logoScale;
        const wy = orderState.logoY + v * orderState.logoScale;
        worldXArr[i] = wx;
        worldYArr[i] = wy;

        rayOrigin.set(wx, wy, 2.0);
        surfaceRaycaster.set(rayOrigin, rayDir);
        const hits = surfaceRaycaster.intersectObjects(targetMeshes, true);

        if (hits.length > 0 && hits[0].point.z > centerZ - 0.14) {
            rawZ[i] = hits[0].point.z;
        } else {
            // Extrapolación suave si el borde del logo se acerca a la silueta
            const distSq = (u * orderState.logoScale) ** 2 + (v * orderState.logoScale) ** 2;
            rawZ[i] = centerZ - distSq * 0.22;
        }
    }

    // 3. Suavizado de superficie para evitar escalones bruscos en botones/costuras sin hundirse jamás
    const surfaceOffset = orderState.technique === 'embroidery' ? 0.0032 : 0.0022;
    for (let iy = 0; iy < cols; iy++) {
        for (let ix = 0; ix < cols; ix++) {
            const idx = iy * cols + ix;
            let sum = 0;
            let n = 0;
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

    // Restaurar rotación y posición del grupo 3D
    garmentGroup.position.y = savedPosY;
    garmentGroup.rotation.x = savedRotX;
    garmentGroup.rotation.y = savedRotY;
    garmentGroup.updateMatrixWorld(true);
}

/**
 * Bucle de renderizado con interpolación suave de cámara y rotación
 */
function animate3D() {
    requestAnimationFrame(animate3D);

    const time = performance.now() * 0.0014;
    garmentGroup.position.y = Math.sin(time) * 0.025;

    garmentGroup.rotation.y += (targetRotationY - garmentGroup.rotation.y) * 0.09;
    garmentGroup.rotation.x += (targetRotationX - garmentGroup.rotation.x) * 0.09;

    camera.position.z += (targetCameraZ - camera.position.z) * 0.08;
    camera.position.y += (targetCameraY - camera.position.y) * 0.08;

    renderer.render(scene, camera);
}

/**
 * 4. ANALIZADOR IA Y MOTOR DUAL: BORDADO 3D vs ESTAMPADO HD
 */
function analyzeLogoWithAI(imgElement, autoSwitchIfRecommended = false) {
    const sampleCanvas = document.createElement('canvas');
    sampleCanvas.width = 96;
    sampleCanvas.height = 96;
    const sCtx = sampleCanvas.getContext('2d');
    sCtx.drawImage(imgElement, 0, 0, 96, 96);
    const data = sCtx.getImageData(0, 0, 96, 96).data;

    const colorBuckets = new Set();
    let activePixels = 0;

    for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
        const isWhiteBg = orderState.removeWhiteBg && r > 240 && g > 240 && b > 240;
        if (a > 40 && !isWhiteBg) {
            activePixels++;
            // Cuantizar colores para medir complejidad cromática/degradados
            const key = `${Math.floor(r / 32)}-${Math.floor(g / 32)}-${Math.floor(b / 32)}`;
            colorBuckets.add(key);
        }
    }

    const distinctTones = colorBuckets.size;
    const diagText = document.getElementById('ai-recommendation-text');
    const confBadge = document.getElementById('ai-confidence');

    if (distinctTones > 26) {
        confBadge.textContent = `${distinctTones} tonos detectados`;
        diagText.innerHTML = `Diseño policromático / con degradados detectado. La IA recomienda <strong>Estampado HD (DTF / Serigrafía)</strong> para fidelidad fotográfica o <strong>Bordado 3D</strong> para texturizado artístico.`;
        if (autoSwitchIfRecommended) {
            setTechniqueMode('print');
        }
    } else {
        confBadge.textContent = `Vectorial / Sólido`;
        diagText.innerHTML = `Logotipo de trazos definidos (${Math.max(1, Math.min(12, Math.round(distinctTones / 2)))} hilos base). Ideal tanto para <strong>Bordado 3D con relieve</strong> como para <strong>Estampado Serigráfico</strong>.`;
    }
}

/**
 * Procesa la imagen según la técnica activa:
 * - 'embroidery': Genera puntadas Tatami/Satín con relieve real + BumpMap 3D de alta profundidad.
 * - 'print': Genera acabado de tinta serigráfica / DTF sobre la trama textil sin costuras de hilo.
 */
function renderLogoEffect(imgElement) {
    if (!imgElement) return;

    const canvas = document.getElementById('embroidery-canvas');
    const ctx = canvas.getContext('2d');
    const bCtx = bumpCanvas.getContext('2d');
    const size = canvas.width; // 320x320

    ctx.clearRect(0, 0, size, size);
    bCtx.fillStyle = '#000000';
    bCtx.fillRect(0, 0, size, size);

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = size;
    tempCanvas.height = size;
    const tempCtx = tempCanvas.getContext('2d');

    const scale = Math.min((size - 32) / imgElement.width, (size - 32) / imgElement.height);
    const drawW = imgElement.width * scale;
    const drawH = imgElement.height * scale;
    const offsetX = (size - drawW) / 2;
    const offsetY = (size - drawH) / 2;

    tempCtx.drawImage(imgElement, offsetX, offsetY, drawW, drawH);
    const srcImgData = tempCtx.getImageData(0, 0, size, size);
    const imgData = srcImgData.data;

    // Limpieza inteligente de fondo blanco si está activa
    if (orderState.removeWhiteBg) {
        for (let i = 0; i < imgData.length; i += 4) {
            const r = imgData[i], g = imgData[i + 1], b = imgData[i + 2];
            if (r > 242 && g > 242 && b > 242) {
                imgData[i + 3] = 0;
            } else if (r > 225 && g > 225 && b > 225) {
                // Suavizado antialiasing en bordes claros
                imgData[i + 3] = Math.round(imgData[i + 3] * 0.35);
            }
        }
        tempCtx.putImageData(srcImgData, 0, 0);
    }

    if (orderState.technique === 'embroidery') {
        // MODO 1: BORDADO 3D DE ALTA PRECISIÓN
        const step = parseInt(orderState.stitchDensity, 10);
        let stitches = 0;

        ctx.shadowColor = 'rgba(0, 0, 0, 0.48)';
        ctx.shadowBlur = 2.2;
        ctx.shadowOffsetX = 1.2;
        ctx.shadowOffsetY = 1.2;

        for (let y = 0; y < size; y += step) {
            for (let x = 0; x < size; x += step) {
                const idx = (y * size + x) * 4;
                const r = imgData[idx];
                const g = imgData[idx + 1];
                const b = imgData[idx + 2];
                const a = imgData[idx + 3];

                if (a > 45) {
                    stitches++;
                    // Brillo anisotrópico de hilo rayon
                    const threadWave = Math.sin((x * 0.35) + (y * 0.25));
                    const shine = threadWave > 0 ? 22 : -14;
                    const tr = Math.min(255, Math.max(0, r + shine));
                    const tg = Math.min(255, Math.max(0, g + shine));
                    const tb = Math.min(255, Math.max(0, b + shine));

                    ctx.strokeStyle = `rgb(${tr}, ${tg}, ${tb})`;
                    ctx.lineWidth = step * 0.82;
                    ctx.lineCap = 'round';

                    const jitter = Math.sin(x * 0.6 + y * 0.4) * 0.85;
                    ctx.beginPath();
                    ctx.moveTo(x - step * 0.48, y - step * 0.36 + jitter);
                    ctx.lineTo(x + step * 0.48, y + step * 0.36 - jitter);
                    ctx.stroke();

                    // Dibujar la puntada en el BumpMap para relieve 3D real en Three.js
                    const bumpVal = threadWave > 0 ? 245 : 175;
                    bCtx.strokeStyle = `rgb(${bumpVal},${bumpVal},${bumpVal})`;
                    bCtx.lineWidth = step * 0.85;
                    bCtx.lineCap = 'round';
                    bCtx.beginPath();
                    bCtx.moveTo(x - step * 0.48, y - step * 0.36 + jitter);
                    bCtx.lineTo(x + step * 0.48, y + step * 0.36 - jitter);
                    bCtx.stroke();
                }
            }
        }

        orderState.stitchCount = Math.max(1200, stitches * 3);
        document.getElementById('preview-mode-title').textContent = 'MATRIZ DE PUNTADAS IA';
        document.getElementById('stitch-count').textContent = `~${orderState.stitchCount.toLocaleString()} puntadas`;

    } else {
        // MODO 2: ESTAMPADO HD (SERIGRAFÍA / DTF TEXTIL)
        ctx.shadowColor = 'rgba(0, 0, 0, 0.12)';
        ctx.shadowBlur = 1;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;

        // Dibujar imagen nítida con saturación de tinta serigráfica
        ctx.drawImage(tempCanvas, 0, 0);

        // Aplicar micro-trama textil sobre la tinta según el acabado seleccionado en el slider
        const printFinish = parseInt(orderState.stitchDensity, 10); // 2..6
        const printData = ctx.getImageData(0, 0, size, size);
        const pPixels = printData.data;
        let inkPixels = 0;

        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const idx = (y * size + x) * 4;
                const a = pPixels[idx + 3];
                if (a > 35) {
                    inkPixels++;
                    // Micro-poro de tela o semitono serigráfico si el usuario elige acabado Vintage (5-6)
                    if (printFinish >= 5 && ((x + y) % 3 === 0)) {
                        pPixels[idx + 3] = Math.round(a * 0.78);
                    } else {
                        // Realce de contraste de tinta DTF/Plastisol
                        pPixels[idx] = Math.min(255, Math.round(pPixels[idx] * 1.04));
                        pPixels[idx + 1] = Math.min(255, Math.round(pPixels[idx + 1] * 1.04));
                        pPixels[idx + 2] = Math.min(255, Math.round(pPixels[idx + 2] * 1.04));
                    }
                }
            }
        }
        ctx.putImageData(printData, 0, 0);

        // En modo Estampado, el BumpMap es uniforme y muy sutil (capa fina de tinta sobre tela)
        bCtx.drawImage(tempCanvas, 0, 0);

        const cmSide = Math.round(orderState.logoScale * 35);
        orderState.printAreaCm2 = Math.round((inkPixels / (size * size)) * (cmSide * cmSide) * 1.4) + 18;
        document.getElementById('preview-mode-title').textContent = 'MATRIZ SERIGRÁFICA / DTF IA';
        document.getElementById('stitch-count').textContent = `300 DPI • ~${orderState.printAreaCm2} cm²`;
    }

    orderState.embroideryDataUrl = canvas.toDataURL('image/png');
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

/**
 * Crea el monograma por defecto al iniciar el estudio
 */
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

    const defaultImg = new Image();
    defaultImg.onload = () => {
        uploadedSourceImage = defaultImg;
        renderLogoEffect(defaultImg);
    };
    defaultImg.src = tempCanvas.toDataURL();
}

/**
 * Cambia entre modo Bordado 3D y modo Estampado HD actualizando la UI y el material 3D
 */
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

/**
 * Actualiza los botones de posición rápida según si es prenda superior o gorra/gorro
 */
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

            if (pos === 'left-chest') {
                orderState.logoX = 0.22;
                orderState.logoY = 0.20;
                orderState.logoScale = 0.26;
            } else if (pos === 'center') {
                orderState.logoX = 0.0;
                orderState.logoY = 0.14;
                orderState.logoScale = 0.44;
            } else if (pos === 'right-chest') {
                orderState.logoX = -0.22;
                orderState.logoY = 0.20;
                orderState.logoScale = 0.26;
            } else if (pos === 'front-center') {
                orderState.logoX = 0.0;
                orderState.logoY = isBeanie ? -0.17 : 0.06;
                orderState.logoScale = isBeanie ? 0.28 : 0.32;
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
            updateLogoTransform();
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
    document.getElementById('val-scale').textContent = `${Math.round(orderState.logoScale * 35)} cm`;
}

/**
 * Calcula el precio dinámico según prenda base, tamaño del diseño y técnica
 */
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

/**
 * 5. EVENTOS DE INTERFAZ Y SINCRONIZACIÓN
 */
function initUIEvents() {
    // Sincronizar UI inicial con estado restaurado
    document.querySelectorAll('.garment-card').forEach(c => {
        c.classList.toggle('active', c.dataset.model === orderState.garmentType);
    });
    const initSpec = GARMENT_CATALOG[orderState.garmentType];
    document.getElementById('current-garment-label').textContent = `PRENDA: ${initSpec.name.toUpperCase()}`;
    document.getElementById('current-weave-label').textContent = `TEXTURA: ${initSpec.weaveLabel}`;
    updatePresetButtonsForGarment(orderState.garmentType);
    syncSlidersWithState();
    setTechniqueMode(orderState.technique);

    // Filtro por pestañas de categoría (Todos / Tops / Gorras y Gorros)
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

    // Selección entre los 7 modelos 3D
    document.querySelectorAll('.garment-card').forEach(card => {
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

            document.getElementById('current-garment-label').textContent = `PRENDA: ${spec.name.toUpperCase()}`;
            document.getElementById('current-weave-label').textContent = `TEXTURA: ${spec.weaveLabel}`;

            updatePresetButtonsForGarment(modelKey);
            syncSlidersWithState();
            targetRotationY += Math.PI * 2;
            buildGarmentModel(modelKey);
            updateDynamicPricing();
        });
    });

    // Selección de técnica: Bordado 3D vs Estampado HD
    document.querySelectorAll('.tech-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            setTechniqueMode(btn.dataset.technique);
        });
    });

    // Cambio de color textil
    document.querySelectorAll('.swatch').forEach(swatch => {
        if (swatch.dataset.color.toLowerCase() === orderState.fabricColor.toLowerCase()) {
            document.querySelectorAll('.swatch').forEach(s => s.classList.remove('active'));
            swatch.classList.add('active');
            document.getElementById('fabric-color-name').textContent = swatch.dataset.name;
        }
        swatch.addEventListener('click', () => {
            document.querySelectorAll('.swatch').forEach(s => s.classList.remove('active'));
            swatch.classList.add('active');

            orderState.fabricColor = swatch.dataset.color;
            orderState.fabricColorName = swatch.dataset.name;
            document.getElementById('fabric-color-name').textContent = swatch.dataset.name;

            fabricMaterial.color.set(orderState.fabricColor);
            secondaryMaterial.color.set(orderState.fabricColor).offsetHSL(0, 0, 0.025);
        });
    });

    // Botones del visor 3D (Centrar Cámara y Malla 3D)
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
    });

    // Toggle de remoción inteligente de fondo blanco
    document.getElementById('remove-bg-toggle').addEventListener('change', (e) => {
        orderState.removeWhiteBg = e.target.checked;
        if (uploadedSourceImage) {
            renderLogoEffect(uploadedSourceImage);
        }
    });

    // Subida de logotipo y procesamiento IA
    const fileInput = document.getElementById('logo-upload');
    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const aiStatus = document.getElementById('ai-status');
        aiStatus.classList.remove('hidden');

        const reader = new FileReader();
        reader.onload = (event) => {
            orderState.rawLogoDataUrl = event.target.result;
            const img = new Image();
            img.onload = () => {
                uploadedSourceImage = img;
                setTimeout(() => {
                    analyzeLogoWithAI(img, false);
                    renderLogoEffect(img);
                    aiStatus.classList.add('hidden');
                    targetRotationY = 0;
                }, 550);
            };
            img.src = event.target.result;
        };
        reader.readAsDataURL(file);
    });

    // Sliders de posición, tamaño y densidad/acabado
    document.getElementById('logo-x').addEventListener('input', (e) => {
        orderState.logoX = parseFloat(e.target.value);
        document.getElementById('val-x').textContent = orderState.logoX.toFixed(2);
        updateLogoTransform();
    });

    document.getElementById('logo-y').addEventListener('input', (e) => {
        orderState.logoY = parseFloat(e.target.value);
        document.getElementById('val-y').textContent = orderState.logoY.toFixed(2);
        updateLogoTransform();
    });

    document.getElementById('logo-scale').addEventListener('input', (e) => {
        orderState.logoScale = parseFloat(e.target.value);
        const cm = Math.round(orderState.logoScale * 35);
        document.getElementById('val-scale').textContent = `${cm} cm`;
        updateLogoTransform();
        updateDynamicPricing();
    });

    document.getElementById('stitch-density').addEventListener('input', (e) => {
        orderState.stitchDensity = parseInt(e.target.value, 10);
        setTechniqueMode(orderState.technique);
    });

    // Continuar con el pedido -> Login
    document.getElementById('continue-order-btn').addEventListener('click', () => {
        localStorage.setItem('atelier_custom_order', JSON.stringify(orderState));
        window.location.href = '../login/login.html';
    });
}
