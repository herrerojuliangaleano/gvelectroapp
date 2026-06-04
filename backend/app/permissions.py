from __future__ import annotations

ALL_PERMISSIONS: dict[str, str] = {
    "dashboard.view": "Ver centro de control",
    "profile.view": "Ver Mi usuario",
    "about.view": "Ver Acerca del sistema",
    "system.status.view": "Ver estado del sistema",
    "system.manage": "Cambiar modo abierto/cerrado/mantenimiento",
    "system.diagnostics.view": "Ver diagnóstico operativo",
    "system.diagnostics.repair": "Ejecutar reparaciones operativas",

    "warranties.view": "Ver Garantías",
    "warranties.create": "Cargar garantías",
    "warranties.dashboard": "Ver dashboard de garantías",
    "warranties.manage": "Gestionar garantías",
    "warranties.review": "Ver bandeja de revisión de garantías",
    "warranties.mark_incomplete": "Marcar garantías para corrección",
    "warranties.approve_review": "Aprobar revisión de garantías",
    "warranties.manage_provider": "Gestionar garantías con proveedor",
    "warranties.change_status": "Cambiar estados de gestión de garantías",
    "warranties.register_provider_response": "Registrar respuestas de proveedor",
    "warranties.register_claim": "Registrar reclamos a proveedor",
    "warranties.export": "Exportar garantías a Excel",
    "warranties.sync_to_sheet": "Actualizar Google Sheet de garantías",
    "warranties.sync_from_sheet": "Actualizar garantías desde Google Sheet",
    "warranties.sync_logs": "Ver sincronización de garantías",
    "warranties.config": "Configurar flujo de garantías",
    "warranties.reset_data": "Resetear datos de prueba de garantías",
    "warranties.cancel": "Anular garantías",
    "warranties.delete": "Eliminar garantías definitivamente",
    "warranties.update": "Cambiar estado/depósito/observaciones de garantías",
    "warranties.counters": "Ver y resincronizar contadores de garantías",
    "warranties.remitos.view": "Ver remitos internos de garantías",
    "warranties.remitos.generate": "Generar y gestionar remitos (lotes y retiros)",
    "warranties.remitos.dispatch": "Despachar remitos (marcar en tránsito)",
    "warranties.remitos.receive": "Confirmar llegada de remitos al depósito",
    "warranties.remitos.deposit_transfer": "Mover garantías entre depósitos",
    "warranties.remitos.provider_delivery": "Generar remito de entrega a proveedor",
    "warranties.remitos.delete": "Eliminar remitos internos",
    "warranties.gestor.panel": "Ver panel interno del Gestor de Garantías",
    "warranties.sucursal.logistics": "Ver bandeja logística de mi sucursal",

    "budgets.view": "Ver Presupuestos",
    "budgets.create": "Crear presupuestos",
    "budgets.save": "Guardar presupuestos",
    "budgets.manage": "Gestionar presupuestos",
    "budgets.price_override": "Modificar precios en presupuestos",

    "products.view": "Ver catálogo de productos",
    "products.sync": "Sincronizar productos desde Planilla Madre",
    "products.manage": "Administrar catálogo de productos",
    "products.providers.manage": "Administrar proveedores y marcas",

    "sales_web.view": "Ver ventas",
    "sales_web.create": "Crear ventas",
    "sales_web.take": "Tomar ventas",
    "sales_web.complete": "Completar ventas",
    "sales_web.send": "Enviar ventas al vendedor",
    "sales_web.cancel": "Cancelar ventas",
    "sales_web.cancel_own": "Cancelar ventas propias",
    "sales_web.branch_manage": "Gestionar ventas de su sucursal",
    "sales_web.manage": "Gestionar todas las ventas",
    "sales_web.delete": "Eliminar ventas",
    "notifications.view": "Ver notificaciones",
    "notifications.manage": "Gestionar notificaciones internas",
    "push.subscribe": "Activar notificaciones del navegador",

    "price_updates.view": "Ver actualizaciones urgentes de precios",
    "price_updates.create": "Crear actualizaciones urgentes de precios",
    "price_updates.check": "Marcar checks de precios actualizados",
    "price_updates.check.web": "Marcar checks web de precios",
    "price_updates.check.puma": "Marcar check Puma de precios",
    "price_updates.check.master": "Marcar check Planilla Madre de precios",
    "price_updates.edit": "Editar actualizaciones de precios",
    "price_updates.delete": "Cancelar actualizaciones de precios",
    "cost_updates.view": "Ver actualizaciones urgentes de costos",
    "cost_updates.create": "Crear actualizaciones urgentes de costos",
    "cost_updates.check": "Marcar checks de costos actualizados",
    "cost_updates.check.puma": "Marcar check Puma de costos",
    "cost_updates.check.master": "Marcar check Planilla Madre de costos",
    "cost_updates.edit": "Editar actualizaciones de costos",
    "cost_updates.delete": "Cancelar actualizaciones de costos",
    "price_announcements.view": "Ver anuncios comerciales de precios",
    "price_announcements.generate": "Generar imagenes de anuncios de precios",

    "tools.view": "Ver herramientas internas",
    "tools.run.gpd": "Ejecutar Generar Planillas Diarias",
    "tools.run.cc": "Ejecutar Congelar Carpeta",
    "tools.run.cf": "Ejecutar Comprobar Facturas",
    "tools.run.cer": "Ejecutar Limpiar Comprobantes",
    "tools.run.eb": "Ejecutar Limpiar Extractos Bancarios",
    "tools.run.gg": "Ejecutar Generar GFK",
    "tools.run.ncm": "Ejecutar Normalizar Carpeta Mensual",
    "tools.run.ncmc": "Ejecutar Normalizar Carpeta Mensual con Cantidades",
    "tools.run.nvsc": "Ejecutar Normalizar Ventas VS Costos",
    "tools.run.vsc": "Ejecutar Ventas VS Costos",

    "jobs.view": "Ver historial de ejecuciones",
    "jobs.cancel": "Cancelar ejecuciones",
    "settings.view": "Ver configuración técnica",
    "ops_config.view": "Ver configuración operativa",
    "ops_config.manage": "Modificar configuración operativa",

    # Módulo Comercial · PSI (Planificación de Ventas e Inventario)
    "psi.view":   "Ver módulo PSI (Planificación de Ventas e Inventario)",
    "psi.adjust": "Crear y revertir ajustes manuales en PSI",
    "psi.export": "Exportar reportes PSI a PDF",
    "companies.view": "Ver empresas",
    "companies.manage": "Crear y modificar empresas",
    "branches.view": "Ver sucursales operativas",
    "branches.manage": "Crear y modificar sucursales operativas",
    "branches.cross_select": "Seleccionar/operar sucursales fuera de las asignadas (multi-sucursal)",
    "google.manage": "Gestionar conexión Google OAuth",
    "users.view": "Ver usuarios",
    "users.manage": "Crear y modificar usuarios",
    "users.assign_roles": "Asignar múltiples roles a usuarios",
    "employees.view": "Ver empleados",
    "employees.manage": "Crear y modificar empleados",
    "employees.photo.upload_own": "Subir foto profesional propia",
    "employees.photo.request": "Solicitar foto profesional",
    "employees.photo.approve": "Aprobar foto profesional",
    "employees.photo.reject": "Rechazar foto profesional",
    "payroll_receipts.view_own": "Ver mis recibos de sueldo",
    "payroll_receipts.sign_own": "Firmar conformidad de mis recibos",
    "payroll_receipts.observe_own": "Observar mis recibos",
    "payroll_receipts.view_all": "Ver recibos de todos los empleados",
    "payroll_receipts.upload": "Subir recibos de sueldo",
    "payroll_receipts.bulk_upload": "Carga masiva de recibos por DNI",
    "payroll_receipts.cancel": "Anular recibos de sueldo",
    "payroll_receipts.respond_observation": "Responder observaciones de recibos",
    "roles.view": "Ver roles",
    "roles.manage": "Modificar permisos por rol",
    "audit.view": "Ver auditoría / movimientos",
    "backups.view": "Ver backups",
    "backups.manage": "Crear y descargar backups",

    "sales_bi.view": "Ver inteligencia comercial",
    "sales_bi.import": "Importar planillas de ventas",
    "sales_bi.void": "Anular importaciones de ventas",
    "sales_bi.view_costs": "Ver costos en inteligencia comercial",
    "sales_bi.view_margin": "Ver márgenes en inteligencia comercial",
}

DEFAULT_ROLES: dict[str, dict[str, object]] = {
    "SUPERADMIN": {
        "label": "Superadministrador",
        "level": 100,
        "permissions": ["*"],
    },
    "GERENTE": {
        "label": "Gerente",
        "level": 80,
        "permissions": [
            "dashboard.view", "profile.view", "employees.photo.upload_own", "payroll_receipts.view_own", "payroll_receipts.sign_own", "payroll_receipts.observe_own", "about.view", "system.status.view", "system.diagnostics.view", "system.diagnostics.repair",
            "warranties.view", "warranties.create", "warranties.dashboard", "warranties.manage", "warranties.review", "warranties.mark_incomplete", "warranties.approve_review", "warranties.manage_provider", "warranties.change_status", "warranties.register_provider_response", "warranties.register_claim", "warranties.export", "warranties.sync_to_sheet", "warranties.sync_from_sheet", "warranties.sync_logs", "warranties.config", "warranties.reset_data", "warranties.cancel", "warranties.delete", "warranties.update", "warranties.counters", "warranties.remitos.view", "warranties.remitos.generate", "warranties.remitos.dispatch", "warranties.remitos.receive", "warranties.remitos.deposit_transfer", "warranties.remitos.provider_delivery", "warranties.remitos.delete",
            "budgets.view", "budgets.create", "budgets.save", "budgets.manage", "budgets.price_override",
            "products.view", "products.sync", "products.manage", "products.providers.manage",
            "sales_web.view", "sales_web.create", "sales_web.take", "sales_web.complete", "sales_web.send", "sales_web.cancel", "sales_web.cancel_own", "sales_web.branch_manage", "sales_web.manage", "sales_web.delete", "notifications.view", "push.subscribe",
            "price_updates.view", "price_updates.create", "price_updates.check", "price_updates.check.web", "price_updates.check.puma", "price_updates.check.master", "price_updates.edit", "price_updates.delete",
            "cost_updates.view", "cost_updates.create", "cost_updates.check", "cost_updates.check.puma", "cost_updates.check.master", "cost_updates.edit", "cost_updates.delete",
            "price_announcements.view", "price_announcements.generate",
            "tools.view", "jobs.view", "settings.view", "ops_config.view", "ops_config.manage", "companies.view", "companies.manage", "branches.view", "branches.manage",
            "users.view", "users.assign_roles", "employees.view", "employees.manage", "employees.photo.request", "employees.photo.approve", "employees.photo.reject", "payroll_receipts.view_all", "payroll_receipts.upload", "payroll_receipts.bulk_upload", "payroll_receipts.cancel", "payroll_receipts.respond_observation", "roles.view", "audit.view", "backups.view",
            "sales_bi.view", "sales_bi.import", "sales_bi.void", "sales_bi.view_costs", "sales_bi.view_margin",
            "psi.view", "psi.adjust", "psi.export",
        ],
    },
    "GERENTE_COMERCIAL": {
        "label": "Gerente Comercial",
        "level": 70,
        "permissions": [
            "dashboard.view", "profile.view", "about.view", "notifications.view", "push.subscribe",
            # PSI completo
            "psi.view", "psi.adjust", "psi.export",
            # Anuncios comerciales de cambios de precio
            "price_updates.view", "price_announcements.view", "price_announcements.generate",
            # BI Comercial existente
            "sales_bi.view", "sales_bi.import", "sales_bi.view_costs", "sales_bi.view_margin",
            # Catálogo (necesita para crear productos no catalogados que aparezcan en PSI)
            "products.view", "products.sync", "products.manage", "products.providers.manage",
            # Herramientas legacy comerciales (Ventas/Costos, GFK, normalizadores)
            "tools.view", "tools.run.gg", "tools.run.nvsc", "tools.run.vsc", "tools.run.ncm", "tools.run.ncmc", "tools.run.cf",
            # Jobs (para ver salida de herramientas)
            "jobs.view",
            # Ops config sólo lectura (para que vea la sección Comercial)
            "ops_config.view",
            "companies.view", "branches.view",
        ],
    },
    "ADMINISTRADOR": {
        "label": "Administrador",
        "level": 60,
        "permissions": [
            "dashboard.view", "profile.view", "employees.photo.upload_own", "payroll_receipts.view_own", "payroll_receipts.sign_own", "payroll_receipts.observe_own", "about.view", "system.status.view", "system.diagnostics.view", "system.diagnostics.repair",
            "warranties.view", "warranties.create", "warranties.dashboard", "warranties.manage", "warranties.review", "warranties.mark_incomplete", "warranties.approve_review", "warranties.manage_provider", "warranties.change_status", "warranties.register_provider_response", "warranties.register_claim", "warranties.export", "warranties.sync_to_sheet", "warranties.sync_from_sheet", "warranties.sync_logs", "warranties.config", "warranties.reset_data", "warranties.cancel", "warranties.delete", "warranties.update", "warranties.counters", "warranties.remitos.view", "warranties.remitos.generate", "warranties.remitos.dispatch", "warranties.remitos.receive", "warranties.remitos.deposit_transfer", "warranties.remitos.provider_delivery", "warranties.remitos.delete",
            "budgets.view", "budgets.create", "budgets.save",
            "products.view", "products.sync", "products.manage", "products.providers.manage",
            "sales_web.view", "sales_web.create", "sales_web.take", "sales_web.complete", "sales_web.send", "sales_web.cancel", "sales_web.cancel_own", "sales_web.branch_manage", "sales_web.manage", "notifications.view", "push.subscribe",
            "price_updates.view", "price_updates.create", "price_updates.check", "price_updates.check.web", "price_updates.check.puma", "price_updates.check.master", "price_updates.edit", "price_updates.delete",
            "cost_updates.view", "cost_updates.check", "cost_updates.check.puma", "cost_updates.check.master",
            "price_announcements.view", "price_announcements.generate",
            "tools.view", "jobs.view", "settings.view", "ops_config.view", "companies.view", "companies.manage", "branches.view", "branches.manage", "employees.view", "employees.manage", "employees.photo.request", "payroll_receipts.view_all", "payroll_receipts.upload", "payroll_receipts.bulk_upload", "payroll_receipts.cancel", "payroll_receipts.respond_observation", "audit.view",
            "sales_bi.view", "sales_bi.import", "sales_bi.void", "sales_bi.view_costs", "sales_bi.view_margin",
        ],
    },

    "ADMIN": {
        "label": "Admin (legacy)",
        "level": 60,
        "permissions": [
            "dashboard.view", "profile.view", "employees.photo.upload_own", "payroll_receipts.view_own", "payroll_receipts.sign_own", "payroll_receipts.observe_own", "about.view", "system.status.view", "system.diagnostics.view", "system.diagnostics.repair",
            "warranties.view", "warranties.create", "warranties.dashboard", "warranties.manage", "warranties.review", "warranties.mark_incomplete", "warranties.approve_review", "warranties.manage_provider", "warranties.change_status", "warranties.register_provider_response", "warranties.register_claim", "warranties.export", "warranties.sync_to_sheet", "warranties.sync_from_sheet", "warranties.sync_logs", "warranties.config", "warranties.reset_data", "warranties.cancel", "warranties.delete", "warranties.update", "warranties.counters", "warranties.remitos.view", "warranties.remitos.generate", "warranties.remitos.dispatch", "warranties.remitos.receive", "warranties.remitos.deposit_transfer", "warranties.remitos.provider_delivery", "warranties.remitos.delete",
            "budgets.view", "budgets.create", "budgets.save",
            "products.view", "products.sync", "products.manage", "products.providers.manage",
            "sales_web.view", "sales_web.create", "sales_web.take", "sales_web.complete", "sales_web.send", "sales_web.cancel", "sales_web.cancel_own", "sales_web.branch_manage", "sales_web.manage", "notifications.view", "notifications.manage", "push.subscribe",
            "price_updates.view", "price_updates.create", "price_updates.check", "price_updates.check.web", "price_updates.check.puma", "price_updates.check.master", "price_updates.edit", "price_updates.delete",
            "cost_updates.view", "cost_updates.check", "cost_updates.check.puma", "cost_updates.check.master",
            "price_announcements.view", "price_announcements.generate",
            "tools.view", "jobs.view", "settings.view", "ops_config.view", "companies.view", "companies.manage", "branches.view", "branches.manage", "employees.view", "employees.manage", "employees.photo.request", "payroll_receipts.view_all", "payroll_receipts.upload", "payroll_receipts.bulk_upload", "payroll_receipts.cancel", "payroll_receipts.respond_observation", "audit.view",
            "sales_bi.view", "sales_bi.import", "sales_bi.void", "sales_bi.view_costs", "sales_bi.view_margin",
        ],
    },
    "VENDEDOR_WEB": {
        "label": "Vendedor web",
        "level": 25,
        "permissions": [
            "profile.view", "employees.photo.upload_own", "payroll_receipts.view_own", "payroll_receipts.sign_own", "payroll_receipts.observe_own", "about.view", "system.status.view",
            "budgets.view", "budgets.create", "budgets.save",
            "sales_web.view", "sales_web.create", "sales_web.send", "sales_web.complete", "sales_web.cancel", "sales_web.cancel_own", "notifications.view", "notifications.manage", "push.subscribe",
        ],
    },
    "VENTA_WEB": {
        "label": "Venta web (legacy)",
        "level": 25,
        "permissions": [
            "profile.view", "employees.photo.upload_own", "payroll_receipts.view_own", "payroll_receipts.sign_own", "payroll_receipts.observe_own", "about.view", "system.status.view",
            "budgets.view", "budgets.create", "budgets.save",
            "sales_web.view", "sales_web.create", "sales_web.send", "sales_web.complete", "sales_web.cancel", "sales_web.cancel_own", "notifications.view", "notifications.manage", "push.subscribe",
        ],
    },
    "ENCARGADO_WEB": {
        "label": "Editor / Encargado de pagina web",
        "level": 35,
        "permissions": [
            "profile.view", "about.view", "system.status.view",
            "notifications.view", "push.subscribe",
            "price_updates.view", "price_updates.check.web",
        ],
    },
    "GESTOR_GARANTIAS": {
        "label": "Gestor de Garantías",
        "level": 50,
        "permissions": [
            "dashboard.view", "profile.view", "employees.photo.upload_own", "payroll_receipts.view_own", "payroll_receipts.sign_own", "payroll_receipts.observe_own", "about.view", "system.status.view",
            # Garantías: revisión completa + gestión + logística
            "warranties.view", "warranties.dashboard", "warranties.manage",
            "warranties.review", "warranties.mark_incomplete", "warranties.approve_review",
            "warranties.update", "warranties.cancel",
            # Remitos: genera, despacha, recibe y entrega al proveedor
            "warranties.remitos.view", "warranties.remitos.generate", "warranties.remitos.dispatch",
            "warranties.remitos.receive", "warranties.remitos.provider_delivery",
            "warranties.gestor.panel",
            "notifications.view", "push.subscribe",
        ],
    },
    "JEFE_POSVENTA": {
        "label": "Jefe / Responsable de Posventa",
        "level": 55,
        "permissions": [
            "dashboard.view", "profile.view", "employees.photo.upload_own", "payroll_receipts.view_own", "payroll_receipts.sign_own", "payroll_receipts.observe_own", "about.view", "system.status.view",
            # Gestión con proveedor: es el canal externo principal
            "warranties.view", "warranties.dashboard", "warranties.manage_provider",
            "warranties.change_status", "warranties.register_provider_response", "warranties.register_claim",
            "warranties.export", "warranties.cancel",
            # Remitos: ve y genera remito a proveedor
            "warranties.remitos.view", "warranties.remitos.provider_delivery",
            # Panel operativo del gestor (bandeja de trabajo interna)
            "warranties.gestor.panel",
            "notifications.view", "push.subscribe",
        ],
    },
    "ENCARGADO_SUCURSAL": {
        "label": "Encargado de Sucursal",
        "level": 30,
        "permissions": [
            "profile.view", "employees.photo.upload_own", "payroll_receipts.view_own", "payroll_receipts.sign_own", "payroll_receipts.observe_own", "about.view", "system.status.view",
            # Ve sus garantías, carga, genera y despacha remitos internos
            # SIN warranties.remitos.view → solo ve remitos de su propia sucursal (scope branch)
            "warranties.view", "warranties.create", "warranties.sucursal.logistics",
            "warranties.remitos.generate", "warranties.remitos.dispatch",
            "notifications.view", "push.subscribe",
        ],
    },
    "DEPOSITO": {
        "label": "Encargado de Depósito",
        "level": 40,
        "permissions": [
            "profile.view", "employees.photo.upload_own", "payroll_receipts.view_own", "payroll_receipts.sign_own", "payroll_receipts.observe_own", "about.view", "system.status.view",
            # Encargado de Depósito: carga garantías en depósito, recibe remitos y mueve entre depósitos.
            # warranties.view permite ver las garantías que el propio DEPOSITO cargó/recibió.
            "warranties.view", "warranties.create", "warranties.remitos.receive", "warranties.remitos.deposit_transfer",
            "notifications.view", "push.subscribe",
        ],
    },
    "CADETE_DEPOSITO": {
        "label": "Cadete de Depósito",
        "level": 15,
        "permissions": [
            "profile.view", "employees.photo.upload_own", "payroll_receipts.view_own", "payroll_receipts.sign_own", "payroll_receipts.observe_own", "about.view", "system.status.view",
            # Cadete: carga garantías cuando un cliente trae algo al depósito, y confirma llegada de remitos.
            # Ve su lista de garantías (igual que un vendedor) para ver si le pidieron correcciones.
            "warranties.view", "warranties.create", "warranties.remitos.receive",
            "notifications.view", "push.subscribe",
        ],
    },
    "VENDEDOR": {
        "label": "Vendedor",
        "level": 20,
        "permissions": [
            "profile.view", "employees.photo.upload_own", "payroll_receipts.view_own", "payroll_receipts.sign_own", "payroll_receipts.observe_own", "about.view", "system.status.view",
            "warranties.view", "warranties.create",
            # SIN warranties.remitos.view → solo ve remitos de su propia sucursal (scope branch)
            "warranties.remitos.generate", "warranties.remitos.dispatch",
            "budgets.view", "budgets.create", "budgets.save",
            "sales_web.view", "sales_web.create", "sales_web.cancel_own", "notifications.view", "push.subscribe",
        ],
    },
    "LECTURA": {
        "label": "Lectura",
        "level": 10,
        "permissions": ["profile.view", "employees.photo.upload_own", "payroll_receipts.view_own", "payroll_receipts.sign_own", "payroll_receipts.observe_own", "about.view", "system.status.view", "warranties.view", "budgets.view", "sales_web.view", "notifications.view"],
    },
}

PERMISSION_GROUPS: dict[str, list[str]] = {
    "Inicio y sistema": ["dashboard.view", "profile.view", "employees.photo.upload_own", "about.view", "system.status.view", "system.manage", "system.diagnostics.view", "system.diagnostics.repair"],
    "Garantías": ["warranties.view", "warranties.create", "warranties.dashboard", "warranties.manage", "warranties.review", "warranties.mark_incomplete", "warranties.approve_review", "warranties.manage_provider", "warranties.change_status", "warranties.register_provider_response", "warranties.register_claim", "warranties.export", "warranties.sync_to_sheet", "warranties.sync_from_sheet", "warranties.sync_logs", "warranties.config", "warranties.reset_data", "warranties.cancel", "warranties.delete", "warranties.update", "warranties.counters", "warranties.remitos.view", "warranties.remitos.generate", "warranties.remitos.dispatch", "warranties.remitos.receive", "warranties.remitos.deposit_transfer", "warranties.remitos.provider_delivery", "warranties.remitos.delete", "warranties.gestor.panel", "warranties.sucursal.logistics"],
    "Presupuestos": ["budgets.view", "budgets.create", "budgets.save", "budgets.manage", "budgets.price_override"],
    "Productos y proveedores": ["products.view", "products.sync", "products.manage", "products.providers.manage"],
    "Ventas": ["sales_web.view", "sales_web.create", "sales_web.take", "sales_web.complete", "sales_web.send", "sales_web.cancel", "sales_web.cancel_own", "sales_web.branch_manage", "sales_web.manage", "sales_web.delete"],
    "Precios y costos": [
        "price_updates.view", "price_updates.create", "price_updates.check", "price_updates.check.web", "price_updates.check.puma", "price_updates.check.master", "price_updates.edit", "price_updates.delete",
        "cost_updates.view", "cost_updates.create", "cost_updates.check", "cost_updates.check.puma", "cost_updates.check.master", "cost_updates.edit", "cost_updates.delete",
        "price_announcements.view", "price_announcements.generate",
    ],
    "Inteligencia comercial": [
        "sales_bi.view", "sales_bi.import", "sales_bi.void", "sales_bi.view_costs", "sales_bi.view_margin",
    ],
    "PSI · Planificación de Ventas e Inventario": [
        "psi.view", "psi.adjust", "psi.export",
    ],
    "Notificaciones": ["notifications.view", "notifications.manage", "push.subscribe"],
    "Recibos de sueldo": ["payroll_receipts.view_own", "payroll_receipts.sign_own", "payroll_receipts.observe_own", "payroll_receipts.view_all", "payroll_receipts.upload", "payroll_receipts.bulk_upload", "payroll_receipts.cancel", "payroll_receipts.respond_observation"],
    "Herramientas internas": [
        "tools.view", "tools.run.gpd", "tools.run.cc", "tools.run.cf", "tools.run.cer", "tools.run.eb",
        "tools.run.gg", "tools.run.ncm", "tools.run.ncmc", "tools.run.nvsc", "tools.run.vsc",
    ],
    "Administración": [
        "jobs.view", "jobs.cancel", "settings.view", "ops_config.view", "ops_config.manage", "products.view", "products.sync", "products.manage", "products.providers.manage", "companies.view", "companies.manage", "branches.view", "branches.manage", "google.manage",
        "users.view", "users.manage", "users.assign_roles", "employees.view", "employees.manage", "employees.photo.upload_own", "employees.photo.request", "employees.photo.approve", "employees.photo.reject", "payroll_receipts.view_own", "payroll_receipts.sign_own", "payroll_receipts.observe_own", "payroll_receipts.view_all", "payroll_receipts.upload", "payroll_receipts.bulk_upload", "payroll_receipts.cancel", "payroll_receipts.respond_observation", "roles.view", "roles.manage", "audit.view", "backups.view", "backups.manage",
    ],
}


def normalize_role(role: str) -> str:
    return str(role or "").strip().upper().replace(" ", "_")


def has_permission(role_permissions: list[str], permission: str) -> bool:
    return "*" in role_permissions or permission in role_permissions


# ── Validador catálogo de permisos (Fase A.5.1 · fundación) ─────────────────
#
# Detecta desalineaciones entre ALL_PERMISSIONS (el catálogo en código) y los
# permisos asignados a roles (en código DEFAULT_ROLES o persistidos en DB).
# Se ejecuta en startup y deja un warning legible si encuentra problemas.
# Política: NO falla el arranque — el sistema sigue operando aunque haya
# desalineación, pero el log y el endpoint de diagnóstico la reportan.

def validate_permissions_catalog(role_permissions_db: dict[str, list[str]] | None = None) -> dict[str, list[str] | bool]:
    """Audita el catálogo de permisos vs roles.

    Args:
        role_permissions_db: opcional, dict {role_name: [permission_keys]} con
            los roles persistidos en DB. Si se omite, solo se auditan los
            DEFAULT_ROLES en código.

    Returns:
        dict con keys:
        - "orphan_in_defaults": claves usadas en DEFAULT_ROLES que NO existen
          en ALL_PERMISSIONS. Indica permisos que se asignaron pero no se
          declararon (typos, código stale). **Error real.**
        - "orphan_in_db": claves en roles persistidos que no están en
          ALL_PERMISSIONS. Riesgo: permisos huérfanos en usuarios reales.
          **Error real.**
        - "unused_explicit": claves en ALL_PERMISSIONS que NO están en ningún
          rol Y no hay rol con wildcard. **Probable código muerto.**
        - "unused_wildcard_only": claves no usadas explícitamente pero
          cubiertas por algún rol con permisos ["*"] (típico SUPERADMIN).
          **Informativo, no es bug.**
        - "has_wildcard_role": True si algún rol tiene wildcard "*".

    Solo "orphan_*" son errores reales. "unused_*" son informativos.
    """
    valid_keys = set(ALL_PERMISSIONS.keys()) | {"*"}

    used_in_defaults: set[str] = set()
    orphan_in_defaults: set[str] = set()
    has_wildcard = False
    for role_name, role_def in DEFAULT_ROLES.items():
        perms = role_def.get("permissions") if isinstance(role_def, dict) else None
        if not isinstance(perms, list):
            continue
        for key in perms:
            key_str = str(key)
            if key_str == "*":
                has_wildcard = True
            used_in_defaults.add(key_str)
            if key_str not in valid_keys:
                orphan_in_defaults.add(key_str)

    used_in_db: set[str] = set()
    orphan_in_db: set[str] = set()
    for role_name, perms in (role_permissions_db or {}).items():
        for key in perms or []:
            key_str = str(key)
            if key_str == "*":
                has_wildcard = True
            used_in_db.add(key_str)
            if key_str not in valid_keys:
                orphan_in_db.add(key_str)

    used = used_in_defaults | used_in_db
    unused = sorted(set(ALL_PERMISSIONS.keys()) - used)

    return {
        "orphan_in_defaults": sorted(orphan_in_defaults),
        "orphan_in_db": sorted(orphan_in_db),
        "unused_explicit": [] if has_wildcard else unused,
        "unused_wildcard_only": unused if has_wildcard else [],
        "has_wildcard_role": has_wildcard,
    }


def format_validation_report(report: dict[str, list[str] | bool]) -> str:
    """Render legible del reporte. Vacío si no hay desalineaciones reales."""
    lines: list[str] = []
    orphans_defaults = report.get("orphan_in_defaults") or []
    orphans_db = report.get("orphan_in_db") or []
    unused_explicit = report.get("unused_explicit") or []
    unused_wildcard = report.get("unused_wildcard_only") or []
    if orphans_defaults:
        lines.append(f"  [ERROR] Claves en DEFAULT_ROLES sin declarar en ALL_PERMISSIONS ({len(orphans_defaults)}): {', '.join(orphans_defaults)}")
    if orphans_db:
        lines.append(f"  [ERROR] Claves en roles persistidos (DB) sin declarar en ALL_PERMISSIONS ({len(orphans_db)}): {', '.join(orphans_db)}")
    if unused_explicit:
        lines.append(f"  [WARN] Claves declaradas pero sin uso en ningún rol ({len(unused_explicit)}): {', '.join(unused_explicit)}")
    if unused_wildcard:
        lines.append(f"  [INFO] Claves cubiertas solo por rol wildcard '*' ({len(unused_wildcard)}): {', '.join(unused_wildcard[:5])}{'...' if len(unused_wildcard) > 5 else ''}")
    return "\n".join(lines)


def has_real_issues(report: dict[str, list[str] | bool]) -> bool:
    """True si hay errores reales (no solo informativos)."""
    return bool(report.get("orphan_in_defaults")) or bool(report.get("orphan_in_db")) or bool(report.get("unused_explicit"))
