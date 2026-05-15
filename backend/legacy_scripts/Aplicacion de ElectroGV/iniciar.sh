#!/bin/bash
# Lanzador para macOS y Linux
echo "================================================"
echo "   Herramientas Google Drive - Iniciando..."
echo "================================================"
echo ""

# Verificar python3
if ! command -v python3 &>/dev/null; then
    echo "[ERROR] python3 no está instalado."
    echo "  macOS:  brew install python"
    echo "  Ubuntu: sudo apt install python3 python3-pip"
    exit 1
fi

# Instalar dependencias
echo "Verificando dependencias..."
python3 -m pip install --quiet \
    google-auth google-auth-oauthlib google-auth-httplib2 \
    google-api-python-client gspread pandas openpyxl
echo "Dependencias OK."
echo ""

# Ejecutar
python3 "$(dirname "$0")/launcher.py"
