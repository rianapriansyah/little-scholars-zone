import { supabase } from './supabase'

const FAMILY_EMAIL_DOMAIN = import.meta.env.VITE_FAMILY_EMAIL_DOMAIN ?? 'lsz.id'

export function familyEmailDomain(): string {
  return FAMILY_EMAIL_DOMAIN
}

/**
 * Builds a login email local-part from the parent's name: full first word +
 * first 3 letters of the second word, lowercased, letters only.
 * e.g. "Rian Apriansyah" -> "rianapr"
 */
export function familyEmailLocalPart(parentName: string): string {
  const words = parentName
    .trim()
    .split(/\s+/)
    .map((w) => w.toLowerCase().replace(/[^a-z]/g, ''))
    .filter(Boolean)
  const [first, second] = words
  return `${first ?? ''}${(second ?? '').slice(0, 3)}`
}

/**
 * Resolves a login email for a new family from the parent's name, appending
 * a numeric suffix (rianapr2@…, rianapr3@…, …) if the base is already taken.
 */
export async function generateUniqueFamilyEmail(parentName: string): Promise<string> {
  const domain = familyEmailDomain()
  const base = familyEmailLocalPart(parentName)
  const { data } = await supabase.from('families').select('contact_email').ilike('contact_email', `${base}%@${domain}`)
  const taken = new Set((data ?? []).map((r) => r.contact_email?.toLowerCase()).filter(Boolean))

  let candidate = `${base}@${domain}`
  let n = 2
  while (taken.has(candidate)) {
    candidate = `${base}${n}@${domain}`
    n += 1
  }
  return candidate
}
