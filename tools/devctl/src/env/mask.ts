/** Masks a secret value for display, e.g. "sk_live_••••••••1234". */
export function maskValue(value: string): string {
  if (!value) return '';
  if (value.length <= 8) return '•'.repeat(value.length);

  const prefixLen = Math.min(8, Math.floor(value.length * 0.3));
  const suffixLen = 4;
  const prefix = value.slice(0, prefixLen);
  const suffix = value.slice(-suffixLen);
  const maskedLen = Math.max(4, value.length - prefixLen - suffixLen);

  return `${prefix}${'•'.repeat(maskedLen)}${suffix}`;
}
