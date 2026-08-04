/**
 * Uniform result shape for the data-access layer so callers surface `error` the same way
 * across the app. Discriminated on `ok` rather than on `error` being null, because `string`
 * is not a unit type and TypeScript will not narrow `data` off it.
 */
export type Result<T> = { ok: true; data: T } | { ok: false; error: string }
