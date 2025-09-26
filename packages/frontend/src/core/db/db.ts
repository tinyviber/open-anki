import Dexie, { type Table } from 'dexie'

// 核心数据模型类型 (简化版，仅用于 DB 定义)
// 实际类型应在 features/* 模块中定义
export interface Deck {
  id: string // UUID
  name: string
  parentId: string | null
  config: Record<string, any> // 算法参数等配置
  createdAt: number
  updatedAt: number
}

export interface NoteType {
  id: string
  name: string
  fieldDefs: { name: string; type: 'text' | 'rich' }[]
  templateDefs: { name: string; qfmt: string; afmt: string }[]
}

export interface Note {
  id: string
  noteTypeId: string
  fields: Record<string, string> // KV 字段值
  tags: string[]
  guid: string // 用于同步
}

export interface Card {
  id: string
  noteId: string
  deckId: string
  templateIndex: number // 对应 NoteType.templateDefs 的索引
  state: 'new' | 'learning' | 'review' | 'suspended' | 'buried'
  due: number // 下次复习时间 (Unix Timestamp)
  ivl: number // 间隔天数
  ease: number // 易度/保持率 (算法相关)
}

export interface ReviewLog {
  id: string
  cardId: string
  timestamp: number
  rating: number // 1:Again, 2:Hard, 3:Good, 4:Easy
  durationMs: number
  // 可选: before/after 状态快照 (用于事件溯源)
}

export interface SyncMeta {
  entityId: string
  entityType: string
  version: number // HLC/Lamport version
  op: 'create' | 'update' | 'delete'
  timestamp: number
}

// Dexie 数据库类
export class OpenAnkiDB extends Dexie {
  decks!: Table<Deck>
  noteTypes!: Table<NoteType>
  notes!: Table<Note>
  cards!: Table<Card>
  reviewLogs!: Table<ReviewLog>
  syncMeta!: Table<SyncMeta>

  constructor() {
    super('OpenAnkiDB')
    this.version(1).stores({
      decks: '++id, parentId',
      noteTypes: '++id',
      notes: '++id, guid, *tags, noteTypeId',
      cards: '++id, deckId, [state+due], state, noteId', // due 索引对调度很重要
      reviewLogs: '++id, cardId, timestamp',
      syncMeta: '++id, entityId, entityType',
    })
    // 如果将来需要升级版本，可以链式调用 this.version(2).stores(...)
  }
}

export const db = new OpenAnkiDB()