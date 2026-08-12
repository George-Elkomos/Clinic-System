export function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-4">
      <div className="text-2xl font-extrabold" style={{ color: 'var(--brand-teal-start)' }}>{value}</div>
      <div className="patient-text-body-secondary mt-0.5" style={{ color: 'var(--text-secondary)' }}>{label}</div>
    </div>
  )
}
