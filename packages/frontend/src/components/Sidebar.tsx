import { Home, BarChart3, Settings, Plus, Library } from "lucide-react";
import { Button } from "./ui/button";
import { NewDeckDialog } from "./NewDeckDialog"; 
import { Link, useLocation } from "react-router-dom"; // 引入 Link 和 useLocation

const menuItems = [
  { icon: Home, label: "首页", href: "/" },
  { icon: Library, label: "卡片组", href: "/decks" },
  { icon: BarChart3, label: "统计", href: "/stats" },
];

// Sidebar现在是独立组件，通过 useLocation 来确定当前活跃的 Link
export function Sidebar() {
  const location = useLocation();

  return (
    <div className="w-64 border-r bg-sidebar/95 backdrop-blur h-[calc(100vh-3.5rem)] sticky top-14 hidden lg:flex">
      <div className="flex h-full flex-col">
        <div className="p-4">
          {/* 绑定 NewDeckDialog */}
          <NewDeckDialog>
            <Button className="w-full">
              <Plus className="mr-2 h-4 w-4" />
              新建卡片组
            </Button>
          </NewDeckDialog>
        </div>
        
        <nav className="flex-1 space-y-1 p-2">
          {menuItems.map((item, index) => {
            const isActive = location.pathname === item.href;

            return (
              // 使用 Link 组件进行客户端路由跳转
              <Button
                key={index}
                variant={isActive ? "secondary" : "ghost"}
                className="w-full justify-start"
                asChild
              >
                <Link to={item.href}> 
                  <item.icon className="mr-2 h-4 w-4" />
                  {item.label}
                </Link>
              </Button>
            )
          })}
          {/* 独立的 Settings 链接 */}
          <Button
            key="settings"
            variant={location.pathname === "/settings" ? "secondary" : "ghost"}
            className="w-full justify-start"
            asChild
          >
              <Link to="/settings"> 
                <Settings className="mr-2 h-4 w-4" />
                设置
              </Link>
          </Button>
        </nav>

        {/* 侧边栏底部进度信息 */}
        <div className="p-4 border-t border-border">
          <div className="space-y-2">
            <div className="text-sm text-muted-foreground">学习概览</div>
            <div className="space-y-1">
              <div className="flex justify-between text-sm">
                <span>今日已学</span>
                <span className="font-semibold text-primary">23</span>
              </div>
              <div className="flex justify-between text-sm">
                <span>待复习</span>
                <span className="font-semibold text-orange-500">156</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
