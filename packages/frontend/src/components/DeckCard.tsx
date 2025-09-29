import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "./ui/card";
import { Badge } from "./ui/badge";
import { Progress } from "./ui/progress";
import { Clock, BookOpen } from "lucide-react";

// 需要使用之前实现的 Card, Badge, Progress

export interface DeckCardProps {
  title: string;
  description: string;
  totalCards: number;
  dueCards: number;
  progress: number;
  lastStudied?: string;
  difficulty: "easy" | "medium" | "hard";
}

export function DeckCard({
  title,
  description,
  totalCards,
  dueCards,
  progress,
  lastStudied,
  difficulty
}: DeckCardProps) {
  const difficultyColors = {
    easy: "bg-green-100 text-green-800 dark:bg-green-700 dark:text-green-200 border-green-200 dark:border-green-800",
    medium: "bg-yellow-100 text-yellow-800 dark:bg-yellow-700 dark:text-yellow-200 border-yellow-200 dark:border-yellow-800",
    hard: "bg-red-100 text-red-800 dark:bg-red-700 dark:text-red-200 border-red-200 dark:border-red-800"
  };

  const difficultyLabels = {
    easy: "简单",
    medium: "中等", 
    hard: "困难"
  };

  return (
    <Card className="flex h-full cursor-pointer flex-col transition-all hover:border-primary hover:shadow-lg">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <CardTitle className="text-lg">{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
          <Badge variant="outline" className={difficultyColors[difficulty]}>
            {difficultyLabels[difficulty]}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4 pt-2">
        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center space-x-1 text-muted-foreground">
            <BookOpen className="h-4 w-4" />
            <span>总卡片: {totalCards}</span>
          </div>
          <div className={`flex items-center space-x-1 ${dueCards > 0 ? 'text-destructive' : 'text-primary'}`}>
            <Clock className="h-4 w-4" />
            <span className="font-semibold">{dueCards} 待复习</span>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span>学习进度</span>
            <span className="font-medium text-primary-foreground">{progress}%</span>
          </div>
          <Progress value={progress} className="h-2" />
        </div>

        <div className="flex min-h-[1.5rem] items-center pt-1 text-xs text-muted-foreground">
          <Clock className="mr-1 h-3 w-3 opacity-70" />
          {lastStudied ? (
            <span>上次学习: {lastStudied}</span>
          ) : (
            <span>尚未开始学习</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
