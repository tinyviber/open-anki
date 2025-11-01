import { Header } from '@/components/Header'
import { Sidebar } from '@/components/Sidebar'
import { Outlet } from 'react-router-dom'

// 统一的页面布局，包含 Header 和 Sidebar
export function LayoutWrapper() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* 1. FIXED HEADER：固定在顶层 */}
      <Header /> 

      {/* 2. HEADER SPACER：弥补固定 Header 腾出的空间（高度 h-14 / 3.5rem） */}
      <div className="h-14 flex-shrink-0" /> 

      <div className="flex w-full">
        {/* 侧边栏 sticky top-14，占据垂直空间 */}
        <Sidebar />

        <main className="flex-1 p-6 md:p-8 w-full max-w-full">
          <Outlet /> {/* Renders the current route's element */}
        </main>
      </div>
    </div>
  );
}