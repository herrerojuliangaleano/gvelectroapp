"""Credencial de empleado en PDF listo para imprenta (tarjeta PVC CR-80).

Especificación física:
- Tarjeta CR-80 vertical: 54 x 86 mm.
- Sangrado de 3 mm por lado -> página de 60 x 92 mm.
- Página 1: frente. Página 2: dorso.
- 100% vectorial (curvas, marca de agua "GV", íconos y tipografía Roboto
  embebida); la foto se embebe como PNG en alta resolución (~600 dpi) con
  esquinas redondeadas, así el PDF supera holgado los 300 dpi requeridos.

El troquel NO se imprime: los bordes redondeados y la ranura del lanyard los
hace la imprenta. Acá solo se respeta el margen de seguridad (3 mm dentro de
la tarjeta) y se deja libre la zona superior del agujero.

La marca de agua "GV" va como tinta al 4-5%: puede imprimirse tal cual o
usarse como guía para barniz sectorizado / relieve. El logo grande del dorso
se dibuja en modo relieve (doble pasada clara) pensado para emboss real.
"""
from __future__ import annotations

import zipfile
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageOps
from reportlab.lib.colors import Color, HexColor, white
from reportlab.lib.units import mm as MM
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas as rl_canvas

# ── Medidas (mm) ────────────────────────────────────────────────────────────
BLEED = 3.0
CARD_W, CARD_H = 54.0, 86.0
PAGE_W, PAGE_H = CARD_W + 2 * BLEED, CARD_H + 2 * BLEED  # 60 x 92

# ── Paleta ──────────────────────────────────────────────────────────────────
BLUE = HexColor("#1D3FBF")          # azul corporativo fuerte
BLUE_BRIGHT = HexColor("#2B51DC")   # azul vivo (gradientes)
BLUE_DEEP = HexColor("#16309B")     # azul profundo (gradientes)
BLUE_NIGHT = HexColor("#12276F")    # sombra de banda
BLUE_SOFT = HexColor("#8FA3EC")     # periwinkle highlight
BLUE_PALE = HexColor("#B7C4F3")     # highlight suave
NAVY = HexColor("#101C4E")          # textos principales
TXT = HexColor("#3C4666")           # texto secundario
TXT_SOFT = HexColor("#4A5478")      # leyenda dorso
LINE = HexColor("#CBD5F0")          # separadores
PHOTO_BORDER = HexColor("#E3E8F4")
EMBOSS_DARK = HexColor("#BFCBE8")   # relieve dorso (sombra)
EMBOSS_LIGHT = HexColor("#D7DFF2")  # relieve dorso (cara)
PLACEHOLDER_BG = HexColor("#EEF2FB")
PLACEHOLDER_FG = HexColor("#8B9AD1")
FLAME = HexColor("#F59E0B")         # acento del escudo

# ── Tipografía ──────────────────────────────────────────────────────────────
_FONTS_DIR = Path(__file__).resolve().parents[1] / "storage" / "fonts"
_FONTS = {
    "Roboto": "Roboto-Regular.ttf",
    "Roboto-Medium": "Roboto-Medium.ttf",
    "Roboto-Bold": "Roboto-Bold.ttf",
    "Roboto-Black": "Roboto-Black.ttf",
}


def _register_fonts() -> None:
    registered = set(pdfmetrics.getRegisteredFontNames())
    for name, filename in _FONTS.items():
        if name not in registered:
            pdfmetrics.registerFont(TTFont(name, str(_FONTS_DIR / filename)))


# ── Helpers de coordenadas (mm "desde arriba" -> puntos) ────────────────────

def _x(v: float) -> float:
    return v * MM


def _y(v: float) -> float:
    """v en mm medido desde el borde superior de la página."""
    return (PAGE_H - v) * MM


def _spaced_centred(
    c: rl_canvas.Canvas, x_pt: float, y_pt: float, text: str,
    font: str, size: float, color: Color, char_space: float,
) -> None:
    """drawCentredString con letter-spacing (via text object)."""
    width = c.stringWidth(text, font, size) + char_space * max(0, len(text) - 1)
    t = c.beginText()
    t.setFont(font, size)
    t.setCharSpace(char_space)
    t.setFillColor(color)
    t.setTextOrigin(x_pt - width / 2, y_pt)
    t.textOut(text)
    c.drawText(t)


def _fit_font(c: rl_canvas.Canvas, text: str, font: str, max_pt: float, min_pt: float, max_w_mm: float) -> float:
    """Reduce el tamaño hasta que `text` entre en `max_w_mm`."""
    size = max_pt
    limit = max_w_mm * MM
    while size > min_pt and c.stringWidth(text, font, size) > limit:
        size -= 0.25
    return size


def _fill_path_gradient(
    c: rl_canvas.Canvas, path, x0: float, y0: float, x1: float, y1: float, colors: list[Color],
) -> None:
    """Rellena `path` con un gradiente lineal (coordenadas en mm desde arriba)."""
    c.saveState()
    c.clipPath(path, stroke=0, fill=0)
    c.linearGradient(_x(x0), _y(y0), _x(x1), _y(y1), colors, extend=True)
    c.restoreState()


# ── Marca de agua "GV" ──────────────────────────────────────────────────────

def _watermark(c: rl_canvas.Canvas, *, color: Color = NAVY, alpha: float = 0.05) -> None:
    """Patrón "GV GV GV" en diagonal. Con alpha bajo = marca de agua del print;
    con color negro sólido = máscara de barniz sectorizado (spot UV)."""
    c.saveState()
    c.translate(PAGE_W / 2 * MM, PAGE_H / 2 * MM)
    c.rotate(-24)
    c.setFont("Roboto-Black", 10)
    c.setFillColor(color)
    c.setFillAlpha(alpha)
    for i in range(-10, 11):
        y_off = i * 7.6
        x_stagger = 5.8 if i % 2 else 0.0
        for j in range(-6, 7):
            c.drawCentredString((j * 11.6 + x_stagger) * MM, y_off * MM, "GV")
    c.restoreState()


# ── Logo circular GV Electro (vectorial) ────────────────────────────────────

def _logo_gv(
    c: rl_canvas.Canvas,
    cx: float,
    cy: float,
    r: float,
    *,
    ring_w: float = 1.0,
    emboss: bool = False,
    mono: Color | None = None,
) -> None:
    """Logo "GV / ELECTRO" dentro de un anillo. `cy` = centro del círculo (mm desde arriba).

    Con `emboss=True` se dibuja en modo relieve (dorso): doble pasada con
    highlight blanco y tinta muy suave. Con `mono` se pinta todo en un color
    plano (se usa para la máscara de relieve de imprenta).
    """
    gv_pt = r * 2.30
    sub_pt = r * 0.55
    gv_cap = gv_pt * 0.72 / MM          # cap height en mm
    gv_baseline = cy - r * 0.16 + gv_cap / 2
    sub_baseline = cy + r * 0.42

    def _paint(dx: float, dy: float, ring_col: Color, ink_col: Color, sub_col: Color) -> None:
        c.saveState()
        c.setStrokeColor(ring_col)
        c.setLineWidth(ring_w * MM)
        c.circle(_x(cx + dx), _y(cy + dy), r * MM, stroke=1, fill=0)
        c.setFillColor(ink_col)
        c.setFont("Roboto-Black", gv_pt)
        c.drawCentredString(_x(cx + dx), _y(gv_baseline + dy), "GV")
        _spaced_centred(c, _x(cx + dx), _y(sub_baseline + dy), "ELECTRO", "Roboto-Bold", sub_pt, sub_col, 0.5)
        c.restoreState()

    if mono is not None:
        _paint(0.0, 0.0, mono, mono, mono)
    elif emboss:
        _paint(0.3, 0.3, white, white, white)
        _paint(0.0, 0.0, EMBOSS_DARK, EMBOSS_LIGHT, EMBOSS_DARK)
    else:
        _paint(0.0, 0.0, BLUE, NAVY, BLUE)


# ── Íconos vectoriales mínimos ──────────────────────────────────────────────

def _icon_pin(c: rl_canvas.Canvas, cx: float, cy: float, s: float, color: Color) -> None:
    """Pin de ubicación. `cy` = centro vertical, `s` = alto total en mm."""
    c.saveState()
    c.setFillColor(color)
    head_r = s * 0.34
    head_cy = cy - s * 0.12
    c.circle(_x(cx), _y(head_cy), head_r * MM, stroke=0, fill=1)
    p = c.beginPath()
    p.moveTo(_x(cx - head_r * 0.86), _y(head_cy + head_r * 0.42))
    p.lineTo(_x(cx + head_r * 0.86), _y(head_cy + head_r * 0.42))
    p.lineTo(_x(cx), _y(cy + s * 0.5))
    p.close()
    c.drawPath(p, stroke=0, fill=1)
    c.setFillColor(white)
    c.circle(_x(cx), _y(head_cy), head_r * 0.42 * MM, stroke=0, fill=1)
    c.restoreState()


def _disc_clip(c: rl_canvas.Canvas, cx: float, cy: float, d: float, color: Color) -> None:
    """Pinta el disco azul y deja el recorte circular activo (llamar dentro de saveState)."""
    c.setFillColor(color)
    c.circle(_x(cx), _y(cy), d / 2 * MM, stroke=0, fill=1)
    clip = c.beginPath()
    clip.circle(_x(cx), _y(cy), d / 2 * MM)
    c.clipPath(clip, stroke=0, fill=0)
    c.setFillColor(white)


def _icon_people(c: rl_canvas.Canvas, cx: float, cy: float, d: float, color: Color) -> None:
    """Dos personas blancas sobre disco azul."""
    c.saveState()
    _disc_clip(c, cx, cy, d, color)
    # Persona de atrás (derecha), un poco más chica.
    c.circle(_x(cx + d * 0.16), _y(cy - d * 0.08), d * 0.13 * MM, stroke=0, fill=1)
    c.roundRect(_x(cx - d * 0.02), _y(cy + d * 0.4), d * 0.34 * MM, d * 0.3 * MM, d * 0.14 * MM, stroke=0, fill=1)
    # Persona de adelante (izquierda), con "halo" azul para separarla.
    c.setFillColor(color)
    c.circle(_x(cx - d * 0.1), _y(cy - d * 0.12), d * 0.2 * MM, stroke=0, fill=1)
    c.roundRect(_x(cx - d * 0.4), _y(cy + d * 0.3), d * 0.6 * MM, d * 0.5 * MM, d * 0.22 * MM, stroke=0, fill=1)
    c.setFillColor(white)
    c.circle(_x(cx - d * 0.1), _y(cy - d * 0.12), d * 0.15 * MM, stroke=0, fill=1)
    c.roundRect(_x(cx - d * 0.32), _y(cy + d * 0.36), d * 0.44 * MM, d * 0.44 * MM, d * 0.17 * MM, stroke=0, fill=1)
    c.restoreState()


def _icon_person(c: rl_canvas.Canvas, cx: float, cy: float, d: float, color: Color) -> None:
    """Persona blanca dentro de un disco azul."""
    c.saveState()
    _disc_clip(c, cx, cy, d, color)
    c.circle(_x(cx), _y(cy - d * 0.13), d * 0.17 * MM, stroke=0, fill=1)
    c.roundRect(_x(cx - d * 0.26), _y(cy + d * 0.32), d * 0.52 * MM, d * 0.44 * MM, d * 0.2 * MM, stroke=0, fill=1)
    c.restoreState()


def _icon_building(c: rl_canvas.Canvas, cx: float, cy: float, d: float, color: Color) -> None:
    """Edificio blanco sobre disco azul."""
    c.saveState()
    _disc_clip(c, cx, cy, d, color)
    w, h = d * 0.44, d * 0.56
    x0, y_top = cx - w / 2, cy - h / 2
    c.roundRect(_x(x0), _y(y_top + h), w * MM, h * MM, d * 0.04 * MM, stroke=0, fill=1)
    c.setFillColor(color)
    win = d * 0.08
    for row in range(2):
        for col in range(2):
            wx = x0 + w * 0.22 + col * w * 0.4
            wy = y_top + h * 0.16 + row * h * 0.32
            c.rect(_x(wx), _y(wy + win), win * MM, win * MM, stroke=0, fill=1)
    c.rect(_x(cx - d * 0.05), _y(y_top + h), d * 0.1 * MM, d * 0.14 * MM, stroke=0, fill=1)
    c.restoreState()


def _icon_briefcase(c: rl_canvas.Canvas, cx: float, cy: float, d: float, color: Color) -> None:
    """Portafolio blanco sobre disco azul."""
    c.saveState()
    _disc_clip(c, cx, cy, d, color)
    c.roundRect(_x(cx - d * 0.1), _y(cy - d * 0.13), d * 0.2 * MM, d * 0.1 * MM, d * 0.03 * MM, stroke=0, fill=1)
    c.roundRect(_x(cx - d * 0.28), _y(cy + d * 0.28), d * 0.56 * MM, d * 0.4 * MM, d * 0.06 * MM, stroke=0, fill=1)
    c.setFillColor(color)
    c.rect(_x(cx - d * 0.28), _y(cy + d * 0.06), d * 0.56 * MM, d * 0.05 * MM, stroke=0, fill=1)
    c.setFillColor(white)
    c.rect(_x(cx - d * 0.05), _y(cy + d * 0.09), d * 0.1 * MM, d * 0.06 * MM, stroke=0, fill=1)
    c.restoreState()


def _icon_shield(c: rl_canvas.Canvas, cx: float, cy: float, s: float) -> None:
    """Escudo delineado azul con llama naranja (marca de seguridad, como el mockup)."""
    top = cy - s * 0.5

    def shield_path():
        p = c.beginPath()
        p.moveTo(_x(cx), _y(top))
        p.lineTo(_x(cx + s * 0.4), _y(top + s * 0.17))
        p.lineTo(_x(cx + s * 0.4), _y(top + s * 0.52))
        p.curveTo(_x(cx + s * 0.4), _y(top + s * 0.8), _x(cx + s * 0.2), _y(top + s * 0.94), _x(cx), _y(top + s))
        p.curveTo(_x(cx - s * 0.2), _y(top + s * 0.94), _x(cx - s * 0.4), _y(top + s * 0.8), _x(cx - s * 0.4), _y(top + s * 0.52))
        p.lineTo(_x(cx - s * 0.4), _y(top + s * 0.17))
        p.close()
        return p

    c.saveState()
    c.setFillColor(white)
    c.setStrokeColor(BLUE)
    c.setLineWidth(0.42 * MM)
    c.setLineJoin(1)
    c.drawPath(shield_path(), stroke=1, fill=1)
    # Llama naranja: gota simétrica sobre el centro del escudo.
    fx, fy = cx, top + s * 0.58
    fr = s * 0.16
    c.setFillColor(FLAME)
    c.circle(_x(fx), _y(fy), fr * MM, stroke=0, fill=1)
    p = c.beginPath()
    p.moveTo(_x(fx), _y(fy - fr * 2.1))
    p.curveTo(_x(fx + fr * 0.55), _y(fy - fr * 1.25), _x(fx + fr * 1.0), _y(fy - fr * 0.7), _x(fx + fr * 1.0), _y(fy))
    p.lineTo(_x(fx - fr * 1.0), _y(fy))
    p.curveTo(_x(fx - fr * 1.0), _y(fy - fr * 0.7), _x(fx - fr * 0.55), _y(fy - fr * 1.25), _x(fx), _y(fy - fr * 2.1))
    p.close()
    c.drawPath(p, stroke=0, fill=1)
    c.setFillColor(white)
    c.circle(_x(fx), _y(fy + fr * 0.2), fr * 0.4 * MM, stroke=0, fill=1)
    c.restoreState()


def _icon_nfc(c: rl_canvas.Canvas, cx: float, cy: float, s: float, color: Color) -> None:
    """Ondas NFC, detalle decorativo."""
    c.saveState()
    c.translate(_x(cx), _y(cy))
    c.rotate(-16)
    c.setStrokeColor(color)
    c.setLineCap(1)
    c.setLineWidth(0.45 * MM)
    for r in (s * 0.3, s * 0.62, s * 0.94):
        p = c.beginPath()
        p.arc(-r * MM, -r * MM, r * MM, r * MM, startAng=-42, extent=84)
        c.drawPath(p, stroke=1, fill=0)
    c.restoreState()


# ── Foto ────────────────────────────────────────────────────────────────────

def _prep_photo(photo: bytes, box_w: float, box_h: float, radius_mm: float) -> ImageReader:
    """Recorta al ratio del marco, redondea esquinas y devuelve un PNG RGBA."""
    img = Image.open(BytesIO(photo))
    img = ImageOps.exif_transpose(img) or img
    img = img.convert("RGB")

    target = box_w / box_h
    w, h = img.size
    current = w / h
    if current > target:  # sobra ancho
        new_w = int(h * target)
        x0 = (w - new_w) // 2
        img = img.crop((x0, 0, x0 + new_w, h))
    elif current < target:  # sobra alto
        new_h = int(w / target)
        y0 = max(0, int((h - new_h) * 0.38))  # sesgo hacia arriba: caras
        img = img.crop((0, y0, w, y0 + new_h))

    # ~600 dpi dentro del marco (300 dpi mínimo pedido, con margen).
    out_w = max(320, int(box_w * 23.6))
    out_h = max(320, int(box_h * 23.6))
    img = img.resize((out_w, out_h), Image.LANCZOS)

    radius_px = max(6, int(radius_mm * 23.6))
    mask = Image.new("L", (out_w, out_h), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, out_w - 1, out_h - 1), radius=radius_px, fill=255)
    img.putalpha(mask)

    buf = BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return ImageReader(buf)


def _initials(nombre: str) -> str:
    parts = [p for p in nombre.replace("-", " ").split() if p]
    if not parts:
        return "GV"
    if len(parts) == 1:
        return parts[0][:2].upper()
    return (parts[0][0] + parts[-1][0]).upper()


# ── Frente ──────────────────────────────────────────────────────────────────

def _front_decor(c: rl_canvas.Canvas) -> None:
    # Cinta lateral izquierda: S con cintura, eco claro detrás.
    def ribbon(dx: float):
        p = c.beginPath()
        p.moveTo(_x(0), _y(7))
        p.curveTo(_x(9 + dx), _y(10), _x(11.5 + dx), _y(16), _x(9 + dx), _y(22))
        p.curveTo(_x(7 + dx), _y(27), _x(4.5 + dx), _y(30), _x(5 + dx), _y(35))
        p.curveTo(_x(5.6 + dx), _y(40), _x(3 + dx), _y(45), _x(0), _y(51))
        p.close()
        return p

    c.saveState()
    c.setFillColor(BLUE_PALE)
    c.drawPath(ribbon(1.3), stroke=0, fill=1)
    c.restoreState()
    _fill_path_gradient(c, ribbon(0.0), 2, 8, 8, 50, [BLUE_BRIGHT, BLUE_DEEP])

    # Swoosh derecho: media luna grande pero escondida detrás de la foto;
    # solo queda visible el filo que la rodea (como el mockup).
    p_light = c.beginPath()
    p_light.moveTo(_x(PAGE_W), _y(42.5))
    p_light.curveTo(_x(48), _y(45), _x(41), _y(49), _x(42.5), _y(54))
    p_light.curveTo(_x(43.8), _y(58.2), _x(50), _y(60.2), _x(PAGE_W), _y(59.6))
    p_light.close()
    c.saveState()
    c.setFillColor(BLUE_SOFT)
    c.drawPath(p_light, stroke=0, fill=1)
    c.restoreState()

    p_body = c.beginPath()
    p_body.moveTo(_x(PAGE_W), _y(44.3))
    p_body.curveTo(_x(49.5), _y(46.6), _x(43), _y(50), _x(44.3), _y(54.2))
    p_body.curveTo(_x(45.6), _y(57.8), _x(51), _y(59.4), _x(PAGE_W), _y(58.8))
    p_body.close()
    _fill_path_gradient(c, p_body, 44, 47, 60, 58, [BLUE_BRIGHT, BLUE_DEEP])

    # Banda inferior asimétrica: sube hacia la derecha. Highlight + cuerpo + sombra.
    def band(top_pts: list[tuple[float, float]]):
        p = c.beginPath()
        p.moveTo(_x(top_pts[0][0]), _y(top_pts[0][1]))
        p.curveTo(_x(top_pts[1][0]), _y(top_pts[1][1]), _x(top_pts[2][0]), _y(top_pts[2][1]), _x(top_pts[3][0]), _y(top_pts[3][1]))
        p.curveTo(_x(top_pts[4][0]), _y(top_pts[4][1]), _x(top_pts[5][0]), _y(top_pts[5][1]), _x(top_pts[6][0]), _y(top_pts[6][1]))
        p.lineTo(_x(PAGE_W), _y(PAGE_H))
        p.lineTo(_x(0), _y(PAGE_H))
        p.close()
        return p

    c.saveState()
    c.setFillColor(BLUE_SOFT)
    c.drawPath(band([(0, 80.6), (12, 84.6), (26, 84.6), (40, 80.8), (48, 78.6), (54, 76.2), (PAGE_W, 74.6)]), stroke=0, fill=1)
    c.restoreState()
    _fill_path_gradient(
        c,
        band([(0, 82.4), (12, 86.4), (26, 86.4), (40, 82.6), (48, 80.4), (54, 78.0), (PAGE_W, 76.4)]),
        0, 88, 60, 78, [BLUE_DEEP, BLUE_BRIGHT],
    )
    c.saveState()
    c.setFillColor(BLUE_NIGHT)
    c.setFillAlpha(0.5)
    c.drawPath(band([(0, 86.8), (10, 89.2), (20, 89.2), (30, 88.6), (42, 88.2), (52, 87.6), (PAGE_W, 87.0)]), stroke=0, fill=1)
    c.restoreState()


def _draw_front(c: rl_canvas.Canvas, cred: "CredencialEmpleado") -> None:
    cx = PAGE_W / 2  # 30: centro de la tarjeta

    _watermark(c)
    _front_decor(c)
    _logo_gv(c, cx, 18.8, 7.9, ring_w=1.15)

    # ── Foto ──
    ph_w, ph_h = 31.0, 31.0
    ph_x, ph_y = cx - ph_w / 2, 28.6
    radius = 2.2
    # Sombra suave.
    c.saveState()
    c.setFillColor(NAVY)
    c.setFillAlpha(0.08)
    c.roundRect(_x(ph_x + 0.3), _y(ph_y + ph_h + 1.0), ph_w * MM, ph_h * MM, radius * MM, stroke=0, fill=1)
    c.restoreState()
    if cred.foto:
        reader = _prep_photo(cred.foto, ph_w, ph_h, radius)
        c.drawImage(reader, _x(ph_x), _y(ph_y + ph_h), ph_w * MM, ph_h * MM, mask="auto")
    else:
        c.saveState()
        c.setFillColor(PLACEHOLDER_BG)
        c.roundRect(_x(ph_x), _y(ph_y + ph_h), ph_w * MM, ph_h * MM, radius * MM, stroke=0, fill=1)
        c.setFillColor(PLACEHOLDER_FG)
        c.setFont("Roboto-Bold", 32)
        c.drawCentredString(_x(cx), _y(ph_y + ph_h / 2 + 4.0), _initials(cred.nombre))
        c.restoreState()
    c.saveState()
    c.setStrokeColor(PHOTO_BORDER)
    c.setLineWidth(0.3 * MM)
    c.roundRect(_x(ph_x), _y(ph_y + ph_h), ph_w * MM, ph_h * MM, radius * MM, stroke=1, fill=0)
    c.restoreState()

    # ── Nombre ──
    nombre = cred.nombre.strip().upper()
    c.setFillColor(NAVY)
    size = _fit_font(c, nombre, "Roboto-Black", 17.0, 8.5, 46.5)
    if size <= 8.5 and c.stringWidth(nombre, "Roboto-Black", 8.5) > 46.5 * MM and " " in nombre:
        # Dos líneas: partir cerca del medio.
        words = nombre.split()
        best, best_diff = 1, 10**9
        for i in range(1, len(words)):
            diff = abs(len(" ".join(words[:i])) - len(" ".join(words[i:])))
            if diff < best_diff:
                best, best_diff = i, diff
        l1, l2 = " ".join(words[:best]), " ".join(words[best:])
        size = min(
            _fit_font(c, l1, "Roboto-Black", 11.0, 6.6, 46.5),
            _fit_font(c, l2, "Roboto-Black", 11.0, 6.6, 46.5),
        )
        c.setFont("Roboto-Black", size)
        c.drawCentredString(_x(cx), _y(62.6), l1)
        c.drawCentredString(_x(cx), _y(66.6), l2)
    else:
        c.setFont("Roboto-Black", size)
        c.drawCentredString(_x(cx), _y(65.0), nombre)

    # ── Pastilla de área ──
    area = cred.area.strip().upper()
    if area:
        pill_h = 6.0
        pill_top = 66.8
        pt = _fit_font(c, area, "Roboto-Bold", 7.2, 4.8, 46.5 - 9.0)
        text_w = (c.stringWidth(area, "Roboto-Bold", pt) + 0.35 * max(0, len(area) - 1)) / MM
        pill_w = min(47.5, max(26.0, text_w + 9.0))
        c.saveState()
        c.setFillColor(BLUE)
        c.roundRect(_x(cx - pill_w / 2), _y(pill_top + pill_h), pill_w * MM, pill_h * MM, pill_h / 2 * MM, stroke=0, fill=1)
        _spaced_centred(c, _x(cx), _y(pill_top + pill_h / 2 + pt * 0.125), area, "Roboto-Bold", pt, white, 0.35)
        c.restoreState()

    # ── Rol ──
    rol = cred.rol.strip()
    if rol:
        pt = _fit_font(c, rol, "Roboto-Medium", 7.0, 5.2, 46.5)
        c.setFillColor(HexColor("#1A2557"))
        c.setFont("Roboto-Medium", pt)
        c.drawCentredString(_x(cx), _y(75.8), rol)

    # ── Sucursal ──
    suc = cred.sucursal.strip()
    if suc:
        pt = _fit_font(c, suc, "Roboto-Medium", 7.0, 5.2, 36.0)
        text_w = c.stringWidth(suc, "Roboto-Medium", pt) / MM
        icon_s = 3.4
        total = icon_s + 1.5 + text_w
        left = cx - total / 2
        _icon_pin(c, left + icon_s / 2, 78.9, icon_s, BLUE)
        c.setFillColor(NAVY)
        c.setFont("Roboto-Medium", pt)
        c.drawString(_x(left + icon_s + 1.5), _y(80.0), suc)

    c.showPage()


# ── Dorso ───────────────────────────────────────────────────────────────────

def _back_decor(c: rl_canvas.Canvas) -> None:
    # Banda superior con curva y highlight.
    p = c.beginPath()
    p.moveTo(_x(0), _y(12.6))
    p.curveTo(_x(16), _y(15.2), _x(36), _y(9.8), _x(PAGE_W), _y(12.4))
    p.lineTo(_x(PAGE_W), _y(0))
    p.lineTo(_x(0), _y(0))
    p.close()
    _fill_path_gradient(c, p, 0, 4, 60, 12, [BLUE_DEEP, BLUE_BRIGHT])

    c.saveState()
    c.setStrokeColor(BLUE_PALE)
    c.setLineWidth(1.0 * MM)
    c.setStrokeAlpha(0.95)
    p = c.beginPath()
    p.moveTo(_x(-1), _y(14.3))
    p.curveTo(_x(16), _y(16.9), _x(36), _y(11.5), _x(PAGE_W + 1), _y(14.1))
    c.drawPath(p, stroke=1, fill=0)
    c.restoreState()

    # Onda inferior fina, sube apenas a la derecha.
    c.saveState()
    c.setFillColor(BLUE_SOFT)
    p = c.beginPath()
    p.moveTo(_x(0), _y(86.0))
    p.curveTo(_x(14), _y(88.0), _x(32), _y(84.6), _x(PAGE_W), _y(86.2))
    p.lineTo(_x(PAGE_W), _y(PAGE_H))
    p.lineTo(_x(0), _y(PAGE_H))
    p.close()
    c.drawPath(p, stroke=0, fill=1)
    c.restoreState()
    p = c.beginPath()
    p.moveTo(_x(0), _y(87.6))
    p.curveTo(_x(16), _y(89.6), _x(34), _y(86.2), _x(PAGE_W), _y(87.8))
    p.lineTo(_x(PAGE_W), _y(PAGE_H))
    p.lineTo(_x(0), _y(PAGE_H))
    p.close()
    _fill_path_gradient(c, p, 0, 90, 60, 87, [BLUE_DEEP, BLUE_BRIGHT])


def _draw_back(c: rl_canvas.Canvas, cred: "CredencialEmpleado") -> None:
    cx = PAGE_W / 2

    _watermark(c)
    _back_decor(c)

    # Logo GV grande en relieve.
    _logo_gv(c, cx, 34.0, 15.5, ring_w=1.3, emboss=True)

    # ── Filas de datos ──
    rows = [
        ("Área:", cred.area.strip(), _icon_people),
        ("Rol:", cred.rol.strip(), _icon_person),
        ("Sucursal:", cred.sucursal.strip(), _icon_building),
        ("Empresa:", cred.empresa.strip(), _icon_briefcase),
    ]
    baselines = (55.3, 61.8, 68.3, 74.8)
    label_x, right_edge = 15.8, 48.8
    for (label, value, icon_fn), baseline in zip(rows, baselines):
        icon_fn(c, 11.2, baseline - 1.05, 3.8, BLUE)
        c.setFillColor(NAVY)
        c.setFont("Roboto-Bold", 6.8)
        c.drawString(_x(label_x), _y(baseline), label)
        label_w = c.stringWidth(label, "Roboto-Bold", 6.8) / MM
        value_x = label_x + label_w + 2.0
        val = value or "—"
        pt = _fit_font(c, val, "Roboto", 6.8, 4.9, right_edge - value_x)
        c.setFillColor(TXT)
        c.setFont("Roboto", pt)
        c.drawString(_x(value_x), _y(baseline), val)
    # Separadores entre filas.
    c.saveState()
    c.setStrokeColor(LINE)
    c.setLineWidth(0.28 * MM)
    for baseline in baselines[:-1]:
        c.line(_x(label_x), _y(baseline + 2.7), _x(right_edge), _y(baseline + 2.7))
    c.restoreState()

    # ── Pie: escudo + leyenda + NFC ──
    _icon_shield(c, cx, 77.8, 3.6)
    c.setFillColor(TXT_SOFT)
    c.setFont("Roboto", 5.5)
    c.drawCentredString(_x(cx), _y(82.2), "Ante pérdida,")
    c.drawCentredString(_x(cx), _y(84.8), "devolver a Administración.")
    _icon_nfc(c, 49.6, 81.0, 3.2, BLUE)

    c.showPage()


# ── API pública ─────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class CredencialEmpleado:
    nombre: str
    area: str = ""
    rol: str = ""
    sucursal: str = ""
    empresa: str = "Electro GV"
    foto: bytes | None = None


def _new_canvas(buf: BytesIO, title: str) -> rl_canvas.Canvas:
    c = rl_canvas.Canvas(buf, pagesize=(PAGE_W * MM, PAGE_H * MM))
    c.setTitle(title)
    c.setAuthor("Electro GV")
    return c


def render_credencial_pdf(cred: CredencialEmpleado) -> bytes:
    """PDF combinado frente + dorso (2 páginas), listo para imprenta."""
    _register_fonts()
    buf = BytesIO()
    c = _new_canvas(buf, f"Credencial {cred.nombre}".strip())
    _draw_front(c, cred)
    _draw_back(c, cred)
    c.save()
    return buf.getvalue()


def render_front_pdf(cred: CredencialEmpleado) -> bytes:
    """Frente imprimible (plano, con sangrado)."""
    _register_fonts()
    buf = BytesIO()
    c = _new_canvas(buf, f"Credencial frente · {cred.nombre}".strip())
    _draw_front(c, cred)
    c.save()
    return buf.getvalue()


def render_back_pdf(cred: CredencialEmpleado) -> bytes:
    """Dorso imprimible (plano, con sangrado)."""
    _register_fonts()
    buf = BytesIO()
    c = _new_canvas(buf, f"Credencial dorso · {cred.nombre}".strip())
    _draw_back(c, cred)
    c.save()
    return buf.getvalue()


# ── Capas técnicas para imprenta ────────────────────────────────────────────

def render_cut_guide_pdf() -> bytes:
    """Guía de corte + zona segura + ranura del lanyard. Color técnico (magenta),
    NO imprimible: es solo referencia de troquel para la imprenta."""
    _register_fonts()
    magenta = HexColor("#E6007E")
    buf = BytesIO()
    c = _new_canvas(buf, "Guía de corte")
    trim_r = 3.0
    safe = 4.0
    # Corte exterior (borde de la tarjeta ya troquelada).
    c.setStrokeColor(magenta)
    c.setLineWidth(0.25 * MM)
    c.roundRect(_x(BLEED), _y(BLEED + CARD_H), CARD_W * MM, CARD_H * MM, trim_r * MM, stroke=1, fill=0)
    # Zona segura (punteada).
    c.setDash(1.4, 1.4)
    c.setLineWidth(0.18 * MM)
    c.roundRect(
        _x(BLEED + safe), _y(BLEED + CARD_H - safe),
        (CARD_W - 2 * safe) * MM, (CARD_H - 2 * safe) * MM, (trim_r * 0.6) * MM, stroke=1, fill=0,
    )
    c.setDash()
    # Ranura del lanyard (referencia de troquel).
    slot_w, slot_h = 13.0, 2.4
    slot_cx = PAGE_W / 2
    slot_top = BLEED + 3.6
    c.setLineWidth(0.22 * MM)
    c.roundRect(_x(slot_cx - slot_w / 2), _y(slot_top + slot_h), slot_w * MM, slot_h * MM, slot_h / 2 * MM, stroke=1, fill=0)
    # Nota.
    c.setFillColor(magenta)
    c.setFont("Roboto-Medium", 4.6)
    c.drawCentredString(_x(slot_cx), _y(BLEED + CARD_H + 1.6), "GUÍA DE CORTE Y RANURA · NO IMPRIMIR")
    c.showPage()
    c.save()
    return buf.getvalue()


def render_spot_uv_mask_pdf(cred: CredencialEmpleado) -> bytes:
    """Máscara de barniz sectorizado (spot UV): patrón de marca de agua GV en
    negro 100%. Donde está negro, la imprenta aplica barniz brillante."""
    from reportlab.lib.colors import black

    _register_fonts()
    buf = BytesIO()
    c = _new_canvas(buf, f"Spot UV · {cred.nombre}".strip())
    _watermark(c, color=black, alpha=1.0)  # frente
    c.showPage()
    _watermark(c, color=black, alpha=1.0)  # dorso
    c.showPage()
    c.save()
    return buf.getvalue()


def render_emboss_mask_pdf() -> bytes:
    """Máscara de relieve / bajo relieve: solo el logo grande GV Electro del
    dorso en negro 100% (una página, corresponde al dorso)."""
    from reportlab.lib.colors import black

    _register_fonts()
    buf = BytesIO()
    c = _new_canvas(buf, "Relieve dorso")
    _logo_gv(c, PAGE_W / 2, 34.0, 15.5, ring_w=1.3, mono=black)
    c.showPage()
    c.save()
    return buf.getvalue()


# ── Mockup PVC realista (previsualización, no para imprenta) ─────────────────

def _pdf_first_page_to_image(pdf_bytes: bytes, dpi: int) -> Image.Image:
    import fitz  # PyMuPDF

    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        pix = doc[0].get_pixmap(dpi=dpi, alpha=False)
        return Image.frombytes("RGB", (pix.width, pix.height), pix.samples).copy()
    finally:
        doc.close()


def _shape_card(page_img: Image.Image, dpi: int, with_slot: bool) -> Image.Image:
    """Recorta el sangrado, redondea esquinas y (opcional) troquela la ranura."""
    ppm = dpi / 25.4
    bleed = round(BLEED * ppm)
    card = page_img.crop((bleed, bleed, page_img.width - bleed, page_img.height - bleed)).convert("RGBA")
    w, h = card.size
    radius = round(3.0 * ppm)

    mask = Image.new("L", (w, h), 0)
    md = ImageDraw.Draw(mask)
    md.rounded_rectangle((0, 0, w - 1, h - 1), radius=radius, fill=255)
    if with_slot:
        slot_w, slot_h = round(13.0 * ppm), round(2.4 * ppm)
        slot_x0 = (w - slot_w) // 2
        slot_y0 = round(3.6 * ppm)
        md.rounded_rectangle((slot_x0, slot_y0, slot_x0 + slot_w, slot_y0 + slot_h), radius=slot_h // 2, fill=0)

    card.putalpha(mask)

    # Brillo PVC: barrido diagonal suave + acento superior izquierdo.
    gloss = Image.new("L", (w, h), 0)
    gd = ImageDraw.Draw(gloss)
    for i in range(0, w + h, 3):
        val = max(0, 42 - abs(i - (w * 0.32 + h * 0.15)) * 0.05)
        gd.line((i, 0, i - h, h), fill=int(val), width=3)
    gloss = gloss.filter(ImageFilter.GaussianBlur(round(1.2 * ppm)))
    gloss = Image.composite(gloss, Image.new("L", (w, h), 0), mask)
    sheen = Image.new("RGBA", (w, h), (255, 255, 255, 0))
    sheen.putalpha(gloss)
    card = Image.alpha_composite(card, sheen)

    # Bisel: filo claro arriba/izquierda, sombra abajo/derecha.
    edge = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ed = ImageDraw.Draw(edge)
    ed.rounded_rectangle((0, 0, w - 1, h - 1), radius=radius, outline=(255, 255, 255, 150), width=max(1, round(0.25 * ppm)))
    edge = Image.composite(edge, Image.new("RGBA", (w, h), (0, 0, 0, 0)), mask)
    card = Image.alpha_composite(card, edge)
    return card


def _card_shadow(size: tuple[int, int], radius: int, blur: int) -> Image.Image:
    w, h = size
    pad = blur * 3
    sh = Image.new("RGBA", (w + 2 * pad, h + 2 * pad), (0, 0, 0, 0))
    sd = ImageDraw.Draw(sh)
    sd.rounded_rectangle((pad, pad, pad + w, pad + h), radius=radius, fill=(17, 28, 78, 115))
    return sh.filter(ImageFilter.GaussianBlur(blur))


def render_mockup_png(cred: CredencialEmpleado, dpi: int = 300) -> bytes:
    """Mockup PVC (frente + dorso) para previsualización/aprobación visual.

    Rasteriza los PDF planos, recorta el sangrado, redondea esquinas, troquela
    la ranura y agrega sombra + brillo sobre un fondo de estudio claro. NO es el
    archivo de imprenta.
    """
    front = _shape_card(_pdf_first_page_to_image(render_front_pdf(cred), dpi), dpi, with_slot=True)
    back = _shape_card(_pdf_first_page_to_image(render_back_pdf(cred), dpi), dpi, with_slot=True)

    ppm = dpi / 25.4
    cw, ch = front.size
    radius = round(3.0 * ppm)
    blur = max(6, round(1.7 * ppm))
    gap = round(12 * ppm)
    margin = round(14 * ppm)
    W = margin * 2 + cw * 2 + gap
    H = margin * 2 + ch

    # Fondo de estudio: gradiente vertical claro.
    bg = Image.new("RGB", (W, H), (240, 242, 246))
    top, bot = (245, 246, 249), (228, 231, 238)
    px = bg.load()
    for y in range(H):
        t = y / max(1, H - 1)
        r = round(top[0] + (bot[0] - top[0]) * t)
        g = round(top[1] + (bot[1] - top[1]) * t)
        b = round(top[2] + (bot[2] - top[2]) * t)
        for x in range(W):
            px[x, y] = (r, g, b)
    bg = bg.convert("RGBA")

    shadow = _card_shadow((cw, ch), radius, blur)
    positions = [margin, margin + cw + gap]
    for x0, card in zip(positions, (front, back)):
        pad = blur * 3
        bg.alpha_composite(shadow, (x0 - pad, margin - pad + round(2.2 * ppm)))
        bg.alpha_composite(card, (x0, margin))

    out = BytesIO()
    bg.convert("RGB").save(out, format="PNG", optimize=True)
    return out.getvalue()


# ── Paquete de imprenta (ZIP con todas las salidas) ─────────────────────────

_IMPRENTA_README = """CREDENCIAL PVC · ELECTRO GV — Archivos para imprenta
======================================================

Producto: tarjeta PVC rígida CR-80 vertical, 54 x 86 mm.
Todos los PDF están a tamaño final con 3 mm de sangrado por lado (60 x 92 mm).

Archivos incluidos
------------------
- front-print.pdf ........ Frente, full color, listo para imprimir.
- back-print.pdf ......... Dorso, full color, listo para imprimir.
- cut-guide.pdf .......... Guía de corte, zona segura y ranura del lanyard.
                           Color técnico magenta: NO imprimir, es referencia.
- spot-uv-mask.pdf ....... Máscara de barniz sectorizado (spot UV). Negro 100%
                           = donde va el barniz brillante (patrón "GV").
- emboss-deboss-mask.pdf . Máscara de relieve/bajo relieve del logo del dorso.
- mockup-preview.png ..... Previsualización realista (no imprimir).

Terminación buscada
--------------------
- PVC blanco rígido CR-80, impresión doble faz full color.
- Bordes redondeados y ranura superior horizontal para lanyard.
- Laminado mate o soft touch.
- Barniz sectorizado brillante sobre el patrón de marca de agua "GV".
- Logo grande del dorso en bajo relieve (o barniz con volumen si no hay relieve).

La idea: base mate con detalles brillantes/relieve para que no se vea plana.
"""


def build_credential_zip(cred: CredencialEmpleado) -> bytes:
    """Empaqueta todas las salidas de imprenta + el mockup en un ZIP."""
    files = {
        "front-print.pdf": render_front_pdf(cred),
        "back-print.pdf": render_back_pdf(cred),
        "cut-guide.pdf": render_cut_guide_pdf(),
        "spot-uv-mask.pdf": render_spot_uv_mask_pdf(cred),
        "emboss-deboss-mask.pdf": render_emboss_mask_pdf(),
        "mockup-preview.png": render_mockup_png(cred),
        "LEEME-imprenta.txt": _IMPRENTA_README.encode("utf-8"),
    }
    buf = BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, data in files.items():
            zf.writestr(name, data)
    return buf.getvalue()
