// datetime-local has minute precision. Parse as local wall time, never as UTC.
// Reject normalized calendar/DST-gap values rather than silently shifting them.
export function localMinute(value: string, end = false): string {
  if (!value) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error("Informe datas e horários válidos.");
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  const date = new Date(value);
  if (
    !Number.isFinite(+date) ||
    date.getFullYear() !== year ||
    date.getMonth() + 1 !== month ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute
  )
    throw new Error("Informe datas e horários válidos no seu horário local.");
  if (end) date.setSeconds(59, 999);
  return date.toISOString();
}
