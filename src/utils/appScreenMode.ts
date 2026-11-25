import type { AppScreenMode } from '../types/pos';

export const APP_SCREEN_MODE_QUERY_PARAM = 'aptposMode';

export function parseAppScreenMode(value: string | null | undefined): AppScreenMode | null {
  return value === 'pos' || value === 'rpos' || value === 'erp' ? value : null;
}

export function getAppScreenModeFromLocation(): AppScreenMode | null {
  if (typeof window === 'undefined') return null;
  return parseAppScreenMode(new URLSearchParams(window.location.search).get(APP_SCREEN_MODE_QUERY_PARAM));
}

export function getAppProductName(mode: AppScreenMode): string {
  switch (mode) {
    case 'rpos':
      return 'aptRPOS';
    case 'erp':
      return 'aptERP';
    default:
      return 'aptPOS';
  }
}
