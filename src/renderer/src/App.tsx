import { useEffect, useState } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import Roster from './pages/Roster';
import CharacterDetail from './pages/CharacterDetail';
import Accounts from './pages/Accounts';
import Location from './pages/Location';
import Fits from './pages/Fits';
import FitDetail from './pages/FitDetail';
import Plans from './pages/Plans';
import PlanDetail from './pages/PlanDetail';
import SdeBanner from './components/SdeBanner';
import { mco } from './lib/ipc';

export default function App() {
  const [clientConfigured, setClientConfigured] = useState(true);

  useEffect(() => {
    void mco.system.isClientConfigured().then(setClientConfigured);
  }, []);

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>MCO</h1>
        <p className="tagline">Massive Character Organization</p>
        <nav className="app-nav">
          <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : '')}>
            Roster
          </NavLink>
          <NavLink to="/accounts" className={({ isActive }) => (isActive ? 'active' : '')}>
            Accounts
          </NavLink>
          <NavLink to="/location" className={({ isActive }) => (isActive ? 'active' : '')}>
            Location
          </NavLink>
          <NavLink to="/fits" className={({ isActive }) => (isActive ? 'active' : '')}>
            Fits
          </NavLink>
          <NavLink to="/plans" className={({ isActive }) => (isActive ? 'active' : '')}>
            Skill Plans
          </NavLink>
        </nav>
      </header>

      {!clientConfigured && (
        <div className="config-banner" data-testid="config-banner">
          ESI client_id is not configured — adding characters will fail. Set
          <code> MCO_ESI_CLIENT_ID</code> or edit <code>src/main/config.ts</code>.
        </div>
      )}

      <SdeBanner />

      <Routes>
        <Route path="/" element={<Roster />} />
        <Route path="/character/:id" element={<CharacterDetail />} />
        <Route path="/accounts" element={<Accounts />} />
        <Route path="/location" element={<Location />} />
        <Route path="/fits" element={<Fits />} />
        <Route path="/fits/:id" element={<FitDetail />} />
        <Route path="/plans" element={<Plans />} />
        <Route path="/plans/:id" element={<PlanDetail />} />
      </Routes>
    </div>
  );
}
