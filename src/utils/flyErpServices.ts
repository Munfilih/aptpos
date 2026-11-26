const FLY_ERP_SERVICE_CATEGORIES = new Set([
  'service',
  'services',
  'travel service',
  'travel services',
  'خدمة',
  'خدمات',
  'خدمة سفر',
  'خدمات السفر',
]);

export type FlyErpServiceDetailKey =
  | 'passenger'
  | 'passport'
  | 'pnr'
  | 'flight'
  | 'origin'
  | 'destination'
  | 'tripType'
  | 'travelDate'
  | 'returnFlight'
  | 'returnDate';

interface ServiceDetailLabel {
  key: FlyErpServiceDetailKey;
  english: string;
  arabic: string;
}

const SERVICE_DETAIL_LABELS: Record<string, ServiceDetailLabel> = {
  passenger: { key: 'passenger', english: 'Passenger', arabic: 'المسافر' },
  'passport / id': { key: 'passport', english: 'Passport / ID', arabic: 'رقم الجواز / الهوية' },
  'booking reference (pnr)': { key: 'pnr', english: 'Booking reference (PNR)', arabic: 'مرجع الحجز (PNR)' },
  flight: { key: 'flight', english: 'Flight', arabic: 'رقم الرحلة' },
  from: { key: 'origin', english: 'From', arabic: 'من' },
  to: { key: 'destination', english: 'To', arabic: 'إلى' },
  'trip type': { key: 'tripType', english: 'Trip type', arabic: 'نوع الرحلة' },
  'departure date': { key: 'travelDate', english: 'Travel Date', arabic: 'تاريخ السفر' },
  'return flight': { key: 'returnFlight', english: 'Return Flight', arabic: 'رحلة العودة' },
  'return date': { key: 'returnDate', english: 'Return Date', arabic: 'تاريخ العودة' },
};

const SERVICE_DETAIL_LABELS_BY_ARABIC = Object.values(SERVICE_DETAIL_LABELS)
  .reduce<Record<string, ServiceDetailLabel>>((labels, detailLabel) => {
    labels[detailLabel.arabic.toLocaleLowerCase()] = detailLabel;
    return labels;
  }, {});

export interface ParsedFlyErpServiceDetails {
  values: Partial<Record<FlyErpServiceDetailKey, string>>;
  notes: string[];
}

export function isFlyErpServiceCategory(category: string): boolean {
  return FLY_ERP_SERVICE_CATEGORIES.has(category.trim().toLocaleLowerCase());
}

export function parseFlyErpServiceDetails(description: string): ParsedFlyErpServiceDetails {
  const parsed: ParsedFlyErpServiceDetails = { values: {}, notes: [] };
  description.split(/\r?\n/).forEach((line) => {
    const separatorIndex = line.indexOf(':');
    if (separatorIndex < 0) {
      if (line.trim()) parsed.notes.push(line.trim());
      return;
    }

    const label = line.slice(0, separatorIndex).trim().toLocaleLowerCase();
    const bilingualLabel = SERVICE_DETAIL_LABELS[label] || SERVICE_DETAIL_LABELS_BY_ARABIC[label];
    if (!bilingualLabel) {
      parsed.notes.push(line.trim());
      return;
    }

    const value = line.slice(separatorIndex + 1).trim();
    if (value) parsed.values[bilingualLabel.key] = value;
  });
  return parsed;
}

export function formatFlyErpServiceDetailValue(key: FlyErpServiceDetailKey, value: string): string {
  if (key !== 'tripType') return value;
  const tripTypeTranslations: Record<string, string> = {
    'one way': 'One way / اتجاه واحد',
    'اتجاه واحد': 'One way / اتجاه واحد',
    'round trip': 'Round trip / ذهاب وعودة',
    'ذهاب وعودة': 'Round trip / ذهاب وعودة',
  };
  return tripTypeTranslations[value.toLocaleLowerCase()] || value;
}

export function formatFlyErpServiceDetails(description: string): string {
  return description.split(/\r?\n/).map((line) => {
    const separatorIndex = line.indexOf(':');
    if (separatorIndex < 0) return line;

    const label = line.slice(0, separatorIndex).trim().toLocaleLowerCase();
    const bilingualLabel = SERVICE_DETAIL_LABELS[label] || SERVICE_DETAIL_LABELS_BY_ARABIC[label];
    if (!bilingualLabel) return line;

    const value = formatFlyErpServiceDetailValue(
      bilingualLabel.key,
      line.slice(separatorIndex + 1).trim()
    );
    return `${bilingualLabel.english} / ${bilingualLabel.arabic}: ${value}`;
  }).join('\n');
}
