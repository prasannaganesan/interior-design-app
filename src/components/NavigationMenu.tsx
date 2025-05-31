import { useState } from 'react'

interface NavigationMenuProps {
  onNavigate: (page: 'home' | 'why') => void
}

export default function NavigationMenu({ onNavigate }: NavigationMenuProps) {
  const [open, setOpen] = useState(false)

  const handleNav = (page: 'home' | 'why') => {
    onNavigate(page)
    setOpen(false)
  }

  return (
    <nav className="nav-menu">
      <button className="hamburger" aria-label="Menu" onClick={() => setOpen(!open)}>
        <span />
        <span />
        <span />
      </button>
      {open && (
        <div className="menu-dropdown">
          <a onClick={() => handleNav('home')}>Home</a>
          <a onClick={() => handleNav('why')}>Why</a>
        </div>
      )}
    </nav>
  )
}
