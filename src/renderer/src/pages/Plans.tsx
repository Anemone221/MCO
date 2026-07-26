import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { SkillPlan } from '@shared/types';
import { mco } from '../lib/ipc';
import { formatDate } from '../lib/format';

export default function Plans() {
  const [plans, setPlans] = useState<SkillPlan[]>([]);
  const [name, setName] = useState('');
  const [planText, setPlanText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const load = useCallback(async () => {
    setPlans(await mco.plans.list());
  }, []);

  useEffect(() => {
    void load().catch((e: unknown) => setError(String(e)));
  }, [load]);

  async function importPlan(): Promise<void> {
    const trimmedName = name.trim();
    const trimmedText = planText.trim();
    if (!trimmedName || !trimmedText) return;
    setBusy(true);
    setError(null);
    try {
      await mco.plans.import(trimmedName, trimmedText);
      setName('');
      setPlanText('');
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function removePlan(id: number, name: string): Promise<void> {
    if (!(await mco.system.confirm(`Remove skill plan "${name}"?`, 'Remove'))) return;
    setError(null);
    try {
      await mco.plans.remove(id);
      await load();
    } catch (e) {
      setError(String(e));
    }
  }

  // The paste form is always shown while the list is empty; once plans exist it
  // collapses behind a toolbar button so the list gets the space.
  const showImport = importOpen || plans.length === 0;

  return (
    <section className="page">
      <div className="toolbar">
        <h2>Skill Plans ({plans.length})</h2>
        {plans.length > 0 && (
          <button
            type="button"
            className="ghost"
            onClick={() => setImportOpen((prev) => !prev)}
            data-testid="toggle-import-plan"
          >
            {showImport ? 'Hide import' : 'Import plan…'}
          </button>
        )}
      </div>

      {showImport && (
        <div className="card">
          <h3>Import a skill plan</h3>
          <p className="muted">
            Paste a list of skills, one per line, each ending in a level (e.g. "Gunnery V").
          </p>
          <div className="toolbar__actions">
            <input
              value={name}
              placeholder="Plan name"
              disabled={busy}
              onChange={(e) => setName(e.target.value)}
              data-testid="plan-name-input"
            />
          </div>
          <textarea
            className="eft-input"
            rows={8}
            value={planText}
            placeholder={'Gunnery V\nSmall Hybrid Turret IV\n...'}
            onChange={(e) => setPlanText(e.target.value)}
            data-testid="plan-text-input"
          />
          <div className="toolbar__actions">
            <button
              type="button"
              disabled={busy}
              onClick={() => void importPlan()}
              data-testid="import-plan"
            >
              {busy ? 'Importing…' : 'Import plan'}
            </button>
          </div>
        </div>
      )}

      {error && <div className="error-box" data-testid="plans-error">{error}</div>}

      {plans.length === 0 ? (
        <div className="empty-state">
          <h3>No skill plans yet</h3>
          <p>Paste a list of skills above to track your roster's progress against it.</p>
        </div>
      ) : (
        <table className="data-table" data-testid="plans-table">
          <thead>
            <tr>
              <th>Plan</th>
              <th>Imported</th>
              <th aria-label="actions" />
            </tr>
          </thead>
          <tbody>
            {plans.map((plan) => (
              <tr key={plan.id} data-testid={`plan-row-${plan.id}`}>
                <td>
                  <Link to={`/plans/${plan.id}`}>{plan.name}</Link>
                </td>
                <td className="muted">{formatDate(plan.importedAt)}</td>
                <td className="row-actions">
                  <button
                    type="button"
                    className="danger btn-sm"
                    onClick={() => void removePlan(plan.id, plan.name)}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
