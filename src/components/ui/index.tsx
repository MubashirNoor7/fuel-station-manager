import { forwardRef, useEffect, useId, useRef } from 'react';
import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TableHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { AlertCircle, CheckCircle2, Info, TriangleAlert } from 'lucide-react';
import '../../styles/design-system.css';

const classes = (...values: (string | undefined)[]) => values.filter(Boolean).join(' ');

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'quiet' | 'danger';
  icon?: ReactNode;
};

// Explicitly pass type="submit" when connecting an existing form submit action.
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', icon, children, className, type = 'button', ...props }, ref,
) {
  return <button {...props} ref={ref} type={type} className={classes('ui-button', `ui-button--${variant}`, className)}>
    {icon && <span className="ui-button__icon" aria-hidden="true">{icon}</span>}
    <span>{children}</span>
  </button>;
});

type FieldDetails = { label: string; help?: string; error?: string; wrapperClassName?: string };
function FieldFrame({ id, label, help, error, wrapperClassName, children }: FieldDetails & { id: string; children: ReactNode }) {
  return <div className={classes('ui-field', wrapperClassName)}>
    <label className="ui-field__label" htmlFor={id}>{label}</label>
    {children}
    {help && <p className="ui-field__help" id={`${id}-help`}>{help}</p>}
    {error && <p className="ui-field__error" id={`${id}-error`} role="alert">Error: {error}</p>}
  </div>;
}
function describedBy(id: string, help?: string, error?: string, existing?: string) {
  return [existing, help ? `${id}-help` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined;
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & FieldDetails>(function Input(
  { label, help, error, wrapperClassName, id: suppliedId, className, ...props }, ref,
) {
  const generatedId = useId();
  const id = suppliedId || generatedId;
  return <FieldFrame {...{ id, label, help, error, wrapperClassName }}>
    <input {...props} id={id} ref={ref} className={classes('ui-input', className)} aria-invalid={error ? true : props['aria-invalid']} aria-describedby={describedBy(id, help, error, props['aria-describedby'])} />
  </FieldFrame>;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & FieldDetails>(function Select(
  { label, help, error, wrapperClassName, id: suppliedId, className, children, ...props }, ref,
) {
  const generatedId = useId();
  const id = suppliedId || generatedId;
  return <FieldFrame {...{ id, label, help, error, wrapperClassName }}>
    <select {...props} id={id} ref={ref} className={classes('ui-select', className)} aria-invalid={error ? true : props['aria-invalid']} aria-describedby={describedBy(id, help, error, props['aria-describedby'])}>{children}</select>
  </FieldFrame>;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & FieldDetails>(function Textarea(
  { label, help, error, wrapperClassName, id: suppliedId, className, ...props }, ref,
) {
  const generatedId = useId();
  const id = suppliedId || generatedId;
  return <FieldFrame {...{ id, label, help, error, wrapperClassName }}>
    <textarea {...props} id={id} ref={ref} className={classes('ui-textarea', className)} aria-invalid={error ? true : props['aria-invalid']} aria-describedby={describedBy(id, help, error, props['aria-describedby'])} />
  </FieldFrame>;
});

export function Card({ heading, children, className, ...props }: HTMLAttributes<HTMLElement> & { heading?: string }) {
  return <section {...props} className={classes('ui-card', className)}>
    {heading && <h2 className="ui-card__heading">{heading}</h2>}{children}
  </section>;
}

export function PageHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return <div className="ui-page-header"><div><h1>{title}</h1>{description && <p>{description}</p>}</div>
    {action && <div className="ui-page-header__action">{action}</div>}
  </div>;
}

export function Alert({ tone = 'info', children }: { tone?: 'info' | 'success' | 'warning' | 'error'; children: ReactNode }) {
  const Icon = { info: Info, success: CheckCircle2, warning: TriangleAlert, error: AlertCircle }[tone];
  const label = { info: 'Information', success: 'Success', warning: 'Warning', error: 'Error' }[tone];
  return <div className={`ui-alert ui-alert--${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
    <Icon className="ui-alert__icon" aria-hidden="true" /><div><strong>{label}</strong><div>{children}</div></div>
  </div>;
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div className="ui-empty"><h2>{title}</h2><p>{description}</p>{action}</div>;
}

export function LoadingState({ label = 'Loading records…' }: { label?: string }) {
  return <div className="ui-loading" role="status"><span className="ui-spinner" aria-hidden="true" />{label}</div>;
}

// Keep real table markup, headings, row IDs and existing row handlers at the call site.
export function Table({ label, children, className, ...props }: TableHTMLAttributes<HTMLTableElement> & { label: string }) {
  return <div className="ui-table-scroll" role="region" aria-label={label} tabIndex={0}>
    <table {...props} className={classes('ui-table', className)}>{children}</table>
  </div>;
}

// Native modal behavior contains keyboard focus. Existing dialogs are adopted
// separately so their save/cancel guards are preserved at each call site.
export function Modal({ open, title, children, footer, onRequestClose, dismissible = true }: {
  open: boolean; title: string; children: ReactNode; footer?: ReactNode;
  onRequestClose: () => void; dismissible?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
    return () => { if (element.open) element.close(); };
  }, [open]);
  return <dialog ref={dialog} className="ui-modal" aria-labelledby={titleId} onCancel={event => {
    event.preventDefault();
    if (dismissible) onRequestClose();
  }}>
    <div className="ui-modal__header"><h2 id={titleId}>{title}</h2>
      <Button onClick={onRequestClose} disabled={!dismissible}>Close</Button>
    </div>
    <div className="ui-modal__body">{children}</div>
    {footer && <div className="ui-modal__footer">{footer}</div>}
  </dialog>;
}

export function Tabs({ label, items, selected, onSelect }: {
  label: string; items: { id: string; label: string; panelId: string; disabled?: boolean }[];
  selected: string; onSelect: (id: string) => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  return <div ref={list} className="ui-tabs" role="tablist" aria-label={label} onKeyDown={event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const buttons = Array.from(list.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || []);
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (current < 0 || !buttons.length) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : (current + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next].focus();
    buttons[next].click();
  }}>
    {items.map(item => <button key={item.id} id={item.id} type="button" role="tab"
      aria-controls={item.panelId} aria-selected={selected === item.id}
      tabIndex={selected === item.id ? 0 : -1} disabled={item.disabled}
      onClick={() => onSelect(item.id)}>{item.label}</button>)}
  </div>;
}
