import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/core/db/db';
import { getStartOfDay } from '@/lib/dateUtils';

const ONE_DAY = 24 * 60 * 60 * 1000;

export interface DailyStudyStat {
  /** 当天（本地时区）零点的时间戳 */
  date: number;
  /** 当天学习的卡片数量（ReviewLog 条目数） */
  studied: number;
  /** 当天学习所花费的总时长（毫秒） */
  totalDurationMs: number;
  /** 各评分的数量统计 */
  ratings: Record<'again' | 'hard' | 'good' | 'easy', number>;
}

/**
 * 汇总最近 N 天的学习历史。默认返回最近 7 天（含今天）的数据。
 */
export function useStudyHistory(days = 7): DailyStudyStat[] | undefined {
  return useLiveQuery(async () => {
    const now = Date.now();
    const startDay = getStartOfDay(now - ONE_DAY * (days - 1));

    const logs = await db.reviewLogs
      .where('timestamp')
      .aboveOrEqual(startDay)
      .toArray();

    const buckets = new Map<number, DailyStudyStat>();

    for (let i = 0; i < days; i++) {
      const dayStart = startDay + i * ONE_DAY;
      buckets.set(dayStart, {
        date: dayStart,
        studied: 0,
        totalDurationMs: 0,
        ratings: { again: 0, hard: 0, good: 0, easy: 0 },
      });
    }

    for (const log of logs) {
      const dayStart = getStartOfDay(log.timestamp);
      const bucket = buckets.get(dayStart);
      if (!bucket) continue;

      bucket.studied += 1;
      bucket.totalDurationMs += log.durationMs ?? 0;

      switch (log.rating) {
        case 1:
          bucket.ratings.again += 1;
          break;
        case 2:
          bucket.ratings.hard += 1;
          break;
        case 3:
          bucket.ratings.good += 1;
          break;
        case 4:
          bucket.ratings.easy += 1;
          break;
        default:
          break;
      }
    }

    return Array.from(buckets.values()).sort((a, b) => a.date - b.date);
  }, [days]);
}
