import { useState } from 'react'
import './App.css'
import DesignPage from './pages/DesignPage'
import WhyPage from './pages/WhyPage'
import NavigationMenu from './components/NavigationMenu'

export default function App() {
  const [page, setPage] = useState<'home' | 'why'>('home')

  return (
    <div className="app-container">
      <header className="app-header">
        <NavigationMenu onNavigate={setPage} />
        <h1>Interior Design Color Visualizer</h1>
      </header>
      {/* Render both pages to preserve state when navigating */}
      <div style={{ display: page === 'home' ? 'block' : 'none' }}>
        <DesignPage />
      </div>
      <div style={{ display: page === 'why' ? 'block' : 'none' }}>
        <WhyPage />
      </div>
    </div>
  )
}
