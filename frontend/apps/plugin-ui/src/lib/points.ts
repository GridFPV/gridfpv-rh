/**
 * Points-method settings (RotorHazard's "gear" next to the format's points method): each
 * method declares UI fields; a format stores their values as `points_settings`. Pure
 * helpers for the format dialog.
 */

export type PointsField = {
  name: string;
  label: string;
  field_type: string;
  value?: unknown;
  placeholder?: string | null;
  desc?: string | null;
  options?: Array<{ value: string; label: string }> | null;
};

export type PointsMethod = { name: string; label: string; settings: PointsField[] };

/** The settings form for a method: the stored values, else each field's default, as strings. */
export function pointsForm(
  method: PointsMethod | undefined,
  stored: Record<string, unknown> | null | undefined
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of method?.settings ?? []) {
    const v = stored?.[f.name] ?? f.value ?? '';
    out[f.name] = v == null ? '' : String(v);
  }
  return out;
}

/** The settings to write for a method, typed by field kind; null when the method has none. */
export function pointsSettings(
  method: PointsMethod | undefined,
  form: Record<string, string>
): Record<string, unknown> | null {
  if (!method?.settings.length) return null;
  const out: Record<string, unknown> = {};
  for (const f of method.settings) {
    const raw = form[f.name] ?? '';
    if (f.field_type === 'checkbox') out[f.name] = raw === 'true' || raw === '1';
    else if (f.field_type === 'basic_int' || f.field_type === 'number')
      out[f.name] = raw.trim() === '' ? null : Number(raw);
    else out[f.name] = raw;
  }
  return out;
}

/** True when the settings to write differ from what the format stores. */
export function pointsChanged(
  next: Record<string, unknown> | null,
  stored: Record<string, unknown> | null | undefined
): boolean {
  if (next == null) return false;
  const s = stored ?? {};
  return Object.keys(next).some((k) => String(next[k] ?? '') !== String(s[k] ?? ''));
}
