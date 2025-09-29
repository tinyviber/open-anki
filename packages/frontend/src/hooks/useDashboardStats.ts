import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/core/db/db'
import { getStartOfDay } from '@/lib/dateUtils'
import { type LucideIcon, BookOpen, Clock, TrendingUp, Target } from "lucide-react";
import type { StatsCardProps } from '@/components/StatsCard'; // 复用 StatsCard 的属性类型

interface StatData extends Omit<StatsCardProps, 'icon'> {
    icon: LucideIcon;
}

const formatNumber = (n: number) => new Intl.NumberFormat().format(n);
const formatPercent = (p: number) => `${Math.round(p)}%`;
const ONE_DAY = 24 * 60 * 60 * 1000;

interface TrendOptions {
  invert?: boolean;
}

function computeTrend(current: number, previous: number, options: TrendOptions = {}): { value: number; isPositive: boolean } {
  const { invert = false } = options
  const normalizedPrev = Number.isFinite(previous) ? previous : 0
  const normalizedCurrent = Number.isFinite(current) ? current : 0

  if (normalizedPrev === 0) {
    if (normalizedCurrent === 0) {
      return { value: 0, isPositive: true }
    }
    const isPositive = invert ? normalizedCurrent < normalizedPrev : normalizedCurrent > normalizedPrev
    return { value: 100, isPositive }
  }

  const delta = normalizedCurrent - normalizedPrev
  const direction = invert ? -delta : delta
  const change = Math.abs(delta / normalizedPrev) * 100
  const rounded = Math.round(change)
  const value = rounded === 0 && delta !== 0 ? 1 : rounded
  return {
    value,
    isPositive: direction >= 0,
  }
}

/**
 * Calculates dashboard statistics based on Card and ReviewLog tables.
 * Returns undefined while loading.
 */
export function useDashboardStats(): StatData[] | undefined {
  const query = async () => {
    const now = Date.now();
    const todayStart = getStartOfDay(now);
    const yesterdayStart = getStartOfDay(now - ONE_DAY);

    // --- Card Counts (Due Cards & Mastery) ---
    // 使用 toArray() 将整个集合拉到内存中进行过滤，以避免多重昂贵的 Dexie 交互
    const allCards = await db.cards.toCollection().toArray();
    const totalCards = allCards.length;

    // 待复习卡片 (Due Cards): state learning/review AND due time passed
    const dueCardsToday = allCards.filter(card =>
      (card.state === 'learning' || card.state === 'review') && card.due <= now
    ).length;
    const dueCardsYesterdaySnapshot = allCards.filter(card =>
      (card.state === 'learning' || card.state === 'review') && card.due <= now - ONE_DAY
    ).length;

    // 掌握程度 (Mastery, simplistic): percentage of cards not in 'new' state.
    const notNewCards = allCards.filter(card => card.state !== 'new').length;
    const masteryPercentage = totalCards === 0 ? 0 : (notNewCards / totalCards) * 100;

    // --- Review Log Counts (Today's Study & Trend) ---
    const allLogs = await db.reviewLogs.toCollection().toArray();

    const logsToday = allLogs.filter(log => log.timestamp >= todayStart);
    const logsYesterday = allLogs.filter(log => log.timestamp >= yesterdayStart && log.timestamp < todayStart);
    const logsTwoDaysAgo = allLogs.filter(log => log.timestamp >= yesterdayStart - ONE_DAY && log.timestamp < yesterdayStart);

    const studiedToday = logsToday.length;
    const studiedYesterday = logsYesterday.length;

    // --- Daily Trend Calculation ---
    const studyTrend = computeTrend(studiedToday, studiedYesterday);

    // --- Streak Calculation (Daily cut-off: midnight local time) ---
    const uniqueReviewDays = new Set<number>();
    allLogs.forEach(log => uniqueReviewDays.add(getStartOfDay(log.timestamp)));

    const computeStreak = (anchor: number) => {
      let streak = 0
      let cursor = anchor
      while (uniqueReviewDays.has(cursor)) {
        streak += 1
        cursor -= ONE_DAY
      }
      return streak
    }

    const todayAnchor = uniqueReviewDays.has(todayStart) ? todayStart : getStartOfDay(now - ONE_DAY)
    const currentStreak = computeStreak(todayAnchor)
    const previousStreak = computeStreak(todayAnchor - ONE_DAY)

    const streakTrend = computeTrend(currentStreak, previousStreak);

    // --- Due card trend (backlog change over last 24h) ---
    const dueTrend = computeTrend(dueCardsToday, dueCardsYesterdaySnapshot, { invert: true });

    // --- Mastery trend (success ratio of recent reviews) ---
    const masterySuccessRate = (logs: typeof allLogs) => {
      if (logs.length === 0) {
        return undefined
      }
      const successful = logs.filter(log => log.rating >= 3).length
      return (successful / logs.length) * 100
    }

    const masteryTodayRate = masterySuccessRate(logsToday);
    const masteryYesterdayRate = masterySuccessRate(logsYesterday);
    const masteryBaseline = masteryYesterdayRate ?? masterySuccessRate(logsTwoDaysAgo) ?? 0;
    const masteryCurrentRate = masteryTodayRate ?? 0;
    const masteryTrend =
      masteryTodayRate === undefined && masteryBaseline === 0
        ? { value: 0, isPositive: true }
        : computeTrend(masteryCurrentRate, masteryBaseline);

    return [
      {
        title: "今日学习",
        value: formatNumber(studiedToday),
        description: `比昨天${studyTrend.isPositive ? '多' : '少'}学了 ${Math.abs(studiedToday - studiedYesterday)} 张`,
        icon: BookOpen,
        trend: studyTrend,
      },
      {
        title: "连续学习",
        value: `${currentStreak}天`,
        description: currentStreak > 0 ? "保持良好习惯" : "今天还没有学习",
        icon: TrendingUp,
        trend: streakTrend,
      },
      {
        title: "待复习卡片",
        value: formatNumber(dueCardsToday),
        description: `建议今天完成`,
        icon: Clock,
        trend: dueTrend,
      },
      {
        title: "掌握程度",
        value: formatPercent(masteryPercentage),
        description: "整体进度良好",
        icon: Target,
        trend: masteryTrend,
      },
    ];
  }

  return useLiveQuery(query, [])
}