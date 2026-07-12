import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { PlanAnalysis, PlanCharacterResult } from '@shared/types';
import { mco } from '../lib/ipc';
import { formatSp, romanLevel } from '../lib/format';

const DEFAULT_THRESHOLD = 500_000;

function MissingSkills({ result }: { result: PlanCharacterResult }) {
  if (result.missingSkills.length === 0) return null;
  return (
    <ul className="missing-skills">
      {result.missingSkills.map((s) => (
        <li key={s.skillTypeId}>
          {s.skillName ?? `Skill ${s.skillTypeId}`} {romanLevel(s.haveLevel)} →{' '}
          {romanLevel(s.needLevel)} <span className="muted">({formatSp(s.spDelta)})</span>
        </li>
      ))}
    </ul>
  );
}

export default function PlanDetail() {
  const params = useParams<{ id: string }>();
  const planId = Number(params.id);

  const [analysis, setAnalysis] = useState<PlanAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setAnalysis(await mco.plans.analyze(planId));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [planId]);

  useEffect(() => {
    void load();
  }, [load]);

  const buckets = useMemo(() => {
    const chars = analysis?.characters ?? [];
    const complete = chars
      .filter((c) => c.complete)
      .sort((a, b) => a.characterName.localeCompare(b.characterName));
    const near = chars
      .filter((c) => !c.complete && c.spGap <= threshold)
      .sort((a, b) => a.spGap - b.spGap);
    const far = chars.filter((c) => !c.complete && c.spGap > threshold).sort((a, b) => a.spGap - b.spGap);
    return { complete, near, far };
  }, [analysis, threshold]);

  return (
    <section className="page">
      <div className="toolbar">
        <h2>
          <Link to="/plans" className="back-link">
            ← Skill Plans
          </Link>
          {analysis ? ` · ${analysis.plan.name}` : ''}
        </h2>
        <button type="button" onClick={() => void load()} disabled={loading}>
          {loading ? 'Analysing…' : 'Re-analyse'}
        </button>
      </div>

      {error && <div className="error-box" data-testid="plan-detail-error">{error}</div>}

      {analysis && (
        <>
          {analysis.needsSkillData && (
            <div className="config-banner" data-testid="needs-skill-data">
              Static data has no skill-requirement data yet. Re-import static data (top of the
              Roster page) to enable plan analysis.
            </div>
          )}

          <div className="card">
            {analysis.unresolved.length > 0 && (
              <p className="error-box">
                Unrecognised skills (ignored): {analysis.unresolved.join(', ')}
              </p>
            )}
            <details className="fit-source">
              <summary>{analysis.plan.name}</summary>
              <pre className="eft-block">{analysis.plan.planText}</pre>
            </details>
          </div>

          {!analysis.needsSkillData && (
            <>
              <div className="toolbar">
                <label className="threshold-control">
                  “Almost there” threshold (SP):{' '}
                  <input
                    type="number"
                    min={0}
                    step={50_000}
                    value={threshold}
                    onChange={(e) => setThreshold(Math.max(0, Number(e.target.value) || 0))}
                    data-testid="threshold-input"
                  />
                </label>
              </div>

              <div className="detail-grid">
                <div className="card" data-testid="bucket-complete">
                  <h3>Plan complete ({buckets.complete.length})</h3>
                  {buckets.complete.length === 0 ? (
                    <p className="muted">No characters meet this plan yet.</p>
                  ) : (
                    <ul className="result-list">
                      {buckets.complete.map((c) => (
                        <li key={c.characterId}>{c.characterName}</li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="card" data-testid="bucket-near">
                  <h3>Within {formatSp(threshold)} ({buckets.near.length})</h3>
                  {buckets.near.length === 0 ? (
                    <p className="muted">Nobody is within the threshold.</p>
                  ) : (
                    <ul className="result-list">
                      {buckets.near.map((c) => (
                        <li key={c.characterId}>
                          <span className="result-row">
                            <strong>{c.characterName}</strong>
                            <span className="muted">{formatSp(c.spGap)} short</span>
                          </span>
                          <MissingSkills result={c} />
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="card" data-testid="bucket-far">
                  <h3>Further away ({buckets.far.length})</h3>
                  {buckets.far.length === 0 ? (
                    <p className="muted">Nobody else.</p>
                  ) : (
                    <ul className="result-list">
                      {buckets.far.map((c) => (
                        <li key={c.characterId}>
                          <span className="result-row">
                            <strong>{c.characterName}</strong>
                            <span className="muted">{formatSp(c.spGap)} short</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
