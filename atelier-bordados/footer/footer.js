/**
 * ATELIER HILO / ÉXODO BORDADOS — Gestor del Footer Legal, Redes Sociales y Derechos de Autor
 *
 * INSTRUCCIONES PARA AGREGAR TUS ENLACES LEGALES DESPUÉS:
 * Solo pega la URL o ruta a tu PDF/página dentro del objeto LEGAL_LINKS_CONFIG de abajo
 * (por ejemplo: 'https://tudominio.com/aviso-de-privacidad.pdf') y se actualizará en todo el sitio.
 */

const LEGAL_LINKS_CONFIG = {
    'aviso-privacidad': '',        // <-- Pega aquí después el enlace a tu Aviso de Privacidad
    'terminos-condiciones': '',    // <-- Pega aquí después el enlace a tus Términos y Condiciones
    'politicas-devolucion': '',    // <-- Pega aquí después el enlace a tus Políticas de Devolución y Cancelación
    'avisos-legales': ''           // <-- Pega aquí después el enlace a tus Avisos Legales
};

const COMPANY_INFO = {
    address: 'Laguna Madre #105 B, H. Matamoros, Tamaulipas, México, C.P. 87350',
    mapsUrl: 'https://www.google.com/maps/search/?api=1&query=Laguna+madre+105+B+Matamoros+Mexico+87350',
    facebookUrl: 'https://facebook.com/exodobordados',
    whatsappNumber: '8687960723',
    whatsappUrl: 'https://wa.me/528687960723',
    email: 'exododisenos@gmail.com',
    emailUrl: 'mailto:exododisenos@gmail.com'
};

document.addEventListener('DOMContentLoaded', () => {
    ensureFooterStylesheetLoaded();

    // Si la página actual tiene un contenedor <div id="site-footer-mount"></div>, inyecta el footer automáticamente
    const mountPoint = document.getElementById('site-footer-mount');
    if (mountPoint) {
        mountPoint.innerHTML = buildFooterMarkup();
    }

    initLegalLinksBehavior();
});

/**
 * Verifica que footer.css esté cargado con la ruta relativa correcta sin errores en consola
 */
function ensureFooterStylesheetLoaded() {
    const existing = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
        .some(link => link.getAttribute('href') && link.getAttribute('href').includes('footer.css'));

    if (!existing) {
        const isInsideFooterDir = window.location.pathname.includes('/footer/');
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = isInsideFooterDir ? 'footer.css' : '../footer/footer.css';
        document.head.appendChild(link);
    }
}

function buildFooterMarkup() {
    return `
    <footer class="atelier-footer" id="contacto-legal">
        <!-- Franja Superior: Enlaces Rápidos a Redes Sociales -->
        <div class="footer-quick-bar">
            <span class="quick-bar-label">ATENCIÓN DIRECTA Y REDES OFICIALES:</span>
            <div class="quick-social-pills">
                <a href="${COMPANY_INFO.facebookUrl}" target="_blank" rel="noopener noreferrer" class="social-pill">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                        <path d="M22 12c0-5.52-4.48-10-10-10S2 6.48 2 12c0 4.84 3.44 8.87 8 9.8V15H8v-3h2V9.5C10 7.57 11.57 6 13.5 6H16v3h-2c-.55 0-1 .45-1 1v2h3v3h-3v6.95c5.05-.5 9-4.76 9-9.95z"/>
                    </svg>
                    <span>Facebook: /exodobordados →</span>
                </a>

                <a href="${COMPANY_INFO.whatsappUrl}" target="_blank" rel="noopener noreferrer" class="social-pill">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                        <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21 5.46 0 9.91-4.45 9.91-9.91C21.95 6.45 17.5 2 12.04 2zm5.82 14.01c-.24.68-1.41 1.3-1.95 1.38-.5.08-1.13.11-1.83-.11-.42-.13-.97-.31-1.67-.61-2.94-1.27-4.86-4.25-5.01-4.45-.15-.2-1.2-1.59-1.2-3.04 0-1.45.76-2.16 1.03-2.46.27-.3.59-.37.79-.37.2 0 .4 0 .57.01.18.01.43-.07.67.51.24.59.84 2.04.91 2.19.07.15.12.32.02.52-.1.2-.15.32-.3.5-.15.17-.31.39-.44.52-.15.15-.3.31-.13.61.17.3.76 1.25 1.63 2.02 1.12.99 2.06 1.3 2.36 1.45.3.15.47.12.64-.07.17-.2.74-.86.94-1.16.2-.3.4-.25.67-.15.27.1 1.73.81 2.02.96.3.15.49.22.57.35.07.12.07.71-.17 1.39z"/>
                    </svg>
                    <span>WhatsApp: 868 796 0723 →</span>
                </a>

                <a href="${COMPANY_INFO.emailUrl}" class="social-pill">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                        <path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4-8 5-8-5V6l8 5 8-5v2z"/>
                    </svg>
                    <span>Gmail: exododisenos@gmail.com →</span>
                </a>
            </div>
        </div>

        <!-- Cuerpo Principal del Footer -->
        <div class="footer-main-grid">

            <!-- Columna 1: Dirección y Marca -->
            <div class="footer-col brand-col">
                <div class="footer-logo">ATELIER HILO <span>× ÉXODO BORDADOS</span></div>
                <p class="footer-statement">
                    Taller especializado en sastrería personalizada, bordado industrial de alta precisión y estampado serigráfico / DTF asistido por Inteligencia Artificial.
                </p>

                <div class="address-box">
                    <span class="address-eyebrow">DIRECCIÓN DE LA EMPRESA</span>
                    <address>
                        Laguna Madre #105 B<br>
                        H. Matamoros, Tamaulipas, México<br>
                        C.P. 87350
                    </address>
                    <a href="${COMPANY_INFO.mapsUrl}" target="_blank" rel="noopener noreferrer" class="map-link">
                        Abrir en Google Maps →
                    </a>
                </div>
            </div>

            <!-- Columna 2: Enlaces Rápidos a Redes Sociales -->
            <div class="footer-col">
                <h4 class="footer-heading">Enlaces Rápidos de Contacto</h4>
                <ul class="footer-list">
                    <li>
                        <a href="${COMPANY_INFO.facebookUrl}" target="_blank" rel="noopener noreferrer">
                            <span class="link-index">01</span>
                            <div>
                                <strong>Facebook Oficial</strong>
                                <small>facebook.com/exodobordados</small>
                            </div>
                        </a>
                    </li>
                    <li>
                        <a href="${COMPANY_INFO.whatsappUrl}" target="_blank" rel="noopener noreferrer">
                            <span class="link-index">02</span>
                            <div>
                                <strong>WhatsApp Directo</strong>
                                <small>868 796 0723</small>
                            </div>
                        </a>
                    </li>
                    <li>
                        <a href="${COMPANY_INFO.emailUrl}">
                            <span class="link-index">03</span>
                            <div>
                                <strong>Correo Gmail</strong>
                                <small>exododisenos@gmail.com</small>
                            </div>
                        </a>
                    </li>
                </ul>
            </div>

            <!-- Columna 3: Accesos Directos de la Página -->
            <div class="footer-col">
                <h4 class="footer-heading">Secciones y Artículos</h4>
                <ul class="footer-nav-list">
                    <li><a href="../home/index.html">Inicio &amp; Diferenciador IA</a></li>
                    <li><a href="../home/index.html#tecnicas">Bordado 3D vs Estampado HD</a></li>
                    <li><a href="../Models/models.html">Catálogo 3D (Camisas, Playeras, Gorras, Gorros)</a></li>
                    <li><a href="../login/login.html">Confirmación de Pedido (Google OAuth)</a></li>
                </ul>
            </div>

            <!-- Columna 4: Enlaces Obligatorios por Ley -->
            <div class="footer-col legal-col">
                <h4 class="footer-heading">Avisos Legales Obligatorios</h4>
                <p class="legal-helper-note">
                    Espacios listos para vincular tus documentos legales oficiales:
                </p>
                <ul class="footer-legal-list">
                    <li>
                        <a href="#" data-legal-doc="aviso-privacidad" class="legal-placeholder-link">
                            <span>Aviso de Privacidad</span>
                            <span class="legal-tag">Espacio para enlace →</span>
                        </a>
                    </li>
                    <li>
                        <a href="#" data-legal-doc="terminos-condiciones" class="legal-placeholder-link">
                            <span>Términos y Condiciones</span>
                            <span class="legal-tag">Espacio para enlace →</span>
                        </a>
                    </li>
                    <li>
                        <a href="#" data-legal-doc="politicas-devolucion" class="legal-placeholder-link">
                            <span>Políticas de Devolución y Cancelación</span>
                            <span class="legal-tag">Espacio para enlace →</span>
                        </a>
                    </li>
                    <li>
                        <a href="#" data-legal-doc="avisos-legales" class="legal-placeholder-link">
                            <span>Avisos Legales</span>
                            <span class="legal-tag">Espacio para enlace →</span>
                        </a>
                    </li>
                </ul>
            </div>

        </div>

        <!-- Franja Inferior: Derechos de Autor de la Página y sus Artículos -->
        <div class="footer-bottom-copyright">
            <div class="copyright-main">
                <p>
                    <strong>© 2026 ÉXODO BORDADOS Y DISEÑOS. TODOS LOS DERECHOS RESERVADOS.</strong>
                </p>
                <p class="copyright-articles">
                    Todos los derechos de autor sobre el diseño de esta página web, código fuente, motor de visualización 3D, algoritmos de personalización y sobre la totalidad de sus artículos textiles (camisas, playeras, polos, hoodies, gorras y gorros bordados o estampados) son propiedad exclusiva de Éxodo Bordados (Laguna Madre #105 B, Matamoros, México, C.P. 87350). Prohibida su reproducción total o parcial.
                </p>
            </div>
            <div class="copyright-badges">
                <span>MATAMOROS, MÉXICO</span>
                <span>•</span>
                <span>COPYRIGHT © 2026</span>
            </div>
        </div>
    </footer>
    `;
}

function initLegalLinksBehavior() {
    document.querySelectorAll('.legal-placeholder-link').forEach(link => {
        const key = link.getAttribute('data-legal-doc');
        const configuredUrl = LEGAL_LINKS_CONFIG[key];

        if (configuredUrl && configuredUrl.trim() !== '') {
            link.href = configuredUrl;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            const tag = link.querySelector('.legal-tag');
            if (tag) tag.textContent = 'Ver documento →';
        } else {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                alert(
                    `Espacio reservado para el documento legal: "${link.querySelector('span').textContent}".\n\n` +
                    `Cuando tengas el enlace listo, solo pégalo en LEGAL_LINKS_CONFIG dentro de /footer/footer.js (o en el atributo href de /footer/footer.html).`
                );
            });
        }
    });
}
