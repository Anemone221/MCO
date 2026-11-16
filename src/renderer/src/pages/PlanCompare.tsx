import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { errorMessage, mco } from '../lib/ipc';
import { useMcoData } from '../lib/useMcoData';
import { formatSp, romanLevel } from '../lib/format';
import { draftText, mergeSkills, type SkillMap } from '../lib/planDraft';
import {
  diffPlans,
  planDelta,
  STATUS_LABEL,
  STATUS_ORDER,
  type DiffStatus,
  type PlanDiffRow,
} from '../lib/planDiff';
import SortHeader from '../components/SortHeader';

/** Remembered per viewer: whether levels implied by prerequisites count. */
const PREREQS_KEY = 'mco-plan-compare-prereqs';

type View = 'differences' | 'only-a' | 'only-b' | 'level' | 'same' | 'all';
type SortKey = 'status' | 'name' | 'group' | 'a' | 'b' | 'delta';

const VIEWS: Array<{ id: View; label: string }> = [
  { id: 'differences', label: 'Differences' },
  { id: 'only-a', label: 'Only in A' },
  { id: 'only-b', label: 'Only in B' },
  { id: 'level', label: 'Level differs' },
  { id: 'same', label: 'Shared' },
  { id: 'all', label: 'All' },
];

function inView(status: DiffStatus, view: View): boolean {
  switch (view) {
    case 'differences':
      return status !== 'same';
    case 'level':
      return status === 'a-higher' || status === 'b-higher';
    case 'all':
      return true;
    default:
      return status === view;
  }
}

function loadPrereqs(): boolean {
  try {
    return localStorage.getItem(PREREQS_KEY) !== 'off';
  } catch {
    return true;
  }
}

function storePrereqs(on: boolean): void {
  try {
    localStorage.setItem(PREREQS_KEY, on ? 'on' : 'off');
  } catch {
    // Only a convenience; the toggle still works for this visit.
  }
}

/** SP B costs over A for this skill; null when either side can't be costed. */
function spDelta(row: PlanDiffRow): number | null {
  return row.spA === null || row.spB === null ? null : row.spB - row.spA;
}

function compareRows(x: PlanDiffRow, y: PlanDiffRow, key: SortKey): number {
  switch (key) {
    case 'name':
      return x.name.localeCompare(y.name);
    case 'group':
      return (x.groupName ?? '').localeCompare(y.groupName ?? '') || x.name.localeCompare(y.name);
    case 'a':
      return x.levelA - y.levelA || x.name.localeCompare(y.name);
    case 'b':
      return x.levelB - y.levelB || x.name.localeCompare(y.name);
    case 'delta':
      return (spDelta(x) ?? 0) - (spDelta(y) ?? 0) || x.name.localeCompare(y.name);
    case 'status':
      return STATUS_ORDER[x.status] - STATUS_ORDER[y.status];
  }
}

/** A plan's level for one skill: "—" when absent, dimmed when only a prerequisite needs it. */
function LevelCell({
  level,
  written,
  higher,
}: {
  level: number;
  written: number;
  higher: boolean;
}) {
  if (level === 0) return <td className="num muted">—</td>;
  const implied = written < level;
  return (
    <td
      className={`num${implied ? ' muted' : ''}${higher ? ' plan-diff__higher' : ''}`}
      title={
        implied
          ? written === 0
            ? 'Not written in the plan; needed as a prerequisite'
            : `Written as ${romanLevel(written)}; a prerequisite needs ${romanLevel(level)}`
          : undefined
      }
    >
      {romanLevel(level)}
      {implied && '*'}
    </td>
  );
}

function formatSignedSp(sp: number | null): string {
  if (sp === null) return '—';
  if (sp === 0) return '0';
  return `${sp > 0 ? '+' : '−'}${formatSp(Math.abs(sp))}`;
}

export default function PlanCompare() {
  const [params, setParams] = useSearchParams();
  const idA = Number(params.get('a')) || null;
  const idB = Number(params.get('b')) || null;

  const [includePrereqs, setIncludePrereqs] = useState(loadPrereqs);
  const [view, setView] = useState<View>('differences');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({
    key: 'status',
    dir: 'asc',
  });
  const [notice, setNotice] = useState<string | null>(null);

  const base = useMcoData(async () => {
    const [plans, catalog, sde] = await Promise.all([
      mco.plans.list(),
      mco.plans.skillCatalog(),
      mco.sde.status(),
    ]);
    return { plans, catalog, sde };
  });
  const plans = base.data?.plans ?? [];
  const skills: SkillMap = useMemo(
    () => mergeSkills(new Map(), base.data?.catalog ?? []),
    [base.data?.catalog],
  );

  const drafts = useMcoData(
    async () => {
      if (idA === null || idB === null) return null;
      const [a, b] = await Promise.all([mco.plans.draft(idA), mco.plans.draft(idB)]);
      return { a, b };
    },
    { deps: [idA, idB] },
  );

  useEffect(() => {
    if (notice === null) return;
    const timer = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const diff = useMemo(
    () =>
      drafts.data
        ? diffPlans(drafts.data.a.entries, drafts.data.b.entries, skills, { includePrereqs })
        : null,
    [drafts.data, skills, includePrereqs],
  );

  const rows = useMemo(() => {
    if (!diff) return [];
    const query = search.trim().toLowerCase();
    const shown = diff.rows.filter(
      (r) =>
        inView(r.status, view) &&
        (query === '' ||
          r.name.toLowerCase().includes(query) ||
          (r.groupName ?? '').toLowerCase().includes(query)),
    );
    // The default order is diffPlans' own (status, group, name); a column sort
    // replaces it, falling back to that order on ties.
    if (sort.key === 'status' && sort.dir === 'asc') return shown;
    const sign = sort.dir === 'asc' ? 1 : -1;
    return [...shown].sort((x, y) => sign * compareRows(x, y, sort.key));
  }, [diff, view, search, sort]);

  const nameA = plans.find((p) => p.id === idA)?.name ?? 'Plan A';
  const nameB = plans.find((p) => p.id === idB)?.name ?? 'Plan B';

  function pick(side: 'a' | 'b', id: string): void {
    const next = new URLSearchParams(params);
    if (id) next.set(side, id);
    else next.delete(side);
    setParams(next, { replace: true });
  }

  function swap(): void {
    const next = new URLSearchParams(params);
    if (idB !== null) next.set('a', String(idB));
    else next.delete('a');
    if (idA !== null) next.set('b', String(idA));
    else next.delete('b');
    setParams(next, { replace: true });
  }

  function toggleSort(key: SortKey): void {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'delta' ? 'desc' : 'asc' },
    );
  }

  async function copyDelta(toB: boolean): Promise<void> {
    if (!drafts.data) return;
    const { a, b } = drafts.data;
    const entries = toB
      ? planDelta(a.entries, b.entries, skills)
      : planDelta(b.entries, a.entries, skills);
    const target = toB ? nameB : nameA;
    const source = toB ? nameA : nameB;
    if (entries.length === 0) {
      setNotice(`"${source}" already covers everything in "${target}".`);
      return;
    }
    try {
      await mco.system.copyText(draftText(entries, { includeRemaps: false }));
      setNotice(
        `Copied ${entries.length} skill level${entries.length === 1 ? '' : 's'}: what "${target}" adds after "${source}".`,
      );
    } catch (e) {
      drafts.setError(errorMessage(e));
    }
  }

  const error = base.error ?? drafts.error;
  const summary = diff?.summary;
  // With nothing costed (no static data) every total is 0, which would read as
  // a real figure; show "—" instead.
  const costed = !!diff && !!summary && diff.rows.length > summary.uncosted;
  const spTotal = (sp: number): string => (costed ? formatSp(sp) : '—');
  const counts: Record<View, number> | null = summary
    ? {
        differences: summary.onlyA + summary.onlyB + summary.aHigher + summary.bHigher,
        'only-a': summary.onlyA,
        'only-b': summary.onlyB,
        level: summary.aHigher + summary.bHigher,
        same: summary.same,
        all: diff.rows.length,
      }
    : null;

  const sortHeader = (key: SortKey, label: string, numeric = false) => (
    <SortHeader
      label={label}
      active={sort.key === key}
      dir={sort.dir}
      numeric={numeric}
      onSort={() => toggleSort(key)}
      testId={`compare-sort-${key}`}
    />
  );

  return (
    <section className="page">
      <div className="toolbar">
        <h2>
          <Link to="/plans" className="back-link">
            ← Skill Plans
          </Link>
          {' · Compare'}
        </h2>
        <label
          className="sheet-toggle"
          title="Count the levels a plan needs through prerequisites, not only the ones it writes"
        >
          <input
            type="checkbox"
            checked={includePrereqs}
            onChange={(e) => {
              storePrereqs(e.target.checked);
              setIncludePrereqs(e.target.checked);
            }}
            data-testid="compare-prereqs"
          />{' '}
          Count prerequisites
        </label>
      </div>

      <div className="filter-bar plan-diff__pickers">
        <label>
          A{' '}
          <select
            value={idA ?? ''}
            onChange={(e) => pick('a', e.target.value)}
            data-testid="compare-plan-a"
          >
            <option value="">Choose a plan…</option>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="ghost btn-sm"
          onClick={swap}
          title="Swap A and B"
          data-testid="compare-swap"
        >
          ⇄
        </button>
        <label>
          B{' '}
          <select
            value={idB ?? ''}
            onChange={(e) => pick('b', e.target.value)}
            data-testid="compare-plan-b"
          >
            <option value="">Choose a plan…</option>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && (
        <div className="error-box" data-testid="compare-error">
          {error}
        </div>
      )}
      {notice && (
        <div className="creator-notice" data-testid="compare-notice">
          {notice}
        </div>
      )}
      {base.data && !base.data.sde.hasSkillData && (
        <div className="config-banner">
          Static data has no skill data yet, so prerequisites and SP can't be counted. Import it
          from the banner at the top of the Roster page.
        </div>
      )}

      {plans.length < 2 && base.data ? (
        <div className="empty-state">
          <h3>Two plans are needed to compare</h3>
          <p>
            Import or <Link to="/plans/new">create</Link> another skill plan first.
          </p>
        </div>
      ) : idA === null || idB === null ? (
        <p className="muted">
          Choose two plans to see what each one asks for that the other doesn't.
        </p>
      ) : (
        diff &&
        summary &&
        counts && (
          <>
            <dl className="plan-diff__summary" data-testid="compare-summary">
              <div>
                <dt>A · {nameA}</dt>
                <dd>{spTotal(summary.totalSpA)}</dd>
              </div>
              <div>
                <dt>B · {nameB}</dt>
                <dd>{spTotal(summary.totalSpB)}</dd>
              </div>
              <div title="SP a character who has finished A still needs to finish B">
                <dt>B needs beyond A</dt>
                <dd>{spTotal(summary.spBBeyondA)}</dd>
              </div>
              <div title="SP a character who has finished B still needs to finish A">
                <dt>A needs beyond B</dt>
                <dd>{spTotal(summary.spABeyondB)}</dd>
              </div>
              <div className="plan-diff__copy">
                <button
                  type="button"
                  className="ghost btn-sm"
                  onClick={() => void copyDelta(true)}
                  title="Copy, as a skill plan, the training that takes a character from A to B"
                  data-testid="compare-copy-b"
                >
                  Copy A → B
                </button>
                <button
                  type="button"
                  className="ghost btn-sm"
                  onClick={() => void copyDelta(false)}
                  title="Copy, as a skill plan, the training that takes a character from B to A"
                  data-testid="compare-copy-a"
                >
                  Copy B → A
                </button>
              </div>
            </dl>
            {summary.uncosted > 0 && (
              <p className="muted">
                {summary.uncosted} skill{summary.uncosted === 1 ? '' : 's'} could not be costed
                (unknown to the static data), so the SP totals are a floor.
              </p>
            )}

            <div className="filter-bar">
              <div className="tab-bar tab-bar--inline" role="tablist" aria-label="Show">
                {VIEWS.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    role="tab"
                    aria-selected={v.id === view}
                    className={`tab${v.id === view ? ' tab--active' : ''}`}
                    onClick={() => setView(v.id)}
                    data-testid={`compare-view-${v.id}`}
                  >
                    {v.label} ({counts[v.id]})
                  </button>
                ))}
              </div>
              <input
                type="search"
                placeholder="Filter skill or group…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                data-testid="compare-search"
              />
            </div>

            {counts.differences === 0 && view === 'differences' ? (
              <p className="muted" data-testid="compare-identical">
                These plans need exactly the same skills at the same levels
                {includePrereqs ? ', prerequisites included' : ''}.
              </p>
            ) : (
              <table className="data-table plan-diff" data-testid="compare-table">
                <thead>
                  <tr>
                    {sortHeader('name', 'Skill')}
                    {sortHeader('group', 'Group')}
                    {sortHeader('a', 'A', true)}
                    {sortHeader('b', 'B', true)}
                    {sortHeader('delta', 'SP B − A', true)}
                    {sortHeader('status', 'Difference')}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.key} data-testid={`compare-row-${r.key}`}>
                      <td>{r.name}</td>
                      <td className="muted">{r.groupName ?? '—'}</td>
                      <LevelCell
                        level={r.levelA}
                        written={r.writtenA}
                        higher={r.levelA > r.levelB}
                      />
                      <LevelCell
                        level={r.levelB}
                        written={r.writtenB}
                        higher={r.levelB > r.levelA}
                      />
                      <td className="num muted">{formatSignedSp(spDelta(r))}</td>
                      <td className={r.status === 'same' ? 'muted' : undefined}>
                        {STATUS_LABEL[r.status]}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {includePrereqs && (
              <p className="muted plan-diff__legend">
                * needed as a prerequisite, not written in the plan at that level.
              </p>
            )}
          </>
        )
      )}
    </section>
  );
}
