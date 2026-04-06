export function getLocalDateKey(date: Date = new Date()): string {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getUtcDateKey(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}
