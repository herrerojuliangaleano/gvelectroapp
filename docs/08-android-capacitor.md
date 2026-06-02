# Android - Capacitor

La app Android esta armada con Capacitor dentro de `frontend/android`.

## Idea clave

El APK actual carga el sistema desde el dominio online configurado en
`frontend/capacitor.config.ts`:

```text
https://electrogv.vayori.net
```

Eso significa que los cambios normales de frontend desplegados en Vercel y los
cambios del backend expuestos por ngrok se ven sin recompilar el APK. Solo hace
falta recompilar Android cuando cambian piezas nativas: plugins, permisos,
icono, splash, Firebase Android, version del APK o el dominio cargado por
Capacitor.

## Compilar APK

Desde PowerShell:

```powershell
cd frontend
npm install
npm run android:apk
```

Atajo Windows recomendado: abrir `electrogv.bat` en la raiz y usar la opcion
`11`.

Si Gradle no encuentra el SDK, crear el archivo local ignorado por Git:

```text
frontend/android/local.properties
```

con:

```properties
sdk.dir=C:/Users/victo/AppData/Local/Android/Sdk
```

El script hace todo el pipeline:

1. Detecta `JAVA_HOME` desde Android Studio si no esta configurado.
2. Incrementa `versionCode` en `frontend/android/app/build.gradle`.
3. Ejecuta `npm run build`.
4. Ejecuta `npx cap sync android`.
5. Compila `assembleDebug`.
6. Copia el APK final a:

```text
frontend/public/downloads/electrogv.apk
```

Tambien actualiza:

```text
frontend/public/version.json
```

## Compilar marcando update obligatorio

```powershell
cd frontend
npm run android:apk -- --required --changelog "Actualizacion obligatoria"
```

La opcion `11` de `electrogv.bat` ya compila con update obligatoria.

## Abrir Android Studio

```powershell
cd frontend
npm run android:open
```

Usar Android Studio cuando haya que revisar permisos, plugins nativos, firma,
emulador o errores especificos de Gradle.

## Firebase Android

Hay dos archivos distintos:

| Archivo | Donde va | Uso |
|---|---|---|
| `google-services.json` | `frontend/android/app/google-services.json` | Firebase Android / push notifications del APK |
| `firebase-service-account.json` | `backend/storage-prod/private/firebase-service-account.json` | Firebase Admin del backend para enviar FCM |

`firebase-service-account.json` no va dentro del APK. Es secreto del backend.

## Produccion y prueba

La app Android apunta al dominio online, no a un repo Git directamente. La
separacion queda asi:

| Entorno | Remote Git | Uso |
|---|---|---|
| Prueba / staging | `repo2` | Cargar datos, validar Vercel + ngrok y probar cambios |
| Produccion | `origin` | Version estable para usuarios |

Si se cambia el dominio de `server.url` en `capacitor.config.ts`, hay que
recompilar y redistribuir el APK. Si solo cambia el backend detras de ese
dominio, no hace falta recompilar.

## Checklist antes de distribuir APK

- `npm run android:apk` termina OK.
- Existe `frontend/public/downloads/electrogv.apk`.
- Existe `frontend/public/version.json`.
- El dominio de `frontend/capacitor.config.ts` apunta al dominio correcto.
- Si se usan push notifications, existe
  `frontend/android/app/google-services.json`.
- La version publicada en Vercel sirve `/downloads/electrogv.apk` y
  `/version.json`.
