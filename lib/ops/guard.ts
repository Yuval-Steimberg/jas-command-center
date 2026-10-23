import 'server-only'
import { OpsSetupError } from './store'

/** Pages: load the module's rows, or the reason they cannot be shown (0003 not run, database error). */
export async function loadOps<T>(load: () => Promise<T>): Promise<{ ok: true; data: T } | { ok: false; message: string }> {
  try {
    return { ok: true, data: await load() }
  } catch (e) {
    if (e instanceof OpsSetupError) return { ok: false, message: e.message }
    console.error('ops read failed', e)
    return { ok: false, message: `The command center database could not be read: ${e instanceof Error ? e.message : String(e)}` }
  }
}
