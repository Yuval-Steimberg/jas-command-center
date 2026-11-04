import { currentScheduler } from '@/lib/schedule/store'
import { env } from '@/lib/env'
import { ScheduleChat } from './chat'

export const dynamic = 'force-dynamic'

export default async function ScheduleAssistantPage() {
  const s = await currentScheduler()
  if ('error' in s) return null
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold text-ink">עוזר שיבוץ</h1>
        <p className="text-sm text-muted">שואלים במילים, והוא עונה מהלוח עצמו. כל שינוי שהוא מציע מחכה לאישור שלך, ורק אז מתבצע.</p>
      </div>
      {env().assistant.apiKey ? <ScheduleChat /> : <p className="rounded-lg border border-line bg-surface p-4 text-sm text-muted">העוזר עוד לא מחובר: יש להגדיר ANTHROPIC_API_KEY בפרויקט של מערכת הניהול ב-Vercel. הלוח עצמו עובד גם בלעדיו.</p>}
    </div>
  )
}
