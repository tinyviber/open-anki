import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { ArrowUp, ArrowDown, type LucideIcon } from "lucide-react";

export interface StatsCardProps {
  title: string;
  value: string | number;
  description?: string;
  icon: LucideIcon;
  trend?: {
    value: number;
    isPositive: boolean;
  };
}

// 采用 Card 组合组件模式
export function StatsCard({ title, value, description, icon: Icon, trend }: StatsCardProps) {
  const TrendIcon = trend?.isPositive ? ArrowUp : ArrowDown;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent className="pt-0">
        <div className="text-3xl font-bold">{value}</div>
        <div className="flex items-center space-x-2 text-xs pt-1">
          {trend && (
            <span className={trend.isPositive ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}>
              <TrendIcon className="inline-block h-3 w-3 align-text-top mr-0.5" />
              {trend.isPositive ? "+" : ""}{trend.value}%
            </span>
          )}
          {description && <span className="text-muted-foreground">{description}</span>}
        </div>
      </CardContent>
    </Card>
  );
}
