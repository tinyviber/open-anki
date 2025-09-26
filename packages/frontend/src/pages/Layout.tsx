import { type ReactNode } from 'react'

// 假设我们有一个 Shadcn 的 SideBar 组件和 Header 组件
// 目前先用简单的 div 占位，等待下一步安装 UI 组件
const Header = () => (
  <header className="flex items-center justify-between p-4 border-b border-border bg-card">
    <h1 className="text-xl font-bold">Open Anki</h1>
    <div className="flex items-center space-x-4">
      {/* 搜索框、同步状态、用户菜单 */}
      <button>Sync</button>
      <button>User</button>
    </div>
  </header>
)

const Sidebar = () => (
  <nav className="w-64 border-r border-border p-4 h-full bg-sidebar flex flex-col space-y-2">
    <h2 className="text-lg font-semibold text-sidebar-foreground">Decks</h2>
    {/* 菜单项占位 */}
    <a href="/" className="text-sidebar-primary-foreground">Dashboard</a>
    <a href="/review" className="text-sidebar-foreground">Start Review</a>
    <a href="/notes" className="text-sidebar-foreground">Notes/Templates</a>
    <a href="/stats" className="text-sidebar-foreground">Stats</a>
  </nav>
)

interface LayoutProps {
  children: ReactNode
}

export function AppLayout({ children }: LayoutProps) {
  return (
    <div className="flex flex-col min-h-screen">
      <Header />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 p-8 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  )
}