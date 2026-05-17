import sqlite3, os, sys

print("=" * 50)
print("DIAGNÓSTICO FCM - ElectroGV")
print("=" * 50)

# 1. firebase-admin
try:
    import firebase_admin
    print(f"\n[OK] firebase-admin instalado: {firebase_admin.__version__}")
except ImportError:
    print("\n[ERROR] firebase-admin NO está instalado")
    print("  Corré: pip install firebase-admin==6.5.0")

# 2. Base de datos
db = "backend/storage/electrogv.sqlite3"
if not os.path.exists(db):
    print(f"\n[ERROR] DB no encontrada en: {os.path.abspath(db)}")
    sys.exit(1)

print(f"\n[OK] DB encontrada: {os.path.abspath(db)}")
conn = sqlite3.connect(db)

# 3. Tabla fcm_tokens
try:
    rows = conn.execute("SELECT username, substr(token,1,30)||'...', updated_at FROM fcm_tokens").fetchall()
    if rows:
        print(f"\n[OK] FCM tokens en DB: {len(rows)}")
        for r in rows:
            print(f"  - usuario={r[0]}  token={r[1]}  fecha={r[2]}")
    else:
        print("\n[WARN] Tabla fcm_tokens VACIA - el APK nunca registro el token")
        print("  => Necesitas: hacer push del codigo, rebuild del APK e instalarlo de nuevo")
except sqlite3.OperationalError as e:
    print(f"\n[ERROR] Tabla fcm_tokens no existe: {e}")
    print("  => Reinicia el backend para que cree la tabla automaticamente")

# 4. Tabla notifications (últimas)
try:
    rows2 = conn.execute(
        "SELECT id, title, module, created_at FROM notifications ORDER BY id DESC LIMIT 5"
    ).fetchall()
    print(f"\n[INFO] Últimas notificaciones en DB ({len(rows2)}):")
    for r in rows2:
        print(f"  - id={r[0]}  titulo={r[1]}  modulo={r[2]}  fecha={r[3]}")
except Exception as e:
    print(f"\n[WARN] No se pudieron leer notifications: {e}")

# 5. Archivo google-services / credenciales firebase
creds_env = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", "")
creds_file = "backend/secrets/firebase-service-account.json"
if creds_env:
    print(f"\n[OK] GOOGLE_APPLICATION_CREDENTIALS={creds_env}")
elif os.path.exists(creds_file):
    print(f"\n[OK] Credenciales Firebase en: {os.path.abspath(creds_file)}")
else:
    print("\n[ERROR] No se encontraron credenciales Firebase")
    print("  Archivo esperado: backend/secrets/firebase-service-account.json")

conn.close()
print("\n" + "=" * 50)
