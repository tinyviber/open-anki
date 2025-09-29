import { Plus, BookOpen, Clock } from "lucide-react";
import { DeckCard } from "@/components/DeckCard";
import { StatsCard } from "@/components/StatsCard";
import { Button } from "@/components/ui/button";
import { useDeckSummaries } from "@/hooks/useDeckSummaries"; 
import { useDashboardStats } from "@/hooks/useDashboardStats"; 
import { Card } from "@/components/ui/card";
import { NewDeckDialog } from "@/components/NewDeckDialog";
import { NewNoteDialog } from "@/components/NewNoteDialog";
import { Link } from 'react-router-dom';

// Dashboard component, based on the previous App.tsx content
export function Dashboard() {
  const decks = useDeckSummaries(); 
  const stats = useDashboardStats(); 

  const firstDeckId = decks && decks.length > 0 ? decks[0].id : undefined; 

  const isDeckLoading = decks === undefined;
  const isStatsLoading = stats === undefined;

  const DeckListContent = () => {
    if (isDeckLoading) {
      return (
        <Card className="col-span-full flex items-center justify-center h-48 animate-pulse">
            <p className="text-muted-foreground">正在从本地数据库加载卡片组...</p>
        </Card>
      );
    }

    if (decks.length === 0) {
      return (
        <div className="col-span-full">
            <Card className="text-muted-foreground flex flex-col items-center justify-center p-12 text-center border-dashed border-2">
                <p className="text-lg mb-4">
                    你还没有任何卡片组。
                </p>
                <NewDeckDialog>
                    <Button variant="default">
                        <Plus className="mr-2 h-4 w-4" />
                        创建新卡片组
                    </Button>
                </NewDeckDialog>
            </Card>
        </div>
      );
    }
    
    return decks.map((deck) => (
      <Link
        key={deck.id}
        to={`/decks/${deck.id}`}
        className="group block focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 rounded-xl"
      >
        <DeckCard {...deck} />
      </Link>
    ));
  }
  
  const StatCards = () => {
      if (isStatsLoading) {
           return Array(4).fill(0).map((_, index) => (
               <Card key={index} className="flex-1 animate-pulse p-4 h-32"></Card>
           ));
      }
      
      return stats.map((stat, index) => (
          <StatsCard
            key={index}
            title={stat.title}
            value={stat.value}
            icon={stat.icon}
            description={stat.description} // Pass description/trend to StatsCard
            trend={stat.trend}
          />
      ));
  }

  // Dashboard now assumes LayoutWrapper is handling Header and Sidebar
  return (
    <div className="space-y-8">
      {/* 欢迎区域 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            欢迎回来！
          </h1>
          <p className="text-muted-foreground text-base mt-1">
            继续你的学习之旅，今天也要加油哦 ✨
          </p>
        </div>
        {/* 绑定 NewDeckDialog */}
        <NewDeckDialog>
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            创建新卡片组
          </Button>
        </NewDeckDialog>
      </div>

      {/* 统计卡片区域 */}
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <StatCards />
      </div>

      {/* 卡片组区域 */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-semibold tracking-tight">
            我的卡片组
          </h2>
          <Link to="/decks" aria-label="查看全部卡片组">
              <Button variant="outline" size="sm">
                  查看全部
              </Button>
          </Link>
        </div>

        <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
          <DeckListContent /> 
        </div>
      </div>

      {/* 快速操作区域 */}
      <div className="space-y-4 pt-4">
        <h2 className="text-2xl font-semibold tracking-tight">
          快速开始
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 max-w-4xl">
          <Link to="/review">
              <Button
                variant="outline"
                className="h-24 flex-col space-y-2 border-dashed hover:bg-accent/70 w-full"
              >
                <BookOpen className="h-6 w-6" />
                <span className="font-medium text-base">开始学习</span>
              </Button>
          </Link>
          <Link to="/review?type=due">
              <Button
                variant="outline"
                className="h-24 flex-col space-y-2 border-dashed hover:bg-accent/70 w-full"
              >
                <Clock className="h-6 w-6" />
                <span className="font-medium text-base">复习卡片</span>
              </Button>
          </Link>
          <NewNoteDialog initialDeckId={firstDeckId}>
            <Button
              variant="outline"
              className="h-24 flex-col space-y-2 border-dashed hover:bg-accent/70 w-full"
            >
              <Plus className="h-6 w-6" />
              <span className="font-medium text-base">添加卡片</span>
            </Button>
          </NewNoteDialog> 
        </div>
      </div>
    </div>
  );
}