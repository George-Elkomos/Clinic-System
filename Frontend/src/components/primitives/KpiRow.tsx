import { StatCard } from './StatCard'

export function KpiRow({ items }: { items: { label: string; value: number | string }[] }) {
  return (
    <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {items.map((item) => (
        <StatCard key={item.label} label={item.label} value={item.value} />
      ))}
    </div>
  )
}
