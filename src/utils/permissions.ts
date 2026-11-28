import type { UserSession } from '../types/pos';

export type PermissionAction = 'view' | 'add' | 'edit' | 'delete' | 'print';

export type PermissionModuleId =
  | 'sales'
  | 'sales-return'
  | 'purchases'
  | 'purchase-return'
  | 'inventory'
  | 'barcode-print'
  | 'customers'
  | 'vendors'
  | 'accounts'
  | 'reports'
  | 'shift'
  | 'files'
  | 'zatca'
  | 'settings';

export interface PermissionModuleDefinition {
  id: PermissionModuleId;
  label: string;
  labelAr: string;
  description: string;
  actions: PermissionAction[];
}

export const PERMISSION_MODULES: PermissionModuleDefinition[] = [
  {
    id: 'sales',
    label: 'Sales (POS / ERP)',
    labelAr: 'المبيعات',
    description: 'POS register, sales entry, sales history & invoices',
    actions: ['view', 'add', 'edit', 'delete', 'print'],
  },
  {
    id: 'sales-return',
    label: 'Sales Returns',
    labelAr: 'مرتجعات المبيعات',
    description: 'Return register & sales return vouchers',
    actions: ['view', 'add', 'edit', 'delete', 'print'],
  },
  {
    id: 'purchases',
    label: 'Purchases',
    labelAr: 'المشتريات',
    description: 'Purchase entry, vendor bills & purchase history',
    actions: ['view', 'add', 'edit', 'delete', 'print'],
  },
  {
    id: 'purchase-return',
    label: 'Purchase Returns',
    labelAr: 'مرتجعات المشتريات',
    description: 'Supplier return register & history',
    actions: ['view', 'add', 'delete', 'print'],
  },
  {
    id: 'inventory',
    label: 'Inventory / Products',
    labelAr: 'المخزون والمنتجات',
    description: 'Products, stock levels, pricing & categories',
    actions: ['view', 'add', 'edit', 'delete', 'print'],
  },
  {
    id: 'barcode-print',
    label: 'Barcode Printing',
    labelAr: 'طباعة الباركود',
    description: 'Scan products & print custom barcode labels',
    actions: ['view', 'print'],
  },
  {
    id: 'customers',
    label: 'Customers',
    labelAr: 'العملاء',
    description: 'Customer directory & balances',
    actions: ['view', 'add', 'edit', 'delete'],
  },
  {
    id: 'vendors',
    label: 'Vendors',
    labelAr: 'الموردون',
    description: 'Supplier directory & payables',
    actions: ['view', 'add', 'edit', 'delete'],
  },
  {
    id: 'accounts',
    label: 'Accounts & Cashbook',
    labelAr: 'الحسابات ودفتر النقدية',
    description: 'General ledger, payments & cashbook',
    actions: ['view', 'add', 'print'],
  },
  {
    id: 'reports',
    label: 'Reports',
    labelAr: 'التقارير',
    description: 'Financial, sales, purchase & VAT reports',
    actions: ['view', 'print'],
  },
  {
    id: 'shift',
    label: 'Shift Management',
    labelAr: 'إدارة الورديات',
    description: 'Counter shift open, close & drawer report',
    actions: ['view', 'print'],
  },
  {
    id: 'files',
    label: 'Files & Exports',
    labelAr: 'الملفات والتصدير',
    description: 'Document archive & exports',
    actions: ['view', 'print'],
  },
  {
    id: 'zatca',
    label: 'E-Invoicing (ZATCA)',
    labelAr: 'الفوترة الإلكترونية',
    description: 'ZATCA Phase 1 & Phase 2 compliance & onboarding',
    actions: ['view', 'edit'],
  },
  {
    id: 'settings',
    label: 'Settings',
    labelAr: 'الإعدادات',
    description: 'Store configuration, printing & system settings',
    actions: ['view', 'edit'],
  },
];

export const ALL_ACTION_LABELS: Record<PermissionAction, { en: string; ar: string }> = {
  view: { en: 'View', ar: 'عرض' },
  add: { en: 'Add', ar: 'إضافة' },
  edit: { en: 'Edit', ar: 'تعديل' },
  delete: { en: 'Delete', ar: 'حذف' },
  print: { en: 'Print', ar: 'طباعة' },
};

export function makePermissionToken(moduleId: PermissionModuleId, action: PermissionAction): string {
  return `${moduleId}:${action}`;
}

export function getFullAdminPermissions(): string[] {
  const tokens = new Set<string>([
    'register',
    'sales',
    'edit-sales',
    'delete-sales',
    'sales-return',
    'manage-sales-returns',
    'purchases',
    'purchase-history',
    'purchase-return-register',
    'purchase-return-history',
    'inventory',
    'barcode-print',
    'customers',
    'vendors',
    'accounts',
    'reports',
    'shift',
    'files',
    'zatca',
    'settings',
  ]);
  for (const mod of PERMISSION_MODULES) {
    for (const action of mod.actions) {
      tokens.add(makePermissionToken(mod.id, action));
    }
  }
  return Array.from(tokens);
}

export function getDefaultCashierPermissions(): string[] {
  return syncLegacyPermissionTokens([
    'sales:view',
    'sales:add',
    'sales:print',
    'sales-return:view',
    'sales-return:add',
    'sales-return:print',
    'customers:view',
    'customers:add',
    'shift:view',
    'shift:print',
    'reports:view',
  ]);
}

const GRANULAR_MARKER = '__granular__';

/**
 * Checks whether a permission array was saved using the granular Module × Action matrix.
 */
function isGranularPermissionSet(permissions: string[]): boolean {
  return permissions.includes(GRANULAR_MARKER) || permissions.some((p) => p.includes(':'));
}

/**
 * Resolves whether a raw permissions array grants a specific module + action.
 * Supports both granular tokens (`sales:add`, `sales:edit`, etc.) and legacy tokens (`register`, `sales`, `edit-sales`, etc.).
 */
export function permissionsGrantAction(
  permissions: string[] | undefined | null,
  moduleId: PermissionModuleId,
  action: PermissionAction
): boolean {
  const list = Array.isArray(permissions) ? permissions : [];
  if (list.length === 0) return false;

  const token = makePermissionToken(moduleId, action);
  if (list.includes(token)) return true;

  // Once a user's permissions are managed by the granular matrix, respect explicit
  // `module:action` tokens strictly so disabled modules never re-enable via legacy fallbacks.
  if (isGranularPermissionSet(list)) {
    return false;
  }

  // Backward-compatible legacy token resolution:
  switch (moduleId) {
    case 'sales':
      if (action === 'add') return list.includes('register');
      if (action === 'view') return list.includes('sales') || list.includes('register');
      if (action === 'print') return list.includes('sales') || list.includes('register');
      if (action === 'edit') return list.includes('edit-sales');
      if (action === 'delete') return list.includes('delete-sales');
      return false;
    case 'sales-return':
      if (action === 'view' || action === 'add' || action === 'print') {
        return list.includes('sales-return') || list.includes('manage-sales-returns');
      }
      if (action === 'edit' || action === 'delete') {
        return list.includes('manage-sales-returns');
      }
      return false;
    case 'purchases':
      return list.includes('purchases') || list.includes('purchase-history');
    case 'purchase-return':
      return (
        list.includes('purchase-return-register') ||
        list.includes('purchase-return-history') ||
        list.includes('purchases')
      );
    case 'inventory':
      return list.includes('inventory');
    case 'barcode-print':
      return list.includes('barcode-print') || list.includes('inventory');
    case 'customers':
      return list.includes('customers');
    case 'vendors':
      return list.includes('vendors');
    case 'accounts':
      return list.includes('accounts');
    case 'reports':
      return list.includes('reports') || list.includes('sales');
    case 'shift':
      return list.includes('shift') || list.includes('register');
    case 'files':
      return list.includes('files');
    case 'zatca':
      return list.includes('zatca');
    case 'settings':
      return list.includes('settings');
    default:
      return false;
  }
}

/**
 * Checks whether a user session has permission for a given module & action.
 * Admin role & company admin (aptadmin) always have full access.
 */
export function hasModuleAction(
  user: UserSession | null | undefined,
  moduleId: PermissionModuleId,
  action: PermissionAction
): boolean {
  if (!user) return false;
  if (user.role === 'admin' || user.username.toLowerCase() === 'aptadmin') {
    return true;
  }
  return permissionsGrantAction(user.permissions, moduleId, action);
}

/**
 * Checks whether a user has ANY action enabled for a module (used for tab/navigation visibility).
 */
export function hasAnyModuleAccess(
  user: UserSession | null | undefined,
  moduleId: PermissionModuleId
): boolean {
  if (!user) return false;
  if (user.role === 'admin' || user.username.toLowerCase() === 'aptadmin') {
    return true;
  }
  const mod = PERMISSION_MODULES.find((m) => m.id === moduleId);
  if (!mod) return false;
  return mod.actions.some((action) => permissionsGrantAction(user.permissions, moduleId, action));
}

/**
 * Expands any legacy permissions into explicit granular tokens so the Access Control UI
 * accurately reflects every currently granted action when editing an existing user.
 */
export function normalizeToGranularPermissions(permissions: string[] | undefined | null): string[] {
  const result: string[] = [];
  for (const mod of PERMISSION_MODULES) {
    for (const action of mod.actions) {
      if (permissionsGrantAction(permissions, mod.id, action)) {
        result.push(makePermissionToken(mod.id, action));
      }
    }
  }
  return syncLegacyPermissionTokens(result);
}

/**
 * Keeps legacy permission tokens synchronized alongside granular `module:action` tokens
 * so navigation bars, backend checks, and older clients remain 100% compatible.
 */
export function syncLegacyPermissionTokens(granularTokens: string[]): string[] {
  const next = new Set<string>([GRANULAR_MARKER, ...granularTokens.filter((t) => t.includes(':'))]);

  const has = (mod: PermissionModuleId, action: PermissionAction) =>
    next.has(makePermissionToken(mod, action));
  const hasAny = (mod: PermissionModuleId) => {
    const def = PERMISSION_MODULES.find((m) => m.id === mod);
    return def ? def.actions.some((a) => has(mod, a)) : false;
  };

  // Sales
  if (has('sales', 'add')) next.add('register');
  if (has('sales', 'view') || has('sales', 'edit') || has('sales', 'delete') || has('sales', 'print')) {
    next.add('sales');
  }
  if (has('sales', 'edit')) next.add('edit-sales');
  if (has('sales', 'delete')) next.add('delete-sales');

  // Sales Returns
  if (hasAny('sales-return')) next.add('sales-return');
  if (has('sales-return', 'edit') || has('sales-return', 'delete')) {
    next.add('manage-sales-returns');
  }

  // Purchases & Purchase Returns
  if (hasAny('purchases')) {
    next.add('purchases');
    next.add('purchase-history');
  }
  if (hasAny('purchase-return')) {
    next.add('purchase-return-register');
    next.add('purchase-return-history');
  }

  // Other modules
  if (hasAny('inventory')) next.add('inventory');
  if (hasAny('barcode-print')) next.add('barcode-print');
  if (hasAny('customers')) next.add('customers');
  if (hasAny('vendors')) next.add('vendors');
  if (hasAny('accounts')) next.add('accounts');
  if (hasAny('reports')) next.add('reports');
  if (hasAny('shift')) next.add('shift');
  if (hasAny('files')) next.add('files');
  if (hasAny('zatca')) next.add('zatca');
  if (hasAny('settings')) next.add('settings');

  return Array.from(next);
}

/**
 * Formats a concise human-readable permission summary for the Users list row.
 */
export function formatPermissionSummary(permissions: string[] | undefined | null, isRtl = false): string {
  const parts: string[] = [];
  for (const mod of PERMISSION_MODULES) {
    const enabledActions = mod.actions.filter((action) =>
      permissionsGrantAction(permissions, mod.id, action)
    );
    if (enabledActions.length === 0) continue;
    const modLabel = isRtl ? mod.labelAr : mod.label.split(' (')[0];
    if (enabledActions.length === mod.actions.length) {
      parts.push(modLabel);
    } else {
      const actionNames = enabledActions
        .map((a) => (isRtl ? ALL_ACTION_LABELS[a].ar : ALL_ACTION_LABELS[a].en))
        .join(', ');
      parts.push(`${modLabel} (${actionNames})`);
    }
  }
  return parts.length > 0 ? parts.join(' · ') : (isRtl ? 'بدون صلاحيات' : 'No access');
}
