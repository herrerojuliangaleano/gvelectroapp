from __future__ import annotations

import argparse
import builtins
import json
import os
import runpy
import sys
import types
from pathlib import Path


def _force_utf8_stdio() -> None:
    """Evita UnicodeEncodeError en Windows cuando scripts legacy imprimen emojis.

    En Windows, si stdout/stderr quedan con cp1252, un print("✅ ...") puede
    romper toda la herramienta aunque el procesamiento haya salido bien.
    Este bootstrap ejecuta scripts legacy dentro del mismo proceso, así que
    reconfiguramos las salidas antes de hacer runpy.run_path().
    """
    for stream_name in ("stdout", "stderr"):
        stream = getattr(sys, stream_name, None)
        reconfigure = getattr(stream, "reconfigure", None)
        if callable(reconfigure):
            try:
                reconfigure(encoding="utf-8", errors="replace")
            except Exception:
                pass


def _install_input_patch(inputs: list[str]) -> None:
    queue = list(inputs)
    original_input = builtins.input

    def patched_input(prompt: str = "") -> str:
        if prompt:
            print(prompt, end="", flush=True)
        if queue:
            value = str(queue.pop(0))
            print(value, flush=True)
            return value
        print("", flush=True)
        return ""

    builtins.input = patched_input  # type: ignore[assignment]


def _install_tkinter_fakes(dialog_values: list[str], askdirectory: str | None) -> None:
    dialog_queue = list(dialog_values)

    class FakeTk:
        def withdraw(self):
            return None
        def destroy(self):
            return None
        def mainloop(self):
            return None

    tk = types.ModuleType("tkinter")
    tk.Tk = FakeTk  # type: ignore[attr-defined]

    simpledialog = types.ModuleType("tkinter.simpledialog")
    def askstring(title: str, text: str):
        print(f"[DIALOG] {title}: {text}", flush=True)
        if dialog_queue:
            value = str(dialog_queue.pop(0))
            print(f"[DIALOG_VALUE] {value}", flush=True)
            return value
        return None
    simpledialog.askstring = askstring  # type: ignore[attr-defined]

    messagebox = types.ModuleType("tkinter.messagebox")
    def showinfo(title: str, message: str):
        print(f"[INFO] {title}: {message}", flush=True)
    def showerror(title: str, message: str):
        print(f"[ERROR] {title}: {message}", flush=True)
    def showwarning(title: str, message: str):
        print(f"[WARN] {title}: {message}", flush=True)
    messagebox.showinfo = showinfo  # type: ignore[attr-defined]
    messagebox.showerror = showerror  # type: ignore[attr-defined]
    messagebox.showwarning = showwarning  # type: ignore[attr-defined]

    filedialog = types.ModuleType("tkinter.filedialog")
    askdirectory_path = askdirectory
    def askdirectory_func(title: str = ""):
        print(f"[FILEDIALOG] {title}", flush=True)
        if not askdirectory_path:
            raise SystemExit("No se configuró carpeta de entrada para el selector de archivos.")
        print(f"[FILEDIALOG_VALUE] {askdirectory_path}", flush=True)
        return askdirectory_path
    filedialog.askdirectory = askdirectory_func  # type: ignore[attr-defined]

    tk.simpledialog = simpledialog  # type: ignore[attr-defined]
    tk.messagebox = messagebox  # type: ignore[attr-defined]
    tk.filedialog = filedialog  # type: ignore[attr-defined]

    sys.modules["tkinter"] = tk
    sys.modules["tkinter.simpledialog"] = simpledialog
    sys.modules["tkinter.messagebox"] = messagebox
    sys.modules["tkinter.filedialog"] = filedialog


def main() -> int:
    _force_utf8_stdio()
    parser = argparse.ArgumentParser()
    parser.add_argument("--script", required=True)
    parser.add_argument("--inputs-json", default="[]")
    parser.add_argument("--dialog-json", default="[]")
    parser.add_argument("--askdirectory", default=None)
    parser.add_argument("--script-args-json", default="[]")
    args = parser.parse_args()

    raw_script = Path(args.script).expanduser()
    script = raw_script.resolve()

    # Fallback defensivo para ejecuciones legacy antiguas que pasaban rutas relativas
    # tipo "storage/runs/.../script.py" mientras el proceso ya estaba parado dentro
    # de "storage/runs/.../carpeta_del_script". En ese caso Path.resolve() duplica
    # la ruta. Intentamos reconstruirla desde la raiz del backend.
    if not script.exists() and not raw_script.is_absolute():
        cwd_parts = list(Path.cwd().resolve().parts)
        lower_parts = [x.lower() for x in cwd_parts]
        try:
            idx = lower_parts.index("storage")
            if idx + 1 < len(lower_parts) and lower_parts[idx + 1] == "runs":
                backend_root = Path(*cwd_parts[:idx])
                candidate = (backend_root / raw_script).resolve()
                if candidate.exists():
                    script = candidate
        except ValueError:
            pass

    if not script.exists():
        raise FileNotFoundError(f"No existe el script legacy: {script}")

    inputs = json.loads(args.inputs_json)
    dialog_values = json.loads(args.dialog_json)
    script_args = json.loads(args.script_args_json)

    _install_input_patch([str(x) for x in inputs])
    _install_tkinter_fakes([str(x) for x in dialog_values], args.askdirectory)

    script_dir = str(script.parent)
    if script_dir not in sys.path:
        sys.path.insert(0, script_dir)

    sys.argv = [str(script)] + [str(x) for x in script_args]
    os.chdir(str(script.parent))
    print(f"[WEB RUNNER] CWD: {script.parent}", flush=True)
    print(f"[WEB RUNNER] Ejecutando: {script}", flush=True)
    runpy.run_path(str(script), run_name="__main__")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SystemExit:
        raise
    except Exception as exc:
        print(f"[WEB RUNNER ERROR] {exc}", flush=True)
        raise
