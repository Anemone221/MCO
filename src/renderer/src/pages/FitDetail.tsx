import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { FitCharacterResult } from '@shared/types';
import { mco } from '../lib/ipc';
import { useMcoData } from '../lib/useMcoData';
import { formatSp, romanLevel } from '../lib/format';
import { filterByGroup, memberIdSet, type GroupFilter } from '../lib/groups';
import {
  activeThreshold,
  compareByCost,
  costMetric,
  formatCost,
  formatThresholdLabel,
  loadCostView,
  saveCostView,
  type CostView,
} from '../lib/costView';
import GroupSelect from '../components/GroupSelect';
import CostControls from '../components/CostControls';
import BulkTagBar from '../components/BulkTagBar';
import { useCharacterContextMenu } from '../components/useCharacterContextMenu';

/**
 * A row's remaining cost in the selected system; unknown time says why unless
 * the page-level SDE banner already explains it (`sdeGap`).
 */
function CostLabel({
  view,
  result,
  sdeGap,
}: {
  view: CostView;
  result: FitCharacterResult;
  sdeGap: boolean;
}) {
  if (view.system === 'time' && result.timeGapMinutes === null) {
    return sdeGap ? (
      <span className="muted">—</span>
    ) : (
      <span className="muted" title="No training-time data — neural attributes not synced">
        — attributes not synced
      </span>
    );
  }
  const cost = formatCost(view.system, result);
  return <span className="muted">{view.system === 'sp' ? `${cost} short` : cost}</span>;
}

function MissingSkills({ result }: { result: FitCharacterResult }) {
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

export default function FitDetail() {
  const params = useParams<{ id: string }>();
  const fitId = Number(params.id);

  const [group, setGroup] = useState<GroupFilter>('all');
  const [view, setView] = useState<CostView>(() => loadCostView('fit', fitId));

  useEffect(() => {
    setView(loadCostView('fit', fitId));
  }, [fitId]);

  const changeView = useCallback(
    (next: CostView) => {
      setView(next);
      saveCostView('fit', fitId, next);
    },
    [fitId],
  );

  const { data, error, loading, reload, setData, setError } = useMcoData(
    async () => {
      const [analysis, groups, tags] = await Promise.all([
        mco.fits.analyze(fitId),
        mco.groups.list(),
        mco.tags.list(),
      ]);
      return { analysis, groups, tags };
    },
    { deps: [fitId] },
  );
  const { analysis = null, groups = [], tags = [] } = data ?? {};

  // Membership toggles don't change the analysis, so only refresh tags/groups.
  const reloadOrg = useCallback(async () => {
    const [groups, tags] = await Promise.all([mco.groups.list(), mco.tags.list()]);
    setData((prev) => (prev ? { ...prev, groups, tags } : prev));
  }, [setData]);

  const { openMenu, menuElement } = useCharacterContextMenu({
    tags,
    groups,
    onChanged: reloadOrg,
    onError: setError,
  });

  const buckets = useMemo(() => {
    const ids = memberIdSet(groups, group);
    const chars = filterByGroup(analysis?.characters ?? [], ids);
    const threshold = activeThreshold(view);
    const capable = chars.filter((c) => c.canFly).sort((a, b) => a.characterName.localeCompare(b.characterName));
    const rest = chars.filter((c) => !c.canFly).sort((a, b) => compareByCost(view.system, a, b));
    const near = rest.filter((c) => {
      const metric = costMetric(view.system, c);
      return metric !== null && metric <= threshold;
    });
    // Unknown time (unsynced attributes / missing SDE data) is conservatively far.
    const far = rest.filter((c) => !near.includes(c));
    return { capable, near, far };
  }, [analysis, groups, group, view]);

  const total = buckets.capable.length + buckets.near.length + buckets.far.length;

  return (
    <section className="page">
      <div className="toolbar">
        <h2>
          <Link to="/fits" className="back-link">
            ← Fits
          </Link>
          {analysis ? ` · ${analysis.fit.name}` : ''}
        </h2>
        <button type="button" className="ghost" onClick={() => void reload()} disabled={loading}>
          {loading ? 'Analysing…' : 'Re-analyse'}
        </button>
      </div>

      {error && <div className="error-box" data-testid="fit-detail-error">{error}</div>}

      {analysis && (
        <>
          {analysis.needsSkillData && (
            <div className="config-banner" data-testid="needs-skill-data">
              Static data has no skill-requirement data yet. Re-import static data (top of the
              Roster page) to enable fit analysis.
            </div>
          )}

          <div className="card">
            {analysis.unresolved.length > 0 && (
              <p className="error-box">
                Unrecognised items (ignored): {analysis.unresolved.join(', ')}
              </p>
            )}
            <details className="fit-source">
              <summary>
                {analysis.fit.shipName} ({analysis.fit.name})
              </summary>
              <pre className="eft-block">{analysis.fit.eftText}</pre>
            </details>
          </div>

          {!analysis.needsSkillData && (
            <>
              <div className="toolbar">
                <div className="stats-strip">
                  <span className="stat-chip stat-chip--ok">
                    <strong>
                      {buckets.capable.length}/{total}
                    </strong>{' '}
                    can fly
                  </span>
                  <span className="stat-chip stat-chip--warn">
                    <strong>{buckets.near.length}</strong> almost there
                  </span>
                  <span className="stat-chip">
                    <strong>{buckets.far.length}</strong> further away
                  </span>
                </div>
                <div className="toolbar__actions">
                  <GroupSelect
                    groups={groups}
                    value={group}
                    onChange={setGroup}
                    testId="fit-group-filter"
                  />
                  <CostControls view={view} onChange={changeView} />
                </div>
              </div>

              {view.system === 'time' && analysis.needsSkillAttributes && (
                <div className="config-banner" data-testid="needs-skill-attributes">
                  Training-time estimates need per-skill attribute data. Re-import static data
                  (banner at the top) to enable them.
                </div>
              )}

              <div className="card" data-testid="bucket-capable">
                <div className="bucket-head">
                  <h3>Can fly fully ({buckets.capable.length})</h3>
                  <BulkTagBar
                    tags={tags}
                    characterIds={buckets.capable.map((c) => c.characterId)}
                    onApplied={reloadOrg}
                    onError={setError}
                    testId="fit-bulk-tag"
                  />
                </div>
                {buckets.capable.length === 0 ? (
                  <p className="muted">No characters can fly this fit yet.</p>
                ) : (
                  <ul className="result-list result-list--columns">
                    {buckets.capable.map((c) => (
                      <li
                        key={c.characterId}
                        onContextMenu={(e) => openMenu(e, c.characterId, c.characterName)}
                        title="Right-click to assign tags or groups"
                      >
                        <Link to={`/character/${c.characterId}`}>{c.characterName}</Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="card" data-testid="bucket-near">
                <h3>Within {formatThresholdLabel(view)} ({buckets.near.length})</h3>
                {buckets.near.length === 0 ? (
                  <p className="muted">Nobody is within the threshold.</p>
                ) : (
                  <ul className="result-list">
                    {buckets.near.map((c) => (
                      <li
                        key={c.characterId}
                        onContextMenu={(e) => openMenu(e, c.characterId, c.characterName)}
                        title="Right-click to assign tags or groups"
                      >
                        <span className="result-row">
                          <Link to={`/character/${c.characterId}`}>
                            <strong>{c.characterName}</strong>
                          </Link>
                          <CostLabel view={view} result={c} sdeGap={analysis.needsSkillAttributes} />
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
                  <ul className="result-list result-list--columns">
                    {buckets.far.map((c) => (
                      <li
                        key={c.characterId}
                        onContextMenu={(e) => openMenu(e, c.characterId, c.characterName)}
                        title="Right-click to assign tags or groups"
                      >
                        <span className="result-row">
                          <Link to={`/character/${c.characterId}`}>{c.characterName}</Link>
                          <CostLabel view={view} result={c} sdeGap={analysis.needsSkillAttributes} />
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </>
      )}

      {menuElement}
    </section>
  );
}
