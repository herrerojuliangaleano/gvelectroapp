"""
Lanzador Gráfico - Herramientas Google Drive
Interfaz para ejecutar los scripts sin usar la terminal.
"""

import sys
import os
import threading
import subprocess
import tkinter as tk
from tkinter import ttk, messagebox, filedialog, scrolledtext
from pathlib import Path
import queue
import datetime

# ─── Ruta base donde están las carpetas de scripts ───────────────────────────
BASE_DIR = Path(__file__).resolve().parent.parent / "scripts"

# ─── Definición de herramientas ──────────────────────────────────────────────
TOOLS = [
    {
        "id": "gpd",
        "nombre": "Generar Planillas Diarias",
        "descripcion": "Genera copias de las planillas diarias para cada sucursal en Google Drive.",
        "icono": "📋",
        "color": "#3B82F6",
        "script": BASE_DIR / "Generar Planillas Diarias" / "gpd.py",
        "inputs": [],  # no pide inputs manuales
        "modo": "auto",
    },
    {
        "id": "cc",
        "nombre": "Congelar Carpeta",
        "descripcion": "Reemplaza fórmulas por valores fijos en todos los Google Sheets de una carpeta.",
        "icono": "🧊",
        "color": "#06B6D4",
        "script": BASE_DIR / "Congelar carpeta" / "cc.py",
        "inputs": [
            {"key": "carpeta_url",   "label": "Link o ID de la carpeta de Drive", "tipo": "texto", "placeholder": "https://drive.google.com/drive/folders/..."},
            {"key": "subcarpetas",   "label": "¿Procesar subcarpetas?",           "tipo": "bool",  "default": False},
            {"key": "hojas_ocultas", "label": "¿Incluir hojas ocultas?",          "tipo": "bool",  "default": False},
            {"key": "modo_prueba",   "label": "¿Modo prueba (sin congelar)?",      "tipo": "bool",  "default": True},
        ],
        "modo": "stdin",
        "stdin_map": ["carpeta_url", "subcarpetas", "hojas_ocultas", "modo_prueba"],
    },
    {
        "id": "cf",
        "nombre": "Comprobar Facturas",
        "descripcion": "Cruza los comprobantes de ARCA contra las planillas de ventas y colorea coincidencias.",
        "icono": "🧾",
        "color": "#10B981",
        "script": BASE_DIR / "Comprobar Facturas" / "cf.py",
        "inputs": [
            {"key": "fecha",       "label": "Fecha a procesar (DD/MM/AAAA)", "tipo": "fecha",  "placeholder": datetime.date.today().strftime("%d/%m/%Y")},
            {"key": "planilla_url","label": "URL de la planilla de ventas",   "tipo": "texto",  "placeholder": "https://docs.google.com/spreadsheets/d/..."},
        ],
        "modo": "stdin",
        "stdin_map": ["fecha", "planilla_url"],
    },
    {
        "id": "cer",
        "nombre": "Limpiar Comprobantes",
        "descripcion": "Procesa los CSV de comprobantes emitidos y recibidos de ARCA y los sube a Drive.",
        "icono": "🗂️",
        "color": "#8B5CF6",
        "script": BASE_DIR / "Limpiar Comprobantes Emitidos y Recibidos" / "cer.py",
        "inputs": [],  # usa la carpeta del script
        "modo": "auto",
    },
    {
        "id": "eb",
        "nombre": "Limpiar Extractos Bancarios",
        "descripcion": "Normaliza extractos de Galicia y Supervielle y los sube a Google Sheets.",
        "icono": "🏦",
        "color": "#F59E0B",
        "script": BASE_DIR / "Limpiar Extractos Bancarios" / "eb.py",
        "inputs": [],  # usa filedialog nativo
        "modo": "auto",
    },
    {
        "id": "gg",
        "nombre": "Generar GFK",
        "descripcion": "Genera el reporte GFK a partir de las planillas de ventas del período.",
        "icono": "📊",
        "color": "#EF4444",
        "script": BASE_DIR / "Generar GFK" / "gg.py",
        "inputs": [],  # usa simpledialog nativo
        "modo": "auto",
    },
    {
        "id": "ncm",
        "nombre": "Normalizar Carpeta Mensual",
        "descripcion": "Normaliza los productos de las planillas diarias contra el catálogo Productos PVP.",
        "icono": "📁",
        "color": "#EC4899",
        "script": BASE_DIR / "Normalizar Carpeta Mensual" / "ncm.py",
        "inputs": [
            {"key": "origen_url",   "label": "Carpeta ORIGEN (planillas diarias)",  "tipo": "texto", "placeholder": "https://drive.google.com/drive/folders/..."},
            {"key": "master_url",   "label": "Archivo Productos PVP",               "tipo": "texto", "placeholder": "https://docs.google.com/spreadsheets/d/..."},
            {"key": "destino_url",  "label": "Carpeta DESTINO para el resultado",    "tipo": "texto", "placeholder": "https://drive.google.com/drive/folders/..."},
            {"key": "titulo",       "label": "Nombre del archivo de salida (opcional)", "tipo": "texto", "placeholder": "Dejar vacío para nombre automático"},
        ],
        "modo": "stdin",
        "stdin_map": ["origen_url", "master_url", "destino_url", "titulo"],
    },
    {
        "id": "ncmc",
        "nombre": "Normalizar Carpeta Mensual (Con Cantidades)",
        "descripcion": "Igual que Normalizar Carpeta Mensual pero incluye columna de cantidades.",
        "icono": "📁+",
        "color": "#F97316",
        "script": BASE_DIR / "Normalizar Carpeta Mensual" / "ncmc.py",
        "inputs": [
            {"key": "origen_url",   "label": "Carpeta ORIGEN (planillas diarias)",  "tipo": "texto", "placeholder": "https://drive.google.com/drive/folders/..."},
            {"key": "master_url",   "label": "Archivo Productos PVP",               "tipo": "texto", "placeholder": "https://docs.google.com/spreadsheets/d/..."},
            {"key": "destino_url",  "label": "Carpeta DESTINO para el resultado",    "tipo": "texto", "placeholder": "https://drive.google.com/drive/folders/..."},
            {"key": "titulo",       "label": "Nombre del archivo de salida (opcional)", "tipo": "texto", "placeholder": "Dejar vacío para nombre automático"},
        ],
        "modo": "stdin",
        "stdin_map": ["origen_url", "master_url", "destino_url", "titulo"],
    },
    {
        "id": "nvsc",
        "nombre": "Normalizar Ventas VS Costos",
        "descripcion": "Normaliza y cruza archivos de ventas contra la planilla madre de productos.",
        "icono": "📈",
        "color": "#14B8A6",
        "script": BASE_DIR / "Normalizar Ventas VS Costos" / "nvsc.py",
        "inputs": [
            {"key": "cantidad",     "label": "Cantidad de archivos de ventas (Enter = 4)", "tipo": "numero", "placeholder": "4"},
            {"key": "ventas_urls",  "label": "Links de archivos de ventas (uno por línea)", "tipo": "multilinea", "placeholder": "https://docs.google.com/...\nhttps://docs.google.com/..."},
            {"key": "master_url",   "label": "Link de la planilla madre (Productos PVP)",  "tipo": "texto", "placeholder": "https://docs.google.com/spreadsheets/d/..."},
            {"key": "destino_url",  "label": "Link de la carpeta DESTINO",                 "tipo": "texto", "placeholder": "https://drive.google.com/drive/folders/..."},
            {"key": "titulo",       "label": "Nombre del archivo de salida (opcional)",    "tipo": "texto", "placeholder": "Dejar vacío para nombre automático"},
        ],
        "modo": "stdin_nvsc",
        "stdin_map": ["cantidad", "ventas_urls", "master_url", "destino_url", "titulo"],
    },
    {
        "id": "vsc",
        "nombre": "Ventas VS Costos",
        "descripcion": "Sincroniza datos de ventas del libro diario hacia el libro mensual.",
        "icono": "💰",
        "color": "#84CC16",
        "script": BASE_DIR / "Ventas VS Costos" / "vsc.py",
        "inputs": [
            {"key": "mensual_url", "label": "URL del libro MENSUAL",    "tipo": "texto", "placeholder": "https://docs.google.com/spreadsheets/d/..."},
            {"key": "diario_url",  "label": "URL del libro DIARIO/CENTRAL", "tipo": "texto", "placeholder": "https://docs.google.com/spreadsheets/d/..."},
        ],
        "modo": "stdin",
        "stdin_map": ["mensual_url", "diario_url"],
    },
]


# ─── Paleta de colores ────────────────────────────────────────────────────────
BG = "#0F172A"
BG2 = "#1E293B"
BG3 = "#334155"
TEXT = "#F1F5F9"
TEXT2 = "#94A3B8"
ACCENT = "#3B82F6"
SUCCESS = "#10B981"
ERROR = "#EF4444"
WARN = "#F59E0B"
BORDER = "#475569"


class ToolCard(tk.Frame):
    """Tarjeta clicable para cada herramienta."""

    def __init__(self, parent, tool: dict, on_click, **kwargs):
        super().__init__(parent, bg=BG2, cursor="hand2", **kwargs)
        self.tool = tool
        self.on_click = on_click
        self._build()
        self.bind("<Enter>", self._hover_on)
        self.bind("<Leave>", self._hover_off)
        self.bind("<Button-1>", self._click)
        for child in self.winfo_children():
            child.bind("<Button-1>", self._click)
            child.bind("<Enter>", self._hover_on)
            child.bind("<Leave>", self._hover_off)

    def _build(self):
        color = self.tool["color"]

        # Barra de color lateral
        bar = tk.Frame(self, bg=color, width=4)
        bar.pack(side="left", fill="y")
        bar.bind("<Button-1>", self._click)

        # Contenido
        inner = tk.Frame(self, bg=BG2)
        inner.pack(side="left", fill="both", expand=True, padx=12, pady=10)

        row1 = tk.Frame(inner, bg=BG2)
        row1.pack(fill="x")

        icono_lbl = tk.Label(row1, text=self.tool["icono"], font=("Segoe UI Emoji", 18),
                             bg=BG2, fg=TEXT)
        icono_lbl.pack(side="left")

        nombre_lbl = tk.Label(row1, text=self.tool["nombre"],
                              font=("Segoe UI", 11, "bold"),
                              bg=BG2, fg=TEXT, anchor="w")
        nombre_lbl.pack(side="left", padx=(8, 0))

        desc_lbl = tk.Label(inner, text=self.tool["descripcion"],
                            font=("Segoe UI", 9), bg=BG2, fg=TEXT2,
                            wraplength=420, justify="left", anchor="w")
        desc_lbl.pack(fill="x", pady=(4, 0))

    def _hover_on(self, _=None):
        self.config(bg="#253348")
        for w in self.winfo_children():
            if isinstance(w, tk.Frame):
                w.config(bg="#253348")
                for ww in w.winfo_children():
                    if isinstance(ww, tk.Label):
                        ww.config(bg="#253348")
                    elif isinstance(ww, tk.Frame):
                        ww.config(bg="#253348")
                        for www in ww.winfo_children():
                            if isinstance(www, tk.Label):
                                www.config(bg="#253348")

    def _hover_off(self, _=None):
        self.config(bg=BG2)
        for w in self.winfo_children():
            if isinstance(w, tk.Frame):
                w.config(bg=BG2)
                for ww in w.winfo_children():
                    if isinstance(ww, tk.Label):
                        ww.config(bg=BG2)
                    elif isinstance(ww, tk.Frame):
                        ww.config(bg=BG2)
                        for www in ww.winfo_children():
                            if isinstance(www, tk.Label):
                                www.config(bg=BG2)

    def _click(self, _=None):
        self.on_click(self.tool)


class RunDialog(tk.Toplevel):
    """Ventana de ejecución con inputs y consola de salida."""

    def __init__(self, parent, tool: dict):
        super().__init__(parent)
        self.tool = tool
        self.title(f"{tool['icono']} {tool['nombre']}")
        self.configure(bg=BG)
        self.resizable(True, True)
        self.geometry("700x580")
        self.grab_set()

        self.input_vars = {}
        self._process = None
        self._queue = queue.Queue()
        self._running = False

        self._build()
        self.after(100, self._poll_queue)

    def _build(self):
        # Header
        header = tk.Frame(self, bg=self.tool["color"], height=4)
        header.pack(fill="x")

        title_frame = tk.Frame(self, bg=BG, pady=12)
        title_frame.pack(fill="x", padx=16)
        tk.Label(title_frame, text=f"{self.tool['icono']}  {self.tool['nombre']}",
                 font=("Segoe UI", 13, "bold"), bg=BG, fg=TEXT).pack(anchor="w")
        tk.Label(title_frame, text=self.tool["descripcion"],
                 font=("Segoe UI", 9), bg=BG, fg=TEXT2,
                 wraplength=650, justify="left").pack(anchor="w")

        # Separator
        tk.Frame(self, bg=BORDER, height=1).pack(fill="x")

        # Inputs (si los hay)
        if self.tool["inputs"]:
            inputs_frame = tk.Frame(self, bg=BG, pady=8)
            inputs_frame.pack(fill="x", padx=16)
            tk.Label(inputs_frame, text="Parámetros", font=("Segoe UI", 10, "bold"),
                     bg=BG, fg=TEXT2).pack(anchor="w", pady=(0, 6))

            for inp in self.tool["inputs"]:
                self._build_input(inputs_frame, inp)

            tk.Frame(self, bg=BORDER, height=1).pack(fill="x")

        # Botones
        btn_frame = tk.Frame(self, bg=BG, pady=8)
        btn_frame.pack(fill="x", padx=16)

        self.run_btn = tk.Button(
            btn_frame, text="▶  Ejecutar", font=("Segoe UI", 10, "bold"),
            bg=self.tool["color"], fg="white", relief="flat",
            activebackground=self.tool["color"], activeforeground="white",
            padx=16, pady=6, cursor="hand2", command=self._run
        )
        self.run_btn.pack(side="left")

        self.stop_btn = tk.Button(
            btn_frame, text="⏹  Detener", font=("Segoe UI", 10),
            bg=BG3, fg=TEXT2, relief="flat",
            padx=12, pady=6, cursor="hand2", command=self._stop,
            state="disabled"
        )
        self.stop_btn.pack(side="left", padx=(8, 0))

        self.status_lbl = tk.Label(btn_frame, text="", font=("Segoe UI", 9),
                                   bg=BG, fg=TEXT2)
        self.status_lbl.pack(side="left", padx=(12, 0))

        # Consola
        console_label = tk.Frame(self, bg=BG)
        console_label.pack(fill="x", padx=16, pady=(4, 0))
        tk.Label(console_label, text="Salida del proceso",
                 font=("Segoe UI", 9, "bold"), bg=BG, fg=TEXT2).pack(anchor="w")

        self.console = scrolledtext.ScrolledText(
            self, font=("Consolas", 9), bg="#0A0F1A", fg="#A8C4E0",
            insertbackground=TEXT, relief="flat", padx=8, pady=8,
            state="disabled"
        )
        self.console.pack(fill="both", expand=True, padx=16, pady=(4, 16))

        # Tags de color para la consola
        self.console.tag_configure("ok",    foreground="#10B981")
        self.console.tag_configure("error", foreground="#EF4444")
        self.console.tag_configure("warn",  foreground="#F59E0B")
        self.console.tag_configure("info",  foreground="#60A5FA")
        self.console.tag_configure("normal",foreground="#A8C4E0")

    def _build_input(self, parent, inp):
        row = tk.Frame(parent, bg=BG)
        row.pack(fill="x", pady=3)

        tk.Label(row, text=inp["label"], font=("Segoe UI", 9),
                 bg=BG, fg=TEXT, width=30, anchor="w").pack(side="left")

        tipo = inp["tipo"]

        if tipo == "bool":
            var = tk.BooleanVar(value=inp.get("default", False))
            chk = tk.Checkbutton(row, variable=var, bg=BG, fg=TEXT,
                                 activebackground=BG, activeforeground=TEXT,
                                 selectcolor=BG3, relief="flat")
            chk.pack(side="left")
            self.input_vars[inp["key"]] = var

        elif tipo == "multilinea":
            var = tk.Text(row, font=("Segoe UI", 9), bg=BG3, fg=TEXT,
                          insertbackground=TEXT, relief="flat", height=3, width=40)
            var.insert("1.0", inp.get("placeholder", ""))
            var.pack(side="left", fill="x", expand=True)
            self.input_vars[inp["key"]] = var

        else:
            var = tk.StringVar(value=inp.get("placeholder", ""))
            entry = tk.Entry(row, textvariable=var, font=("Segoe UI", 9),
                             bg=BG3, fg=TEXT, insertbackground=TEXT,
                             relief="flat", width=42)
            entry.pack(side="left", fill="x", expand=True, ipady=4)
            self.input_vars[inp["key"]] = var

    def _get_input_value(self, key, tipo):
        var = self.input_vars.get(key)
        if var is None:
            return ""
        if isinstance(var, tk.BooleanVar):
            return "s" if var.get() else "n"
        if isinstance(var, tk.Text):
            return var.get("1.0", "end-1c").strip()
        return var.get().strip()

    def _build_stdin(self):
        """Construye el string de stdin según el tipo del script."""
        tool = self.tool
        modo = tool.get("modo")

        if modo == "stdin":
            lines = []
            for key in tool["stdin_map"]:
                inp_def = next((i for i in tool["inputs"] if i["key"] == key), None)
                tipo = inp_def["tipo"] if inp_def else "texto"
                val = self._get_input_value(key, tipo)
                lines.append(val)
            return "\n".join(lines) + "\n"

        elif modo == "stdin_nvsc":
            lines = []
            # cantidad
            cantidad_raw = self._get_input_value("cantidad", "numero").strip()
            if not cantidad_raw:
                cantidad_raw = ""
            lines.append(cantidad_raw)

            # ventas_urls: dividir por línea
            ventas_raw = self._get_input_value("ventas_urls", "multilinea")
            urls = [u.strip() for u in ventas_raw.splitlines() if u.strip()]
            for u in urls:
                lines.append(u)

            # master, destino, titulo
            lines.append(self._get_input_value("master_url", "texto"))
            lines.append(self._get_input_value("destino_url", "texto"))
            lines.append(self._get_input_value("titulo", "texto"))
            return "\n".join(lines) + "\n"

        return None

    def _log(self, text: str, tag="normal"):
        self.console.config(state="normal")
        self.console.insert("end", text, tag)
        self.console.see("end")
        self.console.config(state="disabled")

    def _classify_line(self, line: str) -> str:
        lo = line.lower()
        if any(w in lo for w in ["error", "excepción", "exception", "traceback", "failed"]):
            return "error"
        if any(w in lo for w in ["✅", "ok", "listo", "terminado", "correcto", "éxito"]):
            return "ok"
        if any(w in lo for w in ["aviso", "atención", "⚠", "warning"]):
            return "warn"
        if any(w in lo for w in ["autenticand", "[1/", "[2/", "[3/", "[4/", "[5/", "[6/", "[7/"]):
            return "info"
        return "normal"

    def _run(self):
        if self._running:
            return

        script = self.tool["script"]
        if not Path(script).exists():
            messagebox.showerror("Error", f"No se encontró el script:\n{script}")
            return

        stdin_data = self._build_stdin()

        self.console.config(state="normal")
        self.console.delete("1.0", "end")
        self.console.config(state="disabled")

        self._log(f"▶ Ejecutando: {script.name}\n", "info")
        if stdin_data:
            self._log(f"📥 Entradas enviadas:\n{stdin_data}\n", "info")
        self._log("─" * 60 + "\n", "normal")

        self._running = True
        self.run_btn.config(state="disabled")
        self.stop_btn.config(state="normal")
        self.status_lbl.config(text="⏳ Ejecutando...", fg=WARN)

        thread = threading.Thread(target=self._exec_thread,
                                  args=(script, stdin_data), daemon=True)
        thread.start()

    def _exec_thread(self, script, stdin_data):
        try:
            env = os.environ.copy()
            env["PYTHONUNBUFFERED"] = "1"
            env["PYTHONIOENCODING"] = "utf-8"

            proc = subprocess.Popen(
                [sys.executable, "-u", str(script)],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                cwd=str(script.parent),
                env=env,
                encoding="utf-8",
                errors="replace",
            )
            self._process = proc

            if stdin_data:
                try:
                    proc.stdin.write(stdin_data)
                    proc.stdin.flush()
                    proc.stdin.close()
                except Exception:
                    pass

            for line in iter(proc.stdout.readline, ""):
                self._queue.put(("line", line))

            proc.wait()
            self._queue.put(("done", proc.returncode))

        except Exception as exc:
            self._queue.put(("exc", str(exc)))

    def _stop(self):
        if self._process and self._running:
            try:
                self._process.terminate()
            except Exception:
                pass
            self._log("\n⏹ Proceso detenido por el usuario.\n", "warn")
            self._finish(None)

    def _poll_queue(self):
        try:
            while True:
                msg_type, payload = self._queue.get_nowait()
                if msg_type == "line":
                    tag = self._classify_line(payload)
                    self._log(payload, tag)
                elif msg_type == "done":
                    code = payload
                    self._log("\n" + "─" * 60 + "\n", "normal")
                    if code == 0:
                        self._log("✅ Proceso finalizado correctamente.\n", "ok")
                    else:
                        self._log(f"❌ Proceso terminó con código {code}.\n", "error")
                    self._finish(code)
                elif msg_type == "exc":
                    self._log(f"\n❌ Error al ejecutar: {payload}\n", "error")
                    self._finish(1)
        except queue.Empty:
            pass
        self.after(80, self._poll_queue)

    def _finish(self, code):
        self._running = False
        self._process = None
        self.run_btn.config(state="normal")
        self.stop_btn.config(state="disabled")
        if code == 0:
            self.status_lbl.config(text="✅ Completado", fg=SUCCESS)
        elif code is None:
            self.status_lbl.config(text="⏹ Detenido", fg=WARN)
        else:
            self.status_lbl.config(text="❌ Error", fg=ERROR)


class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Herramientas Google Drive")
        self.configure(bg=BG)
        self.geometry("560x780")
        self.resizable(True, True)
        self._build()

    def _build(self):
        # Header
        header = tk.Frame(self, bg="#1E3A5F", pady=18)
        header.pack(fill="x")

        tk.Label(header, text="🛠  Herramientas Google Drive",
                 font=("Segoe UI", 16, "bold"), bg="#1E3A5F", fg=TEXT).pack()
        tk.Label(header, text="Seleccioná una herramienta para ejecutarla",
                 font=("Segoe UI", 9), bg="#1E3A5F", fg=TEXT2).pack(pady=(2, 0))

        # Subtítulo / info de credenciales
        info_frame = tk.Frame(self, bg="#172033", pady=8)
        info_frame.pack(fill="x", padx=0)
        tk.Label(info_frame,
                 text="ℹ  Cada herramienta usa su propio credentials.json y token.json",
                 font=("Segoe UI", 8), bg="#172033", fg="#60A5FA").pack()

        # Lista de tarjetas con scroll
        container = tk.Frame(self, bg=BG)
        container.pack(fill="both", expand=True, padx=16, pady=12)

        canvas = tk.Canvas(container, bg=BG, highlightthickness=0)
        scrollbar = ttk.Scrollbar(container, orient="vertical", command=canvas.yview)
        self.cards_frame = tk.Frame(canvas, bg=BG)

        self.cards_frame.bind("<Configure>",
                              lambda e: canvas.configure(scrollregion=canvas.bbox("all")))

        canvas.create_window((0, 0), window=self.cards_frame, anchor="nw")
        canvas.configure(yscrollcommand=scrollbar.set)

        canvas.pack(side="left", fill="both", expand=True)
        scrollbar.pack(side="right", fill="y")

        # Scroll con mouse
        canvas.bind_all("<MouseWheel>",
                        lambda e: canvas.yview_scroll(int(-1 * (e.delta / 120)), "units"))

        # Tarjetas
        for tool in TOOLS:
            card = ToolCard(self.cards_frame, tool, self._open_tool)
            card.pack(fill="x", pady=4)

        # Footer
        footer = tk.Frame(self, bg="#0A0F1A", pady=6)
        footer.pack(fill="x", side="bottom")
        tk.Label(footer,
                 text="Al ejecutar por primera vez, Google abrirá el navegador para autenticar",
                 font=("Segoe UI", 8), bg="#0A0F1A", fg="#475569").pack()

    def _open_tool(self, tool: dict):
        RunDialog(self, tool)


if __name__ == "__main__":
    app = App()
    app.mainloop()
