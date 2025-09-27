import { db, type Deck, type Card, type NoteType, type Note, type ReviewLog } from './db';

const MOCK_NOTE_TYPE_ID = "1-basic";

const mockNoteType: NoteType = {
    id: MOCK_NOTE_TYPE_ID,
    name: "基本卡片",
    fieldDefs: [
        { name: "正面", type: "rich" },
        { name: "背面", type: "rich" }
    ],
    templateDefs: [
        { name: "卡片 1", qfmt: "{{正面}}", afmt: "{{背面}}" }
    ]
};

const mockDecks: Deck[] = [
    {
        id: 'deck-1',
        name: '日语 N5 词汇',
        parentId: null,
        config: { description: '基础日语词汇学习，包含常用800词汇', difficulty: "easy" }, // 👈 添加难度
        createdAt: Date.now(),
        updatedAt: Date.now(),
    },
    {
        id: 'deck-2',
        name: '英语六级核心词汇',
        parentId: null,
        config: { description: '大学英语六级考试必备词汇', difficulty: "medium" }, // 👈 添加难度
        createdAt: Date.now(),
        updatedAt: Date.now(),
    },
    {
        id: 'deck-3',
        name: '计算机科学术语',
        parentId: null,
        config: { description: '计算机科学相关专业术语和概念', difficulty: "hard" }, // 👈 添加难度
        createdAt: Date.now(),
        updatedAt: Date.now(),
    }
];

// Helper to generate a batch of notes and cards
function generateDeckContent(deckId: string, count: number): { notes: Note[], cards: Card[] } {
    const notes: Note[] = [];
    const cards: Card[] = [];
    const now = Date.now();
    for (let i = 0; i < count; i++) {
        const noteId = `${deckId}-note-${i}`;
        const cardId = `${deckId}-card-${i}`;

        // Simplified logic for state distribution:
        // ~6.25% (i%16==0) are 'new'
        // ~18.75% (i%16 > 8 && i%16 <= 11) are 'due review'
        // the rest are 'learning' (mostly in the past or far future, so not due yet)

        let state: Card['state'] = 'learning';
        const modulo = i % 16;
        
        if (modulo === 0) {
             state = 'new';
        } else if (modulo > 8 && modulo <= 11) {
            state = 'review';
        }
        
        let dueTime = now + (24 * 60 * 60 * 1000); // Default: Tomorrow
        
        if (state === 'review') {
             // Card is due (in the past or now)
             dueTime = now - (Math.random() * 3600000 * 24 * 3); // Due in the last 3 days
        } else if (state === 'new') {
            // New cards are placed sequentially in the learning queue (for this simplified schedule)
            dueTime = now + (i * 60000); // 1 minute separation
        } else {
             // General learning card, set to a non-due future time (3-10 days from now)
             dueTime = now + (1000 * 60 * 60 * 24 * (3 + Math.random() * 7)); 
        }

        notes.push({
            id: noteId,
            noteTypeId: MOCK_NOTE_TYPE_ID,
            fields: { '正面': `Deck ${deckId} 正面 ${i}`, '背面': `Deck ${deckId} 背面 ${i}` },
            tags: i % 2 === 0 ? [deckId, '概念'] : [deckId, '基础'],
            guid: `guid-${noteId}`,
        });

        cards.push({
            id: cardId,
            noteId: noteId,
            deckId: deckId,
            templateIndex: 0,
            state: state,
            due: dueTime,
            ivl: state === 'new' ? 0 : 10, // Initial interval or days passed
            ease: 2.5,
        });
    }
    return { notes, cards };
}

export async function seedDatabase() {
    console.log("Starting database seeding check...");
    
    // Use Dexie's transaction for atomicity and speed
    await db.transaction('rw', [db.decks, db.noteTypes, db.notes, db.cards, db.reviewLogs], async () => {
        const existingDecks = await db.decks.count();

        if (existingDecks === 0) {
            console.log("Seeding initial data...");

            await db.noteTypes.add(mockNoteType);
            
            // Generate content: (Total cards slightly adjusted to match the old mock counts)
            const deck1Content = generateDeckContent('deck-1', 800);
            const deck2Content = generateDeckContent('deck-2', 1200);
            const deck3Content = generateDeckContent('deck-3', 350);

            const allNotes = [...deck1Content.notes, ...deck2Content.notes, ...deck3Content.notes];
            const allCards = [...deck1Content.cards, ...deck2Content.cards, ...deck3Content.cards];

            // Add Decks
            await db.decks.bulkAdd(mockDecks);

            // Add Notes
            await db.notes.bulkAdd(allNotes);
            
            // Add Cards
            await db.cards.bulkAdd(allCards);
            
            // Seed a Review Log entry for 'lastStudied' simulation for deck-1 card (which starts learning state)
            const logEntry: ReviewLog = {
                id: "log-initial-1",
                cardId: deck1Content.cards.find(c => c.state !== 'new')?.id || deck1Content.cards[0].id,
                timestamp: Date.now() - (2 * 3600000), // 2 hours ago
                rating: 3,
                durationMs: 2000
            };
            await db.reviewLogs.add(logEntry);
            
            console.log(`Database seeded with ${allCards.length} cards across ${mockDecks.length} decks.`);

        } else {
             console.log("Database already contains data, skipping seed.");
        }
    }).catch(e => {
        console.error("Database seeding failed:", e);
        throw e;
    });
}
