'use client'

/**
 * Grow pushes an amount to the terminal when its link is opened, and the
 * opened page must stay open until the payment ends. A browser only lets a
 * page open a tab from a tap, and the link exists only after the server has
 * created the sale and the charge. So the tap on "sell" opens an empty tab
 * here, and the sale page fills it with Grow's link when it arrives.
 * Module state survives the client-side redirect from checkout to the sale;
 * after a full reload it is gone and the sale page shows the manual button.
 */
let tab: Window | null = null

export function openTerminalTab(waitingText: string): void {
  // One named tab, reused sale after sale.
  tab = window.open('', 'grow-terminal')
  try {
    if (tab && tab.location.href === 'about:blank') {
      tab.document.title = 'Grow'
      tab.document.body.innerHTML = `<p dir="rtl" style="font:16px system-ui;padding:24px">${waitingText.replace(/[<>&]/g, '')}</p>`
    }
  } catch {
    // Still on the previous sale's Grow page (another origin): it is navigated when the new link arrives.
  }
}

/** Sends the waiting tab to Grow's link. False when there is no tab to send (a reload, a blocked popup). */
export function sendTerminalTab(url: string): boolean {
  const t = tab
  tab = null
  if (!t || t.closed) return false
  try {
    t.location.href = url
    return true
  } catch {
    return false
  }
}

export function closeTerminalTab(): void {
  try {
    if (tab && !tab.closed) tab.close()
  } catch {
    /* already gone */
  }
  tab = null
}
