import { describe, expect, it } from 'vitest'
import { buildWhatsAppMeUrl, buildWhatsAppMeUrlWithMessage } from './whatsappLink'

describe('buildWhatsAppMeUrl', () => {
  it('normalizes 08… to 62…', () => {
    expect(buildWhatsAppMeUrl('081226725373')).toBe('https://wa.me/6281226725373')
  })

  it('keeps 62 prefix', () => {
    expect(buildWhatsAppMeUrl('6281226725373')).toBe('https://wa.me/6281226725373')
  })

  it('strips spaces and punctuation', () => {
    expect(buildWhatsAppMeUrl('+62 812-2672-5373')).toBe('https://wa.me/6281226725373')
  })

  it('returns null for empty', () => {
    expect(buildWhatsAppMeUrl('')).toBeNull()
    expect(buildWhatsAppMeUrl(null)).toBeNull()
    expect(buildWhatsAppMeUrl('   ')).toBeNull()
  })
})

describe('buildWhatsAppMeUrlWithMessage', () => {
  it('appends encoded text query', () => {
    const url = buildWhatsAppMeUrlWithMessage('081226725373', 'Email: a@b.com\nPassword: abc123')
    expect(url).toBe(
      'https://wa.me/6281226725373?text=' +
        encodeURIComponent('Email: a@b.com\nPassword: abc123'),
    )
  })

  it('omits text when message empty', () => {
    expect(buildWhatsAppMeUrlWithMessage('081226725373', '')).toBe('https://wa.me/6281226725373')
    expect(buildWhatsAppMeUrlWithMessage('081226725373', null)).toBe('https://wa.me/6281226725373')
  })

  it('returns null when phone invalid', () => {
    expect(buildWhatsAppMeUrlWithMessage('', 'Hi')).toBeNull()
  })
})
