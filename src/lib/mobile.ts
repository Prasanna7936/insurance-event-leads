/**
 * Mirrors the normaliser used by the edge functions so the UI can validate
 * before spending an SMS. The server always re-validates.
 */
export function normalizeIndianMobile(raw: string): string | null {
  if (!raw) return null
  let digits = raw.replace(/\D/g, '')
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2)
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1)
  if (!/^[6-9]\d{9}$/.test(digits)) return null
  return `+91${digits}`
}

export function isValidIndianMobile(raw: string): boolean {
  return normalizeIndianMobile(raw) !== null
}

/** +919876543210 -> 98765 43210, for comfortable reading in the table. */
export function displayMobile(mobile: string | null | undefined): string {
  if (!mobile) return ''
  const digits = mobile.replace(/\D/g, '').slice(-10)
  if (digits.length !== 10) return mobile
  return `${digits.slice(0, 5)} ${digits.slice(5)}`
}
