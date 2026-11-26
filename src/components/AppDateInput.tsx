import React, { useEffect, useRef, useState } from 'react';
import { CalendarDays } from 'lucide-react';

type AppDateInputProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'type' | 'value' | 'onChange'
> & {
  value: string;
  onChange?: (value: string) => void;
};

const formatDate = (value: string) => {
  const date = value.slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '';
};

const parseDate = (value: string) => {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (!match) return null;

  const [, dayText, monthText, yearText] = match;
  const day = Number(dayText);
  const month = Number(monthText);
  const year = Number(yearText);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return `${yearText}-${monthText}-${dayText}`;
};

export const AppDateInput = React.forwardRef<HTMLInputElement, AppDateInputProps>(
  function AppDateInput(
    {
      value,
      onChange,
      className = '',
      disabled = false,
      readOnly = false,
      min,
      max,
      placeholder = 'dd/mm/yyyy',
      ...inputProps
    },
    ref
  ) {
    const [displayValue, setDisplayValue] = useState(() => formatDate(value));
    const pickerRef = useRef<HTMLInputElement>(null);
    const parsedDisplayValue = displayValue ? parseDate(displayValue) : '';
    const displayValueIsValid = parsedDisplayValue !== null &&
      (!min || parsedDisplayValue >= min) &&
      (!max || parsedDisplayValue <= max);

    useEffect(() => {
      setDisplayValue(formatDate(value));
    }, [value]);

    const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
      const nextValue = event.target.value;
      const parsedDate = nextValue ? parseDate(nextValue) : '';
      const isInRange = parsedDate !== null &&
        parsedDate !== '' &&
        (!min || parsedDate >= min) &&
        (!max || parsedDate <= max);
      event.currentTarget.setCustomValidity(
        nextValue && !isInRange
          ? 'Enter a valid date in dd/mm/yyyy format.'
          : ''
      );
      setDisplayValue(nextValue);
      if (!nextValue || isInRange) onChange?.(parsedDate || '');
    };

    const handlePickerChange = (event: React.ChangeEvent<HTMLInputElement>) => {
      const nextValue = event.target.value;
      setDisplayValue(formatDate(nextValue));
      onChange?.(nextValue);
    };

    return (
      <div className="relative min-w-0">
        <input
          {...inputProps}
          ref={ref}
          type="text"
          dir="ltr"
          inputMode="text"
          value={displayValue}
          onChange={handleChange}
          disabled={disabled}
          readOnly={readOnly}
          placeholder={placeholder}
          aria-invalid={Boolean(displayValue && !displayValueIsValid)}
          className={`${className} pr-9`}
        />
        <input
          ref={pickerRef}
          type="date"
          value={value.slice(0, 10)}
          min={min}
          max={max}
          disabled={disabled || readOnly}
          tabIndex={-1}
          aria-hidden="true"
          onChange={handlePickerChange}
          className="pointer-events-none absolute left-0 top-0 h-px w-px opacity-0"
        />
        <button
          type="button"
          aria-label="Choose date"
          title="Choose date"
          disabled={disabled || readOnly}
          onClick={() => pickerRef.current?.showPicker()}
          className="absolute inset-y-0 right-2 flex items-center text-slate-500 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <CalendarDays className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    );
  }
);
