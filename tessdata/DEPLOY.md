# RODAID API · Guía de Deploy

---

## Opción A — Railway (recomendado para MVP)

**Costo**: ~$20/mes (API + PostgreSQL + Redis)  
**Setup**: 10 minutos

### 1. Instalar Railway CLI

```bash
npm install -g @railway/cli
railway login
```

### 2. Crear proyecto en Railway

```bash
railway init           # crear proyecto
railway add            # agregar PostgreSQL y Redis plugins
```

### 3. Variables de entorno en Railway Dashboard

```
JWT_SECRET             # mínimo 32 chars — generar con: openssl rand -hex 32
ALLOWED_ORIGINS        # https://rodaid.com.ar
BFA_RPC_URL            # https://public.nodo1.afip.gob.ar
BFA_WALLET_PRIVATE_KEY # clave privada wallet RODAID en BFA
BFA_CONTRACT_ADDRESS   # dirección RodaidCIT.sol desplegado
MXM_CLIENT_ID          # solicitar a Gobierno de Mendoza
MXM_CLIENT_SECRET      # solicitar a Gobierno de Mendoza
```

### 4. Deploy inicial

```bash
railway up
```

### 5. Aplicar schema de base de datos

```bash
railway run psql $DATABASE_URL -f prisma/001_init.sql
railway run psql $DATABASE_URL -f prisma/002_seed.sql
```

### 6. CI/CD automático

Agregar el secret `RAILWAY_TOKEN` al repositorio de GitHub.  
Cada push a `main` desplegará automáticamente vía `.github/workflows/deploy-railway.yml`.

---

## Opción B — Render (alternativa con Blueprint)

**Costo**: ~$21/mes (API $7 + PostgreSQL $7 + Redis $7)  
**Setup**: 5 minutos con Blueprint

### 1. Deploy con un click

Hacer click en **New Blueprint** en Render Dashboard y subir `render.yaml`.  
Render crea automáticamente: PostgreSQL + Redis + API.

### 2. Variables secretas (solo estas requieren valor manual)

```
JWT_SECRET             # openssl rand -hex 32
BFA_WALLET_PRIVATE_KEY
MXM_CLIENT_ID
MXM_CLIENT_SECRET
```

### 3. Aplicar schema

```bash
# Obtener la URL de conexión de Render Dashboard
psql $DATABASE_URL -f prisma/001_init.sql
psql $DATABASE_URL -f prisma/002_seed.sql
```

### 4. Deploy Hook

Copiar la URL del Deploy Hook desde Render Dashboard y agregarla como  
`RENDER_DEPLOY_HOOK_URL` en los secrets de GitHub.

---

## Opción C — VPS / EC2 con Docker Compose

**Costo**: ~$10/mes (Hetzner CX21 / DigitalOcean Droplet 2GB)  
**Control total**: SSL propio, backups, monitoreo

### 1. Preparar servidor

```bash
# Ubuntu 22.04 LTS
curl -fsSL https://get.docker.com | sh
apt install -y nginx certbot python3-certbot-nginx

# Clonar repo
git clone https://github.com/tu-org/rodaid-api /opt/rodaid
cd /opt/rodaid
```

### 2. Configurar variables de entorno

```bash
cp .env.example .env
# Editar .env con los valores reales
nano .env
```

Variables mínimas requeridas:
```
POSTGRES_PASSWORD=<contraseña segura>
JWT_SECRET=<openssl rand -hex 32>
ALLOWED_ORIGINS=https://api.rodaid.com.ar
```

### 3. Obtener certificado SSL

```bash
certbot certonly --standalone -d api.rodaid.com.ar
```

### 4. Levantar servicios

```bash
docker compose -f docker-compose.prod.yml up -d
```

### 5. Aplicar schema

```bash
docker compose exec postgres psql -U rodaid_user -d rodaid_db -f /app/prisma/001_init.sql
docker compose exec postgres psql -U rodaid_user -d rodaid_db -f /app/prisma/002_seed.sql
```

### 6. CI/CD con GitHub Actions

El workflow `.github/workflows/deploy-aws.yml` puede adaptarse para VPS usando SSH:

```yaml
- name: Deploy via SSH
  uses: appleboy/ssh-action@v1
  with:
    host: ${{ secrets.VPS_HOST }}
    username: ${{ secrets.VPS_USER }}
    key: ${{ secrets.VPS_SSH_KEY }}
    script: |
      cd /opt/rodaid
      git pull origin main
      docker compose -f docker-compose.prod.yml pull
      docker compose -f docker-compose.prod.yml up -d --no-deps api
```

---

## Opción D — AWS ECS Fargate

**Costo**: ~$60/mes (Fargate + RDS + ElastiCache + ALB)  
**Escalabilidad**: auto-scaling, multi-AZ, zero-downtime deploys

### 1. Prerequisitos

```bash
brew install terraform awscli
aws configure    # configurar credenciales
```

### 2. Aplicar infraestructura

```bash
cd infra/aws
terraform init
terraform plan -var="api_image=placeholder" -var="db_password=PASS" -var="jwt_secret=SECRET"
terraform apply
```

### 3. Build y push imagen inicial

```bash
# Obtener ECR URL del output de terraform
ECR_URL=$(terraform output -raw ecr_repository_url)
aws ecr get-login-password | docker login --username AWS --password-stdin $ECR_URL
docker build -t $ECR_URL:latest .
docker push $ECR_URL:latest
```

### 4. Aplicar schema en RDS

```bash
DB_URL=$(terraform output -raw db_endpoint)
psql "postgresql://rodaid_user:$DB_PASSWORD@$DB_URL:5432/rodaid_db" -f prisma/001_init.sql
psql "postgresql://rodaid_user:$DB_PASSWORD@$DB_URL:5432/rodaid_db" -f prisma/002_seed.sql
```

### 5. CI/CD

Agregar en GitHub:
- `AWS_ROLE_ARN` → ARN del rol `rodaid-prod-github-actions` (output de terraform)

El workflow `.github/workflows/deploy-aws.yml` usa OIDC — sin claves estáticas en secrets.

---

## Secrets de GitHub requeridos por plataforma

| Secret | Railway | Render | VPS | AWS |
|--------|---------|--------|-----|-----|
| `RAILWAY_TOKEN` | ✓ | — | — | — |
| `RAILWAY_API_URL` | ✓ | — | — | — |
| `RENDER_DEPLOY_HOOK_URL` | — | ✓ | — | — |
| `RENDER_API_URL` | — | ✓ | — | — |
| `VPS_HOST` + `VPS_USER` + `VPS_SSH_KEY` | — | — | ✓ | — |
| `AWS_ROLE_ARN` | — | — | — | ✓ |
| `AWS_ALB_URL` | — | — | — | ✓ |

---

## Checklist pre-producción

- [ ] `JWT_SECRET` con al menos 32 caracteres aleatorios
- [ ] PostgreSQL con SSL habilitado
- [ ] Redis con password en producción
- [ ] BFA wallet con fondos para gas (estimado: 0.1 ETH)
- [ ] Contrato `RodaidCIT.sol` desplegado y auditado
- [ ] Credenciales MxM OAuth solicitadas al Gobierno de Mendoza
- [ ] Convenio técnico Ministerio de Seguridad Mendoza firmado
- [ ] Dominio `api.rodaid.com.ar` apuntando al servidor
- [ ] SSL/TLS configurado (Let's Encrypt o ACM)
- [ ] Backups automáticos de PostgreSQL configurados
- [ ] Alertas de monitoreo (UptimeRobot / CloudWatch)
- [ ] RODAID SAS constituida (Guillermo De Gea, San Martín)
- [ ] Registro INPI — marca + software
