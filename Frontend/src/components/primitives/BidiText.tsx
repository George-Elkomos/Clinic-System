import { Fragment, isValidElement, type ReactNode } from 'react'

/** Isolates a run of text from the surrounding paragraph's bidi direction —
 * use around a name, date, or currency amount that may be in a different
 * script than the sentence it sits in, so it doesn't drag adjacent
 * punctuation/separators to the wrong visual side.
 *
 * `dir="auto"` (the default) is only safe when the run has at most one
 * strong-direction character run in it (a plain name, a currency amount).
 * A date/time string formatted for Arabic ends in a strong-RTL AM/PM marker
 * (ص/م) — under "auto" that makes the *whole* isolate resolve to an RTL base,
 * which then reorders its otherwise-neutral day/month/year and hour/minute
 * groups relative to each other (e.g. "18/08/2026, 4:26 PM" -> scrambled).
 * Pass `dir="ltr"` explicitly for any value built from formatDate/
 * formatDateTime/formatTime to keep those groups in their defined order. */
export function BidiText({
  children,
  dir = 'auto',
  className,
}: {
  children: ReactNode
  dir?: 'auto' | 'ltr' | 'rtl'
  className?: string
}) {
  return (
    <bdi dir={dir} className={className}>
      {children}
    </bdi>
  )
}

type MetaLinePart =
  | ReactNode
  | null
  | undefined
  | false
  | { node: ReactNode; dir: 'auto' | 'ltr' | 'rtl' }

function isDirTagged(part: MetaLinePart): part is { node: ReactNode; dir: 'auto' | 'ltr' | 'rtl' } {
  return typeof part === 'object' && part !== null && !isValidElement(part) && 'node' in part
}

/** Composes a "13/08/2026 · Dr. Mona Adly · Omar Hassan"-style meta line from
 * independent segments (date, names, status, ...): each segment is isolated
 * on its own so the line's overall reading order follows the paragraph
 * direction while no segment's script drags a neighboring `·` or the next
 * segment out of place. Falsy segments (null/undefined/false/'') are skipped.
 * A segment built from formatDate/formatDateTime/formatTime should be passed
 * as `{ node, dir: 'ltr' }` — see BidiText's doc comment for why. */
export function MetaLine({ parts }: { parts: MetaLinePart[] }) {
  const visible = parts.filter((p) => p !== null && p !== undefined && p !== false && p !== '')
  return (
    <>
      {visible.map((p, i) => {
        const { node, dir } = isDirTagged(p) ? p : { node: p, dir: 'auto' as const }
        return (
          <Fragment key={i}>
            {i > 0 && <span aria-hidden="true"> · </span>}
            <BidiText dir={dir}>{node}</BidiText>
          </Fragment>
        )
      })}
    </>
  )
}
