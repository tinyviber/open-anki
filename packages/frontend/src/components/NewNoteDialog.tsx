import * as React from "react"
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger, 
  DialogFooter 
} from "./ui/dialog" 
import { Button } from "./ui/button"
import { Textarea } from "./ui/textarea"
import { createNoteAndCards } from "@/core/db/noteActions";
import { Plus } from "lucide-react";
import { db } from "@/core/db/db";
import { useLiveQuery } from "dexie-react-hooks";
import { Label } from "./ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select"; // 引入 Select


export function NewNoteDialog({ children, initialDeckId }: { children: React.ReactNode, initialDeckId?: string }) {
  // 从数据库获取所有卡片组
  const liveDecks = useLiveQuery(() => db.decks.toArray(), []);
  const allDecks = React.useMemo(() => liveDecks || [], [liveDecks]);
  const [open, setOpen] = React.useState(false);
  
  // 选定卡组ID
  const [selectedDeckId, setSelectedDeckId] = React.useState<string | null>(initialDeckId || allDecks[0]?.id || null);
  
  React.useEffect(() => {
    // 自动选中第一个或指定的初始卡组
    if (allDecks.length > 0 && (!selectedDeckId || !allDecks.some(d => d.id === selectedDeckId))) {
      setSelectedDeckId(initialDeckId || allDecks[0].id);
    }
  }, [allDecks, initialDeckId, selectedDeckId]);


  const [frontField, setFrontField] = React.useState('');
  const [backField, setBackField] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const resetState = () => {
    setFrontField('');
    setBackField('');
    setError(null);
  };
  
  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (isOpen) {
        // 确保打开时至少有一个卡组被选中
        if (allDecks.length > 0 && !selectedDeckId) {
             setSelectedDeckId(allDecks[0].id);
        }
    } else {
      resetState(); 
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const front = frontField.trim();
    const back = backField.trim();
    
    if (allDecks.length === 0 || !selectedDeckId) {
        setError("没有可用的卡片组。");
        return;
    }
    
    // Anki 允许任一字段为空，但不允许两者都空
    if (!front && !back) {
        setError("正面和背面内容不能同时为空。");
        return;
    }

    setLoading(true);
    setError(null);
    try {
        await createNoteAndCards({
            deckId: selectedDeckId,
            fields: { "正面": front, "背面": back }
        });
        
        // 成功后关闭对话框
        setOpen(false); 

    } catch (err) {
        const errorMessage = (err instanceof Error) ? err.message : "未知错误";
        console.error("Failed to create note/cards:", err);
        setError(`创建失败: ${errorMessage}`);
    } finally {
        setLoading(false);
    }
  };

  const currentDeckName = allDecks.find(d => d.id === selectedDeckId)?.name || '未选定';

  // 渲染 Loading / Disabled 触发器
  if (!allDecks || allDecks.length === 0 && !loading && open === false) {
      return children as React.ReactElement; 
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{children}</DialogTrigger> 
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>添加新卡片</DialogTitle>
          <DialogDescription>
            为 [{currentDeckName}] 创建新笔记（类型：基本卡片）。
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            
            {/* Deck Selection (UX 优化 2: 切换卡组) */}
            <div className="grid grid-cols-5 items-center gap-4">
                <Label htmlFor="selectDeck" className="text-right col-span-2">卡片组</Label>
                <div className="col-span-3">
                   {allDecks.length > 0 ? (
                       <Select 
                          value={selectedDeckId || ''} 
                          onValueChange={setSelectedDeckId}
                          disabled={allDecks.length === 0} 
                        >
                            <SelectTrigger className="w-full">
                                <SelectValue placeholder="选择卡片组" />
                            </SelectTrigger>
                            <SelectContent>
                               {allDecks.map(deck => (
                                 <SelectItem key={deck.id} value={deck.id}>{deck.name}</SelectItem>
                               ))}
                            </SelectContent>
                        </Select>
                   ) : (
                      <p className="text-sm text-muted-foreground pt-2">加载中...</p>
                   )}
                </div>
            </div>
            
            {/* Field: 正面 */}
            <div className="grid grid-cols-5 items-start gap-4">
              <Label htmlFor="frontField" className="text-right col-span-2 pt-2">
                正面 
              </Label>
              <Textarea
                id="frontField"
                value={frontField}
                onChange={(e) => setFrontField(e.target.value)}
                className="col-span-3 min-h-[100px]"
                placeholder="例如：日语单词 ‘ありがとう’"
                aria-invalid={!!error}
              />
            </div>
            
            {/* Field: 背面 */}
            <div className="grid grid-cols-5 items-start gap-4">
              <Label htmlFor="backField" className="text-right col-span-2 pt-2">
                背面 
              </Label>
              <Textarea
                id="backField"
                value={backField}
                onChange={(e) => setBackField(e.target.value)}
                className="col-span-3 min-h-[100px]"
                placeholder="例如：意思 ‘谢谢’"
              />
            </div>

            {error && <p className="text-sm text-destructive col-span-full text-center mt-2">{error}</p>}
          </div>
          <DialogFooter>
            <Button 
                type="submit" 
                disabled={loading || allDecks.length === 0 || (!frontField.trim() && !backField.trim())}
                >
                {loading ? (
                    <span className="flex items-center">
                         <Plus className="mr-2 h-4 w-4 animate-spin" /> 保存中...
                    </span>
                ) : (
                     "添加笔记 (及卡片)"
                )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
