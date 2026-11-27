import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeftRight, ChevronDown, ChevronUp, Copy, FileText, Loader2, Plane, Plus, Printer, Save, Search, Ticket, Trash2, X } from 'lucide-react';
import type {
  Customer,
  PaymentMethod,
  Product,
  Sale,
  StoreSettings,
} from '../types/pos';
import { useLanguage } from '../i18n/LanguageContext';
import { calculateSalesTax } from '../utils/salesTax';
import {
  isFlyErpServiceCategory,
  parseFlyErpServiceDetails,
} from '../utils/flyErpServices';
import { AppDateInput } from './AppDateInput';
import { CustomerFormModal } from './CustomerFormModal';
import { ProductImage } from './ProductImage';
import { getPrintDocumentFormat } from '../printTemplates/catalog';
import { createVoucherTemplateJob, printTemplateJob } from '../printTemplates/render';

const getTodayDate = () => {
  const date = new Date();
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
};

interface FlyErpSalesViewProps {
  products: Product[];
  customers: Customer[];
  sales: Sale[];
  settings: StoreSettings;
  editingSale?: Sale | null;
  onSaleCompleted: (sale: Sale, queuedOffline: boolean) => void;
  onCancelEdit?: () => void;
  onLoadDraft?: (sale: Sale) => void;
  onDeleteDraft?: (saleId: number) => Promise<void>;
  onCustomerCreated: (customer: Customer) => void;
  onOpenServiceMaster?: () => void;
  onOpenSalesHistory?: () => void;
  onEditService?: (product: Product) => void;
}

interface TravelSaleRow {
  id: number;
  productId: number | null;
  isEditing: boolean;
  serviceSearch: string;
  unitPrice: string;
  details: string;
  passengerName: string;
  passportNumber: string;
  bookingReference: string;
  flightNumber: string;
  origin: string;
  destination: string;
  tripType: 'one-way' | 'round-trip';
  departureDate: string;
  returnFlightNumber: string;
  returnDate: string;
}

type ServiceField =
  | 'details'
  | 'passengerName'
  | 'passportNumber'
  | 'bookingReference'
  | 'flightNumber'
  | 'origin'
  | 'destination'
  | 'tripType'
  | 'departureDate'
  | 'returnFlightNumber'
  | 'returnDate'
  | 'rate';

type ServiceFieldElement = HTMLInputElement | HTMLSelectElement;

const createEmptyRow = (id: number): TravelSaleRow => ({
  id,
  productId: null,
  isEditing: true,
  serviceSearch: '',
  unitPrice: '',
  details: '',
  passengerName: '',
  passportNumber: '',
  bookingReference: '',
  flightNumber: '',
  origin: '',
  destination: '',
  tripType: 'one-way',
  departureDate: '',
  returnFlightNumber: '',
  returnDate: '',
});

export const FlyErpSalesView: React.FC<FlyErpSalesViewProps> = ({
  products,
  customers,
  sales = [],
  settings,
  editingSale = null,
  onSaleCompleted,
  onCancelEdit,
  onLoadDraft,
  onDeleteDraft,
  onCustomerCreated,
  onOpenServiceMaster,
  onOpenSalesHistory,
  onEditService,
}) => {
  const { isRtl } = useLanguage();
  const text = (english: string, arabic: string) => isRtl ? arabic : english;
  const currency = settings.currencySymbol || 'SAR';
  const decimals = settings.decimalPoints ?? 2;
  const [customerId, setCustomerId] = useState<number | null>(null);
  const [customerModalOpen, setCustomerModalOpen] = useState(false);
  const [invoiceDate, setInvoiceDate] = useState(getTodayDate);
  const [discountType, setDiscountType] = useState<'fixed' | 'percent'>('fixed');
  const [discountValue, setDiscountValue] = useState('0');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('Cash');
  const [cashTendered, setCashTendered] = useState<string | null>(null);
  const [rows, setRows] = useState<TravelSaleRow[]>([]);
  const [nextRowId, setNextRowId] = useState(1);
  const [serviceModalRowId, setServiceModalRowId] = useState<number | null>(null);
  const [serviceModalIsNew, setServiceModalIsNew] = useState(false);
  const [serviceModalOriginalRow, setServiceModalOriginalRow] = useState<TravelSaleRow | null>(null);
  const [serviceModalError, setServiceModalError] = useState<string | null>(null);
  const [servicePickerRowId, setServicePickerRowId] = useState<number | null>(null);
  const [serviceDropdownPosition, setServiceDropdownPosition] = useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number;
  } | null>(null);
  const [activeServiceSuggestionIndex, setActiveServiceSuggestionIndex] = useState(0);
  const serviceInputRef = useRef<HTMLInputElement | null>(null);
  const serviceSearchInputRefs = useRef(new Map<number, HTMLInputElement>());
  const serviceCardButtonRefs = useRef(new Map<number, HTMLButtonElement>());
  const serviceFieldRefs = useRef(new Map<number, Partial<Record<ServiceField, ServiceFieldElement>>>());
  const [error, setError] = useState<string | null>(null);
  const [draftNotice, setDraftNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savingAsDraft, setSavingAsDraft] = useState(false);
  const [saveConfirmationOpen, setSaveConfirmationOpen] = useState(false);
  const [draftsModalOpen, setDraftsModalOpen] = useState(false);
  const [draftsSearch, setDraftsSearch] = useState('');
  const [deletingDraftId, setDeletingDraftId] = useState<number | null>(null);
  const [printingDraftId, setPrintingDraftId] = useState<number | null>(null);
  const [settlementExpanded, setSettlementExpanded] = useState(false);
  const [customerSearch, setCustomerSearch] = useState('');
  const [customerDropdownOpen, setCustomerDropdownOpen] = useState(false);

  const customer = customers.find((entry) => entry.id === customerId);
  const invoiceTaxType = settings.taxType;
  const methods = useMemo(
    () => [...new Set([
      'Cash',
      ...(settings.paymentMethods || []).filter((method) => method.toUpperCase() !== 'CREDIT'),
      ...(editingSale ? [editingSale.paymentMethod] : []),
      'Credit',
    ])],
    [editingSale, settings.paymentMethods]
  );
  const travelServices = useMemo(
    () => products.filter((product) => isFlyErpServiceCategory(product.category)),
    [products]
  );
  const draftSales = useMemo(
    () =>
      sales
        .filter((sale) => sale.status === 'DRAFT')
        .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt)),
    [sales]
  );
  const filteredDraftSales = useMemo(() => {
    const query = draftsSearch.trim().toLowerCase();
    if (!query) return draftSales;
    return draftSales.filter((draft) =>
      draft.receiptNumber.toLowerCase().includes(query) ||
      draft.customerName.toLowerCase().includes(query) ||
      draft.items.some(
        (item) =>
          item.productName.toLowerCase().includes(query) ||
          (item.description || '').toLowerCase().includes(query)
      )
    );
  }, [draftSales, draftsSearch]);
  const frequentServices = useMemo(() => {
    const serviceIds = new Set(travelServices.map((service) => service.id));
    const usageCounts = new Map<number, number>();
    sales
      .filter((sale) => sale.status === 'COMPLETED')
      .forEach((sale) => {
        const soldServiceIds = new Set(
          sale.items
            .filter((item) => serviceIds.has(item.productId))
            .map((item) => item.productId)
        );
        soldServiceIds.forEach((serviceId) => {
          usageCounts.set(serviceId, (usageCounts.get(serviceId) || 0) + 1);
        });
      });
    return [...travelServices]
      .sort((left, right) => {
        const usageDifference =
          (usageCounts.get(right.id) || 0) - (usageCounts.get(left.id) || 0);
        if (usageDifference !== 0) return usageDifference;
        return (isRtl ? left.nameAr || left.name : left.name)
          .localeCompare(isRtl ? right.nameAr || right.name : right.name, undefined, {
            sensitivity: 'base',
          });
      })
      .slice(0, 6);
  }, [isRtl, sales, travelServices]);
  const serviceLabel = (product: Product) =>
    isRtl ? product.nameAr || product.name : product.name;
  useEffect(() => {
    if (!editingSale) return;

    setCustomerId(editingSale.customerId ?? null);
    setInvoiceDate(editingSale.invoiceDate || editingSale.createdAt.slice(0, 10));
    setDiscountType(editingSale.discountType);
    setDiscountValue(String(editingSale.discountValue));
    setPaymentMethod(editingSale.paymentMethod);
    setCashTendered(
      editingSale.paymentMethod === 'Cash'
        ? String(editingSale.amountTendered)
        : null
    );
    const restoredRows = editingSale.items.map((item, index): TravelSaleRow => {
      const details = parseFlyErpServiceDetails(item.description || '');
      const tripType = details.values.tripType?.toLocaleLowerCase() || '';
      return {
        id: index + 1,
        productId: item.productId,
        isEditing: false,
        serviceSearch: item.productName,
        unitPrice: String(item.unitPrice),
        details: details.notes.join('\n'),
        passengerName: details.values.passenger || '',
        passportNumber: details.values.passport || '',
        bookingReference: details.values.pnr || '',
        flightNumber: details.values.flight || '',
        origin: details.values.origin || '',
        destination: details.values.destination || '',
        tripType: tripType.includes('round trip') || tripType.includes('ذهاب وعودة') ||
          Boolean(details.values.returnFlight || details.values.returnDate)
          ? 'round-trip'
          : 'one-way',
        departureDate: details.values.travelDate || '',
        returnFlightNumber: details.values.returnFlight || '',
        returnDate: details.values.returnDate || '',
      };
    });
    setRows(restoredRows);
    setNextRowId(restoredRows.length + 1);
    setServiceModalRowId(null);
    setServiceModalIsNew(false);
    setServiceModalOriginalRow(null);
    setServicePickerRowId(null);
    setServiceDropdownPosition(null);
    setError(null);
  }, [editingSale]);

  const getRowServiceLabel = (row: TravelSaleRow) => {
    if (row.productId === null) return row.serviceSearch;
    const product = products.find((entry) => entry.id === row.productId);
    return product ? serviceLabel(product) : row.serviceSearch;
  };
  const filteredCustomers = useMemo(() => {
    const query = customerSearch.trim().toLocaleLowerCase();
    if (!query) return customers.slice(0, 30);
    return customers.filter((entry) =>
      [entry.name, entry.nameAr, entry.phone, entry.vatNumber]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase()
        .includes(query)
    ).slice(0, 30);
  }, [customerSearch, customers]);

  const getServiceSuggestions = (query: string) => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) return travelServices.slice(0, 20);
    return travelServices.filter((service) => {
      const searchableText = [
        service.name,
        service.nameAr,
        service.sku,
        service.barcode,
        service.category,
        service.unit,
      ].filter(Boolean).join(' ').toLocaleLowerCase();
      return searchableText.includes(normalizedQuery);
    });
  };
  const getServiceDropdownPosition = (input: HTMLInputElement) => {
    const rect = input.getBoundingClientRect();
    const width = Math.min(rect.width, window.innerWidth - 16);
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    const spaceBelow = window.innerHeight - rect.bottom - 8;
    const openAbove = spaceBelow < 160 && rect.top > spaceBelow;
    const maxHeight = Math.max(96, Math.min(256, openAbove ? rect.top - 12 : spaceBelow));
    const top = openAbove
      ? Math.max(8, rect.top - maxHeight - 4)
      : Math.min(window.innerHeight - maxHeight - 8, rect.bottom + 4);
    return { top, left, width, maxHeight };
  };
  const activeServiceRow = rows.find((row) => row.id === servicePickerRowId);
  const serviceModalRow = rows.find((row) => row.id === serviceModalRowId);
  const activeServiceOptions = activeServiceRow
    ? getServiceSuggestions(activeServiceRow.serviceSearch)
    : [];
  const rowDetails = useMemo(
    () => rows.map((row) => {
      const product = products.find((entry) => entry.id === row.productId);
      const unitPrice = Number(row.unitPrice);
      const valid = Boolean(product) &&
        row.unitPrice.trim() !== '' && Number.isFinite(unitPrice) && unitPrice >= 0;
      return {
        product,
        amount: valid ? Number(unitPrice.toFixed(2)) : 0,
        taxRate: product?.taxRate ?? settings.taxRate,
      };
    }),
    [products, rows, settings.taxRate]
  );
  const rowEntries = rows.map((row, index) => ({ row, index }));
  const displayedRows = [
    ...rowEntries.filter(({ row }) => row.isEditing),
    ...rowEntries.filter(({ row }) => !row.isEditing),
  ];
  const totals = useMemo(() => {
    const gross = rowDetails.reduce((sum, item) => sum + item.amount, 0);
    const discount = Math.max(0, Number(discountValue) || 0);
    const discountAmount = discountType === 'percent'
      ? Number((gross * Math.min(100, discount) / 100).toFixed(2))
      : Number(Math.min(gross, discount).toFixed(2));
    const tax = calculateSalesTax(
      rowDetails.flatMap((item) => item.product
        ? [{ amount: item.amount, taxRate: item.taxRate }]
        : []),
      discountAmount,
      invoiceTaxType
    );
    const total = settings.roundTotalToFiveCents
      ? Number((Math.round(tax.total * 20) / 20).toFixed(2))
      : tax.total;
    return {
      subtotal: tax.subtotal,
      taxAmount: tax.taxAmount,
      discountAmount,
      total,
    };
  }, [
    discountType,
    discountValue,
    invoiceTaxType,
    rowDetails,
    settings.roundTotalToFiveCents,
  ]);
  const cashReceivedAmount = cashTendered === null
    ? totals.total
    : cashTendered.trim() === ''
      ? Number.NaN
      : Number(cashTendered);
  const amountPaid = paymentMethod.toUpperCase() === 'CREDIT'
    ? 0
    : paymentMethod === 'Cash'
      ? Number.isFinite(cashReceivedAmount)
        ? Math.min(totals.total, Math.max(0, cashReceivedAmount))
        : 0
      : totals.total;
  const balanceDue = Math.max(0, Number((totals.total - amountPaid).toFixed(2)));
  const paymentStatus = balanceDue > 0
    ? amountPaid > 0 ? 'Partially Paid' : 'Unpaid'
    : 'Paid';

  const updateRow = (rowId: number, patch: Partial<TravelSaleRow>) => {
    setServiceModalError(null);
    setRows((current) => current.map((row) =>
      row.id === rowId ? { ...row, ...patch } : row
    ));
  };

  const setServiceFieldRef = (
    rowId: number,
    field: ServiceField,
    element: ServiceFieldElement | null
  ) => {
    const fields = serviceFieldRefs.current.get(rowId) || {};
    if (element) fields[field] = element;
    else delete fields[field];
    if (Object.keys(fields).length) serviceFieldRefs.current.set(rowId, fields);
    else serviceFieldRefs.current.delete(rowId);
  };

  const focusNextServiceField = (row: TravelSaleRow, currentField: ServiceField) => {
    const product = products.find((entry) => entry.id === row.productId);
    const fields: ServiceField[] = product?.requiresItinerary
      ? [
          'details',
          'passengerName',
          'passportNumber',
          'bookingReference',
          'flightNumber',
          'origin',
          'destination',
          'tripType',
          'departureDate',
          ...(row.tripType === 'round-trip' ? ['returnFlightNumber', 'returnDate'] as const : []),
          'rate',
        ]
      : ['details', 'rate'];
    const nextField = fields[fields.indexOf(currentField) + 1];
    if (nextField) {
      window.requestAnimationFrame(() => {
        serviceFieldRefs.current.get(row.id)?.[nextField]?.focus();
      });
    }
  };

  const addNewServiceRow = () => {
    const rowId = nextRowId;
    setRows((current) => [...current, createEmptyRow(rowId)]);
    setNextRowId((current) => current + 1);
    setServiceModalRowId(rowId);
    setServiceModalIsNew(true);
    setServiceModalOriginalRow(null);
    setServiceModalError(null);
    window.requestAnimationFrame(() => serviceSearchInputRefs.current.get(rowId)?.focus());
  };

  const selectService = (row: TravelSaleRow, service: Product) => {
    updateRow(row.id, {
      serviceSearch: serviceLabel(service),
      productId: service.id,
      unitPrice: service.retailPrice > 0 ? String(service.retailPrice) : '',
      ...(row.productId === service.id ? {} : {
        passengerName: '',
        passportNumber: '',
        bookingReference: '',
        flightNumber: '',
        origin: '',
        destination: '',
        tripType: 'one-way',
        departureDate: '',
        returnFlightNumber: '',
        returnDate: '',
      }),
    });
    setServicePickerRowId(null);
    setServiceDropdownPosition(null);
    window.requestAnimationFrame(() => {
      serviceFieldRefs.current.get(row.id)?.details?.focus();
    });
  };

  const completeServiceRow = (rowId: number) => {
    setRows((current) => current.map((row) =>
      row.id === rowId ? { ...row, isEditing: false } : row
    ));
    setServiceModalRowId(null);
    setServiceModalIsNew(false);
    setServiceModalOriginalRow(null);
    setServiceModalError(null);
    setServicePickerRowId(null);
    setServiceDropdownPosition(null);
    window.requestAnimationFrame(() => serviceCardButtonRefs.current.get(rowId)?.focus());
  };

  const editServiceRow = (row: TravelSaleRow) => {
    updateRow(row.id, { isEditing: true });
    setServiceModalRowId(row.id);
    setServiceModalIsNew(false);
    setServiceModalOriginalRow(row);
    setServiceModalError(null);
    window.requestAnimationFrame(() => {
      serviceFieldRefs.current.get(row.id)?.details?.focus();
    });
  };

  const removeServiceRow = (rowId: number) => {
    setRows((current) => current.filter((row) => row.id !== rowId));
  };

  const duplicateServiceRow = (sourceRow: TravelSaleRow) => {
    const rowId = nextRowId;
    const duplicatedRow: TravelSaleRow = {
      ...sourceRow,
      id: rowId,
      isEditing: true,
    };
    setRows((current) => [...current, duplicatedRow]);
    setNextRowId((current) => current + 1);
    setServiceModalRowId(rowId);
    setServiceModalIsNew(true);
    setServiceModalOriginalRow(null);
    setServiceModalError(null);
    window.requestAnimationFrame(() => {
      const fields = serviceFieldRefs.current.get(rowId);
      (fields?.passengerName || fields?.details)?.focus();
    });
  };

  const closeServiceModal = () => {
    if (serviceModalRowId !== null) {
      if (serviceModalIsNew) {
        removeServiceRow(serviceModalRowId);
      } else if (serviceModalOriginalRow) {
        setRows((current) => current.map((row) =>
          row.id === serviceModalRowId
            ? { ...serviceModalOriginalRow, isEditing: false }
            : row
        ));
      } else {
        setRows((current) => current.map((row) =>
          row.id === serviceModalRowId ? { ...row, isEditing: false } : row
        ));
      }
    }
    setServiceModalRowId(null);
    setServiceModalIsNew(false);
    setServiceModalOriginalRow(null);
    setServiceModalError(null);
    setServicePickerRowId(null);
    setServiceDropdownPosition(null);
  };

  const saveServiceModal = () => {
    const row = rows.find((entry) => entry.id === serviceModalRowId);
    if (!row || row.productId === null) {
      setServiceModalError(text('Select a service first.', 'اختر خدمة أولاً.'));
      return;
    }
    const unitPrice = Number(row.unitPrice);
    if (
      row.unitPrice.trim() === '' ||
      !Number.isFinite(unitPrice) ||
      unitPrice < 0
    ) {
      setServiceModalError(text(
        'Enter a valid rate.',
        'أدخل سعراً صحيحاً.'
      ));
      return;
    }
    completeServiceRow(row.id);
  };

  const getRowDescription = (row: TravelSaleRow, separator = '\n') => {
    const details = row.details.trim() ? [row.details.trim()] : [];
    const product = products.find((entry) => entry.id === row.productId);
    const itinerary = product?.requiresItinerary
      ? [
          [text('Passenger', 'المسافر'), row.passengerName],
          [text('Passport / ID', 'رقم الجواز / الهوية'), row.passportNumber],
          [text('Booking reference (PNR)', 'مرجع الحجز (PNR)'), row.bookingReference],
          [text('Flight', 'رقم الرحلة'), row.flightNumber],
          [text('From', 'من'), row.origin],
          [text('To', 'إلى'), row.destination],
          [text('Trip type', 'نوع الرحلة'), text(
            row.tripType === 'round-trip' ? 'Round trip' : 'One way',
            row.tripType === 'round-trip' ? 'ذهاب وعودة' : 'اتجاه واحد'
          )],
          [text('Departure date', 'تاريخ المغادرة'), row.departureDate],
          ...(row.tripType === 'round-trip'
            ? [
                [text('Return flight', 'رحلة العودة'), row.returnFlightNumber],
                [text('Return date', 'تاريخ العودة'), row.returnDate],
              ]
            : []),
        ]
      : [];
    const itineraryDetails = itinerary
      .filter(([, value]) => value.trim())
      .map(([label, value]) => `${label}: ${value.trim()}`);
    return [...details, ...itineraryDetails].join(separator);
  };

  const addQuickService = (service: Product) => {
    const rowId = nextRowId;
    const selectedRow = {
      ...createEmptyRow(rowId),
      productId: service.id,
      serviceSearch: serviceLabel(service),
      unitPrice: service.retailPrice > 0 ? String(service.retailPrice) : '',
    };
    setRows((current) => [...current, selectedRow]);
    setNextRowId((current) => current + 1);
    setServiceModalRowId(rowId);
    setServiceModalIsNew(true);
    setServiceModalOriginalRow(null);
    setServiceModalError(null);
    window.requestAnimationFrame(() => serviceFieldRefs.current.get(rowId)?.details?.focus());
  };

  useEffect(() => {
    if (servicePickerRowId === null) return;
    const repositionDropdown = () => {
      const input = serviceInputRef.current;
      if (!input?.isConnected) {
        setServicePickerRowId(null);
        setServiceDropdownPosition(null);
        return;
      }
      setServiceDropdownPosition(getServiceDropdownPosition(input));
    };
    window.addEventListener('resize', repositionDropdown);
    window.addEventListener('scroll', repositionDropdown, true);
    return () => {
      window.removeEventListener('resize', repositionDropdown);
      window.removeEventListener('scroll', repositionDropdown, true);
    };
  }, [servicePickerRowId]);

  const clearDraft = () => {
    setCustomerId(null);
    setInvoiceDate(getTodayDate());
    setDiscountType('fixed');
    setDiscountValue('0');
    setPaymentMethod('Cash');
    setCashTendered(null);
    setRows([]);
    setServiceModalRowId(null);
    setServiceModalIsNew(false);
    setServiceModalOriginalRow(null);
    setServicePickerRowId(null);
    setServiceDropdownPosition(null);
    setError(null);
    setServiceModalError(null);
    setSettlementExpanded(false);
  };

  const cancelEdit = () => {
    clearDraft();
    onCancelEdit?.();
  };

  const closeCustomerModal = () => {
    setCustomerModalOpen(false);
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const billableRows = rows.filter((row) => row.productId !== null);
    if (!billableRows.length) {
      setError(text('Select at least one travel service.', 'اختر خدمة سفر واحدة على الأقل.'));
      return;
    }
    if (
      paymentMethod === 'Cash' &&
      (!Number.isFinite(cashReceivedAmount) || cashReceivedAmount < 0)
    ) {
      setError(text('Enter a valid cash received amount.', 'أدخل مبلغاً نقدياً مستلماً صحيحاً.'));
      return;
    }
    if (
      (paymentMethod.toUpperCase() === 'CREDIT' || balanceDue > 0) &&
      !customer
    ) {
      setError(text(
        'Select a customer for an invoice with an outstanding balance.',
        'اختر عميلاً للفاتورة التي تحتوي على رصيد مستحق.'
      ));
      return;
    }
    if (billableRows.some((row) =>
      row.unitPrice.trim() === '' ||
      !Number.isFinite(Number(row.unitPrice)) ||
      Number(row.unitPrice) < 0
    )) {
      setError(text('Check the rate for each service.', 'تحقق من سعر كل خدمة.'));
      return;
    }

    setSaveConfirmationOpen(true);
  };

  const handleConfirmSave = async (asDraft = false) => {
    if (saving) return;
    const billableRows = rows.filter((row) => row.productId !== null);
    setSaving(true);
    setSavingAsDraft(asDraft);
    setDraftNotice(null);
    try {
      const response = await fetch(
        editingSale ? `/api/sales/${editingSale.id}/invoice` : '/api/sales',
        {
          method: editingSale ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            appScreenMode: 'flyerp',
            status: asDraft ? 'DRAFT' : 'COMPLETED',
            customerId: customer?.id ?? null,
            customerName: customer?.name || settings.defaultCustomer,
            ...(settings.allowInvoiceDateEdit ? { invoiceDate } : {}),
            discountType,
            discountValue: Math.max(0, Number(discountValue) || 0),
            paymentMethod,
            amountTendered: paymentMethod.toUpperCase() === 'CREDIT'
              ? 0
              : paymentMethod === 'Cash'
                ? cashReceivedAmount
                : totals.total,
            items: billableRows.map((row) => ({
              productId: row.productId,
              quantity: 1,
              unitPrice: Number(row.unitPrice),
              description: getRowDescription(row),
            })),
          }),
        }
      );
      const payload: unknown = await response.json();
      if (!response.ok) {
        const message = typeof payload === 'object' && payload !== null && 'error' in payload &&
          typeof payload.error === 'string'
          ? payload.error
          : text('Could not save this travel invoice.', 'تعذر حفظ فاتورة السفر.');
        throw new Error(message);
      }
      if (
        typeof payload !== 'object' ||
        payload === null ||
        !('sale' in payload) ||
        typeof payload.sale !== 'object' ||
        payload.sale === null
      ) {
        throw new Error(text('The server returned an invalid invoice response.', 'أعاد الخادم استجابة فاتورة غير صالحة.'));
      }
      const result = payload as { sale: Sale; queuedOfflinePrint?: boolean };
      setSaveConfirmationOpen(false);
      onSaleCompleted(result.sale, result.queuedOfflinePrint === true);
      clearDraft();
      if (asDraft) {
        setDraftNotice(
          text(
            `Invoice ${result.sale.receiptNumber} saved to drafts.`,
            `تم حفظ الفاتورة ${result.sale.receiptNumber} في المسودات.`
          )
        );
      }
    } catch (submitError) {
      setError(submitError instanceof Error
        ? submitError.message
        : text('Could not save this travel invoice.', 'تعذر حفظ فاتورة السفر.'));
    } finally {
      setSaving(false);
      setSavingAsDraft(false);
    }
  };

  const formatMoney = (value: number) =>
    `${currency} ${value.toFixed(decimals)}`;
  const paymentInputClass =
    'mt-1 block w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-emerald-600';

  return (
    <div className="flex min-h-0 flex-1 min-w-0 flex-col overflow-y-auto bg-emerald-50/50 p-0">
      <form onSubmit={handleSubmit} className="mx-auto flex min-h-full w-full max-w-[1440px] flex-col border-y border-slate-200 bg-white">
        <section className="border-b border-slate-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-3 py-2 sm:px-4">
            <div>
              <h2 className="text-xs font-semibold text-slate-800">
                {editingSale
                  ? text(`Editing invoice ${editingSale.receiptNumber}`, `تعديل الفاتورة ${editingSale.receiptNumber}`)
                  : text('Travel services and charges', 'خدمات السفر والرسوم')}
              </h2>
              <p className="mt-0.5 text-[10px] text-slate-500">
                {editingSale
                  ? text('Update the existing invoice details and save your changes.', 'حدّث تفاصيل الفاتورة الحالية واحفظ التغييرات.')
                  : travelServices.length === 0
                    ? text('Add travel services in the Services catalog before creating an invoice.', 'أضف خدمات السفر إلى قائمة الخدمات قبل إنشاء الفاتورة.')
                    : text('Choose a frequent service or add a new service line to search saved services. Stock is not affected.', 'اختر خدمة متكررة أو أضف سطراً جديداً للبحث عن الخدمات المحفوظة. لا يتأثر المخزون.')}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setDraftsSearch('');
                  setDraftsModalOpen(true);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 focus:outline-none focus:ring-2 focus:ring-emerald-200"
              >
                <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{text('Drafts', 'المسودات')}</span>
                <span className="rounded-full bg-emerald-700 px-1.5 py-0.5 font-mono text-[10px] font-bold text-white">
                  {draftSales.length}
                </span>
              </button>
            </div>
          </div>
          <div className="border-b border-slate-200 bg-emerald-50/60 px-3 py-2 sm:px-4">
            {frequentServices.length > 0 && (
              <p className="mb-1.5 text-[10px] font-semibold text-slate-500">
                {text('Frequent services', 'الخدمات المتكررة')}
              </p>
            )}
            <div className="flex gap-2 overflow-x-auto pb-1">
              <button
                type="button"
                onClick={addNewServiceRow}
                aria-label={text('Add a new service line', 'إضافة خدمة جديدة')}
                className={`flex h-[76px] min-w-[200px] max-w-[220px] items-center gap-2 rounded-lg border border-dashed border-emerald-300 bg-emerald-50 p-2 text-emerald-900 shadow-sm transition-colors hover:border-emerald-500 hover:bg-emerald-100 focus:outline-none focus:ring-2 focus:ring-emerald-200 ${isRtl ? 'flex-row-reverse text-right' : 'text-left'}`}
              >
                <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md border border-emerald-200 bg-white text-emerald-700">
                  <Plus className="h-6 w-6" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-semibold">
                    {text('New service', 'خدمة جديدة')}
                  </span>
                  <span className="mt-1 block text-[10px] text-emerald-800">
                    {text('Search saved services', 'ابحث عن الخدمات المحفوظة')}
                  </span>
                </span>
              </button>
              {frequentServices.map((service) => (
                  <button
                    key={service.id}
                    type="button"
                    onClick={() => addQuickService(service)}
                    aria-label={text(`Add ${service.name} to the invoice`, `إضافة ${service.nameAr || service.name} إلى الفاتورة`)}
                    title={service.nameAr ? `${service.name} · ${service.nameAr}` : service.name}
                    className={`flex h-[76px] min-w-[200px] max-w-[220px] items-center gap-2 rounded-lg border border-slate-200 bg-white p-2 text-slate-700 shadow-sm transition-colors hover:border-emerald-400 hover:bg-emerald-50 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-200 ${isRtl ? 'flex-row-reverse text-right' : 'text-left'}`}
                  >
                    <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-md border border-slate-200 bg-emerald-50 text-emerald-700">
                      {service.imagePath || service.imageData ? (
                        <ProductImage
                          imagePath={service.imagePath}
                          imageData={service.imageData}
                          alt={isRtl ? service.nameAr || service.name : service.name}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <Ticket className="h-6 w-6" aria-hidden="true" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-semibold">
                        {isRtl ? service.nameAr || service.name : service.name}
                      </span>
                      <span
                        dir={service.nameAr && !isRtl ? 'rtl' : undefined}
                        className="mt-0.5 block truncate text-[10px] text-slate-500"
                      >
                        {service.nameAr && !isRtl ? service.nameAr : service.category}
                      </span>
                      <span className="mt-1 block font-mono text-[11px] font-semibold tabular-nums text-emerald-800">
                        {formatMoney(service.retailPrice)}
                      </span>
                    </span>
                  </button>
              ))}
            </div>
          </div>
          {rows.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center px-4 py-12 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-emerald-200 bg-emerald-50 text-emerald-700 shadow-sm">
                <Plane className="h-6 w-6" aria-hidden="true" />
              </div>
              <h3 className="mt-3 text-sm font-semibold text-slate-900">
                {text('No services added to this invoice yet', 'لم تتم إضافة خدمات إلى هذه الفاتورة بعد')}
              </h3>
              <p className="mt-1 max-w-md text-xs text-slate-500">
                {travelServices.length === 0
                  ? text('Add travel services in Service Master first to start billing.', 'أضف خدمات السفر في إدارة الخدمات أولاً للبدء في إصدار الفواتير.')
                  : text('Select a frequent service above or add a new service line to enter passenger, PNR, and flight details.', 'اختر خدمة متكررة أعلاه أو أضف سطراً جديداً لإدخال بيانات المسافر ومرجع الحجز والرحلة.')}
              </p>
              {travelServices.length > 0 && (
                <button
                  type="button"
                  onClick={addNewServiceRow}
                  className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-300"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  {text('Add service line', 'إضافة سطر خدمة')}
                </button>
              )}
            </div>
          ) : (
            <div className="min-w-0 p-3">
              <div className="space-y-3">
              {displayedRows.map(({ row, index }, displayIndex) => (
                <article
                  key={row.id}
                  role={row.isEditing ? 'dialog' : undefined}
                  aria-modal={row.isEditing || undefined}
                  aria-label={row.isEditing
                    ? text('Service details', 'تفاصيل الخدمة')
                    : undefined}
                  className={row.isEditing
                    ? 'fixed left-1/2 top-1/2 z-[80] max-h-[calc(100dvh-2rem)] w-[min(640px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-slate-200 bg-white p-4 shadow-2xl'
                    : 'rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition-colors hover:border-emerald-300 hover:bg-emerald-50/40'}
                >
                  {row.productId !== null && !row.isEditing ? (
                    <div className="flex min-w-0 items-center gap-2">
                      <button
                        ref={(element) => {
                          if (element) serviceCardButtonRefs.current.set(row.id, element);
                          else serviceCardButtonRefs.current.delete(row.id);
                        }}
                        type="button"
                        onClick={() => editServiceRow(row)}
                        aria-label={text(
                          `Edit ${rowDetails[index]?.product?.name || row.serviceSearch}`,
                          `تعديل ${rowDetails[index]?.product?.nameAr || rowDetails[index]?.product?.name || row.serviceSearch}`
                        )}
                        className={`flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left focus:outline-none ${isRtl ? 'flex-row-reverse text-right' : ''}`}
                      >
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-xs font-semibold text-emerald-800 border border-emerald-200">
                          {displayIndex + 1}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-slate-900">
                            {isRtl
                              ? rowDetails[index]?.product?.nameAr || rowDetails[index]?.product?.name || row.serviceSearch
                              : rowDetails[index]?.product?.name || row.serviceSearch}
                          </span>
                          {(row.passengerName.trim() || row.bookingReference.trim() || row.origin.trim() || row.destination.trim() || row.flightNumber.trim() || row.departureDate.trim() || row.details.trim()) && (
                            <span className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                              {(row.origin.trim() || row.destination.trim()) && (
                                <span className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 font-semibold text-emerald-900">
                                  {row.origin.trim() || '---'} → {row.destination.trim() || '---'}
                                </span>
                              )}
                              {row.bookingReference.trim() && (
                                <span className="inline-flex items-center rounded-md border border-slate-200 bg-slate-100 px-1.5 py-0.5 font-mono font-medium text-slate-700">
                                  PNR: {row.bookingReference.trim()}
                                </span>
                              )}
                              {row.passengerName.trim() && (
                                <span className="inline-flex items-center rounded-md border border-slate-200 bg-white px-1.5 py-0.5 font-medium text-slate-700">
                                  {row.passengerName.trim()}
                                </span>
                              )}
                              {row.flightNumber.trim() && (
                                <span className="inline-flex items-center rounded-md border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-slate-600">
                                  {row.flightNumber.trim()}
                                </span>
                              )}
                              {row.departureDate.trim() && (
                                <span className="inline-flex items-center rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-slate-600">
                                  {row.departureDate.trim()}
                                </span>
                              )}
                              {row.details.trim() && (
                                <span className="truncate text-slate-500">
                                  {row.details.trim()}
                                </span>
                              )}
                            </span>
                          )}
                          <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-500">
                            <span>{text('Rate', 'السعر')}: {formatMoney(Number(row.unitPrice))}</span>
                            {rowDetails[index]?.product?.requiresItinerary && (
                              <span>
                                {row.tripType === 'round-trip'
                                  ? text('Round trip', 'ذهاب وعودة')
                                  : text('One way', 'اتجاه واحد')}
                              </span>
                            )}
                          </span>
                        </span>
                        <span className="shrink-0 text-right">
                          <span className="block text-[10px] font-medium text-slate-500">
                            {text('Amount', 'الإجمالي')}
                          </span>
                          <span className="block font-mono text-sm font-semibold tabular-nums text-slate-900">
                            {formatMoney(rowDetails[index]?.amount || 0)}
                          </span>
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => duplicateServiceRow(row)}
                        aria-label={text('Duplicate service', 'تكرار الخدمة')}
                        title={text('Duplicate service', 'تكرار الخدمة')}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-emerald-50 hover:text-emerald-700"
                      >
                        <Copy className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeServiceRow(row.id)}
                        aria-label={text('Remove service', 'حذف الخدمة')}
                        title={text('Remove service', 'حذف الخدمة')}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold text-slate-900">
                      {text('Service details', 'تفاصيل الخدمة')}
                    </h3>
                    <div className="flex items-center gap-3">
                      {row.productId !== null && onEditService && (
                        <button
                          type="button"
                          onClick={() => {
                            const product = products.find((entry) => entry.id === row.productId);
                            if (product) onEditService(product);
                          }}
                          className="text-xs font-semibold text-emerald-800 underline decoration-emerald-300 underline-offset-2 hover:text-emerald-900"
                        >
                          {text('Edit service details', 'تعديل تفاصيل الخدمة')}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={closeServiceModal}
                        className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                      >
                        {text('Cancel', 'إلغاء')}
                      </button>
                    </div>
                  </div>
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-500">
                      {displayIndex + 1}
                    </span>
                    <input
                      type="text"
                      ref={(element) => {
                        if (element) serviceSearchInputRefs.current.set(row.id, element);
                        else serviceSearchInputRefs.current.delete(row.id);
                      }}
                      role="combobox"
                      aria-autocomplete="list"
                      aria-expanded={servicePickerRowId === row.id}
                      aria-controls={
                        servicePickerRowId === row.id
                          ? `flyerp-service-options-${row.id}`
                          : undefined
                      }
                      aria-activedescendant={
                        servicePickerRowId === row.id && activeServiceOptions.length > 0
                          ? `flyerp-service-option-${row.id}-${activeServiceSuggestionIndex}`
                          : undefined
                      }
                      value={getRowServiceLabel(row)}
                      onFocus={(event) => {
                        serviceInputRef.current = event.currentTarget;
                        if (travelServices.length > 0) {
                          setServicePickerRowId(row.id);
                          setActiveServiceSuggestionIndex(0);
                          setServiceDropdownPosition(getServiceDropdownPosition(event.currentTarget));
                        }
                      }}
                      onBlur={() => {
                        window.setTimeout(() => {
                          setServicePickerRowId((current) => {
                            if (current !== row.id) return current;
                            setServiceDropdownPosition(null);
                            return null;
                          });
                        }, 120);
                      }}
                      onChange={(event) => {
                        const serviceSearch = event.target.value;
                        const selectedService = travelServices.find(
                          (service) => serviceLabel(service) === serviceSearch
                        );
                        if (selectedService) {
                          selectService(row, selectedService);
                          return;
                        }
                        updateRow(row.id, {
                          serviceSearch,
                          productId: null,
                          unitPrice: '',
                        });
                        if (serviceSearch.trim()) {
                          setServicePickerRowId(row.id);
                          setActiveServiceSuggestionIndex(0);
                          setServiceDropdownPosition(getServiceDropdownPosition(event.currentTarget));
                        } else {
                          setServicePickerRowId(null);
                          setServiceDropdownPosition(null);
                        }
                      }}
                      onKeyDown={(event) => {
                        const suggestions = getServiceSuggestions(row.serviceSearch);
                        if (
                          event.key === 'ArrowDown' &&
                          servicePickerRowId === row.id &&
                          suggestions.length > 0
                        ) {
                          event.preventDefault();
                          setServicePickerRowId(row.id);
                          setActiveServiceSuggestionIndex((current) =>
                            Math.min(current + 1, suggestions.length - 1)
                          );
                        } else if (
                          event.key === 'ArrowUp' &&
                          servicePickerRowId === row.id &&
                          suggestions.length > 0
                        ) {
                          event.preventDefault();
                          setServicePickerRowId(row.id);
                          setActiveServiceSuggestionIndex((current) => Math.max(0, current - 1));
                        } else if (event.key === 'Enter') {
                          event.preventDefault();
                          if (servicePickerRowId === row.id && suggestions.length > 0) {
                            selectService(
                              row,
                              suggestions[Math.min(activeServiceSuggestionIndex, suggestions.length - 1)]
                            );
                          }
                        } else if (event.key === 'Escape') {
                          setServicePickerRowId(null);
                          setServiceDropdownPosition(null);
                        }
                      }}
                      className={`min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-100 ${isRtl ? 'text-right' : 'text-left'}`}
                      aria-label={text(`Search service ${displayIndex + 1}`, `ابحث عن الخدمة ${displayIndex + 1}`)}
                      placeholder={text('Search saved services', 'ابحث عن الخدمات المحفوظة')}
                    />
                  </div>
                  <div className="mt-3">
                    <label className="block min-w-0 text-xs font-medium text-slate-600">
                      {text('Details', 'التفاصيل')}
                      <input
                        ref={(element) => {
                          setServiceFieldRef(row.id, 'details', element);
                        }}
                        value={row.details}
                        onChange={(event) => updateRow(row.id, { details: event.target.value })}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            focusNextServiceField(row, 'details');
                          }
                        }}
                        placeholder={text('Optional service details', 'تفاصيل إضافية للخدمة')}
                        className={`mt-1 block w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-emerald-600 focus:outline-none ${isRtl ? 'text-right' : 'text-left'}`}
                        aria-label={text(`Details for service ${displayIndex + 1}`, `تفاصيل الخدمة ${displayIndex + 1}`)}
                      />
                    </label>
                  </div>
                  {rowDetails[index]?.product?.requiresItinerary === true && (
                    <fieldset className="mt-4 space-y-3 rounded-lg border border-emerald-200 bg-emerald-50/50 p-3">
                      <legend className="px-1 text-xs font-semibold text-slate-800">
                        {text('Passenger and flight details', 'بيانات المسافر والرحلة')}
                      </legend>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                        <label className="block text-xs font-medium text-slate-600">
                          {text('Passenger name', 'اسم المسافر')}
                          <input
                            ref={(element) => {
                              setServiceFieldRef(row.id, 'passengerName', element);
                            }}
                            value={row.passengerName}
                            onChange={(event) => updateRow(row.id, { passengerName: event.target.value })}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault();
                                focusNextServiceField(row, 'passengerName');
                              }
                            }}
                            className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-emerald-600 focus:outline-none"
                            aria-label={text(`Passenger name for service ${displayIndex + 1}`, `اسم المسافر للخدمة ${displayIndex + 1}`)}
                          />
                        </label>
                        <label className="block text-xs font-medium text-slate-600">
                          {text('Passport / ID number', 'رقم الجواز / الهوية')}
                          <input
                            ref={(element) => setServiceFieldRef(row.id, 'passportNumber', element)}
                            value={row.passportNumber}
                            onChange={(event) => updateRow(row.id, { passportNumber: event.target.value.toUpperCase() })}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault();
                                focusNextServiceField(row, 'passportNumber');
                              }
                            }}
                            className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm uppercase text-slate-900 focus:border-emerald-600 focus:outline-none"
                            aria-label={text(`Passport or ID number for service ${displayIndex + 1}`, `رقم الجواز أو الهوية للخدمة ${displayIndex + 1}`)}
                          />
                        </label>
                        <label className="block text-xs font-medium text-slate-600">
                          {text('Booking reference (PNR)', 'مرجع الحجز (PNR)')}
                          <input
                            ref={(element) => setServiceFieldRef(row.id, 'bookingReference', element)}
                            value={row.bookingReference}
                            onChange={(event) => updateRow(row.id, { bookingReference: event.target.value.toUpperCase() })}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault();
                                focusNextServiceField(row, 'bookingReference');
                              }
                            }}
                            className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm uppercase text-slate-900 focus:border-emerald-600 focus:outline-none"
                            aria-label={text(`Booking reference for service ${displayIndex + 1}`, `مرجع الحجز للخدمة ${displayIndex + 1}`)}
                          />
                        </label>
                      </div>
                      <div className="border-t border-emerald-200/70 pt-3">
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto_1fr]">
                          <label className="block text-xs font-medium text-slate-600">
                            {text('From', 'من')}
                            <input
                              ref={(element) => setServiceFieldRef(row.id, 'origin', element)}
                              value={row.origin}
                              onChange={(event) => updateRow(row.id, { origin: event.target.value.toUpperCase() })}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                  event.preventDefault();
                                  focusNextServiceField(row, 'origin');
                                }
                              }}
                              placeholder="RUH"
                              className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm uppercase text-slate-900 focus:border-emerald-600 focus:outline-none"
                              aria-label={text(`Origin for service ${displayIndex + 1}`, `مغادرة الخدمة ${displayIndex + 1}`)}
                            />
                          </label>
                          <div className="flex items-end justify-center pb-1">
                            <button
                              type="button"
                              onClick={() => updateRow(row.id, { origin: row.destination, destination: row.origin })}
                              title={text('Swap origin and destination', 'تبديل المغادرة والوجهة')}
                              aria-label={text('Swap origin and destination', 'تبديل المغادرة والوجهة')}
                              className="flex h-9 w-9 items-center justify-center rounded-lg border border-emerald-200 bg-white text-emerald-800 hover:bg-emerald-100 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                            >
                              <ArrowLeftRight className="h-4 w-4" aria-hidden="true" />
                            </button>
                          </div>
                          <label className="block text-xs font-medium text-slate-600">
                            {text('To', 'إلى')}
                            <input
                              ref={(element) => setServiceFieldRef(row.id, 'destination', element)}
                              value={row.destination}
                              onChange={(event) => updateRow(row.id, { destination: event.target.value.toUpperCase() })}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                  event.preventDefault();
                                  focusNextServiceField(row, 'destination');
                                }
                              }}
                              placeholder="DXB"
                              className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm uppercase text-slate-900 focus:border-emerald-600 focus:outline-none"
                              aria-label={text(`Destination for service ${displayIndex + 1}`, `وجهة الخدمة ${displayIndex + 1}`)}
                            />
                          </label>
                        </div>
                        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                          <label className="block text-xs font-medium text-slate-600">
                            {text('Flight number', 'رقم الرحلة')}
                            <input
                              ref={(element) => setServiceFieldRef(row.id, 'flightNumber', element)}
                              value={row.flightNumber}
                              onChange={(event) => updateRow(row.id, { flightNumber: event.target.value.toUpperCase() })}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                  event.preventDefault();
                                  focusNextServiceField(row, 'flightNumber');
                                }
                              }}
                              className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm uppercase text-slate-900 focus:border-emerald-600 focus:outline-none"
                              aria-label={text(`Flight number for service ${displayIndex + 1}`, `رقم الرحلة للخدمة ${displayIndex + 1}`)}
                            />
                          </label>
                          <label className="block text-xs font-medium text-slate-600">
                            {text('Trip type', 'نوع الرحلة')}
                            <select
                              ref={(element) => setServiceFieldRef(row.id, 'tripType', element)}
                              value={row.tripType}
                              onChange={(event) => {
                                const tripType = event.target.value as TravelSaleRow['tripType'];
                                updateRow(row.id, {
                                  tripType,
                                  ...(tripType === 'one-way'
                                    ? { returnFlightNumber: '', returnDate: '' }
                                    : {}),
                                });
                              }}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                  event.preventDefault();
                                  focusNextServiceField(row, 'tripType');
                                }
                              }}
                              className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-emerald-600 focus:outline-none"
                              aria-label={text(`Trip type for service ${displayIndex + 1}`, `نوع الرحلة للخدمة ${displayIndex + 1}`)}
                            >
                              <option value="one-way">{text('One way', 'اتجاه واحد')}</option>
                              <option value="round-trip">{text('Round trip', 'ذهاب وعودة')}</option>
                            </select>
                          </label>
                          <label className="block text-xs font-medium text-slate-600">
                            {text('Departure date', 'تاريخ المغادرة')}
                            <AppDateInput
                              ref={(element) => setServiceFieldRef(row.id, 'departureDate', element)}
                              value={row.departureDate}
                              onChange={(departureDate) => updateRow(row.id, { departureDate })}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                  event.preventDefault();
                                  focusNextServiceField(row, 'departureDate');
                                }
                              }}
                              className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-emerald-600 focus:outline-none"
                              aria-label={text(`Departure date for service ${displayIndex + 1}`, `تاريخ المغادرة للخدمة ${displayIndex + 1}`)}
                            />
                          </label>
                        </div>
                      </div>
                      {row.tripType === 'round-trip' && (
                        <div className="grid grid-cols-1 gap-3 border-t border-emerald-200/70 pt-3 sm:grid-cols-2">
                            <label className="block text-xs font-medium text-slate-600">
                              {text('Return flight number', 'رقم رحلة العودة')}
                              <input
                                ref={(element) => setServiceFieldRef(row.id, 'returnFlightNumber', element)}
                                value={row.returnFlightNumber}
                                onChange={(event) => updateRow(row.id, { returnFlightNumber: event.target.value })}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter') {
                                    event.preventDefault();
                                    focusNextServiceField(row, 'returnFlightNumber');
                                  }
                                }}
                                className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-emerald-600 focus:outline-none"
                                aria-label={text(`Return flight number for service ${displayIndex + 1}`, `رقم رحلة العودة للخدمة ${displayIndex + 1}`)}
                              />
                            </label>
                            <label className="block text-xs font-medium text-slate-600">
                              {text('Return date', 'تاريخ العودة')}
                              <AppDateInput
                                ref={(element) => setServiceFieldRef(row.id, 'returnDate', element)}
                                value={row.returnDate}
                                onChange={(returnDate) => updateRow(row.id, { returnDate })}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter') {
                                    event.preventDefault();
                                    focusNextServiceField(row, 'returnDate');
                                  }
                                }}
                                className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-emerald-600 focus:outline-none"
                                aria-label={text(`Return date for service ${displayIndex + 1}`, `تاريخ العودة للخدمة ${displayIndex + 1}`)}
                              />
                            </label>
                        </div>
                      )}
                    </fieldset>
                  )}
                  <label className="mt-3 block min-w-0 text-xs font-medium text-slate-600">
                    {text('Rate', 'السعر')}
                    <input
                      ref={(element) => {
                        setServiceFieldRef(row.id, 'rate', element);
                      }}
                      type="text"
                      inputMode="decimal"
                      value={row.unitPrice}
                      onChange={(event) => updateRow(row.id, { unitPrice: event.target.value })}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          saveServiceModal();
                        }
                      }}
                      className="mt-1 block w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-right font-mono text-sm tabular-nums text-slate-900 focus:border-emerald-600 focus:outline-none"
                      aria-label={text(`Rate for service ${displayIndex + 1}`, `سعر الخدمة ${displayIndex + 1}`)}
                    />
                  </label>
                  {serviceModalError && serviceModalRowId === row.id && (
                    <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                      {serviceModalError}
                    </p>
                  )}
                  <div className="mt-4 flex justify-end">
                    <button
                      type="button"
                      onClick={saveServiceModal}
                      className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800"
                    >
                      {serviceModalIsNew
                        ? text('Add service', 'إضافة الخدمة')
                        : text('Save changes', 'حفظ التعديلات')}
                    </button>
                  </div>
                    </>
                  )}
                </article>
              ))}
              </div>
            </div>
          )}
          {serviceModalRow && createPortal(
            <div
              className="fixed inset-0 z-[70] bg-slate-950/50"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) closeServiceModal();
              }}
            />,
            document.body
          )}
          {servicePickerRowId !== null &&
            activeServiceRow &&
            serviceDropdownPosition &&
            createPortal(
              <div
                id={`flyerp-service-options-${activeServiceRow.id}`}
                role="listbox"
                aria-label={text('Available services', 'الخدمات المتاحة')}
                className="fixed z-[1000] overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 shadow-xl"
                style={{
                  top: serviceDropdownPosition.top,
                  left: serviceDropdownPosition.left,
                  width: serviceDropdownPosition.width,
                  maxHeight: serviceDropdownPosition.maxHeight,
                }}
              >
                {activeServiceOptions.length === 0 ? (
                  <p className="px-3 py-3 text-xs text-slate-500">
                    {text('No matching services found.', 'لم يتم العثور على خدمات مطابقة.')}
                  </p>
                ) : activeServiceOptions.map((service, optionIndex) => (
                  <button
                    key={service.id}
                    id={`flyerp-service-option-${activeServiceRow.id}-${optionIndex}`}
                    type="button"
                    role="option"
                    aria-selected={optionIndex === activeServiceSuggestionIndex}
                    onPointerDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setActiveServiceSuggestionIndex(optionIndex)}
                    onClick={() => selectService(activeServiceRow, service)}
                    className={`flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left ${
                      optionIndex === activeServiceSuggestionIndex
                        ? 'bg-emerald-50'
                        : 'hover:bg-slate-50'
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-semibold text-slate-900">
                        {isRtl ? service.nameAr || service.name : service.name}
                      </span>
                      {((isRtl && service.name) || (!isRtl && service.nameAr)) && (
                        <span className={`block truncate text-[10px] text-slate-500 ${isRtl ? '' : 'text-right'}`} dir={isRtl ? 'ltr' : 'rtl'}>
                          {isRtl ? service.name : service.nameAr}
                        </span>
                      )}
                      <span className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-slate-500">
                        <span>{service.category}</span>
                        {service.unit && (
                          <span>{text('Unit', 'الوحدة')}: {service.unit}</span>
                        )}
                        <span>{text('Tax', 'الضريبة')} {service.taxRate ?? settings.taxRate}%</span>
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block font-mono text-xs font-semibold tabular-nums text-slate-900">
                        {formatMoney(service.retailPrice)}
                      </span>
                      <span className="block text-[10px] text-slate-500">
                        {text('per service', 'لكل خدمة')}
                      </span>
                    </span>
                  </button>
                ))}
              </div>,
              document.body
            )}
        </section>
        {!settlementExpanded ? (
          <div className="sticky bottom-3 z-20 mx-3 mt-auto mb-2 space-y-2">
            {draftNotice && (
              <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-800 shadow-xs">
                {draftNotice}
              </p>
            )}
            {error && (
              <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-700 shadow-xs">
                {error}
              </p>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-white/95 px-4 py-2.5 shadow-[0_10px_28px_-10px_rgba(6,78,59,0.28)] backdrop-blur">
              <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
                <div className="min-w-0">
                  <span className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    {text('Total', 'الإجمالي')}
                  </span>
                  <span className="font-mono text-lg font-bold tabular-nums text-emerald-700">
                    {formatMoney(totals.total)}
                  </span>
                </div>
                <div className="hidden h-7 w-px bg-slate-200 sm:block" />
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-600">
                  <span>
                    <strong className="font-mono font-semibold text-slate-900">{rows.length}</strong>{' '}
                    {rows.length === 1 ? text('service', 'خدمة') : text('services', 'خدمات')}
                  </span>
                  <span className="text-slate-300">·</span>
                  <span className="max-w-[160px] truncate font-medium text-slate-700">
                    {customer?.name || settings.defaultCustomer || text('Walk-in customer', 'عميل نقدي')}
                  </span>
                  <span className="hidden text-slate-300 md:inline">·</span>
                  <span className="hidden md:inline">
                    {text('VAT', 'الضريبة')}:{' '}
                    <strong className="font-mono font-semibold text-slate-800">{formatMoney(totals.taxAmount)}</strong>
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSettlementExpanded(true)}
                className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-emerald-700 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-300"
              >
                <span>{text('Settle', 'تسوية')}</span>
                <ChevronUp className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        ) : (
        <div className="sticky bottom-2 z-20 mx-2 mt-auto rounded-xl border border-emerald-200 bg-white/95 shadow-[0_-8px_20px_-10px_rgba(6,78,59,0.28)] backdrop-blur">
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-2 sm:px-5">
            <span className="text-xs font-semibold text-slate-800">
              {text('Customer & Settlement', 'العميل والتسوية')}
            </span>
            <button
              type="button"
              onClick={() => setSettlementExpanded(false)}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            >
              <span>{text('Collapse', 'تصغير')}</span>
              <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
          <div className="grid min-w-0 grid-cols-1 gap-x-5 gap-y-3 px-4 py-3 lg:grid-cols-[minmax(0,1fr)_minmax(300px,0.8fr)] sm:px-5 sm:py-4">
            <div className="grid min-w-0 grid-cols-1 items-end gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <div className="relative min-w-0 text-xs font-medium leading-5 text-slate-700">
                <div className="flex items-center justify-between gap-2">
                  <label htmlFor="flyerp-customer" className="truncate">
                    {text('Customer / Buyer', 'العميل / المشتري')}
                  </label>
                  <button
                    type="button"
                    onClick={() => setCustomerModalOpen(true)}
                    className="inline-flex shrink-0 items-center gap-1 rounded-md px-1 text-[10px] font-semibold text-emerald-800 hover:bg-emerald-50"
                    aria-label={text('Add new customer', 'إضافة عميل جديد')}
                  >
                    <Plus className="h-3 w-3" />
                    {text('New', 'جديد')}
                  </button>
                </div>
                <div className="relative mt-1">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                  <input
                    id="flyerp-customer"
                    type="text"
                    value={customerDropdownOpen ? customerSearch : (customer?.name || '')}
                    placeholder={settings.defaultCustomer || text('Walk-in customer', 'عميل نقدي')}
                    onFocus={() => {
                      setCustomerSearch('');
                      setCustomerDropdownOpen(true);
                    }}
                    onBlur={() => {
                      window.setTimeout(() => setCustomerDropdownOpen(false), 140);
                    }}
                    onChange={(event) => {
                      setCustomerSearch(event.target.value);
                      setCustomerDropdownOpen(true);
                    }}
                    className="block w-full min-w-0 rounded-lg border border-slate-200 bg-white py-2.5 pl-8 pr-7 text-sm text-slate-900 outline-none focus:border-emerald-600"
                    autoComplete="off"
                  />
                  {(customerId !== null || customerSearch) && (
                    <button
                      type="button"
                      onPointerDown={(event) => event.preventDefault()}
                      onClick={() => {
                        setCustomerId(null);
                        setCustomerSearch('');
                        setCustomerDropdownOpen(false);
                      }}
                      aria-label={text('Clear customer', 'مسح العميل')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {customerDropdownOpen && (
                    <div className="absolute bottom-full left-0 z-30 mb-1 max-h-56 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 shadow-xl">
                      <button
                        type="button"
                        onPointerDown={(event) => event.preventDefault()}
                        onClick={() => {
                          setCustomerId(null);
                          setCustomerSearch('');
                          setCustomerDropdownOpen(false);
                        }}
                        className={`flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-xs ${customerId === null ? 'bg-emerald-50 font-semibold text-emerald-900' : 'text-slate-700 hover:bg-slate-50'}`}
                      >
                        <span>{settings.defaultCustomer || text('Walk-in customer', 'عميل نقدي')}</span>
                      </button>
                      {filteredCustomers.length === 0 ? (
                        <p className="px-2.5 py-2 text-xs text-slate-500">
                          {text('No matching customers.', 'لا يوجد عملاء مطابقون.')}
                        </p>
                      ) : filteredCustomers.map((entry) => (
                        <button
                          key={entry.id}
                          type="button"
                          onPointerDown={(event) => event.preventDefault()}
                          onClick={() => {
                            setCustomerId(entry.id);
                            setCustomerSearch('');
                            setCustomerDropdownOpen(false);
                          }}
                          className={`flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-xs ${customerId === entry.id ? 'bg-emerald-50 font-semibold text-emerald-900' : 'text-slate-700 hover:bg-slate-50'}`}
                        >
                          <span className="truncate">{entry.name}</span>
                          {entry.phone && (
                            <span className="shrink-0 font-mono text-[10px] text-slate-400">{entry.phone}</span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <label htmlFor="flyerp-invoice-date" className="block min-w-0 text-xs font-medium leading-5 text-slate-700">
                {text('Invoice Date', 'تاريخ الفاتورة')}
                <AppDateInput
                  id="flyerp-invoice-date"
                  value={invoiceDate}
                  disabled={!settings.allowInvoiceDateEdit}
                  onChange={setInvoiceDate}
                  className={`${paymentInputClass} disabled:bg-slate-100 disabled:text-slate-500`}
                />
              </label>
              <label className="block min-w-0 text-xs font-medium leading-5 text-slate-700">
                {text('Payment method', 'طريقة الدفع')}
                <select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)} className={paymentInputClass}>
                  {methods.map((method) => <option key={method} value={method}>{method}</option>)}
                </select>
              </label>
              {paymentMethod === 'Cash' && (
                <label className="block min-w-0 text-xs font-medium leading-5 text-slate-700">
                  {text('Cash received', 'المبلغ المستلم')}
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={cashTendered ?? totals.total.toFixed(decimals)}
                    onChange={(event) => setCashTendered(event.target.value)}
                    className={paymentInputClass}
                  />
                </label>
              )}
              <label className="block min-w-0 text-xs font-medium leading-5 text-slate-700">
                {text('Discount', 'الخصم')}
                <span className="flex min-w-0 gap-1">
                  <input type="number" min="0" step="0.01" value={discountValue} onChange={(event) => setDiscountValue(event.target.value)} className={paymentInputClass} />
                  <select value={discountType} onChange={(event) => setDiscountType(event.target.value as 'fixed' | 'percent')} className={`${paymentInputClass} max-w-24`}>
                    <option value="fixed">{currency}</option>
                    <option value="percent">%</option>
                  </select>
                </span>
              </label>
            </div>
            <div className="grid min-w-0 grid-cols-1 gap-3 lg:border-l lg:border-slate-200 lg:pl-4">
              <dl className="grid grid-cols-2 gap-x-4 text-xs">
                <div className="col-span-2 flex justify-between gap-2 py-1 text-slate-600">
                  <dt>{text('Tax mode', 'طريقة الضريبة')}</dt>
                  <dd className="font-medium text-slate-800">
                    {settings.taxType === 'inclusive'
                      ? text('VAT included in price', 'الضريبة مشمولة في السعر')
                      : text('VAT added to price', 'تضاف الضريبة إلى السعر')}
                  </dd>
                </div>
                <div className="flex justify-between gap-2 py-1 text-slate-600">
                  <dt>{text('Subtotal', 'الإجمالي الفرعي')}</dt><dd className="font-mono font-semibold tabular-nums text-slate-900">{formatMoney(totals.subtotal)}</dd>
                </div>
                <div className="flex justify-between gap-2 py-1 text-slate-600">
                  <dt>{text('Discount', 'الخصم')}</dt><dd className="font-mono font-semibold tabular-nums text-slate-900">−{formatMoney(totals.discountAmount)}</dd>
                </div>
                <div className="flex justify-between gap-2 py-1 text-slate-600">
                  <dt>{text('Tax', 'الضريبة')}</dt><dd className="font-mono font-semibold tabular-nums text-slate-900">{formatMoney(totals.taxAmount)}</dd>
                </div>
                <div className="col-span-2 flex justify-between gap-2 border-t border-slate-200 py-1.5 text-sm font-bold text-slate-900">
                  <dt>{text('Invoice total', 'إجمالي الفاتورة')}</dt><dd className="font-mono text-lg font-bold tabular-nums text-emerald-700">{formatMoney(totals.total)}</dd>
                </div>
                <div className="col-span-2 flex justify-between gap-2 py-1 text-slate-600">
                  <dt>{text('Payment status', 'حالة الدفع')}</dt>
                  <dd className="font-semibold text-slate-900">
                    {paymentStatus === 'Partially Paid'
                      ? text('Partially Paid', 'مدفوع جزئياً')
                      : paymentStatus === 'Unpaid'
                        ? text('Unpaid', 'غير مدفوع')
                        : text('Paid', 'مدفوع')}
                  </dd>
                </div>
                {balanceDue > 0 && (
                  <div className="col-span-2 flex justify-between gap-2 py-1 font-semibold text-emerald-800">
                    <dt>{text('Balance due', 'الرصيد المستحق')}</dt>
                    <dd className="font-mono tabular-nums">{formatMoney(balanceDue)}</dd>
                  </div>
                )}
              </dl>
              <div className="grid grid-cols-4 gap-2">
                <button
                  type="button"
                  onClick={editingSale ? cancelEdit : clearDraft}
                  disabled={saving}
                  className="col-span-1 inline-flex w-full items-center justify-center rounded-lg border border-red-200 bg-red-50 px-2 py-2.5 text-sm font-semibold text-red-700 hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-200 disabled:opacity-60"
                >
                  <span className="truncate">
                    {editingSale ? text('Cancel', 'إلغاء') : text('Clear', 'مسح')}
                  </span>
                </button>
                <button
                  type="submit"
                  disabled={saving || travelServices.length === 0 || rows.length === 0}
                  className="col-span-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-300 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Save className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span className="truncate">
                    {saving
                      ? text('Saving…', 'جارٍ الحفظ…')
                      : editingSale
                        ? text('Update invoice', 'تحديث الفاتورة')
                        : text('Save invoice', 'حفظ الفاتورة')}
                  </span>
                </button>
              </div>
            </div>
            {draftNotice && (
              <p role="status" className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-xs font-medium text-emerald-800 lg:col-span-2">
                {draftNotice}
              </p>
            )}
            {error && <p role="alert" className="rounded border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-700 lg:col-span-2">{error}</p>}
          </div>
        </div>
        )}

      </form>
      {customerModalOpen && (
        <CustomerFormModal
          customer={null}
          onClose={closeCustomerModal}
          onSaved={(createdCustomer) => {
            onCustomerCreated(createdCustomer);
            setCustomerId(createdCustomer.id);
            setError(null);
          }}
        />
      )}
      {saveConfirmationOpen && createPortal(
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/60 p-3 sm:p-5"
          role="dialog"
          aria-modal="true"
          aria-labelledby="flyerp-save-confirm-title"
          onClick={(event) => {
            if (event.target === event.currentTarget && !saving) {
              setSaveConfirmationOpen(false);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && !saving) {
              event.preventDefault();
              setSaveConfirmationOpen(false);
            }
          }}
        >
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-2xl">
            <h2 id="flyerp-save-confirm-title" className="text-lg font-bold text-slate-900">
              {editingSale
                ? text('Confirm invoice changes', 'تأكيد تغييرات الفاتورة')
                : text('Confirm invoice', 'تأكيد الفاتورة')}
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              {editingSale
                ? text('Save changes to this invoice?', 'هل تريد حفظ التغييرات على هذه الفاتورة؟')
                : text('Save this completed invoice?', 'هل تريد حفظ هذه الفاتورة المكتملة؟')}
            </p>
            <dl className="mt-4 space-y-2 rounded-lg bg-slate-50 p-3 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">{text('Invoice date', 'تاريخ الفاتورة')}</dt>
                <dd className="font-medium text-slate-800">{invoiceDate.split('-').reverse().join('/')}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">{text('Customer', 'العميل')}</dt>
                <dd className="text-right font-medium text-slate-800">
                  {customer?.name || settings.defaultCustomer}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">{text('Service lines', 'عدد الخدمات')}</dt>
                <dd className="font-medium text-slate-800">
                  {rows.filter((row) => row.productId !== null).length}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">{text('Payment method', 'طريقة الدفع')}</dt>
                <dd className="font-medium text-slate-800">{paymentMethod}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">{text('Payment status', 'حالة الدفع')}</dt>
                <dd className="font-medium text-slate-800">
                  {paymentStatus === 'Partially Paid'
                    ? text('Partially Paid', 'مدفوع جزئياً')
                    : paymentStatus === 'Unpaid'
                      ? text('Unpaid', 'غير مدفوع')
                      : text('Paid', 'مدفوع')}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">{text('Paid amount', 'المبلغ المدفوع')}</dt>
                <dd className="font-mono tabular-nums text-slate-800">{formatMoney(amountPaid)}</dd>
              </div>
              {balanceDue > 0 && (
                <div className="flex justify-between gap-3 font-semibold text-emerald-800">
                  <dt>{text('Balance due', 'الرصيد المستحق')}</dt>
                  <dd className="font-mono tabular-nums">{formatMoney(balanceDue)}</dd>
                </div>
              )}
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">{text('Tax status', 'حالة الضريبة')}</dt>
                <dd className="font-medium text-slate-800">
                  {settings.taxType === 'inclusive'
                    ? text('This invoice is tax included', 'الضريبة مشمولة في هذه الفاتورة')
                    : text('This invoice is tax excluded', 'هذه الفاتورة غير شاملة للضريبة')}
                </dd>
              </div>
              <div className="flex justify-between gap-3 border-t border-slate-200 pt-2 text-xs">
                <dt className="text-slate-500">{text('Subtotal', 'الإجمالي الفرعي')}</dt>
                <dd className="font-mono tabular-nums text-slate-700">{formatMoney(totals.subtotal)}</dd>
              </div>
              {totals.discountAmount > 0 && (
                <div className="flex justify-between gap-3 text-xs">
                  <dt className="text-slate-500">{text('Discount', 'الخصم')}</dt>
                  <dd className="font-mono tabular-nums text-slate-700">−{formatMoney(totals.discountAmount)}</dd>
                </div>
              )}
              <div className="flex justify-between gap-3 text-xs">
                <dt className="text-slate-500">{text('Tax', 'الضريبة')}</dt>
                <dd className="font-mono tabular-nums text-slate-700">{formatMoney(totals.taxAmount)}</dd>
              </div>
              <div className="flex justify-between gap-3 border-t border-slate-200 pt-2 font-bold">
                <dt className="text-slate-700">{text('Settled amount', 'المبلغ المسدد')}</dt>
                <dd className="font-mono tabular-nums text-slate-900">{formatMoney(totals.total)}</dd>
              </div>
            </dl>
            {error && (
              <p role="alert" className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </p>
            )}
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={() => setSaveConfirmationOpen(false)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                {text('Cancel', 'إلغاء')}
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleConfirmSave(true)}
                className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-60"
              >
                {saving && savingAsDraft
                  ? text('Saving…', 'جارٍ الحفظ…')
                  : text('Draft', 'مسودة')}
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleConfirmSave(false)}
                className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
              >
                {saving && !savingAsDraft
                  ? text('Saving…', 'جارٍ الحفظ…')
                  : editingSale
                    ? text('Confirm and update', 'تأكيد وتحديث')
                    : text('Confirm and save', 'تأكيد وحفظ')}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
      {draftsModalOpen && createPortal(
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/60 p-3 sm:p-5"
          role="dialog"
          aria-modal="true"
          aria-labelledby="flyerp-drafts-modal-title"
          onClick={(event) => {
            if (event.target === event.currentTarget) setDraftsModalOpen(false);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              setDraftsModalOpen(false);
            }
          }}
        >
          <div
            dir={isRtl ? 'rtl' : 'ltr'}
            className="flex max-h-[min(80dvh,640px)] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl"
          >
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
              <div>
                <h2 id="flyerp-drafts-modal-title" className="text-base font-bold text-slate-900">
                  {text('Saved Drafts', 'المسودات المحفوظة')}
                </h2>
                <p className="text-xs text-slate-500">
                  {text('Select a draft invoice to load it into Travel Billing.', 'اختر مسودة فاتورة لتحميلها في شاشة فواتير السفر.')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDraftsModalOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                aria-label={text('Close drafts', 'إغلاق المسودات')}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="border-b border-slate-200 bg-emerald-50/40 px-4 py-2.5">
              <div className="relative">
                <Search
                  className={`pointer-events-none absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400 ${isRtl ? 'right-2.5' : 'left-2.5'}`}
                  aria-hidden="true"
                />
                <input
                  type="search"
                  value={draftsSearch}
                  onChange={(event) => setDraftsSearch(event.target.value)}
                  placeholder={text('Search by receipt, customer, or service…', 'ابحث برقم الفاتورة أو العميل أو الخدمة…')}
                  className={`w-full rounded-lg border border-slate-200 bg-white py-2 text-xs text-slate-900 outline-none focus:border-emerald-600 ${isRtl ? 'pr-8 pl-3' : 'pl-8 pr-3'}`}
                />
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {filteredDraftSales.length === 0 ? (
                <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-700">
                    <FileText className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <p className="mt-3 text-sm font-semibold text-slate-800">
                    {draftSales.length === 0
                      ? text('No saved drafts yet', 'لا توجد مسودات محفوظة بعد')
                      : text('No matching drafts found', 'لم يتم العثور على مسودات مطابقة')}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {draftSales.length === 0
                      ? text('Use the Draft button in Confirm invoice to save an invoice for later.', 'استخدم زر المسودة في نافذة تأكيد الفاتورة لحفظ الفاتورة لاحقاً.')
                      : text('Try a different search term.', 'جرّب كلمة بحث أخرى.')}
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredDraftSales.map((draft) => {
                    const isCurrent = editingSale?.id === draft.id;
                    const servicePreview = draft.items
                      .map((item) => (isRtl ? item.nameAr || item.productName : item.productName))
                      .join(', ');
                    return (
                      <div
                        key={draft.id}
                        className={`flex items-center justify-between gap-3 rounded-xl border p-3 transition-colors ${
                          isCurrent
                            ? 'border-emerald-300 bg-emerald-50/70'
                            : 'border-slate-200 bg-white hover:border-emerald-300 hover:bg-emerald-50/30'
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-xs font-bold text-slate-900">
                              {draft.receiptNumber}
                            </span>
                            <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-semibold text-sky-700">
                              {text('Draft', 'مسودة')}
                            </span>
                            {isCurrent && (
                              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
                                {text('Loaded', 'محمّلة')}
                              </span>
                            )}
                            <span className="text-[11px] text-slate-500">
                              {(draft.invoiceDate || draft.createdAt.slice(0, 10)).split('-').reverse().join('/')}
                            </span>
                          </div>
                          <div className="mt-1 truncate text-xs font-semibold text-slate-800">
                            {draft.customerName}
                          </div>
                          <div className="mt-0.5 truncate text-[11px] text-slate-500" title={servicePreview}>
                            {draft.items.length} {draft.items.length === 1 ? text('service', 'خدمة') : text('services', 'خدمات')}
                            {servicePreview ? ` · ${servicePreview}` : ''}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <span className="font-mono text-xs font-bold tabular-nums text-emerald-800">
                            {formatMoney(draft.total)}
                          </span>
                          <button
                            type="button"
                            disabled={printingDraftId === draft.id}
                            onClick={async () => {
                              setPrintingDraftId(draft.id);
                              setError(null);
                              try {
                                const salesFormat = getPrintDocumentFormat(settings, 'sales-invoice', 'A4');
                                const salesTemplateId =
                                  settings.printDocumentProfiles?.['sales-invoice']?.[salesFormat]?.templateId;
                                const job = await createVoucherTemplateJob(
                                  'sales-invoice',
                                  draft.id,
                                  settings,
                                  salesFormat,
                                  isRtl,
                                  undefined,
                                  salesTemplateId
                                );
                                await printTemplateJob({ ...job, silent: false });
                              } catch (printErr) {
                                setError(
                                  printErr instanceof Error
                                    ? printErr.message
                                    : text('Could not print sales draft.', 'تعذرت طباعة مسودة المبيعات.')
                                );
                              } finally {
                                setPrintingDraftId(null);
                              }
                            }}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800 disabled:opacity-40"
                            title={text('Print sales draft', 'طباعة مسودة المبيعات')}
                          >
                            {printingDraftId === draft.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Printer className="h-3.5 w-3.5" />
                            )}
                            <span>{text('Print', 'طباعة')}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setDraftNotice(null);
                              setError(null);
                              onLoadDraft?.(draft);
                              setDraftsModalOpen(false);
                            }}
                            className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800"
                          >
                            {text('Load', 'تحميل')}
                          </button>
                          {onDeleteDraft && (
                            <button
                              type="button"
                              disabled={deletingDraftId === draft.id}
                              onClick={async () => {
                                setDeletingDraftId(draft.id);
                                try {
                                  await onDeleteDraft(draft.id);
                                } catch (deleteErr) {
                                  setError(
                                    deleteErr instanceof Error
                                      ? deleteErr.message
                                      : text('Could not delete draft.', 'تعذر حذف المسودة.')
                                  );
                                } finally {
                                  setDeletingDraftId(null);
                                }
                              }}
                              className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-400 hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                              title={text('Delete draft', 'حذف المسودة')}
                              aria-label={text('Delete draft', 'حذف المسودة')}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};
