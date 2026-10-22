export default function Forbidden() {
  return (
    <div className="mx-auto mt-10 max-w-lg rounded-lg border border-line bg-surface p-5">
      <h1 className="font-semibold">No access</h1>
      <p className="mt-1 text-sm text-muted">Your role does not include this page. The owner can change role permissions.</p>
    </div>
  )
}
