# Protocolo de continuidad - Codex + Claude Code

Este protocolo define una forma fija de comunicacion entre agentes para que
cada turno deje claro que se hizo, que se decidio, que se valido, que quedo
pendiente y cual es el proximo paso seguro.

El objetivo no es generar burocracia: es evitar perdida de contexto mientras el
proyecto avanza con Codex, Claude Code y personas trabajando sobre la misma
base.

## Cuando usarlo

Usar este protocolo al cerrar cualquier turno importante, especialmente si hubo:

- Cambios en persistencia, modelos, migraciones o Docker.
- Cambios en API, tipos frontend, permisos o rutas.
- Cambios en flujos funcionales.
- Trabajo parcial que otro agente tiene que continuar.
- Validaciones, bloqueos o decisiones arquitectonicas.
- Handoff entre Codex, Claude Code y una persona.

Para cambios minimos de texto o ajustes triviales alcanza con un resumen corto,
pero si el siguiente turno depende del contexto, usar el protocolo completo.

## Lectura obligatoria al empezar

Cada agente debe empezar leyendo:

1. `docs/README.md`
2. `docs/02-guia-tecnica-agentes.md`
3. El documento de fase activo, por ejemplo `docs/fase-2-postgres/README.md`
4. El ultimo cierre de continuidad que haya dejado el agente anterior, si existe

## Lenguaje base

Usar siempre esta estructura al cerrar un turno importante:

```md
## Estado actual

[FASE] Fase 2.x - nombre corto
[ESTADO] Hecho / En curso / Bloqueado / Pendiente de validar
[BASE ACTIVA] SQLite / PostgreSQL / Hibrido
[OBJETIVO] Una frase clara del objetivo actual

## Lo que se hizo

- Cambio concreto 1.
- Cambio concreto 2.
- Cambio concreto 3.

## Decisiones tomadas

- Decision: ...
  Motivo: ...
  Impacto: ...

## Validacion realizada

- Comando/prueba ejecutada: ...
- Resultado: ...
- Lo no validado todavia: ...

## Lo que NO se cambio

- No se activo Postgres como DB principal.
- No se borro SQLite legacy.
- No se tocaron datos reales de `backend/storage/`.
- No se cambiaron contratos de API, salvo que se indique explicitamente.

## Riesgos / cuidado para el proximo agente

- Riesgo 1.
- Riesgo 2.

## Proximo paso recomendado

1. Paso inmediato.
2. Validacion esperada.
3. Documento que hay que actualizar.
```

## Reglas de uso

- Cada cierre de trabajo importante debe usar el formato anterior.
- Si se toca persistencia, indicar siempre si el modulo sigue en SQLite o ya fue
  portado a PostgreSQL.
- En Fase 2 no se migran datos legacy: no proponer importar SQLite/JSON salvo
  pedido explicito nuevo del usuario.
- Si se agrega endpoint, tipo o permiso, nombrar explicitamente los archivos y
  documentos que se actualizaron.
- Si algo queda a medias, marcarlo como `[EN CURSO]` o `[BLOQUEADO]`, nunca como
  hecho.
- Para la migracion PostgreSQL, repetir siempre esta frase cuando aplique:
  "La app sigue funcionando contra SQLite hasta completar el porting y hacer el
  switch final".
- No declarar una validacion si no se ejecuto.
- Si no se pudo validar algo, dejarlo escrito en "Lo no validado todavia".
- Si se detecta una inconsistencia del repo, agregarla como `[RIESGO]` o
  actualizar `docs/02-guia-tecnica-agentes.md`.
- Mantener los cierres concretos: hechos verificables, no intenciones vagas.

## Marcadores estandar

| Marcador | Significado |
|---|---|
| `[HECHO]` | Terminado y validado. |
| `[EN CURSO]` | Implementado parcialmente o pendiente de validacion. |
| `[BLOQUEADO]` | Falta dato, credencial, decision o problema externo. |
| `[DECISION]` | Decision arquitectonica tomada. |
| `[RIESGO]` | Algo que puede romper flujos existentes. |
| `[NO TOCAR]` | Parte sensible que debe preservarse. |
| `[PROXIMO]` | Siguiente accion recomendada. |

## Escenarios cubiertos

### Cambio terminado y validado

Usar `[ESTADO] Hecho` solo si:

- El cambio fue implementado.
- La validacion relevante se ejecuto.
- Los documentos afectados fueron actualizados.
- No quedan pasos necesarios para que otro agente termine ese cambio.

### Cambio parcial

Usar `[ESTADO] En curso` cuando:

- El cambio esta empezado pero falta completar una parte.
- Falta portar un modulo dependiente.
- Falta ajustar frontend/tipos/docs.
- La validacion todavia no alcanza para declararlo hecho.

### Migracion en curso

En la migracion a PostgreSQL, indicar siempre:

- Fase exacta.
- Si Postgres esta solo preparado o ya usado por el modulo.
- Que tablas/modelos se agregaron.
- Que routers siguen en SQLite.
- Si Alembic baseline ya fue generado o no.

Frase obligatoria cuando corresponda:

> La app sigue funcionando contra SQLite hasta completar el porting y hacer el switch final.

### Bloqueo

Usar `[ESTADO] Bloqueado` cuando no se puede avanzar sin:

- Credencial o secreto.
- Decision de producto.
- Acceso externo.
- Confirmacion sobre datos reales.
- Correccion previa de una inconsistencia.

El bloqueo debe incluir el dato exacto que falta y el menor siguiente paso para
desbloquear.

### Handoff entre agentes

Cuando un agente deja trabajo para otro, incluir:

- Ultimos archivos tocados.
- Modulos afectados.
- Validaciones ya hechas.
- Validaciones pendientes.
- Riesgos concretos.
- Proximo paso recomendado.

## Ejemplo para Fase PostgreSQL

```md
## Estado actual

[FASE] Fase 2.3 - modelos ORM del dominio
[ESTADO] En curso
[BASE ACTIVA] Hibrido: app en SQLite, Postgres preparado
[OBJETIVO] Completar modelos SQLAlchemy antes de generar baseline Alembic.

## Lo que se hizo

- Se agregaron modelos ORM para employees/payroll.
- Se usaron PK BIGINT, FKs reales y timestamps timezone-aware.
- Se mantuvo el contrato publico de API sin cambios.

## Decisiones tomadas

- Decision: Employee referencia a User por `user_id`.
  Motivo: eliminar dependencia legacy por username.
  Impacto: auth debe portarse antes que employees.

## Validacion realizada

- Import de modelos OK.
- Alembic autogenerate no ejecutado todavia.

## Lo que NO se cambio

- No se activo Postgres como DB principal.
- No se borro `backend/app/database.py`.
- No se tocaron datos reales de `backend/storage/`.

## Riesgos / cuidado para el proximo agente

- No portar payroll antes de auth/users.
- Revisar tipos frontend si aparece `user_id`.

## Proximo paso recomendado

1. Completar modelos de warranties/remitos.
2. Revisar FKs contra branches/users.
3. Generar baseline Alembic cuando esten todos los modelos.
```

## Checklist final antes de cerrar un turno

- Estado, fase y base activa quedaron claros.
- Se separo "hecho" de "pendiente".
- Las decisiones tienen motivo e impacto.
- Las validaciones son reales.
- Los riesgos para el proximo agente son concretos.
- Si hubo cambios en docs, API, tipos o permisos, quedaron nombrados.
- El siguiente paso recomendado es ejecutable sin reinterpretar el objetivo.
