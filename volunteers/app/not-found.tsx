import { Empty, Page } from '@/components/ui'

export default function NotFound() {
  return <Page><div className="mt-10"><Empty title="הדף לא נמצא" href="/activities" cta="לפעילויות">יכול להיות שהפעילות הוסרה או שהקישור לא שלם.</Empty></div></Page>
}
