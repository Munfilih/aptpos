import { APP_COMPONENTS, APP_VERSIONS } from '../types/pos';
import type {
  AppComponentId,
  AppVersion,
  StoreSettings,
  VersionComponentPolicies,
} from '../types/pos';

export function getAllowedComponentsForVersion(
  settings: Pick<StoreSettings, 'appVersion' | 'disabledAppComponents' | 'versionComponentPolicies'>,
  version: AppVersion
): AppComponentId[] {
  const savedPolicy = settings.versionComponentPolicies?.[version];
  if (savedPolicy !== undefined) return savedPolicy;

  const disabledComponents =
    settings.appVersion === version ? settings.disabledAppComponents || [] : [];
  return APP_COMPONENTS
    .map((component) => component.id)
    .filter((component) => !disabledComponents.includes(component));
}

export function getAllVersionComponentPolicies(
  settings: Pick<StoreSettings, 'appVersion' | 'disabledAppComponents' | 'versionComponentPolicies'>
): VersionComponentPolicies {
  return {
    Soft: getAllowedComponentsForVersion(settings, 'Soft'),
    Silver: getAllowedComponentsForVersion(settings, 'Silver'),
    Standard: getAllowedComponentsForVersion(settings, 'Standard'),
  };
}

export function parseVersionComponentPolicies(value: unknown): VersionComponentPolicies | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;

  const policies = value as Record<string, unknown>;
  const parsed: VersionComponentPolicies = {};
  for (const [versionName, components] of Object.entries(policies)) {
    const version = APP_VERSIONS.find((item) => item === versionName);
    if (!version || !Array.isArray(components)) return null;

    const knownComponents = components.filter(
      (component): component is AppComponentId =>
        typeof component === 'string' &&
        APP_COMPONENTS.some((known) => known.id === component)
    );
    if (knownComponents.length !== components.length) return null;
    parsed[version] = Array.from(new Set(knownComponents));
  }
  return parsed;
}
