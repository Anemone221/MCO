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
import Clones from './pages/Clones';
import Blueprints from './pages/Blueprints';
import Wallet from './pages/Wallet';
import Settings from './pages/Settings';
import SdeBanner from './components/SdeBanner';
import UpdateBanner from './components/UpdateBanner';
import NotificationBell from './components/NotificationBell';
import {
  BlueprintIcon,
  CopyIcon,
  CreditCardIcon,
  DashboardIcon,
  GraduationCapIcon,
  LayersIcon,
  MapPinIcon,
  RocketIcon,
  SettingsIcon,
  TagIcon,
  UsersIcon,
  WalletIcon,
} from './components/icons';
import { mco } from './lib/ipc';

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
];

export default function App() {
  const [clientConfigured, setClientConfigured] = useState(true);

  useEffect(() => {
    void mco.system.isClientConfigured().then(setClientConfigured);
  }, []);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar__brand">
          <h1>MCO</h1>
          <p className="tagline">Massive Character Organizer</p>
        </div>
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
          <Route path="/plans/:id" element={<PlanDetail />} />
          <Route path="/plans/:id/edit" element={<PlanCreator />} />
          <Route path="/clones" element={<Clones />} />
          <Route path="/blueprints" element={<Blueprints />} />
          <Route path="/wallet" element={<Wallet />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </div>
  );
}
