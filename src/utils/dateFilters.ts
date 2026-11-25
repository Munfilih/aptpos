export type DateFilter = 'ALL' | 'RANGE' | 'TODAY' | 'YESTERDAY' | 'THIS_WEEK' | 'THIS_MONTH';

export interface DateBounds {
  start: string | null;
  end: string | null;
}

export const toLocalDateKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export function resolveDateBounds(
  filter: DateFilter,
  dateFrom: string,
  dateTo: string,
  today = new Date()
): DateBounds {
  const todayKey = toLocalDateKey(today);

  switch (filter) {
    case 'RANGE':
      return { start: dateFrom || null, end: dateTo || null };
    case 'TODAY':
      return { start: todayKey, end: todayKey };
    case 'YESTERDAY': {
      const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
      const yesterdayKey = toLocalDateKey(yesterday);
      return { start: yesterdayKey, end: yesterdayKey };
    }
    case 'THIS_WEEK': {
      const weekStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6);
      return { start: toLocalDateKey(weekStart), end: toLocalDateKey(weekEnd) };
    }
    case 'THIS_MONTH':
      return {
        start: toLocalDateKey(new Date(today.getFullYear(), today.getMonth(), 1)),
        end: toLocalDateKey(new Date(today.getFullYear(), today.getMonth() + 1, 0)),
      };
    default:
      return { start: null, end: null };
  }
}

export function matchesDateBounds(
  dateString: string,
  bounds: DateBounds
): boolean {
  if (!bounds.start && !bounds.end) return true;
  const dateKey = /^\d{4}-\d{2}-\d{2}$/.test(dateString)
    ? dateString
    : toLocalDateKey(new Date(dateString));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return false;
  return (!bounds.start || dateKey >= bounds.start) && (!bounds.end || dateKey <= bounds.end);
}

export function getInvoiceDateTime(invoiceDate: string | undefined, createdAt: string): Date {
  const date = new Date(createdAt);
  if (!invoiceDate || !/^\d{4}-\d{2}-\d{2}$/.test(invoiceDate)) return date;
  const [year, month, day] = invoiceDate.split('-').map(Number);
  const invoiceDateTime = new Date(
    year,
    month - 1,
    day,
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
    date.getMilliseconds()
  );
  if (
    invoiceDateTime.getFullYear() !== year ||
    invoiceDateTime.getMonth() !== month - 1 ||
    invoiceDateTime.getDate() !== day
  ) {
    return date;
  }
  return invoiceDateTime;
}
