import { useEffect, useState } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import Roster from './pages/Roster';
import CharacterDetail from './pages/CharacterDetail';
import Accounts from './pages/Accounts';
import Groups from './pages/Groups';
import GroupDetail from './pages/GroupDetail';
import Tags from './pages/Tags';
import Location from './pages/Location';
import Fits from './pages/Fits';
import FitDetail from './pages/FitDetail';
import Plans from './pages/Plans';
import PlanDetail from './pages/PlanDetail';
import PlanCreator from './pages/PlanCreator';
import PlanCompare from './pages/PlanCompare';
import Clones from './pages/Clones';
import Blueprints from './pages/Blueprints';
import Wallet from './pages/Wallet';
import Mining from './pages/Mining';
import MercenaryDens from './pages/MercenaryDens';
import Settings from './pages/Settings';
import SdeBanner from './components/SdeBanner';
import UpdateBanner from './components/UpdateBanner';
import NotificationBell from './components/NotificationBell';
import ActivityIndicator from './components/ActivityIndicator';
import CommandPalette from './components/CommandPalette';
import {
  BlueprintIcon,
  CopyIcon,
  CreditCardIcon,
  DashboardIcon,
  GraduationCapIcon,
  LayersIcon,
  MapPinIcon,
  PickaxeIcon,
  RocketIcon,
  SearchIcon,
  SettingsIcon,
  ShieldIcon,
  TagIcon,
  UsersIcon,
  WalletIcon,
} from './components/icons';
import { mco } from './lib/ipc';
import { isTypingTarget } from './lib/commandPalette';

const NAV = [
  { to: '/', label: 'Dashboard', end: true, icon: DashboardIcon },
  { to: '/roster', label: 'Roster', icon: UsersIcon },
  { to: '/accounts', label: 'Accounts', icon: CreditCardIcon },
  { to: '/groups', label: 'Groups', icon: LayersIcon },
  { to: '/tags', label: 'Tags', icon: TagIcon },
  { to: '/location', label: 'Location', icon: MapPinIcon },
  { to: '/fits', label: 'Fits', icon: RocketIcon },
  { to: '/plans', label: 'Skill Plans', icon: GraduationCapIcon },
  { to: '/clones', label: 'Clones', icon: CopyIcon },
  { to: '/blueprints', label: 'Blueprints', icon: BlueprintIcon },
  { to: '/wallet', label: 'Wallet', icon: WalletIcon },
  { to: '/mining', label: 'Mining', icon: PickaxeIcon },
  { to: '/mercenary-dens', label: 'Mercenary Dens', icon: ShieldIcon },
];

/** Everything the quick-search palette can open as a page: the nav plus Settings. */
const PALETTE_PAGES = [
  ...NAV.map(({ to, label }) => ({ to, label })),
  { to: '/plans/compare', label: 'Compare skill plans' },
  { to: '/settings', label: 'Settings' },
];

/** The current page's own search box, if it has one. */
function pageSearchInput(): HTMLInputElement | null {
  return document.querySelector<HTMLInputElement>('.app-main input[type="search"]');
}

export default function App() {
  const [clientConfigured, setClientConfigured] = useState(true);
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    void mco.system.isClientConfigured().then(setClientConfigured);
  }, []);

  // App-wide shortcuts. Ctrl/⌘+K toggles quick search from anywhere; "/" and
  // Ctrl/⌘+F focus the current page's search box ("/" only outside text fields,
  // where it is a character someone is typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && !e.shiftKey && !e.altKey && key === 'k') {
        e.preventDefault();
        setPaletteOpen((open) => !open);
        return;
      }
      if (paletteOpen) return;
      const focusSearch =
        (mod && !e.shiftKey && !e.altKey && key === 'f') ||
        (e.key === '/' && !mod && !e.altKey && !isTypingTarget(e.target));
      if (focusSearch) {
        const input = pageSearchInput();
        if (input) {
          e.preventDefault();
          input.focus();
          input.select();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [paletteOpen]);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar__brand">
          <h1>MCO</h1>
          <p className="tagline">Massive Character Organizer</p>
        </div>
        <button
          type="button"
          className="sidebar__search"
          onClick={() => setPaletteOpen(true)}
          title="Quick search (Ctrl+K)"
          data-testid="open-palette"
        >
          <SearchIcon size={14} />
          <span>Search</span>
          <kbd>Ctrl K</kbd>
        </button>
        <nav className="app-nav">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => (isActive ? 'active' : '')}
            >
              <item.icon size={15} />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar__footer">
          <NotificationBell />
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              isActive ? 'sidebar__gear sidebar__gear--active' : 'sidebar__gear'
            }
            title="Settings"
            aria-label="Settings"
            data-testid="settings-gear"
          >
            <SettingsIcon size={16} />
          </NavLink>
        </div>
      </aside>

      <main className="app-main">
        {!clientConfigured && (
          <div className="config-banner" data-testid="config-banner">
            ESI client_id is not configured — adding characters will fail. Set
            <code> MCO_ESI_CLIENT_ID</code> or edit <code>src/main/config.ts</code>.
          </div>
        )}

        <UpdateBanner />

        <SdeBanner />

        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/roster" element={<Roster />} />
          <Route path="/character/:id" element={<CharacterDetail />} />
          <Route path="/accounts" element={<Accounts />} />
          <Route path="/groups" element={<Groups />} />
          <Route path="/groups/:id" element={<GroupDetail />} />
          <Route path="/tags" element={<Tags />} />
          <Route path="/location" element={<Location />} />
          <Route path="/fits" element={<Fits />} />
          <Route path="/fits/:id" element={<FitDetail />} />
          <Route path="/plans" element={<Plans />} />
          <Route path="/plans/new" element={<PlanCreator />} />
          <Route path="/plans/compare" element={<PlanCompare />} />
          <Route path="/plans/:id" element={<PlanDetail />} />
          <Route path="/plans/:id/edit" element={<PlanCreator />} />
          <Route path="/clones" element={<Clones />} />
          <Route path="/blueprints" element={<Blueprints />} />
          <Route path="/wallet" element={<Wallet />} />
          <Route path="/mining" element={<Mining />} />
          <Route path="/mercenary-dens" element={<MercenaryDens />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>

      <ActivityIndicator />

      {paletteOpen && (
        <CommandPalette pages={PALETTE_PAGES} onClose={() => setPaletteOpen(false)} />
      )}
    </div>
  );
}
