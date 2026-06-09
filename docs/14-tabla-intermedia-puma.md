# 14 — Tabla intermedia (outbox) Puma

> **Estado**: especificacion tecnica de la **Opcion E** definida en
> doc 13 §3.4.bis. Acuerdo arquitectonico tomado con Puma el
> 2026-06-09.
>
> **Audiencia**: dev backend (modelar + migracion), DBA Puma (que
> queries va a hacer), security (red + credenciales).
>
> **Fecha**: 2026-06-09 · **Version**: 0.1 — esqueleto inicial,
> falta confirmar decision polling vs LISTEN/NOTIFY con Puma.

---

## 0. Resumen ejecutivo

La integracion mobile ↔ Puma usa una **tabla outbox en el Postgres
de gvelectroapp** (`puma_outbox_prefacturas`). La app inserta
filas con la prefactura completa serializada en JSONB. Puma se
conecta como cliente **read-only + update parcial** a esa tabla y
crea las prefacturas en su sistema.

**Por que tabla intermedia y no API REST**:

- Puma no tiene que desarrollar endpoints HTTP nuevos.
- Yo no tengo que conocer su schema interno.
- Idempotencia natural via UNIQUE constraint.
- Recuperacion ante caidas trivial: las filas pendientes siguen
  ahi cuando vuelve cualquiera de los dos lados.
- Auditoria automatica via timestamps.

**Excepcion**: el lookup "Buscar AFIP" sigue siendo HTTP sincrono
(ver doc 13 §4.2). La outbox solo cubre el flujo asincrono de
creacion de prefacturas.

---

## 1. Schema de la tabla

### 1.1 DDL completo

```sql
-- Migracion Alembic propuesta: crear tabla `puma_outbox_prefacturas`.
-- Va en el schema `public` (el de la app).

CREATE TABLE puma_outbox_prefacturas (
    -- ─── Identidad ────────────────────────────────────────────────
    id              BIGSERIAL PRIMARY KEY,
    external_id     TEXT NOT NULL,
        -- Idempotency key. Formato: 'WEB-YYYY-NNNN' (ver doc 06).
        -- UNIQUE → si la app reintenta, no duplica.

    -- ─── Estado de procesamiento ──────────────────────────────────
    estado          TEXT NOT NULL DEFAULT 'pending',
        -- pending  : esperando que Puma la tome
        -- reading  : Puma la esta procesando (lock optimista)
        -- processed: Puma ya la cargo como prefactura interna
        -- error    : fallo el procesamiento (mirar last_error)
        -- cancelled: la app la cancelo antes de que Puma la tomara

    puma_prefactura_id TEXT,
        -- ID interno de Puma despues del procesamiento exitoso.
        -- Ej: 'PF-2026-256-9'. NULL hasta que Puma la procese.

    intento_count   INTEGER NOT NULL DEFAULT 0,
    last_error      TEXT,
    last_attempt_at TIMESTAMPTZ,
    processed_at    TIMESTAMPTZ,

    -- ─── Payload ──────────────────────────────────────────────────
    payload         JSONB NOT NULL,
        -- Prefactura completa. Estructura: ver §2.

    -- ─── Datos desnormalizados (para filtrar sin parsear JSON) ────
    branch_codigo       TEXT NOT NULL,
        -- Ej: 'CASEROS', 'NORCENTER', 'CANNING', 'LANUS'.

    vendedor_codigo     TEXT NOT NULL,
        -- Ej: '0011' (codigo Puma del vendedor).

    cliente_documento   TEXT NOT NULL,
        -- DNI o CUIT del cliente.

    cliente_codigo_puma TEXT,
        -- Codigo interno Puma (ej '00036'). NULL si es cliente
        -- nuevo no resuelto.

    monto_total         NUMERIC(14, 2) NOT NULL,

    -- ─── Auditoria ────────────────────────────────────────────────
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- ─── Constraints ──────────────────────────────────────────────
    CONSTRAINT ux_puma_outbox_external_id UNIQUE (external_id),
    CONSTRAINT ck_puma_outbox_estado CHECK (estado IN (
        'pending', 'reading', 'processed', 'error', 'cancelled'
    ))
);

-- ─── Indices ────────────────────────────────────────────────────
-- Para que Puma haga polling rapido:
CREATE INDEX ix_puma_outbox_estado_created
    ON puma_outbox_prefacturas (estado, created_at)
    WHERE estado IN ('pending', 'error');

-- Para filtros del dashboard interno:
CREATE INDEX ix_puma_outbox_branch
    ON puma_outbox_prefacturas (branch_codigo);

CREATE INDEX ix_puma_outbox_vendedor
    ON puma_outbox_prefacturas (vendedor_codigo);

CREATE INDEX ix_puma_outbox_processed_at
    ON puma_outbox_prefacturas (processed_at DESC)
    WHERE processed_at IS NOT NULL;

-- ─── Trigger updated_at ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_puma_outbox_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER puma_outbox_updated_at
    BEFORE UPDATE ON puma_outbox_prefacturas
    FOR EACH ROW
    EXECUTE FUNCTION trg_puma_outbox_updated_at();

COMMENT ON TABLE puma_outbox_prefacturas IS
    'Outbox de prefacturas creadas en mobile, consumidas por Puma. Ver doc 14.';
```

### 1.2 Estados — diagrama de transiciones

```
                  ┌──────────────────┐
        app crea  │                  │
        ─────────▶│     pending      │
                  └──────────────────┘
                           │
                           │ Puma SELECT + UPDATE estado='reading'
                           ▼
                  ┌──────────────────┐
                  │     reading      │
                  └──────────────────┘
                     │           │
            exito    │           │ falla
                     ▼           ▼
        ┌────────────────┐  ┌─────────────┐
        │   processed    │  │    error    │ ◀──┐
        │ (puma_id seteado)│  │ (last_error)│   │
        └────────────────┘  └─────────────┘   │ reintenta
                                  │           │ (Puma o admin)
                                  └───────────┘

      ┌──────────────────┐
      │ app antes de que │  app cancela
      │ Puma la tome     │ ─────────▶  cancelled
      └──────────────────┘
```

**Reglas**:

- `pending → reading`: lo hace Puma con un `UPDATE WHERE
  estado='pending' RETURNING *` (atomico).
- `reading → processed`: lo hace Puma cuando crea exitosamente la
  prefactura en su sistema. Setea `puma_prefactura_id`.
- `reading → error`: lo hace Puma si algo falla. Incrementa
  `intento_count` y guarda `last_error`. Despues de N intentos
  (ej. 5), queda como "error definitivo" hasta intervencion
  manual.
- `pending → cancelled`: lo hace la app si el vendedor anula la
  prefactura antes de que Puma la lea. Despues de `reading` ya no
  se puede cancelar — hay que pedirle a Puma que la anule.

---

## 2. Estructura del campo `payload` (JSONB)

```json
{
  "external_id": "WEB-2026-0001",
  "tipo": "prefactura",
  "branch_id": "norcenter",
  "vendedor": {
    "codigo": "0011",
    "nombre": "NAZARENO SANCHEZ ITUARTE"
  },
  "cliente": {
    "codigo_puma": "00036",
    "documento": "95499336",
    "tipo_documento": "DNI",
    "nombre": "GALEANO HERRERA, VICTOR JULIAN",
    "domicilio": "CURAPALIGUE 1891",
    "localidad": "CAPITAL FEDERAL",
    "cp": "1406",
    "iva_condition": "Consumidor Final",
    "telefono": null,
    "email": null
  },
  "items": [
    {
      "sku": "001192",
      "descripcion": "TV KANJI 65\" QLED 4K SMART WHALE.OS",
      "marca": "KANJI",
      "modelo": "KJ-65ST005-2QW",
      "deposito_origen": "4.NORCENTER",
      "cantidad": 1,
      "precio_unitario": "840000.00",
      "subtotal": "840000.00",
      "garantia_extendida_id": null,
      "garantia_meses": 0
    }
  ],
  "plan_credito": {
    "codigo": "CANCELAR_PARA_RETIRAR",
    "descripcion": "1 cuota de $ 840000",
    "cuotas": 1,
    "anticipo": "0.00",
    "neto_operacion": "840000.00",
    "primera_cuota_fecha": "2026-06-19"
  },
  "payment_breakdown": {
    "saldo_a_favor": "0.00",
    "efectivo": "840000.00",
    "tarjeta": "0.00",
    "cheque": "0.00",
    "deposito_transf": "0.00",
    "monedas_extranjeras": "0.00",
    "retenciones": "0.00",
    "otras_monedas": "0.00"
  },
  "entrega": "840000.00",
  "vuelto": "0.00",
  "sin_aplicar": "0.00",
  "delivery": {
    "tipo": "retira_cliente",
    "fecha": "2026-06-09",
    "turno": "manana",
    "blocked": false,
    "domicilio_entrega": null,
    "persona_retira": {
      "nombre": null,
      "documento": null,
      "telefono": null
    }
  },
  "observaciones": "",
  "metadata": {
    "app_version": "gvelectroapp@1.x",
    "device_id": "mobile-caseros-tablet-3",
    "created_at_local": "2026-06-09T15:32:11-03:00"
  }
}
```

El JSONB permite que Puma valide schema con jsonschema si quiere,
y permite que la app evolucione el formato agregando campos sin
romper compatibilidad.

---

## 3. Permisos Postgres

### 3.1 Usuario para Puma

```sql
-- Crear usuario read-only + update parcial para Puma.
-- Password en password manager compartido (no en git).

CREATE USER puma_reader WITH PASSWORD '<password_aleatoria_strong>';

-- Permisos basicos
GRANT CONNECT ON DATABASE electrogv TO puma_reader;
GRANT USAGE ON SCHEMA public TO puma_reader;

-- Puede leer toda la fila
GRANT SELECT ON puma_outbox_prefacturas TO puma_reader;

-- Pero solo puede actualizar columnas de estado, NO el payload
-- ni los datos del cliente.
GRANT UPDATE (
    estado,
    puma_prefactura_id,
    intento_count,
    last_error,
    last_attempt_at,
    processed_at
) ON puma_outbox_prefacturas TO puma_reader;

-- Puma NO tiene INSERT ni DELETE. Solo SELECT + UPDATE acotado.

-- Default privileges: que objetos futuros del schema NO se le
-- otorguen automaticamente al usuario.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    REVOKE ALL ON TABLES FROM puma_reader;
```

### 3.2 Aislamiento

- Puma **NO ve** ningun otro objeto del schema `public` (no le
  damos GRANT en nada mas).
- Si en el futuro queremos exponer otra tabla (ej. catalogo de
  productos), se hace explicito por GRANT individual.
- El usuario `electrogv` (el de la app) sigue siendo el unico con
  full access.

---

## 4. Como Puma "sabe" que hay algo nuevo

Tres opciones. **Por decidir con Puma**.

### 4.1 Opcion A — Polling (recomendado para empezar)

Puma corre un job (cron o servicio Windows) que cada N segundos
hace:

```sql
-- Toma hasta 10 filas pendientes y las marca como reading.
-- Patron clasico "SELECT FOR UPDATE SKIP LOCKED" para evitar
-- que dos workers de Puma agarren la misma.
UPDATE puma_outbox_prefacturas
SET estado = 'reading',
    last_attempt_at = NOW(),
    intento_count = intento_count + 1
WHERE id IN (
    SELECT id
    FROM puma_outbox_prefacturas
    WHERE estado = 'pending'
       OR (estado = 'error' AND intento_count < 5)
    ORDER BY created_at
    LIMIT 10
    FOR UPDATE SKIP LOCKED
)
RETURNING *;
```

**Pros**: simple, robusto, no requiere proceso permanente.
**Cons**: latencia entre 1-N segundos. Si N=10s, el cliente espera
hasta 10s de mas.

### 4.2 Opcion B — LISTEN/NOTIFY

La app dispara `NOTIFY puma_outbox` despues de insertar. Puma
tiene un proceso permanente que hace `LISTEN puma_outbox` y
reacciona en milisegundos.

```sql
-- En la app, al insertar:
NOTIFY puma_outbox_new_prefactura, 'WEB-2026-0001';

-- En Puma:
LISTEN puma_outbox_new_prefactura;
-- (en su lenguaje, sea PHP/PB/C#, recibe el callback)
```

**Pros**: latencia ms.
**Cons**: Puma necesita un proceso permanente conectado. Si se
cae, hay que volver a hacer polling como backup.

### 4.3 Opcion C — Polling + NOTIFY como "kick"

Hibrido: el polling base corre cada 30s como red de seguridad, y
NOTIFY dispara una iteracion inmediata cuando hay algo nuevo.

**Recomendado** si la latencia importa. Mas robusto.

---

## 5. Devolucion de estado (Puma → app)

Cuando Puma procesa una prefactura, actualiza:

```sql
UPDATE puma_outbox_prefacturas
SET estado = 'processed',
    puma_prefactura_id = 'PF-2026-256-9',
    processed_at = NOW(),
    last_error = NULL
WHERE id = $1
  AND estado = 'reading';
```

La app **detecta el cambio** de dos formas posibles:

1. **Polling propio** (recomendado): un job en el backend cada 30s
   busca filas que pasaron a `processed` o `error` y notifica al
   vendedor via push / badge / mail.
2. **LISTEN/NOTIFY inverso**: Puma dispara
   `NOTIFY app_outbox_processed, 'WEB-2026-0001'` despues del
   UPDATE. La app escucha y reacciona.

### Si Puma necesita devolver mas datos

Si en el futuro Puma necesita devolver no solo el ID sino tambien
el numero de factura emitida, el CAE, el PDF, etc., **se extiende
la misma tabla** con columnas:

- `puma_factura_numero` TEXT
- `puma_factura_cae` TEXT
- `puma_factura_pdf_url` TEXT

Y se le da GRANT UPDATE sobre esas tambien. NO se necesita una
tabla aparte.

---

## 6. Red y seguridad

### 6.1 Como se conecta Puma

Puma corre en sucursales / PCs de cajeros. **NO debe acceder por
Internet abierto** al Postgres de la app. Opciones:

- **LAN compartida** si todo esta en la misma red fisica (ideal
  para la sucursal sede).
- **VPN site-to-site** entre la red de Puma y mi servidor (ideal
  para multi-sucursal).
- **Tunel SSH** si es un caso puntual.

**Nunca** abrir el puerto 5432/5433 a Internet.

### 6.2 Rotacion de credenciales

- Password de `puma_reader` cambia cada 90 dias.
- Vault compartido (1Password / Bitwarden empresarial).
- Si la password se compromete, `REVOKE` instantaneo + nueva
  creacion.

### 6.3 Auditoria de queries

Habilitar `pg_stat_statements` para ver que queries hace Puma:

```sql
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- Ver las queries top de puma_reader
SELECT query, calls, mean_exec_time
FROM pg_stat_statements
WHERE userid = (SELECT oid FROM pg_roles WHERE rolname='puma_reader')
ORDER BY mean_exec_time DESC
LIMIT 20;
```

---

## 7. Dashboard interno de la outbox

Pantalla nueva en la app (admin only) para monitorear la outbox:

```
┌─────────────────────────────────────────────────┐
│ Outbox Puma                                     │
│ ─────────────────────────────────────────────── │
│                                                 │
│  Pending          │  Reading  │ Processed (24h) │
│      12           │     2     │      87         │
│                                                 │
│  Error    ⚠️ 3                                  │
│  ────────────────────────────                   │
│                                                 │
│  Ultimas 20 filas:                              │
│  ┌──────────┬──────┬──────────┬──────────────┐ │
│  │ external │estado│ vendedor │  created     │ │
│  ├──────────┼──────┼──────────┼──────────────┤ │
│  │WEB-...07 │proce │ NAZARENO │ hace 2 min   │ │
│  │WEB-...06 │error │ JUAN G.  │ hace 5 min ⚠ │ │
│  │WEB-...05 │proce │ NAZARENO │ hace 8 min   │ │
│  └──────────┴──────┴──────────┴──────────────┘ │
│                                                 │
│  [Reintentar errors] [Ver detalle]              │
└─────────────────────────────────────────────────┘
```

Endpoint backend: `GET /api/admin/puma-outbox/stats` y
`GET /api/admin/puma-outbox/items?estado=...`.

Permiso requerido: `ops_config.view` o nuevo
`puma_outbox.monitor`.

---

## 8. Migracion Alembic — esqueleto

```python
"""puma_outbox_prefacturas

Revision ID: <auto>
Revises: <prev>
Create Date: 2026-06-xx

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


def upgrade():
    op.create_table(
        "puma_outbox_prefacturas",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("external_id", sa.Text, nullable=False),
        sa.Column("estado", sa.Text, nullable=False, server_default="pending"),
        sa.Column("puma_prefactura_id", sa.Text, nullable=True),
        sa.Column("intento_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("last_error", sa.Text, nullable=True),
        sa.Column("last_attempt_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("processed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("payload", postgresql.JSONB, nullable=False),
        sa.Column("branch_codigo", sa.Text, nullable=False),
        sa.Column("vendedor_codigo", sa.Text, nullable=False),
        sa.Column("cliente_documento", sa.Text, nullable=False),
        sa.Column("cliente_codigo_puma", sa.Text, nullable=True),
        sa.Column("monto_total", sa.Numeric(14, 2), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("external_id", name="ux_puma_outbox_external_id"),
        sa.CheckConstraint(
            "estado IN ('pending','reading','processed','error','cancelled')",
            name="ck_puma_outbox_estado",
        ),
    )
    op.create_index(
        "ix_puma_outbox_estado_created",
        "puma_outbox_prefacturas",
        ["estado", "created_at"],
        postgresql_where=sa.text("estado IN ('pending', 'error')"),
    )
    op.create_index("ix_puma_outbox_branch", "puma_outbox_prefacturas", ["branch_codigo"])
    op.create_index("ix_puma_outbox_vendedor", "puma_outbox_prefacturas", ["vendedor_codigo"])
    op.create_index(
        "ix_puma_outbox_processed_at",
        "puma_outbox_prefacturas",
        [sa.text("processed_at DESC")],
        postgresql_where=sa.text("processed_at IS NOT NULL"),
    )
    op.execute(
        """
        CREATE OR REPLACE FUNCTION trg_puma_outbox_updated_at()
        RETURNS TRIGGER AS $$
        BEGIN
            NEW.updated_at = NOW();
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.execute(
        """
        CREATE TRIGGER puma_outbox_updated_at
            BEFORE UPDATE ON puma_outbox_prefacturas
            FOR EACH ROW
            EXECUTE FUNCTION trg_puma_outbox_updated_at();
        """
    )


def downgrade():
    op.execute("DROP TRIGGER IF EXISTS puma_outbox_updated_at ON puma_outbox_prefacturas")
    op.execute("DROP FUNCTION IF EXISTS trg_puma_outbox_updated_at()")
    op.drop_index("ix_puma_outbox_processed_at", table_name="puma_outbox_prefacturas")
    op.drop_index("ix_puma_outbox_vendedor", table_name="puma_outbox_prefacturas")
    op.drop_index("ix_puma_outbox_branch", table_name="puma_outbox_prefacturas")
    op.drop_index("ix_puma_outbox_estado_created", table_name="puma_outbox_prefacturas")
    op.drop_table("puma_outbox_prefacturas")
```

---

## 9. Modelo SQLAlchemy

```python
# backend/app/models/puma_outbox.py
from __future__ import annotations
from datetime import datetime
from typing import Optional, Any

from sqlalchemy import BigInteger, CheckConstraint, DateTime, Integer, Numeric, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, utcnow


class PumaOutboxPrefactura(Base):
    """Outbox de prefacturas creadas en mobile, consumidas por Puma.

    Ver doc 14 para spec completa.
    """
    __tablename__ = "puma_outbox_prefacturas"
    __table_args__ = (
        UniqueConstraint("external_id", name="ux_puma_outbox_external_id"),
        CheckConstraint(
            "estado IN ('pending','reading','processed','error','cancelled')",
            name="ck_puma_outbox_estado",
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    external_id: Mapped[str] = mapped_column(Text, nullable=False)

    estado: Mapped[str] = mapped_column(Text, nullable=False, default="pending", index=True)
    puma_prefactura_id: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    intento_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    last_attempt_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    processed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)

    branch_codigo: Mapped[str] = mapped_column(Text, nullable=False, index=True)
    vendedor_codigo: Mapped[str] = mapped_column(Text, nullable=False, index=True)
    cliente_documento: Mapped[str] = mapped_column(Text, nullable=False)
    cliente_codigo_puma: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    monto_total: Mapped[Numeric] = mapped_column(Numeric(14, 2), nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)
```

---

## 10. Acuerdos a cerrar con Puma

- [ ] Confirmar modelo polling vs LISTEN/NOTIFY (§4).
- [ ] Acordar password rotation + vault compartido.
- [ ] Acordar canal de red (VPN site-to-site? LAN? IP whitelist?).
- [ ] Acordar timing del polling (cada cuanto, ventana horaria).
- [ ] Acordar SLA: si Puma esta caido, ¿en cuanto se recupera?
- [ ] Acordar que pasa si una prefactura queda en `error` muchos
      reintentos — quien la mira y resuelve.
- [ ] Acordar formato del `puma_prefactura_id` (string libre o
      formato definido).
- [ ] Acordar si en el futuro Puma devuelve numero de factura +
      CAE + PDF en la misma tabla o aparte.

---

## 11. Referencias

- `docs/13-integracion-mobile-puma.md` — guia tecnica de la
  integracion. §3.4.bis explica la decision Opcion E.
- `docs/06-integracion-erp-ventas.md` — contrato API REST
  inicial (queda como referencia historica del modelo Opcion B).
- `backend/app/models/sales_web.py` — modelo SalesWebRequest que
  alimenta el payload de la outbox.
- `infra/pgadmin/servers.json` — conexiones precargadas para
  inspeccionar la outbox en pgAdmin.
