'use client';

export interface SelectOption { value: string; label: string }

export default function SelectField({ id, ariaLabel, value, options, onChange }: { id?: string; ariaLabel?: string; value: string; options: SelectOption[]; onChange: (value: string) => void }) {
  return <div className="custom-select"><select className="select-trigger" id={id} aria-label={ariaLabel} value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>;
}
