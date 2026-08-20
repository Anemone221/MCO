import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { PlanCharacterResult } from '@shared/types';
import { errorMessage, mco } from '../lib/ipc';
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
  result: PlanCharacterResult;
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

  const [group, setGroup] = useState<GroupFilter>('all');
  const [view, setView] = useState<CostView>(() => loadCostView('plan', planId));

  useEffect(() => {
    setView(loadCostView('plan', planId));
  }, [planId]);

  const changeView = useCallback(
    (next: CostView) => {
      setView(next);
      saveCostView('plan', planId, next);
    },
    [planId],
  );

  const { data, error, loading, reload, setData, setError } = useMcoData(
    async () => {
      const [analysis, groups, tags] = await Promise.all([
        mco.plans.analyze(planId),
        mco.groups.list(),
        mco.tags.list(),
      ]);
      return { analysis, groups, tags };
    },
    { deps: [planId] },
  );
  const { analysis = null, groups = [], tags = [] } = data ?? {};

  // Membership toggles don't change the analysis, so only refresh tags/groups.
  const reloadOrg = useCallback(async () => {
    const [groups, tags] = await Promise.all([mco.groups.list(), mco.tags.list()]);
    setData((prev) => (prev ? { ...prev, groups, tags } : prev));
  }, [setData]);

  // Only the plan record changes, so the (expensive) analysis is patched rather
  // than re-run — optimistically, so the checkbox tracks the click rather than
  // snapping back until the write returns; a failed write puts it back.
  const setSheetVisibility = useCallback(
    async (show: boolean) => {
      setError(null);
      const patch = (value: boolean): void =>
        setData((prev) =>
          prev
            ? {
                ...prev,
                analysis: {
                  ...prev.analysis,
                  plan: { ...prev.analysis.plan, showOnCharacterSheet: value },
                },
              }
            : prev,
        );
      patch(show);
      try {
        const plan = await mco.plans.setSheetVisibility(planId, show);
        setData((prev) => (prev ? { ...prev, analysis: { ...prev.analysis, plan } } : prev));
      } catch (e) {
        patch(!show);
        setError(errorMessage(e));
      }
    },
    [planId, setData, setError],
  );

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
    const complete = chars
      .filter((c) => c.complete)
      .sort((a, b) => a.characterName.localeCompare(b.characterName));
    const rest = chars.filter((c) => !c.complete).sort((a, b) => compareByCost(view.system, a, b));
    const near = rest.filter((c) => {
      const metric = costMetric(view.system, c);
      return metric !== null && metric <= threshold;
    });
    // Unknown time (unsynced attributes / missing SDE data) is conservatively far.
    const far = rest.filter((c) => !near.includes(c));
    return { complete, near, far };
  }, [analysis, groups, group, view]);

  const total = buckets.complete.length + buckets.near.length + buckets.far.length;

  return (
    <section className="page">
      <div className="toolbar">
        <h2>
          <Link to="/plans" className="back-link">
            ← Skill Plans
          </Link>
          {analysis ? ` · ${analysis.plan.name}` : ''}
        </h2>
        <div className="toolbar__actions">
          {analysis && (
            <label
              className="sheet-toggle"
              title="Show this plan's progress bar on every character sheet"
            >
              <input
                type="checkbox"
                checked={analysis.plan.showOnCharacterSheet}
                onChange={(e) => void setSheetVisibility(e.target.checked)}
                data-testid="plan-sheet-toggle"
              />{' '}
              On character sheets
            </label>
          )}
          <Link to={`/plans/${planId}/edit`} className="link-btn" data-testid="edit-plan">
            Edit plan
          </Link>
          <button type="button" className="ghost" onClick={() => void reload()} disabled={loading}>
            {loading ? 'Analysing…' : 'Re-analyse'}
          </button>
        </div>
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
                <div className="stats-strip">
                  <span className="stat-chip stat-chip--ok">
                    <strong>
                      {buckets.complete.length}/{total}
                    </strong>{' '}
                    complete
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
                    testId="plan-group-filter"
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

              <div className="card" data-testid="bucket-complete">
                <div className="bucket-head">
                  <h3>Plan complete ({buckets.complete.length})</h3>
                  <BulkTagBar
                    tags={tags}
                    characterIds={buckets.complete.map((c) => c.characterId)}
                    onApplied={reloadOrg}
                    onError={setError}
                    testId="plan-bulk-tag"
                  />
                </div>
                {buckets.complete.length === 0 ? (
                  <p className="muted">No characters meet this plan yet.</p>
                ) : (
                  <ul className="result-list result-list--columns">
                    {buckets.complete.map((c) => (
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
