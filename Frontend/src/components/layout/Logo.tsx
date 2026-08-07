// The "Nabda" brand mark — a pre-built vector SVG (EKG pulse + "abda"
// wordmark in real letter paths, blue-to-teal gradient) served as a static
// asset so its raw SVG markup never has to round-trip through JSX attribute
// casing. Used identically on every shell (patient sidebar, and the shared
// Doctor/Secretary/Manager/Account header).
export function Logo({ className = 'h-8' }: { className?: string }) {
  return <img src="/NabdaLogo.svg" alt="Nabda" className={className} />
}
