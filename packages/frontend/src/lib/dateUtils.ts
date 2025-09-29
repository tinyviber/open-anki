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

/**
 * 将时间戳格式化为「MM/DD」或「今天」等简短标签，方便在统计图中展示。
 */
export function formatDayLabel(timestamp: number): string {
  const target = new Date(timestamp);
  const todayStart = getStartOfDay();
  const diff = todayStart - getStartOfDay(target);

  if (diff === 0) {
    return '今天';
  }
  if (diff === 24 * 60 * 60 * 1000) {
    return '昨天';
  }

  const month = target.getMonth() + 1;
  const day = target.getDate();
  return `${month}/${day}`;
}

/**
 * 将毫秒时长格式化为更易读的字符串，例如 90_000 => "1分30秒"。
 */
export function formatDuration(ms: number): string {
  if (ms <= 0) return '0秒';

  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes === 0) {
    return `${seconds}秒`;
  }

  if (seconds === 0) {
    return `${minutes}分`;
  }

  return `${minutes}分${seconds}秒`;
}

/**
 * Formats a timestamp relative to "now", returning a short human readable string.
 * Handles both past and future timestamps.
 */
export function formatRelativeTime(
  timestamp: number | undefined,
  { now = Date.now() }: { now?: number } = {},
): string | undefined {
  if (!timestamp) return undefined;

  const diff = now - timestamp;
  const absDiff = Math.abs(diff);

  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const week = 7 * day;

  const format = (value: number, unit: string, isPast: boolean) =>
    `${value}${unit}${isPast ? '前' : '后'}`;

  if (absDiff < 30 * 1000) {
    return diff >= 0 ? '刚刚' : '马上';
  }

  if (absDiff < minute) {
    return format(Math.max(1, Math.round(absDiff / 1000)), '秒', diff >= 0);
  }

  if (absDiff < hour) {
    return format(Math.max(1, Math.round(absDiff / minute)), '分钟', diff >= 0);
  }

  if (absDiff < day) {
    return format(Math.max(1, Math.round(absDiff / hour)), '小时', diff >= 0);
  }

  if (absDiff < week) {
    return format(Math.max(1, Math.round(absDiff / day)), '天', diff >= 0);
  }

  const weeks = Math.round(absDiff / week);
  if (weeks <= 4) {
    return format(Math.max(1, weeks), '周', diff >= 0);
  }

  const target = new Date(timestamp);
  return `${target.getFullYear()}-${target.getMonth() + 1}-${target.getDate()}`;
}