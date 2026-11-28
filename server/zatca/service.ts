import { randomUUID } from 'node:crypto';
import {
  getPendingZatcaReports,
  getSettings,
  getZatcaDeviceConfig,
  getZatcaInvoiceByDocument,
  getZatcaInvoiceById,
  listCustomers,
  listSales,
  listSalesReturnVouchers,
  listZatcaInvoices,
  saveZatcaDeviceConfig,
  saveZatcaInvoiceRecord,
  updateZatcaInvoiceSubmission,
  type ZatcaInvoiceRow,
} from '../db';
import {
  ZATCA_GENESIS_PIH,
  buildZatcaCsrBase64,
  decryptZatcaSecret,
  encryptZatcaSecret,
  generateEgsUuid,
  generateSecp256k1KeyPair,
  parseZatcaCertificate,
  type ZatcaEnvironment,
} from './crypto';
import {
  buildAndSignZatcaInvoice,
  mapPaymentMethodToZatcaCode,
  validateB2BBuyerAddress,
  type ZatcaPartyAddress,
} from './xmlBuilder';
import {
  clearB2BInvoice,
  reportB2CInvoice,
  requestComplianceCsid,
  requestProductionCsid,
  runAllSixComplianceChecks,
} from './client';
import type { Customer, Sale, StoreSettings } from '../../src/types/pos';

function buildSellerAddress(settings: StoreSettings): ZatcaPartyAddress {
  return {
    name: (settings.storeName || '').trim(),
    vatNumber: (settings.taxId || '').trim(),
    crNumber: (settings.crNumber || '').trim(),
    streetName: (settings.streetName || settings.address || '').trim(),
    buildingNumber: (settings.buildingNo || '').trim(),
    district: (settings.district || '').trim(),
    city: (settings.city || '').trim(),
    postalCode: (settings.postalCode || '').trim(),
    countryCode: 'SA',
  };
}

function validateSellerForOnboarding(seller: ZatcaPartyAddress): void {
  const missing: string[] = [];
  if (!seller.name) missing.push('Business Name');
  if (!seller.vatNumber || !/^\d{15}$/.test(seller.vatNumber)) {
    missing.push('15-digit VAT Number');
  }
  if (!seller.streetName) missing.push('Street Name');
  if (!seller.buildingNumber || !/^\d{4}$/.test(seller.buildingNumber)) {
    missing.push('4-digit Building No.');
  }
  if (!seller.district) missing.push('District');
  if (!seller.city) missing.push('City');
  if (!seller.postalCode || !/^\d{5}$/.test(seller.postalCode)) {
    missing.push('5-digit Postal Code');
  }
  if (missing.length > 0) {
    throw new Error(
      `Complete these Business Settings before ZATCA onboarding: ${missing.join(', ')}.`
    );
  }
}

export async function getZatcaStatusSummary() {
  const config = await getZatcaDeviceConfig();
  const invoices = await listZatcaInvoices(500);
  const counts = {
    total: invoices.length,
    cleared: 0,
    reported: 0,
    warning: 0,
    pending: 0,
    rejected: 0,
    failed: 0,
  };
  for (const inv of invoices) {
    if (inv.submissionStatus === 'CLEARED') counts.cleared += 1;
    else if (inv.submissionStatus === 'REPORTED') counts.reported += 1;
    else if (inv.submissionStatus === 'WARNING') counts.warning += 1;
    else if (inv.submissionStatus === 'PENDING') counts.pending += 1;
    else if (inv.submissionStatus === 'REJECTED') counts.rejected += 1;
    else if (inv.submissionStatus === 'FAILED') counts.failed += 1;
  }

  return {
    configured: Boolean(config),
    egsUuid: config?.egsUuid || null,
    environment: config?.environment || 'sandbox',
    businessCategory: config?.businessCategory || 'Retail',
    hasComplianceCsid: Boolean(config?.complianceCsid),
    complianceChecksPassed: Boolean(config?.complianceChecksPassed),
    hasProductionCsid: Boolean(config?.productionCsid),
    certificateExpiresAt: config?.certificateExpiresAt || null,
    lastIcv: config?.lastIcv ?? 0,
    onboardedAt: config?.onboardedAt || null,
    counts,
  };
}

export async function onboardZatcaCompliance(params: {
  environment: ZatcaEnvironment;
  otp: string;
  businessCategory?: string;
}) {
  const otp = (params.otp || '').trim();
  if (!/^\d{6}$/.test(otp)) {
    throw new Error('Enter the 6-digit OTP from the ZATCA Fatoora portal.');
  }
  const settings = await getSettings();
  const seller = buildSellerAddress(settings);
  validateSellerForOnboarding(seller);

  const existing = await getZatcaDeviceConfig();
  const egsUuid = existing?.egsUuid || generateEgsUuid();
  const businessCategory = (params.businessCategory || existing?.businessCategory || 'Retail').trim();
  const { privateKeyPem, publicKeyPem } = generateSecp256k1KeyPair();

  const csrBase64 = buildZatcaCsrBase64(privateKeyPem, publicKeyPem, {
    egsUuid,
    commonName: `aptPOS-${seller.vatNumber}-${egsUuid.slice(0, 8)}`,
    organizationName: seller.name,
    organizationUnitName: seller.city || 'Main Branch',
    vatNumber: seller.vatNumber!,
    registeredAddress: `${seller.buildingNumber} ${seller.streetName}, ${seller.city}`,
    businessCategory,
    invoiceType: '1100',
    environment: params.environment,
  });

  const csidRes = await requestComplianceCsid(params.environment, csrBase64, otp);
  const parsedCert = parseZatcaCertificate(csidRes.binarySecurityToken);

  await saveZatcaDeviceConfig({
    egsUuid,
    environment: params.environment,
    businessCategory,
    privateKeyEnc: encryptZatcaSecret(privateKeyPem),
    publicKeyPem,
    csrBase64,
    complianceCsid: csidRes.binarySecurityToken,
    complianceSecretEnc: encryptZatcaSecret(csidRes.secret),
    complianceRequestId: csidRes.requestID,
    complianceChecksPassed: false,
    productionCsid: '',
    productionSecretEnc: '',
    certificateExpiresAt: parsedCert.validToIso,
    lastIcv: existing?.lastIcv ?? 0,
    lastPih: existing?.lastPih || ZATCA_GENESIS_PIH,
    onboardedAt: null,
    updatedAt: new Date().toISOString(),
  });

  return {
    egsUuid,
    environment: params.environment,
    complianceRequestId: csidRes.requestID,
    dispositionMessage: csidRes.dispositionMessage,
  };
}

export async function runZatcaComplianceChecks() {
  const config = await getZatcaDeviceConfig();
  if (!config || !config.complianceCsid || !config.complianceSecretEnc || !config.privateKeyEnc) {
    throw new Error('Complete Step 1 (Compliance CSID onboarding with OTP) first.');
  }
  const settings = await getSettings();
  const seller = buildSellerAddress(settings);
  const privateKeyPem = decryptZatcaSecret(config.privateKeyEnc);
  const complianceSecret = decryptZatcaSecret(config.complianceSecretEnc);

  const report = await runAllSixComplianceChecks({
    environment: config.environment,
    privateKeyPem,
    complianceCsid: config.complianceCsid,
    complianceSecret,
    seller,
  });

  if (report.allPassed) {
    await saveZatcaDeviceConfig({
      ...config,
      complianceChecksPassed: true,
    });
  }

  return report;
}

export async function activateZatcaProductionCsid() {
  const config = await getZatcaDeviceConfig();
  if (!config || !config.complianceCsid || !config.complianceSecretEnc || !config.complianceRequestId) {
    throw new Error('Complete Compliance CSID onboarding first.');
  }
  const complianceSecret = decryptZatcaSecret(config.complianceSecretEnc);
  const prodRes = await requestProductionCsid(
    config.environment,
    config.complianceCsid,
    complianceSecret,
    config.complianceRequestId
  );
  const parsedCert = parseZatcaCertificate(prodRes.binarySecurityToken);

  await saveZatcaDeviceConfig({
    ...config,
    complianceChecksPassed: true,
    productionCsid: prodRes.binarySecurityToken,
    productionSecretEnc: encryptZatcaSecret(prodRes.secret),
    certificateExpiresAt: parsedCert.validToIso,
    onboardedAt: new Date().toISOString(),
  });

  return {
    certificateExpiresAt: parsedCert.validToIso,
    dispositionMessage: prodRes.dispositionMessage,
  };
}

function findCustomerForSale(sale: Sale, customers: Customer[]): Customer | undefined {
  if (sale.customerId) {
    const byId = customers.find((c) => c.id === sale.customerId);
    if (byId) return byId;
  }
  if (sale.customerName) {
    return customers.find((c) => c.name === sale.customerName);
  }
  return undefined;
}

function resolveBuyerAndSubType(customer?: Customer, fallbackName?: string): {
  isB2B: boolean;
  buyer: ZatcaPartyAddress;
} {
  const vat = (customer?.vatNumber || '').trim();
  const isB2B = /^\d{15}$/.test(vat);
  const buyer: ZatcaPartyAddress = {
    name: (customer?.name || fallbackName || 'Walk-in Customer').trim(),
    vatNumber: vat || undefined,
    crNumber: (customer?.crNumber || '').trim() || undefined,
    streetName: (customer?.streetName || customer?.address || '').trim() || undefined,
    buildingNumber: (customer?.buildingNo || '').trim() || undefined,
    district: (customer?.district || '').trim() || undefined,
    city: (customer?.city || '').trim() || undefined,
    postalCode: (customer?.postalCode || '').trim() || undefined,
    countryCode: 'SA',
  };
  return { isB2B, buyer };
}

export async function processSaleForZatca(saleId: number): Promise<ZatcaInvoiceRow | null> {
  const settings = await getSettings();
  if (!settings.enableZatcaEinvoice || settings.zatcaPhase !== '2') return null;

  const config = await getZatcaDeviceConfig();
  if (!config || !config.productionCsid || !config.productionSecretEnc || !config.privateKeyEnc) {
    return null;
  }

  const existing = await getZatcaInvoiceByDocument('SALE', saleId);
  if (existing) return existing;

  const sale = (await listSales()).find((s) => s.id === saleId);
  if (!sale || sale.status !== 'COMPLETED') return null;

  const customers = await listCustomers();
  const customer = findCustomerForSale(sale, customers);
  const { isB2B, buyer } = resolveBuyerAndSubType(customer, sale.customerName);

  if (isB2B) {
    const buyerErrors = validateB2BBuyerAddress(buyer);
    if (buyerErrors.length > 0) {
      throw new Error(`B2B ZATCA validation failed: ${buyerErrors.join(' ')}`);
    }
  }

  const seller = buildSellerAddress(settings);
  const privateKeyPem = decryptZatcaSecret(config.privateKeyEnc);
  const prodSecret = decryptZatcaSecret(config.productionSecretEnc);

  const createdDate = new Date(sale.createdAt || Date.now());
  const issueDate =
    sale.invoiceDate && /^\d{4}-\d{2}-\d{2}$/.test(sale.invoiceDate)
      ? sale.invoiceDate
      : createdDate.toISOString().slice(0, 10);
  const issueTime = createdDate.toISOString().slice(11, 19);

  const nextIcv = config.lastIcv + 1;
  const pih = config.lastPih || ZATCA_GENESIS_PIH;
  const uuid = randomUUID();
  const isTaxInclusive = (sale.taxType ?? settings.taxType) === 'inclusive';

  const lines = sale.items.map((item, idx) => {
    const rate = Number(item.taxRate ?? sale.taxRate ?? settings.taxRate ?? 15);
    const qty = Number(item.quantity || 1);
    const unitExcl = isTaxInclusive && rate > 0
      ? Number(item.unitPrice || 0) / (1 + rate / 100)
      : Number(item.unitPrice || 0);
    return {
      id: idx + 1,
      name: item.productName,
      quantity: qty,
      unitPriceExclTax: unitExcl,
      lineDiscount: Number(item.discountAmount || 0),
      taxRate: rate,
    };
  });

  const signed = buildAndSignZatcaInvoice(
    {
      uuid,
      invoiceNumber: sale.receiptNumber,
      issueDate,
      issueTime,
      invoiceTypeCode: '388',
      invoiceSubType: isB2B ? '0100000' : '0200000',
      currencyCode: 'SAR',
      icv: nextIcv,
      pih,
      seller,
      buyer,
      paymentMeansCode: mapPaymentMethodToZatcaCode(sale.paymentMethod),
      documentDiscount: Number(sale.discountAmount || 0),
      lines,
    },
    privateKeyPem,
    config.productionCsid
  );

  let submissionStatus: ZatcaInvoiceRow['submissionStatus'] = 'PENDING';
  let xmlCleared = '';
  let warningsJson = '[]';
  let errorsJson = '[]';
  let submittedAt: string | null = null;

  try {
    const apiRes = isB2B
      ? await clearB2BInvoice(
          config.environment,
          config.productionCsid,
          prodSecret,
          signed.invoiceHash,
          uuid,
          signed.xmlSigned
        )
      : await reportB2CInvoice(
          config.environment,
          config.productionCsid,
          prodSecret,
          signed.invoiceHash,
          uuid,
          signed.xmlSigned
        );
    submissionStatus = apiRes.status;
    xmlCleared = apiRes.clearedInvoiceXml || '';
    warningsJson = JSON.stringify(apiRes.warnings);
    errorsJson = JSON.stringify(apiRes.errors);
    submittedAt = new Date().toISOString();
  } catch (err) {
    submissionStatus = isB2B ? 'FAILED' : 'PENDING';
    errorsJson = JSON.stringify([{ message: err instanceof Error ? err.message : 'Network error' }]);
  }

  await saveZatcaDeviceConfig({
    ...config,
    lastIcv: nextIcv,
    lastPih: signed.invoiceHash,
  });

  return saveZatcaInvoiceRecord({
    documentType: 'SALE',
    documentId: sale.id,
    invoiceNumber: sale.receiptNumber,
    uuid,
    invoiceTypeCode: '388',
    invoiceSubtype: isB2B ? '0100000' : '0200000',
    icv: nextIcv,
    pih,
    invoiceHash: signed.invoiceHash,
    xmlSigned: signed.xmlSigned,
    xmlCleared,
    qrPhase2: signed.qrPhase2,
    submissionStatus,
    zatcaWarningsJson: warningsJson,
    zatcaErrorsJson: errorsJson,
    retryCount: submissionStatus === 'PENDING' || submissionStatus === 'FAILED' ? 1 : 0,
    submittedAt,
  });
}

export async function processSalesReturnForZatca(
  voucherId: number,
  reason = 'Customer return / refund'
): Promise<ZatcaInvoiceRow | null> {
  const settings = await getSettings();
  if (!settings.enableZatcaEinvoice || settings.zatcaPhase !== '2') return null;

  const config = await getZatcaDeviceConfig();
  if (!config || !config.productionCsid || !config.productionSecretEnc || !config.privateKeyEnc) {
    return null;
  }

  const existing = await getZatcaInvoiceByDocument('SALES_RETURN', voucherId);
  if (existing) return existing;

  const voucher = (await listSalesReturnVouchers()).find((v) => v.id === voucherId);
  if (!voucher) return null;

  const originalSaleId = voucher.items[0]?.saleId;
  const originalSale = originalSaleId ? (await listSales()).find((s) => s.id === originalSaleId) || null : null;
  const customers = await listCustomers();
  const customer = originalSale ? findCustomerForSale(originalSale, customers) : undefined;
  const { isB2B, buyer } = resolveBuyerAndSubType(customer, originalSale?.customerName);

  const seller = buildSellerAddress(settings);
  const privateKeyPem = decryptZatcaSecret(config.privateKeyEnc);
  const prodSecret = decryptZatcaSecret(config.productionSecretEnc);

  const createdDate = new Date(voucher.createdAt || Date.now());
  const issueDate = createdDate.toISOString().slice(0, 10);
  const issueTime = createdDate.toISOString().slice(11, 19);

  const nextIcv = config.lastIcv + 1;
  const pih = config.lastPih || ZATCA_GENESIS_PIH;
  const uuid = randomUUID();
  const defaultRate = Number(settings.taxRate ?? 15);

  const lines = voucher.items.map((item, idx) => {
    const qty = Math.max(1, Number(item.quantity || 1));
    const lineIncl = Number(item.refundAmount || 0);
    const unitExcl = defaultRate > 0 ? lineIncl / qty / (1 + defaultRate / 100) : lineIncl / qty;
    return {
      id: idx + 1,
      name: item.productName,
      quantity: qty,
      unitPriceExclTax: unitExcl,
      taxRate: defaultRate,
    };
  });

  const signed = buildAndSignZatcaInvoice(
    {
      uuid,
      invoiceNumber: voucher.voucherNumber,
      issueDate,
      issueTime,
      invoiceTypeCode: '381',
      invoiceSubType: isB2B ? '0100000' : '0200000',
      currencyCode: 'SAR',
      icv: nextIcv,
      pih,
      seller,
      buyer,
      paymentMeansCode: mapPaymentMethodToZatcaCode(voucher.paymentMethod),
      billingReferenceId: voucher.sourceInvoices[0] || originalSale?.receiptNumber || voucher.voucherNumber,
      instructionNote: reason.trim() || 'Customer return / refund',
      lines,
    },
    privateKeyPem,
    config.productionCsid
  );

  let submissionStatus: ZatcaInvoiceRow['submissionStatus'] = 'PENDING';
  let xmlCleared = '';
  let warningsJson = '[]';
  let errorsJson = '[]';
  let submittedAt: string | null = null;

  try {
    const apiRes = isB2B
      ? await clearB2BInvoice(
          config.environment,
          config.productionCsid,
          prodSecret,
          signed.invoiceHash,
          uuid,
          signed.xmlSigned
        )
      : await reportB2CInvoice(
          config.environment,
          config.productionCsid,
          prodSecret,
          signed.invoiceHash,
          uuid,
          signed.xmlSigned
        );
    submissionStatus = apiRes.status;
    xmlCleared = apiRes.clearedInvoiceXml || '';
    warningsJson = JSON.stringify(apiRes.warnings);
    errorsJson = JSON.stringify(apiRes.errors);
    submittedAt = new Date().toISOString();
  } catch (err) {
    submissionStatus = isB2B ? 'FAILED' : 'PENDING';
    errorsJson = JSON.stringify([{ message: err instanceof Error ? err.message : 'Network error' }]);
  }

  await saveZatcaDeviceConfig({
    ...config,
    lastIcv: nextIcv,
    lastPih: signed.invoiceHash,
  });

  return saveZatcaInvoiceRecord({
    documentType: 'SALES_RETURN',
    documentId: voucher.id,
    invoiceNumber: voucher.voucherNumber,
    uuid,
    invoiceTypeCode: '381',
    invoiceSubtype: isB2B ? '0100000' : '0200000',
    icv: nextIcv,
    pih,
    invoiceHash: signed.invoiceHash,
    xmlSigned: signed.xmlSigned,
    xmlCleared,
    qrPhase2: signed.qrPhase2,
    submissionStatus,
    zatcaWarningsJson: warningsJson,
    zatcaErrorsJson: errorsJson,
    retryCount: submissionStatus === 'PENDING' || submissionStatus === 'FAILED' ? 1 : 0,
    submittedAt,
  });
}

export async function createDebitNoteForSale(params: {
  saleId: number;
  amountExclTax: number;
  taxRate?: number;
  reason: string;
}): Promise<ZatcaInvoiceRow> {
  const config = await getZatcaDeviceConfig();
  if (!config || !config.productionCsid || !config.productionSecretEnc || !config.privateKeyEnc) {
    throw new Error('ZATCA Phase 2 Production CSID is not active.');
  }
  const sale = (await listSales()).find((s) => s.id === params.saleId);
  if (!sale) throw new Error('Original invoice not found.');
  if (!params.reason?.trim()) throw new Error('Debit note reason is required by ZATCA.');
  if (!Number.isFinite(params.amountExclTax) || params.amountExclTax <= 0) {
    throw new Error('Enter a valid positive adjustment amount.');
  }

  const settings = await getSettings();
  const customers = await listCustomers();
  const customer = findCustomerForSale(sale, customers);
  const { isB2B, buyer } = resolveBuyerAndSubType(customer, sale.customerName);
  const seller = buildSellerAddress(settings);
  const privateKeyPem = decryptZatcaSecret(config.privateKeyEnc);
  const prodSecret = decryptZatcaSecret(config.productionSecretEnc);

  const now = new Date();
  const nextIcv = config.lastIcv + 1;
  const pih = config.lastPih || ZATCA_GENESIS_PIH;
  const uuid = randomUUID();
  const debitNumber = `DN-${sale.receiptNumber}-${nextIcv}`;
  const rate = params.taxRate ?? Number(settings.taxRate ?? 15);

  const signed = buildAndSignZatcaInvoice(
    {
      uuid,
      invoiceNumber: debitNumber,
      issueDate: now.toISOString().slice(0, 10),
      issueTime: now.toISOString().slice(11, 19),
      invoiceTypeCode: '383',
      invoiceSubType: isB2B ? '0100000' : '0200000',
      currencyCode: 'SAR',
      icv: nextIcv,
      pih,
      seller,
      buyer,
      paymentMeansCode: mapPaymentMethodToZatcaCode(sale.paymentMethod),
      billingReferenceId: sale.receiptNumber,
      instructionNote: params.reason.trim(),
      lines: [
        {
          id: 1,
          name: `Debit Adjustment (${sale.receiptNumber})`,
          quantity: 1,
          unitPriceExclTax: params.amountExclTax,
          taxRate: rate,
        },
      ],
    },
    privateKeyPem,
    config.productionCsid
  );

  const apiRes = isB2B
    ? await clearB2BInvoice(
        config.environment,
        config.productionCsid,
        prodSecret,
        signed.invoiceHash,
        uuid,
        signed.xmlSigned
      )
    : await reportB2CInvoice(
        config.environment,
        config.productionCsid,
        prodSecret,
        signed.invoiceHash,
        uuid,
        signed.xmlSigned
      );

  await saveZatcaDeviceConfig({
    ...config,
    lastIcv: nextIcv,
    lastPih: signed.invoiceHash,
  });

  return saveZatcaInvoiceRecord({
    documentType: 'DEBIT_NOTE',
    documentId: nextIcv,
    invoiceNumber: debitNumber,
    uuid,
    invoiceTypeCode: '383',
    invoiceSubtype: isB2B ? '0100000' : '0200000',
    icv: nextIcv,
    pih,
    invoiceHash: signed.invoiceHash,
    xmlSigned: signed.xmlSigned,
    xmlCleared: apiRes.clearedInvoiceXml || '',
    qrPhase2: signed.qrPhase2,
    submissionStatus: apiRes.status,
    zatcaWarningsJson: JSON.stringify(apiRes.warnings),
    zatcaErrorsJson: JSON.stringify(apiRes.errors),
    retryCount: apiRes.ok ? 0 : 1,
    submittedAt: new Date().toISOString(),
  });
}

export async function retryZatcaInvoice(zatcaInvoiceId: number): Promise<ZatcaInvoiceRow> {
  const record = await getZatcaInvoiceById(zatcaInvoiceId);
  if (!record) throw new Error('ZATCA invoice record not found.');

  const config = await getZatcaDeviceConfig();
  if (!config || !config.productionCsid || !config.productionSecretEnc) {
    throw new Error('ZATCA Production CSID is not configured.');
  }
  const prodSecret = decryptZatcaSecret(config.productionSecretEnc);
  const isB2B = record.invoiceSubtype === '0100000';

  const apiRes = isB2B
    ? await clearB2BInvoice(
        config.environment,
        config.productionCsid,
        prodSecret,
        record.invoiceHash,
        record.uuid,
        record.xmlSigned
      )
    : await reportB2CInvoice(
        config.environment,
        config.productionCsid,
        prodSecret,
        record.invoiceHash,
        record.uuid,
        record.xmlSigned
      );

  return (await updateZatcaInvoiceSubmission(record.id, {
    submissionStatus: apiRes.status,
    xmlCleared: apiRes.clearedInvoiceXml,
    zatcaWarningsJson: JSON.stringify(apiRes.warnings),
    zatcaErrorsJson: JSON.stringify(apiRes.errors),
    retryCount: record.retryCount + 1,
    submittedAt: new Date().toISOString(),
  }))!;
}

let queueRunning = false;

export async function processPendingZatcaQueue(): Promise<number> {
  if (queueRunning) return 0;
  const config = await getZatcaDeviceConfig();
  if (!config || !config.productionCsid || !config.productionSecretEnc) return 0;

  queueRunning = true;
  let processed = 0;
  try {
    const pending = await getPendingZatcaReports(20);
    for (const record of pending) {
      try {
        await retryZatcaInvoice(record.id);
        processed += 1;
      } catch {
        // Keep in queue for next cycle
      }
    }
  } finally {
    queueRunning = false;
  }
  return processed;
}
