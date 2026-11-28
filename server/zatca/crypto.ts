import {
  X509Certificate,
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  createSign,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
} from 'node:crypto';
import os from 'node:os';

export type ZatcaEnvironment = 'sandbox' | 'simulation' | 'production';

export const ZATCA_GENESIS_PIH =
  'NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==';

function localEncryptionKey(): Buffer {
  const seed = [
    process.env.ZATCA_KEY_SECRET || 'aptpos-zatca-local-key-v1',
    os.hostname(),
    process.platform,
    process.arch,
  ].join('|');
  return createHash('sha256').update(seed).digest();
}

export function encryptZatcaSecret(plainText: string): string {
  if (!plainText) return '';
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', localEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  return JSON.stringify({
    v: 1,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: encrypted.toString('base64'),
  });
}

export function decryptZatcaSecret(cipherJson: string): string {
  if (!cipherJson) return '';
  try {
    const parsed = JSON.parse(cipherJson) as {
      v?: number;
      iv?: string;
      tag?: string;
      data?: string;
    };
    if (parsed.v !== 1 || !parsed.iv || !parsed.tag || !parsed.data) return '';
    const decipher = createDecipheriv(
      'aes-256-gcm',
      localEncryptionKey(),
      Buffer.from(parsed.iv, 'base64')
    );
    decipher.setAuthTag(Buffer.from(parsed.tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(parsed.data, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return '';
  }
}

export function generateEgsUuid(): string {
  return randomUUID();
}

export function generateSecp256k1KeyPair(): { privateKeyPem: string; publicKeyPem: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ec', {
    namedCurve: 'secp256k1',
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'sec1', format: 'pem' },
  });
  return { privateKeyPem: privateKey, publicKeyPem: publicKey };
}

// --- Minimal DER / ASN.1 encoder for ZATCA PKCS#10 CSR ---

function derLength(length: number): Buffer {
  if (length < 0x80) return Buffer.from([length]);
  const bytes: number[] = [];
  let remaining = length;
  while (remaining > 0) {
    bytes.unshift(remaining & 0xff);
    remaining >>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function derTag(tag: number, content: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), derLength(content.length), content]);
}

function derSequence(items: Buffer[]): Buffer {
  return derTag(0x30, Buffer.concat(items));
}

function derSet(items: Buffer[]): Buffer {
  return derTag(0x31, Buffer.concat(items));
}

function derOid(oid: string): Buffer {
  const parts = oid.split('.').map(Number);
  const bytes: number[] = [parts[0] * 40 + parts[1]];
  for (let i = 2; i < parts.length; i += 1) {
    let val = parts[i];
    const encoded: number[] = [val & 0x7f];
    val >>= 7;
    while (val > 0) {
      encoded.unshift((val & 0x7f) | 0x80);
      val >>= 7;
    }
    bytes.push(...encoded);
  }
  return derTag(0x06, Buffer.from(bytes));
}

function derUtf8String(value: string): Buffer {
  return derTag(0x0c, Buffer.from(value, 'utf8'));
}

function derPrintableString(value: string): Buffer {
  return derTag(0x13, Buffer.from(value, 'ascii'));
}

function derOctetString(value: Buffer): Buffer {
  return derTag(0x04, value);
}

function derBitString(value: Buffer): Buffer {
  return derTag(0x03, Buffer.concat([Buffer.from([0x00]), value]));
}

function derIntegerZero(): Buffer {
  return Buffer.from([0x02, 0x01, 0x00]);
}

function derAttributeTypeAndValue(oid: string, value: Buffer): Buffer {
  return derSet([derSequence([derOid(oid), value])]);
}

export interface ZatcaCsrInput {
  egsUuid: string;
  commonName: string;
  organizationName: string;
  organizationUnitName: string;
  vatNumber: string;
  registeredAddress: string;
  businessCategory: string;
  invoiceType?: '1100' | '1000' | '0100';
  environment: ZatcaEnvironment;
}

export function buildZatcaCsrBase64(
  privateKeyPem: string,
  publicKeyPem: string,
  input: ZatcaCsrInput
): string {
  const serialNumber = `1-aptPOS|2-1.0|3-${input.egsUuid}`;
  const invoiceType = input.invoiceType || '1100';
  const templateName =
    input.environment === 'production'
      ? 'ZATCA-Code-Signing'
      : input.environment === 'simulation'
        ? 'PREZATCA-Code-Signing'
        : 'TSTZATCA-Code-Signing';

  // Subject DN: C=SA, OU=..., O=..., CN=...
  const subject = derSequence([
    derAttributeTypeAndValue('2.5.4.6', derPrintableString('SA')),
    derAttributeTypeAndValue('2.5.4.11', derUtf8String(input.organizationUnitName || 'Main Branch')),
    derAttributeTypeAndValue('2.5.4.10', derUtf8String(input.organizationName)),
    derAttributeTypeAndValue('2.5.4.3', derUtf8String(input.commonName)),
  ]);

  // SubjectPublicKeyInfo DER from Node crypto
  const spkiDer = createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' }) as Buffer;

  // Extension 1: Certificate Template Name (1.3.6.1.4.1.311.20.2)
  const templateExt = derSequence([
    derOid('1.3.6.1.4.1.311.20.2'),
    derOctetString(derPrintableString(templateName)),
  ]);

  // Extension 2: Subject Alternative Name (2.5.29.17) -> directoryName [4]
  const dirName = derSequence([
    derAttributeTypeAndValue('2.5.4.4', derUtf8String(serialNumber)),
    derAttributeTypeAndValue('0.9.2342.19200300.100.1.1', derUtf8String(input.vatNumber)),
    derAttributeTypeAndValue('2.5.4.12', derUtf8String(invoiceType)),
    derAttributeTypeAndValue('2.5.4.26', derUtf8String(input.registeredAddress || 'Riyadh')),
    derAttributeTypeAndValue('2.5.4.15', derUtf8String(input.businessCategory || 'Retail')),
  ]);
  const sanValue = derSequence([derTag(0xa4, dirName)]);
  const sanExt = derSequence([derOid('2.5.29.17'), derOctetString(sanValue)]);

  // extensionRequest attribute (1.2.840.113549.1.9.14)
  const extRequestAttr = derSequence([
    derOid('1.2.840.113549.1.9.14'),
    derSet([derSequence([templateExt, sanExt])]),
  ]);

  const attributes = derTag(0xa0, extRequestAttr);

  const certificationRequestInfo = derSequence([
    derIntegerZero(),
    subject,
    spkiDer,
    attributes,
  ]);

  // Sign CertificationRequestInfo with ecdsa-with-SHA256 (1.2.840.10045.4.3.2)
  const signer = createSign('SHA256');
  signer.update(certificationRequestInfo);
  signer.end();
  const signatureDer = signer.sign(createPrivateKey(privateKeyPem));

  const sigAlg = derSequence([derOid('1.2.840.10045.4.3.2')]);
  const csrDer = derSequence([
    certificationRequestInfo,
    sigAlg,
    derBitString(signatureDer),
  ]);

  const pem = [
    '-----BEGIN CERTIFICATE REQUEST-----',
    ...(csrDer.toString('base64').match(/.{1,64}/g) || []),
    '-----END CERTIFICATE REQUEST-----',
  ].join('\n');

  return Buffer.from(pem, 'utf8').toString('base64');
}

export interface ParsedZatcaCertificate {
  pem: string;
  base64Der: string;
  sha256Base64: string;
  issuer: string;
  serialNumberDecimal: string;
  publicKeyDer: Buffer;
  signatureBytes: Buffer;
  validToIso: string | null;
}

function readDerLength(buf: Buffer, offset: number): { length: number; nextOffset: number } {
  const first = buf[offset];
  if (first < 0x80) return { length: first, nextOffset: offset + 1 };
  const numBytes = first & 0x7f;
  let length = 0;
  for (let i = 0; i < numBytes; i += 1) {
    length = (length << 8) | buf[offset + 1 + i];
  }
  return { length, nextOffset: offset + 1 + numBytes };
}

function extractCertSignatureBytes(certDer: Buffer): Buffer {
  try {
    // Certificate ::= SEQUENCE { tbsCertificate, signatureAlgorithm, signatureValue BIT STRING }
    let offset = 0;
    if (certDer[offset] !== 0x30) return Buffer.alloc(0);
    offset = readDerLength(certDer, offset + 1).nextOffset;
    // Skip tbsCertificate
    const tbs = readDerLength(certDer, offset + 1);
    offset = tbs.nextOffset + tbs.length;
    // Skip signatureAlgorithm
    const alg = readDerLength(certDer, offset + 1);
    offset = alg.nextOffset + alg.length;
    // Read signatureValue BIT STRING (0x03)
    if (certDer[offset] !== 0x03) return Buffer.alloc(0);
    const sig = readDerLength(certDer, offset + 1);
    // First byte of BIT STRING is unused bits (0x00)
    return certDer.subarray(sig.nextOffset + 1, sig.nextOffset + sig.length);
  } catch {
    return Buffer.alloc(0);
  }
}

export function parseZatcaCertificate(csidBase64: string): ParsedZatcaCertificate {
  const decoded = Buffer.from(csidBase64, 'base64').toString('utf8').trim();
  const pem = decoded.includes('BEGIN CERTIFICATE')
    ? decoded
    : [
        '-----BEGIN CERTIFICATE-----',
        ...(decoded.replace(/\s+/g, '').match(/.{1,64}/g) || []),
        '-----END CERTIFICATE-----',
      ].join('\n');

  const x509 = new X509Certificate(pem);
  const certDer = x509.raw;
  const base64Der = certDer.toString('base64');
  // ZATCA XAdES cert digest is Base64(Hex(SHA-256(base64Der)))
  const certHexHash = createHash('sha256').update(base64Der, 'utf8').digest('hex');
  const sha256Base64 = Buffer.from(certHexHash, 'utf8').toString('base64');
  const serialHex = x509.serialNumber.replace(/[^a-fA-F0-9]/g, '');
  const serialNumberDecimal = serialHex ? BigInt(`0x${serialHex}`).toString(10) : '0';
  const publicKeyDer = x509.publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
  const signatureBytes = extractCertSignatureBytes(certDer);
  const validToDate = new Date(x509.validTo);
  const validToIso = Number.isFinite(validToDate.getTime()) ? validToDate.toISOString() : null;

  return {
    pem,
    base64Der,
    sha256Base64,
    issuer: x509.issuer.split('\n').reverse().join(', '),
    serialNumberDecimal,
    publicKeyDer,
    signatureBytes,
    validToIso,
  };
}

export function signHashWithPrivateKey(invoiceHashBase64: string, privateKeyPem: string): string {
  const hashBytes = Buffer.from(invoiceHashBase64, 'base64');
  const signer = createSign('SHA256');
  signer.update(hashBytes);
  signer.end();
  return signer.sign(createPrivateKey(privateKeyPem)).toString('base64');
}

function tlvBuffer(tag: number, value: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag, value.length]), value]);
}

export function generatePhase2QrBase64(params: {
  sellerName: string;
  vatNumber: string;
  timestamp: string;
  totalWithVat: string;
  vatTotal: string;
  invoiceHashBase64: string;
  ecdsaSignatureBase64: string;
  publicKeyDer: Buffer;
  certificateSignatureBytes?: Buffer;
}): string {
  const parts: Buffer[] = [
    tlvBuffer(1, Buffer.from(params.sellerName, 'utf8')),
    tlvBuffer(2, Buffer.from(params.vatNumber, 'utf8')),
    tlvBuffer(3, Buffer.from(params.timestamp, 'utf8')),
    tlvBuffer(4, Buffer.from(params.totalWithVat, 'utf8')),
    tlvBuffer(5, Buffer.from(params.vatTotal, 'utf8')),
    tlvBuffer(6, Buffer.from(params.invoiceHashBase64, 'utf8')),
    tlvBuffer(7, Buffer.from(params.ecdsaSignatureBase64, 'utf8')),
    tlvBuffer(8, params.publicKeyDer),
  ];
  if (params.certificateSignatureBytes && params.certificateSignatureBytes.length > 0) {
    parts.push(tlvBuffer(9, params.certificateSignatureBytes));
  }
  return Buffer.concat(parts).toString('base64');
}
