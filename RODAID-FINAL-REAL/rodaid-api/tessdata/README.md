# RODAID API

**REST API · Node.js + Express + TypeScript · Ley Provincial N° 9556 Mendoza**

---

## Stack

| Capa | Tecnología |
|---|---|
| Runtime | Node.js 20 LTS |
| Framework | Express 4.x + TypeScript 5 |
| Base de datos | PostgreSQL 15 + Prisma ORM |
| Colas | Bull + Redis |
| Auth | JWT (access 15m + refresh 7d) + MxM OAuth 2.0 |
| Blockchain | BFA (Blockchain Federal Argentina) via ethers.js |
| Hash | SHA-256 nativo (crypto module) |
| Logging | Pino |
| Validación | Zod |

---

## Setup local

```bash
# 1. Clonar e instalar dependencias
git clone https://github.com/rodaid/rodaid-api
cd rodaid-api
npm install

# 2. Configurar variables de entorno
cp .env.example .env
# Editar .env con tus valores

# 3. Iniciar PostgreSQL y Redis (Docker)
docker compose up -d

# 4. Ejecutar migraciones
npm run db:migrate

# 5. Seed inicial (planes, inspector demo)
npm run db:seed

# 6. Desarrollo con hot-reload
npm run dev
```

---

## Endpoints disponibles

### Auth
```
POST /api/v1/auth/register       Registro con email + contraseña
POST /api/v1/auth/login          Login
POST /api/v1/auth/refresh        Renovar access token
GET  /api/v1/auth/mxm            Obtener URL OAuth MendozaxMi
GET  /api/v1/auth/mxm/callback   Callback OAuth MxM
```

### CIT · Certificado de Identidad Técnica
```
POST /api/v1/cit/iniciar         [Inspector] Emitir nuevo CIT
GET  /api/v1/cit/verificar/:sn   Verificar serial (público, sin auth)
GET  /api/v1/cit/mis-cits        CITs del usuario autenticado
GET  /api/v1/cit/:id             Detalle de un CIT
POST /api/v1/cit/:id/denunciar   Bloquear CIT por robo
```

### Health
```
GET  /api/v1/health              Estado del servicio
```

---

## Servicios con stub para desarrollo

| Servicio | Variable requerida | Comportamiento sin ella |
|---|---|---|
| BFA Blockchain | `BFA_RPC_URL` + `BFA_WALLET_PRIVATE_KEY` + `BFA_CONTRACT_ADDRESS` | Hash y tokenId aleatorios (stub) |
| MxM OAuth | `MXM_CLIENT_ID` + `MXM_CLIENT_SECRET` | Token stub, identidad demo |
| Ministerio Seguridad | `MINSEG_API_KEY` | Cross-reference simulado (siempre OK) |

---

## Variables críticas para producción

```
DATABASE_URL          PostgreSQL connection string
JWT_SECRET            Secreto JWT — mínimo 32 chars
BFA_WALLET_PRIVATE_KEY Clave privada de la wallet RODAID en BFA
BFA_CONTRACT_ADDRESS  Dirección del contrato RodaidCIT.sol desplegado
MXM_CLIENT_ID         Credencial OAuth MxM (solicitar a Gobierno de Mendoza)
```

---

## Roadmap de endpoints pendientes

- [ ] `POST /api/v1/marketplace` — Publicar bicicleta
- [ ] `POST /api/v1/marketplace/:id/comprar` — RODAID PAY + escrow
- [ ] `GET  /api/v1/usuario/bicicletas` — Garaje Digital
- [ ] `POST /api/v1/usuario/bicicletas` — Registrar nueva unidad
- [ ] `POST /api/v1/notificaciones/push` — FCM push
- [ ] `POST /api/v1/mxm/pago` — Tasa CIT vía MxM Pagos
- [ ] `GET  /api/v1/cit/:id/pdf` — Descargar CIT en PDF

---

*RODAID · San Martín, Mendoza, Argentina · © 2026*
