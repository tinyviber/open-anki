import * as React from 'react';
import { ChevronLeft, ChevronsRight, HeartCrack, Lightbulb } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { getDueCards, gradeCard } from '@/core/db/reviewActions';
import { db, type Card as CardEntity, type NoteType } from '@/core/db/db';

// Mock Card Content for MVP (no real templating yet)
function renderCardContent(card: CardEntity & { fields: Record<string, string> }, _noteType: NoteType, isBack: boolean): React.ReactNode {
    if (isBack) {
        return (
            <>
                <div className="text-sm text-muted-foreground">背面</div>
                <p className="text-2xl font-semibold mt-2">
                    {card.fields["背面"] || "（无背面内容）"}
                </p>
                <div className="mt-4 text-sm text-primary">
                    {card.fields["正面"] && <p className="pt-2 text-muted-foreground text-sm">正面: {card.fields["正面"]}</p>}
                </div>
            </>
        );
    }
    return (
        <>
            <div className="text-sm text-muted-foreground">正面</div>
            <p className="text-4xl font-bold mt-2">{card.fields["正面"]}</p>
        </>
    );
}


// Grading button definitions: Anki scale (1=Again, 2=Hard, 3=Good, 4=Easy)
const gradeButtons = [
    // Placeholder intervals shown. Real intervals are calculated dynamically in gradeCard.
    { label: "重新学习 (1m)", rating: 1, variant: "destructive", Icon: HeartCrack },
    { label: "困难 (10m)", rating: 2, variant: "secondary", Icon: ChevronLeft },
    { label: "良好 (1d)", rating: 3, variant: "default", Icon: Lightbulb },
    { label: "简单 (4d)", rating: 4, variant: "primary", Icon: ChevronsRight },
] as const;


export function ReviewPage() {
    const [isShowingBack, setIsShowingBack] = React.useState(false);
    // Use an internal state queue for UX control, updated from liveDueCards
    const [cardQueue, setCardQueue] = React.useState<CardEntity[] | undefined>(undefined); 
    const [isSubmitting, setIsSubmitting] = React.useState(false);
    
    // Live query for due cards: this is the source of truth for all due cards
    const liveDueCards = useLiveQuery(() => getDueCards(), []);
    
    // Load Note Types (e.g., "1-basic") and current Deck for context
    const basicNoteType = useLiveQuery(() => db.noteTypes.get("1-basic"), []);

    React.useEffect(() => {
        if (liveDueCards) {
            // Re-initialize queue on data load/change
            setCardQueue(liveDueCards);
        }
    }, [liveDueCards]);

    const currentCard = cardQueue?.[0];
    
    // Dynamically load the Note for the current card to get the fields
    const note = useLiveQuery(() => 
        currentCard ? db.notes.get(currentCard.noteId) : undefined
    , [currentCard?.noteId]);

    // Dynamically load the Deck for the current card to get the name
    const deck = useLiveQuery(() => 
        currentCard ? db.decks.get(currentCard.deckId) : undefined
    , [currentCard?.deckId]);

    const handleFlip = React.useCallback(() => {
        setIsShowingBack(true);
    }, []);

    const handleGrade = React.useCallback(async (rating: 1 | 2 | 3 | 4) => {
        if (!currentCard || isSubmitting) return;

        setIsSubmitting(true);
        try {
            await gradeCard(currentCard.id, rating);
            
            // --- UX Queue Management ---
            setCardQueue(prevQueue => {
                if (!prevQueue || prevQueue.length === 0) return undefined;
                
                const nextQueue = prevQueue.slice(1);
                
                // Simplified Re-queue Logic: If Again(1) or Hard(2) is pressed, 
                // the card is likely put back into the *learning* queue, 
                // but usually after a short interval (handled by `gradeCard`).
                // To simulate this in the immediate UI, we move it to the end 
                // for rapid re-exposure. (In a real Anki-style scheduler, 
                // it often uses a dedicated, prioritized step queue.)
                if (rating <= 2) {
                    const reQueuedCard = { ...currentCard }; 
                    return [...nextQueue, reQueuedCard];
                }

                return nextQueue; // Passed card is removed from this session's immediate queue.
            });
            setIsShowingBack(false);
            
        } catch (error) {
            console.error("Review failed:", error);
        } finally {
            setIsSubmitting(false);
        }
    }, [currentCard, isSubmitting]);

    const isLoading = cardQueue === undefined || basicNoteType === undefined || !note;
    
    // Check total due count based on initial liveDueCards for progress bar reference
    const initialDueCount = liveDueCards?.length ?? 0;
    const cardsRemaining = cardQueue?.length ?? 0;

    if (isLoading && initialDueCount === 0) {
         // This can happen if LiveQuery is initially loading or data is sparse
        return (
            <Card className="flex items-center justify-center h-80 animate-pulse text-muted-foreground">
                正在加载复习卡片和笔记模型...
            </Card>
        );
    }
    
    if (initialDueCount > 0 && cardsRemaining === 0) {
         // Finished the session
        return (
            <Card className="flex flex-col items-center justify-center h-80 text-center space-y-4">
                <h1 className="text-3xl font-bold">🎉 完成!</h1>
                <p className="text-lg text-muted-foreground">恭喜！今天的复习已完成。</p>
                <Link to="/">
                    <Button>返回仪表盘</Button>
                </Link>
            </Card>
        );
    }

    if (!currentCard || !basicNoteType || !note) {
        // Fallback for missing crucial data
        return (
             <div className="space-y-4">
                 <h1 className="text-3xl font-bold tracking-tight">加载失败</h1>
                 <Card className="p-8 text-muted-foreground">无法找到卡片或关联的笔记数据。请返回仪表盘。</Card>
             </div>
        )
    }
    
    // Combine Card and Note for rendering (Note carries the fields)
    const cardWithFields = { ...currentCard, fields: note.fields };

    // Progress calculation
    const progressValue = initialDueCount > 0 ? 
        Math.round(((initialDueCount - cardsRemaining) / initialDueCount) * 100) : 100;

    return (
        <div className="space-y-6">
            <h1 className="text-3xl font-bold tracking-tight">今日复习 ({cardsRemaining} 张剩余)</h1>

            <div className="max-w-xl mx-auto space-y-4">
                 <Progress value={progressValue} className="h-2" />

                <Card className="min-h-96 shadow-2xl transition-all duration-300 transform-gpu hover:shadow-primary/30">
                    <CardHeader className="py-3 px-4 border-b">
                        <p className="text-sm text-muted-foreground flex justify-between">
                            <span>卡组: {deck?.name || currentCard.deckId}</span>
                            <span>状态: {currentCard.state.toUpperCase()}</span>
                        </p>
                    </CardHeader>
                    
                    <CardContent className="min-h-[240px] flex flex-col items-center justify-center text-center p-8">
                        {/* Rendering logic here */}
                        {renderCardContent(cardWithFields, basicNoteType, isShowingBack)}
                    </CardContent>

                    <CardFooter className="flex flex-col border-t pt-4">
                        {!isShowingBack ? (
                            <Button 
                                className="w-full text-lg h-12"
                                onClick={handleFlip}
                                disabled={isSubmitting}
                            >
                                显示答案
                            </Button>
                        ) : (
                            <div className="flex justify-between w-full space-x-2">
                                {gradeButtons.map(({ label, rating, variant }) => (
                                    <Button
                                        key={rating}
                                        // Dynamic label display (to show next interval) can be implemented here later
                                        variant={variant as "default" | "secondary" | "destructive" | "primary"}
                                        onClick={() => handleGrade(rating)}
                                        className="flex-1 h-12 text-sm"
                                        disabled={isSubmitting}
                                    >
                                        {label}
                                    </Button>
                                ))}
                            </div>
                        )}
                    </CardFooter>
                </Card>
            </div>
        </div>
    );
}