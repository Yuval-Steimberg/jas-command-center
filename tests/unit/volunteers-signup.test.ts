import { describe, expect, it } from 'vitest'
import { signupProblems, signupSummary } from '@/lib/volunteers/model'

describe('volunteer sign-up problems', () => {
  it('names every missing field at once, not just the first', () => {
    const p = signupProblems({ fullName: '', phone: '', age16: false, consent: false })
    expect(Object.keys(p)).toEqual(['fullName', 'phone', 'age16', 'consent'])
    expect(signupSummary(p)).toBe('עוד 4 פרטים חסרים או לא תקינים: שם מלא, טלפון נייד, אישור גיל 16+, הסכמה לאימיילים.')
  })

  it('tells missing apart from invalid', () => {
    expect(signupProblems({ fullName: 'נועה', phone: '03-1234567', age16: true, consent: true })).toEqual({
      fullName: 'נא לכתוב שם פרטי ושם משפחה, באותיות בלבד.',
      phone: 'זה לא נראה כמו נייד ישראלי. למשל 050-123-4567.',
    })
    expect(signupSummary({ phone: 'x' })).toBe('עוד פרט אחד חסר או לא תקין: טלפון נייד.')
  })

  it('passes a complete registration', () => {
    expect(signupProblems({ fullName: 'נועה ברנט', phone: '050-123-4567', age16: true, consent: true })).toEqual({})
  })
})
