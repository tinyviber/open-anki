import { Search, Settings, User, Moon, Sun, RefreshCw, AlertTriangle } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { useState, useEffect } from "react";
import { useSync } from "@/hooks/useSyncEngine";
import { formatRelativeTime } from "@/lib/dateUtils";

export function Header() {
  const [darkMode, setDarkMode] = useState(() => document.documentElement.classList.contains('dark'));
  const { sync, isSyncing, lastSyncedAt, error, status } = useSync();

  const toggleDarkMode = () => {
    const newDarkMode = !darkMode;
    setDarkMode(newDarkMode);
    document.documentElement.classList.toggle('dark', newDarkMode);
    localStorage.setItem('theme', newDarkMode ? 'dark' : 'light');
  };

  useEffect(() => {
    // 首次加载时读取 localStorage
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme) {
      const isDark = savedTheme === 'dark';
      setDarkMode(isDark);
      document.documentElement.classList.toggle('dark', isDark);
    }
  }, []);

  return (
    <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 fixed top-0 w-full z-50">
      <div className="container flex h-14 items-center px-4">
        <div className="flex items-center space-x-4">
          <h1 className="font-semibold tracking-tight text-xl">Open Anki</h1>
        </div>
        
        <div className="flex flex-1 items-center space-x-4 ml-8">
          <div className="relative w-64">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="搜索卡片组..."
              className="pl-8"
            />
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { void sync(); }}
            disabled={isSyncing}
            aria-live="polite"
          >
            <RefreshCw className={`h-4 w-4 ${isSyncing ? 'animate-spin' : ''}`} />
            <span className="sr-only">立即同步</span>
          </Button>
          <div className="flex flex-col items-start leading-tight">
            <span className="text-xs text-muted-foreground">
              {lastSyncedAt
                ? `上次同步 ${formatRelativeTime(lastSyncedAt) ?? '刚刚'}`
                : status === 'syncing'
                  ? '正在同步…'
                  : '尚未同步'}
            </span>
            {error ? (
              <span className="text-xs text-destructive flex items-center gap-1" title={error}>
                <AlertTriangle className="h-3 w-3" />
                同步失败
              </span>
            ) : null}
          </div>
          <Button variant="ghost" size="sm" onClick={toggleDarkMode}>
            {darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            <span className="sr-only">Toggle theme</span>
          </Button>
          <Button variant="ghost" size="sm">
            <Settings className="h-4 w-4" />
            <span className="sr-only">Settings</span>
          </Button>
          <Button variant="ghost" size="sm">
            <User className="h-4 w-4" />
            <span className="sr-only">User Profile</span>
          </Button>
        </div>
      </div>
    </header>
  );
}
