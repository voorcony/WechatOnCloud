// AI WeChat 自有面板版本信息。
// 二次开发版只展示本地 Voorcony 构建信息，不外呼公共镜像仓库。

export const CURRENT_VERSION = (process.env.WOC_VERSION || 'voorcony-local').trim();

export interface VersionInfo {
  current: string;
  latest: string | null;
  hasUpdate: boolean;
  isDev: boolean;
  checkedAt: number;
  source: string | null;
  error: string | null;
  product: string;
  channel: string;
}

const BUILD_CHANNEL = (process.env.WOC_BUILD_CHANNEL || 'voorcony-custom').trim();

let cache: VersionInfo = {
  current: CURRENT_VERSION,
  latest: null,
  hasUpdate: false,
  isDev: false,
  checkedAt: Date.now(),
  source: 'local-build',
  error: null,
  product: 'AI WeChat Console',
  channel: BUILD_CHANNEL,
};

export function versionInfo(): VersionInfo {
  return cache;
}

export function checkForUpdate(): Promise<VersionInfo> {
  cache = { ...cache, checkedAt: Date.now(), hasUpdate: false, latest: null, error: null };
  return Promise.resolve(cache);
}

export function ensureChecked(): void {
  cache = { ...cache, checkedAt: cache.checkedAt || Date.now() };
}

export function startUpdateChecker(): void {
  // 自有二开版本不自动检查公共发布源。
}
