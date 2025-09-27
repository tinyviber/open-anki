import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/core/db/db'
import { getStartOfDay } from '@/lib/dateUtils'
import { type LucideIcon, BookOpen, Clock, TrendingUp, Target } from "lucide-react";
import type { StatsCardProps } from '@/components/StatsCard'; // 复用 StatsCard 的属性类型

interface StatData extends Omit<StatsCardProps, 'icon'> {
    icon: LucideIcon;
}

const formatNumber = (n: number) => new Intl.NumberFormat().format(n);
const formatPercent = (p: number) => `${p.toFixed(0)}%`;
const ONE_DAY = 24 * 60 * 60 * 1000;

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

    // 掌握程度 (Mastery, simplistic): percentage of cards not in 'new' state.
    const notNewCards = allCards.filter(card => card.state !== 'new').length;
    const masteryPercentage = totalCards === 0 ? 0 : Math.round((notNewCards / totalCards) * 100);

    // --- Review Log Counts (Today's Study & Trend) ---
    const allLogs = await db.reviewLogs.toCollection().toArray(); // MVP: Fetch all logs
    
    const logsToday = allLogs.filter(log => log.timestamp >= todayStart);
    const logsYesterday = allLogs.filter(log => log.timestamp >= yesterdayStart && log.timestamp < todayStart);
    
    const studiedToday = logsToday.length;
    const studiedYesterday = logsYesterday.length;

    // --- Daily Trend Calculation ---
    let trend: { value: number; isPositive: boolean } | undefined;
    const diff = studiedToday - studiedYesterday;

    if (studiedYesterday === 0 && studiedToday === 0) {
        trend = { value: 0, isPositive: true }; // Neutral
    } else if (studiedYesterday === 0 && studiedToday > 0) {
        trend = { value: 100, isPositive: true }; // +100% is fine as placeholder
    } else {
        const percentageChange = Math.abs(diff / studiedYesterday) * 100;
        trend = { 
             value: Math.round(percentageChange) || 1, 
             isPositive: diff >= 0
        };
    }
    
    // --- Streak Calculation (Daily cut-off: midnight local time) ---
    const uniqueReviewDays = new Set<number>();
    allLogs.forEach(log => uniqueReviewDays.add(getStartOfDay(log.timestamp)));
    const sortedDays = Array.from(uniqueReviewDays).sort((a, b) => b - a); // Reverse sort (recent first)

    let currentStreak = 0;
    let expectedDayStart = getStartOfDay(now + 1); // Start search *after* today's logs were possible
    
    // Determine the expected day start, which should be the *last day's* 00:00:00
    expectedDayStart = getStartOfDay(now);
    
    if (!uniqueReviewDays.has(expectedDayStart)) {
      // If there's no activity today, check logs up to yesterday to count maintained streak
      expectedDayStart = getStartOfDay(now - ONE_DAY);
    }
    
    for (const day of sortedDays) {
        // Find the sequence of contiguous days starting from the most recent one.
        if (day === expectedDayStart) {
            currentStreak++;
            expectedDayStart -= ONE_DAY;
        } else {
             // Break the sequence
            break; 
        }
    }


    // --- Construct Final Stats Array ---
    const studyTrendValue = trend?.value ?? 0;
    const studyTrendPositive = trend?.isPositive ?? true;

    return [
      {
        title: "今日学习",
        value: formatNumber(studiedToday),
        description: `比昨天${studyTrendPositive ? '多' : '少'}学了 ${Math.abs(studiedToday - studiedYesterday)} 张`,
        icon: BookOpen,
        trend: { 
            value: studyTrendValue, 
            isPositive: studyTrendPositive 
        },
      },
      {
        title: "连续学习",
        value: `${currentStreak}天`,
        description: "保持良好习惯",
        icon: TrendingUp,
        trend: { 
            value: 8, 
            isPositive: true // Simplistic mock trend for streak
        }, 
      },
      {
        title: "待复习卡片",
        value: formatNumber(dueCardsToday),
        description: `建议今天完成`, // More realistic based on dueCardsToday calculation
        icon: Clock,
        // Since we cannot calculate yesterday's due cards, use mock data:
        trend: { value: 3, isPositive: false }, 
      },
      {
        title: "掌握程度",
        value: formatPercent(masteryPercentage),
        description: "整体进度良好",
        icon: Target,
        trend: { value: 5, isPositive: true },
      },
    ];
  }

  return useLiveQuery(query, [])
}