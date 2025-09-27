/**
 * Date utility functions for client-side calculations, based on local timezone.
 * 注: 为了简化 MVP，所有日期计算都使用本地时区的午夜 (00:00:00) 作为一天的开始，而不是 Anki 典型的 4am 界限。
 */

/**
 * Returns the Unix timestamp of the start of the given date (midnight, 00:00:00) in local time.
 * @param date - Date object or timestamp. Defaults to now.
 */
export function getStartOfDay(date: Date | number = Date.now()): number {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}