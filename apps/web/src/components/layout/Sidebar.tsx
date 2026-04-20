import { NavLink } from 'react-router-dom';
import { UserButton } from '@clerk/react';

const NAV_ITEMS = [
  { to: '/',        label: 'Trips',   icon: '✈️' },
  { to: '/clients', label: 'Clients', icon: '👤' },
];

export function Sidebar() {
  return (
    <aside className="w-56 h-screen bg-slate-900 flex flex-col fixed left-0 top-0">
      {/* Brand */}
      <div className="px-5 py-6 border-b border-slate-700">
        <span className="text-white font-semibold text-lg tracking-tight">
          Trip Planner
        </span>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {NAV_ITEMS.map(({ to, label, icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              [
                'flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors',
                isActive
                  ? 'bg-slate-700 text-white'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-white',
              ].join(' ')
            }
          >
            <span>{icon}</span>
            {label}
          </NavLink>
        ))}
      </nav>

      {/* User */}
      <div className="px-5 py-4 border-t border-slate-700 flex items-center gap-3">
        <UserButton afterSignOutUrl="/sign-in" />
        <span className="text-slate-400 text-sm">Account</span>
      </div>
    </aside>
  );
}
