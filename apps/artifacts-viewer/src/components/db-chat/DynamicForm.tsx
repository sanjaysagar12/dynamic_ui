'use client';

import { useEffect, useRef, useState } from 'react';
import type { DbChatMessage, FormFieldSpec, FormSpec } from '../../lib/db-chat/types';
import { submitDbChatForm, DbChatRequestError } from '../../lib/api/db-chat-client';
import type { ToolResult } from '../../lib/api/session-client';
import { isEmptyValue } from './dynamicUtils';
import { Input, Textarea, Select } from '../ui/input';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils/cn';

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
  // The chat session this form was issued from, if any — forwarded to /api/submit-form so a
  // post-write hook's follow-up reply can be persisted into it. Undefined for a form shown with
  // no active conversation.
  sessionId?: string;
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
  invalid,
}: {
  field: FormFieldSpec;
  value: unknown;
  onChange: (value: unknown, label?: string) => void;
  token: string;
  invalid: boolean;
}) {
  const { options, loading, search } = useForeignKeyOptions(field, token);
  const fk = field.foreignKey!;

  if (fk.allowCreate) {
    // valueField === labelField (a name string) for every allowCreate field this app defines —
    // the typed text already is the human-readable value, so no separate label lookup is needed.
    const datalistId = `fk-${field.name}`;
    return (
      <>
        <Input
          list={datalistId}
          value={typeof value === 'string' ? value : ''}
          placeholder={loading ? 'loading…' : field.required ? 'required' : 'optional'}
          invalid={invalid}
          onChange={(e) => {
            onChange(e.target.value);
            search(e.target.value);
          }}
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
    <Select
      value={typeof value === 'string' ? value : ''}
      onChange={(e) => {
        const selected = options.find((opt) => String(opt.value) === e.target.value);
        onChange(e.target.value, selected?.label);
      }}
      disabled={loading}
      className={invalid ? 'border-negative' : undefined}
    >
      <option value="" disabled>
        {loading ? 'loading…' : field.required ? 'required' : 'optional'}
      </option>
      {options.map((opt) => (
        <option key={String(opt.value)} value={String(opt.value)}>
          {opt.label}
        </option>
      ))}
    </Select>
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
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[13px] text-secondary">
        {field.label}
        {field.required && <span className="text-negative"> *</span>}
      </span>
      {field.widget === 'checkbox' ? (
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
          className="h-4 w-4 self-start accent-[var(--accent-500)]"
        />
      ) : field.widget === 'textarea' ? (
        <Textarea
          value={typeof value === 'string' ? value : ''}
          placeholder={field.required ? 'required' : 'optional'}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          invalid={showError}
        />
      ) : field.widget === 'select' ? (
        <Select value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value)} className={showError ? 'border-negative' : undefined}>
          <option value="" disabled>
            {field.required ? 'required' : 'optional'}
          </option>
          {field.options?.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </Select>
      ) : field.widget === 'foreign_key' && field.foreignKey ? (
        <ForeignKeyInput field={field} value={value} onChange={onChange} token={token} invalid={showError} />
      ) : (
        <Input
          type={field.widget === 'number' ? 'number' : field.widget === 'date' ? 'date' : field.name === 'password' ? 'password' : 'text'}
          value={typeof value === 'string' || typeof value === 'number' ? value : ''}
          placeholder={field.required ? 'required' : 'optional'}
          onChange={(e) => onChange(field.widget === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)}
          invalid={showError}
        />
      )}
      {field.helpText && <span className="text-[12px] text-tertiary">{field.helpText}</span>}
      {showError && <span className="text-negative text-[12px]">Required — the agent won&apos;t invent one.</span>}
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
    <div className="flex flex-col gap-2">
      <span className="text-[13px] text-secondary">
        {field.label}
        {field.required && <span className="text-negative"> *</span>}
      </span>
      {rows.map((row, i) => (
        <div key={i} className="border border-subtle rounded-md p-3 flex flex-col gap-2.5 bg-surface-raised">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-semibold text-tertiary">Row {i + 1}</span>
            <Button type="button" variant="outlined" size="compact" onClick={() => removeRow(i)} className="h-7 px-2.5 text-[12px]">
              Remove
            </Button>
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
      <Button type="button" variant="outlined" size="compact" onClick={addRow} className="self-start">
        + Add row
      </Button>
      {touched && field.required && rows.length === 0 && <span className="text-negative text-[12px]">At least one row is required.</span>}
    </div>
  );
}

/** The generic write form — built entirely from FormSpec, not a per-tool template. Inline in the
 *  chat thread (no modal), two-step (edit -> review -> confirm): filling the form and confirming
 *  IS the write confirmation now — there's no separate "type yes" step after this. */
export function DynamicForm({ toolName, form, prefill, messages, token, sessionId, onDone, onMessagesUpdate, onCancel }: DynamicFormProps) {
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
      const response = await submitDbChatForm({ toolName, args, messages, sessionId }, token);
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
    <div className="bg-surface border border-subtle rounded-lg p-4 text-[13px]" style={{ borderLeft: '3px solid var(--accent-500)' }}>
      <div className="text-h2 text-primary mb-3">{form.title}</div>

      {form.confirmationCopy && (
        <div className="bg-warning-soft border border-subtle rounded-md px-3 py-2 text-[13px] text-warning mb-3">
          {form.confirmationCopy}
        </div>
      )}

      {error && <p className="text-negative text-[13px] mb-3">{error}</p>}

      {step === 'edit' ? (
        <>
          <div className="flex flex-col gap-3">
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
            <p className="text-negative text-[12px] mt-2.5">Required: {missingRequired.join(', ')} — the agent won&apos;t invent a value.</p>
          )}
          <div className="flex justify-end gap-2 mt-4">
            <Button type="button" variant="outlined" size="compact" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="button" size="compact" onClick={handleReview}>
              Review
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            {form.fields
              .filter((field) => isVisible(field, values))
              .map((field) =>
                field.widget === 'line_items' ? (
                  <div key={field.name}>
                    <div className="text-tertiary text-[12px] mb-1">{field.label}</div>
                    {(Array.isArray(values[field.name]) ? (values[field.name] as Record<string, unknown>[]) : []).map((row, i) => (
                      <div key={i} className="pl-3 text-[13px] mb-1 text-secondary">
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
                  <div key={field.name} className={cn('flex justify-between gap-4')}>
                    <span className="text-tertiary">{field.label}</span>
                    <span className="font-medium text-primary">{formatReviewValue(field, values[field.name], labels[field.name])}</span>
                  </div>
                ),
              )}
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button type="button" variant="outlined" size="compact" onClick={() => setStep('edit')} disabled={submitting}>
              Edit
            </Button>
            <Button type="button" size="compact" loading={submitting} onClick={handleConfirm}>
              {form.submitLabel ?? 'Submit'}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
