#!/usr/bin/env python3
"""
RODAID · Test de integración CIT
Levanta el servidor Node.js y ejecuta todos los endpoints.
"""
import subprocess, time, urllib.request, urllib.error, json, sys, os, signal

PORT = 5100
BASE = f"http://localhost:{PORT}/api/v1"

# ── HTTP helpers ──────────────────────────────────────────

def req(method, path, body=None, token=None):
    url  = BASE + path
    data = json.dumps(body).encode() if body else None
    hdrs = {"Content-Type": "application/json"}
    if token:
        hdrs["Authorization"] = f"Bearer {token}"
    r = urllib.request.Request(url, data=data, headers=hdrs, method=method)
    try:
        with urllib.request.urlopen(r, timeout=8) as res:
            return json.loads(res.read().decode())
    except urllib.error.HTTPError as e:
        return json.loads(e.read().decode())

def ok(label, data):
    status = "✓" if data.get("ok") else "✗"
    print(f"\n{status} {label}")
    print(json.dumps(data, indent=2, ensure_ascii=False, default=str))
    return data

# ── Main test suite ───────────────────────────────────────

def run_tests():
    # 1. Health
    ok("GET /health", req("GET", "/health"))

    # 2. Login inspector
    r = ok("LOGIN inspector", req("POST", "/auth/login",
        {"email": "inspector@taller-andes.com.ar", "password": "inspector_demo_2026"}))
    IT = r["data"]["accessToken"]

    # 3. Login admin
    r = ok("LOGIN admin", req("POST", "/auth/login",
        {"email": "admin@rodaid.com.ar", "password": "rodaid_admin_2026!"}))
    AT = r["data"]["accessToken"]

    # 4. Login Federico (ciclista)
    r = ok("LOGIN ciclista (Federico)", req("POST", "/auth/login",
        {"email": "federico@rodaid.com.ar", "password": "ciclista_demo_2026"}))
    FT = r["data"]["accessToken"]

    # ── POST /cit/iniciar ─────────────────────────────────

    # 5. Iniciar CIT — bicicleta sin CIT (Cube Attention SN-CA2023-MTB)
    # Primero limpiamos CITs previos de pruebas (si los hay)
    PUNTOS_FULL = {k: True for k in [
        "serial","cuadro","horquilla","manubrio",
        "freno_delantero","freno_trasero","cables",
        "cambio_delantero","cambio_trasero","cassette","cadena",
        "bielas","pedales","rueda_delantera","rueda_trasera",
        "cubiertas","asiento","luces","accesorios","prueba_funcional"
    ]}
    PUNTOS_BAJO = {**PUNTOS_FULL, "luces": False, "accesorios": False,
                   "prueba_funcional": False, "cubiertas": False,
                   "asiento": False, "rueda_trasera": False}  # 14/20

    # Buscar una bicicleta sin CIT activo/pendiente para la prueba
    mis_cits = req("GET", "/cit/mis-cits", token=FT)
    bici_ids_con_cit = {c["bicicleta_id"] for c in mis_cits.get("data", [])}

    # Todas las bicicletas de Federico
    todas_bici = [
        ("40000000-0000-0000-0000-000000000001", "Trek Marlin 7"),
        ("40000000-0000-0000-0000-000000000002", "Specialized Rockhopper"),
        ("40000000-0000-0000-0000-000000000003", "Giant TCR Advanced"),
        ("40000000-0000-0000-0000-000000000004", "Canyon Grail CF"),
        ("40000000-0000-0000-0000-000000000005", "Cube Attention"),
    ]
    bici_libre = next((b for b in todas_bici if b[0] not in bici_ids_con_cit), None)

    if bici_libre:
        print(f"\n→ Bicicleta disponible para CIT: {bici_libre[1]} ({bici_libre[0]})")
        r_init = ok(f"POST /cit/iniciar ({bici_libre[1]} — 20/20 pts)", req("POST", "/cit/iniciar", {
            "bicicletaId": bici_libre[0],
            "puntos": PUNTOS_FULL,
            "fotosUrls": ["https://s3.rodaid.com.ar/cit/test/frente.jpg",
                          "https://s3.rodaid.com.ar/cit/test/lateral.jpg"],
            "firmaInspector": "RODAID_SIGN_CARLOS_MENDEZ_2026_PKCS7_BASE64_TEST",
            "djFirmada": True,
            "propietarioDNI": "30123456",
            "propietarioNombre": "Federico De Gea",
            "propietarioGeoLat": -33.0805,
            "propietarioGeoLng": -68.4691,
        }, IT))
        NUEVO_CIT_ID = r_init.get("data", {}).get("citId")
    else:
        print("\n→ Todas las bicicletas ya tienen CIT — usando Canyon Grail para validar/finalizar")
        NUEVO_CIT_ID = None

    # 6. Error: puntos insuficientes (14/20)
    ok("POST /cit/iniciar — ERROR puntos insuficientes (14/20)", req("POST", "/cit/iniciar", {
        "bicicletaId": "40000000-0000-0000-0000-000000000001",
        "puntos": PUNTOS_BAJO,
        "fotosUrls": ["https://s3.rodaid.com.ar/foto.jpg"],
        "firmaInspector": "SIGN",
        "djFirmada": True,
        "propietarioDNI": "30123456",
        "propietarioNombre": "Federico De Gea",
    }, IT))

    # 7. Error: bicicleta ya tiene CIT activo
    ok("POST /cit/iniciar — ERROR duplicado (Trek ya tiene CIT ACTIVO)", req("POST", "/cit/iniciar", {
        "bicicletaId": "40000000-0000-0000-0000-000000000001",
        "puntos": PUNTOS_FULL,
        "fotosUrls": ["https://s3.rodaid.com.ar/foto.jpg"],
        "firmaInspector": "SIGN_TEST",
        "djFirmada": True,
        "propietarioDNI": "30123456",
        "propietarioNombre": "Federico De Gea",
    }, IT))

    # 8. Error: sin auth (rol ciclista intentando emitir CIT)
    ok("POST /cit/iniciar — ERROR sin rol inspector", req("POST", "/cit/iniciar", {
        "bicicletaId": "40000000-0000-0000-0000-000000000005",
        "puntos": PUNTOS_FULL,
        "fotosUrls": ["https://s3.rodaid.com.ar/foto.jpg"],
        "firmaInspector": "SIGN",
        "djFirmada": True,
        "propietarioDNI": "30123456",
        "propietarioNombre": "Federico De Gea",
    }, FT))  # token de Federico — ciclista, no inspector

    # ── POST /cit/validar ─────────────────────────────────

    # 9. Validar el CIT Canyon Grail (PENDIENTE del seed)
    CANYON_CIT = "50000000-0000-0000-0000-000000000004"
    ok("POST /cit/validar/:id (Canyon Grail — cruce MinSeg)", req("POST", f"/cit/validar/{CANYON_CIT}", {}, AT))

    # 10. Validar el nuevo CIT si fue creado
    if NUEVO_CIT_ID:
        ok(f"POST /cit/validar/:id (Cube Attention — recién iniciado)", req("POST", f"/cit/validar/{NUEVO_CIT_ID}", {}, AT))

    # ── POST /cit/finalizar ───────────────────────────────

    # 11. Finalizar Canyon Grail (ya validado)
    ok("POST /cit/finalizar/:id (Canyon Grail → ACTIVO + NFT BFA)", req("POST", f"/cit/finalizar/{CANYON_CIT}", {}, AT))

    # 12. Finalizar el nuevo CIT si fue creado y validado
    if NUEVO_CIT_ID:
        ok(f"POST /cit/finalizar/:id ({bici_libre[1] if bici_libre else 'nueva'} → ACTIVO)", req("POST", f"/cit/finalizar/{NUEVO_CIT_ID}", {}, AT))

    # 13. Error: finalizar CIT ya activo
    ACTIVO_CIT = "50000000-0000-0000-0000-000000000001"
    ok("POST /cit/finalizar/:id — ERROR ya activo", req("POST", f"/cit/finalizar/{ACTIVO_CIT}", {}, AT))

    # ── GET /cit/:id ──────────────────────────────────────

    # 14. GET CIT completo (Trek Marlin 7)
    ok("GET /cit/:id (Trek Marlin 7 — completo con joins)", req("GET", f"/cit/{ACTIVO_CIT}", token=FT))

    # 15. GET mis-cits
    ok("GET /cit/mis-cits (Federico — todos sus CITs)", req("GET", "/cit/mis-cits", token=FT))

    # ── GET /cit/verificar/:serial — público ──────────────

    # 16. Verificar serial existente
    ok("GET /cit/verificar/:serial (Trek — serial válido)", req("GET", "/cit/verificar/SN-R84MK-TMIA-MZA"))

    # 17. Verificar serial que no existe
    ok("GET /cit/verificar/:serial (serial inexistente)", req("GET", "/cit/verificar/SN-FALSO-9999"))

    # ── POST /:id/denunciar ───────────────────────────────

    # 18. Denunciar el Canyon Grail recién activado (debería bloquearlo)
    ok("POST /cit/:id/denunciar (Canyon Grail → BLOQUEADO)", req("POST", f"/cit/{CANYON_CIT}/denunciar",
        {"motivo": "Bicicleta robada el 15/05/2026 frente al supermercado — denuncia policial Nro 2026-1234"}, FT))

    print("\n" + "═"*60)
    print("✓ Suite de integración CIT completada")
    print("═"*60)


if __name__ == "__main__":
    # Start Node server
    print("→ Iniciando servidor RODAID en puerto 5100...")
    env = {**os.environ, "PORT": "5100"}
    srv = subprocess.Popen(
        ["node", "dist/server.js"],
        cwd="/home/claude/rodaid-api",
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    time.sleep(4)

    try:
        run_tests()
    except Exception as e:
        print(f"\n✗ Error en tests: {e}", file=sys.stderr)
        import traceback; traceback.print_exc()
    finally:
        srv.terminate()
        srv.wait()
        print("\n→ Servidor detenido")
