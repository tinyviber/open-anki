import { Card } from "@/components/ui/card";
import { useDeckSummaries } from "@/hooks/useDeckSummaries";
import { DeckCard } from "@/components/DeckCard";
import { NewDeckDialog } from "@/components/NewDeckDialog";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";


export function DecksPage() {
  const decks = useDeckSummaries();

  if (!decks) {
    return <p className="text-center pt-8 text-muted-foreground">加载卡片组中...</p>;
  }

  return (
    <div className="space-y-6">
        <div className="flex items-center justify-between">
            <h1 className="text-3xl font-bold tracking-tight">
                所有卡片组 ({decks.length})
            </h1>
             <NewDeckDialog>
                <Button>
                <Plus className="mr-2 h-4 w-4" />
                新建卡片组
                </Button>
             </NewDeckDialog>
        </div>
      
      {decks.length === 0 ? (
        <Card className="p-8 text-center text-muted-foreground">
          没有找到任何卡片组。请创建一个新的。
        </Card>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {decks.map((deck) => (
            // Note: In a real app, this should link to the Deck Details Page
            <DeckCard key={deck.id} {...deck} />
          ))}
        </div>
      )}
    </div>
  );
}