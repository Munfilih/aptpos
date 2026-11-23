export type ProductCategory = string;

export type ThemeMode = 'light' | 'medium' | 'dark';

export const APP_VERSIONS = ['Soft', 'Silver', 'Standard'] as const;
export type AppVersion = (typeof APP_VERSIONS)[number];

export type SettingsSectionId =
  | 'sales'
  | 'screen'
  | 'store'
  | 'printer'
  | 'users'
  | 'database'
  | 'registration'
  | 'version'
  | 'updates';

export const APP_COMPONENTS = [
  { id: 'register', label: 'Counter', labelAr: 'نقطة البيع' },
  { id: 'inventory', label: 'Inventory', labelAr: 'المخزون' },
  { id: 'purchases', label: 'Purchases', labelAr: 'المشتريات' },
  { id: 'purchase-history', label: 'Purchase History', labelAr: 'سجل المشتريات' },
  { id: 'purchase-return-register', label: 'Purchase Returns', labelAr: 'مرتجعات المشتريات' },
  { id: 'purchase-return-history', label: 'Purchase Return History', labelAr: 'سجل مرتجعات المشتريات' },
  { id: 'customers', label: 'Customers', labelAr: 'العملاء' },
  { id: 'vendors', label: 'Vendors', labelAr: 'الموردون' },
  { id: 'sales', label: 'Sales History', labelAr: 'سجل المبيعات' },
  { id: 'return-register', label: 'Sales Returns', labelAr: 'مرتجعات المبيعات' },
  { id: 'return-history', label: 'Sales Return History', labelAr: 'سجل مرتجعات المبيعات' },
  { id: 'accounts', label: 'Accounts & Cash Book', labelAr: 'الحسابات ودفتر النقدية' },
  { id: 'reports', label: 'Reports', labelAr: 'التقارير' },
  { id: 'shift', label: 'Shift', labelAr: 'الوردية' },
  { id: 'files', label: 'Files', labelAr: 'الملفات' },
] as const;

export type AppComponentId = (typeof APP_COMPONENTS)[number]['id'];
export type VersionComponentPolicies = Partial<Record<AppVersion, AppComponentId[]>>;

export type InventoryOptionType = 'category' | 'brand' | 'taxRate' | 'unit';

export interface InventoryOption {
  id: number;
  type: InventoryOptionType;
  value: string;
  imageData?: string;
  isDefault?: boolean;
}

export interface ProductMultiUnit {
  id: string;
  name: string;
  barcode: string;
  unitsPerBase: number;
  price: number | null;
}

export interface ProductAdditionalBarcode {
  barcode: string;
  unitId: string | null;
}

export type UserRole = 'admin' | 'cashier' | 'custom';

export type TaxType = 'inclusive' | 'exclusive';

export type PosScreenLayout = 'pos' | 'rpos';

export interface UserSession {
  id?: number;
  username: string;
  role: UserRole;
  displayName: string;
  permissions?: string[];
  demoMode?: boolean;
  demoExpiresAt?: string;
  registeredSystem?: boolean;
  appVersion?: AppVersion;
}

export interface UserAccount {
  id: number;
  username: string;
  role: UserRole;
  displayName: string;
  permissions: string[];
}

export type RegistrationRequestType = 'demo' | 'license';
export type RegistrationRequestStatus = 'pending' | 'approved' | 'rejected';
export type DemoAccessStatus = 'never' | 'active' | 'expired' | 'registered';

export interface RegistrationRequest {
  id: number;
  requestType: RegistrationRequestType;
  systemCode: string;
  submittedKey: string;
  requestedBy: string;
  status: RegistrationRequestStatus;
  createdAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
}

export interface Customer {
  id: number;
  name: string;
  nameAr?: string;
  phone: string;
  email: string;
  address: string;
  buildingNo?: string;
  streetName?: string;
  district?: string;
  city?: string;
  postalCode?: string;
  country?: string;
  vatNumber?: string;
  crNumber?: string;
  notes: string;
  createdAt: string;
  totalSpent: number;
  ordersCount: number;
}

export interface Vendor {
  id: number;
  name: string;
  nameAr?: string;
  contactPerson: string;
  phone: string;
  email: string;
  address: string;
  buildingNo?: string;
  streetName?: string;
  district?: string;
  city?: string;
  postalCode?: string;
  country?: string;
  taxNumber: string;
  crNumber?: string;
  createdAt: string;
  totalPurchased: number;
  purchasesCount: number;
}

export interface Product {
  id: number;
  sku: string;
  barcode: string;
  name: string;
  nameAr?: string;
  category: string;
  brand?: string;
  costPrice: number;
  retailPrice: number;
  taxRate?: number; // Tax percentage (e.g. 15%)
  imageData?: string;
  imagePath?: string;
  stock: number;
  reorderLevel: number;
  unit: string;
  multiUnits?: ProductMultiUnit[];
  additionalBarcodes?: ProductAdditionalBarcode[];
  updatedAt: string;
}

export interface CartItem {
  product: Product;
  quantity: number;
  unitId?: string;
  unitName?: string;
  unitsPerBase?: number;
  lineId?: string;
  scannedBarcode?: string;
}

export type PaymentMethod = 'Cash' | 'Card' | 'Split' | (string & {});

export interface SaleItem {
  id: number;
  saleId: number;
  productId: number;
  sku: string;
  productName: string;
  nameAr?: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  unitId?: string;
  unitName?: string;
  unitsPerBase?: number;
  returnedQuantity?: number;
  taxRate?: number;
  taxAmount?: number;
  discountAmount?: number;
}

export interface Sale {
  id: number;
  receiptNumber: string;
  kotNumber?: string;
  createdAt: string;
  cashierName: string;
  customerName: string;
  customerId?: number | null;
  subtotal: number;
  discountType: 'percent' | 'fixed';
  discountValue: number;
  discountAmount: number;
  taxType?: TaxType;
  taxRate: number;
  taxAmount: number;
  total: number;
  paymentMethod: PaymentMethod;
  amountTendered: number;
  changeDue: number;
  status: 'COMPLETED' | 'VOIDED';
  returnStatus?: 'PARTIAL' | 'FULL';
  returnedTotal?: number;
  returnedTaxAmount?: number;
  returnPaymentMethods?: PaymentMethod[];
  items: SaleItem[];
}

export interface CreateSaleReturnInput {
  cashierName: string;
  paymentMethod: PaymentMethod;
  items: Array<{
    saleItemId: number;
    quantity: number;
  }>;
}

export interface CreateSalesReturnVoucherInput {
  cashierName: string;
  paymentMethod: PaymentMethod;
  sales: Array<{
    saleId: number;
    items: Array<{
      saleItemId: number;
      quantity: number;
    }>;
  }>;
}

export interface SalesReturnVoucherItem {
  saleId: number;
  receiptNumber: string;
  saleItemId: number;
  productName: string;
  nameAr?: string;
  sku: string;
  quantity: number;
  unitName?: string;
  refundAmount: number;
}

export interface SalesReturnVoucher {
  id: number;
  voucherNumber: string;
  createdAt: string;
  cashierName: string;
  paymentMethod: PaymentMethod;
  refundAmount: number;
  taxRefundAmount: number;
  sourceInvoices: string[];
  items: SalesReturnVoucherItem[];
}

export interface PurchaseItem {
  id: number;
  purchaseId: number;
  productId: number;
  sku: string;
  productName: string;
  quantity: number;
  unitCost: number;
  lineTotal: number;
}

export interface PurchaseEntry {
  id: number;
  invoiceNumber: string;
  vendorId: number;
  vendorName: string;
  createdAt: string;
  receivedDate: string;
  subtotal: number;
  taxAmount: number;
  shippingCost: number;
  total: number;
  paidAmount: number;
  paymentStatus: 'PAID' | 'PENDING' | 'PARTIAL';
  notes: string;
  items: PurchaseItem[];
}

export interface PurchaseReturnItem {
  id: number;
  voucherId: number;
  purchaseItemId: number;
  productId: number;
  sku: string;
  productName: string;
  quantity: number;
  unitCost: number;
  lineTotal: number;
}

export interface PurchaseReturnVoucher {
  id: number;
  voucherNumber: string;
  purchaseId: number;
  invoiceNumber: string;
  vendorId: number;
  vendorName: string;
  createdAt: string;
  subtotal: number;
  taxAmount: number;
  total: number;
  notes: string;
  items: PurchaseReturnItem[];
}

export interface CreatePurchaseReturnInput {
  purchaseId: number;
  items: Array<{
    purchaseItemId: number;
    quantity: number;
  }>;
  notes?: string;
}

export interface CashbookEntry {
  id: number;
  entryDate: string;
  direction: 'IN' | 'OUT';
  category: string;
  paymentType?: 'CASH' | 'BANK';
  accountName?: string;
  description: string;
  amount: number;
  reference: string;
  createdBy: string;
  createdAt: string;
}

export interface CashbookOpeningBalance {
  entryDate: string;
  amount: number;
}

export interface CashierShift {
  id: number;
  cashierUsername: string;
  cashierName: string;
  openedAt: string;
  openingCash: number;
  closedAt: string | null;
  closingCash: number | null;
}

export interface CreateCashbookEntryInput {
  entryDate: string;
  direction: 'IN' | 'OUT';
  category: string;
  paymentType?: 'CASH' | 'BANK';
  accountName?: string;
  description: string;
  amount: number;
  reference?: string;
  createdBy: string;
}

export type PaperWidth = '80mm' | '58mm' | 'A4';

export interface InvoiceMarginsMm {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface InvoiceTemplateSettings {
  defaultPrinter?: string;
  printerMode?: 'system-default' | 'saved-printer' | 'choose-at-print-time';
  invoiceMarginsMm?: Partial<InvoiceMarginsMm>;
  invoiceShowProductName?: boolean;
  invoiceShowProductNameAr?: boolean;
  invoiceShowBarcode?: boolean;
  invoiceShowCustomerInfo?: boolean;
  invoiceShowCashierName?: boolean;
  invoiceShowTaxDetails?: boolean;
  invoiceShowStoreAddress?: boolean;
  invoiceShowReceiptBarcode?: boolean;
  invoiceShowFooter?: boolean;
  invoiceShowQrCode?: boolean;
}

export interface StoreSettings {
  storeName: string;
  storeNameAr?: string; // اسم المتجر / الشركة بالعربية
  crNumber?: string; // السجل التجاري (Commercial Registration)
  address: string;
  buildingNo?: string; // رقم المبنى (Building No.)
  streetName?: string; // اسم الشارع (Street Name)
  district?: string; // الحي (District)
  city?: string; // المدينة (City - Riyadh, Jeddah, etc.)
  postalCode?: string; // الرمز البريدي (Postal Code)
  country?: string; // الدولة (Country - Saudi Arabia)
  phone: string;
  taxId: string; // الرقم الضريبي (Saudi VAT ID - 15 digits)
  taxRate: number; // ضريبة القيمة المضافة (Saudi standard 15%)
  taxType: TaxType; // 'inclusive' (tax included in retail price) or 'exclusive' (tax added on top)
  currencySymbol: string; // SAR or ر.س
  receiptFooter: string;
  receiptFooterAr?: string; // تذييل الفاتورة بالعربية
  paperWidth: PaperWidth;
  printerOnline: boolean;
  cashierName: string;

  // POS Screen & Layout Models
  posScreenLayout: PosScreenLayout;

  // Operational & Sales Settings
  barcodeScanBeep: boolean;
  allowNegativeStock: boolean;
  roundTotalToFiveCents: boolean;
  autoPrintReceiptOnSale: boolean;
  defaultReceiptAction?: 'print' | 'done'; // Default completion action: 'print' (Print & New Sale) or 'done' (Done without print & New Sale)
  decimalPoints?: number; // Number of decimal places for price & quantity display (default: 2)
  receiptBarcodeEnabled: boolean;
  enableStockAlertsOnCheckout: boolean;
  defaultCustomer: string;
  paymentMethods?: string[];
  kotPrinter?: string;
  enableKot?: boolean;

  // Multi-Language & Invoice Printing Template Customization
  appLanguage?: 'en' | 'ar';
  defaultPrinter?: string;
  invoiceShowProductName?: boolean;
  invoiceShowProductNameAr?: boolean;
  invoiceShowBarcode?: boolean;
  invoiceShowCustomerInfo?: boolean;
  invoiceShowCashierName?: boolean;
  invoiceShowTaxDetails?: boolean;
  invoiceShowStoreAddress?: boolean;
  invoiceShowReceiptBarcode?: boolean;
  invoiceShowFooter?: boolean;
  invoiceShowQrCode?: boolean;
  invoiceTemplates?: Partial<Record<PaperWidth, InvoiceTemplateSettings>>;
  appVersion?: AppVersion;
  disabledAppComponents?: AppComponentId[];
  versionComponentPolicies?: VersionComponentPolicies;
  registeredSystem?: boolean;
}

export interface PrintJob {
  id: number;
  saleId: number;
  receiptNumber: string;
  createdAt: string;
  total: number;
  status: 'QUEUED' | 'PRINTED';
}
