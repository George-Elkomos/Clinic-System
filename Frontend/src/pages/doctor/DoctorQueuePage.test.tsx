import '../../i18n'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { LanguageContext } from '../../context/LanguageContext'
import { appointmentsApi } from '../../services/appointments.api'
import type { DoctorQueue, QueueAppointment } from '../../services/types'
import { DoctorQueuePage } from './DoctorQueuePage'

vi.mock('../../hooks/useDoctorQueueSocket', () => ({
  useDoctorQueueSocket: vi.fn(),
}))

vi.mock('../../services/appointments.api', () => ({
  appointmentsApi: {
    myQueue: vi.fn(),
    list: vi.fn().mockResolvedValue({ count: 0, next: null, previous: null, results: [] }),
  },
}))

vi.mock('../../services/billing.api', () => ({
  billingApi: { invoice: vi.fn() },
}))

const myQueueMock = vi.mocked(appointmentsApi.myQueue)

function buildPrevious(overrides: Partial<QueueAppointment> = {}): QueueAppointment {
  return {
    id: 1,
    patient: 10,
    patient_name: 'Omar Hassan',
    doctor: 5,
    doctor_name: 'Dr. Mona Adly',
    time_slot: null,
    scheduled_start: '2026-01-15T09:00:00Z',
    scheduled_end: '2026-01-15T09:20:00Z',
    status: 'COMPLETED',
    status_display: 'Completed',
    appointment_type: 'SCHEDULED',
    type_display: 'Scheduled',
    priority: 0,
    reason: '',
    cancellation_reason: '',
    checked_in_at: null,
    started_at: null,
    completed_at: '2026-01-15T09:18:00Z',
    created_at: '2026-01-15T08:00:00Z',
    encounter_id: 30,
    is_manual_override: false,
    override_reason: '',
    patient_reliability: { score: 100, label: 'GOOD' },
    patient_profile_id: 10,
    patient_phone: '',
    patient_dob: null,
    patient_gender: '',
    patient_blood_type: '',
    patient_allergies: '',
    patient_chronic_conditions: '',
    patient_current_medications: '',
    invoice_id: null,
    pending_checkout: false,
    has_history: false,
    ...overrides,
  }
}

function buildQueue(previous: QueueAppointment | null): DoctorQueue {
  return { previous, current: null, next: null, waiting_count: 0 }
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <LanguageContext.Provider value={{ language: 'en', dir: 'ltr', setLanguage: vi.fn() }}>
          <DoctorQueuePage />
        </LanguageContext.Provider>
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

describe('DoctorQueuePage — previous patient panel', () => {
  it('shows no "View Invoice" and shows a Pending Checkout badge when checkout is still pending', async () => {
    myQueueMock.mockResolvedValue(buildQueue(buildPrevious({ invoice_id: null, pending_checkout: true })))
    renderPage()

    expect(await screen.findByText('Omar Hassan')).toBeInTheDocument()
    expect(screen.getByText('Pending Checkout')).toBeInTheDocument()
    expect(screen.queryByText('View Invoice')).not.toBeInTheDocument()
  })

  it('shows "View Invoice" and no Pending Checkout badge once the invoice is issued', async () => {
    myQueueMock.mockResolvedValue(buildQueue(buildPrevious({ invoice_id: 99, pending_checkout: false })))
    renderPage()

    expect(await screen.findByText('Omar Hassan')).toBeInTheDocument()
    expect(screen.getByText('View Invoice')).toBeInTheDocument()
    expect(screen.queryByText('Pending Checkout')).not.toBeInTheDocument()
  })

  it('shows neither action nor badge for a free follow-up (no invoice, not pending checkout)', async () => {
    myQueueMock.mockResolvedValue(buildQueue(buildPrevious({ invoice_id: null, pending_checkout: false })))
    renderPage()

    expect(await screen.findByText('Omar Hassan')).toBeInTheDocument()
    expect(screen.queryByText('View Invoice')).not.toBeInTheDocument()
    expect(screen.queryByText('Pending Checkout')).not.toBeInTheDocument()
  })
})
