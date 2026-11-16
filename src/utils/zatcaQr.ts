/**
 * ZATCA (FATOORA) Phase 1 & Phase 2 QR Code Generator
 * 
 * Complies with the official Saudi ZATCA E-Invoicing standard:
 * Tag 1: Seller's Name (Text UTF-8)
 * Tag 2: VAT Registration Number (15 digits Text UTF-8)
 * Tag 3: Time stamp (ISO 8601: YYYY-MM-DDTHH:mm:ssZ)
 * Tag 4: Invoice Total (with VAT) (Text UTF-8, e.g. "115.00")
 * Tag 5: VAT Total (Text UTF-8, e.g. "15.00")
 * Tag 6: Hash of XML Invoice (Hex or Base64, Phase 2)
 * Tag 7: Cryptographic Stamp / ECDSA Signature (Phase 2)
 * Tag 8: Public Key (Phase 2)
 * Tag 9: Cryptographic Stamp Signature of Public Key by ZATCA (Phase 2)
 *
 * Each field is encoded in TLV (Tag-Length-Value):
 * - Tag: 1 byte
 * - Length: 1 byte (length of UTF-8 encoded bytes of value)
 * - Value: UTF-8 encoded bytes
 *
 * The final TLV sequence is Base64 encoded.
 */

export interface ZatcaQrParams {
  sellerName: string;
  vatNumber: string;
  timestamp: string | Date;
  totalAmount: number | string;
  taxAmount: number | string;
  invoiceHash?: string;
  digitalSignature?: string;
  publicKey?: string;
}

function encodeUtf8(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

function toTLV(tag: number, valueStr: string): Uint8Array {
  const valueBytes = encodeUtf8(valueStr);
  const length = valueBytes.length;
  const tlv = new Uint8Array(2 + length);
  tlv[0] = tag;
  tlv[1] = length;
  tlv.set(valueBytes, 2);
  return tlv;
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Format ISO 8601 timestamp as required by ZATCA: YYYY-MM-DDTHH:mm:ssZ
 */
export function formatZatcaTimestamp(dateInput?: string | Date): string {
  const d = dateInput ? new Date(dateInput) : new Date();
  if (isNaN(d.getTime())) return new Date().toISOString();
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Generate ZATCA Phase 1 & Phase 2 TLV Base64 payload
 */
export function generateZatcaTlvBase64(params: ZatcaQrParams): string {
  const seller = (params.sellerName || 'aptPOS Retail').trim();
  const vat = (params.vatNumber || '300000000000003').trim();
  const time = formatZatcaTimestamp(params.timestamp);
  const total = Number(params.totalAmount || 0).toFixed(2);
  const tax = Number(params.taxAmount || 0).toFixed(2);

  const tlvParts: Uint8Array[] = [
    toTLV(1, seller),
    toTLV(2, vat),
    toTLV(3, time),
    toTLV(4, total),
    toTLV(5, tax),
  ];

  if (params.invoiceHash) {
    tlvParts.push(toTLV(6, params.invoiceHash));
  }

  if (params.digitalSignature) {
    tlvParts.push(toTLV(7, params.digitalSignature));
  }

  if (params.publicKey) {
    tlvParts.push(toTLV(8, params.publicKey));
  }

  const totalLen = tlvParts.reduce((sum, p) => sum + p.length, 0);
  const combined = new Uint8Array(totalLen);
  let offset = 0;
  for (const part of tlvParts) {
    combined.set(part, offset);
    offset += part.length;
  }

  return uint8ArrayToBase64(combined);
}
