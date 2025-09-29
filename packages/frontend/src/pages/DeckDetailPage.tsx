import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, BookOpenCheck, ListChecks, Plus, RefreshCcw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { useDeckDetail, type DeckDetailData } from '@/hooks/useDeckDetail';
import { NewNoteDialog } from '@/components/NewNoteDialog';

const difficultyStyles: Record<string, string> = {
  easy: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-200 border-emerald-200 dark:border-emerald-800',
  medium: 'bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-200 border-amber-200 dark:border-amber-800',
  hard: 'bg-rose-100 text-rose-700 dark:bg-rose-500/10 dark:text-rose-200 border-rose-200 dark:border-rose-800',
  auto: 'bg-blue-100 text-blue-700 dark:bg-blue-500/10 dark:text-blue-200 border-blue-200 dark:border-blue-800',
};

const difficultyLabels: Record<string, string> = {
  easy: '简单',
  medium: '中等',
  hard: '困难',
  auto: '自动',
};

function StatItem({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={`mt-2 text-2xl font-semibold ${accent ? 'text-primary' : ''}`}>{value}</p>
    </div>
  );
}

function CardsTable({ cards }: { cards: DeckDetailData['cards'] }) {
  if (cards.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          该卡片组暂无卡片，请先添加。
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border">
      <table className="w-full text-left text-sm">
        <thead className="bg-muted/50">
          <tr>
            <th className="px-4 py-3 font-medium">正面</th>
            <th className="px-4 py-3 font-medium">背面</th>
            <th className="px-4 py-3 font-medium">状态</th>
            <th className="px-4 py-3 font-medium">到期</th>
            <th className="px-4 py-3 font-medium">标签</th>
          </tr>
        </thead>
        <tbody>
          {cards.slice(0, 50).map(card => (
            <tr key={card.id} className="border-t hover:bg-muted/40">
              <td className="px-4 py-3 max-w-xs truncate" title={card.front}>
                {card.front || '（无内容）'}
              </td>
              <td className="px-4 py-3 max-w-xs truncate" title={card.back}>
                {card.back || '（无内容）'}
              </td>
              <td className="px-4 py-3">
                <Badge variant="secondary">{card.state.toUpperCase()}</Badge>
              </td>
              <td className="px-4 py-3">
                <span className={card.due <= Date.now() ? 'text-destructive font-medium' : ''}>{card.dueLabel}</span>
              </td>
              <td className="px-4 py-3">
                {card.tags.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {card.tags.map(tag => (
                      <Badge key={tag} variant="outline" className="text-xs">
                        #{tag}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {cards.length > 50 && (
        <p className="px-4 py-3 text-xs text-muted-foreground">
          已显示前 50 张卡片，使用同步或搜索功能可查看更多。
        </p>
      )}
    </div>
  );
}

export function DeckDetailPage() {
  const { deckId } = useParams();
  const navigate = useNavigate();
  const detail = useDeckDetail(deckId);

  if (deckId === undefined) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" onClick={() => navigate(-1)} className="pl-0">
          <ArrowLeft className="mr-2 h-4 w-4" /> 返回
        </Button>
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            未提供卡片组 ID。
          </CardContent>
        </Card>
      </div>
    );
  }

  if (detail === undefined) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" onClick={() => navigate(-1)} className="pl-0">
          <ArrowLeft className="mr-2 h-4 w-4" /> 返回
        </Button>
        <Card className="animate-pulse">
          <CardHeader>
            <div className="h-6 w-40 rounded bg-muted" />
          </CardHeader>
          <CardContent className="space-y-4 pb-6">
            <div className="h-4 w-56 rounded bg-muted" />
            <div className="h-40 rounded bg-muted/60" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (detail === null) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" onClick={() => navigate(-1)} className="pl-0">
          <ArrowLeft className="mr-2 h-4 w-4" /> 返回
        </Button>
        <Card>
          <CardContent className="py-12 text-center">
            <h2 className="text-xl font-semibold">未找到卡片组</h2>
            <p className="mt-2 text-muted-foreground">该卡片组可能已删除或尚未同步。</p>
            <div className="mt-4 flex justify-center gap-2">
              <Button onClick={() => navigate('/decks')}>返回卡片组列表</Button>
              <Button variant="outline" onClick={() => navigate('/')}>回到仪表盘</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { deck, stats, lastStudied, cards } = detail;
  const difficultyKey = deck.config.difficulty || 'medium';
  const difficultyClass = difficultyStyles[difficultyKey] ?? difficultyStyles.medium;
  const difficultyLabel = difficultyLabels[difficultyKey] ?? difficultyLabels.medium;

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="space-y-2">
          <Button variant="ghost" onClick={() => navigate(-1)} className="h-auto px-0 text-muted-foreground">
            <ArrowLeft className="mr-2 h-4 w-4" /> 返回
          </Button>
          <h1 className="text-3xl font-bold tracking-tight">{deck.name}</h1>
          <p className="text-muted-foreground max-w-2xl">
            {deck.config.description || '该卡片组尚未添加描述。'}
          </p>
          <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <Badge variant="outline" className={difficultyClass}>
              难度：{difficultyLabel}
            </Badge>
            <span>共 {stats.total} 张卡片</span>
            {lastStudied && <span>上次学习 {lastStudied}</span>}
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Link to={`/review?deckId=${deck.id}`}>
            <Button className="w-full sm:w-auto">
              <BookOpenCheck className="mr-2 h-4 w-4" /> 开始复习
            </Button>
          </Link>
          <Button variant="outline" className="w-full sm:w-auto" onClick={() => navigate('/decks')}>
            <ListChecks className="mr-2 h-4 w-4" /> 查看全部卡组
          </Button>
          <NewNoteDialog initialDeckId={deck.id}>
            <Button variant="secondary" className="w-full sm:w-auto">
              <Plus className="mr-2 h-4 w-4" /> 添加卡片
            </Button>
          </NewNoteDialog>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>学习进度</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <div className="flex items-center justify-between text-sm">
              <span>已掌握卡片</span>
              <span className="font-medium text-primary">{stats.progress}%</span>
            </div>
            <Progress value={stats.progress} className="mt-2" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatItem label="待复习" value={`${stats.due}`} accent={stats.due > 0} />
            <StatItem label="新卡片" value={`${stats.new}`} />
            <StatItem label="学习中" value={`${stats.learning}`} />
            <StatItem label="复习中" value={`${stats.review}`} />
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-semibold">卡片列表</h2>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <RefreshCcw className="h-3 w-3" />
            实时从本地数据库读取，最多展示 50 张卡片。
          </div>
        </div>
        <CardsTable cards={cards} />
      </div>
    </div>
  );
}
