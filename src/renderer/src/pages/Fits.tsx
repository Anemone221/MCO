import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Fit } from '@shared/types';
import { mco } from '../lib/ipc';
import { formatDate } from '../lib/format';

export default function Fits() {
  const [fits, setFits] = useState<Fit[]>([]);
  const [eftText, setEftText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const load = useCallback(async () => {
    setFits(await mco.fits.list());
  }, []);

  useEffect(() => {
    void load().catch((e: unknown) => setError(String(e)));
  }, [load]);

  async function importFit(): Promise<void> {
    const text = eftText.trim();
    if (!text) return;
    setBusy(true);
    setError(null);
    try {
      await mco.fits.import(text);
      setEftText('');
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function removeFit(id: number, name: string): Promise<void> {
    if (!(await mco.system.confirm(`Remove fit "${name}"?`, 'Remove'))) return;
    setError(null);
    try {
      await mco.fits.remove(id);
      await load();
    } catch (e) {
      setError(String(e));
    }
  }

  // The paste form is always shown while the list is empty; once fits exist it
  // collapses behind a toolbar button so the list gets the space.
  const showImport = importOpen || fits.length === 0;

  return (
    <section className="page">
      <div className="toolbar">
        <h2>Fits ({fits.length})</h2>
        {fits.length > 0 && (
          <button
            type="button"
            className="ghost"
            onClick={() => setImportOpen((prev) => !prev)}
            data-testid="toggle-import-fit"
          >
            {showImport ? 'Hide import' : 'Import fit…'}
          </button>
        )}
      </div>

      {showImport && (
        <div className="card">
          <h3>Import a fit</h3>
          <p className="muted">
            Paste an EFT block from pyfa (Edit → Export → EFT, or copy to clipboard).
          </p>
          <textarea
            className="eft-input"
            rows={8}
            value={eftText}
            placeholder={'[Rifter, My Rifter]\n200mm AutoCannon II\n...'}
            onChange={(e) => setEftText(e.target.value)}
            data-testid="eft-input"
          />
          <div className="toolbar__actions">
            <button type="button" disabled={busy} onClick={() => void importFit()} data-testid="import-fit">
              {busy ? 'Importing…' : 'Import fit'}
            </button>
          </div>
        </div>
      )}

      {error && <div className="error-box" data-testid="fits-error">{error}</div>}

      {fits.length === 0 ? (
        <div className="empty-state">
          <h3>No fits yet</h3>
          <p>Paste a pyfa EFT export above to analyse it against your roster.</p>
        </div>
      ) : (
        <table className="data-table" data-testid="fits-table">
          <thead>
            <tr>
              <th>Fit</th>
              <th>Ship</th>
              <th>Imported</th>
              <th aria-label="actions" />
            </tr>
          </thead>
          <tbody>
            {fits.map((fit) => (
              <tr key={fit.id} data-testid={`fit-row-${fit.id}`}>
                <td>
                  <Link to={`/fits/${fit.id}`}>{fit.name}</Link>
                </td>
                <td>{fit.shipName}</td>
                <td className="muted">{formatDate(fit.importedAt)}</td>
                <td className="row-actions">
                  <button
                    type="button"
                    className="danger btn-sm"
                    onClick={() => void removeFit(fit.id, fit.name)}
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
