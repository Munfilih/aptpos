import { randomUUID } from 'node:crypto';
import type { ZatcaEnvironment } from './crypto';
import { ZATCA_GENESIS_PIH } from './crypto';
import {
  buildAndSignZatcaInvoice,
  type ZatcaInvoiceSubType,
  type ZatcaInvoiceTypeCode,
  type ZatcaPartyAddress,
} from './xmlBuilder';

const FATOORA_BASE_URLS: Record<ZatcaEnvironment, string> = {
  sandbox: 'https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal',
  simulation: 'https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation',
  production: 'https://gw-fatoora.zatca.gov.sa/e-invoicing/core',
};

export interface ZatcaValidationMessage {
  type?: string;
  code?: string;
  category?: string;
  message?: string;
  status?: string;
}

export interface ZatcaApiInvoiceResponse {
  ok: boolean;
  httpStatus: number;
  status: 'CLEARED' | 'REPORTED' | 'WARNING' | 'REJECTED' | 'FAILED';
  clearedInvoiceXml?: string;
  warnings: ZatcaValidationMessage[];
  errors: ZatcaValidationMessage[];
  raw?: unknown;
}

export interface ZatcaCsidResponse {
  requestID: string;
  binarySecurityToken: string;
  secret: string;
  dispositionMessage?: string;
}

function basicAuthHeader(csid: string, secret: string): string {
  return `Basic ${Buffer.from(`${csid}:${secret}`, 'utf8').toString('base64')}`;
}

export async function requestComplianceCsid(
  environment: ZatcaEnvironment,
  csrBase64: string,
  otp: string
): Promise<ZatcaCsidResponse> {
  const url = `${FATOORA_BASE_URLS[environment]}/compliance`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Accept-Version': 'V2',
      OTP: otp.trim(),
    },
    body: JSON.stringify({ csr: csrBase64 }),
  });

  const rawText = await response.text();
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(rawText) as Record<string, unknown>;
  } catch {
    data = { message: rawText };
  }
  if (!response.ok || typeof data.binarySecurityToken !== 'string' || typeof data.secret !== 'string') {
    const errMsg =
      (Array.isArray(data.errors) && data.errors.map((e: unknown) => JSON.stringify(e)).join('; ')) ||
      (typeof data.message === 'string' && data.message) ||
      `ZATCA compliance CSID request failed (HTTP ${response.status}).`;
    throw new Error(errMsg);
  }

  return {
    requestID: String(data.requestID ?? ''),
    binarySecurityToken: data.binarySecurityToken,
    secret: data.secret,
    dispositionMessage: typeof data.dispositionMessage === 'string' ? data.dispositionMessage : undefined,
  };
}

export async function requestProductionCsid(
  environment: ZatcaEnvironment,
  complianceCsid: string,
  complianceSecret: string,
  complianceRequestId: string
): Promise<ZatcaCsidResponse> {
  const url = `${FATOORA_BASE_URLS[environment]}/production/csids`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Accept-Version': 'V2',
      Authorization: basicAuthHeader(complianceCsid, complianceSecret),
    },
    body: JSON.stringify({ compliance_request_id: complianceRequestId }),
  });

  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok || typeof data.binarySecurityToken !== 'string' || typeof data.secret !== 'string') {
    const errMsg =
      (typeof data.message === 'string' && data.message) ||
      `ZATCA production CSID request failed (HTTP ${response.status}).`;
    throw new Error(errMsg);
  }

  return {
    requestID: String(data.requestID ?? ''),
    binarySecurityToken: data.binarySecurityToken,
    secret: data.secret,
    dispositionMessage: typeof data.dispositionMessage === 'string' ? data.dispositionMessage : undefined,
  };
}

function parseInvoiceApiResponse(
  httpStatus: number,
  data: Record<string, unknown>,
  mode: 'clearance' | 'reporting'
): ZatcaApiInvoiceResponse {
  const validation = (data.validationResults || {}) as Record<string, unknown>;
  const warnings = Array.isArray(validation.warningMessages)
    ? (validation.warningMessages as ZatcaValidationMessage[])
    : [];
  const errors = Array.isArray(validation.errorMessages)
    ? (validation.errorMessages as ZatcaValidationMessage[])
    : [];

  const clearanceStatus = String(data.clearanceStatus || '').toUpperCase();
  const reportingStatus = String(data.reportingStatus || '').toUpperCase();
  const clearedInvoiceXml =
    typeof data.clearedInvoice === 'string' && data.clearedInvoice
      ? Buffer.from(data.clearedInvoice, 'base64').toString('utf8')
      : undefined;

  if (httpStatus === 200 || httpStatus === 202) {
    const passed =
      mode === 'clearance'
        ? clearanceStatus === 'CLEARED' || Boolean(clearedInvoiceXml)
        : reportingStatus === 'REPORTED' || httpStatus === 200 || httpStatus === 202;
    if (passed) {
      return {
        ok: true,
        httpStatus,
        status: warnings.length > 0 ? 'WARNING' : mode === 'clearance' ? 'CLEARED' : 'REPORTED',
        clearedInvoiceXml,
        warnings,
        errors,
        raw: data,
      };
    }
  }

  return {
    ok: false,
    httpStatus,
    status: httpStatus >= 400 && httpStatus < 500 ? 'REJECTED' : 'FAILED',
    clearedInvoiceXml,
    warnings,
    errors: errors.length
      ? errors
      : [{ message: typeof data.message === 'string' ? data.message : `ZATCA API returned HTTP ${httpStatus}` }],
    raw: data,
  };
}

export async function submitComplianceInvoice(
  environment: ZatcaEnvironment,
  complianceCsid: string,
  complianceSecret: string,
  invoiceHash: string,
  uuid: string,
  xmlSigned: string
): Promise<ZatcaApiInvoiceResponse> {
  const url = `${FATOORA_BASE_URLS[environment]}/compliance/invoices`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Accept-Language': 'en',
      'Accept-Version': 'V2',
      Authorization: basicAuthHeader(complianceCsid, complianceSecret),
    },
    body: JSON.stringify({
      invoiceHash,
      uuid,
      invoice: Buffer.from(xmlSigned, 'utf8').toString('base64'),
    }),
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return parseInvoiceApiResponse(response.status, data, 'reporting');
}

export async function clearB2BInvoice(
  environment: ZatcaEnvironment,
  productionCsid: string,
  productionSecret: string,
  invoiceHash: string,
  uuid: string,
  xmlSigned: string
): Promise<ZatcaApiInvoiceResponse> {
  const url = `${FATOORA_BASE_URLS[environment]}/invoices/clearance/single`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Accept-Language': 'en',
      'Accept-Version': 'V2',
      'Clearance-Status': '1',
      Authorization: basicAuthHeader(productionCsid, productionSecret),
    },
    body: JSON.stringify({
      invoiceHash,
      uuid,
      invoice: Buffer.from(xmlSigned, 'utf8').toString('base64'),
    }),
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return parseInvoiceApiResponse(response.status, data, 'clearance');
}

export async function reportB2CInvoice(
  environment: ZatcaEnvironment,
  productionCsid: string,
  productionSecret: string,
  invoiceHash: string,
  uuid: string,
  xmlSigned: string
): Promise<ZatcaApiInvoiceResponse> {
  const url = `${FATOORA_BASE_URLS[environment]}/invoices/reporting/single`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Accept-Language': 'en',
      'Accept-Version': 'V2',
      'Clearance-Status': '0',
      Authorization: basicAuthHeader(productionCsid, productionSecret),
    },
    body: JSON.stringify({
      invoiceHash,
      uuid,
      invoice: Buffer.from(xmlSigned, 'utf8').toString('base64'),
    }),
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return parseInvoiceApiResponse(response.status, data, 'reporting');
}

export interface ComplianceCheckResult {
  label: string;
  invoiceTypeCode: ZatcaInvoiceTypeCode;
  invoiceSubType: ZatcaInvoiceSubType;
  ok: boolean;
  status: string;
  warnings: ZatcaValidationMessage[];
  errors: ZatcaValidationMessage[];
}

export async function runAllSixComplianceChecks(params: {
  environment: ZatcaEnvironment;
  privateKeyPem: string;
  complianceCsid: string;
  complianceSecret: string;
  seller: ZatcaPartyAddress;
}): Promise<{ allPassed: boolean; results: ComplianceCheckResult[] }> {
  const now = new Date();
  const issueDate = now.toISOString().slice(0, 10);
  const issueTime = now.toISOString().slice(11, 19);

  const sampleBuyer: ZatcaPartyAddress = {
    name: 'Sample B2B Buyer LLC',
    vatNumber: '399999999900003',
    streetName: 'King Fahd Road',
    buildingNumber: '2322',
    district: 'Al Olaya',
    city: 'Riyadh',
    postalCode: '12214',
    countryCode: 'SA',
  };

  const cases: Array<{
    label: string;
    invoiceTypeCode: ZatcaInvoiceTypeCode;
    invoiceSubType: ZatcaInvoiceSubType;
    billingReferenceId?: string;
    instructionNote?: string;
  }> = [
    { label: 'B2B Standard Invoice (388)', invoiceTypeCode: '388', invoiceSubType: '0100000' },
    {
      label: 'B2B Credit Note (381)',
      invoiceTypeCode: '381',
      invoiceSubType: '0100000',
      billingReferenceId: 'COMP-B2B-1',
      instructionNote: 'Goods returned by buyer',
    },
    {
      label: 'B2B Debit Note (383)',
      invoiceTypeCode: '383',
      invoiceSubType: '0100000',
      billingReferenceId: 'COMP-B2B-1',
      instructionNote: 'Price adjustment',
    },
    { label: 'B2C Simplified Invoice (388)', invoiceTypeCode: '388', invoiceSubType: '0200000' },
    {
      label: 'B2C Credit Note (381)',
      invoiceTypeCode: '381',
      invoiceSubType: '0200000',
      billingReferenceId: 'COMP-B2C-1',
      instructionNote: 'Customer return',
    },
    {
      label: 'B2C Debit Note (383)',
      invoiceTypeCode: '383',
      invoiceSubType: '0200000',
      billingReferenceId: 'COMP-B2C-1',
      instructionNote: 'Additional charge',
    },
  ];

  const results: ComplianceCheckResult[] = [];
  let previousHash = ZATCA_GENESIS_PIH;

  for (let i = 0; i < cases.length; i += 1) {
    const testCase = cases[i];
    const uuid = randomUUID();
    const signed = buildAndSignZatcaInvoice(
      {
        uuid,
        invoiceNumber: `COMP-${i + 1}`,
        issueDate,
        issueTime,
        invoiceTypeCode: testCase.invoiceTypeCode,
        invoiceSubType: testCase.invoiceSubType,
        icv: i + 1,
        pih: previousHash,
        seller: params.seller,
        buyer: testCase.invoiceSubType === '0100000' ? sampleBuyer : { name: 'Walk-in Customer' },
        billingReferenceId: testCase.billingReferenceId,
        instructionNote: testCase.instructionNote,
        lines: [{ id: 1, name: 'Compliance Test Item', quantity: 1, unitPriceExclTax: 100, taxRate: 15 }],
      },
      params.privateKeyPem,
      params.complianceCsid
    );

    const apiRes = await submitComplianceInvoice(
      params.environment,
      params.complianceCsid,
      params.complianceSecret,
      signed.invoiceHash,
      uuid,
      signed.xmlSigned
    );

    previousHash = signed.invoiceHash;
    results.push({
      label: testCase.label,
      invoiceTypeCode: testCase.invoiceTypeCode,
      invoiceSubType: testCase.invoiceSubType,
      ok: apiRes.ok,
      status: apiRes.status,
      warnings: apiRes.warnings,
      errors: apiRes.errors,
    });
  }

  return {
    allPassed: results.every((r) => r.ok),
    results,
  };
}
