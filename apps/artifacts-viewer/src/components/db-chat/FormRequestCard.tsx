'use client';

import { useEffect, useState } from 'react';
import type { DbChatMessage, FormFieldSpec, FormSpec } from '../../lib/db-chat/types';
import { submitDbChatForm, DbChatRequestError } from '../../lib/api/db-chat-client';
import type { ToolResult } from '../../lib/api/session-client';
import { theme, inputStyle, primaryButtonStyle, secondaryButtonStyle } from '../../lib/ui/theme';

interface ForeignKeyOption {
  value: unknown;
  label: string;
}

interface FormRequestCardProps {
  form: FormSpec;
  messages: DbChatMessage[];
  token: string;
  onDone: (messages: DbChatMessage[]) => void;
  onCancel: () => void;
}

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}

function formatDisplayValue(field: FormFieldSpec, value: unknown): string {
  if (isEmpty(value)) return '(empty)';
  if (field.type === 'boolean') return value ? 'Yes' : 'No';
  if (field.type === 'foreign_key' || field.type === 'select') {
    const option = field.options?.find((o) => o.value === value);
    return option?.label ?? String(value);
  }
  return String(value);
}

/** The generated write form — built entirely from FormSpec.fields, not a per-table template.
 *  Inline in the chat thread (no modal), two-step (edit -> review -> confirm), matching the
 *  interaction pattern from the reference prototype. */
export function FormRequestCard({ form, messages, token, onDone, onCancel }: FormRequestCardProps) {
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const initial: Record<string, unknown> = {};
    for (const field of form.fields) {
      if (field.default !== undefined) initial[field.name] = field.default;
    }
    return initial;
  });
  const [touched, setTouched] = useState(false);
  const [step, setStep] = useState<'edit' | 'review'>('edit');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fkOptions, setFkOptions] = useState<Record<string, ForeignKeyOption[]>>({});
  const [fkLoading, setFkLoading] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const fkFields = form.fields.filter(
      (f): f is FormFieldSpec & { referenceTable: string } => f.type === 'foreign_key' && Boolean(f.referenceTable),
    );
    for (const field of fkFields) {
      setFkLoading((prev) => ({ ...prev, [field.name]: true }));
      fetch('/api/tools/list_rows', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ args: { table: field.referenceTable } }),
      })
        .then((res) => res.json())
        .then((body: ToolResult<Record<string, unknown>[]>) => {
          const rows = body.ok ? body.data : [];
          const labelColumn = field.referenceLabelColumn ?? 'id';
          setFkOptions((prev) => ({
            ...prev,
            [field.name]: rows.map((row) => ({
              value: row.id,
              label: typeof row[labelColumn] === 'string' ? (row[labelColumn] as string) : String(row.id),
            })),
          }));
        })
        .catch(() => setFkOptions((prev) => ({ ...prev, [field.name]: [] })))
        .finally(() => setFkLoading((prev) => ({ ...prev, [field.name]: false })));
    }
    // Fetched once when the card mounts for this form — the field list doesn't change afterward.
  }, [form, token]);

  const missingRequired = form.fields.filter((f) => f.required && isEmpty(values[f.name]));

  const handleReview = () => {
    setTouched(true);
    if (missingRequired.length > 0) return;
    setStep('review');
  };

  const handleConfirm = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const response = await submitDbChatForm(
        { table: form.table, operation: form.operation, match: form.match, values, messages },
        token,
      );
      onDone(response.messages);
    } catch (err) {
      setError(err instanceof DbChatRequestError ? err.message : 'Could not save — try again.');
      setStep('edit');
    } finally {
      setSubmitting(false);
    }
  };

  const setField = (name: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [name]: value }));
  };

  return (
    <div
      style={{
        background: theme.color.surface,
        border: `1px solid ${theme.color.border}`,
        borderLeft: `3px solid ${theme.color.primary}`,
        borderRadius: theme.radius,
        boxShadow: theme.shadow,
        padding: '0.9rem 1rem',
        fontSize: '0.88rem',
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: '0.6rem' }}>
        {form.operation === 'insert' ? 'New' : 'Update'} — <code>{form.table}</code>
      </div>

      {error && <p style={{ color: theme.color.danger, fontSize: '0.82rem', marginBottom: '0.6rem' }}>{error}</p>}

      {step === 'edit' ? (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
            {form.fields.map((field) => (
              <FieldInput
                key={field.name}
                field={field}
                value={values[field.name]}
                onChange={(v) => setField(field.name, v)}
                showError={touched && field.required && isEmpty(values[field.name])}
                fkOptions={fkOptions[field.name]}
                fkLoading={fkLoading[field.name]}
              />
            ))}
          </div>
          {touched && missingRequired.length > 0 && (
            <p style={{ color: theme.color.danger, fontSize: '0.8rem', marginTop: '0.6rem' }}>
              Required: {missingRequired.map((f) => f.label).join(', ')} — the agent won&apos;t invent a value.
            </p>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.9rem' }}>
            <button type="button" onClick={onCancel} style={secondaryButtonStyle}>
              Cancel
            </button>
            <button type="button" onClick={handleReview} style={primaryButtonStyle}>
              Review
            </button>
          </div>
        </>
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            {form.fields.map((field) => (
              <div key={field.name} style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
                <span style={{ color: theme.color.textMuted }}>{field.label}</span>
                <span style={{ fontWeight: 500 }}>{formatDisplayValue(field, values[field.name])}</span>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.9rem' }}>
            <button type="button" onClick={() => setStep('edit')} disabled={submitting} style={secondaryButtonStyle}>
              Edit
            </button>
            <button type="button" onClick={handleConfirm} disabled={submitting} style={primaryButtonStyle}>
              {submitting ? 'Saving…' : 'Confirm'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function FieldInput({
  field,
  value,
  onChange,
  showError,
  fkOptions,
  fkLoading,
}: {
  field: FormFieldSpec;
  value: unknown;
  onChange: (value: unknown) => void;
  showError: boolean;
  fkOptions?: ForeignKeyOption[];
  fkLoading?: boolean;
}) {
  const errorStyle = showError ? { borderColor: theme.color.danger } : {};

  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
      <span style={{ fontSize: '0.78rem', color: theme.color.textMuted }}>
        {field.label}
        {field.required && <span style={{ color: theme.color.danger }}> *</span>}
      </span>
      {field.type === 'boolean' ? (
        <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} style={{ alignSelf: 'flex-start' }} />
      ) : field.type === 'select' ? (
        <select value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value)} style={{ ...inputStyle, ...errorStyle }}>
          <option value="" disabled>
            {field.required ? 'required' : 'optional'}
          </option>
          {field.options?.map((opt) => (
            <option key={String(opt.value)} value={String(opt.value)}>
              {opt.label}
            </option>
          ))}
        </select>
      ) : field.type === 'foreign_key' ? (
        <select
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          disabled={fkLoading}
          style={{ ...inputStyle, ...errorStyle }}
        >
          <option value="" disabled>
            {fkLoading ? 'loading…' : field.required ? 'required' : 'optional'}
          </option>
          {fkOptions?.map((opt) => (
            <option key={String(opt.value)} value={String(opt.value)}>
              {opt.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
          value={typeof value === 'string' || typeof value === 'number' ? value : ''}
          placeholder={field.required ? 'required' : 'optional'}
          onChange={(e) => onChange(field.type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)}
          style={{ ...inputStyle, ...errorStyle }}
        />
      )}
      {showError && <span style={{ color: theme.color.danger, fontSize: '0.75rem' }}>Required — the agent won&apos;t invent one.</span>}
    </label>
  );
}
