import React, { useEffect } from 'react';
import { X } from 'lucide-react';

/** Small, restrained UI kit: neutral palette, one dark primary, borders instead of shadows. */

type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
const BTN: Record<BtnVariant, string> = {
  primary: 'bg-slate-900 text-white hover:bg-slate-800 border border-slate-900',
  secondary: 'bg-white text-slate-800 hover:bg-slate-50 border border-slate-300',
  ghost: 'bg-transparent text-slate-700 hover:bg-slate-100 border border-transparent',
  danger: 'bg-white text-rose-700 hover:bg-rose-50 border border-rose-300',
};

export const Button: React.FC<
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: 'sm' | 'md' }
> = ({ variant = 'secondary', size = 'md', className = '', ...rest }) => (
  <button
    {...rest}
    className={`inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
      size === 'sm' ? 'px-2.5 py-1.5 text-xs' : 'px-3.5 py-2 text-sm'
    } ${BTN[variant]} ${className}`}
  />
);

const FIELD =
  'rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none focus:ring-0 disabled:bg-slate-50 disabled:text-slate-500';

const width = (c: string) => (/(^|\s)w-/.test(c) ? '' : 'w-full');

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className = '', ...rest }, ref) => <input ref={ref} {...rest} className={`${FIELD} ${width(className)} ${className}`} />
);
Input.displayName = 'Input';

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className = '', ...rest }, ref) => <textarea ref={ref} {...rest} className={`${FIELD} ${width(className)} ${className}`} />
);
Textarea.displayName = 'Textarea';

export const Select: React.FC<React.SelectHTMLAttributes<HTMLSelectElement>> = ({ className = '', ...rest }) => (
  <select {...rest} className={`${FIELD} ${width(className)} ${className}`} />
);

export const Field: React.FC<{
  label: string;
  hint?: string;
  error?: string;
  className?: string;
  children: React.ReactNode;
}> = ({ label, hint, error, className = '', children }) => (
  <label className={`block ${className}`}>
    <span className="mb-1 block text-xs font-medium text-slate-700">{label}</span>
    {children}
    {error ? (
      <span className="mt-1 block text-xs text-rose-700">{error}</span>
    ) : hint ? (
      <span className="mt-1 block text-xs text-slate-500">{hint}</span>
    ) : null}
  </label>
);

export const Card: React.FC<{ className?: string; children: React.ReactNode }> = ({ className = '', children }) => (
  <div className={`rounded-lg border border-slate-200 bg-white ${className}`}>{children}</div>
);

export const SectionTitle: React.FC<{ title: string; sub?: string; right?: React.ReactNode }> = ({
  title,
  sub,
  right,
}) => (
  <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
    <div>
      <h2 className="text-base font-semibold text-slate-900">{title}</h2>
      {sub && <p className="mt-0.5 text-sm text-slate-500">{sub}</p>}
    </div>
    {right}
  </div>
);

/** Status as quiet text with a small dot — no filled pills. */
export const StatusText: React.FC<{
  tone?: 'neutral' | 'ok' | 'warn' | 'bad';
  children: React.ReactNode;
}> = ({ tone = 'neutral', children }) => {
  const dot = { neutral: 'bg-slate-400', ok: 'bg-emerald-600', warn: 'bg-amber-600', bad: 'bg-rose-600' }[tone];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-slate-600">
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {children}
    </span>
  );
};

export const Notice: React.FC<{ tone?: 'info' | 'ok' | 'error'; children: React.ReactNode }> = ({
  tone = 'info',
  children,
}) => (
  <div
    role={tone === 'error' ? 'alert' : 'status'}
    className={`rounded-md border px-3 py-2 text-sm ${
      tone === 'error'
        ? 'border-rose-200 bg-rose-50 text-rose-800'
        : tone === 'ok'
        ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
        : 'border-slate-200 bg-slate-50 text-slate-700'
    }`}
  >
    {children}
  </div>
);

export const Modal: React.FC<{
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: string;
}> = ({ open, title, onClose, children, footer, width = 'max-w-lg' }) => {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div role="dialog" aria-modal="true" aria-label={title} className={`w-full ${width} rounded-lg border border-slate-200 bg-white`}>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
          <button onClick={onClose} aria-label="ปิด" className="rounded p-1 text-slate-500 hover:bg-slate-100 cursor-pointer">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3.5">{footer}</div>}
      </div>
    </div>
  );
};

export const ConfirmDialog: React.FC<{
  open: boolean;
  title: string;
  message: React.ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  error?: string;
  onConfirm: () => void;
  onCancel: () => void;
}> = ({ open, title, message, confirmLabel, danger, busy, error, onConfirm, onCancel }) => (
  <Modal
    open={open}
    title={title}
    onClose={busy ? () => {} : onCancel}
    footer={
      <>
        <Button onClick={onCancel} disabled={busy}>
          ยกเลิก
        </Button>
        <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} disabled={busy}>
          {busy ? 'กำลังดำเนินการ' : confirmLabel}
        </Button>
      </>
    }
  >
    <div className="space-y-3 text-sm text-slate-700">
      <div>{message}</div>
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  </Modal>
);

export const Tabs: React.FC<{
  tabs: { id: string; label: string }[];
  value: string;
  onChange: (id: string) => void;
}> = ({ tabs, value, onChange }) => (
  <div role="tablist" className="flex gap-5 border-b border-slate-200">
    {tabs.map((t) => (
      <button
        key={t.id}
        role="tab"
        aria-selected={value === t.id}
        onClick={() => onChange(t.id)}
        className={`-mb-px border-b-2 pb-2.5 pt-1 text-sm font-medium transition-colors cursor-pointer ${
          value === t.id ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-800'
        }`}
      >
        {t.label}
      </button>
    ))}
  </div>
);
