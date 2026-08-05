export function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="kpi-card">
      <div className="kpi-card__value">{value}</div>
      <div className="kpi-card__label">{label}</div>
    </div>
  )
}
