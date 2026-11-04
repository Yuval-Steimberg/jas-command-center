/** The remembered place if it is still one of theirs; otherwise the first they schedule, otherwise the first they see. */
export function pickLocation<T extends { id: string; access?: 'schedule' | 'view' }>(mine: T[], preferred: string | null): T | undefined {
  return mine.find((l) => l.id === preferred) ?? mine.find((l) => l.access !== 'view') ?? mine[0]
}
