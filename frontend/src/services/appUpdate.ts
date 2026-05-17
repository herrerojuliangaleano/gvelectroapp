import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';

export type UpdateInfo = {
  needsUpdate: true;
  required: boolean;
  apkUrl: string;
  changelog: string;
  latestVersionCode: number;
  installedVersionCode: number;
} | { needsUpdate: false };

export async function checkAppUpdate(): Promise<UpdateInfo> {
  // Solo aplica en la app nativa Android
  if (!Capacitor.isNativePlatform()) return { needsUpdate: false };

  try {
    const [versionRes, appInfo] = await Promise.all([
      fetch('/version.json'),
      App.getInfo(),
    ]);

    if (!versionRes.ok) return { needsUpdate: false };

    const remote = await versionRes.json() as {
      minVersionCode: number;
      required: boolean;
      changelog: string;
      apkUrl: string;
    };

    const installed = parseInt(appInfo.build, 10);
    const required  = remote.minVersionCode ?? 1;

    if (installed >= required) return { needsUpdate: false };

    return {
      needsUpdate: true,
      required:              remote.required ?? false,
      apkUrl:                remote.apkUrl   ?? '/downloads/electrogv.apk',
      changelog:             remote.changelog ?? '',
      latestVersionCode:     required,
      installedVersionCode:  installed,
    };
  } catch {
    return { needsUpdate: false };
  }
}
