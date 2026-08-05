import { StatCard } from './StatCard'

export function KpiRow({ items }: { items: { label: string; value: number | string }[] }) {
  return (
    <div className="kpi-row">
      {items.map((item) => (
        <StatCard key={item.label} label={item.label} value={item.value} />
      ))}
    </div>
  )
}
