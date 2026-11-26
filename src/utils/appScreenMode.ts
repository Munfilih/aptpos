import type { AppScreenMode } from '../types/pos';

export const APP_SCREEN_MODE_QUERY_PARAM = 'aptposMode';
export const APP_SCREEN_MODE_STORAGE_KEY = 'aptpos.screenMode';

export function parseAppScreenMode(value: string | null | undefined): AppScreenMode | null {
  return value === 'pos' || value === 'rpos' || value === 'erp' || value === 'flyerp'
    ? value
    : null;
}

export function getAppScreenModeFromLocation(): AppScreenMode | null {
  if (typeof window === 'undefined') return null;
  return parseAppScreenMode(new URLSearchParams(window.location.search).get(APP_SCREEN_MODE_QUERY_PARAM));
}

export function getStoredAppScreenMode(): AppScreenMode | null {
  if (typeof window === 'undefined') return null;
  try {
    return parseAppScreenMode(window.localStorage.getItem(APP_SCREEN_MODE_STORAGE_KEY));
  } catch (error) {
    console.warn('Failed to restore the saved screen mode:', error);
    return null;
  }
}

export function getAppProductName(mode: AppScreenMode): string {
  switch (mode) {
    case 'rpos':
      return 'aptRPOS';
    case 'erp':
      return 'aptERP';
    case 'flyerp':
      return 'aptFlyERP';
    default:
      return 'aptPOS';
  }
}
