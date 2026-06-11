/****************************************************
 * SISTEMA CENTRAL DE CONGELADO AUTOMÁTICO DE VENTAS
 *
 * Versión CENTRALIZADA del sistema de congelado por planilla.
 * Se instala UNA SOLA VEZ en un proyecto standalone de Apps Script
 * (script.google.com) y desde ahí vigila TODAS las planillas diarias,
 * incluidas las nuevas que genera gpd.py cada mañana.
 *
 * Diferencia clave con la versión anterior (por planilla):
 *   - NO hay que instalar nada en cada copia. Un único trigger
 *     temporal recorre las carpetas de Drive y procesa cada planilla
 *     reciente que encuentra.
 *   - No usa onEdit: la estabilidad se detecta comparando el HASH de
 *     cada fila entre pasadas (igual que ya hacía la revisión
 *     automática). Una venta se congela cuando está completa y su
 *     hash no cambió durante `minutesToWait` minutos.
 *
 * Qué hace por cada planilla:
 *   1. Asigna un ID único por venta en columna AX.
 *   2. Guarda el control en la hoja AUX_CONGELAR (de esa planilla).
 *   3. Cuando la fila tiene Producto + Cantidad + Valor y pasa
 *      `minutesToWait` sin cambios, pasa fórmulas a valores.
 *   4. Protege el rango congelado.
 *
 * INSTALACIÓN (una sola vez):
 *   1. Ir a script.google.com → Nuevo proyecto.
 *   2. Pegar este archivo completo. Ponerle nombre
 *      "Congelado central planillas".
 *   3. Revisar CONFIG (los folder IDs ya son los de gpd.py).
 *   4. En protectionEditors poné tu mail.
 *   5. Ejecutar una vez la función `instalarSistemaCentral` (botón
 *      Ejecutar) y autorizar los permisos que pide.
 *   6. Listo para siempre. Verificás con `verEstadoSistema`.
 ****************************************************/

const CONFIG = {
  // Carpetas de Drive donde gpd.py deja las planillas diarias.
  // (Mismos IDs que CARPETA_* en gpd.py.)
  folderIds: [
    '1MkPh57vcvbfO4JJXRsd9Y2ohxNpKaRqH', // SUR
    '1Ob6c5A_gnmaeRjvMTyYdLkahAjvPkc2i', // NORTE (Norcenter)
    '17RRqQzglHVxhxM-QL-t5fsrhqESqGCsx', // CANNING
    '1aaUJyDOuC5DRX9-qquo_sjste1OL5Vfc', // CASEROS
  ],

  // Plantillas: NUNCA tocarlas aunque aparezcan en alguna carpeta.
  excludeFileIds: [
    '1J4spN4uJyZiRKMfhq9HJ-iH7KrjL090vpbsRh1WqJgI', // PLANTILLA_SUCURSALES
    '1bGg0pwTOcHU3X1zGuo7ApFhk7-FRg35o2dt42e7TDDQ', // PLANTILLA_CASEROS
  ],

  // Solo procesa archivos cuyo nombre empiece así (las copias de gpd.py).
  fileNamePrefix: 'Planilla Ventas',

  // Solo mira archivos modificados en los últimos N días. Una planilla
  // totalmente congelada deja de modificarse → sale sola del escaneo.
  lookbackDays: 7,

  // Hoja donde cargan las ventas
  targetSheetNames: ['Planilla'],

  // Hoja auxiliar de control (se crea en cada planilla)
  controlSheetName: 'AUX_CONGELAR',

  // Primera fila real de carga
  dataStartRow: 5,

  // A:J = columnas a congelar/proteger
  lastColumnToFreeze: 10,

  // Columna AX = 50
  idColumn: 50,

  // Columnas obligatorias para considerar venta completa
  columns: {
    producto: 7,  // G
    cantidad: 9,  // I
    valor: 10     // J
  },

  // Minutos sin cambios para congelar. Con escaneo cada 10 min, una
  // venta se congela entre 10 y 20 min después del último cambio.
  minutesToWait: 10,

  // Cada cuánto corre el escaneo central. 10 min es seguro para las
  // cuotas de Apps Script; bajar a 5 solo si la cuenta es Workspace.
  triggerEveryMinutes: 10,

  // Ocultar columnas/hojas internas
  hideControlSheet: true,
  hideIdColumn: true,

  // Proteger después de congelar
  protectAfterFreeze: true,

  // Usuarios que SÍ pueden editar filas congeladas.
  // Victor + administración. Importante: ademas de figurar aca, estas
  // cuentas tienen que tener permiso de edicion sobre la planilla en
  // Drive (la proteccion no da acceso al archivo, solo exime del
  // bloqueo a quienes ya pueden editarlo).
  protectionEditors: [
    'admgv92@gmail.com',       // Victor (instalar el script con ESTA cuenta)
    'cchaparrogv@gmail.com',   // adm
    'ngimenezgv@gmail.com',    // adm
  ],

  protectionDescriptionPrefix: 'AUTO_VENTA_CONGELADA_'
};


/****************************************************
 * INSTALACIÓN (correr UNA vez, a mano)
 ****************************************************/

function instalarSistemaCentral() {
  eliminarTriggersDelSistema_();

  ScriptApp.newTrigger('revisarTodasLasPlanillas')
    .timeBased()
    .everyMinutes(CONFIG.triggerEveryMinutes)
    .create();

  Logger.log(
    'Listo. El sistema central quedó instalado.\n' +
    'Escanea las carpetas cada ' + CONFIG.triggerEveryMinutes + ' minutos y ' +
    'congela ventas completas con ' + CONFIG.minutesToWait + ' minutos sin cambios.\n' +
    'No hace falta instalar nada en las planillas nuevas: las detecta solo.'
  );
}


function desinstalarSistemaCentral() {
  eliminarTriggersDelSistema_();
  Logger.log('Listo. Se eliminó el trigger central.');
}


function eliminarTriggersDelSistema_() {
  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (trigger.getHandlerFunction() === 'revisarTodasLasPlanillas') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}


/** Diagnóstico rápido: corre el escaneo a mano y loguea qué encontró. */
function verEstadoSistema() {
  const archivos = buscarPlanillasRecientes_();
  Logger.log('Planillas dentro del lookback de %s días: %s', CONFIG.lookbackDays, archivos.length);
  archivos.forEach(f => Logger.log('- %s (%s)', f.getName(), f.getId()));
  const triggers = ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'revisarTodasLasPlanillas');
  Logger.log('Triggers activos del sistema: %s', triggers.length);
}


/****************************************************
 * ESCANEO CENTRAL (corre cada X minutos)
 ****************************************************/

function revisarTodasLasPlanillas() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return;

  try {
    const archivos = buscarPlanillasRecientes_();

    archivos.forEach(file => {
      try {
        const ss = SpreadsheetApp.openById(file.getId());
        procesarPlanilla_(ss);
      } catch (err) {
        // Una planilla rota no debe frenar a las demás.
        Logger.log('ERROR procesando %s (%s): %s', file.getName(), file.getId(), err.message);
      }
    });
  } finally {
    lock.releaseLock();
  }
}


/** Busca en las carpetas configuradas las planillas modificadas
 *  dentro del lookback, excluyendo plantillas. */
function buscarPlanillasRecientes_() {
  const limite = new Date(Date.now() - CONFIG.lookbackDays * 24 * 60 * 60 * 1000);
  const encontradas = [];

  CONFIG.folderIds.forEach(folderId => {
    let folder;
    try {
      folder = DriveApp.getFolderById(folderId);
    } catch (err) {
      Logger.log('ERROR: no pude abrir la carpeta %s: %s', folderId, err.message);
      return;
    }

    const files = folder.getFilesByType(MimeType.GOOGLE_SHEETS);
    while (files.hasNext()) {
      const file = files.next();
      if (CONFIG.excludeFileIds.includes(file.getId())) continue;
      if (CONFIG.fileNamePrefix && !file.getName().startsWith(CONFIG.fileNamePrefix)) continue;
      if (file.getLastUpdated() < limite) continue;
      encontradas.push(file);
    }
  });

  return encontradas;
}


/****************************************************
 * PROCESO POR PLANILLA
 * (la misma lógica de congelado de siempre, parametrizada
 *  por spreadsheet en vez de usar el activo)
 ****************************************************/

function procesarPlanilla_(ss) {
  prepararEstructura_(ss);

  const controlSheet = ss.getSheetByName(CONFIG.controlSheetName);
  const controlMap = obtenerMapaControl_(controlSheet);

  const now = new Date();

  CONFIG.targetSheetNames.forEach(sheetName => {
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) return;

    const lastRow = sheet.getLastRow();
    if (lastRow < CONFIG.dataStartRow) return;

    const numRows = lastRow - CONFIG.dataStartRow + 1;

    const dataRange = sheet.getRange(
      CONFIG.dataStartRow,
      1,
      numRows,
      CONFIG.lastColumnToFreeze
    );

    const values = dataRange.getValues();
    const formulas = dataRange.getFormulas();

    const idRange = sheet.getRange(
      CONFIG.dataStartRow,
      CONFIG.idColumn,
      numRows,
      1
    );

    const idValues = idRange.getValues();

    let idsChanged = false;

    for (let i = 0; i < values.length; i++) {
      const rowNumber = CONFIG.dataStartRow + i;
      const row = values[i];
      const rowFormulas = formulas[i];

      const tieneDatos = filaTieneAlgunDato_(row);

      let ventaId = normalizarId_(idValues[i][0]);

      if (!tieneDatos && !ventaId) continue;

      const controlExistente = ventaId ? controlMap[ventaId] : null;

      // Si la fila quedó vacía y todavía no estaba congelada, limpiar ID
      if (!tieneDatos) {
        if (ventaId && (!controlExistente || !controlExistente.frozenAt)) {
          idValues[i][0] = '';
          idsChanged = true;

          guardarControlFila_({
            controlSheet,
            controlMap,
            id: ventaId,
            sheetName,
            rowNumber,
            lastReviewAt: now,
            status: 'CANCELADA',
            notes: 'Fila vacía detectada por revisión automática.'
          });
        }

        continue;
      }

      // Si tiene datos pero no tiene ID, se lo creamos
      if (!ventaId) {
        ventaId = crearIdVenta_();
        idValues[i][0] = ventaId;
        idsChanged = true;

        guardarControlFila_({
          controlSheet,
          controlMap,
          id: ventaId,
          sheetName,
          rowNumber,
          lastEditAt: now,
          hash: generarHashFila_(row),
          frozenAt: '',
          protectedAt: '',
          lastReviewAt: now,
          status: ventaCompleta_(row) ? 'COMPLETA_EN_ESPERA' : 'INCOMPLETA',
          notes: 'ID creado por revisión automática.'
        });

        continue;
      }

      let control = controlMap[ventaId];

      if (!control) {
        guardarControlFila_({
          controlSheet,
          controlMap,
          id: ventaId,
          sheetName,
          rowNumber,
          lastEditAt: now,
          hash: generarHashFila_(row),
          frozenAt: '',
          protectedAt: '',
          lastReviewAt: now,
          status: ventaCompleta_(row) ? 'COMPLETA_EN_ESPERA' : 'INCOMPLETA',
          notes: 'Registro creado en AUX_CONGELAR.'
        });

        continue;
      }

      const currentHash = generarHashFila_(row);

      // Si ya fue congelada, solo actualizamos dónde se la vio
      if (control.frozenAt) {
        if (control.sheetName !== sheetName || Number(control.rowNumber) !== rowNumber) {
          guardarControlFila_({
            controlSheet,
            controlMap,
            id: ventaId,
            sheetName,
            rowNumber,
            lastReviewAt: now,
            status: 'YA_CONGELADA',
            notes: 'Venta congelada detectada en otra posición.'
          });
        }

        continue;
      }

      // Si todavía no está completa, no congela
      if (!ventaCompleta_(row)) {
        if (control.hash !== currentHash) {
          guardarControlFila_({
            controlSheet,
            controlMap,
            id: ventaId,
            sheetName,
            rowNumber,
            lastEditAt: now,
            hash: currentHash,
            frozenAt: '',
            protectedAt: '',
            lastReviewAt: now,
            status: 'INCOMPLETA',
            notes: 'Fila incompleta. Contador reiniciado.'
          });
        } else if (control.sheetName !== sheetName || Number(control.rowNumber) !== rowNumber) {
          guardarControlFila_({
            controlSheet,
            controlMap,
            id: ventaId,
            sheetName,
            rowNumber,
            lastReviewAt: now,
            status: 'INCOMPLETA'
          });
        }

        continue;
      }

      // Si cambió algo, reiniciar contador
      if (control.hash !== currentHash) {
        guardarControlFila_({
          controlSheet,
          controlMap,
          id: ventaId,
          sheetName,
          rowNumber,
          lastEditAt: now,
          hash: currentHash,
          frozenAt: '',
          protectedAt: '',
          lastReviewAt: now,
          status: 'COMPLETA_EN_ESPERA',
          notes: 'Cambio detectado. Contador reiniciado.'
        });

        continue;
      }

      // Si no tiene fecha de edición válida, la registramos ahora
      const lastEditDate = new Date(control.lastEditAt);

      if (!control.lastEditAt || isNaN(lastEditDate.getTime())) {
        guardarControlFila_({
          controlSheet,
          controlMap,
          id: ventaId,
          sheetName,
          rowNumber,
          lastEditAt: now,
          hash: currentHash,
          frozenAt: '',
          protectedAt: '',
          lastReviewAt: now,
          status: 'COMPLETA_EN_ESPERA',
          notes: 'Fecha de edición inicializada.'
        });

        continue;
      }

      const minutesWithoutChanges =
        (now.getTime() - lastEditDate.getTime()) / 1000 / 60;

      if (minutesWithoutChanges < CONFIG.minutesToWait) {
        continue;
      }

      // Llegó acá: la venta está completa y estable
      const rowRange = sheet.getRange(
        rowNumber,
        1,
        1,
        CONFIG.lastColumnToFreeze
      );

      const tieneFormulas = rowFormulas.some(formula => formula !== '');

      if (tieneFormulas) {
        const rowCurrentValues = rowRange.getValues();
        rowRange.setValues(rowCurrentValues);
      }

      let protectedAt = '';
      let notes = tieneFormulas
        ? 'Fórmulas pasadas a valores.'
        : 'No tenía fórmulas. Se marca como congelada.';

      if (CONFIG.protectAfterFreeze) {
        try {
          protegerFilaCongelada_(sheet, rowRange, ventaId, rowNumber);
          protectedAt = now;
          notes += ' Rango protegido.';
        } catch (err) {
          notes += ' ERROR al proteger: ' + err.message;
        }
      }

      guardarControlFila_({
        controlSheet,
        controlMap,
        id: ventaId,
        sheetName,
        rowNumber,
        lastEditAt: control.lastEditAt,
        hash: currentHash,
        frozenAt: now,
        protectedAt,
        lastReviewAt: now,
        status: 'CONGELADA',
        notes
      });
    }

    if (idsChanged) {
      idRange.setValues(idValues);
    }
  });
}


/****************************************************
 * PREPARACIÓN DE ESTRUCTURA
 ****************************************************/

function prepararEstructura_(ss) {
  prepararHojaControl_(ss);

  CONFIG.targetSheetNames.forEach(sheetName => {
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) return;

    sheet.getRange(1, CONFIG.idColumn).setValue('AUTO_ID_VENTA');

    if (CONFIG.hideIdColumn && !sheet.isColumnHiddenByUser(CONFIG.idColumn)) {
      sheet.hideColumns(CONFIG.idColumn);
    }
  });
}


function prepararHojaControl_(ss) {
  let sheet = ss.getSheetByName(CONFIG.controlSheetName);

  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.controlSheetName);
  }

  const headers = [
    'ID_VENTA',
    'HOJA',
    'ULTIMA_FILA_VISTA',
    'ULTIMA_EDICION',
    'HASH',
    'CONGELADO_EN',
    'PROTEGIDO_EN',
    'ULTIMA_REVISION',
    'ESTADO',
    'NOTAS'
  ];

  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.setFrozenRows(1);

  if (CONFIG.hideControlSheet && !sheet.isSheetHidden()) {
    sheet.hideSheet();
  }

  return sheet;
}


/****************************************************
 * CONTROL AUXILIAR
 ****************************************************/

function obtenerMapaControl_(controlSheet) {
  const lastRow = controlSheet.getLastRow();

  if (lastRow < 2) return {};

  const values = controlSheet.getRange(2, 1, lastRow - 1, 10).getValues();

  const map = {};

  values.forEach((row, index) => {
    const id = normalizarId_(row[0]);

    if (!id) return;

    map[id] = {
      controlRow: index + 2,
      id,
      sheetName: row[1],
      rowNumber: row[2],
      lastEditAt: row[3],
      hash: row[4],
      frozenAt: row[5],
      protectedAt: row[6],
      lastReviewAt: row[7],
      status: row[8],
      notes: row[9]
    };
  });

  return map;
}


function guardarControlFila_({
  controlSheet,
  controlMap,
  id,
  sheetName,
  rowNumber,
  lastEditAt,
  hash,
  frozenAt,
  protectedAt,
  lastReviewAt,
  status,
  notes
}) {
  const old = controlMap[id] || {};

  const rowData = [
    id,
    sheetName !== undefined ? sheetName : old.sheetName || '',
    rowNumber !== undefined ? rowNumber : old.rowNumber || '',
    lastEditAt !== undefined ? lastEditAt : old.lastEditAt || '',
    hash !== undefined ? hash : old.hash || '',
    frozenAt !== undefined ? frozenAt : old.frozenAt || '',
    protectedAt !== undefined ? protectedAt : old.protectedAt || '',
    lastReviewAt !== undefined ? lastReviewAt : old.lastReviewAt || '',
    status !== undefined ? status : old.status || '',
    notes !== undefined ? notes : old.notes || ''
  ];

  if (old.controlRow) {
    controlSheet.getRange(old.controlRow, 1, 1, 10).setValues([rowData]);
  } else {
    var newRow = controlSheet.getLastRow() + 1;
    controlSheet.getRange(newRow, 1, 1, 10).setValues([rowData]);
    old.controlRow = newRow;
  }

  controlMap[id] = {
    controlRow: old.controlRow,
    id: rowData[0],
    sheetName: rowData[1],
    rowNumber: rowData[2],
    lastEditAt: rowData[3],
    hash: rowData[4],
    frozenAt: rowData[5],
    protectedAt: rowData[6],
    lastReviewAt: rowData[7],
    status: rowData[8],
    notes: rowData[9]
  };
}


/****************************************************
 * PROTECCIÓN
 ****************************************************/

function protegerFilaCongelada_(sheet, range, ventaId, rowNumber) {
  const description =
    CONFIG.protectionDescriptionPrefix + ventaId;

  const protections = sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE);

  const alreadyProtected = protections.some(protection => {
    return protection.getDescription() === description;
  });

  if (alreadyProtected) return;

  const protection = range.protect();
  protection.setDescription(description);
  protection.setWarningOnly(false);

  const effectiveEmail = Session.getEffectiveUser().getEmail();

  const allowedEditors = CONFIG.protectionEditors
    .concat([effectiveEmail])
    .filter(email => email && String(email).trim() !== '')
    .map(email => String(email).toLowerCase());

  const currentEditors = protection.getEditors();

  const editorsToRemove = currentEditors.filter(user => {
    const email = user.getEmail();
    if (!email) return false;

    return !allowedEditors.includes(String(email).toLowerCase());
  });

  if (editorsToRemove.length > 0) {
    protection.removeEditors(editorsToRemove);
  }

  if (CONFIG.protectionEditors.length > 0) {
    protection.addEditors(CONFIG.protectionEditors);
  }

  if (protection.canDomainEdit()) {
    protection.setDomainEdit(false);
  }
}


/****************************************************
 * UTILIDADES
 ****************************************************/

function crearIdVenta_() {
  const tz = Session.getScriptTimeZone();
  const stamp = Utilities.formatDate(new Date(), tz, 'yyyyMMdd-HHmmss');
  const uuid = Utilities.getUuid().slice(0, 8).toUpperCase();

  return 'VENTA-' + stamp + '-' + uuid;
}


function normalizarId_(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}


function filaTieneAlgunDato_(rowValues) {
  return rowValues.some(value => !esBlanco_(value));
}


function ventaCompleta_(rowValues) {
  const producto = rowValues[CONFIG.columns.producto - 1];
  const cantidad = rowValues[CONFIG.columns.cantidad - 1];
  const valor = rowValues[CONFIG.columns.valor - 1];

  return (
    !esBlanco_(producto) &&
    tieneNumeroPositivo_(cantidad) &&
    tieneNumeroPositivo_(valor)
  );
}


function esBlanco_(value) {
  if (value === null || value === undefined) return true;

  if (value instanceof Date) return false;

  const text = String(value).trim();

  if (text === '') return true;

  // Evita congelar si una fórmula devuelve error visible
  if (text.startsWith('#')) return true;

  return false;
}


function tieneNumeroPositivo_(value) {
  if (esBlanco_(value)) return false;

  const number = convertirNumeroLocal_(value);

  return !isNaN(number) && number > 0;
}


function convertirNumeroLocal_(value) {
  if (typeof value === 'number') return value;

  if (value instanceof Date) return NaN;

  let text = String(value).trim();

  if (text === '') return NaN;

  text = text
    .replace(/\$/g, '')
    .replace(/\s/g, '')
    .replace(/\./g, '')
    .replace(/,/g, '.')
    .replace(/[^\d.-]/g, '');

  if (text === '' || text === '-' || text === '.') return NaN;

  return Number(text);
}


function generarHashFila_(rowValues) {
  return rowValues
    .map(value => {
      if (value instanceof Date) {
        return value.toISOString();
      }

      return String(value).trim();
    })
    .join('||');
}
