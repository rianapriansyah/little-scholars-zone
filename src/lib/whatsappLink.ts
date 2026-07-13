/**
 * Build `https://wa.me/<digits>` for WhatsApp Web / app.
 * Accepts Indonesian local format (08…) or already international (62…).
 */
export function buildWhatsAppMeUrl(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim()
  if (!trimmed) return null
  const digits = trimmed.replace(/\D/g, '')
  if (!digits) return null
  let n = digits
  if (n.startsWith('62')) {
    // already Indonesia country code
  } else if (n.startsWith('0')) {
    n = `62${n.slice(1)}`
  } else {
    n = `62${n}`
  }
  return `https://wa.me/${n}`
}

/** Same as {@link buildWhatsAppMeUrl} with optional `?text=` prefill. */
export function buildWhatsAppMeUrlWithMessage(
  raw: string | null | undefined,
  message: string | null | undefined,
): string | null {
  const base = buildWhatsAppMeUrl(raw)
  if (!base) return null
  const t = message?.trim()
  if (!t) return base
  return `${base}?text=${encodeURIComponent(t)}`
}
