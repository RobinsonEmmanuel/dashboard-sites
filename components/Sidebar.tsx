'use client';

import { useState, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  ChartBarIcon,
  TableCellsIcon,
  MagnifyingGlassCircleIcon,
  CurrencyEuroIcon,
  CalendarDaysIcon,
  GlobeAltIcon,
  ArrowPathIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ArrowRightStartOnRectangleIcon,
  BookOpenIcon,
} from '@heroicons/react/24/outline';

const menuItems = [
  { name: 'Vue d\'ensemble', icon: ChartBarIcon, href: '/overview' },
  { name: 'Comparaison', icon: TableCellsIcon, href: '/sites-comparison' },
  { name: 'Performance SEO', icon: MagnifyingGlassCircleIcon, href: '/seo' },
  { name: 'Revenus', icon: CurrencyEuroIcon, href: '/revenue' },
  { name: 'Promesses', icon: CalendarDaysIcon, href: '/promises' },
];

const bottomItems = [
  { name: 'Synchronisation', icon: ArrowPathIcon, href: '/ingestion' },
  { name: 'Gestion des sites', icon: GlobeAltIcon, href: '/sites' },
  { name: 'Produits SendOwl', icon: BookOpenIcon, href: '/sendowl-products' },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem('sidebarExpanded');
    if (stored !== null) setExpanded(stored === 'true');
  }, []);

  const toggleExpanded = () => {
    const next = !expanded;
    setExpanded(next);
    localStorage.setItem('sidebarExpanded', String(next));
  };

  return (
    <aside
      className={`flex flex-col h-screen bg-[#191E55] text-white transition-all duration-300 shrink-0 ${
        expanded ? 'w-60' : 'w-16'
      }`}
    >
      {/* Header */}
      <div className={`flex items-center border-b border-white/10 ${expanded ? 'px-4 py-5 gap-3' : 'px-3 py-5 justify-center'}`}>
        <div className="w-9 h-9 bg-[#f57503] rounded-lg flex items-center justify-center shrink-0 font-bold text-sm">
          RL
        </div>
        {expanded && (
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm truncate">Dashboard Sites</p>
            <p className="text-xs text-white/50 truncate">Region Lovers</p>
          </div>
        )}
      </div>

      {/* Navigation principale */}
      <nav className="flex-1 p-2 space-y-1 overflow-y-auto">
        {expanded && (
          <p className="text-[10px] font-semibold uppercase tracking-widest text-white/30 px-3 pt-3 pb-1">
            Analytics
          </p>
        )}
        {menuItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
          return (
            <button
              key={item.href}
              onClick={() => router.push(item.href)}
              title={!expanded ? item.name : undefined}
              className={`w-full flex items-center gap-3 rounded-lg transition-colors ${
                expanded ? 'px-3 py-2.5' : 'px-0 py-2.5 justify-center'
              } ${
                isActive
                  ? 'bg-[#f57503] text-white'
                  : 'text-white/70 hover:bg-white/10 hover:text-white'
              }`}
            >
              <Icon className="w-5 h-5 shrink-0" />
              {expanded && <span className="text-sm font-medium truncate">{item.name}</span>}
            </button>
          );
        })}
      </nav>

      {/* Section basse */}
      <div className="p-2 border-t border-white/10 space-y-1">
        {expanded && (
          <p className="text-[10px] font-semibold uppercase tracking-widest text-white/30 px-3 pt-1 pb-1">
            Configuration
          </p>
        )}
        {bottomItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
          return (
            <button
              key={item.href}
              onClick={() => router.push(item.href)}
              title={!expanded ? item.name : undefined}
              className={`w-full flex items-center gap-3 rounded-lg transition-colors ${
                expanded ? 'px-3 py-2.5' : 'px-0 py-2.5 justify-center'
              } ${
                isActive
                  ? 'bg-[#f57503] text-white'
                  : 'text-white/70 hover:bg-white/10 hover:text-white'
              }`}
            >
              <Icon className="w-5 h-5 shrink-0" />
              {expanded && <span className="text-sm font-medium truncate">{item.name}</span>}
            </button>
          );
        })}

        {/* User info + logout */}
        <UserFooter expanded={expanded} />

        {/* Toggle collapse */}
        <button
          onClick={toggleExpanded}
          className={`w-full flex items-center gap-3 rounded-lg px-3 py-2 text-white/40 hover:text-white hover:bg-white/10 transition-colors ${
            !expanded ? 'justify-center px-0' : ''
          }`}
          title={expanded ? 'Réduire' : 'Agrandir'}
        >
          {expanded ? (
            <>
              <ChevronLeftIcon className="w-4 h-4 shrink-0" />
              <span className="text-xs">Réduire</span>
            </>
          ) : (
            <ChevronRightIcon className="w-4 h-4 shrink-0" />
          )}
        </button>
      </div>
    </aside>
  );
}

function UserFooter({ expanded }: { expanded: boolean }) {
  const [user, setUser] = useState<{ email: string; role?: string } | null>(null);

  useEffect(() => {
    const { getCurrentUser } = require('@/lib/auth');
    setUser(getCurrentUser());
  }, []);

  const handleLogout = () => {
    const { logout } = require('@/lib/auth');
    logout();
  };

  if (!user) return null;

  const initials = user.email?.split('@')[0]?.substring(0, 2)?.toUpperCase() || 'RL';

  return (
    <div className={`flex items-center gap-3 px-2 py-2 rounded-lg ${expanded ? '' : 'justify-center'}`}>
      <div className="w-8 h-8 bg-white/20 rounded-full flex items-center justify-center text-xs font-bold shrink-0">
        {initials}
      </div>
      {expanded && (
        <>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium truncate text-white">{user.email}</p>
            {user.role && <p className="text-[10px] text-white/40 capitalize">{user.role}</p>}
          </div>
          <button
            onClick={handleLogout}
            title="Déconnexion"
            className="text-white/40 hover:text-white transition-colors"
          >
            <ArrowRightStartOnRectangleIcon className="w-4 h-4" />
          </button>
        </>
      )}
    </div>
  );
}
