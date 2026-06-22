# RODAID · Configuración UptimeRobot

## Monitors recomendados

### 1. API Health — monitor principal (cada 1 minuto)
```
Type:     HTTPS
URL:      https://api.rodaid.com.ar/api/v1/health
Interval: 1 minute
Keyword:  "ok":true
Alert:    Email + SMS cuando baja
```
Verifica: PostgreSQL disponible. Responde en < 300ms normalmente.

### 2. Readiness — DB + Redis (cada 2 minutos)
```
Type:     HTTPS
URL:      https://api.rodaid.com.ar/api/v1/health/ready
Interval: 2 minutes
Expected HTTP Status: 200
Keyword:  "status":"ok"
```
Verifica: DB + Redis listos para tráfico.

### 3. Liveness — proceso vivo (cada 30 segundos)
```
Type:     HTTPS
URL:      https://api.rodaid.com.ar/api/v1/health/live
Interval: 30 seconds
Expected HTTP Status: 200
```
El check más rápido — sin DB. Detecta crashes inmediatos.

### 4. Verificador público — endpoint de negocio (cada 5 minutos)
```
Type:     HTTPS
URL:      https://api.rodaid.com.ar/api/v1/cit/verificar/SN-R84MK-TMIA-MZA
Interval: 5 minutes
Keyword:  "encontrado":true
```
Verifica el flujo completo de negocio: API → DB → respuesta correcta.

### 5. Marketplace — endpoint público (cada 5 minutos)
```
Type:     HTTPS
URL:      https://api.rodaid.com.ar/api/v1/marketplace
Interval: 5 minutes
Keyword:  "pagination"
```

## SLA esperado
- Uptime target: 99.9% (< 8.7 hs de downtime/año)
- Response time: < 500ms p95 para /health
- Alert threshold: 2 fallos consecutivos antes de alertar

## Status page pública
Habilitar en UptimeRobot → Shared Status Pages → rodaid-status.uptimerobot.com
