import { APP_VERSIONS } from '../types/pos';
import type { DemoActivationResult } from '../types/pos';

export function parseDemoActivationResult(value: unknown): DemoActivationResult | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;

  const result = value as Record<string, unknown>;
  const appVersion = APP_VERSIONS.find((version) => version === result.appVersion);
  const screenType =
    result.screenType === 'pos' || result.screenType === 'rpos'
      ? result.screenType
      : undefined;
  if (
    typeof result.username !== 'string' ||
    !result.username.trim() ||
    typeof result.expiresAt !== 'string' ||
    !appVersion ||
    !screenType ||
    !Array.isArray(result.permissions)
  ) {
    return null;
  }

  const permissions: string[] = [];
  for (const permission of result.permissions) {
    if (typeof permission !== 'string') return null;
    permissions.push(permission);
  }

  return {
    username: result.username,
    expiresAt: result.expiresAt,
    appVersion,
    screenType,
    permissions,
  };
}
