/** Toggles a body class so billing.css can isolate the invoice sheet, then prints. */
export function printInvoice() {
  document.body.classList.add('print-invoice')
  const cleanup = () => {
    document.body.classList.remove('print-invoice')
    window.removeEventListener('afterprint', cleanup)
  }
  window.addEventListener('afterprint', cleanup)
  window.print()
}
