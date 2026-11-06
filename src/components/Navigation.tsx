import { useState } from 'react';
import {
  LayoutDashboard,
  Fuel,
  Users,
  Gauge,
  History,
  Menu,
  X,
  ChevronLeft,
  ChevronRight,
  Droplets,
  Receipt,
} from 'lucide-react';

export type ScreenTab =
  | 'dashboard'
  | 'daily-operation'
  | 'fuel-stock'
  | 'customers'
  | 'expenses'
  | 'history'
  | 'pumps-nozzles';

interface NavigationProps {
  currentTab: ScreenTab;
  onSelectTab: (tab: ScreenTab) => void;
  stationName: string;
  managerName?: string;
}

export function Navigation({
  currentTab,
  onSelectTab,
  stationName,
  managerName = 'Manager',
}: NavigationProps) {
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);

  const tabs: Array<{
    id: ScreenTab;
    label: string;
    icon: typeof Fuel;
  }> = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'daily-operation', label: 'Daily Operation', icon: Fuel },
    { id: 'fuel-stock', label: 'Fuel Stock', icon: Fuel },
    { id: 'pumps-nozzles', label: 'Pumps & Nozzles', icon: Gauge },
    { id: 'customers', label: 'Customers', icon: Users },
    { id: 'expenses', label: 'Expenses', icon: Receipt },
    { id: 'history', label: 'History', icon: History },
  ];

  const handleTabClick = (tabId: ScreenTab) => {
    onSelectTab(tabId);
    setIsMobileOpen(false);
  };

  const initials = (name: string) =>
    name
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((n) => n[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();

  const now = new Date();
  const stamp = now.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });

  return (
    <>
      {/* Mobile Header */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b-2 border-slate-200 bg-white px-4 py-3 md:hidden">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#0f766e] text-white">
            <Droplets className="h-6 w-6" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-base font-black leading-tight text-slate-900">
              FuelStation
            </h1>
            <p className="truncate text-sm font-medium text-slate-500">
              Petrol Pump
            </p>
          </div>
        </div>

        <button
          id="btn-mobile-menu-toggle"
          onClick={() => setIsMobileOpen((prev) => !prev)}
          className="cursor-pointer rounded-xl p-3 text-slate-600 transition-colors hover:bg-slate-100"
          aria-label="Toggle menu"
          aria-expanded={isMobileOpen}
        >
          {isMobileOpen ? (
            <X className="h-6 w-6" />
          ) : (
            <Menu className="h-6 w-6" />
          )}
        </button>
      </header>

      {isMobileOpen && (
        <div
          onClick={() => setIsMobileOpen(false)}
          className="fixed inset-0 z-40 bg-slate-950/45 md:hidden"
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed left-0 top-0 z-50 flex h-screen shrink-0 flex-col
          bg-white text-slate-900
          border-r-2 border-slate-200
          transition-all duration-200 ease-out
          md:sticky md:z-20
          ${isCollapsed ? 'md:w-[84px]' : 'md:w-[280px]'}
          ${
            isMobileOpen
              ? 'w-[280px] translate-x-0'
              : '-translate-x-full md:translate-x-0'
          }
        `}
      >
        {/* Logo Area */}
        <div
          className={`
            flex shrink-0 items-center border-b-2 border-emerald-700
            bg-[#0f766e]
            px-4 py-6
            ${isCollapsed ? 'md:justify-center md:px-4' : 'justify-between'}
          `}
        >
          <div
            className={`flex min-w-0 items-center gap-2 ${
              isCollapsed ? 'md:justify-center' : ''
            }`}
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15 text-white">
              <Droplets className="h-5 w-5" />
            </div>

            {(!isCollapsed || isMobileOpen) && (
              <div className="min-w-0 flex-1">
                <h1 className="truncate text-base font-black leading-tight text-white">
                  FuelStation
                </h1>
                <p className="mt-1 truncate text-sm font-medium text-emerald-100">
                  Petrol Pump
                </p>
              </div>
            )}
          </div>

          <button
            onClick={() => setIsCollapsed((prev) => !prev)}
            className="hidden cursor-pointer rounded-lg p-2 text-emerald-100 transition-colors hover:bg-white/10 hover:text-white md:flex"
            title={isCollapsed ? 'Expand' : 'Collapse'}
            aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {isCollapsed ? (
              <ChevronRight className="h-5 w-5" />
            ) : (
              <ChevronLeft className="h-5 w-5" />
            )}
          </button>
        </div>

        {/* Navigation */}
        <div className="flex-1 overflow-y-auto bg-white">
          <nav className="space-y-1.5 px-4 py-5">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = currentTab === tab.id;
              return (
                <button
                  key={tab.id}
                  id={`nav-btn-${tab.id}`}
                  onClick={() => handleTabClick(tab.id)}
                  title={tab.label}
                  aria-current={isActive ? 'page' : undefined}
                  className={`
                    group relative flex w-full cursor-pointer items-center
                    gap-3 rounded-xl px-4 py-3.5 text-left
                    text-base font-bold
                    transition-colors duration-150
                    ${isCollapsed ? 'md:justify-center md:px-0' : ''}
                    ${
                      isActive
                        ? 'bg-emerald-50 font-black text-[#0f766e]'
                        : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                    }
                  `}
                >
                  {isActive && (
                    <span className="absolute left-0 top-1/2 h-7 w-1.5 -translate-y-1/2 rounded-r-full bg-[#0f766e]" />
                  )}

                  <Icon
                    className={`
                      h-6 w-6 shrink-0 transition-colors duration-150
                      ${
                        isActive
                          ? 'text-[#0f766e]'
                          : 'text-slate-500 group-hover:text-slate-700'
                      }
                    `}
                  />

                  {(!isCollapsed || isMobileOpen) && (
                    <span className="truncate">{tab.label}</span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Manager Card / Footer */}
        <div className="shrink-0 border-t-2 border-slate-100 p-4">
          {!isCollapsed || isMobileOpen ? (
            <div className="rounded-2xl bg-slate-50 p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#0f766e] text-base font-black text-white">
                  {initials(managerName)}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-base font-bold text-slate-900">
                    {managerName}
                  </p>
                  <p className="mt-0.5 truncate text-sm font-medium text-slate-500">
                    Manager
                  </p>
                </div>
              </div>

              <div className="mt-4 border-t-2 border-slate-200 pt-4">
                <p className="truncate text-sm font-bold text-slate-600">
                  {stationName || 'FuelStation'}
                </p>
                <p className="mt-1 truncate text-xs font-medium text-slate-400">
                  {stamp}
                </p>
              </div>
            </div>
          ) : (
            <div className="flex justify-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#0f766e] text-base font-black text-white">
                {initials(managerName)}
              </div>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
