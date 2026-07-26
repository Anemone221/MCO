import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { Link, useParams } from 'react-router-dom';
import type {
  Fit,
  GroupDetail as GroupDetailData,
  GroupMemberStatus,
  GroupObjectiveStatus,
  PodIgnoredEntry,
  PodViolation,
  RosterEntry,
  SkillPlan,
  StructureSearchResult,
  SystemSearchResult,
} from '@shared/types';
import { mco } from '../lib/ipc';
import { formatSecurity, formatSp, formatTimeUntil, romanLevel, securityTier } from '../lib/format';
import {
  loadPodSectionCollapsed,
  medicalCloneMismatch,
  savePodSectionCollapsed,
  summarizeQueue,
} from '../lib/groupView';
import { formatCost, loadCostView, type CostSystem } from '../lib/costView';
import CharacterAvatar from '../components/CharacterAvatar';

function QueueLine({ member }: { member: GroupMemberStatus }) {
  const queue = summarizeQueue(member.queueLength, member.queueEndDate);
  switch (queue.state) {
    case 'empty':
      return <span className="muted">—</span>;
    case 'paused':
      return (
        <span>
          {queue.queued} queued · <span className="queue-paused">paused</span>
        </span>
      );
    case 'finished':
      return <span>{queue.queued} queued · finished</span>;
    case 'active':
      return (
        <span>
          {queue.queued} queued · ends {formatTimeUntil(queue.endDate)}
        </span>
      );
  }
}

/** Progress bar toward the group's priority fit or plan, one per member card. */
function ObjectiveBar({
  kind,
  name,
  to,
  status,
  system,
  completeText,
  testId,
}: {
  kind: string;
  name: string;
  to: string;
  status: GroupObjectiveStatus;
  system: CostSystem;
  completeText: string;
  testId: string;
}) {
  const pct = status.progress * 100;
  // Unknown time falls back to the SP gap — the compact label has no room to
  // explain why the estimate is missing.
  const timeUnknown = system === 'time' && status.timeGapMinutes === null;
  const costText = timeUnknown ? formatSp(status.spGap) : formatCost(system, status);
  return (
    <div className="plan-progress" data-testid={testId}>
      <div className="plan-progress__label">
        <span className="objective-name">
          <span className="muted">{kind}</span> <Link to={to}>{name}</Link>
        </span>
        <span
          className={status.complete ? 'objective-done' : 'muted'}
          title={
            timeUnknown
              ? 'No training-time data — attributes not synced or static data needs re-import'
              : undefined
          }
        >
          {status.complete ? completeText : `${Math.floor(pct)}% · ${costText} left`}
        </span>
      </div>
      <div className="plan-progress__bar">
        <div
          className="plan-progress__fill"
          style={{
            width: `${pct}%`,
            // Hue tracks completion: pure red at 0%, through amber, pure green at 100%.
            background: `color-mix(in hsl, var(--ok) ${pct}%, var(--danger))`,
          }}
        />
      </div>
    </div>
  );
}

/**
 * Type-ahead over imported structures to pick the group's home station.
 * Once set, shows the station name with a Clear button instead of the input.
 */
function HomeStationPicker({
  current,
  disabled,
  onSelect,
}: {
  current: { id: number; name: string } | null;
  disabled: boolean;
  onSelect: (station: { id: number; name: string } | null) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<StructureSearchResult[]>([]);

  useEffect(() => {
    const needle = query.trim();
    if (needle.length < 2) {
      setResults([]);
      return;
    }
    // Debounced so we don't hit the DB on every keystroke.
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void mco.structures.search(needle).then((hits) => {
        if (!cancelled) setResults(hits);
      });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  if (current) {
    return (
      <div className="station-picker__current" data-testid="home-station-current">
        <span title={current.name}>{current.name}</span>
        <button
          type="button"
          className="ghost btn-sm"
          disabled={disabled}
          onClick={() => onSelect(null)}
          data-testid="home-station-clear"
        >
          Clear
        </button>
      </div>
    );
  }

  return (
    <div className="station-picker">
      <input
        type="search"
        placeholder="Search structures…"
        value={query}
        disabled={disabled}
        onChange={(e) => setQuery(e.target.value)}
        data-testid="home-station-search"
      />
      {query.trim().length >= 2 && (
        <div className="station-picker__results" data-testid="home-station-results">
          {results.length === 0 ? (
            <span className="station-picker__empty muted">
              No imported structure matches — import structures on the Location page.
            </span>
          ) : (
            results.map((hit) => (
              <button
                key={hit.structureId}
                type="button"
                className="station-picker__option"
                disabled={disabled}
                onClick={() => {
                  setQuery('');
                  onSelect({ id: hit.structureId, name: hit.name });
                }}
                data-testid={`home-station-option-${hit.structureId}`}
              >
                {hit.name}
                {hit.systemName && <span className="muted"> — {hit.systemName}</span>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Type-ahead over SDE solar systems to add entries to the pod whitelist.
 * Unlike the home-station picker the input stays put after a pick — the
 * whitelist usually holds more than one system.
 */
function PodSystemPicker({
  excludeIds,
  disabled,
  onSelect,
}: {
  excludeIds: Set<number>;
  disabled: boolean;
  onSelect: (system: { id: number; name: string }) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SystemSearchResult[]>([]);

  useEffect(() => {
    const needle = query.trim();
    if (needle.length < 2) {
      setResults([]);
      return;
    }
    // Debounced so we don't hit the DB on every keystroke.
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void mco.systems.search(needle).then((hits) => {
        if (!cancelled) setResults(hits);
      });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  const options = results.filter((hit) => !excludeIds.has(hit.solarSystemId));

  return (
    <div className="station-picker pod-whitelist__picker">
      <input
        type="search"
        placeholder="Add system…"
        value={query}
        disabled={disabled}
        onChange={(e) => setQuery(e.target.value)}
        data-testid="pod-system-search"
      />
      {query.trim().length >= 2 && (
        <div className="station-picker__results" data-testid="pod-system-results">
          {options.length === 0 ? (
            <span className="station-picker__empty muted">
              No matching system — static data with map info may need importing (top of the
              Roster page).
            </span>
          ) : (
            options.map((hit) => (
              <button
                key={hit.solarSystemId}
                type="button"
                className="station-picker__option"
                disabled={disabled}
                onClick={() => {
                  setQuery('');
                  onSelect({ id: hit.solarSystemId, name: hit.name });
                }}
                data-testid={`pod-system-option-${hit.solarSystemId}`}
              >
                <span className={`sec-${securityTier(hit.security)}`}>
                  {formatSecurity(hit.security)}
                </span>{' '}
                {hit.name}
                {hit.regionName && <span className="muted"> · {hit.regionName}</span>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/** "Active pod" or "Jump clone · name" — shared by both pod tables. */
function PodLabel({ pod }: { pod: { kind: 'active' | 'jump-clone'; cloneName: string | null } }) {
  if (pod.kind === 'active') return <>Active pod</>;
  return (
    <>Jump clone{pod.cloneName && <span className="muted"> · {pod.cloneName}</span>}</>
  );
}

/** One flagged pod: who, which clone, and where it verifiably (or not) sits. */
function PodViolationRow({
  violation,
  onContextMenu,
}: {
  violation: PodViolation;
  onContextMenu: (e: ReactMouseEvent) => void;
}) {
  return (
    <tr
      data-testid={`pod-violation-${violation.characterId}-${violation.kind}`}
      onContextMenu={onContextMenu}
    >
      <td>
        <Link to={`/character/${violation.characterId}`}>{violation.characterName}</Link>
      </td>
      <td>
        <PodLabel pod={violation} />
      </td>
      <td className="num">{violation.implantCount}</td>
      <td>
        {violation.systemId !== null ? (
          <span className="med-clone-away">
            {violation.systemName ?? `System ${violation.systemId}`}
          </span>
        ) : (
          // Unresolved structure: can't verify the system — shown, not alarmed.
          <span className="muted">unresolved</span>
        )}
      </td>
      <td>
        {violation.kind === 'active' ? (
          <span className="muted">—</span>
        ) : (
          (violation.locationName ??
            (violation.locationId !== null ? `Location ${violation.locationId}` : '—'))
        )}
      </td>
    </tr>
  );
}

const POD_MENU_WIDTH = 220;
/** Minimum gap kept between the menu and every viewport edge. */
const POD_MENU_MARGIN = 8;

/**
 * Right-click menu for a flagged pod. One action for now (Ignore); closes on
 * Escape, outside click, or resize — same behavior as the Roster row menu.
 */
function PodIgnoreMenu({
  x,
  y,
  violation,
  onIgnore,
  onClose,
}: {
  x: number;
  y: number;
  violation: PodViolation;
  onIgnore: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [menuHeight, setMenuHeight] = useState(0);

  // Measure the rendered menu so the vertical clamp uses its real height
  // (runs before paint, so the unclamped position is never visible).
  useLayoutEffect(() => {
    setMenuHeight(ref.current?.offsetHeight ?? 0);
  }, []);

  useEffect(() => {
    function onPointerDown(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose();
    }
    // Capture-phase so a click on another row closes this menu first.
    document.addEventListener('mousedown', onPointerDown, true);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('mousedown', onPointerDown, true);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  const left = Math.max(
    POD_MENU_MARGIN,
    Math.min(x, window.innerWidth - POD_MENU_WIDTH - POD_MENU_MARGIN),
  );
  const top = Math.max(
    POD_MENU_MARGIN,
    Math.min(y, window.innerHeight - menuHeight - POD_MENU_MARGIN),
  );

  return (
    <div
      ref={ref}
      className="context-menu"
      style={{ left, top, width: POD_MENU_WIDTH }}
      role="menu"
      data-testid="pod-ignore-menu"
    >
      <div className="context-menu__title">
        {violation.characterName} — {violation.kind === 'active' ? 'Active pod' : (violation.cloneName ?? 'Jump clone')}
      </div>
      <button
        type="button"
        className="context-menu__item context-menu__item--button"
        role="menuitem"
        onClick={onIgnore}
        data-testid="pod-ignore-action"
      >
        Ignore this pod
      </button>
    </div>
  );
}

/** One ignored pod, with its exemption liftable via the Un-ignore button. */
function PodIgnoredRow({
  entry,
  busy,
  onUnignore,
}: {
  entry: PodIgnoredEntry;
  busy: boolean;
  onUnignore: () => void;
}) {
  return (
    <tr data-testid={`pod-ignored-${entry.characterId}-${entry.jumpCloneId ?? 'active'}`}>
      <td>
        <Link to={`/character/${entry.characterId}`}>{entry.characterName}</Link>
      </td>
      <td>
        <PodLabel pod={entry} />
        {!entry.exists && <span className="muted"> (no longer exists)</span>}
      </td>
      <td className="num">{entry.implantCount ?? <span className="muted">—</span>}</td>
      <td>
        {entry.systemId !== null ? (
          // Neutral, not red: this pod is exempt from the check.
          (entry.systemName ?? `System ${entry.systemId}`)
        ) : (
          <span className="muted">{entry.exists ? 'unresolved' : '—'}</span>
        )}
      </td>
      <td>
        {entry.kind === 'active' || entry.locationId === null ? (
          <span className="muted">—</span>
        ) : (
          (entry.locationName ?? `Location ${entry.locationId}`)
        )}
      </td>
      <td className="pod-ignored__actions">
        <button
          type="button"
          className="ghost btn-sm"
          disabled={busy}
          onClick={onUnignore}
          data-testid={`pod-unignore-${entry.characterId}-${entry.jumpCloneId ?? 'active'}`}
        >
          Un-ignore
        </button>
      </td>
    </tr>
  );
}

/**
 * Pod whitelist: the systems members' implanted pods are allowed to sit in.
 * Collapsible; two tabs split the pods into ones to move ("To move") and ones
 * the user right-clicked → Ignore ("Ignored", where the exemption is lifted).
 */
function PodWhitelistSection({
  detail,
  busy,
  onAdd,
  onRemove,
  onIgnore,
  onUnignore,
}: {
  detail: GroupDetailData;
  busy: boolean;
  onAdd: (system: { id: number; name: string }) => void;
  onRemove: (solarSystemId: number) => void;
  onIgnore: (violation: PodViolation) => void;
  onUnignore: (entry: PodIgnoredEntry) => void;
}) {
  const groupId = detail.group.id;
  const systems = detail.group.podSystems;
  const violations = detail.podViolations;
  const ignored = detail.podIgnored;
  const allowedIds = useMemo(() => new Set(systems.map((s) => s.solarSystemId)), [systems]);

  const [collapsed, setCollapsed] = useState(() => loadPodSectionCollapsed(groupId));
  const [tab, setTab] = useState<'flagged' | 'ignored'>('flagged');
  const [menu, setMenu] = useState<{ x: number; y: number; violation: PodViolation } | null>(null);

  // The section stays mounted when navigating between groups — re-sync.
  useEffect(() => {
    setCollapsed(loadPodSectionCollapsed(groupId));
    setTab('flagged');
    setMenu(null);
  }, [groupId]);

  function toggleCollapsed(): void {
    setCollapsed((prev) => {
      const next = !prev;
      savePodSectionCollapsed(groupId, next);
      return next;
    });
  }

  return (
    <div className="card" data-testid="pod-whitelist">
      <div className="pod-whitelist__header">
        <button
          type="button"
          className="collapse-toggle"
          aria-expanded={!collapsed}
          title={collapsed ? 'Expand' : 'Collapse'}
          onClick={toggleCollapsed}
          data-testid="pod-whitelist-toggle"
        >
          {collapsed ? '▸' : '▾'}
        </button>
        <h3>Pod locations</h3>
        {violations.length > 0 && (
          <span className="chip chip--danger" data-testid="pod-violation-count">
            {violations.length} to move
          </span>
        )}
      </div>

      {!collapsed && (
        <div data-testid="pod-whitelist-body">
          <p className="muted">
            Systems where members&apos; pods with implants are allowed to be. Active pods and
            jump clones carrying implants anywhere else are listed below — right-click a
            flagged pod to ignore it.
          </p>
          <div className="pod-whitelist__row">
            <div className="tag-chips pod-whitelist__systems">
              {systems.map((s) => (
                <span
                  key={s.solarSystemId}
                  className="chip"
                  data-testid={`pod-system-${s.solarSystemId}`}
                >
                  {s.systemName}
                  <button
                    type="button"
                    className="chip__remove"
                    title={`Remove ${s.systemName}`}
                    disabled={busy}
                    onClick={() => onRemove(s.solarSystemId)}
                    data-testid={`pod-system-remove-${s.solarSystemId}`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <PodSystemPicker excludeIds={allowedIds} disabled={busy} onSelect={onAdd} />
          </div>

          <div className="tab-bar" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'flagged'}
              className={`tab${tab === 'flagged' ? ' tab--active' : ''}`}
              onClick={() => setTab('flagged')}
              data-testid="pod-tab-flagged"
            >
              To move ({violations.length})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'ignored'}
              className={`tab${tab === 'ignored' ? ' tab--active' : ''}`}
              onClick={() => setTab('ignored')}
              data-testid="pod-tab-ignored"
            >
              Ignored ({ignored.length})
            </button>
          </div>

          {tab === 'flagged' &&
            (systems.length === 0 ? (
              <p className="muted" data-testid="pod-whitelist-empty">
                No systems whitelisted — add one (e.g. Jita, Amarr) to start checking.
              </p>
            ) : violations.length === 0 ? (
              <p className="pod-whitelist__ok" data-testid="pod-whitelist-ok">
                All pods with implants are in allowed systems.
              </p>
            ) : (
              <table className="data-table" data-testid="pod-violations">
                <thead>
                  <tr>
                    <th>Character</th>
                    <th>Pod</th>
                    <th>Implants</th>
                    <th>System</th>
                    <th>Station / structure</th>
                  </tr>
                </thead>
                <tbody>
                  {violations.map((v) => (
                    <PodViolationRow
                      key={`${v.characterId}:${v.jumpCloneId ?? 'active'}`}
                      violation={v}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setMenu({ x: e.clientX, y: e.clientY, violation: v });
                      }}
                    />
                  ))}
                </tbody>
              </table>
            ))}

          {tab === 'ignored' &&
            (ignored.length === 0 ? (
              <p className="muted" data-testid="pod-ignored-empty">
                No ignored pods — right-click a pod on the “To move” tab to ignore it.
              </p>
            ) : (
              <table className="data-table" data-testid="pod-ignored">
                <thead>
                  <tr>
                    <th>Character</th>
                    <th>Pod</th>
                    <th>Implants</th>
                    <th>System</th>
                    <th>Station / structure</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {ignored.map((entry) => (
                    <PodIgnoredRow
                      key={`${entry.characterId}:${entry.jumpCloneId ?? 'active'}`}
                      entry={entry}
                      busy={busy}
                      onUnignore={() => onUnignore(entry)}
                    />
                  ))}
                </tbody>
              </table>
            ))}
        </div>
      )}

      {menu && (
        <PodIgnoreMenu
          x={menu.x}
          y={menu.y}
          violation={menu.violation}
          onIgnore={() => {
            setMenu(null);
            onIgnore(menu.violation);
          }}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}

function MemberCard({ detail, member }: { detail: GroupDetailData; member: GroupMemberStatus }) {
  const { character, training } = member;
  // Red halo: the medical clone is verifiably not at the group's home station.
  // Only the med clone counts — where the character currently sits doesn't.
  const cloneAway = medicalCloneMismatch(detail.group.homeStationId, member.medicalClone);
  return (
    <div
      className={`member-card${cloneAway ? ' member-card--clone-away' : ''}`}
      data-testid={`member-card-${character.id}`}
      data-clone-away={cloneAway || undefined}
    >
      <div className="member-card__header">
        <CharacterAvatar characterId={character.id} size={96} />
        <div className="member-card__title">
          <Link to={`/character/${character.id}`}>{character.name}</Link>
          <span className="muted">{member.accountLabel ?? 'Unassigned'}</span>
          <span className="member-card__sp">{formatSp(member.totalSp)}</span>
        </div>
      </div>

      <dl className="member-card__facts">
        <dt>Location</dt>
        <dd>{member.systemName ?? <span className="muted">—</span>}</dd>
        <dt>Ship</dt>
        <dd>{member.shipTypeName ?? <span className="muted">—</span>}</dd>
        <dt>Med clone</dt>
        <dd>
          {member.medicalClone ? (
            <span
              className={`fact-ellipsis${cloneAway ? ' med-clone-away' : ''}`}
              title={member.medicalClone.locationName ?? undefined}
              data-testid={`member-med-clone-${character.id}`}
            >
              {member.medicalClone.locationName ?? `Location ${member.medicalClone.locationId}`}
            </span>
          ) : (
            <span className="muted">—</span>
          )}
        </dd>
        <dt>Training</dt>
        <dd>
          {training.isTraining ? (
            <>
              {training.currentSkillName ?? `Type ${training.currentSkillTypeId}`}{' '}
              {romanLevel(training.currentFinishLevel ?? 0)}
              <span className="muted">
                {' '}
                · {formatTimeUntil(training.finishDate).replace(/^in /, '')} left
              </span>
            </>
          ) : (
            <span className="chip chip--idle">Idle</span>
          )}
        </dd>
        <dt>Queue</dt>
        <dd>
          <QueueLine member={member} />
        </dd>
      </dl>

      {member.tags.length > 0 && (
        <div className="tag-chips">
          {member.tags.map((tag) => (
            <span
              key={tag.id}
              className="chip tag-chip"
              style={tag.color ? ({ '--tag-color': tag.color } as CSSProperties) : undefined}
            >
              {tag.name}
            </span>
          ))}
        </div>
      )}

      {detail.priorityPlan && member.planStatus && (
        <ObjectiveBar
          kind="Plan"
          name={detail.priorityPlan.name}
          to={`/plans/${detail.priorityPlan.id}`}
          status={member.planStatus}
          system={loadCostView('plan', detail.priorityPlan.id).system}
          completeText="Complete"
          testId={`member-plan-status-${character.id}`}
        />
      )}
      {detail.priorityFit && member.fitStatus && (
        <ObjectiveBar
          kind="Fit"
          name={detail.priorityFit.name}
          to={`/fits/${detail.priorityFit.id}`}
          status={member.fitStatus}
          system={loadCostView('fit', detail.priorityFit.id).system}
          completeText="Can fly"
          testId={`member-fit-status-${character.id}`}
        />
      )}
    </div>
  );
}

export default function GroupDetail() {
  const params = useParams<{ id: string }>();
  const groupId = Number(params.id);

  const [detail, setDetail] = useState<GroupDetailData | null>(null);
  const [fits, setFits] = useState<Fit[]>([]);
  const [plans, setPlans] = useState<SkillPlan[]>([]);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [editing, setEditing] = useState(false);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [d, f, p, r] = await Promise.all([
        mco.groups.detail(groupId),
        mco.fits.list(),
        mco.plans.list(),
        mco.characters.roster(),
      ]);
      setDetail(d);
      setFits(f);
      setPlans(p);
      setRoster(r);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    void load();
    // Refresh when a background sync sweep updates character data.
    return mco.characters.onChanged(() => void load());
  }, [load]);

  async function run(action: () => Promise<unknown>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await action();
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  const members = useMemo(
    () => new Set(detail?.group.characterIds ?? []),
    [detail],
  );

  const candidates = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return roster;
    return roster.filter((e) => e.character.name.toLowerCase().includes(needle));
  }, [roster, search]);

  return (
    <section className="page">
      <div className="toolbar">
        <h2 className="cell-with-avatar">
          <Link to="/groups" className="back-link">
            ← Groups
          </Link>
          {detail && <span data-testid="group-detail-name">{detail.group.name}</span>}
        </h2>
        <div className="toolbar__actions">
          {detail && (
            <span className="stat-chip">
              <strong>{detail.members.length}</strong> members
            </span>
          )}
          <button
            type="button"
            className="ghost btn-sm"
            onClick={() => setEditing((prev) => !prev)}
            data-testid="edit-members"
          >
            {editing ? 'Done' : 'Edit members'}
          </button>
          <button type="button" className="ghost" onClick={() => void load()} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && <div className="error-box" data-testid="group-detail-error">{error}</div>}

      {detail && (
        <>
          <div className="card">
            <h3>Group priorities</h3>
            <div className="priority-row">
              <label>
                Priority fit
                <select
                  value={detail.group.priorityFitId ?? ''}
                  disabled={busy}
                  onChange={(e) =>
                    void run(() =>
                      mco.groups.setPriorityFit(
                        groupId,
                        e.target.value === '' ? null : Number(e.target.value),
                      ),
                    )
                  }
                  data-testid="priority-fit-select"
                >
                  <option value="">None</option>
                  {fits.map((fit) => (
                    <option key={fit.id} value={fit.id}>
                      {fit.name} — {fit.shipName}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Priority skill plan
                <select
                  value={detail.group.priorityPlanId ?? ''}
                  disabled={busy}
                  onChange={(e) =>
                    void run(() =>
                      mco.groups.setPriorityPlan(
                        groupId,
                        e.target.value === '' ? null : Number(e.target.value),
                      ),
                    )
                  }
                  data-testid="priority-plan-select"
                >
                  <option value="">None</option>
                  {plans.map((plan) => (
                    <option key={plan.id} value={plan.id}>
                      {plan.name}
                    </option>
                  ))}
                </select>
              </label>
              {/* div, not label: a label would forward clicks to the Clear button. */}
              <div className="field">
                Home station
                <HomeStationPicker
                  current={
                    detail.group.homeStationId !== null
                      ? {
                          id: detail.group.homeStationId,
                          name:
                            detail.group.homeStationName ??
                            `Structure ${detail.group.homeStationId}`,
                        }
                      : null
                  }
                  disabled={busy}
                  onSelect={(station) =>
                    void run(() => mco.groups.setHomeStation(groupId, station))
                  }
                />
              </div>
            </div>
            {detail.needsSkillData && (
              <p className="muted">
                Static data has no skill-requirement data yet — priority progress bars appear
                after re-importing static data (top of the Roster page).
              </p>
            )}
          </div>

          <PodWhitelistSection
            detail={detail}
            busy={busy}
            onAdd={(system) => void run(() => mco.groups.addPodSystem(groupId, system))}
            onRemove={(solarSystemId) =>
              void run(() => mco.groups.removePodSystem(groupId, solarSystemId))
            }
            onIgnore={(violation) =>
              void run(() =>
                mco.groups.ignorePod(groupId, violation.characterId, violation.jumpCloneId),
              )
            }
            onUnignore={(entry) =>
              void run(() =>
                mco.groups.unignorePod(groupId, entry.characterId, entry.jumpCloneId),
              )
            }
          />

          {editing && (
            <div className="card">
              <div className="filter-bar">
                <input
                  type="search"
                  placeholder="Search characters…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  data-testid="member-search"
                />
                <span className="filter-bar__count">
                  {detail.group.characterIds.length} of {roster.length} selected
                </span>
              </div>
              <div className="member-checklist">
                {candidates.map((entry) => {
                  const checked = members.has(entry.character.id);
                  return (
                    <label key={entry.character.id} className="member-check">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={busy}
                        onChange={(e) =>
                          void run(() =>
                            e.target.checked
                              ? mco.groups.addMember(groupId, entry.character.id)
                              : mco.groups.removeMember(groupId, entry.character.id),
                          )
                        }
                        data-testid={`member-check-${entry.character.id}`}
                      />
                      {entry.character.name}
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {detail.members.length === 0 ? (
            <div className="empty-state" data-testid="group-detail-empty">
              <h3>No members yet</h3>
              <p>Click “Edit members” to add characters to this group.</p>
            </div>
          ) : (
            <div className="member-grid" data-testid="group-member-grid">
              {detail.members.map((member) => (
                <MemberCard key={member.character.id} detail={detail} member={member} />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
