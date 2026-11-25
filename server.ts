import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import os from 'node:os';
import path from 'path';
import type { Server } from 'http';
import { fileURLToPath } from 'url';
import {
  adjustProductStock,
  authenticateUser,
  backupDatabase,
  closeCashierShift,
  createRegistrationRequest,
  createCustomer,
  createCashbookEntry,
  createProduct,
  createInvoiceNumber,
  createInventoryOption,
  createPurchaseEntry,
  createPurchaseReturnVoucher,
  createSale,
  createSaleReturn,
  createSalesReturnVoucher,
  deleteSalesReturnVoucher,
  createUser,
  createVendor,
  deleteCustomer,
  deleteProduct,
  deleteInventoryOption,
  deletePurchase,
  deletePurchaseReturnVoucher,
  deleteSale,
  deleteUser,
  deleteVendor,
  flushPrintQueue,
  getDb,
  hasDefaultAdminCredentials,
  getDemoAccess,
  beginDemoOfflineGrace,
  clearDemoAccess,
  getCashbookData,
  getCashierShiftReport,
  getSettings,
  getRegistrationSystemCode,
  importProducts,
  listCustomers,
  listPrintQueue,
  listProducts,
  listInventoryOptions,
  listPurchases,
  listPurchaseReturnVouchers,
  listSales,
  listCashierShifts,
  listSalesReturnVouchers,
  listRegistrationRequests,
  listUsers,
  listVendors,
  resetDatabase,
  restoreDatabase,
  removeBlockedSystemCredentials,
  replaceUsersWithRegisteredAdmin,
  reviewRegistrationRequest,
  saveDemoAccess,
  clearRegisteredSystemSettings,
  syncDemoAccessStatus,
  updateCustomer,
  updateProduct,
  updateInventoryOption,
  updatePurchase,
  updateSale,
  updateSaleInvoice,
  updateSalesReturnVoucher,
  updateSettings,
  updateUser,
  updateVendor,
  voidSale,
  setCashbookOpeningBalance,
  openCashierShift,
} from './server/db';
import { APP_COMPONENTS, APP_VERSIONS } from './src/types/pos';
import { parseVersionComponentPolicies } from './src/utils/versionComponentPolicies';
import type {
  AppComponentId,
  AppVersion,
  PosScreenLayout,
  RegistrationDetails,
  VersionComponentPolicies,
} from './src/types/pos';

const translationCache = new Map<string, string>();
const inFlightTranslations = new Map<string, Promise<string>>();
const DEFAULT_DEMO_PORTAL_API_URL = 'https://aptpos-admin-api.onrender.com';

class TranslationProviderError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'TranslationProviderError';
  }
}

class DemoPortalUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DemoPortalUnavailableError';
  }
}

async function fetchTranslation(url: string, provider: string): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new TranslationProviderError(`${provider} returned HTTP ${response.status}.`, response.status);
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function translateEnglishToArabic(text: string): Promise<string> {
  const cacheKey = text.toLocaleLowerCase('en');
  const cached = translationCache.get(cacheKey);
  if (cached) return cached;

  const pending = inFlightTranslations.get(cacheKey);
  if (pending) return pending;

  const request = (async () => {
    let googleError: unknown;
    try {
      const googleUrl = new URL('https://translate.googleapis.com/translate_a/single');
      googleUrl.search = new URLSearchParams({
        client: 'gtx',
        sl: 'en',
        tl: 'ar',
        dt: 't',
        q: text,
      }).toString();
      const payload: unknown = await fetchTranslation(googleUrl.toString(), 'Google Translate');
      const segments =
        Array.isArray(payload) && Array.isArray(payload[0]) ? payload[0] : [];
      const translation = segments
        .map((segment: unknown) =>
          Array.isArray(segment) && typeof segment[0] === 'string' ? segment[0] : ''
        )
        .join('')
        .trim();
      if (!translation) throw new TranslationProviderError('Google Translate returned no Arabic text.');
      return translation;
    } catch (error) {
      googleError = error;
    }

    try {
      const backupUrl = new URL('https://api.mymemory.translated.net/get');
      backupUrl.search = new URLSearchParams({ q: text, langpair: 'en|ar' }).toString();
      const payload = await fetchTranslation(backupUrl.toString(), 'Backup translation service') as {
        responseStatus?: number;
        responseData?: { translatedText?: string };
      };
      const translation = payload.responseData?.translatedText?.trim();
      if (!translation || (payload.responseStatus !== undefined && payload.responseStatus >= 400)) {
        throw new TranslationProviderError(
          'Backup translation service returned no Arabic text.',
          payload.responseStatus
        );
      }
      return translation;
    } catch (backupError) {
      const googleStatus = googleError instanceof TranslationProviderError ? googleError.status : undefined;
      const backupStatus = backupError instanceof TranslationProviderError ? backupError.status : undefined;
      if (googleStatus === 429 || backupStatus === 429) {
        throw new TranslationProviderError(
          'Translation services are rate-limited. Please wait a moment and try again.',
          429
        );
      }
      throw new TranslationProviderError(
        'Arabic translation is temporarily unavailable. Check your connection and try again.'
      );
    }
  })();

  inFlightTranslations.set(cacheKey, request);
  try {
    const translation = await request;
    translationCache.set(cacheKey, translation);
    if (translationCache.size > 1000) {
      const oldestKey = translationCache.keys().next().value;
      if (oldestKey !== undefined) translationCache.delete(oldestKey);
    }
    return translation;
  } finally {
    inFlightTranslations.delete(cacheKey);
  }
}

async function isValidAppAdminPassword(password: unknown): Promise<boolean> {
  if (typeof password !== 'string' || !password) return false;
  const admin = await authenticateUser('aptadmin', password);
  return Boolean(admin && admin.username.toLowerCase() === 'aptadmin' && admin.role === 'admin');
}

async function postToDemoPortal(
  pathname: string,
  body: Record<string, unknown>,
  timeoutMs = 60000
): Promise<Record<string, unknown>> {
  const configuredUrl = process.env.DEMO_PORTAL_API_URL || DEFAULT_DEMO_PORTAL_API_URL;
  let endpoint: URL;
  try {
    endpoint = new URL(pathname, configuredUrl.endsWith('/') ? configuredUrl : `${configuredUrl}/`);
  } catch {
    throw new Error('DEMO_PORTAL_API_URL must be a valid HTTP or HTTPS URL.');
  }
  if (endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:') {
    throw new Error('DEMO_PORTAL_API_URL must use HTTP or HTTPS.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    throw new DemoPortalUnavailableError(
      error instanceof Error && error.name === 'AbortError'
        ? 'The aptPOS User Management service did not respond in time. Check your internet connection and retry.'
        : 'Could not reach aptPOS User Management. An internet connection is required; check the portal URL and retry.'
    );
  } finally {
    clearTimeout(timeout);
  }

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      typeof payload === 'object' &&
      payload !== null &&
      'error' in payload &&
      typeof payload.error === 'string'
        ? payload.error
        : `Demo activation service failed (HTTP ${response.status}).`;
    const error = new Error(message);
    Object.assign(error, { status: response.status });
    throw error;
  }
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new Error('The demo activation service returned an invalid response.');
  }
  return payload as Record<string, unknown>;
}

async function requestVersionControlPortal(): Promise<{ versionComponentPolicies: VersionComponentPolicies; updatedAt: string | null }> {
  const configuredUrl = process.env.DEMO_PORTAL_API_URL || DEFAULT_DEMO_PORTAL_API_URL;
  let endpoint: URL;
  try {
    endpoint = new URL(
      '/api/registration/version-control',
      configuredUrl.endsWith('/') ? configuredUrl : `${configuredUrl}/`
    );
  } catch {
    throw new Error('DEMO_PORTAL_API_URL must be a valid HTTP or HTTPS URL.');
  }
  if (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(endpoint.hostname))) {
    throw new Error('Version-control updates require HTTPS except for local development.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'GET',
      signal: controller.signal,
    });
  } catch (error) {
    throw new Error(
      error instanceof Error && error.name === 'AbortError'
        ? 'The Auth API did not respond in time while syncing version policies.'
        : 'Could not reach the Auth API to sync version policies.'
    );
  } finally {
    clearTimeout(timeout);
  }

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      typeof payload === 'object' &&
      payload !== null &&
      'error' in payload &&
      typeof payload.error === 'string'
        ? payload.error
        : `The Auth API rejected the version-policy request (HTTP ${response.status}).`;
    throw new Error(message);
  }
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload) || !('allowedModules' in payload)) {
    throw new Error('The Auth API returned an invalid version policy.');
  }
  const versionComponentPolicies = parseVersionComponentPolicies(payload.allowedModules);
  if (!versionComponentPolicies || APP_VERSIONS.some((version) => !Array.isArray(versionComponentPolicies[version]))) {
    throw new Error('The Auth API returned an incomplete version policy.');
  }
  return {
    versionComponentPolicies,
    updatedAt: 'updatedAt' in payload && typeof payload.updatedAt === 'string'
      ? payload.updatedAt
      : null,
  };
}

async function postToRegistrationPortal(
  pathname: string,
  body: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const configuredUrl = process.env.DEMO_PORTAL_API_URL || DEFAULT_DEMO_PORTAL_API_URL;
  let endpoint: URL;
  try {
    endpoint = new URL(pathname, configuredUrl.endsWith('/') ? configuredUrl : `${configuredUrl}/`);
  } catch {
    throw new Error('DEMO_PORTAL_API_URL must be a valid HTTP or HTTPS URL.');
  }
  if (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(endpoint.hostname))) {
    throw new Error('Registered-system activation requires HTTPS except for local development.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    throw new Error(
      error instanceof Error && error.name === 'AbortError'
        ? 'The Auth API did not respond in time while activating registration.'
        : 'Could not reach the Auth API to activate registration.'
    );
  } finally {
    clearTimeout(timeout);
  }

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      typeof payload === 'object' &&
      payload !== null &&
      'error' in payload &&
      typeof payload.error === 'string'
        ? payload.error
        : `The Auth API rejected registration (HTTP ${response.status}).`;
    const error = new Error(message);
    Object.assign(error, { status: response.status });
    throw error;
  }
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new Error('The Auth API returned an invalid registration response.');
  }
  return payload as Record<string, unknown>;
}

function parsePreparedRegistrationCredentials(
  prepared: Record<string, unknown>
): { username: string; password: string } | undefined {
  if (prepared.credentials === undefined) return undefined;
  const credentials = prepared.credentials;
  if (
    typeof credentials !== 'object' ||
    credentials === null ||
    !('username' in credentials) ||
    !('password' in credentials)
  ) {
    throw new Error('The Auth API returned invalid registration credentials.');
  }
  const username = credentials.username;
  const password = credentials.password;
  if (typeof username !== 'string' || typeof password !== 'string') {
    throw new Error('The Auth API returned invalid registration credentials.');
  }
  if (prepared.username !== username) {
    throw new Error('The Auth API returned mismatched registration credentials.');
  }
  const normalizedUsername = username.trim().toLowerCase();
  if (normalizedUsername === 'aptadmin' || normalizedUsername === 'demo') {
    throw new Error('The registered account cannot use the reserved username "aptadmin" or "demo".');
  }
  return { username, password };
}

function parseRegistrationDetails(value: unknown): RegistrationDetails | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== 'object' ||
    value === null ||
    !('businessName' in value) ||
    typeof value.businessName !== 'string' ||
    !value.businessName.trim() ||
    !('address' in value) ||
    typeof value.address !== 'string' ||
    !('mobileNumber' in value) ||
    typeof value.mobileNumber !== 'string' ||
    !('systemCode' in value) ||
    typeof value.systemCode !== 'string' ||
    !('username' in value) ||
    typeof value.username !== 'string' ||
    !('appVersion' in value)
  ) {
    throw new Error('The Auth API returned invalid business registration details.');
  }
  const appVersion = APP_VERSIONS.find((version) => version === value.appVersion);
  if (!appVersion) throw new Error('The Auth API returned an invalid business registration version.');
  const details = value as Record<string, unknown>;
  if (details.licenseNumber !== undefined && typeof details.licenseNumber !== 'string') {
    throw new Error('The Auth API returned an invalid license number.');
  }
  const parseAmcDate = (date: unknown, field: string): string | null | undefined => {
    if (date === undefined || date === null) return date;
    const parsedDate = typeof date === 'string' ? new Date(`${date}T00:00:00.000Z`) : null;
    if (
      typeof date !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !parsedDate ||
      !Number.isFinite(parsedDate.getTime()) ||
      parsedDate.toISOString().slice(0, 10) !== date
    ) {
      throw new Error(`The Auth API returned an invalid AMC ${field} date.`);
    }
    return date;
  };
  const amcStartDate = parseAmcDate(details.amcStartDate, 'start');
  const amcEndDate = parseAmcDate(details.amcEndDate, 'end');
  if (
    (amcStartDate === undefined) !== (amcEndDate === undefined) ||
    (amcStartDate === null) !== (amcEndDate === null)
  ) {
    throw new Error('The Auth API returned incomplete AMC dates.');
  }
  if (amcStartDate && amcEndDate && amcStartDate > amcEndDate) {
    throw new Error('The Auth API returned an AMC end date before its start date.');
  }
  if (details.amcNotes !== undefined && typeof details.amcNotes !== 'string') {
    throw new Error('The Auth API returned invalid AMC notes.');
  }
  return {
    businessName: value.businessName,
    address: value.address,
    mobileNumber: value.mobileNumber,
    ...(typeof details.licenseNumber === 'string' ? { licenseNumber: details.licenseNumber } : {}),
    systemCode: value.systemCode,
    username: value.username,
    appVersion,
    ...(amcStartDate !== undefined ? { amcStartDate } : {}),
    ...(amcEndDate !== undefined ? { amcEndDate } : {}),
    ...(typeof details.amcNotes === 'string' ? { amcNotes: details.amcNotes } : {}),
  };
}

function sameRegistrationDetails(
  current: RegistrationDetails | undefined,
  next: RegistrationDetails
): boolean {
  return Boolean(
    current &&
    current.businessName === next.businessName &&
    current.address === next.address &&
    current.mobileNumber === next.mobileNumber &&
    current.licenseNumber === next.licenseNumber &&
    current.systemCode === next.systemCode &&
    current.username === next.username &&
    current.appVersion === next.appVersion &&
    current.amcStartDate === next.amcStartDate &&
    current.amcEndDate === next.amcEndDate &&
    current.amcNotes === next.amcNotes
  );
}

const DEMO_OFFLINE_GRACE_MS = 60 * 60 * 1000;
const DEMO_OFFLINE_GRACE_EXPIRED_MESSAGE =
  'Demo access requires an internet connection after one hour offline.';

function getDemoSystemInfo() {
  const processors = os.cpus();
  return {
    hostname: os.hostname(),
    osPlatform: os.platform(),
    osRelease: os.release(),
    architecture: os.arch(),
    cpuModel: processors[0]?.model || '',
    cpuCores: processors.length,
    totalMemoryGb: Math.round(os.totalmem() / (1024 ** 3) * 10) / 10,
  };
}

function parsePosScreenLayout(value: unknown): PosScreenLayout | undefined {
  return value === 'pos' || value === 'rpos' ? value : undefined;
}

function getDemoPermissions(components: AppComponentId[]): string[] {
  const permissions = new Set<string>();
  components.forEach((component) => {
    if (component === 'return-register' || component === 'return-history') {
      permissions.add('sales-return');
      permissions.add('manage-sales-returns');
    } else if (component === 'shift') {
      permissions.add('register');
    } else {
      permissions.add(component);
    }
  });
  return [...permissions];
}

async function getCurrentDemoAccess(eventType: 'login' | 'check' = 'check'): Promise<{
  status:
    | 'never'
    | 'pending'
    | 'awaiting-activation'
    | 'deactivated'
    | 'previous-request'
    | 'active'
    | 'expired'
    | 'registered'
    | 'blocked';
  expiresAt: string | null;
  appVersion?: AppVersion;
  screenType?: PosScreenLayout;
  businessName?: string;
  permissions?: string[];
  offlineGraceExpired?: boolean;
}> {
  const systemCode = await getRegistrationSystemCode();
  try {
    const defaultAdminCredentialsInUse = await hasDefaultAdminCredentials();
    const response = await postToDemoPortal(
      '/api/registration/demo-status-check',
      {
        systemCode,
        eventType,
        defaultAdminCredentialsInUse,
        ...(eventType === 'login' ? { systemInfo: getDemoSystemInfo() } : {}),
      },
      10000
    );
    if (
      typeof response.active !== 'boolean' ||
      (response.expiresAt !== null && typeof response.expiresAt !== 'string') ||
      (response.revoked !== undefined && typeof response.revoked !== 'boolean') ||
      (response.registered !== undefined && typeof response.registered !== 'boolean') ||
      (response.blocked !== undefined && typeof response.blocked !== 'boolean') ||
      (response.screenType !== undefined && parsePosScreenLayout(response.screenType) === undefined) ||
      (response.pendingRequest !== undefined && typeof response.pendingRequest !== 'boolean') ||
      (response.pendingActivation !== undefined && typeof response.pendingActivation !== 'boolean') ||
      (response.previousRequest !== undefined && typeof response.previousRequest !== 'boolean')
    ) {
      throw new Error('The demo status service returned an invalid response.');
    }

    const localSettings = await getSettings();
    if (response.blocked === true) {
      if (!localSettings.systemCodeBlocked) {
        await updateSettings({ systemCodeBlocked: true });
      }
      return { status: 'blocked', expiresAt: null };
    }
    if (localSettings.systemCodeBlocked) {
      await updateSettings({ systemCodeBlocked: false });
    }

    if (response.registered === true) {
      const appVersion = APP_VERSIONS.find((version) => version === response.appVersion);
      const screenType = parsePosScreenLayout(response.screenType);
      if (!response.active || appVersion === undefined || !Array.isArray(response.allowedModules)) {
        throw new Error('The registered-system entitlement is invalid.');
      }
      const allowedModules = response.allowedModules;
      const knownModules = allowedModules.filter(
        (module): module is AppComponentId =>
          typeof module === 'string' &&
          APP_COMPONENTS.some((component) => component.id === module)
      );
      if (knownModules.length !== allowedModules.length) {
        throw new Error('The registered-system entitlement contains an unknown module.');
      }
      const disabledAppComponents = APP_COMPONENTS
        .map((component) => component.id)
        .filter((component) => !knownModules.includes(component));
      const settings = localSettings;
      const registrationDetails =
        response.registrationDetails === undefined
          ? undefined
          : parseRegistrationDetails(response.registrationDetails);
      if (
        registrationDetails &&
        (registrationDetails.systemCode !== systemCode || registrationDetails.appVersion !== appVersion)
      ) {
        throw new Error('The registered-system details do not match this device.');
      }
      const currentDisabled = [...(settings.disabledAppComponents || [])].sort();
      const nextDisabled = [...disabledAppComponents].sort();
      const registrationDetailsChanged =
        registrationDetails !== undefined &&
        !sameRegistrationDetails(settings.registrationDetails, registrationDetails);
      if (
        settings.registeredSystem !== true ||
        settings.appVersion !== appVersion ||
        (screenType !== undefined && settings.posScreenLayout !== screenType) ||
        currentDisabled.join(',') !== nextDisabled.join(',') ||
        registrationDetailsChanged
      ) {
        await updateSettings({
          registeredSystem: true,
          appVersion,
          disabledAppComponents,
          ...(screenType ? { posScreenLayout: screenType } : {}),
          ...(registrationDetails ? { registrationDetails } : {}),
        });
      }
      const businessName = (registrationDetails || localSettings.registrationDetails)?.businessName?.trim();
      return {
        status: 'registered',
        expiresAt: null,
        appVersion,
        ...(businessName ? { businessName } : {}),
        ...(screenType ? { screenType } : {}),
      };
    }

    if (localSettings.registeredSystem || Boolean(localSettings.registrationDetails)) {
      // Portal no longer considers this system registered. Clear local registration
      // state without destroying existing user accounts.
      await updateSettings({ registeredSystem: false, registrationDetails: undefined });
    }

    const expiresAt = response.expiresAt;
    const expirationTime = expiresAt === null ? null : Date.parse(expiresAt);
    if (expirationTime !== null && !Number.isFinite(expirationTime)) {
      throw new Error('The demo status service returned an invalid expiration date.');
    }

    if (response.revoked === true) {
      await clearDemoAccess();
      return { status: 'deactivated', expiresAt: null };
    }
    if (response.pendingRequest === true) {
      return { status: 'pending', expiresAt };
    }
    if (response.pendingActivation === true) {
      return { status: 'awaiting-activation', expiresAt };
    }
    if (response.previousRequest === true) {
      return { status: 'previous-request', expiresAt };
    }
    if (!response.active && expirationTime === null) {
      await clearDemoAccess();
      return { status: 'never', expiresAt: null };
    }
    if (expiresAt !== null && expirationTime !== null && expirationTime <= Date.now()) {
      await syncDemoAccessStatus(expiresAt);
      return { status: 'expired', expiresAt };
    }
    if (response.active && expiresAt !== null && expirationTime !== null) {
      const appVersion = APP_VERSIONS.find((version) => version === response.appVersion);
      const screenType = parsePosScreenLayout(response.screenType);
      if (!appVersion || !screenType || !Array.isArray(response.allowedModules)) {
        throw new Error('The demo system configuration is invalid.');
      }
      const allowedModules = response.allowedModules.filter(
        (module): module is AppComponentId =>
          typeof module === 'string' &&
          APP_COMPONENTS.some((component) => component.id === module)
      );
      if (allowedModules.length !== response.allowedModules.length) {
        throw new Error('The demo system configuration contains an unknown module.');
      }

      const demoPermissions = getDemoPermissions(allowedModules);
      const disabledAppComponents = APP_COMPONENTS
        .map((component) => component.id)
        .filter((component) => !allowedModules.includes(component));
      const nextPolicies = {
        ...localSettings.versionComponentPolicies,
        [appVersion]: allowedModules,
      };
      const currentDisabled = [...(localSettings.disabledAppComponents || [])].sort();
      const nextDisabled = [...disabledAppComponents].sort();
      if (
        localSettings.appVersion !== appVersion ||
        localSettings.posScreenLayout !== screenType ||
        currentDisabled.join(',') !== nextDisabled.join(',')
      ) {
        await updateSettings({
          appVersion,
          posScreenLayout: screenType,
          disabledAppComponents,
          versionComponentPolicies: nextPolicies,
        });
      } else if (
        JSON.stringify(localSettings.versionComponentPolicies?.[appVersion]) !==
        JSON.stringify(allowedModules)
      ) {
        await updateSettings({ versionComponentPolicies: nextPolicies });
      }

      const demoUsername = localSettings.demoUsername?.trim();
      if (demoUsername && demoUsername.toLowerCase() !== 'aptadmin') {
        const demoUser = (await listUsers()).find(
          (user) => user.username.toLowerCase() === demoUsername.toLowerCase()
        );
        if (
          demoUser &&
          (demoUser.role !== 'custom' ||
            [...demoUser.permissions].sort().join(',') !== [...demoPermissions].sort().join(','))
        ) {
          await updateUser(demoUser.id, {
            role: 'custom',
            permissions: demoPermissions,
          });
        }
      }

      await syncDemoAccessStatus(expiresAt);
      return {
        status: 'active',
        expiresAt,
        appVersion,
        screenType,
        permissions: demoPermissions,
      };
    }

    await clearDemoAccess();
    return { status: 'never', expiresAt: null };
  } catch (error) {
    if (!(error instanceof DemoPortalUnavailableError)) throw error;

    const settings = await getSettings();
    if (settings.systemCodeBlocked) {
      return { status: 'blocked', expiresAt: null };
    }
    if (settings.registeredSystem) {
      return { status: 'registered', expiresAt: null, appVersion: settings.appVersion };
    }
    const localAccess = await getDemoAccess();
    if (localAccess.status !== 'active') return localAccess;

    let offlineGraceStartedAt: number;
    try {
      offlineGraceStartedAt = Date.parse(await beginDemoOfflineGrace());
    } catch {
      // Corrupted offline-grace timestamp: treat as expired so the user
      // can reconnect to the portal and re-establish access.
      return { ...localAccess, offlineGraceExpired: true };
    }
    if (Date.now() - offlineGraceStartedAt >= DEMO_OFFLINE_GRACE_MS) {
      return { ...localAccess, offlineGraceExpired: true };
    }
    const appVersion = settings.appVersion || 'Standard';
    const allowedModules =
      settings.versionComponentPolicies?.[appVersion] ||
      APP_COMPONENTS
        .map((component) => component.id)
        .filter((component) => !settings.disabledAppComponents?.includes(component));
    return {
      ...localAccess,
      appVersion,
      screenType: settings.posScreenLayout,
      permissions: getDemoPermissions(allowedModules),
    };
  }
}

function getDemoLoginBlockMessage(status: string): string | null {
  switch (status) {
    case 'blocked':
      return 'System Code Blocked. Contact Service Provider.';
    case 'pending':
      return 'A demo request is pending approval. Sign-in is unavailable until a demo key is activated.';
    case 'awaiting-activation':
      return 'Activate the current demo key before signing in.';
    case 'deactivated':
      return 'Demo deactivated in your system. Please contact your service provider.';
    case 'previous-request':
      return 'This system has a previous demo request. Please contact your service provider.';
    default:
      return null;
  }
}

async function startServer(): Promise<Server> {
  await getDb();

  const app = express();
  const port = Number(process.env.POS_PORT || 3000);
  const host = process.env.POS_HOST || '0.0.0.0';
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid POS_PORT value: ${process.env.POS_PORT}`);
  }

  app.use(express.json({ limit: '50mb' }));
  app.use(express.raw({ type: 'application/octet-stream', limit: '100mb' }));
  if (process.env.NODE_ENV === 'production') {
    app.use((_req, res, next) => {
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
      );
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'no-referrer');
      next();
    });
  }

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, engine: 'sqlite' });
  });

  app.get('/api/registration/system-code', async (_req, res) => {
    try {
      res.json({ systemCode: await getRegistrationSystemCode() });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post('/api/registration/activate', async (req, res) => {
    try {
      const registrationKey = typeof req.body?.registrationKey === 'string'
        ? req.body.registrationKey.trim()
        : '';
      if ((!/^\d{16}$/.test(registrationKey) && registrationKey.length < 24) || registrationKey.length > 128) {
        res.status(400).json({ error: 'Enter the registration key provided by aptadmin.' });
        return;
      }

      const systemCode = await getRegistrationSystemCode();
      const prepared = await postToRegistrationPortal('/api/registration/key/prepare', {
        systemCode,
        registrationKey,
      });
      const appVersion = APP_VERSIONS.find((version) => version === prepared.appVersion);
      if (!appVersion) throw new Error('The Auth API returned an invalid registered version.');
      const registrationDetails = parseRegistrationDetails(prepared.registrationDetails);
      if (
        registrationDetails &&
        (registrationDetails.systemCode !== systemCode || registrationDetails.appVersion !== appVersion)
      ) {
        throw new Error('The Auth API returned inconsistent business registration details.');
      }

      if (prepared.active === true) {
        const credentials = parsePreparedRegistrationCredentials(prepared);
        const access = await getCurrentDemoAccess();
        if (access.status !== 'registered') {
          throw new Error('The registration is active, but this POS installation could not sync its access. Retry after checking the connection.');
        }
        if (credentials) await replaceUsersWithRegisteredAdmin(credentials);
        if (registrationDetails) await updateSettings({ registrationDetails });
        res.json({
          registered: true,
          username: typeof prepared.username === 'string' ? prepared.username : '',
          appVersion,
          ...(registrationDetails ? { businessName: registrationDetails.businessName } : {}),
          settings: await getSettings(),
        });
        return;
      }

      const credentials = parsePreparedRegistrationCredentials(prepared);
      if (!credentials) throw new Error('The Auth API did not provide the registered login credentials.');

      const activated = await postToRegistrationPortal('/api/registration/key/activate', {
        systemCode,
        registrationKey,
      });
      if (activated.registered !== true || activated.appVersion !== appVersion) {
        throw new Error('The Auth API did not confirm the requested system registration.');
      }

      const access = await getCurrentDemoAccess();
      if (access.status !== 'registered' || access.appVersion !== appVersion) {
        throw new Error('The system was activated but its registered access could not be synchronized. Retry registration.');
      }
      await replaceUsersWithRegisteredAdmin(credentials);
      if (registrationDetails) await updateSettings({ registrationDetails });
      res.json({
        registered: true,
        username: credentials.username,
        appVersion,
        ...(registrationDetails ? { businessName: registrationDetails.businessName } : {}),
        settings: await getSettings(),
      });
    } catch (error) {
      const status =
        typeof error === 'object' &&
        error !== null &&
        'status' in error &&
        typeof error.status === 'number' &&
        error.status >= 400 &&
        error.status < 500
          ? error.status
          : 502;
      res.status(status).json({
        error: error instanceof Error ? error.message : 'Could not activate this registration.',
      });
    }
  });

  app.get('/api/registration/demo-access', async (_req, res) => {
    try {
      const demoAccess = await getCurrentDemoAccess();
      if (demoAccess.offlineGraceExpired) {
        res.status(403).json({ error: DEMO_OFFLINE_GRACE_EXPIRED_MESSAGE });
        return;
      }
      res.json(demoAccess);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post('/api/registration/demo-requests', async (req, res) => {
    try {
      const input = req.body || {};
      if (input.requestType !== 'demo' && input.requestType !== 'extension') {
        res.status(400).json({ error: 'Choose demo activation or demo extension.' });
        return;
      }

      const systemCode = await getRegistrationSystemCode();
      if (typeof input.systemCode !== 'string' || input.systemCode.trim().toUpperCase() !== systemCode) {
        res.status(400).json({ error: 'The system code does not match this aptPOS installation.' });
        return;
      }

      const demoAccess = await getDemoAccess();
      if (input.requestType === 'extension' && demoAccess.status !== 'expired') {
        res.status(409).json({ error: 'A demo extension can only be requested after the demo expires.' });
        return;
      }
      if (input.requestType === 'demo' && demoAccess.status !== 'never') {
        res.status(409).json({ error: 'This installation already used a demo. Request an extension instead.' });
        return;
      }

      const requestedBy = typeof input.requestedBy === 'string' ? input.requestedBy.trim() : '';
      if (!/^[A-Za-z0-9._-]+$/.test(requestedBy) || requestedBy.toLowerCase() === 'aptadmin') {
        res.status(400).json({
          error: 'Enter a valid demo username. The username "aptadmin" is reserved.',
        });
        return;
      }

      const result = await postToDemoPortal('/api/registration/demo-requests', {
        requestType: input.requestType,
        systemCode,
        requestedBy,
      });
      res.status(201).json(result);
    } catch (err) {
      const status =
        typeof err === 'object' && err !== null && 'status' in err &&
        typeof err.status === 'number' && err.status >= 400 && err.status < 500
          ? err.status
          : 502;
      res.status(status).json({
        error: err instanceof Error ? err.message : 'Could not submit the demo request.',
      });
    }
  });

  app.post('/api/registration/demo-activate', async (req, res) => {
    try {
      const input = req.body || {};
      const systemCode = await getRegistrationSystemCode();
      const suppliedCode = typeof input.systemCode === 'string'
        ? input.systemCode.trim().toUpperCase()
        : '';
      const activationKey = typeof input.activationKey === 'string'
        ? input.activationKey.trim()
        : '';
      const username = typeof input.username === 'string' ? input.username.trim() : '';
      const password = typeof input.password === 'string' ? input.password : '';
      if (suppliedCode !== systemCode) {
        res.status(400).json({ error: 'The system code does not match this installation.' });
        return;
      }
      if (!activationKey || activationKey.length < 10 || activationKey.length > 256) {
        res.status(400).json({ error: 'Enter a valid demo key.' });
        return;
      }
      if (!/^[A-Za-z0-9._-]+$/.test(username) || username.toLowerCase() === 'aptadmin') {
        res.status(400).json({
          error: 'Enter a valid demo username. The username "aptadmin" is reserved.',
        });
        return;
      }
      if (!password) {
        res.status(400).json({ error: 'Enter a demo account password.' });
        return;
      }

      const result = await postToDemoPortal('/api/registration/demo-activation', {
        systemCode,
        activationKey,
      });
      if (!('expiresAt' in result) || typeof result.expiresAt !== 'string') {
        throw new Error('The demo activation service returned an invalid expiration date.');
      }
      const appVersion = APP_VERSIONS.find((version) => version === result.appVersion);
      const screenType =
        result.screenType === 'pos' || result.screenType === 'rpos'
          ? result.screenType
          : undefined;
      if (!appVersion || !screenType) {
        throw new Error('The demo activation service returned an invalid version or screen type.');
      }

      await clearRegisteredSystemSettings();
      await saveDemoAccess(result.expiresAt);
      const versionControl = await requestVersionControlPortal();
      const activePolicy = versionControl.versionComponentPolicies[appVersion];
      if (!activePolicy) {
        throw new Error(`The Auth API has no component policy for ${appVersion}.`);
      }
      const disabledAppComponents = APP_COMPONENTS
        .map((component) => component.id)
        .filter((component) => !activePolicy.includes(component));
      const permissions = getDemoPermissions(activePolicy);
      await updateSettings({
        appVersion,
        posScreenLayout: screenType,
        disabledAppComponents,
        versionComponentPolicies: versionControl.versionComponentPolicies,
        demoUsername: username,
      });

      const users = await listUsers();
      const existingUser = users.find((user) => user.username.toLowerCase() === username.toLowerCase());
      if (existingUser) {
        await updateUser(existingUser.id, {
          username,
          password,
          role: 'custom',
          displayName: username,
          permissions,
        });
      } else {
        await createUser({
          username,
          password,
          role: 'custom',
          displayName: username,
          permissions,
        });
      }
      res.json({
        expiresAt: result.expiresAt,
        username,
        appVersion,
        screenType,
        permissions,
      });
    } catch (err) {
      const status =
        typeof err === 'object' && err !== null && 'status' in err &&
        typeof err.status === 'number' && err.status >= 400 && err.status < 500
          ? err.status
          : 502;
      res.status(status).json({
        error: err instanceof Error ? err.message : 'Could not activate this demo.',
      });
    }
  });

  app.post('/api/registration/requests', async (req, res) => {
    try {
      const input = req.body || {};
      if (input.requestType !== 'demo' && input.requestType !== 'license') {
        res.status(400).json({ error: 'Choose demo activation or license registration.' });
        return;
      }

      const request = await createRegistrationRequest({
        requestType: input.requestType,
        systemCode: typeof input.systemCode === 'string' ? input.systemCode : '',
        submittedKey: typeof input.submittedKey === 'string' ? input.submittedKey : '',
        requestedBy: typeof input.requestedBy === 'string' ? input.requestedBy : '',
      });
      res.status(201).json({
        requestId: request.id,
        status: request.status,
        message: 'Your request was received and is awaiting approval.',
      });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post('/api/registration/admin/list', async (req, res) => {
    try {
      if (!(await isValidAppAdminPassword(req.body?.password))) {
        res.status(401).json({ error: 'Enter the valid aptadmin password to view requests.' });
        return;
      }
      res.json(await listRegistrationRequests());
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post('/api/registration/admin/:id/review', async (req, res) => {
    try {
      if (!(await isValidAppAdminPassword(req.body?.password))) {
        res.status(401).json({ error: 'Enter the valid aptadmin password to review requests.' });
        return;
      }
      const id = Number(req.params.id);
      const status = req.body?.status;
      if (!Number.isInteger(id) || id < 1 || (status !== 'approved' && status !== 'rejected')) {
        res.status(400).json({ error: 'Choose a valid request and review status.' });
        return;
      }
      const request = await reviewRegistrationRequest(id, status);
      if (!request) {
        res.status(404).json({ error: 'Request not found or already reviewed.' });
        return;
      }
      res.json(request);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post('/api/login', async (req, res) => {
    try {
      const cachedSettings = await getSettings();
      if (cachedSettings.systemCodeBlocked) {
        res.status(403).json({ error: 'System Code Blocked. Contact Service Provider.' });
        return;
      }

      const { username, password } = req.body || {};
      if (!username || !password) {
        res.status(400).json({ error: 'Username and password are required.' });
        return;
      }
      const user = await authenticateUser(String(username), String(password));
      if (!user) {
        res.status(401).json({ error: 'Invalid username or password.' });
        return;
      }
      if (user.username.toLowerCase() === 'demo') {
        const priorSettings = await getSettings();
        const priorRegistrationBlocked =
          priorSettings.registeredSystem || Boolean(priorSettings.registrationDetails);
        const demoAccess = await getCurrentDemoAccess('login');
        if (demoAccess.offlineGraceExpired) {
          res.status(403).json({ error: DEMO_OFFLINE_GRACE_EXPIRED_MESSAGE });
          return;
        }
        if (demoAccess.status === 'registered') {
          res.status(403).json({
            error: 'Demo credentials cannot be used on a registered system. Sign in with your registered username.',
          });
          return;
        }
        const demoLoginBlockMessage = getDemoLoginBlockMessage(demoAccess.status);
        if (demoLoginBlockMessage) {
          res.status(403).json({ error: demoLoginBlockMessage });
          return;
        }
        if (priorRegistrationBlocked) {
          res.status(403).json({
            error: 'This system registration is blocked or removed. Sign-in is unavailable until the system is registered again.',
          });
          return;
        }
        const demoIsActive = demoAccess.status === 'active';
        const registeredSystem = false;
        res.json({
          ok: true,
          user: {
            ...user,
            role: 'custom',
            permissions: demoIsActive
              ? demoAccess.permissions || []
              : ['register'],
            demoMode: !registeredSystem,
            registeredSystem,
            appVersion: demoAccess.appVersion,
            demoScreenType: demoAccess.screenType,
            demoExpiresAt: registeredSystem ? undefined : demoAccess.expiresAt || undefined,
          },
          demoAccess,
        });
        return;
      }
      const [localSettings, localDemoAccess] = await Promise.all([
        getSettings(),
        getDemoAccess(),
      ]);
      if (
        localSettings.registeredSystem ||
        Boolean(localSettings.registrationDetails) ||
        localDemoAccess.status !== 'never' ||
        Boolean(localSettings.demoUsername?.trim())
      ) {
        const systemAccess = await getCurrentDemoAccess('login');
        if (
          (localSettings.registeredSystem || Boolean(localSettings.registrationDetails)) &&
          systemAccess.status !== 'registered'
        ) {
          res.status(403).json({
            error: 'This system registration is blocked or removed. Sign-in is unavailable until the system is registered again.',
          });
          return;
        }
        if (
          localSettings.demoUsername?.trim().toLowerCase() === user.username.toLowerCase()
        ) {
          const demoLoginBlockMessage = getDemoLoginBlockMessage(systemAccess.status);
          if (demoLoginBlockMessage) {
            res.status(403).json({ error: demoLoginBlockMessage });
            return;
          }
        }
        if (systemAccess.status === 'registered') {
          res.json({
            ok: true,
            user: {
              ...user,
              registeredSystem: true,
              appVersion: systemAccess.appVersion,
            },
          });
          return;
        }
        if (systemAccess.status === 'active' && user.username.toLowerCase() !== 'aptadmin') {
          res.json({
            ok: true,
            user: {
              ...user,
              role: 'custom',
              permissions: systemAccess.permissions || [],
              demoMode: true,
              registeredSystem: false,
              appVersion: systemAccess.appVersion,
              demoScreenType: systemAccess.screenType,
              demoExpiresAt: systemAccess.expiresAt || undefined,
            },
            demoAccess: systemAccess,
          });
          return;
        }
      }
      res.json({ ok: true, user });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/users', async (_req, res) => {
    try {
      const users = await listUsers();
      res.json(users);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post('/api/users', async (req, res) => {
    try {
      const user = await createUser(req.body);
      res.status(201).json(user);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.put('/api/users/:id', async (req, res) => {
    try {
      const user = await updateUser(Number(req.params.id), req.body);
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }
      res.json(user);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.delete('/api/users/:id', async (req, res) => {
    try {
      await deleteUser(Number(req.params.id));
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.get('/api/inventory-options', async (_req, res) => {
    try {
      res.json(await listInventoryOptions());
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post('/api/translate/ar', async (req, res) => {
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (!text || text.length > 300) {
      res.status(400).json({ error: 'Enter text up to 300 characters to translate.' });
      return;
    }

    try {
      res.json({ translation: await translateEnglishToArabic(text) });
    } catch (error) {
      console.error('Arabic translation request failed:', error);
      res.status(error instanceof TranslationProviderError && error.status === 429 ? 429 : 502).json({
        error: (error as Error).message,
      });
    }
  });

  app.post('/api/inventory-options', async (req, res) => {
    try {
      res.status(201).json(await createInventoryOption(req.body || {}));
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.put('/api/inventory-options/:id', async (req, res) => {
    try {
      const option = await updateInventoryOption(Number(req.params.id), req.body || {});
      if (!option) {
        res.status(404).json({ error: 'Inventory option not found.' });
        return;
      }
      res.json(option);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.delete('/api/inventory-options/:id', async (req, res) => {
    try {
      await deleteInventoryOption(Number(req.params.id));
      res.json({ deleted: true });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.get('/api/products', async (req, res) => {
    try {
      const products = await listProducts({
        search: req.query.search as string | undefined,
        category: req.query.category as string | undefined,
        stockStatus: req.query.stockStatus as string | undefined,
      });
      res.json(products);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post('/api/products', async (req, res) => {
    try {
      const product = await createProduct(req.body);
      res.status(201).json(product);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post('/api/products/import', async (req, res) => {
    try {
      const items = Array.isArray(req.body?.items) ? req.body.items : (Array.isArray(req.body) ? req.body : []);
      if (!items || items.length === 0) {
        res.status(400).json({ error: 'No product rows provided for import.' });
        return;
      }
      const result = await importProducts(items);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.put('/api/products/:id', async (req, res) => {
    try {
      const updated = await updateProduct(Number(req.params.id), req.body);
      if (!updated) {
        res.status(404).json({ error: 'Product not found' });
        return;
      }
      res.json(updated);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.patch('/api/products/:id/stock', async (req, res) => {
    try {
      const delta = Number(req.body.delta ?? 0);
      const updated = await adjustProductStock(Number(req.params.id), delta);
      if (!updated) {
        res.status(404).json({ error: 'Product not found' });
        return;
      }
      res.json(updated);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.delete('/api/products/:id', async (req, res) => {
    try {
      const deleted = await deleteProduct(Number(req.params.id));
      if (!deleted) {
        res.status(404).json({ error: 'Product not found' });
        return;
      }
      res.json({ deleted: true });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.get('/api/sales', async (_req, res) => {
    try {
      const sales = await listSales();
      res.json(sales);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/sales-returns', async (_req, res) => {
    try {
      res.json(await listSalesReturnVouchers());
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/cashbook', async (_req, res) => {
    try {
      res.json(await getCashbookData());
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post('/api/cashbook/entries', async (req, res) => {
    try {
      const entry = await createCashbookEntry(req.body);
      res.status(201).json(entry);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.put('/api/cashbook/opening-balance', async (req, res) => {
    try {
      const openingBalance = await setCashbookOpeningBalance(req.body);
      res.json(openingBalance);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.get('/api/shifts', async (req, res) => {
    try {
      res.json(await listCashierShifts(req.query.cashierUsername));
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.get('/api/shifts/:id/report', async (req, res) => {
    try {
      const cashierUsername = req.query.cashierUsername;
      if (typeof cashierUsername !== 'string') {
        return res.status(400).json({ error: 'Cashier username is required.' });
      }
      res.json(await getCashierShiftReport(Number(req.params.id), cashierUsername));
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post('/api/shifts', async (req, res) => {
    try {
      const input = req.body || {};
      const cashierUsername = typeof input.cashierUsername === 'string'
        ? input.cashierUsername.trim()
        : '';
      if (!cashierUsername || typeof input.password !== 'string' || !input.password) {
        return res.status(400).json({ error: 'Cashier username and password are required.' });
      }
      const user = await authenticateUser(cashierUsername, input.password);
      if (!user) {
        return res.status(401).json({ error: 'Invalid username or password.' });
      }
      res.status(201).json(await openCashierShift({
        cashierUsername: user.username,
        cashierName: user.displayName || user.username,
        openingCash: input.openingCash,
      }));
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post('/api/shifts/:id/close', async (req, res) => {
    try {
      const input = req.body || {};
      const cashierUsername = typeof input.cashierUsername === 'string'
        ? input.cashierUsername.trim()
        : '';
      if (!cashierUsername || typeof input.password !== 'string' || !input.password) {
        return res.status(400).json({ error: 'Cashier username and password are required.' });
      }
      const user = await authenticateUser(cashierUsername, input.password);
      if (!user) {
        return res.status(401).json({ error: 'Invalid username or password.' });
      }
      res.json(await closeCashierShift({
        cashierUsername: user.username,
        closingCash: input.closingCash,
        id: Number(req.params.id),
      }));
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post('/api/sales', async (req, res) => {
    try {
      const result = await createSale(req.body);
      res.status(201).json(result);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post('/api/invoice-numbers', async (_req, res) => {
    try {
      res.status(201).json({ invoiceNumber: await createInvoiceNumber() });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post('/api/sales/:id/returns', async (req, res) => {
    try {
      const result = await createSaleReturn(Number(req.params.id), req.body);
      if (!result) {
        res.status(404).json({ error: 'Sale not found' });
        return;
      }
      res.status(201).json(result);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post('/api/sales-returns', async (req, res) => {
    try {
      const result = await createSalesReturnVoucher(req.body);
      if (!result) {
        res.status(404).json({ error: 'Sales invoices not found' });
        return;
      }
      res.status(201).json(result);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.put('/api/sales-returns/:id', async (req, res) => {
    try {
      const result = await updateSalesReturnVoucher(Number(req.params.id), req.body);
      if (!result) {
        res.status(404).json({ error: 'Sales return voucher not found' });
        return;
      }
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.delete('/api/sales-returns/:id', async (req, res) => {
    try {
      const deleted = await deleteSalesReturnVoucher(Number(req.params.id));
      if (!deleted) {
        res.status(404).json({ error: 'Sales return voucher not found' });
        return;
      }
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post('/api/sales/:id/void', async (req, res) => {
    try {
      const updated = await voidSale(Number(req.params.id));
      if (!updated) {
        res.status(404).json({ error: 'Sale not found' });
        return;
      }
      res.json(updated);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.put('/api/sales/:id', async (req, res) => {
    try {
      const updated = await updateSale(Number(req.params.id), req.body);
      if (!updated) {
        res.status(404).json({ error: 'Sale not found' });
        return;
      }
      res.json(updated);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.put('/api/sales/:id/invoice', async (req, res) => {
    try {
      const updated = await updateSaleInvoice(Number(req.params.id), req.body);
      if (!updated) {
        res.status(404).json({ error: 'Sale not found' });
        return;
      }
      res.json(updated);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.delete('/api/sales/:id', async (req, res) => {
    try {
      const deleted = await deleteSale(Number(req.params.id));
      if (!deleted) {
        res.status(404).json({ error: 'Sale not found' });
        return;
      }
      res.json({ deleted: true });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.get('/api/settings', async (_req, res) => {
    try {
      const settings = await getSettings();
      res.json(settings);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/version-control', async (_req, res) => {
    try {
      const versionControl = await requestVersionControlPortal();
      res.json(versionControl);
    } catch (error) {
      res.status(502).json({ error: (error as Error).message });
    }
  });

  app.put('/api/version-control', async (req, res) => {
    res.status(403).json({
      error: 'Version policies are managed from the aptPOS User Admin portal.',
    });
  });

  app.put('/api/settings', async (req, res) => {
    try {
      const settingsInput = { ...(req.body || {}) };
      delete settingsInput.appVersion;
      delete settingsInput.disabledAppComponents;
      delete settingsInput.versionComponentPolicies;
      delete settingsInput.demoUsername;
      delete settingsInput.registeredSystem;
      const settings = await updateSettings(settingsInput);
      res.json(settings);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post('/api/settings/activate-version', async (req, res) => {
    try {
      const input = req.body || {};
      if (typeof input.password !== 'string' || !input.password) {
        res.status(400).json({ error: 'App admin password is required.' });
        return;
      }

      const admin = await authenticateUser('aptadmin', input.password);
      if (!admin || admin.username.toLowerCase() !== 'aptadmin' || admin.role !== 'admin') {
        res.status(401).json({ error: 'Invalid app admin password.' });
        return;
      }

      const currentSystemAccess = await getCurrentDemoAccess();
      if (currentSystemAccess.status === 'registered' || (await getSettings()).registeredSystem) {
        res.status(403).json({
          error: 'Version and module permissions for this registered system are managed in the Auth app.',
        });
        return;
      }

      const appVersion = APP_VERSIONS.find((version) => version === input.appVersion);
      if (!appVersion) {
        res.status(400).json({ error: 'Choose a valid app version.' });
        return;
      }
      const versionControl = await requestVersionControlPortal();
      const activePolicy = versionControl.versionComponentPolicies[appVersion];
      if (!activePolicy) {
        throw new Error(`The Auth API has no component policy for ${appVersion}.`);
      }
      const activeDisabledComponents = APP_COMPONENTS
        .map((component) => component.id)
        .filter((component) => !activePolicy.includes(component));
      const settings = await updateSettings({
        appVersion,
        disabledAppComponents: activeDisabledComponents,
        versionComponentPolicies: versionControl.versionComponentPolicies,
      });
      res.json(settings);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.get('/api/print-queue', async (_req, res) => {
    try {
      const queue = await listPrintQueue();
      res.json(queue);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post('/api/print-queue/flush', async (_req, res) => {
    try {
      await flushPrintQueue();
      res.json({ flushed: true });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ----------------- CUSTOMERS API -----------------
  app.get('/api/customers', async (req, res) => {
    try {
      const customers = await listCustomers(req.query.search as string | undefined);
      res.json(customers);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post('/api/customers', async (req, res) => {
    try {
      const customer = await createCustomer(req.body);
      res.status(201).json(customer);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.put('/api/customers/:id', async (req, res) => {
    try {
      const updated = await updateCustomer(Number(req.params.id), req.body);
      if (!updated) {
        res.status(404).json({ error: 'Customer not found' });
        return;
      }
      res.json(updated);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.delete('/api/customers/:id', async (req, res) => {
    try {
      await deleteCustomer(Number(req.params.id));
      res.json({ deleted: true });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // ----------------- VENDORS API -----------------
  app.get('/api/vendors', async (req, res) => {
    try {
      const vendors = await listVendors(req.query.search as string | undefined);
      res.json(vendors);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post('/api/vendors', async (req, res) => {
    try {
      const vendor = await createVendor(req.body);
      res.status(201).json(vendor);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.put('/api/vendors/:id', async (req, res) => {
    try {
      const updated = await updateVendor(Number(req.params.id), req.body);
      if (!updated) {
        res.status(404).json({ error: 'Vendor not found' });
        return;
      }
      res.json(updated);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.delete('/api/vendors/:id', async (req, res) => {
    try {
      await deleteVendor(Number(req.params.id));
      res.json({ deleted: true });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // ----------------- PURCHASES API -----------------
  app.get('/api/purchase-returns', async (_req, res) => {
    try {
      res.json(await listPurchaseReturnVouchers());
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post('/api/purchase-returns', async (req, res) => {
    try {
      const voucher = await createPurchaseReturnVoucher(req.body);
      res.status(201).json(voucher);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.delete('/api/purchase-returns/:id', async (req, res) => {
    try {
      const deleted = await deletePurchaseReturnVoucher(Number(req.params.id));
      if (!deleted) {
        res.status(404).json({ error: 'Purchase return voucher not found.' });
        return;
      }
      res.json({ deleted: true });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.get('/api/purchases', async (_req, res) => {
    try {
      const purchases = await listPurchases();
      res.json(purchases);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post('/api/purchases', async (req, res) => {
    try {
      const purchase = await createPurchaseEntry(req.body);
      res.status(201).json(purchase);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.put('/api/purchases/:id', async (req, res) => {
    try {
      const updated = await updatePurchase(Number(req.params.id), req.body);
      if (!updated) {
        res.status(404).json({ error: 'Purchase entry not found' });
        return;
      }
      res.json(updated);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.delete('/api/purchases/:id', async (req, res) => {
    try {
      const deleted = await deletePurchase(Number(req.params.id));
      if (!deleted) {
        res.status(404).json({ error: 'Purchase entry not found' });
        return;
      }
      res.json({ deleted: true });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // ----------------- DATABASE MAINTENANCE & BACKUP -----------------
  app.post('/api/database/reset', async (req, res) => {
    try {
      if (!(await isValidAppAdminPassword(req.body?.password))) {
        res.status(401).json({ error: 'Invalid app admin password.' });
        return;
      }
      await resetDatabase();
      res.json({ ok: true, message: 'Database reset and re-seeded successfully.' });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/database/backup', async (_req, res) => {
    try {
      const buffer = await backupDatabase();
      const dateStr = new Date().toISOString().slice(0, 10);
      res.setHeader('Content-Type', 'application/x-sqlite3');
      res.setHeader('Content-Disposition', `attachment; filename="aptpos-backup-${dateStr}.sqlite"`);
      res.send(buffer);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post('/api/database/restore', async (req, res) => {
    try {
      let fileBuffer: Buffer | null = null;
      if (Buffer.isBuffer(req.body)) {
        fileBuffer = req.body;
      } else if (req.body?.base64) {
        fileBuffer = Buffer.from(req.body.base64, 'base64');
      } else if (typeof req.body === 'string') {
        fileBuffer = Buffer.from(req.body, 'base64');
      }

      if (!fileBuffer || fileBuffer.length === 0) {
        res.status(400).json({ error: 'No database backup file provided.' });
        return;
      }

      await restoreDatabase(fileBuffer);
      res.json({ ok: true, message: 'Database restored successfully.' });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const candidateDistPaths = [
      process.env.DIST_PATH,
      path.resolve(__dirname, '..', 'dist'),
      path.resolve(__dirname, 'dist'),
      path.resolve(process.cwd(), 'dist'),
    ].filter(Boolean) as string[];

    const distPath = candidateDistPaths.find((p) => fs.existsSync(p)) || path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = app.listen(port, host, () => {
    console.log(`aptPOS server running on http://${host}:${port}`);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  return server;
}

export { startServer };

if (process.env.POS_SERVER_AUTOSTART !== 'false') {
  void startServer().catch((error: unknown) => {
    console.error('Failed to start the aptPOS server:', error);
    process.exitCode = 1;
  });
}
