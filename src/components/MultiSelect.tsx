import { INSURANCE_PURPOSES } from '../lib/constants'
import type { InsurancePurpose } from '../lib/types'

/**
 * Insurance Purpose is multi-select. Tap targets are chips rather than a native
 * multi-select box, which is awkward on a tablet.
 */
export function PurposeSelect({
  value,
  onChange,
  disabled = false,
}: {
  value: InsurancePurpose[]
  onChange: (next: InsurancePurpose[]) => void
  disabled?: boolean
}) {
  const toggle = (purpose: InsurancePurpose) => {
    onChange(
      value.includes(purpose) ? value.filter((p) => p !== purpose) : [...value, purpose],
    )
  }

  return (
    <div className="chipset" role="group" aria-label="Insurance purpose">
      {INSURANCE_PURPOSES.map((purpose) => {
        const on = value.includes(purpose)
        return (
          <button
            key={purpose}
            type="button"
            className={`chip${on ? ' chip--on' : ''}`}
            aria-pressed={on}
            disabled={disabled}
            onClick={() => toggle(purpose)}
          >
            {on && <span className="chip__tick">✓</span>}
            {purpose}
          </button>
        )
      })}
    </div>
  )
}
