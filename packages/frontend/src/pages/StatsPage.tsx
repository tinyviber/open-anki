import { Fragment } from 'react';
import { StatsCard } from '@/components/StatsCard';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { useDashboardStats } from '@/hooks/useDashboardStats';
import { useDeckSummaries } from '@/hooks/useDeckSummaries';
import { useStudyHistory } from '@/hooks/useStudyHistory';
import { formatDayLabel, formatDuration } from '@/lib/dateUtils';

function buildEmptyRatingTotals() {
  return { again: 0, hard: 0, good: 0, easy: 0 } as const;
}

const ratingMeta: Record<keyof ReturnType<typeof buildEmptyRatingTotals>, { label: string; color: string }> = {
  again: { label: '重新学习', color: 'bg-destructive/10 text-destructive' },
  hard: { label: '困难', color: 'bg-amber-100 text-amber-800 dark:bg-amber-500/10 dark:text-amber-200' },
  good: { label: '良好', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-200' },
  easy: { label: '简单', color: 'bg-blue-100 text-blue-700 dark:bg-blue-500/10 dark:text-blue-200' },
};

function DashboardStatsSection() {
  const stats = useDashboardStats();

  if (!stats) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className="h-32 rounded-xl border bg-muted/40 animate-pulse"
          />
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {stats.map(stat => (
        <StatsCard key={stat.title} {...stat} />
      ))}
    </div>
  );
}

function StudyHistorySection() {
  const history = useStudyHistory(7);
  const stats = useDashboardStats();

  if (!history) {
    return (
      <Card className="animate-pulse">
        <CardHeader>
          <CardTitle className="w-40 h-6 bg-muted rounded" />
          <CardDescription className="w-56 h-4 bg-muted/60 rounded" />
        </CardHeader>
        <CardContent className="grid grid-cols-7 gap-3 pb-6">
          {Array.from({ length: 7 }).map((_, idx) => (
            <div key={idx} className="flex flex-col items-center space-y-2">
              <div className="h-32 w-full rounded bg-muted" />
              <div className="h-4 w-12 rounded bg-muted/70" />
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  const totalStudied = history.reduce((acc, day) => acc + day.studied, 0);
  const totalDuration = history.reduce((acc, day) => acc + day.totalDurationMs, 0);
  const maxStudied = Math.max(1, ...history.map(day => day.studied));

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>最近 7 天复习趋势</CardTitle>
        <CardDescription>
          累计复习 {totalStudied} 张卡片，用时约 {formatDuration(totalDuration)}
          ，与仪表盘统计实时同步。
        </CardDescription>
      </CardHeader>
      <CardContent className="pb-6">
        <div className="grid grid-cols-7 gap-3">
          {history.map(day => {
            const height = `${Math.round((day.studied / maxStudied) * 100)}%`;
            return (
              <div key={day.date} className="flex flex-col items-center space-y-2">
                <div className="h-32 w-full rounded-xl bg-muted/50 relative overflow-hidden">
                  <div
                    className="absolute bottom-0 left-0 right-0 rounded-t-xl bg-primary"
                    style={{ height }}
                  />
                </div>
                <span className="text-xs font-medium">{day.studied}</span>
                <span className="text-[11px] text-muted-foreground">
                  {formatDayLabel(day.date)}
                </span>
              </div>
            );
          })}
        </div>
        {stats && (
          <p className="mt-4 text-xs text-muted-foreground">
            今日目标：{stats[0]?.value ?? '—'} 张；连续打卡 {stats[1]?.value ?? '—'}。
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function RatingDistributionSection() {
  const history = useStudyHistory(14);

  if (!history) {
    return (
      <Card className="animate-pulse">
        <CardHeader>
          <CardTitle className="w-32 h-6 bg-muted rounded" />
        </CardHeader>
        <CardContent className="space-y-3 pb-6">
          {Array.from({ length: 4 }).map((_, idx) => (
            <div key={idx} className="h-10 rounded-lg bg-muted" />
          ))}
        </CardContent>
      </Card>
    );
  }

  const totals = history.reduce((acc, day) => {
    acc.again += day.ratings.again;
    acc.hard += day.ratings.hard;
    acc.good += day.ratings.good;
    acc.easy += day.ratings.easy;
    return acc;
  }, { ...buildEmptyRatingTotals() });

  const totalCount = Object.values(totals).reduce((sum, value) => sum + value, 0) || 1;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>评分分布</CardTitle>
        <CardDescription>最近 14 天所有复习反馈的比例</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 pb-6">
        {Object.entries(totals).map(([key, value]) => {
          const meta = ratingMeta[key as keyof typeof ratingMeta];
          const percentage = Math.round((value / totalCount) * 100);
          return (
            <Fragment key={key}>
              <div className="flex items-center justify-between text-sm">
                <Badge className={meta.color} variant="outline">
                  {meta.label}
                </Badge>
                <span className="font-semibold">{value} 张</span>
              </div>
              <div className="h-2 w-full rounded-full bg-muted/60 overflow-hidden">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${percentage}%` }}
                />
              </div>
            </Fragment>
          );
        })}
      </CardContent>
    </Card>
  );
}

function DeckHighlightsSection() {
  const decks = useDeckSummaries();

  if (!decks) {
    return (
      <Card className="animate-pulse">
        <CardHeader>
          <CardTitle className="w-36 h-6 bg-muted rounded" />
        </CardHeader>
        <CardContent className="space-y-3 pb-6">
          {Array.from({ length: 3 }).map((_, idx) => (
            <div key={idx} className="h-16 rounded-lg bg-muted" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (decks.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>卡片组亮点</CardTitle>
          <CardDescription>创建你的第一个卡片组以查看统计</CardDescription>
        </CardHeader>
        <CardContent className="pb-6">
          <p className="text-sm text-muted-foreground">
            当前没有卡片组，前往仪表盘或卡片组页面创建一个吧。
          </p>
        </CardContent>
      </Card>
    );
  }

  const sorted = [...decks].sort((a, b) => b.dueCards - a.dueCards).slice(0, 4);

  return (
    <Card>
      <CardHeader>
        <CardTitle>卡片组亮点</CardTitle>
        <CardDescription>根据待复习数量排序，帮助你迅速定位重点</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 pb-6">
        {sorted.map(deck => (
          <div key={deck.id} className="flex items-center justify-between rounded-lg border px-4 py-3">
            <div>
              <p className="font-medium">{deck.title}</p>
              <p className="text-xs text-muted-foreground">
                已学习 {deck.progress}% · 待复习 {deck.dueCards} 张
              </p>
            </div>
            <Badge variant="secondary">难度：{deck.difficulty}</Badge>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function StatsPage() {
  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">学习统计</h1>
        <p className="text-muted-foreground">
          查看最近的学习节奏、评分反馈以及需要重点复习的卡片组，帮助你更有效地规划学习。
        </p>
      </header>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold">核心指标</h2>
        <DashboardStatsSection />
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <StudyHistorySection />
        <RatingDistributionSection />
      </section>

      <section>
        <DeckHighlightsSection />
      </section>
    </div>
  );
}
