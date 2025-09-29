import { db } from './db'

export async function initializeDatabase(): Promise<void> {
  if (db.isOpen()) {
    return
  }

  try {
    await db.open()
  } catch (error) {
    console.error('Failed to initialize IndexedDB', error)
    throw error
  }
}
