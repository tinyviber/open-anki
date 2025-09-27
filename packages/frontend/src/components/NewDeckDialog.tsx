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
import { Input } from "./ui/input"
import { Textarea } from "./ui/textarea"
import { Button } from "./ui/button"
import { Label } from "./ui/label";
import { createDeck } from "@/core/db/deckActions";
import { Plus } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { type DeckCardProps } from "../components/DeckCard"; 

const difficulties: { value: DeckCardProps['difficulty'], label: string }[] = [
    { value: 'easy', label: '简单 (Easy)' },
    { value: 'medium', label: '中等 (Medium)' },
    { value: 'hard', label: '困难 (Hard)' },
];

export function NewDeckDialog({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const [deckName, setDeckName] = React.useState('');
  const [deckDescription, setDeckDescription] = React.useState('');
  // 默认为中等难度
  const [difficulty, setDifficulty] = React.useState<DeckCardProps['difficulty']>('medium'); 
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const resetState = () => {
    setDeckName('');
    setDeckDescription('');
    setDifficulty('medium'); 
    setError(null);
  };
  
  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (!isOpen) {
      resetState();
    }
  };


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = deckName.trim();
    if (!name) {
        setError("卡片组名称不能为空");
        return;
    }

    setLoading(true);
    setError(null);
    try {
        await createDeck({
            name: name,
            description: deckDescription.trim(),
            difficulty: difficulty, 
        });
        setOpen(false); 
    } catch (err) {
        const errorMessage = (err instanceof Error) ? err.message : "未知错误";
        console.error("Failed to create deck:", err);
        setError(`创建失败: ${errorMessage}`);
    } finally {
        setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>新建卡片组</DialogTitle>
          <DialogDescription>
            为您的卡片组输入名称和可选描述。
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            
            {/* 卡组名称 */}
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="deckName" className="text-right">
                名称 <span className="text-destructive">*</span>
              </Label>
              <Input
                id="deckName"
                value={deckName}
                onChange={(e) => {
                    setDeckName(e.target.value);
                    setError(null);
                }}
                className="col-span-3"
                placeholder="例如：日语 N5"
                required
                aria-invalid={!!error}
              />
            </div>
            
            {/* 难度选择 (UX 优化 1) */}
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="difficulty" className="text-right">
                难度等级
              </Label>
               <div className="col-span-3">
                   <Select 
                      value={difficulty} 
                      onValueChange={(value) => setDifficulty(value as DeckCardProps['difficulty'])}
                    >
                       <SelectTrigger className="w-full">
                           <SelectValue placeholder="选择难度等级" />
                       </SelectTrigger>
                       <SelectContent>
                          {difficulties.map(d => (
                            <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
                          ))}
                       </SelectContent>
                   </Select>
               </div>
            </div>
            
            {/* 描述 */}
            <div className="grid grid-cols-4 items-start gap-4">
              <Label htmlFor="deckDescription" className="text-right pt-2">
                描述
              </Label>
              <Textarea
                id="deckDescription"
                value={deckDescription}
                onChange={(e) => setDeckDescription(e.target.value)}
                className="col-span-3"
                placeholder="简短介绍此卡片组内容"
                rows={3}
              />
            </div>
            {error && <p className="text-sm text-destructive col-span-full text-center mt-2">{error}</p>}
          </div>
          <DialogFooter>
            <Button 
                type="submit" 
                disabled={loading || !deckName.trim()}
                >
                {loading ? (
                    <span className="flex items-center">
                         <Plus className="mr-2 h-4 w-4 animate-spin" /> 创建中...
                    </span>
                ) : (
                     "创建卡片组"
                )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
