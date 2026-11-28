import { createHash } from 'node:crypto';
import {
  generatePhase2QrBase64,
  parseZatcaCertificate,
  signHashWithPrivateKey,
} from './crypto';

export type ZatcaInvoiceTypeCode = '388' | '381' | '383';
export type ZatcaInvoiceSubType = '0100000' | '0200000';

export interface ZatcaPartyAddress {
  name: string;
  vatNumber?: string;
  crNumber?: string;
  streetName?: string;
  buildingNumber?: string;
  district?: string;
  city?: string;
  postalCode?: string;
  countryCode?: string;
}

export interface ZatcaInvoiceLineInput {
  id: string | number;
  name: string;
  quantity: number;
  unitPriceExclTax: number;
  lineDiscount?: number;
  taxRate: number;
  taxCategoryCode?: 'S' | 'Z' | 'E' | 'O';
}

export interface ZatcaInvoiceBuildInput {
  uuid: string;
  invoiceNumber: string;
  issueDate: string; // YYYY-MM-DD
  issueTime: string; // HH:mm:ss
  invoiceTypeCode: ZatcaInvoiceTypeCode;
  invoiceSubType: ZatcaInvoiceSubType;
  currencyCode?: string;
  icv: number;
  pih: string;
  seller: ZatcaPartyAddress;
  buyer?: ZatcaPartyAddress;
  paymentMeansCode?: '10' | '30' | '42' | '48' | '1';
  billingReferenceId?: string;
  instructionNote?: string;
  documentDiscount?: number;
  lines: ZatcaInvoiceLineInput[];
}

export interface SignedZatcaInvoiceResult {
  xmlUnsigned: string;
  xmlSigned: string;
  invoiceHash: string;
  signatureBase64: string;
  qrPhase2: string;
  totalWithVat: number;
  vatTotal: number;
}

function escapeXml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function round2(value: number): number {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function fmt2(value: number): string {
  return round2(value).toFixed(2);
}

export function mapPaymentMethodToZatcaCode(paymentMethod: string): '10' | '30' | '42' | '48' | '1' {
  const upper = (paymentMethod || '').toUpperCase();
  if (upper.includes('CARD') || upper.includes('MADA') || upper.includes('VISA')) return '48';
  if (upper.includes('BANK') || upper.includes('TRANSFER')) return '42';
  if (upper.includes('CREDIT')) return '30';
  if (upper.includes('CASH')) return '10';
  return '10';
}

export function validateB2BBuyerAddress(buyer: ZatcaPartyAddress | undefined): string[] {
  const errors: string[] = [];
  if (!buyer) return ['B2B buyer details are required.'];
  if (!buyer.name?.trim()) errors.push('Buyer name is required.');
  if (!buyer.vatNumber || !/^\d{15}$/.test(buyer.vatNumber.trim())) {
    errors.push('Buyer VAT number must be 15 digits.');
  }
  if (!buyer.streetName?.trim()) errors.push('Buyer street name is required for B2B e-invoicing.');
  if (!buyer.buildingNumber || !/^\d{4}$/.test(buyer.buildingNumber.trim())) {
    errors.push('Buyer building number (4 digits) is required for B2B e-invoicing.');
  }
  if (!buyer.district?.trim()) errors.push('Buyer district is required for B2B e-invoicing.');
  if (!buyer.city?.trim()) errors.push('Buyer city is required for B2B e-invoicing.');
  if (!buyer.postalCode || !/^\d{5}$/.test(buyer.postalCode.trim())) {
    errors.push('Buyer postal code (5 digits) is required for B2B e-invoicing.');
  }
  return errors;
}

function resolveTaxCategory(line: ZatcaInvoiceLineInput): 'S' | 'Z' | 'E' | 'O' {
  if (line.taxCategoryCode) return line.taxCategoryCode;
  return line.taxRate > 0 ? 'S' : 'Z';
}

function buildInvoiceBodyXml(
  input: ZatcaInvoiceBuildInput,
  extensionsBlock: string,
  qrBlock: string,
  signatureBlock: string
): { xml: string; totalWithVat: number; vatTotal: number } {
  const currency = input.currencyCode || 'SAR';
  const isB2B = input.invoiceSubType === '0100000';
  const isNote = input.invoiceTypeCode === '381' || input.invoiceTypeCode === '383';

  const computedLines = input.lines.map((line, index) => {
    const qty = Number(line.quantity || 1);
    const unitPrice = round2(line.unitPriceExclTax);
    const lineDiscount = round2(Math.max(0, line.lineDiscount || 0));
    const lineExtension = round2(Math.max(0, unitPrice * qty - lineDiscount));
    const taxRate = round2(Math.max(0, line.taxRate || 0));
    const taxCategory = resolveTaxCategory(line);
    const taxAmount = round2((lineExtension * taxRate) / 100);
    const roundingAmount = round2(lineExtension + taxAmount);
    return {
      id: String(line.id || index + 1),
      name: line.name.trim() || `Item ${index + 1}`,
      qty,
      unitPrice,
      lineDiscount,
      lineExtension,
      taxRate,
      taxCategory,
      taxAmount,
      roundingAmount,
    };
  });

  const lineExtensionSum = round2(computedLines.reduce((sum, l) => sum + l.lineExtension, 0));
  const docDiscount = round2(Math.max(0, input.documentDiscount || 0));
  const taxExclusiveAmount = round2(Math.max(0, lineExtensionSum - docDiscount));

  // Group tax subtotals by category + rate
  const taxGroups = new Map<string, { category: 'S' | 'Z' | 'E' | 'O'; rate: number; taxable: number; tax: number }>();
  for (const line of computedLines) {
    const key = `${line.taxCategory}:${line.taxRate}`;
    const existing = taxGroups.get(key) || {
      category: line.taxCategory,
      rate: line.taxRate,
      taxable: 0,
      tax: 0,
    };
    existing.taxable = round2(existing.taxable + line.lineExtension);
    existing.tax = round2(existing.tax + line.taxAmount);
    taxGroups.set(key, existing);
  }

  // Apply document-level discount proportionally to the first/dominant tax group
  if (docDiscount > 0 && taxGroups.size > 0) {
    const primary = [...taxGroups.values()][0];
    primary.taxable = round2(Math.max(0, primary.taxable - docDiscount));
    primary.tax = round2((primary.taxable * primary.rate) / 100);
  }

  const vatTotal = round2([...taxGroups.values()].reduce((sum, g) => sum + g.tax, 0));
  const totalWithVat = round2(taxExclusiveAmount + vatTotal);

  const billingReferenceXml = isNote && input.billingReferenceId
    ? `
    <cac:BillingReference>
        <cac:InvoiceDocumentReference>
            <cbc:ID>${escapeXml(input.billingReferenceId)}</cbc:ID>
        </cac:InvoiceDocumentReference>
    </cac:BillingReference>`
    : '';

  const sellerCrXml = input.seller.crNumber?.trim()
    ? `
            <cac:PartyIdentification>
                <cbc:ID schemeID="CRN">${escapeXml(input.seller.crNumber.trim())}</cbc:ID>
            </cac:PartyIdentification>`
    : '';

  const buyerXml = isB2B && input.buyer
    ? `
    <cac:AccountingCustomerParty>
        <cac:Party>
            <cac:PostalAddress>
                <cbc:StreetName>${escapeXml(input.buyer.streetName || 'Main Street')}</cbc:StreetName>
                <cbc:BuildingNumber>${escapeXml(input.buyer.buildingNumber || '1234')}</cbc:BuildingNumber>
                <cbc:CitySubdivisionName>${escapeXml(input.buyer.district || 'Central')}</cbc:CitySubdivisionName>
                <cbc:CityName>${escapeXml(input.buyer.city || 'Riyadh')}</cbc:CityName>
                <cbc:PostalZone>${escapeXml(input.buyer.postalCode || '12345')}</cbc:PostalZone>
                <cac:Country>
                    <cbc:IdentificationCode>${escapeXml(input.buyer.countryCode || 'SA')}</cbc:IdentificationCode>
                </cac:Country>
            </cac:PostalAddress>
            <cac:PartyTaxScheme>
                <cbc:CompanyID>${escapeXml(input.buyer.vatNumber || '')}</cbc:CompanyID>
                <cac:TaxScheme>
                    <cbc:ID>VAT</cbc:ID>
                </cac:TaxScheme>
            </cac:PartyTaxScheme>
            <cac:PartyLegalEntity>
                <cbc:RegistrationName>${escapeXml(input.buyer.name)}</cbc:RegistrationName>
            </cac:PartyLegalEntity>
        </cac:Party>
    </cac:AccountingCustomerParty>`
    : `
    <cac:AccountingCustomerParty>
        <cac:Party>
            <cac:PartyLegalEntity>
                <cbc:RegistrationName>${escapeXml(input.buyer?.name || 'Walk-in Customer')}</cbc:RegistrationName>
            </cac:PartyLegalEntity>
        </cac:Party>
    </cac:AccountingCustomerParty>`;

  const deliveryXml = isB2B
    ? `
    <cac:Delivery>
        <cbc:ActualDeliveryDate>${escapeXml(input.issueDate)}</cbc:ActualDeliveryDate>
    </cac:Delivery>`
    : '';

  const paymentMeansXml = `
    <cac:PaymentMeans>
        <cbc:PaymentMeansCode>${input.paymentMeansCode || '10'}</cbc:PaymentMeansCode>${
          isNote
            ? `\n        <cbc:InstructionNote>${escapeXml(input.instructionNote || 'Invoice adjustment / return')}</cbc:InstructionNote>`
            : ''
        }
    </cac:PaymentMeans>`;

  const docAllowanceXml = docDiscount > 0
    ? `
    <cac:AllowanceCharge>
        <cbc:ChargeIndicator>false</cbc:ChargeIndicator>
        <cbc:AllowanceChargeReason>discount</cbc:AllowanceChargeReason>
        <cbc:Amount currencyID="${currency}">${fmt2(docDiscount)}</cbc:Amount>
        <cac:TaxCategory>
            <cbc:ID schemeAgencyID="6" schemeID="UN/ECE 5305">S</cbc:ID>
            <cbc:Percent>15.00</cbc:Percent>
            <cac:TaxScheme>
                <cbc:ID schemeAgencyID="6" schemeID="UN/ECE 5153">VAT</cbc:ID>
            </cac:TaxScheme>
        </cac:TaxCategory>
    </cac:AllowanceCharge>`
    : '';

  const taxSubtotalsXml = [...taxGroups.values()]
    .map((g) => {
      const exemptionXml = g.category === 'Z'
        ? `\n                <cbc:TaxExemptionReasonCode>VATEX-SA-32</cbc:TaxExemptionReasonCode>\n                <cbc:TaxExemptionReason>Zero rated supply</cbc:TaxExemptionReason>`
        : g.category === 'E'
          ? `\n                <cbc:TaxExemptionReasonCode>VATEX-SA-29</cbc:TaxExemptionReasonCode>\n                <cbc:TaxExemptionReason>Exempt supply</cbc:TaxExemptionReason>`
          : g.category === 'O'
            ? `\n                <cbc:TaxExemptionReasonCode>VATEX-SA-OOS</cbc:TaxExemptionReasonCode>\n                <cbc:TaxExemptionReason>Out of scope</cbc:TaxExemptionReason>`
            : '';
      return `
        <cac:TaxSubtotal>
            <cbc:TaxableAmount currencyID="${currency}">${fmt2(g.taxable)}</cbc:TaxableAmount>
            <cbc:TaxAmount currencyID="${currency}">${fmt2(g.tax)}</cbc:TaxAmount>
            <cac:TaxCategory>
                <cbc:ID schemeAgencyID="6" schemeID="UN/ECE 5305">${g.category}</cbc:ID>
                <cbc:Percent>${fmt2(g.rate)}</cbc:Percent>${exemptionXml}
                <cac:TaxScheme>
                    <cbc:ID schemeAgencyID="6" schemeID="UN/ECE 5153">VAT</cbc:ID>
                </cac:TaxScheme>
            </cac:TaxCategory>
        </cac:TaxSubtotal>`;
    })
    .join('');

  const linesXml = computedLines
    .map((line) => {
      const lineAllowanceXml = line.lineDiscount > 0
        ? `
        <cac:AllowanceCharge>
            <cbc:ChargeIndicator>false</cbc:ChargeIndicator>
            <cbc:AllowanceChargeReason>discount</cbc:AllowanceChargeReason>
            <cbc:Amount currencyID="${currency}">${fmt2(line.lineDiscount)}</cbc:Amount>
        </cac:AllowanceCharge>`
        : '';
      return `
    <cac:InvoiceLine>
        <cbc:ID>${escapeXml(line.id)}</cbc:ID>
        <cbc:InvoicedQuantity unitCode="PCE">${line.qty}</cbc:InvoicedQuantity>
        <cbc:LineExtensionAmount currencyID="${currency}">${fmt2(line.lineExtension)}</cbc:LineExtensionAmount>${lineAllowanceXml}
        <cac:TaxTotal>
            <cbc:TaxAmount currencyID="${currency}">${fmt2(line.taxAmount)}</cbc:TaxAmount>
            <cbc:RoundingAmount currencyID="${currency}">${fmt2(line.roundingAmount)}</cbc:RoundingAmount>
        </cac:TaxTotal>
        <cac:Item>
            <cbc:Name>${escapeXml(line.name)}</cbc:Name>
            <cac:ClassifiedTaxCategory>
                <cbc:ID>${line.taxCategory}</cbc:ID>
                <cbc:Percent>${fmt2(line.taxRate)}</cbc:Percent>
                <cac:TaxScheme>
                    <cbc:ID>VAT</cbc:ID>
                </cac:TaxScheme>
            </cac:ClassifiedTaxCategory>
        </cac:Item>
        <cac:Price>
            <cbc:PriceAmount currencyID="${currency}">${fmt2(line.unitPrice)}</cbc:PriceAmount>
        </cac:Price>
    </cac:InvoiceLine>`;
    })
    .join('');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2">${extensionsBlock}<cbc:ProfileID>reporting:1.0</cbc:ProfileID>
    <cbc:ID>${escapeXml(input.invoiceNumber)}</cbc:ID>
    <cbc:UUID>${escapeXml(input.uuid)}</cbc:UUID>
    <cbc:IssueDate>${escapeXml(input.issueDate)}</cbc:IssueDate>
    <cbc:IssueTime>${escapeXml(input.issueTime)}</cbc:IssueTime>
    <cbc:InvoiceTypeCode name="${input.invoiceSubType}">${input.invoiceTypeCode}</cbc:InvoiceTypeCode>
    <cbc:DocumentCurrencyCode>${currency}</cbc:DocumentCurrencyCode>
    <cbc:TaxCurrencyCode>${currency}</cbc:TaxCurrencyCode>${billingReferenceXml}
    <cac:AdditionalDocumentReference>
        <cbc:ID>ICV</cbc:ID>
        <cbc:UUID>${input.icv}</cbc:UUID>
    </cac:AdditionalDocumentReference>
    <cac:AdditionalDocumentReference>
        <cbc:ID>PIH</cbc:ID>
        <cac:Attachment>
            <cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${escapeXml(input.pih)}</cbc:EmbeddedDocumentBinaryObject>
        </cac:Attachment>
    </cac:AdditionalDocumentReference>${qrBlock}${signatureBlock}
    <cac:AccountingSupplierParty>
        <cac:Party>${sellerCrXml}
            <cac:PostalAddress>
                <cbc:StreetName>${escapeXml(input.seller.streetName || 'Main Street')}</cbc:StreetName>
                <cbc:BuildingNumber>${escapeXml(input.seller.buildingNumber || '1234')}</cbc:BuildingNumber>
                <cbc:CitySubdivisionName>${escapeXml(input.seller.district || 'Central')}</cbc:CitySubdivisionName>
                <cbc:CityName>${escapeXml(input.seller.city || 'Riyadh')}</cbc:CityName>
                <cbc:PostalZone>${escapeXml(input.seller.postalCode || '12345')}</cbc:PostalZone>
                <cac:Country>
                    <cbc:IdentificationCode>${escapeXml(input.seller.countryCode || 'SA')}</cbc:IdentificationCode>
                </cac:Country>
            </cac:PostalAddress>
            <cac:PartyTaxScheme>
                <cbc:CompanyID>${escapeXml(input.seller.vatNumber || '')}</cbc:CompanyID>
                <cac:TaxScheme>
                    <cbc:ID>VAT</cbc:ID>
                </cac:TaxScheme>
            </cac:PartyTaxScheme>
            <cac:PartyLegalEntity>
                <cbc:RegistrationName>${escapeXml(input.seller.name)}</cbc:RegistrationName>
            </cac:PartyLegalEntity>
        </cac:Party>
    </cac:AccountingSupplierParty>${buyerXml}${deliveryXml}${paymentMeansXml}${docAllowanceXml}
    <cac:TaxTotal>
        <cbc:TaxAmount currencyID="${currency}">${fmt2(vatTotal)}</cbc:TaxAmount>
    </cac:TaxTotal>
    <cac:TaxTotal>
        <cbc:TaxAmount currencyID="${currency}">${fmt2(vatTotal)}</cbc:TaxAmount>${taxSubtotalsXml}
    </cac:TaxTotal>
    <cac:LegalMonetaryTotal>
        <cbc:LineExtensionAmount currencyID="${currency}">${fmt2(lineExtensionSum)}</cbc:LineExtensionAmount>
        <cbc:TaxExclusiveAmount currencyID="${currency}">${fmt2(taxExclusiveAmount)}</cbc:TaxExclusiveAmount>
        <cbc:TaxInclusiveAmount currencyID="${currency}">${fmt2(totalWithVat)}</cbc:TaxInclusiveAmount>
        <cbc:AllowanceTotalAmount currencyID="${currency}">${fmt2(docDiscount)}</cbc:AllowanceTotalAmount>
        <cbc:PrepaidAmount currencyID="${currency}">0.00</cbc:PrepaidAmount>
        <cbc:PayableAmount currencyID="${currency}">${fmt2(totalWithVat)}</cbc:PayableAmount>
    </cac:LegalMonetaryTotal>${linesXml}
</Invoice>`;

  return { xml, totalWithVat, vatTotal };
}

export function buildAndSignZatcaInvoice(
  input: ZatcaInvoiceBuildInput,
  privateKeyPem: string,
  csidBase64: string
): SignedZatcaInvoiceResult {
  // 1. Build unsigned canonicalizable XML (without UBLExtensions, QR, Signature)
  const { xml: xmlUnsigned, totalWithVat, vatTotal } = buildInvoiceBodyXml(input, '', '', '');

  // Strip XML declaration and normalize line endings to LF for C14N 1.1 hashing
  const canonicalInvoice = xmlUnsigned
    .replace(/\r\n/g, '\n')
    .replace(/^<\?xml[^?]*\?>\n?/, '')
    .trim();
  const invoiceHash = createHash('sha256').update(canonicalInvoice, 'utf8').digest('base64');

  // 2. Parse certificate & sign invoice hash
  const cert = parseZatcaCertificate(csidBase64);
  const signatureBase64 = signHashWithPrivateKey(invoiceHash, privateKeyPem);

  // 3. Build XAdES-BES SignedProperties
  const signingTime = `${input.issueDate}T${input.issueTime}`;
  const signedPropertiesXml = `<xades:SignedProperties xmlns:xades="http://uri.etsi.org/01903/v1.3.2#" Id="xadesSignedProperties"><xades:SignedSignatureProperties><xades:SigningTime>${signingTime}</xades:SigningTime><xades:SigningCertificate><xades:Cert><xades:CertDigest><ds:DigestMethod xmlns:ds="http://www.w3.org/2000/09/xmldsig#" Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/><ds:DigestValue xmlns:ds="http://www.w3.org/2000/09/xmldsig#">${cert.sha256Base64}</ds:DigestValue></xades:CertDigest><xades:IssuerSerial><ds:X509IssuerName xmlns:ds="http://www.w3.org/2000/09/xmldsig#">${escapeXml(cert.issuer)}</ds:X509IssuerName><ds:X509SerialNumber xmlns:ds="http://www.w3.org/2000/09/xmldsig#">${cert.serialNumberDecimal}</ds:X509SerialNumber></xades:IssuerSerial></xades:Cert></xades:SigningCertificate></xades:SignedSignatureProperties></xades:SignedProperties>`;
  const signedPropsHexHash = createHash('sha256').update(signedPropertiesXml, 'utf8').digest('hex');
  const signedPropsDigest = Buffer.from(signedPropsHexHash, 'utf8').toString('base64');

  // 4. Generate Phase 2 QR Code (Tags 1–9) — Tag 3 matches IssueDate + 'T' + IssueTime
  const qrPhase2 = generatePhase2QrBase64({
    sellerName: input.seller.name,
    vatNumber: input.seller.vatNumber || '',
    timestamp: `${input.issueDate}T${input.issueTime}`,
    totalWithVat: fmt2(totalWithVat),
    vatTotal: fmt2(vatTotal),
    invoiceHashBase64: invoiceHash,
    ecdsaSignatureBase64: signatureBase64,
    publicKeyDer: cert.publicKeyDer,
    certificateSignatureBytes:
      input.invoiceSubType === '0200000' ? cert.signatureBytes : undefined,
  });

  const extensionsBlock = `<ext:UBLExtensions><ext:UBLExtension><ext:ExtensionURI>urn:oasis:names:specification:ubl:dsig:enveloped:xades</ext:ExtensionURI><ext:ExtensionContent><sig:UBLDocumentSignatures xmlns:sig="urn:oasis:names:specification:ubl:schema:xsd:CommonSignatureComponents-2" xmlns:sac="urn:oasis:names:specification:ubl:schema:xsd:SignatureAggregateComponents-2" xmlns:sbc="urn:oasis:names:specification:ubl:schema:xsd:SignatureBasicComponents-2"><sac:SignatureInformation><cbc:ID>urn:oasis:names:specification:ubl:signature:1</cbc:ID><sbc:ReferencedSignatureID>urn:oasis:names:specification:ubl:signature:Invoice</sbc:ReferencedSignatureID><ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#" Id="signature"><ds:SignedInfo><ds:CanonicalizationMethod Algorithm="http://www.w3.org/2006/12/xml-c14n11"/><ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256"/><ds:Reference Id="invoiceSignedData" URI=""><ds:Transforms><ds:Transform Algorithm="http://www.w3.org/TR/1999/REC-xpath-19991116"><ds:XPath>not(//ancestor-or-self::ext:UBLExtensions)</ds:XPath></ds:Transform><ds:Transform Algorithm="http://www.w3.org/TR/1999/REC-xpath-19991116"><ds:XPath>not(//ancestor-or-self::cac:Signature)</ds:XPath></ds:Transform><ds:Transform Algorithm="http://www.w3.org/TR/1999/REC-xpath-19991116"><ds:XPath>not(//ancestor-or-self::cac:AdditionalDocumentReference[cbc:ID='QR'])</ds:XPath></ds:Transform><ds:Transform Algorithm="http://www.w3.org/2006/12/xml-c14n11"/></ds:Transforms><ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/><ds:DigestValue>${invoiceHash}</ds:DigestValue></ds:Reference><ds:Reference Type="http://www.w3.org/2000/09/xmldsig#SignatureProperties" URI="#xadesSignedProperties"><ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/><ds:DigestValue>${signedPropsDigest}</ds:DigestValue></ds:Reference></ds:SignedInfo><ds:SignatureValue>${signatureBase64}</ds:SignatureValue><ds:KeyInfo><ds:X509Data><ds:X509Certificate>${cert.base64Der}</ds:X509Certificate></ds:X509Data></ds:KeyInfo><ds:Object><xades:QualifyingProperties xmlns:xades="http://uri.etsi.org/01903/v1.3.2#" Target="signature">${signedPropertiesXml}</xades:QualifyingProperties></ds:Object></ds:Signature></sac:SignatureInformation></sig:UBLDocumentSignatures></ext:ExtensionContent></ext:UBLExtension></ext:UBLExtensions>`;

  const qrBlock = `<cac:AdditionalDocumentReference><cbc:ID>QR</cbc:ID><cac:Attachment><cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${qrPhase2}</cbc:EmbeddedDocumentBinaryObject></cac:Attachment></cac:AdditionalDocumentReference>`;

  const signatureBlock = `<cac:Signature><cbc:ID>urn:oasis:names:specification:ubl:signature:Invoice</cbc:ID><cbc:SignatureMethod>urn:oasis:names:specification:ubl:dsig:enveloped:xades</cbc:SignatureMethod></cac:Signature>`;

  const { xml: xmlSigned } = buildInvoiceBodyXml(input, extensionsBlock, qrBlock, signatureBlock);

  return {
    xmlUnsigned,
    xmlSigned,
    invoiceHash,
    signatureBase64,
    qrPhase2,
    totalWithVat,
    vatTotal,
  };
}
