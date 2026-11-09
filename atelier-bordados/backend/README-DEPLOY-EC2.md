# ATELIER HILO / ÉXODO BORDADOS — Guía de Ejecución Local y Despliegue en AWS EC2

## 1. Ejecución en Desarrollo Local (VS Code)

1. Abre una terminal en `atelier-bordados/backend/`:
   ```bash
   cd atelier-bordados/backend
   npm install
   cp .env.example .env
   npm start
   ```
2. Abre en tu navegador:
   - **Home**: `http://localhost:3000/home/index.html`
   - **Estudio 3D**: `http://localhost:3000/Models/models.html`
   - **Checkout / Login**: `http://localhost:3000/login/login.html`
   - **Healthcheck**: `http://localhost:3000/api/health`
   - **Auditoría de Órdenes JSON**: `http://localhost:3000/api/orders`

---

## 2. Despliegue en AWS EC2 (Ubuntu 24.04 LTS + PM2 + Nginx)

### Paso A: Instalar Node.js 20 LTS, Nginx y PM2 en tu instancia EC2
```bash
sudo apt update && sudo apt upgrade -y
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs nginx git
sudo npm install -g pm2
```

### Paso B: Configurar e iniciar el Backend con PM2
```bash
cd /var/www/atelier-bordados/backend
npm install --production
cp .env.example .env
nano .env   # Coloca tu GOOGLE_CLIENT_ID real
pm2 start server.js --name "atelier-backend"
pm2 save
pm2 startup
```

### Paso C: Configurar Nginx como Reverse Proxy (`/etc/nginx/sites-available/atelier-bordados`)
> **Importante**: Incluye `client_max_body_size 15M;` en Nginx para permitir el envío del `embroideryDataUrl` en Base64 sin bloqueo `413 Request Entity Too Large`.

```nginx
server {
    listen 80;
    server_name tudominio.com www.tudominio.com;

    # Permitir subida de texturas Base64 de bordado/estampado
    client_max_body_size 15M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Activar sitio y reiniciar Nginx:
```bash
sudo ln -s /etc/nginx/sites-available/atelier-bordados /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```
