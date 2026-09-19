// Extends Vitest's `expect` with jest-dom matchers (toBeInTheDocument, etc.)
// for every test file — see vitest.config.ts `test.setupFiles`.
import '@testing-library/jest-dom/vitest'

import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// @testing-library/react normally registers this itself, but only when it
// finds a global `afterEach` — this project doesn't turn on `test.globals`
// (see vitest.config.ts), so without this, DOM from one test leaks into the
// next test in the same file (duplicate elements, stale event handlers).
afterEach(() => {
  cleanup()
})
