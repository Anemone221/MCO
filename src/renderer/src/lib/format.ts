/** Format skill points as a compact human-readable string, e.g. 12_300_000 -> "12.3M SP". */
export function formatSp(sp: number): string {
  if (sp >= 1_000_000_000) return `${(sp / 1_000_000_000).toFixed(2)}B SP`;
  if (sp >= 1_000_000) return `${(sp / 1_000_000).toFixed(1)}M SP`;
  if (sp >= 1_000) return `${(sp / 1_000).toFixed(0)}k SP`;
  return `${sp} SP`;
}

/** Format an ISK balance compactly, e.g. 1_234_000_000 -> "1.23B ISK". */
export function formatIsk(isk: number): string {
  const abs = Math.abs(isk);
  const sign = isk < 0 ? '-' : '';
  if (abs >= 1_000_000_000_000) return `${sign}${(abs / 1_000_000_000_000).toFixed(2)}T ISK`;
  if (abs >= 1_000_000_000) return `${sign}${(abs / 1_000_000_000).toFixed(2)}B ISK`;
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M ISK`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(0)}k ISK`;
  return `${sign}${abs.toFixed(0)} ISK`;
}

/** Full ISK balance with thousands separators, e.g. "1,234,567,890 ISK". */
export function formatIskExact(isk: number): string {
  return `${isk.toLocaleString(undefined, { maximumFractionDigits: 0 })} ISK`;
}

/** Roman numeral for an EVE skill level (1-5). */
export function romanLevel(level: number): string {
  return ['0', 'I', 'II', 'III', 'IV', 'V'][level] ?? String(level);
}

/** Human-friendly absolute date, or "—" when absent. */
export function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
}

/** Relative time until an ISO timestamp, e.g. "in 3d 4h", or "done" if past. */
export function formatTimeUntil(iso: string | null): string {
  if (!iso) return '—';
  const target = new Date(iso).getTime();
  if (Number.isNaN(target)) return '—';
  const deltaMs = target - Date.now();
  if (deltaMs <= 0) return 'done';

  const minutes = Math.floor(deltaMs / 60_000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return `in ${days}d ${hours}h`;
  if (hours > 0) return `in ${hours}h ${mins}m`;
  return `in ${mins}m`;
}

/** Duration from a minute count, e.g. 20_340 -> "14d 3h", 192 -> "3h 12m". */
export function formatDuration(totalMinutes: number): string {
  if (!Number.isFinite(totalMinutes) || totalMinutes < 0) return '—';
  const minutes = Math.floor(totalMinutes);
  if (minutes < 1) return totalMinutes > 0 ? '<1m' : '0m';
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

/** Security status to one decimal, or "—" when unknown. */
export function formatSecurity(security: number | null): string {
  if (security === null) return '—';
  return security.toFixed(1);
}

/** EVE security tier for the given status, used for colour-coding. */
export function securityTier(security: number | null): 'high' | 'low' | 'null' | 'unknown' {
  if (security === null) return 'unknown';
  const rounded = Math.round(security * 10) / 10;
  if (rounded >= 0.5) return 'high';
  if (rounded >= 0.1) return 'low';
  return 'null';
}
