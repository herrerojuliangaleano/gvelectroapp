# 🛠 Herramientas Google Drive — Guía de uso

## ¿Qué es esto?

Una aplicación de escritorio que permite ejecutar las herramientas de Google Drive
**sin usar la terminal**. Solo hacés clic, completás los campos y listo.

---

## Estructura de carpetas

```
Herramientas Google Drive/
├── launcher.py          ← Aplicación principal (no tocar)
├── Iniciar.bat          ← Doble clic para abrir en Windows
├── iniciar.sh           ← Para macOS / Linux
├── README.md            ← Esta guía
└── scripts/             ← Carpeta con todos los scripts
    ├── Comprobar Facturas/
    │   ├── cf.py
    │   ├── credentials.json  ← Necesario
    │   └── token.json        ← Se genera solo
    ├── Congelar carpeta/
    ├── Generar GFK/
    ├── Generar Planillas Diarias/
    ├── Limpiar Comprobantes Emitidos y Recibidos/
    ├── Limpiar Extractos Bancarios/
    ├── Normalizar Carpeta Mensual/
    ├── Normalizar Ventas VS Costos/
    └── Ventas VS Costos/
```

---

## Requisitos

- **Python 3.10 o superior**
  - Windows: https://www.python.org/downloads/ (tildar "Add Python to PATH")
  - macOS: `brew install python`

- **Conexión a internet** (para autenticar con Google y acceder a Drive/Sheets)

- **credentials.json** en la raíz de la carpeta (ya incluido — solo uno para todas las herramientas)
  (ya están incluidos — si cambian, reemplazarlos)

---

## Cómo abrir la aplicación

### Windows
1. Hacé doble clic en **`Iniciar.bat`**
2. Si aparece un aviso de seguridad de Windows, elegí "Más información" → "Ejecutar de todas formas"

### macOS / Linux
1. Abrí una terminal en esta carpeta
2. Ejecutá: `bash iniciar.sh`

---

## Primera vez con Google

La primera vez que ejecutés una herramienta, **se va a abrir el navegador** para
pedir permiso de acceso a Google Drive y Sheets. Esto es normal y solo pasa una vez
por herramienta. Después queda guardado en `token.json`.

---

## Herramientas disponibles

| Icono | Nombre | Qué hace |
|-------|--------|----------|
| 📋 | **Generar Planillas Diarias** | Copia las plantillas diarias para cada sucursal |
| 🧊 | **Congelar Carpeta** | Reemplaza fórmulas por valores fijos |
| 🧾 | **Comprobar Facturas** | Cruza comprobantes ARCA contra planillas de ventas |
| 🗂️ | **Limpiar Comprobantes** | Procesa CSVs de ARCA y los sube a Drive |
| 🏦 | **Limpiar Extractos Bancarios** | Normaliza extractos Galicia/Supervielle |
| 📊 | **Generar GFK** | Genera el reporte GFK del período |
| 📁 | **Normalizar Carpeta Mensual** | Normaliza productos contra catálogo PVP |
| 📁+ | **Normalizar Carpeta Mensual (Con Cantidades)** | Igual pero con cantidades |
| 📈 | **Normalizar Ventas VS Costos** | Cruza ventas contra planilla madre |
| 💰 | **Ventas VS Costos** | Sincroniza libro diario al libro mensual |

---

## Cómo usar cada herramienta

1. **Hacé clic** en la tarjeta de la herramienta
2. **Completá los campos** que aparecen (links de Drive, fechas, etc.)
3. **Hacé clic en "▶ Ejecutar"**
4. Seguí el progreso en la **consola de salida** (parte inferior)
5. Cuando aparezca ✅ Proceso finalizado, terminó

### Tips para los links de Drive
- Podés pegar el link completo de la URL del navegador
- Ejemplo: `https://docs.google.com/spreadsheets/d/ID_AQUI/edit`
- O solo el ID del archivo/carpeta

---

## Problemas comunes

**"credentials.json no encontrado"**
→ Verificá que el archivo `credentials.json` esté en la subcarpeta del script correspondiente

**"Token expirado" o error de autenticación**
→ Borrá el archivo `token.json` de la carpeta del script y volvé a ejecutar. Se va a pedir login de nuevo.

**La aplicación no abre / Python no encontrado**
→ Instalá Python desde python.org con la opción "Add to PATH" activada

---

*Versión 1.0 — Para soporte interno*
