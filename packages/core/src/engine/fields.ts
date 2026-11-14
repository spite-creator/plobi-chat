/**
 * Event form validation: required fields, attachment counts, conditional fields.
 */
import type { EventField, FieldKind } from '../catalog/types.js';
import type { Attachment } from './types.js';

const ATTACHMENT_FIELDS: ReadonlySet<FieldKind> = new Set(['photo', 'video', 'document', 'signature']);

export function isAttachmentField(kind: FieldKind): boolean {
  return ATTACHMENT_FIELDS.has(kind);
}

export function isEmptyValue(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === 'string' && value.trim() === '') ||
    (Array.isArray(value) && value.length === 0)
  );
}

function isShown(field: EventField, values: Readonly<Record<string, unknown>>): boolean {
  if (!field.showIf) return true;
  return Object.entries(field.showIf).every(([key, expected]) => values[key] === expected);
}

/** Keys of required fields that are missing or have too few files. */
export function missingFields(
  fields: readonly EventField[] | undefined,
  values: Readonly<Record<string, unknown>> = {},
  attachments: readonly Attachment[] = [],
): string[] {
  const missing: string[] = [];
  for (const field of fields ?? []) {
    if (!field.required || !isShown(field, values)) continue;
    if (isAttachmentField(field.kind)) {
      const files = attachments.filter(
        (a) => a.field === field.key && (!field.cameraOnly || a.source === 'camera'),
      );
      if (files.length < (field.min ?? 1)) missing.push(field.key);
    } else if (isEmptyValue(values[field.key])) {
      missing.push(field.key);
    }
  }
  return missing;
}
