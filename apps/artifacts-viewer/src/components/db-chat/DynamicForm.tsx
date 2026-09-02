'use client';

import { useEffect, useRef, useState } from 'react';
import type { DbChatMessage, FormFieldSpec, FormSpec } from '../../lib/db-chat/types';
import { submitDbChatForm, DbChatRequestError } from '../../lib/api/db-chat-client';
import type { ToolResult } from '../../lib/api/session-client';
import { theme, inputStyle, primaryButtonStyle, secondaryButtonStyle } from '../../lib/ui/theme';
import { isEmptyValue } from './dynamicUtils';

interface FkOption {
  value: unknown;
  label: string;
}

interface DynamicFormProps {
  toolName: string;
  form: FormSpec;
  prefill?: Record<string, unknown>;
  messages: DbChatMessage[];
  token: string;
  onDone: (messages: DbChatMessage[]) => void;
  // Called when a submission is rejected by the tool itself (the form stays open) — keeps the
  // transcript in sync without closing the form the way onDone does.
  onMessagesUpdate: (messages: DbChatMessage[]) => void;
  onCancel: () => void;
}

function initialValues(form: FormSpec, prefill?: Record<string, unknown>): Record<string, unknown> {
  const initial: Record<string, unknown> = {};
  for (const field of form.fields) {
    if (field.widget === 'line_items') {
      initial[field.name] = [];
    } else if (field.defaultValue !== undefined) {
      initial[field.name] = field.defaultValue;
    }
  }
  return { ...initial, ...(prefill ?? {}) };
}

function initialRow(itemFields: FormFieldSpec[]): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const f of itemFields) {
    if (f.defaultValue !== undefined) row[f.name] = f.defaultValue;
  }
  return row;
}

function isVisible(field: FormFieldSpec, values: Record<string, unknown>): boolean {
  if (!field.visibleIf) return true;
  return values[field.visibleIf.field] === field.visibleIf.equals;
}

/** required fields missing a value, at the top level and within every line_items row — used to
 *  gate the edit -> review transition. */
function findMissingRequired(fields: FormFieldSpec[], values: Record<string, unknown>): string[] {
  const missing: string[] = [];
  for (const field of fields) {
    if (!isVisible(field, values)) continue;
    if (field.widget === 'line_items') {
      const rows = Array.isArray(values[field.name]) ? (values[field.name] as Record<string, unknown>[]) : [];
      if (field.required && rows.length === 0) missing.push(field.label);
      rows.forEach((row, i) => {
        for (const itemField of field.itemFields ?? []) {
          if (itemField.required && isEmptyValue(row[itemField.name])) {
            missing.push(`${field.label} #${i + 1}: ${itemField.label}`);
          }
        }
      });
    } else if (field.required && isEmptyValue(values[field.name])) {
      missing.push(field.label);
    }
  }
  return missing;
}

function formatReviewValue(field: FormFieldSpec, value: unknown, resolvedLabel?: string): string {
  if (isEmptyValue(value)) return '(empty)';
  if (field.widget === 'checkbox') return value ? 'Yes' : 'No';
  if (field.widget === 'select') {
    return field.options?.find((o) => o.value === value)?.label ?? String(value);
  }
  if (field.widget === 'foreign_key') {
    return resolvedLabel ?? String(value);
  }
  return String(value);
}

// A line_items row carries its foreign_key labels alongside its real values under this reserved
// prefix, purely for the review step's display — stripped back out before the row is submitted.
const ROW_LABEL_PREFIX = '__label__';

function stripRowLabels(row: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (!key.startsWith(ROW_LABEL_PREFIX)) clean[key] = value;
  }
  return clean;
}

/** A single foreign_key field's own live-search + option list — owns its fetch so different
 *  fields (and different rows of a line_items field) can search independently. Debounced so
 *  typing doesn't fire a request per keystroke. */
function useForeignKeyOptions(field: FormFieldSpec, token: string): { options: FkOption[]; loading: boolean; search: (text: string) => void } {
  const [options, setOptions] = useState<FkOption[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchOptions = (text: string) => {
    const fk = field.foreignKey;
    if (!fk) return;
    setLoading(true);
    fetch(`/api/tools/${fk.tool}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ args: { ...(fk.args ?? {}), query: text } }),
    })
      .then((res) => res.json())
      .then((body: ToolResult<Record<string, unknown>[]>) => {
        const rows = body.ok && Array.isArray(body.data) ? body.data : [];
        setOptions(
          rows.map((row) => ({
            value: row[fk.valueField],
            label: typeof row[fk.labelField] === 'string' ? (row[fk.labelField] as string) : String(row[fk.valueField]),
          })),
        );
      })
      .catch(() => setOptions([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchOptions('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [field.name, token]);

  const search = (text: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchOptions(text), 300);
  };

  return { options, loading, search };
}

function ForeignKeyInput({
  field,
  value,
  onChange,
  token,
  errorStyle,
}: {
  field: FormFieldSpec;
  value: unknown;
  onChange: (value: unknown, label?: string) => void;
  token: string;
  errorStyle: object;
}) {
  const { options, loading, search } = useForeignKeyOptions(field, token);
  const fk = field.foreignKey!;

  if (fk.allowCreate) {
    // valueField === labelField (a name string) for every allowCreate field this app defines —
    // the typed text already is the human-readable value, so no separate label lookup is needed.
    const datalistId = `fk-${field.name}`;
    return (
      <>
        <input
          list={datalistId}
          value={typeof value === 'string' ? value : ''}
          placeholder={loading ? 'loading…' : field.required ? 'required' : 'optional'}
          onChange={(e) => {
            onChange(e.target.value);
            search(e.target.value);
          }}
          style={{ ...inputStyle, ...errorStyle }}
        />
        <datalist id={datalistId}>
          {options.map((opt) => (
            <option key={String(opt.value)} value={String(opt.value)}>
              {opt.label}
            </option>
          ))}
        </datalist>
      </>
    );
  }

  return (
    <select
      value={typeof value === 'string' ? value : ''}
      onChange={(e) => {
        const selected = options.find((opt) => String(opt.value) === e.target.value);
        onChange(e.target.value, selected?.label);
      }}
      disabled={loading}
      style={{ ...inputStyle, ...errorStyle }}
    >
      <option value="" disabled>
        {loading ? 'loading…' : field.required ? 'required' : 'optional'}
      </option>
      {options.map((opt) => (
        <option key={String(opt.value)} value={String(opt.value)}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

function FieldInput({
  field,
  value,
  onChange,
  showError,
  token,
}: {
  field: FormFieldSpec;
  value: unknown;
  onChange: (value: unknown, label?: string) => void;
  showError: boolean;
  token: string;
}) {
  const errorStyle = showError ? { borderColor: theme.color.danger } : {};

  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
      <span style={{ fontSize: '0.78rem', color: theme.color.textMuted }}>
        {field.label}
        {field.required && <span style={{ color: theme.color.danger }}> *</span>}
      </span>
      {field.widget === 'checkbox' ? (
        <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} style={{ alignSelf: 'flex-start' }} />
      ) : field.widget === 'textarea' ? (
        <textarea
          value={typeof value === 'string' ? value : ''}
          placeholder={field.required ? 'required' : 'optional'}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          style={{ ...inputStyle, ...errorStyle, resize: 'vertical', fontFamily: 'inherit' }}
        />
      ) : field.widget === 'select' ? (
        <select value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value)} style={{ ...inputStyle, ...errorStyle }}>
          <option value="" disabled>
            {field.required ? 'required' : 'optional'}
          </option>
          {field.options?.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      ) : field.widget === 'foreign_key' && field.foreignKey ? (
        <ForeignKeyInput field={field} value={value} onChange={onChange} token={token} errorStyle={errorStyle} />
      ) : (
        <input
          type={field.widget === 'number' ? 'number' : field.widget === 'date' ? 'date' : field.name === 'password' ? 'password' : 'text'}
          value={typeof value === 'string' || typeof value === 'number' ? value : ''}
          placeholder={field.required ? 'required' : 'optional'}
          onChange={(e) => onChange(field.widget === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)}
          style={{ ...inputStyle, ...errorStyle }}
        />
      )}
      {field.helpText && <span style={{ fontSize: '0.72rem', color: theme.color.textMuted }}>{field.helpText}</span>}
      {showError && <span style={{ color: theme.color.danger, fontSize: '0.75rem' }}>Required — the agent won&apos;t invent one.</span>}
    </label>
  );
}

function LineItemsInput({
  field,
  rows,
  onChange,
  touched,
  token,
}: {
  field: FormFieldSpec;
  rows: Record<string, unknown>[];
  onChange: (rows: Record<string, unknown>[]) => void;
  touched: boolean;
  token: string;
}) {
  const itemFields = field.itemFields ?? [];

  const updateRow = (index: number, name: string, value: unknown, label?: string) => {
    const next = rows.slice();
    next[index] = { ...next[index], [name]: value, ...(label !== undefined ? { [`${ROW_LABEL_PREFIX}${name}`]: label } : {}) };
    onChange(next);
  };
  const removeRow = (index: number) => onChange(rows.filter((_, i) => i !== index));
  const addRow = () => onChange([...rows, initialRow(itemFields)]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
      <span style={{ fontSize: '0.78rem', color: theme.color.textMuted }}>
        {field.label}
        {field.required && <span style={{ color: theme.color.danger }}> *</span>}
      </span>
      {rows.map((row, i) => (
        <div
          key={i}
          style={{
            border: `1px solid ${theme.color.border}`,
            borderRadius: theme.radiusSm,
            padding: '0.6rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.5rem',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: theme.color.textMuted }}>Row {i + 1}</span>
            <button type="button" onClick={() => removeRow(i)} style={{ ...secondaryButtonStyle, padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}>
              Remove
            </button>
          </div>
          {itemFields.map((itemField) => (
            <FieldInput
              key={itemField.name}
              field={itemField}
              value={row[itemField.name]}
              onChange={(v, label) => updateRow(i, itemField.name, v, label)}
              showError={touched && itemField.required && isEmptyValue(row[itemField.name])}
              token={token}
            />
          ))}
        </div>
      ))}
      <button type="button" onClick={addRow} style={{ ...secondaryButtonStyle, alignSelf: 'flex-start' }}>
        + Add row
      </button>
      {touched && field.required && rows.length === 0 && (
        <span style={{ color: theme.color.danger, fontSize: '0.75rem' }}>At least one row is required.</span>
      )}
    </div>
  );
}

/** The generic write form — built entirely from FormSpec, not a per-tool template. Inline in the
 *  chat thread (no modal), two-step (edit -> review -> confirm): filling the form and confirming
 *  IS the write confirmation now — there's no separate "type yes" step after this. */
export function DynamicForm({ toolName, form, prefill, messages, token, onDone, onMessagesUpdate, onCancel }: DynamicFormProps) {
  const [values, setValues] = useState<Record<string, unknown>>(() => initialValues(form, prefill));
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState(false);
  const [step, setStep] = useState<'edit' | 'review'>('edit');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const missingRequired = findMissingRequired(form.fields, values);

  const handleReview = () => {
    setTouched(true);
    if (missingRequired.length > 0) return;
    setStep('review');
  };

  const handleConfirm = async () => {
    setSubmitting(true);
    setError(null);
    try {
      // Strip the review-only __label__ companions each line_items row carries — tool-service's
      // own zod schema doesn't know about them and would reject the call as invalid args.
      const args: Record<string, unknown> = { ...values };
      for (const field of form.fields) {
        if (field.widget === 'line_items' && Array.isArray(args[field.name])) {
          args[field.name] = (args[field.name] as Record<string, unknown>[]).map(stripRowLabels);
        }
      }
      const response = await submitDbChatForm({ toolName, args, messages }, token);
      if (response.type === 'form_request') {
        // Rejected by the tool itself (e.g. a near-duplicate name) — not a transport error, so
        // this isn't the catch block below. Reopen for correction instead of closing: keep
        // whatever the user typed (values are untouched), surface why it failed, and let them
        // fix the offending field and resubmit without retyping the whole request in chat.
        onMessagesUpdate(response.messages);
        setError(response.text ?? "That couldn't be completed — please review and try again.");
        setStep('edit');
        return;
      }
      onDone(response.messages);
    } catch (err) {
      setError(err instanceof DbChatRequestError ? err.message : 'Could not save — try again.');
      setStep('edit');
    } finally {
      setSubmitting(false);
    }
  };

  const setField = (name: string, value: unknown, label?: string) => {
    setValues((prev) => ({ ...prev, [name]: value }));
    if (label !== undefined) setLabels((prev) => ({ ...prev, [name]: label }));
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
      <div style={{ fontWeight: 600, marginBottom: '0.5rem' }}>{form.title}</div>

      {form.confirmationCopy && (
        <div
          style={{
            background: '#fff8e6',
            border: '1px solid #f2d478',
            borderRadius: theme.radiusSm,
            padding: '0.5rem 0.65rem',
            fontSize: '0.8rem',
            marginBottom: '0.7rem',
            color: '#7a5c00',
          }}
        >
          {form.confirmationCopy}
        </div>
      )}

      {error && <p style={{ color: theme.color.danger, fontSize: '0.82rem', marginBottom: '0.6rem' }}>{error}</p>}

      {step === 'edit' ? (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
            {form.fields
              .filter((field) => isVisible(field, values))
              .map((field) =>
                field.widget === 'line_items' ? (
                  <LineItemsInput
                    key={field.name}
                    field={field}
                    rows={Array.isArray(values[field.name]) ? (values[field.name] as Record<string, unknown>[]) : []}
                    onChange={(rows) => setField(field.name, rows)}
                    touched={touched}
                    token={token}
                  />
                ) : (
                  <FieldInput
                    key={field.name}
                    field={field}
                    value={values[field.name]}
                    onChange={(v, label) => setField(field.name, v, label)}
                    showError={touched && field.required && isEmptyValue(values[field.name])}
                    token={token}
                  />
                ),
              )}
          </div>
          {touched && missingRequired.length > 0 && (
            <p style={{ color: theme.color.danger, fontSize: '0.8rem', marginTop: '0.6rem' }}>
              Required: {missingRequired.join(', ')} — the agent won&apos;t invent a value.
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
            {form.fields
              .filter((field) => isVisible(field, values))
              .map((field) =>
                field.widget === 'line_items' ? (
                  <div key={field.name}>
                    <div style={{ color: theme.color.textMuted, marginBottom: '0.2rem' }}>{field.label}</div>
                    {(Array.isArray(values[field.name]) ? (values[field.name] as Record<string, unknown>[]) : []).map((row, i) => (
                      <div key={i} style={{ paddingLeft: '0.75rem', fontSize: '0.82rem', marginBottom: '0.2rem' }}>
                        {(field.itemFields ?? [])
                          .map(
                            (itemField) =>
                              `${itemField.label}: ${formatReviewValue(itemField, row[itemField.name], row[`${ROW_LABEL_PREFIX}${itemField.name}`] as string | undefined)}`,
                          )
                          .join(' · ')}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div key={field.name} style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
                    <span style={{ color: theme.color.textMuted }}>{field.label}</span>
                    <span style={{ fontWeight: 500 }}>{formatReviewValue(field, values[field.name], labels[field.name])}</span>
                  </div>
                ),
              )}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.9rem' }}>
            <button type="button" onClick={() => setStep('edit')} disabled={submitting} style={secondaryButtonStyle}>
              Edit
            </button>
            <button type="button" onClick={handleConfirm} disabled={submitting} style={primaryButtonStyle}>
              {submitting ? 'Saving…' : form.submitLabel ?? 'Submit'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

