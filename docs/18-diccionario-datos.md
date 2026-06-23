# 18 — Diccionario de datos detallado (ElectroGV)

> **Fuente de verdad:** los modelos SQLAlchemy en `backend/app/models/*.py`.
> Complementa a [`17-modelo-datos-mer.md`](17-modelo-datos-mer.md) (visión MER +
> normalización) con el **detalle campo por campo** de cada tabla y un **diagrama
> ER en SVG por dominio**. Si cambia un modelo, actualizar acá.

**Cómo leer las tablas:** `Null` = la columna admite NULL · `Default` = valor por
defecto · `Clave` = PK / FK→destino (política ON DELETE) / UNIQUE / IDX (índice).
Tipos: `bigint`, `text`, `bool`, `int`, `numeric(14,2)`, `date`, `timestamptz`,
`jsonb`, `float`. Todas las tablas con `id bigint` lo tienen como PK autoincrement
salvo que se indique otra cosa.

**Estado de este documento (por tandas):** ✅ Dominios 1–4 · ⏳ 5–12 en preparación.

Índice de dominios: 1 Organización & Acceso · 2 RRHH · 3 Garantías · 4 Remitos ·
5 Ventas Web · 6 Productos · 7 Catálogo Maestro · 8 Sales BI operativo ·
9 Sales BI comercial · 10 PSI · 11 Precios & Anuncios · 12 Sistema.

---

## Dominio 1 — Organización & Acceso

![MER Organización y Acceso](diagramas/01-organizacion-acceso.svg)

### companies
| Columna | Tipo | Null | Default | Clave | Descripción |
|---|---|---|---|---|---|
| id | text | no | — | **PK** | Slug legible (`electro_gv`). |
| name | text | no | — | | Nombre comercial. |
| legal_name | text | no | `''` | | Razón social. |
| cuit | text | no | `''` | | CUIT. |
| is_active | bool | no | `true` | | Activa. |
| created_at / updated_at | timestamptz | no | `now()` | | Auditoría. |

### branches
| Columna | Tipo | Null | Default | Clave | Descripción |
|---|---|---|---|---|---|
| id | text | no | — | **PK** | Slug (`caseros`). |
| company_id | text | no | — | FK→companies (RESTRICT), IDX | Empresa dueña. |
| name | text | no | — | | Nombre. |
| code | text | no | — | UNIQUE | Código corto. |
| type | text | no | `physical` | IDX | `physical|web|deposit|admin`. |
| parent_branch_id | text | sí | — | FK→branches (SET NULL), IDX | Sucursal padre (auto-ref). |
| direccion | text | no | `''` | | Dirección física. |
| direccion_fiscal | text | no | `''` | | Dirección de facturación. |
| is_active | bool | no | `true` | | Activa. |
| created_at / updated_at | timestamptz | no | `now()` | | Auditoría. |

### users
| Columna | Tipo | Null | Default | Clave | Descripción |
|---|---|---|---|---|---|
| id | bigint | no | auto | **PK** | |
| username | text | no | — | UNIQUE | Login. |
| display_name | text | no | — | | Nombre visible. |
| password_hash | text | no | `''` | | Hash. |
| is_active | bool | no | `true` | | Habilitado. |
| must_change_password | bool | no | `false` | | Forzar cambio. |
| created_at / updated_at | timestamptz | no | `now()` | | Auditoría. |

### role_groups *(departamentos)*
| Columna | Tipo | Null | Default | Clave | Descripción |
|---|---|---|---|---|---|
| id | bigint | no | auto | **PK** | |
| name | text | no | — | UNIQUE | Clave (`ADMINISTRACION`). |
| label | text | no | — | | Visible (`Administración`). |
| sort_order | int | no | `0` | | Orden de muestra. |
| created_at / updated_at | timestamptz | no | `now()` | | Auditoría. |

### roles
| Columna | Tipo | Null | Default | Clave | Descripción |
|---|---|---|---|---|---|
| id | bigint | no | auto | **PK** | |
| name | text | no | — | UNIQUE | Clave del rol. |
| label | text | no | — | | Visible. |
| level | int | no | `0` | | Jerarquía. |
| group_id | bigint | sí | — | FK→role_groups (SET NULL), IDX | Departamento. |
| permissions | jsonb | no | `[]` | | Lista de claves de permiso activas (catálogo en `permissions.py`). |
| created_at / updated_at | timestamptz | no | `now()` | | Auditoría. |

### user_roles *(N–N usuario ↔ rol)*
| Columna | Tipo | Null | Default | Clave | Descripción |
|---|---|---|---|---|---|
| id | bigint | no | auto | **PK** | |
| user_id | bigint | no | — | FK→users (CASCADE), IDX | |
| role_id | bigint | no | — | FK→roles (RESTRICT), IDX | |
| is_primary | bool | no | `false` | | Rol principal. |
| created_at | timestamptz | no | `now()` | | |
| | | | | **UNIQUE(user_id, role_id)** | |

### user_branches *(N–N = alcance operativo)*
| Columna | Tipo | Null | Default | Clave | Descripción |
|---|---|---|---|---|---|
| id | bigint | no | auto | **PK** | |
| user_id | bigint | no | — | FK→users (CASCADE), IDX | |
| branch_id | text | no | — | FK→branches (CASCADE), IDX | |
| is_primary | bool | no | `false` | | Sucursal principal. |
| created_at | timestamptz | no | `now()` | | |
| | | | | **UNIQUE(user_id, branch_id)** | |

---

## Dominio 2 — RRHH

![MER RRHH](diagramas/02-rrhh.svg)

### employees
| Columna | Tipo | Null | Default | Clave | Descripción |
|---|---|---|---|---|---|
| id | bigint | no | auto | **PK** | |
| dni | text | sí | — | UNIQUE | DNI. |
| user_id | bigint | sí | — | FK→users (SET NULL), **UNIQUE**, IDX | Vínculo 1:1 con usuario. |
| first_name / last_name / display_name | text | no | `''` | | Identidad. |
| birthdate | date | sí | — | | |
| gender / civil_status | text | no | `''` | | |
| company_id | text | sí | — | FK→companies (RESTRICT), IDX | |
| branch_id | text | sí | — | FK→branches (RESTRICT), IDX | Sucursal asignada. |
| work_branch_id | text | sí | — | FK→branches (RESTRICT), IDX | Sucursal donde trabaja. |
| manager_id | bigint | sí | — | FK→employees (SET NULL), IDX | Jefe (auto-ref). |
| position / department / contract_type | text | no | `''` | | |
| hire_date | date | sí | — | | Alta. |
| phone / personal_email / address | text | no | `''` | | Contacto. |
| photo_url | text | no | `''` | | |
| photo_status | text | no | `sin_foto` | | `sin_foto|pendiente_aprobacion|solicitada_nuevamente|aprobada|rechazada`. |
| photo_uploaded_at | timestamptz | sí | — | | |
| status | text | no | `alta` | IDX | `alta|licencia|baja`. |
| created_at / updated_at | timestamptz | no | `now()` | | |

### employee_status_history
| Columna | Tipo | Null | Default | Clave | Descripción |
|---|---|---|---|---|---|
| id | bigint | no | auto | **PK** | |
| employee_id | bigint | no | — | FK→employees (CASCADE), IDX | |
| status / previous_status | text | no | `''`* | | *status NOT NULL sin default. |
| motivo / categoria | text | no | `''` | | |
| fecha_desde / fecha_hasta | date | sí | — | | |
| observaciones | text | no | `''` | | |
| actor_user_id | bigint | sí | — | FK→users (SET NULL) | Quién lo cambió. |
| created_at | timestamptz | no | `now()` | | |

### payroll_receipts
| Columna | Tipo | Null | Default | Clave | Descripción |
|---|---|---|---|---|---|
| id | bigint | no | auto | **PK** | |
| employee_id | bigint | no | — | FK→employees (RESTRICT), IDX | |
| period_year / period_month | int | no | — | | Período. |
| receipt_type | text | no | `mensual` | | |
| file_path / file_name | text | no | — | | Archivo. |
| file_content_type / file_hash | text | no | `''` | | |
| file_size | bigint | no | `0` | | |
| status | text | no | `pendiente` | IDX | `pendiente|firmado|observado|anulado`. |
| uploaded_by / viewed_by / signed_by / cancelled_by _user_id | bigint | sí | — | FK→users (SET NULL) | Actores. |
| viewed_at / signed_at / observed_at / cancelled_at | timestamptz | sí | — | | |
| cancel_reason | text | no | `''` | | |
| replaced_by_receipt_id | bigint | sí | — | FK→payroll_receipts (SET NULL) | Versión que lo reemplaza (auto-ref). |
| created_at / updated_at | timestamptz | no | `now()` | | |

### payroll_receipt_observations
| Columna | Tipo | Null | Default | Clave | Descripción |
|---|---|---|---|---|---|
| id | bigint | no | auto | **PK** | |
| receipt_id | bigint | no | — | FK→payroll_receipts (CASCADE), IDX | |
| employee_id | bigint | sí | — | FK→employees (SET NULL), IDX | |
| message | text | no | — | | Observación. |
| status | text | no | `abierta` | IDX | `abierta|respondida`. |
| answered_at | timestamptz | sí | — | | |
| answered_by_user_id | bigint | sí | — | FK→users (SET NULL) | |
| answer_message | text | no | `''` | | Respuesta de RRHH. |
| created_at | timestamptz | no | `now()` | | |

---

## Dominio 3 — Garantías

![MER Garantías](diagramas/03-garantias.svg)

### guarantees *(cabecera; ~80 columnas, agrupadas por sección)*
| Sección | Columnas (tipo) | Notas |
|---|---|---|
| Identidad | id `bigint` **PK** · warranty_code `text` **UNIQUE** · parent_id `bigint` FK→guarantees (SET NULL, auto-ref) · parent_item_index `int` | Agrupación madre/hijo. |
| Organización | company_id `text` **FK→companies (RESTRICT, NOT NULL)** · branch_id / sucursal_responsable_id `text` FK→branches (RESTRICT) · sucursal · sucursal_code (IDX) · deposito · lugar_llegada `text` | Los `*_id` son canónicos; los textos son legacy de display. |
| Estado/flujo | status (`1 - INGRESO`) · review_status (`pendiente_revision`) · tipo_ingreso · origen_ingreso · ubicacion_actual · transit_status `text` (varios IDX) | Validados en la app, no ENUM. |
| Revisión | reviewed_by / review_started_by / correction_requested_by / correction_resubmitted_by `_user_id` FK→users (SET NULL) + sus `*_at timestamptz` · review_note `text` | |
| Responsable | responsible_user_id · created_by_user_id · updated_by_user_id FK→users (SET NULL) | |
| Fechas | ingreso_at (IDX) · created_at · updated_at (IDX) `timestamptz` | |
| Cliente | cliente_nombre · cliente_telefono · cliente_email · numero_factura `text` · fecha_compra `date` | Opcionales. |
| Proveedor | provider_name (IDX) · provider_case_id · provider_response_type (`retiro|revision|correccion`) · provider_correction_note `text` · sent_to_provider_at / last_provider_response_at / last_claim_at / … `timestamptz` | |
| Retiro/logística | estado_retiro_proveedor (`sin_solicitud`) · remito_proveedor · remito_interno · lugar_salida_transito `text` · varias fechas `timestamptz` | |
| Carga histórica | carga_historica `bool` (IDX) | Migración pre-sistema; fechas editables con `warranties.edit_dates`. |
| Resolución | resultado_resolucion · resolution_note · numero_nota_credito · producto_reemplazo · sku_reemplazo `text` · importe_nota_credito `numeric(14,2)` · fecha_resolucion/fecha_nota_credito/… `date/timestamptz` | |
| Export ENV | shipment_code (IDX) · shipment_file_name `text` | Lote al proveedor. |
| Observaciones | observations · photos_reference `text` | |
| Cancelación | cancelled `bool` (IDX) · cancel_reason `text` · cancelled_by_user_id FK→users (SET NULL) · cancelled_at `timestamptz` | |
| Google Sheets | synced_to_google_sheet `bool` · google_sheet_row_id `text` · last_google_sync_at `timestamptz` · sync_error `text` | Mirror al Sheet. |

### guarantee_items
| Columna | Tipo | Null | Default | Clave | Descripción |
|---|---|---|---|---|---|
| id | bigint | no | auto | **PK** | |
| guarantee_id | bigint | no | — | FK→guarantees (CASCADE), IDX | |
| item_index | int | no | `1` | | Orden. |
| producto / tipo / serie / falla / observaciones / correction_note | text | no | `''` | | |
| sku / marca | text | no | `''` | IDX | |
| created_at / updated_at | timestamptz | no | `now()` | | |

### guarantee_history
| Columna | Tipo | Null | Default | Clave | Descripción |
|---|---|---|---|---|---|
| id | bigint | no | auto | **PK** | |
| guarantee_id | bigint | no | — | FK→guarantees (CASCADE), IDX | |
| warranty_code | text | no | `''` | IDX | Redundante (snapshot). |
| action | text | no | — | | Evento. |
| old_status / new_status / field_name / old_value / new_value / note | text | no | `''` | | |
| details | jsonb | no | `{}` | | Detalle del evento. |
| actor_user_id | bigint | sí | — | FK→users (SET NULL) | |
| created_at | timestamptz | no | `now()` | IDX | |

### guarantee_counters *(numeración)*
| Columna | Tipo | Null | Default | Clave | Descripción |
|---|---|---|---|---|---|
| year | int | no | — | **PK (compuesta)** | |
| sucursal_code | text | no | — | **PK (compuesta)** | |
| last_number | int | no | `0` | | Último número. Avance con `SELECT … FOR UPDATE`. |
| updated_at | timestamptz | no | `now()` | | |

### guarantee_exports
| Columna | Tipo | Null | Default | Clave | Descripción |
|---|---|---|---|---|---|
| id | bigint | no | auto | **PK** | |
| created_by_user_id | bigint | sí | — | FK→users (SET NULL) | |
| provider_name | text | no | `''` | IDX | |
| marca | text | no | `''` | | |
| warranty_ids | jsonb | no | `[]` | | Lista de warranty_codes del lote (denormalizado a propósito). |
| filters | jsonb | no | `{}` | | Filtros usados. |
| file_path / file_name | text | no | — | | |
| file_format (`excel`) · logo_brand · shipment_code · punto_retiro · tipo_retiro · respuesta_proveedor_pickup | text | no | varios | | Metadatos de export/retiro. |
| row_count | int | no | `0` | | |
| fecha_retiro_acordada | timestamptz | sí | — | | |
| pickup_alert_sent | bool | no | `false` | | |
| created_at | timestamptz | no | `now()` | IDX | |

### guarantee_sync_logs
| Columna | Tipo | Null | Default | Clave | Descripción |
|---|---|---|---|---|---|
| id | bigint | no | auto | **PK** | |
| sync_type | text | no | — | IDX | |
| status | text | no | — | | |
| actor_user_id | bigint | sí | — | FK→users (SET NULL) | |
| started_at | timestamptz | no | — | IDX | |
| finished_at | timestamptz | sí | — | | |
| rows_processed / rows_created / rows_updated / rows_skipped | int | no | `0` | | |
| errors | jsonb | no | `[]` | | |

---

## Dominio 4 — Remitos

![MER Remitos](diagramas/04-remitos.svg)

### remitos
| Columna | Tipo | Null | Default | Clave | Descripción |
|---|---|---|---|---|---|
| id | bigint | no | auto | **PK** | |
| remito_code | text | no | — | UNIQUE | |
| shipment_code | text | no | `''` | IDX | |
| tipo_remito | text | no | `sucursal_a_deposito` | IDX | `sucursal_a_deposito|deposito_a_deposito|deposito_a_proveedor`. |
| company_brand | text | no | `gv_electro` | | |
| origen_branch_id / destino_branch_id | text | sí | — | FK→branches (RESTRICT), IDX | Origen/destino. |
| origen_sucursal / destino_deposito | text | no | `''` | | Legacy de display. |
| proveedor | text | no | `''` | | Para remito a proveedor. |
| status | text | no | `pendiente` | IDX | `pendiente|en_transito|recibido|anulado`. |
| nota / pdf_path | text | no | `''` | | |
| created_by / despachado_por / recibido_por `_user_id` | bigint | sí | — | FK→users (SET NULL) | Workflow. |
| created_at (IDX) / fecha_despacho / fecha_llegada | timestamptz | — | `now()`/— | | |

### remito_items *(N–N remito ↔ garantía)*
| Columna | Tipo | Null | Default | Clave | Descripción |
|---|---|---|---|---|---|
| id | bigint | no | auto | **PK** | |
| remito_id | bigint | no | — | FK→remitos (CASCADE), IDX | |
| guarantee_id | bigint | no | — | FK→guarantees (RESTRICT), IDX | |
| created_at | timestamptz | no | `now()` | | |
| | | | | **UNIQUE(remito_id, guarantee_id)** | Normaliza el viejo `warranty_ids_json`. |
