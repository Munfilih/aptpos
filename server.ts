import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import https from 'node:https';
import os from 'node:os';
import path from 'path';
import type { Server } from 'http';
import { fileURLToPath } from 'url';
import { ensureLocalTls } from './server/localTls';
import {
  activateZatcaProductionCsid,
  createDebitNoteForSale,
  getZatcaStatusSummary,
  onboardZatcaCompliance,
  processPendingZatcaQueue,
  processSaleForZatca,
  processSalesReturnForZatca,
  retryZatcaInvoice,
  runZatcaComplianceChecks,
} from './server/zatca/service';
import {
  adjustProductStock,
  assertCounterShiftOpen,
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
  getZatcaInvoiceByDocument,
  getZatcaInvoiceById,
  listZatcaInvoices,
  deletePurchase,
  deletePurchaseReturnVoucher,
  deleteSale,
  deleteUser,
  deleteVendor,
  getDashboardSummary,
  getDb,
  getDbEngine,
  getLinkedTerminal,
  hasDefaultAdminCredentials,
  getDemoAccess,
  beginDemoOfflineGrace,
  clearDemoAccess,
  getCashbookData,
  getCashierShiftReport,
  getDailyCounterShiftReport,
  getSettings,
  getRegistrationSystemCode,
  importProducts,
  listCustomers,
  listLinkedTerminals,
  listPrintQueue,
  markPrintQueueJobPrinted,
  listProducts,
  listInventoryOptions,
  listPurchases,
  listPurchaseReturnVouchers,
  listSales,
  listSalesPage,
  listCashierShifts,
  listSalesReturnVouchers,
  listRegistrationRequests,
  listUsers,
  listVendors,
  recordTerminalHeartbeat,
  removeLinkedTerminal,
  resetDatabase,
  restoreDatabase,
  removeBlockedSystemCredentials,
  replaceUsersWithRegisteredAdmin,
  reviewRegistrationRequest,
  saveDemoAccess,
  clearRegisteredSystemSettings,
  setLinkedTerminalStatus,
  syncDemoAccessStatus,
  syncLinkedTerminalsFromPortal,
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
  upsertLinkedTerminal,
  voidSale,
  setCashbookOpeningBalance,
  openCashierShift,
} from './server/db';
import { getLocalLanAddresses } from './server/systemIdentity';
import {
  buildPurchaseInvoicePrintData,
  buildPurchaseReturnPrintData,
  buildSalesInvoicePrintData,
  buildSalesReturnPrintData,
} from './src/utils/voucherPrintData';
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
const MIN_CLIENT_SHELL_VERSION = '1.0.44';

function readServerAppVersion(): string {
  try {
    const pkgPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
    const altPkgPath = path.resolve(process.cwd(), 'package.json');
    const target = fs.existsSync(pkgPath) ? pkgPath : altPkgPath;
    if (fs.existsSync(target)) {
      const parsed = JSON.parse(fs.readFileSync(target, 'utf8')) as { version?: unknown };
      if (typeof parsed.version === 'string' && parsed.version.trim()) {
        return parsed.version.trim();
      }
    }
  } catch {
    // Fallback below
  }
  return '1.0.44';
}

const SERVER_APP_VERSION = readServerAppVersion();

function normalizeRemoteIp(rawIp: string | undefined): string {
  if (!rawIp) return '';
  return rawIp.replace(/^::ffff:/i, '').trim();
}

function isLoopbackIp(rawIp: string | undefined): boolean {
  const ip = normalizeRemoteIp(rawIp);
  return ip === '127.0.0.1' || ip === '::1' || ip === 'localhost' || ip === '';
}

function isValidSystemCodeFormat(code: string): boolean {
  return /^\d{10}$/.test(code) || /^APT(?:-[A-Z0-9]{4}){5}$/.test(code);
}

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
      if (Array.isArray(response.additionalSystems)) {
        try {
          const synced = response.additionalSystems.flatMap((item: unknown) => {
            if (!item || typeof item !== 'object') return [];
            const obj = item as Record<string, unknown>;
            const clientSystemCode = typeof obj.clientSystemCode === 'string'
              ? obj.clientSystemCode.trim().toUpperCase()
              : '';
            const status: 'active' | 'blocked' | 'pending' | null =
              obj.status === 'active'
                ? 'active'
                : obj.status === 'blocked'
                  ? 'blocked'
                  : obj.status === 'pending'
                    ? 'pending'
                    : null;
            if (!clientSystemCode || !status) return [];
            return [{
              clientSystemCode,
              terminalName: typeof obj.terminalName === 'string' ? obj.terminalName : undefined,
              status,
            }];
          });
          await syncLinkedTerminalsFromPortal(synced);
        } catch (syncErr) {
          console.warn('Could not sync additional systems list from Admin Portal:', syncErr);
        }
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

  // ----------------- REAL-TIME LAN SSE EVENT BROADCASTER -----------------
  const sseClients = new Set<express.Response>();
  const broadcastChange = (resource: string, sourceTerminal?: string): void => {
    if (sseClients.size === 0) return;
    const payload = `event: change\ndata: ${JSON.stringify({
      resource,
      sourceTerminal: sourceTerminal || '',
      at: new Date().toISOString(),
    })}\n\n`;
    for (const client of sseClients) {
      try {
        client.write(payload);
      } catch {
        sseClients.delete(client);
      }
    }
  };

  const sseKeepAlive = setInterval(() => {
    for (const client of sseClients) {
      try {
        client.write(': ping\n\n');
      } catch {
        sseClients.delete(client);
      }
    }
  }, 25_000);
  sseKeepAlive.unref();

  const mapPathToResource = (pathname: string): string | null => {
    if (pathname.startsWith('/api/products')) return 'products';
    if (pathname.startsWith('/api/inventory-options')) return 'inventory-options';
    if (pathname.startsWith('/api/sales-returns')) return 'sales';
    if (pathname.startsWith('/api/sales')) return 'sales';
    if (pathname.startsWith('/api/purchase-returns')) return 'purchases';
    if (pathname.startsWith('/api/purchases')) return 'purchases';
    if (pathname.startsWith('/api/customers')) return 'customers';
    if (pathname.startsWith('/api/vendors')) return 'vendors';
    if (pathname.startsWith('/api/settings')) return 'settings';
    if (pathname.startsWith('/api/shifts')) return 'shifts';
    if (pathname.startsWith('/api/users')) return 'users';
    if (pathname.startsWith('/api/cashbook')) return 'cashbook';
    if (pathname.startsWith('/api/terminals')) return 'terminals';
    return null;
  };

  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
      const resource = mapPathToResource(req.path);
      if (resource) {
        const sourceTerminal = (req.header('x-terminal-system-code') || '').trim().toUpperCase();
        res.on('finish', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            broadcastChange(resource, sourceTerminal);
          }
        });
      }
    }
    next();
  });

  // ----------------- LAN ADDITIONAL SYSTEM AUTHORIZATION GATE -----------------
  const lastHeartbeatStamp = new Map<string, number>();
  type ClientTerminalAccessResult = {
    authorized: boolean;
    status: 'active' | 'blocked' | 'pending' | 'awaiting-activation' | 'expired' | 'unregistered';
    demoStatus:
      | 'registered'
      | 'active'
      | 'blocked'
      | 'pending'
      | 'awaiting-activation'
      | 'expired'
      | 'deactivated'
      | 'previous-request'
      | 'never';
    licenseType: 'registered' | 'demo';
    expiresAt: string | null;
    terminalName: string;
  };
  const CLIENT_PORTAL_CACHE_TTL_MS = 60_000;
  const clientPortalStatusCache = new Map<
    string,
    { checkedAt: number; result: ClientTerminalAccessResult }
  >();

  const verifyClientTerminalAccess = async (
    clientCode: string,
    options?: { forceRefresh?: boolean; terminalName?: string; remoteIp?: string; shellVersion?: string }
  ): Promise<ClientTerminalAccessResult> => {
    const code = clientCode.trim().toUpperCase();
    const cached = clientPortalStatusCache.get(code);
    if (!options?.forceRefresh && cached && Date.now() - cached.checkedAt < CLIENT_PORTAL_CACHE_TTL_MS) {
      if (
        cached.result.authorized &&
        cached.result.licenseType === 'demo' &&
        cached.result.expiresAt &&
        Date.parse(cached.result.expiresAt) <= Date.now()
      ) {
        // Demo expired since last check — fall through to refresh
      } else {
        return cached.result;
      }
    }

    const existing = await getLinkedTerminal(code);
    const resolvedName =
      options?.terminalName?.trim() || existing?.terminalName || `Counter ${code.slice(-4)}`;

    // Store admin explicitly blocked this terminal locally on the Primary Server
    if (existing?.status === 'blocked' && !options?.forceRefresh) {
      const blockedResult: ClientTerminalAccessResult = {
        authorized: false,
        status: 'blocked',
        demoStatus: 'blocked',
        licenseType: existing.licenseType,
        expiresAt: existing.expiresAt,
        terminalName: resolvedName,
      };
      clientPortalStatusCache.set(code, { checkedAt: Date.now(), result: blockedResult });
      return blockedResult;
    }

    try {
      const portal = await postToDemoPortal(
        '/api/registration/demo-status-check',
        { systemCode: code, eventType: 'check' },
        8000
      );

      let result: ClientTerminalAccessResult;
      if (portal.blocked === true || existing?.status === 'blocked') {
        if (existing?.status !== 'blocked') {
          await upsertLinkedTerminal({
            clientSystemCode: code,
            terminalName: resolvedName,
            status: 'blocked',
            lastIp: options?.remoteIp,
            shellVersion: options?.shellVersion,
          });
        }
        result = {
          authorized: false,
          status: 'blocked',
          demoStatus: 'blocked',
          licenseType: existing?.licenseType || 'registered',
          expiresAt: null,
          terminalName: resolvedName,
        };
      } else if (portal.registered === true && portal.active === true) {
        await upsertLinkedTerminal({
          clientSystemCode: code,
          terminalName: resolvedName,
          status: 'active',
          licenseType: 'registered',
          expiresAt: null,
          lastIp: options?.remoteIp,
          shellVersion: options?.shellVersion,
        });
        result = {
          authorized: true,
          status: 'active',
          demoStatus: 'registered',
          licenseType: 'registered',
          expiresAt: null,
          terminalName: resolvedName,
        };
      } else if (
        portal.active === true &&
        typeof portal.expiresAt === 'string' &&
        Date.parse(portal.expiresAt) > Date.now()
      ) {
        await upsertLinkedTerminal({
          clientSystemCode: code,
          terminalName: resolvedName,
          status: 'active',
          licenseType: 'demo',
          expiresAt: portal.expiresAt,
          lastIp: options?.remoteIp,
          shellVersion: options?.shellVersion,
        });
        result = {
          authorized: true,
          status: 'active',
          demoStatus: 'active',
          licenseType: 'demo',
          expiresAt: portal.expiresAt,
          terminalName: resolvedName,
        };
      } else if (portal.revoked === true) {
        if (existing && existing.status === 'active') {
          await upsertLinkedTerminal({
            clientSystemCode: code,
            terminalName: resolvedName,
            status: 'pending',
            licenseType: 'demo',
            expiresAt: null,
          });
        }
        result = {
          authorized: false,
          status: 'unregistered',
          demoStatus: 'deactivated',
          licenseType: 'demo',
          expiresAt: null,
          terminalName: resolvedName,
        };
      } else if (typeof portal.expiresAt === 'string' && Date.parse(portal.expiresAt) <= Date.now()) {
        if (existing && existing.status === 'active') {
          await upsertLinkedTerminal({
            clientSystemCode: code,
            terminalName: resolvedName,
            status: 'pending',
            licenseType: 'demo',
            expiresAt: portal.expiresAt,
          });
        }
        result = {
          authorized: false,
          status: 'expired',
          demoStatus: 'expired',
          licenseType: 'demo',
          expiresAt: portal.expiresAt,
          terminalName: resolvedName,
        };
      } else if (portal.pendingRequest === true) {
        result = {
          authorized: false,
          status: 'pending',
          demoStatus: 'pending',
          licenseType: 'demo',
          expiresAt: null,
          terminalName: resolvedName,
        };
      } else if (portal.pendingActivation === true) {
        result = {
          authorized: false,
          status: 'awaiting-activation',
          demoStatus: 'awaiting-activation',
          licenseType: 'demo',
          expiresAt: null,
          terminalName: resolvedName,
        };
      } else {
        if (existing && existing.status === 'active') {
          await upsertLinkedTerminal({
            clientSystemCode: code,
            terminalName: resolvedName,
            status: 'pending',
            licenseType: existing.licenseType,
            expiresAt: null,
          });
        }
        result = {
          authorized: false,
          status: 'unregistered',
          demoStatus: portal.previousRequest === true ? 'previous-request' : 'never',
          licenseType: existing?.licenseType || 'registered',
          expiresAt: null,
          terminalName: resolvedName,
        };
      }

      clientPortalStatusCache.set(code, { checkedAt: Date.now(), result });
      return result;
    } catch (err) {
      if (!(err instanceof DemoPortalUnavailableError)) {
        // Non-network portal error — fall back safely to cached local record below
      }
      if (existing?.status === 'blocked') {
        return {
          authorized: false,
          status: 'blocked',
          demoStatus: 'blocked',
          licenseType: existing.licenseType,
          expiresAt: existing.expiresAt,
          terminalName: resolvedName,
        };
      }
      if (existing?.status === 'active') {
        if (
          existing.licenseType === 'demo' &&
          existing.expiresAt &&
          Date.parse(existing.expiresAt) <= Date.now()
        ) {
          return {
            authorized: false,
            status: 'expired',
            demoStatus: 'expired',
            licenseType: 'demo',
            expiresAt: existing.expiresAt,
            terminalName: resolvedName,
          };
        }
        const offlineResult: ClientTerminalAccessResult = {
          authorized: true,
          status: 'active',
          demoStatus: existing.licenseType === 'registered' ? 'registered' : 'active',
          licenseType: existing.licenseType,
          expiresAt: existing.expiresAt,
          terminalName: resolvedName,
        };
        clientPortalStatusCache.set(code, { checkedAt: Date.now(), result: offlineResult });
        return offlineResult;
      }
      return {
        authorized: false,
        status: existing?.status === 'pending' ? 'pending' : 'unregistered',
        demoStatus: 'never',
        licenseType: existing?.licenseType || 'registered',
        expiresAt: existing?.expiresAt || null,
        terminalName: resolvedName,
      };
    }
  };

  const LAN_AUTH_EXEMPT_PATHS = new Set([
    '/api/health',
    '/api/network/info',
    '/api/terminals/status',
    '/api/terminals/register',
    '/api/terminals/request',
    '/api/terminals/activate',
    '/api/terminals/demo-request',
    '/api/terminals/demo-activate',
  ]);

  app.use('/api', async (req, res, next) => {
    try {
      const fullPath = `/api${req.path}`;
      if (LAN_AUTH_EXEMPT_PATHS.has(fullPath)) {
        next();
        return;
      }

      const remoteIp = normalizeRemoteIp(req.socket.remoteAddress);
      const isLocal = isLoopbackIp(remoteIp);
      const headerCode = (
        req.header('x-terminal-system-code') ||
        (typeof req.query.terminalCode === 'string' ? req.query.terminalCode : '')
      )
        .trim()
        .toUpperCase();

      let primarySystemCode = '';
      try {
        primarySystemCode = await getRegistrationSystemCode();
      } catch {
        primarySystemCode = '';
      }

      // Localhost requests without a foreign terminal code are always the Primary Server itself.
      if (isLocal && (!headerCode || headerCode === primarySystemCode)) {
        next();
        return;
      }

      const settings = await getSettings();
      const storeName = settings.storeName || 'aptPOS Primary Server';

      if (!headerCode || !isValidSystemCodeFormat(headerCode)) {
        res.status(403).json({
          error: 'Additional system identification (System Code) is required to connect to this server.',
          code: 'TERMINAL_NOT_REGISTERED',
          clientSystemCode: headerCode,
          primarySystemCode,
          storeName,
        });
        return;
      }

      // If a request carries the Primary PC's own code from its own LAN IP, allow it.
      if (primarySystemCode && headerCode === primarySystemCode) {
        next();
        return;
      }

      const access = await verifyClientTerminalAccess(headerCode, {
        terminalName: req.header('x-terminal-name') || undefined,
        remoteIp,
        shellVersion: req.header('x-terminal-shell-version') || undefined,
      });

      if (access.status === 'blocked') {
        res.status(403).json({
          error: 'This additional system has been blocked. Contact your service provider or store admin.',
          code: 'TERMINAL_BLOCKED',
          clientSystemCode: headerCode,
          primarySystemCode,
          storeName,
          terminalName: access.terminalName,
          demoStatus: access.demoStatus,
        });
        return;
      }

      if (!access.authorized) {
        res.status(403).json({
          error:
            access.status === 'expired'
              ? 'This additional system demo has expired. Register under your Serial Key or request a demo extension.'
              : 'This additional system is not registered yet. Register under your Serial Key or activate a Demo.',
          code: 'TERMINAL_NOT_REGISTERED',
          clientSystemCode: headerCode,
          primarySystemCode,
          storeName,
          terminalName: access.terminalName,
          demoStatus: access.demoStatus,
          expiresAt: access.expiresAt,
        });
        return;
      }

      // Throttled heartbeat update (every 30s per active terminal)
      const nowMs = Date.now();
      const lastStamp = lastHeartbeatStamp.get(headerCode) || 0;
      if (nowMs - lastStamp > 30_000) {
        lastHeartbeatStamp.set(headerCode, nowMs);
        void recordTerminalHeartbeat(headerCode, {
          lastIp: remoteIp,
          terminalName: req.header('x-terminal-name') || undefined,
          shellVersion: req.header('x-terminal-shell-version') || undefined,
        }).catch(() => {});
      }

      next();
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  if (process.env.NODE_ENV === 'production') {
    app.use((_req, res, next) => {
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self'; worker-src 'self'; manifest-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
      );
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'no-referrer');
      next();
    });
  }

  // Ensure PWA manifest & Service Worker always ship with proper MIME types and update-friendly headers
  app.use((req, res, next) => {
    if (req.path === '/sw.js') {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Service-Worker-Allowed', '/');
    } else if (req.path === '/manifest.webmanifest') {
      res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
    }
    next();
  });

  const httpsPortValue = Number(process.env.POS_HTTPS_PORT || port + 400);
  const tlsDataDir = process.env.POS_DATA_DIR || path.resolve(process.cwd(), 'data');

  // Certificate download so phones/tablets can trust this server (needed to install aptPOS as a real app)
  app.get('/aptpos-ca.crt', async (_req, res) => {
    try {
      const tls = await ensureLocalTls(tlsDataDir);
      res.setHeader('Content-Type', 'application/x-x509-ca-cert');
      res.setHeader('Content-Disposition', 'attachment; filename="aptpos-ca.crt"');
      res.send(tls.cert);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/health', async (_req, res) => {
    try {
      const settings = await getSettings();
      let primarySystemCode = '';
      try {
        primarySystemCode = await getRegistrationSystemCode();
      } catch {
        primarySystemCode = '';
      }
      res.json({
        ok: true,
        engine: 'sqlite',
        dbEngine: getDbEngine(),
        serverVersion: SERVER_APP_VERSION,
        minClientShellVersion: MIN_CLIENT_SHELL_VERSION,
        storeName: settings.storeName || 'aptPOS',
        primarySystemCode,
        mode: process.env.POS_TERMINAL_MODE || (host === '0.0.0.0' ? 'primary-server' : 'standalone'),
        hostname: os.hostname(),
      });
    } catch {
      res.json({ ok: true, engine: 'sqlite', dbEngine: getDbEngine(), serverVersion: SERVER_APP_VERSION });
    }
  });

  app.get('/api/network/info', async (_req, res) => {
    try {
      const settings = await getSettings();
      let primarySystemCode = '';
      try {
        primarySystemCode = await getRegistrationSystemCode();
      } catch {
        primarySystemCode = '';
      }
      res.json({
        mode: process.env.POS_TERMINAL_MODE || (host === '0.0.0.0' ? 'primary-server' : 'standalone'),
        port,
        httpsPort: httpsPortValue,
        host,
        hostname: os.hostname(),
        primarySystemCode,
        storeName: settings.storeName || 'aptPOS',
        serverVersion: SERVER_APP_VERSION,
        dbEngine: getDbEngine(),
        lanAddresses: getLocalLanAddresses(),
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    res.write(`retry: 3000\nevent: ready\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);
    sseClients.add(res);
    req.on('close', () => {
      sseClients.delete(res);
    });
  });

  // ----------------- ADDITIONAL LAN TERMINALS REGISTRATION & MANAGEMENT -----------------
  app.get('/api/terminals/status', async (req, res) => {
    try {
      const remoteIp = normalizeRemoteIp(req.socket.remoteAddress);
      const isLocal = isLoopbackIp(remoteIp);
      const clientCode = (
        req.header('x-terminal-system-code') ||
        (typeof req.query.clientSystemCode === 'string' ? req.query.clientSystemCode : '')
      )
        .trim()
        .toUpperCase();
      const settings = await getSettings();
      let primarySystemCode = '';
      try {
        primarySystemCode = await getRegistrationSystemCode();
      } catch {
        primarySystemCode = '';
      }

      if ((isLocal && !clientCode) || (clientCode && primarySystemCode && clientCode === primarySystemCode)) {
        res.json({
          registered: true,
          status: 'active',
          demoStatus: settings.registeredSystem ? 'registered' : 'active',
          licenseType: settings.registeredSystem ? 'registered' : 'demo',
          expiresAt: null,
          isPrimary: true,
          clientSystemCode: primarySystemCode,
          primarySystemCode,
          storeName: settings.storeName || 'aptPOS',
          terminalName: os.hostname(),
        });
        return;
      }

      if (!clientCode || !isValidSystemCodeFormat(clientCode)) {
        res.json({
          registered: false,
          status: 'unregistered',
          demoStatus: 'never',
          licenseType: 'registered',
          expiresAt: null,
          isPrimary: false,
          clientSystemCode: clientCode,
          primarySystemCode,
          storeName: settings.storeName || 'aptPOS',
          terminalName: '',
        });
        return;
      }

      const access = await verifyClientTerminalAccess(clientCode, {
        forceRefresh: true,
        terminalName: req.header('x-terminal-name') || undefined,
        remoteIp,
        shellVersion: req.header('x-terminal-shell-version') || undefined,
      });

      res.json({
        registered: access.authorized,
        status: access.status,
        demoStatus: access.demoStatus,
        licenseType: access.licenseType,
        expiresAt: access.expiresAt,
        isPrimary: false,
        clientSystemCode: clientCode,
        primarySystemCode,
        storeName: settings.storeName || 'aptPOS',
        terminalName: access.terminalName,
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Path 1: Register Additional System under Business Serial / License Key (same as normal /api/registration/activate, without touching Primary DB users/settings)
  const handleTerminalSerialRegister = async (req: express.Request, res: express.Response) => {
    try {
      const clientSystemCode = (
        (typeof req.body?.clientSystemCode === 'string' ? req.body.clientSystemCode : '') ||
        req.header('x-terminal-system-code') ||
        ''
      )
        .trim()
        .toUpperCase();
      const registrationKey = (
        (typeof req.body?.registrationKey === 'string' ? req.body.registrationKey : '') ||
        (typeof req.body?.activationKey === 'string' ? req.body.activationKey : '')
      ).trim();
      const terminalName = typeof req.body?.terminalName === 'string'
        ? req.body.terminalName.trim().slice(0, 80)
        : (req.header('x-terminal-name') || '').trim().slice(0, 80);

      if (!isValidSystemCodeFormat(clientSystemCode)) {
        res.status(400).json({ error: 'A valid 10-digit System Code is required.' });
        return;
      }
      if ((!/^\d{16}$/.test(registrationKey) && registrationKey.length < 24) || registrationKey.length > 128) {
        res.status(400).json({ error: 'Enter the 16-digit Serial / Registration Key provided by aptadmin.' });
        return;
      }

      const prepared = await postToRegistrationPortal('/api/registration/key/prepare', {
        systemCode: clientSystemCode,
        registrationKey,
      });
      const appVersion = APP_VERSIONS.find((version) => version === prepared.appVersion);
      if (!appVersion) {
        throw new Error('The Auth API returned an invalid registered version.');
      }

      if (prepared.active !== true) {
        const activated = await postToRegistrationPortal('/api/registration/key/activate', {
          systemCode: clientSystemCode,
          registrationKey,
        });
        if (activated.registered !== true) {
          throw new Error('The Auth API did not confirm registration for this device.');
        }
      }

      const remoteIp = normalizeRemoteIp(req.socket.remoteAddress);
      const terminal = await upsertLinkedTerminal({
        clientSystemCode,
        terminalName: terminalName || `Counter ${clientSystemCode.slice(-4)}`,
        status: 'active',
        licenseType: 'registered',
        expiresAt: null,
        lastIp: remoteIp,
        shellVersion: req.header('x-terminal-shell-version') || '',
      });
      clientPortalStatusCache.delete(clientSystemCode);
      broadcastChange('terminals', clientSystemCode);
      res.json({
        activated: true,
        licenseType: 'registered',
        appVersion,
        terminal,
      });
    } catch (err) {
      const status =
        typeof err === 'object' && err !== null && 'status' in err &&
        typeof err.status === 'number' && err.status >= 400 && err.status < 500
          ? err.status
          : 502;
      res.status(status).json({
        error: err instanceof Error ? err.message : 'Could not register this device under the serial key.',
      });
    }
  };

  app.post('/api/terminals/register', handleTerminalSerialRegister);
  app.post('/api/terminals/activate', handleTerminalSerialRegister);

  // Path 2A: Request normal Demo Key (or Extension) for Additional System (same as normal /api/registration/demo-requests)
  const handleTerminalDemoRequest = async (req: express.Request, res: express.Response) => {
    try {
      const clientSystemCode = (
        (typeof req.body?.clientSystemCode === 'string' ? req.body.clientSystemCode : '') ||
        req.header('x-terminal-system-code') ||
        ''
      )
        .trim()
        .toUpperCase();
      const terminalName = typeof req.body?.terminalName === 'string'
        ? req.body.terminalName.trim().slice(0, 80)
        : (req.header('x-terminal-name') || '').trim().slice(0, 80);
      const requestType = req.body?.requestType === 'extension' ? 'extension' : 'demo';
      const requestedByRaw =
        (typeof req.body?.requestedBy === 'string' ? req.body.requestedBy.trim() : '') ||
        terminalName ||
        `Counter_${clientSystemCode.slice(-4)}`;
      const requestedBy = requestedByRaw.slice(0, 80);

      if (!isValidSystemCodeFormat(clientSystemCode)) {
        res.status(400).json({ error: 'A valid 10-digit System Code is required.' });
        return;
      }
      const primarySystemCode = await getRegistrationSystemCode();
      if (clientSystemCode === primarySystemCode) {
        res.status(400).json({ error: 'This PC is already the Primary Server.' });
        return;
      }

      const remoteIp = normalizeRemoteIp(req.socket.remoteAddress);
      const portalRes = await postToDemoPortal('/api/registration/demo-requests', {
        requestType,
        systemCode: clientSystemCode,
        requestedBy,
      });

      await upsertLinkedTerminal({
        clientSystemCode,
        terminalName: terminalName || `Counter ${clientSystemCode.slice(-4)}`,
        status: 'pending',
        licenseType: 'demo',
        lastIp: remoteIp,
        shellVersion: req.header('x-terminal-shell-version') || '',
      });
      clientPortalStatusCache.delete(clientSystemCode);
      broadcastChange('terminals', clientSystemCode);
      res.status(201).json(portalRes);
    } catch (err) {
      const status =
        typeof err === 'object' && err !== null && 'status' in err &&
        typeof err.status === 'number' && err.status >= 400 && err.status < 500
          ? err.status
          : 502;
      res.status(status).json({
        error: err instanceof Error ? err.message : 'Could not submit the demo key request.',
      });
    }
  };

  app.post('/api/terminals/demo-request', handleTerminalDemoRequest);
  app.post('/api/terminals/request', handleTerminalDemoRequest);

  // Path 2B: Activate normal Demo Key for Additional System (same as normal /api/registration/demo-activation, without touching Primary DB users/settings)
  app.post('/api/terminals/demo-activate', async (req, res) => {
    try {
      const clientSystemCode = (
        (typeof req.body?.clientSystemCode === 'string' ? req.body.clientSystemCode : '') ||
        req.header('x-terminal-system-code') ||
        ''
      )
        .trim()
        .toUpperCase();
      const activationKey = typeof req.body?.activationKey === 'string'
        ? req.body.activationKey.trim()
        : '';
      const terminalName = typeof req.body?.terminalName === 'string'
        ? req.body.terminalName.trim().slice(0, 80)
        : (req.header('x-terminal-name') || '').trim().slice(0, 80);

      if (!isValidSystemCodeFormat(clientSystemCode)) {
        res.status(400).json({ error: 'A valid 10-digit System Code is required.' });
        return;
      }
      if (!activationKey || activationKey.length < 10 || activationKey.length > 256) {
        res.status(400).json({ error: 'Enter a valid demo key.' });
        return;
      }

      const portalRes = await postToDemoPortal('/api/registration/demo-activation', {
        systemCode: clientSystemCode,
        activationKey,
      });
      if (!('expiresAt' in portalRes) || typeof portalRes.expiresAt !== 'string') {
        throw new Error('The demo activation service returned an invalid expiration date.');
      }

      const remoteIp = normalizeRemoteIp(req.socket.remoteAddress);
      const terminal = await upsertLinkedTerminal({
        clientSystemCode,
        terminalName: terminalName || `Counter ${clientSystemCode.slice(-4)}`,
        status: 'active',
        licenseType: 'demo',
        expiresAt: portalRes.expiresAt,
        lastIp: remoteIp,
        shellVersion: req.header('x-terminal-shell-version') || '',
      });
      clientPortalStatusCache.delete(clientSystemCode);
      broadcastChange('terminals', clientSystemCode);
      res.json({
        activated: true,
        licenseType: 'demo',
        expiresAt: portalRes.expiresAt,
        terminal,
      });
    } catch (err) {
      const status =
        typeof err === 'object' && err !== null && 'status' in err &&
        typeof err.status === 'number' && err.status >= 400 && err.status < 500
          ? err.status
          : 502;
      res.status(status).json({
        error: err instanceof Error ? err.message : 'Could not activate the demo key for this device.',
      });
    }
  });

  app.post('/api/terminals/heartbeat', async (req, res) => {
    try {
      const clientCode = (req.header('x-terminal-system-code') || '').trim().toUpperCase();
      if (clientCode && isValidSystemCodeFormat(clientCode)) {
        await recordTerminalHeartbeat(clientCode, {
          lastIp: normalizeRemoteIp(req.socket.remoteAddress),
          terminalName: typeof req.body?.terminalName === 'string' ? req.body.terminalName : undefined,
          screenMode: typeof req.body?.screenMode === 'string' ? req.body.screenMode : undefined,
          shellVersion:
            (typeof req.body?.shellVersion === 'string' ? req.body.shellVersion : '') ||
            req.header('x-terminal-shell-version') ||
            undefined,
        });
      }
      res.json({ ok: true, serverTime: new Date().toISOString() });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/terminals', async (_req, res) => {
    try {
      res.json(await listLinkedTerminals());
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.patch('/api/terminals/:code', async (req, res) => {
    try {
      const code = String(req.params.code || '').trim().toUpperCase();
      if (!isValidSystemCodeFormat(code)) {
        res.status(400).json({ error: 'Invalid terminal System Code.' });
        return;
      }
      const status =
        req.body?.status === 'active' || req.body?.status === 'blocked' || req.body?.status === 'pending'
          ? req.body.status
          : undefined;
      const terminalName = typeof req.body?.terminalName === 'string' ? req.body.terminalName : undefined;
      const existing = await getLinkedTerminal(code);
      if (!existing && status) {
        const created = await upsertLinkedTerminal({
          clientSystemCode: code,
          terminalName,
          status,
        });
        res.json(created);
        return;
      }
      const updated = await setLinkedTerminalStatus(code, status || existing?.status || 'active', terminalName);
      if (!updated) {
        res.status(404).json({ error: 'Linked terminal not found.' });
        return;
      }
      clientPortalStatusCache.delete(code);
      res.json(updated);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.delete('/api/terminals/:code', async (req, res) => {
    try {
      const code = String(req.params.code || '').trim().toUpperCase();
      const removed = await removeLinkedTerminal(code);
      if (!removed) {
        res.status(404).json({ error: 'Linked terminal not found.' });
        return;
      }
      clientPortalStatusCache.delete(code);
      res.json({ deleted: true });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.get('/api/dashboard/summary', async (_req, res) => {
    try {
      res.json(await getDashboardSummary());
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
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

  app.get('/api/sales', async (req, res) => {
    try {
      const hasPaginationParams =
        req.query.page !== undefined ||
        req.query.limit !== undefined ||
        req.query.dateFrom !== undefined ||
        req.query.dateTo !== undefined ||
        req.query.search !== undefined ||
        req.query.status !== undefined;
      if (hasPaginationParams) {
        const result = await listSalesPage({
          dateFrom: typeof req.query.dateFrom === 'string' ? req.query.dateFrom : undefined,
          dateTo: typeof req.query.dateTo === 'string' ? req.query.dateTo : undefined,
          search: typeof req.query.search === 'string' ? req.query.search : undefined,
          status: typeof req.query.status === 'string' ? req.query.status : undefined,
          page: req.query.page !== undefined ? Number(req.query.page) : 1,
          limit: req.query.limit !== undefined ? Number(req.query.limit) : 100,
        });
        res.json(result);
        return;
      }
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
      await assertCounterShiftOpen();
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

  app.get('/api/shifts/daily-report', async (req, res) => {
    try {
      res.json(await getDailyCounterShiftReport(req.query.date));
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
      await assertCounterShiftOpen();
      const result = await createSale(req.body);
      let zatca: unknown = null;
      if (result?.sale?.id && result.sale.status === 'COMPLETED') {
        try {
          zatca = await processSaleForZatca(result.sale.id);
        } catch (zatcaErr) {
          console.error('ZATCA Phase 2 sale submission error:', zatcaErr);
          zatca = { error: (zatcaErr as Error).message };
        }
      }
      res.status(201).json(zatca ? { ...result, zatca } : result);
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
      await assertCounterShiftOpen();
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
      await assertCounterShiftOpen();
      const result = await createSalesReturnVoucher(req.body);
      if (!result) {
        res.status(404).json({ error: 'Sales invoices not found' });
        return;
      }
      let zatca: unknown = null;
      if (result.voucher?.id) {
        try {
          const reason = typeof req.body?.reason === 'string' ? req.body.reason : 'Customer return / refund';
          zatca = await processSalesReturnForZatca(result.voucher.id, reason);
        } catch (zatcaErr) {
          console.error('ZATCA Phase 2 credit note error:', zatcaErr);
          zatca = { error: (zatcaErr as Error).message };
        }
      }
      res.status(201).json(zatca ? { ...result, zatca } : result);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // --- ZATCA Phase 2 Direct Fatoora API Routes ---
  app.get('/api/zatca/status', async (_req, res) => {
    try {
      res.json(await getZatcaStatusSummary());
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post('/api/zatca/onboard/compliance', async (req, res) => {
    try {
      const environment =
        req.body?.environment === 'simulation' || req.body?.environment === 'production'
          ? req.body.environment
          : 'sandbox';
      const otp = String(req.body?.otp || '');
      const businessCategory = typeof req.body?.businessCategory === 'string' ? req.body.businessCategory : 'Retail';
      const result = await onboardZatcaCompliance({ environment, otp, businessCategory });
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post('/api/zatca/onboard/compliance-checks', async (_req, res) => {
    try {
      const report = await runZatcaComplianceChecks();
      res.json(report);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post('/api/zatca/onboard/production', async (_req, res) => {
    try {
      const result = await activateZatcaProductionCsid();
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.get('/api/zatca/invoices', async (req, res) => {
    try {
      const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
      const rows = (await listZatcaInvoices(limit)).map((r) => ({
        id: r.id,
        documentType: r.documentType,
        documentId: r.documentId,
        invoiceNumber: r.invoiceNumber,
        uuid: r.uuid,
        invoiceTypeCode: r.invoiceTypeCode,
        invoiceSubtype: r.invoiceSubtype,
        icv: r.icv,
        invoiceHash: r.invoiceHash,
        submissionStatus: r.submissionStatus,
        warnings: JSON.parse(r.zatcaWarningsJson || '[]'),
        errors: JSON.parse(r.zatcaErrorsJson || '[]'),
        retryCount: r.retryCount,
        submittedAt: r.submittedAt,
        createdAt: r.createdAt,
      }));
      res.json({ invoices: rows });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/zatca/invoices/:id/xml', async (req, res) => {
    try {
      const record = await getZatcaInvoiceById(Number(req.params.id));
      if (!record) {
        res.status(404).json({ error: 'ZATCA invoice not found.' });
        return;
      }
      const xml = record.xmlCleared || record.xmlSigned;
      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${record.invoiceNumber.replace(/[^a-zA-Z0-9_-]/g, '_')}.xml"`
      );
      res.send(xml);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post('/api/zatca/invoices/:id/retry', async (req, res) => {
    try {
      const updated = await retryZatcaInvoice(Number(req.params.id));
      res.json(updated);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post('/api/zatca/debit-notes', async (req, res) => {
    try {
      const saleId = Number(req.body?.saleId);
      const amountExclTax = Number(req.body?.amountExclTax);
      const taxRate = req.body?.taxRate !== undefined ? Number(req.body.taxRate) : undefined;
      const reason = String(req.body?.reason || '');
      const created = await createDebitNoteForSale({ saleId, amountExclTax, taxRate, reason });
      res.status(201).json(created);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post('/api/zatca/queue/flush', async (_req, res) => {
    try {
      const processed = await processPendingZatcaQueue();
      res.json({ processed });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
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

  app.get('/api/print-data/:voucherType/:id', async (req, res) => {
    try {
      const voucherId = Number(req.params.id);
      if (!Number.isInteger(voucherId) || voucherId <= 0) {
        res.status(400).json({ error: 'A valid voucher ID is required.' });
        return;
      }

      const settings = await getSettings();
      const voucherType = req.params.voucherType;
      if (voucherType === 'sales-invoice') {
        const sale = (await listSales()).find((entry) => entry.id === voucherId);
        if (!sale) {
          res.status(404).json({ error: 'Sales invoice was not found.' });
          return;
        }
        const customers = await listCustomers();
        const customer = customers.find((entry) => entry.id === sale.customerId)
          || customers.find((entry) => entry.name === sale.customerName);
        const context = buildSalesInvoicePrintData(sale, settings, customer);
        const zatcaRecord = await getZatcaInvoiceByDocument('SALE', sale.id);
        if (zatcaRecord?.qrPhase2) {
          context.voucher.eInvoiceQrCodePhase2 = zatcaRecord.qrPhase2;
        }
        res.json({
          voucherType,
          context,
        });
        return;
      }
      if (voucherType === 'sales-return') {
        const voucher = (await listSalesReturnVouchers()).find((entry) => entry.id === voucherId);
        if (!voucher) {
          res.status(404).json({ error: 'Sales return voucher was not found.' });
          return;
        }
        const sourceSale = (await listSales()).find((sale) =>
          voucher.sourceInvoices.includes(sale.receiptNumber)
        );
        const context = buildSalesReturnPrintData(voucher, settings, sourceSale?.customerName);
        const zatcaRecord = await getZatcaInvoiceByDocument('SALES_RETURN', voucher.id);
        if (zatcaRecord?.qrPhase2) {
          context.voucher.eInvoiceQrCodePhase2 = zatcaRecord.qrPhase2;
        }
        res.json({
          voucherType,
          context,
        });
        return;
      }
      if (voucherType === 'purchase-invoice') {
        const purchase = (await listPurchases()).find((entry) => entry.id === voucherId);
        if (!purchase) {
          res.status(404).json({ error: 'Purchase invoice was not found.' });
          return;
        }
        const vendor = (await listVendors()).find((entry) => entry.id === purchase.vendorId);
        res.json({
          voucherType,
          context: buildPurchaseInvoicePrintData(purchase, settings, vendor),
        });
        return;
      }
      if (voucherType === 'purchase-return') {
        const voucher = (await listPurchaseReturnVouchers()).find((entry) => entry.id === voucherId);
        if (!voucher) {
          res.status(404).json({ error: 'Purchase return voucher was not found.' });
          return;
        }
        const vendor = (await listVendors()).find((entry) => entry.id === voucher.vendorId);
        res.json({
          voucherType,
          context: buildPurchaseReturnPrintData(voucher, settings, vendor),
        });
        return;
      }

      res.status(404).json({ error: 'Unsupported voucher type.' });
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

  app.post('/api/print-queue/:id/printed', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) {
      res.status(400).json({ error: 'Print queue job ID is invalid.' });
      return;
    }
    try {
      const updated = await markPrintQueueJobPrinted(id);
      if (!updated) {
        res.status(404).json({ error: 'Queued print job was not found.' });
        return;
      }
      res.json({ printed: true });
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
      await assertCounterShiftOpen();
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
      await assertCounterShiftOpen();
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

  // Local HTTPS listener (LAN only) so Android/iOS can install aptPOS as a full-screen app
  if (host === '0.0.0.0') {
    void ensureLocalTls(tlsDataDir)
      .then((tls) => {
        const secureServer = https.createServer({ key: tls.key, cert: tls.cert }, app);
        secureServer.on('error', (err) => {
          console.warn(`Local HTTPS server could not start on :${httpsPortValue}:`, err.message);
        });
        secureServer.listen(httpsPortValue, host, () => {
          console.log(`aptPOS HTTPS server running on https://${host}:${httpsPortValue}`);
        });
        server.on('close', () => secureServer.close());
      })
      .catch((err) => console.warn('Local HTTPS certificate could not be created:', err));
  }

  // Background ZATCA Phase 2 reporting queue worker (batched every 15s for 5,000+ invoices/day SLA)
  const zatcaQueueTimer = setInterval(() => {
    void processPendingZatcaQueue().catch((err) => {
      console.error('ZATCA background reporting queue error:', err);
    });
  }, 15_000);
  zatcaQueueTimer.unref();

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
