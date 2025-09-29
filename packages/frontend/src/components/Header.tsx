import { Search, Settings, User, Moon, Sun, RefreshCw, AlertTriangle, LogOut } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { useState, useEffect, useRef } from "react";
import { useSync } from "@/hooks/useSyncEngine";
import { formatRelativeTime } from "@/lib/dateUtils";
import { useAuth } from "@/hooks/useAuth";

export function Header() {
  const [darkMode, setDarkMode] = useState(() => document.documentElement.classList.contains('dark'));
  const { sync, isSyncing, lastSyncedAt, error, status } = useSync();
  const { user, signOut } = useAuth();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const handleSignOut = async () => {
    setSignOutError(null);
    try {
      sessionStorage.setItem('authRedirectMessage', '您已退出登录。');
      await signOut();
    } catch (err) {
      sessionStorage.removeItem('authRedirectMessage');
      const message = err instanceof Error ? err.message : '退出登录失败，请稍后重试。';
      setSignOutError(message);
    } finally {
      setIsMenuOpen(false);
    }
  };

  const userEmail = user?.email ?? '未登录用户';

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
          <div className="relative" ref={menuRef}>
            <Button
              variant="ghost"
              size="sm"
              className="flex items-center gap-2"
              onClick={() => { setIsMenuOpen((prev) => !prev); }}
              aria-haspopup="menu"
              aria-expanded={isMenuOpen}
            >
              <User className="h-4 w-4" />
              <span className="hidden sm:inline-flex text-sm">{userEmail}</span>
            </Button>
            {isMenuOpen ? (
              <div
                className="absolute right-0 mt-2 w-52 rounded-md border bg-popover p-2 text-sm shadow-md"
                role="menu"
                aria-label="用户菜单"
              >
                <div className="px-2 py-1 text-xs text-muted-foreground">已登录为</div>
                <div className="px-2 pb-2 text-sm font-medium break-words">{userEmail}</div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start gap-2"
                  onClick={handleSignOut}
                  role="menuitem"
                >
                  <LogOut className="h-4 w-4" />
                  退出登录
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
      {signOutError ? (
        <div className="border-t border-destructive/20 bg-destructive/10 px-4 py-2 text-center text-xs text-destructive" role="alert">
          {signOutError}
        </div>
      ) : null}
    </header>
  );
}
