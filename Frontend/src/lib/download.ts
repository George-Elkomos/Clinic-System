// Helpers for authenticated blob downloads (token rides the Axios call, then we
// hand the resulting blob to the browser).

export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export function openBlob(blob: Blob) {
  const url = URL.createObjectURL(blob)
  window.open(url, '_blank', 'noopener')
  // Revoke a bit later so the new tab has time to load it.
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
