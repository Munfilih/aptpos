export type Language = 'en' | 'ar';

export interface Translations {
  // Navigation & Header
  navRegister: string;
  navInventory: string;
  navPurchases: string;
  navCustomers: string;
  navVendors: string;
  navSales: string;
  navHistory: string;
  navSalesReturnRegister: string;
  navSalesReturnHistory: string;
  navAccounts: string;
  navReports: string;
  navSettings: string;
  navLogout: string;
  navSwitchUser: string;
  navLogin: string;
  terminalNav: string;
  reprint: string;
  newSale: string;
  switchAccount: string;
  loginTitle: string;
  loginSubtitle: string;
  username: string;
  password: string;
  signIn: string;
  signingIn: string;
  adminAccount: string;
  cashierAccount: string;
  customAccount: string;

  // Common UI
  search: string;
  save: string;
  saving: string;
  saved: string;
  cancel: string;
  delete: string;
  edit: string;
  add: string;
  print: string;
  close: string;
  confirm: string;
  back: string;
  actions: string;
  status: string;
  loading: string;
  all: string;
  date: string;
  total: string;
  subtotal: string;
  tax: string;
  taxVat: string;
  discount: string;
  qty: string;
  price: string;
  cost: string;
  unit: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
  success: string;
  error: string;
  filter: string;
  exportExcel: string;
  importExcel: string;
  refresh: string;
  itemsCount: string;
  yes: string;
  no: string;

  // Categories
  catAll: string;
  catBeverages: string;
  catBakery: string;
  catHousehold: string;
  catStationery: string;
  catSnacks: string;

  // Register View
  scanOrSearch: string;
  browseCatalog: string;
  holdTicket: string;
  clearCart: string;
  emptyCart: string;
  emptyCartHint: string;
  readyToScan: string;
  readyToScanDesc: string;
  checkout: string;
  amountTendered: string;
  changeDue: string;
  paymentMethod: string;
  cash: string;
  card: string;
  splitPayment: string;
  walkInCustomer: string;
  selectCustomer: string;
  wrongBarcodeTitle: string;
  wrongBarcodeMsg: string;
  wrongBarcodeEscHint: string;
  scannedCode: string;
  outOfStock: string;
  ticket: string;
  itemDescription: string;
  barcodeSku: string;
  applyDiscount: string;
  fixedDiscount: string;
  percentDiscount: string;
  heldTickets: string;
  noHeldTickets: string;
  resumeTicket: string;
  deleteHeldTicket: string;
  quickCash: string;
  exactAmount: string;
  itemAdded: string;

  // Inventory View
  inventoryTitle: string;
  inventorySubtitle: string;
  addProduct: string;
  editProduct: string;
  productNameEn: string;
  productNameAr: string;
  sku: string;
  barcode: string;
  category: string;
  costPrice: string;
  retailPrice: string;
  stockQty: string;
  reorderLevel: string;
  inStock: string;
  lowStock: string;
  outOfStockBadge: string;
  importProducts: string;
  exportCatalog: string;
  dropExcelFile: string;
  sampleTemplate: string;
  downloadSample: string;
  itemsLoaded: string;
  confirmDeleteProduct: string;

  // Sales History View
  salesHistoryTitle: string;
  salesHistorySubtitle: string;
  receiptNumber: string;
  customerName: string;
  cashierName: string;
  paymentMode: string;
  statusCompleted: string;
  statusVoided: string;
  voidSale: string;
  confirmVoidSale: string;
  viewReceipt: string;
  totalSales: string;
  totalTransactions: string;
  avgOrderValue: string;
  filterByDate: string;

  // Purchases View
  purchasesTitle: string;
  purchasesSubtitle: string;
  newPurchaseOrder: string;
  invoiceNumber: string;
  vendor: string;
  receivedDate: string;
  shippingCost: string;
  paymentStatus: string;
  statusPaid: string;
  statusPending: string;
  statusPartial: string;
  receiveStock: string;
  manageVendors: string;

  // Customers & Vendors
  customersTitle: string;
  customersSubtitle: string;
  addCustomer: string;
  editCustomer: string;
  customerNameEn: string;
  customerNameAr: string;
  vatTaxNumber: string;
  crNumber: string;
  totalSpent: string;
  ordersCount: string;

  vendorsTitle: string;
  vendorsSubtitle: string;
  addVendor: string;
  editVendor: string;
  vendorNameEn: string;
  vendorNameAr: string;
  contactPerson: string;
  totalPurchased: string;
  purchasesCount: string;

  // Settings View
  settingsTitle: string;
  secSalesTax: string;
  secScreenModels: string;
  secStoreInfo: string;
  secPrintTemplate: string;
  secUsersPerms: string;
  secDatabase: string;
  languageSelect: string;
  english: string;
  arabic: string;
  saveAllSettings: string;
  storeNameEn: string;
  storeNameAr: string;
  taxCalculationMode: string;
  taxInclusive: string;
  taxExclusive: string;
  taxRatePercent: string;
  currency: string;
  receiptFooterMsg: string;
  receiptFooterMsgAr: string;

  // Print Template Settings
  printTemplateTitle: string;
  printTemplateDesc: string;
  paperFormat: string;
  thermal80: string;
  thermal58: string;
  a4Sheet: string;
  defaultPrinter: string;
  defaultPrinterPlaceholder: string;
  defaultAction: string;
  actionPrint: string;
  actionWithoutPrint: string;
  invoiceDisplayOptions: string;
  invoiceDisplayOptionsDesc: string;
  showProductName: string;
  showProductNameAr: string;
  showBarcode: string;
  showCustomerInfo: string;
  showCashierName: string;
  showTaxDetails: string;
  showStoreAddress: string;
  showReceiptBarcode: string;
  showFooter: string;
  showQrCode: string;

  // Users & Database
  userAccounts: string;
  addNewStaff: string;
  role: string;
  permissions: string;
  resetDatabase: string;
  resetDatabaseDesc: string;
  exportBackup: string;
  restoreBackup: string;

  // Receipt Modal
  receiptPreview: string;
  simplifiedTaxInvoice: string;
  taxInvoiceA4: string;
  formatThermal: string;
  formatA4: string;
  printInvoice: string;
  downloadTxt: string;
  receiptNo: string;
  cashier: string;
  customer: string;
}

export const translations: Record<Language, Translations> = {
  en: {
    // Navigation & Header
    navRegister: 'Sales',
    navInventory: 'Inventory',
    navPurchases: 'Purchase',
    navCustomers: 'Customers',
    navVendors: 'Vendors',
    navSales: 'Sales',
    navHistory: 'History',
    navSalesReturnRegister: 'Sales Return',
    navSalesReturnHistory: 'Sales Return',
    navAccounts: 'Accounts',
    navReports: 'Reports',
    navSettings: 'Settings',
    navLogout: 'Logout',
    navSwitchUser: 'Switch User',
    navLogin: 'Login',
    terminalNav: 'Terminal Navigation',
    reprint: 'Reprint',
    newSale: 'New Sale',
    switchAccount: 'Switch Account',
    loginTitle: 'Sign In to Terminal',
    loginSubtitle: 'Enter your credentials to unlock the POS system',
    username: 'Username',
    password: 'Password',
    signIn: 'Sign In',
    signingIn: 'Signing in...',
    adminAccount: 'Admin Account',
    cashierAccount: 'Cashier Account',
    customAccount: 'Staff Account',

    // Common UI
    search: 'Search...',
    save: 'Save',
    saving: 'Saving...',
    saved: 'Saved successfully',
    cancel: 'Cancel',
    delete: 'Delete',
    edit: 'Edit',
    add: 'Add New',
    print: 'Print',
    close: 'Close',
    confirm: 'Confirm',
    back: 'Back',
    actions: 'Actions',
    status: 'Status',
    loading: 'Loading...',
    all: 'All',
    date: 'Date',
    total: 'Total',
    subtotal: 'Subtotal',
    tax: 'VAT (15%)',
    taxVat: 'Value Added Tax',
    discount: 'Discount',
    qty: 'Qty',
    price: 'Price',
    cost: 'Cost',
    unit: 'Unit',
    phone: 'Phone',
    email: 'Email',
    address: 'Address',
    notes: 'Notes',
    success: 'Success',
    error: 'Error',
    filter: 'Filter',
    exportExcel: 'Export Excel',
    importExcel: 'Import Excel',
    refresh: 'Refresh',
    itemsCount: 'items',
    yes: 'Yes',
    no: 'No',

    // Categories
    catAll: 'All Products',
    catBeverages: 'Beverages',
    catBakery: 'Bakery & Pantry',
    catHousehold: 'Household',
    catStationery: 'Stationery',
    catSnacks: 'Snacks',

    // Register View
    scanOrSearch: 'Scan or enter barcode... (F2)',
    browseCatalog: 'Browse Catalog (F4)',
    holdTicket: 'Hold Ticket (F6)',
    clearCart: 'Clear Cart',
    emptyCart: 'Cart is empty',
    emptyCartHint: 'Scan items using barcode scanner or browse catalog to add products.',
    readyToScan: 'Ready to Scan',
    readyToScanDesc: 'Scan a barcode using the scanner gun to add items directly to this invoice. If a product has no barcode, click Browse Catalog (F4).',
    checkout: 'Checkout (F9)',
    amountTendered: 'Amount Tendered',
    changeDue: 'Change Due',
    paymentMethod: 'Payment Method',
    cash: 'Cash',
    card: 'Card (Mada / Visa)',
    splitPayment: 'Split Tender',
    walkInCustomer: 'Walk-in Customer / عميل نقدي',
    selectCustomer: 'Select Customer',
    wrongBarcodeTitle: 'Product Not Available / غير متوفر',
    wrongBarcodeMsg: 'Barcode not found in system inventory. Please check barcode or add product to catalog.',
    wrongBarcodeEscHint: 'Press Escape (Esc) or click Close to unlock scanner.',
    scannedCode: 'Scanned Barcode',
    outOfStock: 'is out of stock',
    ticket: 'Ticket',
    itemDescription: 'Item Description',
    barcodeSku: 'Barcode / SKU',
    applyDiscount: 'Apply Discount',
    fixedDiscount: 'Fixed Amount',
    percentDiscount: 'Percentage (%)',
    heldTickets: 'Held Tickets',
    noHeldTickets: 'No held tickets.',
    resumeTicket: 'Resume',
    deleteHeldTicket: 'Delete',
    quickCash: 'Quick Cash Tender',
    exactAmount: 'Exact Amount',
    itemAdded: 'added to invoice',

    // Inventory View
    inventoryTitle: 'Inventory & Stock Management',
    inventorySubtitle: 'Manage product catalog, barcode pricing, stock counts, and Excel import/export.',
    addProduct: 'Add New Product',
    editProduct: 'Edit Product',
    productNameEn: 'Product Name (English)',
    productNameAr: 'Product Name (Arabic)',
    sku: 'SKU Code',
    barcode: 'Barcode',
    category: 'Category',
    costPrice: 'Cost Price',
    retailPrice: 'Retail Price',
    stockQty: 'Stock Quantity',
    reorderLevel: 'Reorder Level',
    inStock: 'In Stock',
    lowStock: 'Low Stock',
    outOfStockBadge: 'Out of Stock',
    importProducts: 'Import Excel / CSV',
    exportCatalog: 'Export Products (.xlsx)',
    dropExcelFile: 'Drag & drop Excel (.xlsx) file here, or click to browse',
    sampleTemplate: 'Need a template? Download the sample Excel file below.',
    downloadSample: 'Download Sample Excel',
    itemsLoaded: 'products loaded',
    confirmDeleteProduct: 'Are you sure you want to delete this product?',

    // Sales History View
    salesHistoryTitle: 'Sales History & Invoices',
    salesHistorySubtitle: 'Review past completed transactions, reprint receipts, issue refunds, and manage invoices.',
    receiptNumber: 'Invoice #',
    customerName: 'Customer',
    cashierName: 'Cashier',
    paymentMode: 'Payment Mode',
    statusCompleted: 'Completed',
    statusVoided: 'Voided',
    voidSale: 'Void Sale',
    confirmVoidSale: 'Are you sure you want to void this transaction? Stock will be refunded.',
    viewReceipt: 'View Receipt',
    totalSales: 'Total Revenue',
    totalTransactions: 'Transactions',
    avgOrderValue: 'Avg. Transaction',
    filterByDate: 'Filter Date',

    // Purchases View
    purchasesTitle: 'Purchase Orders & Inbound Stock',
    purchasesSubtitle: 'Receive vendor shipments, log inventory purchasing costs, and track supplier payables.',
    newPurchaseOrder: 'New Purchase Order',
    invoiceNumber: 'Purchase Bill #',
    vendor: 'Vendor / Supplier',
    receivedDate: 'Received Date',
    shippingCost: 'Shipping Cost',
    paymentStatus: 'Payment Status',
    statusPaid: 'Paid in Full',
    statusPending: 'Pending Payment',
    statusPartial: 'Partially Paid',
    receiveStock: 'Receive Delivery',
    manageVendors: 'Manage Vendors',

    // Customers & Vendors
    customersTitle: 'Customer Accounts Directory',
    customersSubtitle: 'Manage retail client ledgers, commercial tax numbers, addresses, and sales history.',
    addCustomer: 'Add Customer',
    editCustomer: 'Edit Customer',
    customerNameEn: 'Customer Name (English)',
    customerNameAr: 'Customer Name (Arabic)',
    vatTaxNumber: 'VAT / Tax Number',
    crNumber: 'CR Number / س.ت',
    totalSpent: 'Total Spent',
    ordersCount: 'Orders',

    // Vendors
    vendorsTitle: 'Supplier & Vendor Accounts',
    vendorsSubtitle: 'Manage supplier contacts, commercial registrations, and procurement history.',
    addVendor: 'Add Supplier',
    editVendor: 'Edit Supplier',
    vendorNameEn: 'Vendor Name (English)',
    vendorNameAr: 'Vendor Name (Arabic)',
    contactPerson: 'Contact Person',
    totalPurchased: 'Total Purchased',
    purchasesCount: 'Bills Count',

    // Settings View
    settingsTitle: 'Store Configuration',
    secSalesTax: 'Sales & Tax',
    secScreenModels: 'POS Screen',
    secStoreInfo: 'Store & Receipt Info',
    secPrintTemplate: 'Print & Invoice Template',
    secUsersPerms: 'Users & Permissions',
    secDatabase: 'Database & Backup',
    languageSelect: 'App Language / لغة النظام',
    english: 'English (EN)',
    arabic: 'العربية (AR)',
    saveAllSettings: 'Save All Settings',
    storeNameEn: 'Store Name (English)',
    storeNameAr: 'Store Name (Arabic)',
    taxCalculationMode: 'Tax Calculation Mode',
    taxInclusive: 'Tax Inclusive (VAT included in price)',
    taxExclusive: 'Tax Exclusive (Added at checkout)',
    taxRatePercent: 'VAT Rate (%)',
    currency: 'Currency Symbol',
    receiptFooterMsg: 'Receipt Footer Notice (English)',
    receiptFooterMsgAr: 'Receipt Footer Notice (Arabic)',

    // Print Template Settings
    printTemplateTitle: 'Print Format & Invoice Customization',
    printTemplateDesc: 'Choose your default printer hardware, print layout (Thermal roll vs. A4 invoice), and customize which fields appear on receipts.',
    paperFormat: 'Receipt & Invoice Paper Format',
    thermal80: '80mm Thermal Receipt (Standard Roll)',
    thermal58: '58mm Thermal Receipt (Compact Roll)',
    a4Sheet: 'A4 Full Page Commercial Tax Invoice',
    defaultPrinter: 'Default Printer Name / Path',
    defaultPrinterPlaceholder: 'e.g. EPSON TM-T88VI or Office Laser Printer',
    defaultAction: 'Default Sale Completion Action',
    actionPrint: 'Print Receipt & Advance (Default)',
    actionWithoutPrint: 'Done Without Printing (Save Paper)',
    invoiceDisplayOptions: 'Invoice Line Item Display Elements',
    invoiceDisplayOptionsDesc: 'Check or uncheck which product metadata items appear on customer invoices and receipts:',
    showProductName: 'Show Product English Name',
    showProductNameAr: 'Show Product Arabic Name (الاسم بالعربية)',
    showBarcode: 'Show Product SKU / Barcode in Item Line',
    showCustomerInfo: 'Show Customer Ledger & Contact Details',
    showCashierName: 'Show Cashier Name on Header',
    showTaxDetails: 'Show Subtotal Excl. Tax & VAT Breakdown',
    showStoreAddress: 'Show Store Address & Contact Telephone',
    showReceiptBarcode: 'Show Barcode at Bottom for Returns',
    showFooter: 'Show Thank You Footer Message',
    showQrCode: 'Show ZATCA Compliant QR Code',

    // Users & Database
    userAccounts: 'System User Accounts',
    addNewStaff: 'Add Staff User',
    role: 'Role',
    permissions: 'Permissions',
    resetDatabase: 'Reset Database to Factory Defaults',
    resetDatabaseDesc: 'Clears all transactions, inventory modifications, purchase orders, customer and vendor balances.',
    exportBackup: 'Export Database Backup (.sqlite)',
    restoreBackup: 'Restore Database from File',

    // Receipt Modal
    receiptPreview: 'Receipt & Invoice Preview',
    simplifiedTaxInvoice: 'Simplified Tax Invoice / فاتورة ضريبية مبسطة',
    taxInvoiceA4: 'Tax Invoice / فاتورة ضريبية',
    formatThermal: 'Thermal Roll',
    formatA4: 'A4 Invoice Sheet',
    printInvoice: 'Print Document',
    downloadTxt: 'Download Text',
    receiptNo: 'Receipt #',
    cashier: 'Cashier',
    customer: 'Customer',
  },

  ar: {
    // Navigation & Header
    navRegister: 'المبيعات',
    navInventory: 'المخزون والمنتجات',
    navPurchases: 'المشتريات',
    navCustomers: 'دليل العملاء',
    navVendors: 'دليل الموردين',
    navSales: 'المبيعات',
    navHistory: 'السجل',
    navSalesReturnRegister: 'مرتجع المبيعات',
    navSalesReturnHistory: 'مرتجع المبيعات',
    navAccounts: 'الحسابات',
    navReports: 'التقارير',
    navSettings: 'الإعدادات والنظام',
    navLogout: 'تسجيل الخروج',
    navSwitchUser: 'تبديل المستخدم',
    navLogin: 'تسجيل الدخول',
    terminalNav: 'قائمة النظام',
    reprint: 'إعادة طباعة',
    newSale: 'فاتورة جديدة',
    switchAccount: 'تبديل الحساب',
    loginTitle: 'تسجيل الدخول للنظام',
    loginSubtitle: 'أدخل اسم المستخدم وكلمة المرور لفتح شاشة البيع',
    username: 'اسم المستخدم',
    password: 'كلمة المرور',
    signIn: 'دخول',
    signingIn: 'جاري الدخول...',
    adminAccount: 'حساب المدير',
    cashierAccount: 'حساب كاشير',
    customAccount: 'حساب موظف',

    // Common UI
    search: 'بحث...',
    save: 'حفظ',
    saving: 'جاري الحفظ...',
    saved: 'تم الحفظ بنجاح',
    cancel: 'إلغاء',
    delete: 'حذف',
    edit: 'تعديل',
    add: 'إضافة صنف جديد',
    print: 'طباعة',
    close: 'إغلاق',
    confirm: 'تأكيد',
    back: 'رجوع',
    actions: 'الإجراءات',
    status: 'الحالة',
    loading: 'جاري التحميل...',
    all: 'الكل',
    date: 'التاريخ',
    total: 'الإجمالي',
    subtotal: 'المجموع الفرعي',
    tax: 'ضريبة القيمة المضافة (15%)',
    taxVat: 'ضريبة القيمة المضافة',
    discount: 'الخصم',
    qty: 'الكمية',
    price: 'السعر',
    cost: 'التكلفة',
    unit: 'الوحدة',
    phone: 'رقم الهاتف',
    email: 'البريد الإلكتروني',
    address: 'العنوان',
    notes: 'ملاحظات',
    success: 'تمت العملية بنجاح',
    error: 'حدث خطأ',
    filter: 'تصفية',
    exportExcel: 'تصدير إكسل',
    importExcel: 'استيراد إكسل',
    refresh: 'تحديث',
    itemsCount: 'صنف',
    yes: 'نعم',
    no: 'لا',

    // Categories
    catAll: 'جميع الأقسام',
    catBeverages: 'المشروبات والعصائر',
    catBakery: 'المخبوزات والمؤن',
    catHousehold: 'المنظفات والمنزل',
    catStationery: 'القرطاسية والمكتبية',
    catSnacks: 'الوجبات الخفيفة والحلويات',

    // Register View
    scanOrSearch: 'امسح الباركود أو أدخله... (F2)',
    browseCatalog: 'استعراض الأصناف (F4)',
    holdTicket: 'تعليق الفاتورة (F6)',
    clearCart: 'تفريغ السلة',
    emptyCart: 'سلة المشتريات فارغة',
    emptyCartHint: 'قم بمسح الباركود باستخدام قارئ الباركود أو استعراض الأصناف للإضافة.',
    readyToScan: 'جاهز لمسح الباركود',
    readyToScanDesc: 'قم بمسح باركود المنتج لإضافته فوراً إلى الفاتورة، أو انقر استعراض الأصناف لاختيار المنتجات يدوياً.',
    checkout: 'إتمام الدفع (F9)',
    amountTendered: 'المبلغ المدفوع نقدياً',
    changeDue: 'المتبقي للعميل',
    paymentMethod: 'طريقة الدفع',
    cash: 'نقدي (كاش)',
    card: 'شبكة / مدى / فيزا',
    splitPayment: 'دفع متعدد (مجزأ)',
    walkInCustomer: 'عميل نقدي',
    selectCustomer: 'اختيار العميل',
    wrongBarcodeTitle: 'المنتج غير متوفر في المخزون',
    wrongBarcodeMsg: 'رمز الباركود المدخل غير مسجل في قاعدة البيانات. يرجى التأكد من الرقم أو إضافة الصنف أولاً.',
    wrongBarcodeEscHint: 'اضغط على زر الخروج Escape (Esc) أو انقر إغلاق لفك قفل الماسح.',
    scannedCode: 'رمز الباركود المدخل',
    outOfStock: 'غير متوفر في المخزون حالياً',
    ticket: 'فاتورة',
    itemDescription: 'بيان الصنف',
    barcodeSku: 'الباركود / الكود',
    applyDiscount: 'تطبيق خصم',
    fixedDiscount: 'مبلغ ثابت',
    percentDiscount: 'نسبة مئوية (%)',
    heldTickets: 'الفواتير المعلقة',
    noHeldTickets: 'لا توجد فواتير معلقة حالياً.',
    resumeTicket: 'استعادة الفاتورة',
    deleteHeldTicket: 'حذف المعلقة',
    quickCash: 'المبلغ السريع',
    exactAmount: 'المبلغ بالضبط',
    itemAdded: 'تمت إضافته للفاتورة',

    // Inventory View
    inventoryTitle: 'إدارة المخزون والأصناف',
    inventorySubtitle: 'التحكم بقائمة المنتجات، الأسعار، التكلفة، مستويات المخزون، واستيراد وتصدير ملفات الإكسل.',
    addProduct: 'إضافة منتج جديد',
    editProduct: 'تعديل بيانات المنتج',
    productNameEn: 'اسم المنتج (بالإنجليزية)',
    productNameAr: 'اسم المنتج (بالعربية)',
    sku: 'كود الصنف (SKU)',
    barcode: 'رمز الباركود',
    category: 'القسم / التصنيف',
    costPrice: 'سعر التكلفة',
    retailPrice: 'سعر البيع',
    stockQty: 'كمية المخزون',
    reorderLevel: 'حد إعادة الطلب',
    inStock: 'متوفر',
    lowStock: 'مخزون منخفض',
    outOfStockBadge: 'نفذ من المخزون',
    importProducts: 'استيراد من إكسل / CSV',
    exportCatalog: 'تصدير الأصناف (إكسل)',
    dropExcelFile: 'اسحب وأفلت ملف الإكسل هنا، أو انقر للاختيار',
    sampleTemplate: 'تريد نموذج جاهز؟ قم بتحميل ملف الإكسل النموذجي المنسق.',
    downloadSample: 'تحميل نموذج إكسل',
    itemsLoaded: 'منتج مسجل',
    confirmDeleteProduct: 'هل أنت متأكد من رغبتك في حذف هذا المنتج من المخزون؟',

    // Sales History View
    salesHistoryTitle: 'سجل المبيعات والفواتير',
    salesHistorySubtitle: 'مراجعة المعاملات السابقة، طباعة الفواتير، استرجاع المبيعات، ومتابعة دخل المتجر.',
    receiptNumber: 'رقم الفاتورة',
    customerName: 'العميل',
    cashierName: 'الكاشير',
    paymentMode: 'طريقة السداد',
    statusCompleted: 'مكتملة',
    statusVoided: 'ملغاة / مسترجعة',
    voidSale: 'إلغاء المعاملة واسترجاع',
    confirmVoidSale: 'هل أنت متأكد من إلغاء هذه المعاملة؟ سيتم إرجاع الكميات للمخزون.',
    viewReceipt: 'عرض الفاتورة',
    totalSales: 'إجمالي المبيعات',
    totalTransactions: 'عدد المعاملات',
    avgOrderValue: 'متوسط الفاتورة',
    filterByDate: 'تصفية حسب التاريخ',

    // Purchases View
    purchasesTitle: 'أوامر الشراء والتوريد',
    purchasesSubtitle: 'تسجيل فواتير الشراء من الموردين، استلام البضائع، ومتابعة تكاليف المنتجات الواردة.',
    newPurchaseOrder: 'أمر شراء جديد',
    invoiceNumber: 'رقم فاتورة الشراء',
    vendor: 'المورد / الشركة',
    receivedDate: 'تاريخ الاستلام',
    shippingCost: 'تكلفة الشحن والنقل',
    paymentStatus: 'حالة الدفع',
    statusPaid: 'مدفوعة بالكامل',
    statusPending: 'معلقة / آجل',
    statusPartial: 'مدفوعة جزئياً',
    receiveStock: 'استلام البضاعة وتحديث المخزون',
    manageVendors: 'إدارة الموردين',

    // Customers & Vendors
    customersTitle: 'دليل وحسابات العملاء',
    customersSubtitle: 'إدارة سجلات العملاء، الأرقام الضريبية، العناوين، ومتابعة إجمالي المشتريات.',
    addCustomer: 'إضافة عميل جديد',
    editCustomer: 'تعديل بيانات العميل',
    customerNameEn: 'اسم العميل (بالإنجليزية)',
    customerNameAr: 'اسم العميل (بالعربية)',
    vatTaxNumber: 'الرقم الضريبي للعميل',
    crNumber: 'رقم السجل التجاري',
    totalSpent: 'إجمالي المشتريات',
    ordersCount: 'عدد الطلبات',

    // Vendors
    vendorsTitle: 'دليل وحسابات الموردين',
    vendorsSubtitle: 'سجلات الموردين والشركات، أرقام السجلات الضريبية والتجارية، وعمليات التوريد.',
    addVendor: 'إضافة مورد جديد',
    editVendor: 'تعديل بيانات المورد',
    vendorNameEn: 'اسم المورد (بالإنجليزية)',
    vendorNameAr: 'اسم المورد (بالعربية)',
    contactPerson: 'الشخص المسؤول',
    totalPurchased: 'إجمالي المشتريات',
    purchasesCount: 'عدد الفواتير',

    // Settings View
    settingsTitle: 'إعدادات النظام والمتجر',
    secSalesTax: 'المبيعات والضرائب',
    secScreenModels: 'نماذج شاشة البيع',
    secStoreInfo: 'بيانات المتجر والفاتورة',
    secPrintTemplate: 'قوالب الطباعة والفواتير',
    secUsersPerms: 'المستخدمين والصلاحيات',
    secDatabase: 'قاعدة البيانات والنسخ',
    languageSelect: 'لغة الواجهة / App Language',
    english: 'English (الإنجليزية)',
    arabic: 'العربية (Arabic)',
    saveAllSettings: 'حفظ جميع الإعدادات',
    storeNameEn: 'اسم المتجر (بالإنجليزية)',
    storeNameAr: 'اسم المتجر (بالعربية)',
    taxCalculationMode: 'طريقة احتساب الضريبة',
    taxInclusive: 'شامل الضريبة (السعر المعلن يتضمن الضريبة)',
    taxExclusive: 'غير شامل الضريبة (تضاف الضريبة عند الدفع)',
    taxRatePercent: 'نسبة الضريبة (%)',
    currency: 'رمز العملة (ر.س / SAR)',
    receiptFooterMsg: 'رسالة تذييل الفاتورة (بالإنجليزية)',
    receiptFooterMsgAr: 'رسالة تذييل الفاتورة (بالعربية)',

    // Print Template Settings
    printTemplateTitle: 'تخصيص نماذج الطباعة والفواتير',
    printTemplateDesc: 'اختر الطابعة الافتراضية، مقاس ورق الفاتورة (ورق حراري رول أو صفحة A4 كاملة)، وتحديد العناصر التي تظهر بالفاتورة.',
    paperFormat: 'مقاس الورق ونموذج الفاتورة',
    thermal80: 'ورق حراري 80 ملم (الرول القياسي)',
    thermal58: 'ورق حراري 58 ملم (الرول الصغير)',
    a4Sheet: 'فاتورة ضريبية رسمية نموذج A4 كامل',
    defaultPrinter: 'اسم الطابعة الافتراضية في النظام',
    defaultPrinterPlaceholder: 'مثال: EPSON TM-T88 أو طابعة A4 المكتبية',
    defaultAction: 'الإجراء التلقائي بعد إتمام البيع',
    actionPrint: 'طباعة الفاتورة تلقائياً وبدء بيع جديد',
    actionWithoutPrint: 'إنهاء البيع بدون طباعة (توفير الورق)',
    invoiceDisplayOptions: 'عناصر صنف الفاتورة المعروضة',
    invoiceDisplayOptionsDesc: 'حدد العناصر المراد إظهارها أو إخفاؤها في الفاتورة المطبوعة للعميل:',
    showProductName: 'إظهار اسم المنتج باللغة الإنجليزية',
    showProductNameAr: 'إظهار اسم المنتج باللغة العربية',
    showBarcode: 'إظهار الباركود / رمز الصنف مع السطر',
    showCustomerInfo: 'إظهار بيانات العميل والرقم الضريبي للعميل',
    showCashierName: 'إظهار اسم الكاشير المنفذ',
    showTaxDetails: 'إظهار تفاصيل الضريبة والمجموع غير الشامل',
    showStoreAddress: 'إظهار عنوان المتجر وأرقام التواصل',
    showReceiptBarcode: 'إظهار باركود المعاملة أسفل الفاتورة للاسترجاع',
    showFooter: 'إظهار رسالة الترحيب والشكر بأسفل الفاتورة',
    showQrCode: 'إظهار رمز الاستجابة السريع للضريبة (ZATCA QR)',

    // Users & Database
    userAccounts: 'حسابات مستخدمي النظام',
    addNewStaff: 'إضافة موظف جديد',
    role: 'الدور الوظيفي',
    permissions: 'الصلاحيات الممنوحة',
    resetDatabase: 'إعادة ضبط قاعدة البيانات للمصنع',
    resetDatabaseDesc: 'يمسح جميع المعاملات وتعديلات المخزون وفواتير الشراء وأرصدة العملاء والموردين.',
    exportBackup: 'تصدير نسخة احتياطية من قاعدة البيانات (.sqlite)',
    restoreBackup: 'استعادة قاعدة البيانات من ملف احتياطي',

    // Receipt Modal
    receiptPreview: 'معاينة الفاتورة قبل الطباعة',
    simplifiedTaxInvoice: 'فاتورة ضريبية مبسطة',
    taxInvoiceA4: 'فاتورة ضريبية',
    formatThermal: 'ورق حراري (رول)',
    formatA4: 'فاتورة A4 كاملة',
    printInvoice: 'طباعة المستند',
    downloadTxt: 'تحميل نصي',
    receiptNo: 'رقم الفاتورة',
    cashier: 'الكاشير',
    customer: 'العميل',
  },
};
