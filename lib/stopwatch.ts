/**
 * Step timings for one request, in whole milliseconds. `lap(name)` records the
 * time since the previous lap; `ms()` is every lap plus `total`. Used to see
 * where a sale spends its time (stored on its audit row, read by the
 * production check's timing run). Times only, never data.
 */
export function stopwatch() {
  const start = performance.now()
  let last = start
  const laps: Record<string, number> = {}
  return {
    lap(name: string) {
      const t = performance.now()
      laps[name] = (laps[name] ?? 0) + Math.round(t - last)
      last = t
    },
    ms(): Record<string, number> {
      return { ...laps, total: Math.round(performance.now() - start) }
    },
  }
}
export type Stopwatch = ReturnType<typeof stopwatch>
