import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@/styles/global.css'
import App from './App.tsx'
import { initializeDatabase } from '@/core/db/seed'

async function bootstrap() {
  try {
    await initializeDatabase()
  } catch (error) {
    console.error('Failed to open local database', error)
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void bootstrap()
