from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any, IO

from ..config import get_settings
from ..google_auth import materialize_google_secrets, persist_google_token_from_run


def _bool_to_sn(value: Any, default: bool = False) -> str:
    if value is None:
        return "s" if default else "n"
    if isinstance(value, str):
        return "s" if value.lower() in {"1", "true", "yes", "s", "si", "sí", "on"} else "n"
    return "s" if bool(value) else "n"


def _date_to_ddmmyyyy(value: str | None) -> str:
    if not value:
        return ""
    value = str(value)
    if len(value) == 10 and value[4] == "-" and value[7] == "-":
        y, m, d = value.split("-")
        return f"{d}/{m}/{y}"
    return value


def _copytree_clean(src: Path, dst: Path) -> None:
    def ignore(_dir: str, names: list[str]) -> set[str]:
        return {n for n in names if n in {"credentials.json", "token.json", "__pycache__"} or n.endswith(".log")}
    if dst.exists():
        shutil.rmtree(dst)
    shutil.copytree(src, dst, ignore=ignore)


def _stage_uploads(tool: dict[str, Any], uploads: dict[str, list[Path]], run_root: Path) -> str | None:
    dialog_dir: str | None = None

    for stage in tool.get("stage_uploads", []):
        field = stage["field"]
        target = run_root / stage["target"]
        target.mkdir(parents=True, exist_ok=True)
        for old in target.iterdir():
            if old.is_file() and old.name.startswith("PONER_AQUI"):
                old.unlink(missing_ok=True)
        for uploaded in uploads.get(field, []):
            shutil.copy2(uploaded, target / uploaded.name)

    dialog_field = tool.get("dialog_directory_field")
    if dialog_field:
        dialog_target = run_root / "web_uploads" / dialog_field
        dialog_target.mkdir(parents=True, exist_ok=True)
        for uploaded in uploads.get(dialog_field, []):
            shutil.copy2(uploaded, dialog_target / uploaded.name)
        dialog_dir = str(dialog_target)

    return dialog_dir


def build_inputs(tool_id: str, payload: dict[str, Any], uploads: dict[str, list[Path]] | None = None) -> tuple[list[str], list[str], list[str]]:
    if uploads is None:
        uploads = {}
    if tool_id == "gpd":
        return [""], [], []
    if tool_id == "cc":
        dry = payload.get("modo_prueba", True)
        confirm_real = payload.get("confirmacion_real", False)
        inputs = [
            str(payload.get("carpeta_url", "")),
            _bool_to_sn(payload.get("subcarpetas"), False),
            _bool_to_sn(payload.get("hojas_ocultas"), False),
            _bool_to_sn(dry, True),
        ]
        if not bool(dry):
            inputs.append("SI" if bool(confirm_real) else "NO")
        return inputs, [], []
    if tool_id == "cf":
        return [_date_to_ddmmyyyy(payload.get("fecha")), str(payload.get("planilla_url", ""))], [], []
    if tool_id == "cer":
        # El script CER legacy espera nombres de argumentos en ingles:
        #   --period-mode, --reference-date, --cutoff-day
        # El formulario web mantiene nombres en espanol para la UI:
        #   periodos, fecha_referencia, dia_corte_mes_anterior
        # Esta traduccion evita el error:
        #   cer.py: error: unrecognized arguments: --periodos ...
        args: list[str] = []

        # Si el usuario subió archivos de "otro rango", ese modo toma prioridad.
        # rango_tipo siempre tiene valor (default del select), así que el trigger
        # real es la presencia de archivos en archivos_otro_periodo.
        rango_tipo = str(payload.get("rango_tipo") or "").strip()
        uses_otro = bool(uploads.get("archivos_otro_periodo"))

        if uses_otro:
            args += ["--period-mode", rango_tipo]
            if payload.get("fecha_desde_otro"):
                args += ["--fecha-desde-otro", str(payload["fecha_desde_otro"])]
            if payload.get("fecha_hasta_otro"):
                args += ["--fecha-hasta-otro", str(payload["fecha_hasta_otro"])]
        else:
            period_mode = payload.get("periodos") or payload.get("period_mode")
            reference_date = payload.get("fecha_referencia") or payload.get("reference_date")
            cutoff_day = payload.get("dia_corte_mes_anterior") or payload.get("cutoff_day")

            if period_mode:
                args += ["--period-mode", str(period_mode)]
            if reference_date:
                args += ["--reference-date", str(reference_date)]
            if cutoff_day:
                args += ["--cutoff-day", str(cutoff_day)]

        return [""], [], args
    if tool_id == "eb":
        return [""], [], []
    if tool_id == "gg":
        return [], [_date_to_ddmmyyyy(payload.get("fecha_inicio")), _date_to_ddmmyyyy(payload.get("fecha_fin"))], []
    if tool_id in {"ncm", "ncmc"}:
        return [str(payload.get("origen_url", "")), str(payload.get("master_url", "")), str(payload.get("destino_url", "")), str(payload.get("titulo", ""))], [], []
    if tool_id == "nvsc":
        ventas_urls = [line.strip() for line in str(payload.get("ventas_urls", "")).splitlines() if line.strip()]
        count = int(payload.get("cantidad") or len(ventas_urls) or 4)
        inputs = [str(payload.get("alcance", "todo")), str(count)]
        inputs.extend(ventas_urls[:count])
        while len(inputs) < 2 + count:
            inputs.append("")
        inputs.extend([str(payload.get("master_url", "")), str(payload.get("destino_url", "")), str(payload.get("titulo", ""))])
        return inputs, [], []
    if tool_id == "vsc":
        args: list[str] = []
        if payload.get("mensual_url"):
            args += ["--monthly-url", str(payload["mensual_url"])]
        if payload.get("diario_url"):
            args += ["--daily-url", str(payload["diario_url"])]
        if payload.get("reset_control"):
            args += ["--reset-control"]
        return [], [], args
    return [], [], []


def validate_payload(tool: dict[str, Any], payload: dict[str, Any], uploads: dict[str, list[Path]]) -> None:
    fields = tool.get("fields", [])

    # Para CER: si se subieron archivos de "otro periodo", el flujo principal no es obligatorio
    cer_uses_otro = tool["id"] == "cer" and bool(uploads.get("archivos_otro_periodo"))
    cer_main_file_fields = {"archivos_mes_actual", "archivos_mes_pasado"}

    for field in fields:
        if not field.get("required"):
            continue
        name = field["name"]
        ftype = field["type"]
        if ftype in {"file", "multi_file"}:
            if cer_uses_otro and name in cer_main_file_fields:
                continue  # flujo alternativo activo, no exigir archivos del flujo principal
            if not uploads.get(name):
                raise ValueError(f"Falta subir archivo(s): {field['label']}")
        else:
            value = payload.get(name)
            if value is None or str(value).strip() == "":
                raise ValueError(f"Falta completar: {field['label']}")

    # CER con otro rango: debe haber archivos en otro_periodo
    if tool["id"] == "cer" and str(payload.get("rango_tipo") or "").strip() and not cer_uses_otro:
        raise ValueError("Seleccionaste 'otro rango' pero no subiste archivos del período.")

    if tool["id"] == "cc" and not bool(payload.get("modo_prueba", True)) and not bool(payload.get("confirmacion_real", False)):
        raise ValueError("Para ejecutar Congelar Carpeta en modo real tenés que marcar la confirmación.")
    if tool["id"] == "gg" and str(payload.get("fecha_fin", "")) < str(payload.get("fecha_inicio", "")):
        raise ValueError("La fecha fin no puede ser anterior a la fecha inicio.")


def prepare_run_tree(job_id: str, tool: dict[str, Any], uploads: dict[str, list[Path]]) -> tuple[Path, Path, str | None]:
    settings = get_settings()

    # IMPORTANTE:
    # settings.runs_dir puede venir como ruta relativa (por ejemplo, "storage/runs").
    # En Windows, si después ejecutamos subprocess con cwd=script_path.parent y el
    # bootstrap vuelve a resolver una ruta relativa, se duplica la ruta:
    #   ...\Generar Planillas\storage\runs\...\Generar Planillas
    # Por eso acá convertimos TODO a ruta absoluta desde el principio.
    run_root = (settings.runs_dir / job_id / "Aplicacion de ElectroGV").resolve()
    legacy_template_dir = settings.legacy_template_dir.resolve()

    _copytree_clean(legacy_template_dir, run_root)
    materialize_google_secrets(run_root)
    dialog_dir = _stage_uploads(tool, uploads, run_root)

    script_path = (run_root / tool["script"]).resolve()
    if not script_path.exists():
        raise FileNotFoundError(f"No encontré el script legacy: {script_path}")
    return run_root, script_path, dialog_dir


def run_legacy_subprocess(job_id: str, tool: dict[str, Any], payload: dict[str, Any], uploads: dict[str, list[Path]], log_file: IO[str]) -> tuple[int, int | None]:
    validate_payload(tool, payload, uploads)
    run_root, script_path, dialog_dir = prepare_run_tree(job_id, tool, uploads)
    inputs, dialogs, cli_args = build_inputs(tool["id"], payload, uploads)

    bootstrap = (Path(__file__).resolve().parent / "legacy_bootstrap.py").resolve()
    script_path = script_path.resolve()
    run_root = run_root.resolve()

    cmd = [
        sys.executable,
        str(bootstrap),
        "--script", str(script_path),
        "--inputs-json", json.dumps(inputs, ensure_ascii=False),
        "--dialog-json", json.dumps(dialogs, ensure_ascii=False),
        "--script-args-json", json.dumps(cli_args, ensure_ascii=False),
    ]
    if dialog_dir:
        cmd.extend(["--askdirectory", dialog_dir])

    env = os.environ.copy()
    env["PYTHONUNBUFFERED"] = "1"
    # Fuerza UTF-8 en los scripts legacy para evitar errores de Windows cp1252
    # cuando imprimen emojis o símbolos como ✅, ❌, etc.
    env["PYTHONUTF8"] = "1"
    env["PYTHONIOENCODING"] = "utf-8"

    log_file.write(f"[JOB {job_id}] Herramienta: {tool['name']}\n")
    log_file.write(f"[JOB {job_id}] Script: {script_path}\n")
    log_file.write("[JOB] Inicio de ejecución web.\n\n")
    log_file.flush()

    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        cwd=str(script_path.parent.resolve()),
        env=env,
        bufsize=1,
    )
    try:
        from ..database import update_job
        update_job(job_id, pid=proc.pid)
    except Exception:
        pass


    assert proc.stdout is not None
    for line in proc.stdout:
        log_file.write(line)
        log_file.flush()

    code = proc.wait()
    persist_google_token_from_run(run_root)
    log_file.write(f"\n[JOB {job_id}] Código de salida: {code}\n")
    log_file.flush()
    return code, proc.pid
