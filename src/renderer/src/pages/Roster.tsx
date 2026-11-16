import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { Link } from 'react-router-dom';
import type { GroupObjectiveStatus, RosterEntry, RosterPlanColumn } from '@shared/types';
import { errorMessage, mco } from '../lib/ipc';
import { useMcoData } from '../lib/useMcoData';
import { formatDate, formatIsk, formatSp, formatTimeUntil, romanLevel } from '../lib/format';
import {
  applyPinnedOrder,
  cloneJumpRemainingMs,
  fatigueRemainingMs,
  filterRoster,
  loadColumnVisibility,
  NO_ROSTER_FILTERS,
  planSortKey,
  ROSTER_COLUMNS,
  saveColumnVisibility,
  sortRoster,
  summarizeRoster,
  type PlanProgressLookup,
  type PlanSortKey,
  type RosterColumnKey,
  type RosterFilters,
  type RosterSort,
  type RosterSortKey,
} from '../lib/rosterView';
import { summarizeQueue } from '../lib/groupView';
import { formatCost, loadCostView } from '../lib/costView';
import { ALL_TAGS, memberIdSet, tagsForCharacter, type TagFilter } from '../lib/tags';
import CharacterAvatar from '../components/CharacterAvatar';
import TagSelect from '../components/TagSelect';
import ColumnPicker from '../components/ColumnPicker';
import CharacterContextMenu from '../components/CharacterContextMenu';
import BulkMembershipMenu from '../components/BulkMembershipMenu';
import {
  clickSelection,
  headerSelection,
  resolveSelection,
  toggleAllVisible,
} from '../lib/rosterSelection';
import SortHeader from '../components/SortHeader';

interface TagMenuState {
  x: number;
  y: number;
  characterId: number;
  characterName: string;
}

function TrainingCell({ entry }: { entry: RosterEntry }) {
  const { training } = entry;
  if (!training.isTraining) {
    return <span className="chip chip--idle">Idle</span>;
  }
  const skill = training.currentSkillName ?? `Type ${training.currentSkillTypeId}`;
  return (
    <span>
      {skill} {romanLevel(training.currentFinishLevel ?? 0)}
    </span>
  );
}

function TimeLeftCell({ entry }: { entry: RosterEntry }) {
  const { training } = entry;
  if (!training.isTraining) return <span className="muted">—</span>;
  // Drop the leading "in " — the "Time left" header already frames it.
  return <span>{formatTimeUntil(training.finishDate).replace(/^in /, '')}</span>;
}

/** Total time left in the whole skill queue, not just the skill training now. */
function QueueCell({ entry }: { entry: RosterEntry }) {
  const queue = summarizeQueue(entry.queueLength, entry.queueEndDate);
  switch (queue.state) {
    // Nothing queued, or the queue already ran dry — the Training column
    // already says "Idle", so no time left is a plain dash here.
    case 'empty':
    case 'finished':
      return <span className="muted">—</span>;
    // A queue with skills in it but no dates: training is paused, so the
    // remaining time is unknowable until it resumes.
    case 'paused':
      return <span className="queue-paused">Paused</span>;
    case 'active':
      return <span>{formatTimeUntil(queue.endDate).replace(/^in /, '')}</span>;
  }
}

function FatigueCell({ entry }: { entry: RosterEntry }) {
  // Anyone not actively fatigued (unknown, cleared, or never jumped) shows a
  // plain dash — a chip would just be noise on a mostly-clear roster.
  const remaining = fatigueRemainingMs(entry);
  if (remaining === null) return <span className="muted">—</span>;
  return (
    <span className="chip chip--fatigue">
      {formatTimeUntil(entry.jumpFatigue?.expireDate ?? null).replace(/^in /, '')}
    </span>
  );
}

function CloneJumpCell({ entry }: { entry: RosterEntry }) {
  // Unknown (clone data never synced) shows a dash; an available jump is the
  // routine state and stays plain text; only an active cooldown gets the
  // fatigue-blue chip, matching the Clones page.
  const remaining = cloneJumpRemainingMs(entry);
  if (remaining === null) return <span className="muted">—</span>;
  if (remaining === 0) return <span>Ready</span>;
  return (
    <span className="chip chip--fatigue">
      {formatTimeUntil(entry.cloneJump?.nextJumpAt ?? null).replace(/^in /, '')}
    </span>
  );
}

/**
 * One character's progress toward a roster-visible plan: a thin red→green bar
 * and the share held, with the remaining cost (in the system chosen on the
 * plan's detail page) on hover. Kept to a bar and a number so several plan
 * columns still fit a 90-row table.
 */
function PlanCell({ planId, status }: { planId: number; status: GroupObjectiveStatus | undefined }) {
  if (!status) return <span className="muted">—</span>;
  if (status.complete) return <span className="objective-done">Complete</span>;
  const pct = status.progress * 100;
  const system = loadCostView('plan', planId).system;
  const timeUnknown = system === 'time' && status.timeGapMinutes === null;
  const costText = timeUnknown ? formatSp(status.spGap) : formatCost(system, status);
  return (
    <span className="roster-plan" title={`${costText} left`}>
      <span className="plan-progress__bar roster-plan__bar">
        <span
          className="plan-progress__fill"
          style={{
            width: `${pct}%`,
            // Hue tracks completion: pure red at 0%, through amber, pure green at 100%.
            background: `color-mix(in hsl, var(--ok) ${pct}%, var(--danger))`,
          }}
        />
      </span>
      {Math.floor(pct)}%
    </span>
  );
}

export default function Roster() {
  const [tagFilter, setTagFilter] = useState<TagFilter>(ALL_TAGS);
  const [tagMenu, setTagMenu] = useState<TagMenuState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // A sign-in run in progress: one character, or "several" — where each
  // finished sign-in opens the next SSO page until the user says they're done.
  const [adding, setAdding] = useState<{ several: boolean; added: number } | null>(null);
  const [filters, setFilters] = useState<RosterFilters>(NO_ROSTER_FILTERS);
  const [sort, setSort] = useState<RosterSort>({ key: 'name', dir: 'asc' });
  const [columns, setColumns] = useState(loadColumnVisibility);
  // While set, rows render in this captured id order instead of live
  // sort/filter results, so assigning an account never shifts the table
  // (the row would otherwise re-sort away or drop out of an "Unassigned"
  // filter mid-bulk-assignment). Cleared when sort or any filter changes.
  const [pinnedOrder, setPinnedOrder] = useState<number[] | null>(null);
  // Rows ticked for a bulk action, and the last one clicked (where a
  // shift-click range starts). The selection outlives filter changes, so it can
  // be built up across several searches; the bulk bar says how many are hidden.
  const [selected, setSelected] = useState<ReadonlySet<number>>(() => new Set());
  const [anchor, setAnchor] = useState<number | null>(null);

  useEffect(() => {
    setPinnedOrder(null);
  }, [filters, sort, tagFilter]);

  // Refreshes on mount and when a background sync sweep updates character data.
  const { data, error, reload, setError } = useMcoData(
    async () => {
      const [roster, accounts, tags, groups, planProgress] = await Promise.all([
        mco.characters.roster(),
        mco.accounts.list(),
        mco.tags.list(),
        mco.groups.list(),
        mco.plans.rosterProgress(),
      ]);
      return { roster, accounts, tags, groups, planProgress };
    },
    { onCharactersChanged: true },
  );
  const { roster = [], accounts = [], tags = [], groups = [], planProgress } = data ?? {};
  const planColumns = useMemo<RosterPlanColumn[]>(() => planProgress?.plans ?? [], [planProgress]);

  async function run(key: string, action: () => Promise<unknown>): Promise<void> {
    // The pin only services back-to-back account assignments; any other action
    // (add/remove/sync/tag) resumes live sorting so its result shows normally.
    if (key !== 'account') setPinnedOrder(null);
    setBusy(key);
    setError(null);
    try {
      await action();
      await reload();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  /**
   * Sign characters in. With `several`, each finished sign-in is followed
   * straight away by the next SSO page — the first sync is left to finish in
   * the background — so onboarding a roster is one visit to the browser
   * rather than one round trip per character. The run ends when the user
   * presses Done (which cancels the sign-in then waiting) or one fails.
   */
  async function addCharacters(several: boolean): Promise<void> {
    setPinnedOrder(null);
    setBusy('add');
    setError(null);
    setAdding({ several, added: 0 });
    try {
      for (;;) {
        const result = await mco.characters.add(several);
        if (result.outcome === 'cancelled') break;
        await reload();
        setAdding((prev) => (prev ? { ...prev, added: prev.added + 1 } : prev));
        if (!several) break;
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setAdding(null);
      setBusy(null);
    }
  }

  async function removeCharacter(entry: RosterEntry): Promise<void> {
    const ok = await mco.system.confirm(
      `Remove ${entry.character.name} and its stored login?`,
      'Remove',
    );
    if (!ok) return;
    void run('remove', () => mco.characters.remove(entry.character.id));
  }

  function openTagMenu(e: ReactMouseEvent, entry: RosterEntry): void {
    e.preventDefault();
    setTagMenu({
      x: e.clientX,
      y: e.clientY,
      characterId: entry.character.id,
      characterName: entry.character.name,
    });
  }

  function toggleTag(tagId: number, characterId: number, assigned: boolean): void {
    void run('tag', () =>
      assigned ? mco.tags.removeMember(tagId, characterId) : mco.tags.addMember(tagId, characterId),
    );
  }

  function toggleGroup(groupId: number, characterId: number, member: boolean): void {
    void run('group', () =>
      member
        ? mco.groups.removeMember(groupId, characterId)
        : mco.groups.addMember(groupId, characterId),
    );
  }

  function toggleColumn(key: RosterColumnKey): void {
    setColumns((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      saveColumnVisibility(next);
      return next;
    });
  }

  function toggleSort(key: RosterSortKey | PlanSortKey): void {
    // Bigger-is-better columns open descending: most SP, most ISK, furthest along a plan.
    const descFirst = key === 'sp' || key === 'wallet' || key.startsWith('plan:');
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: descFirst ? 'desc' : 'asc' },
    );
  }

  const summary = useMemo(() => summarizeRoster(roster), [roster]);
  // characterId → tag names joined in display order, for sorting the Tags column.
  const tagNames = useMemo(() => {
    const map = new Map<number, string>();
    for (const entry of roster) {
      const names = tagsForCharacter(tags, entry.character.id).map((t) => t.name);
      if (names.length > 0) map.set(entry.character.id, names.join(', '));
    }
    return map;
  }, [roster, tags]);
  const planShares = useMemo<PlanProgressLookup>(
    () =>
      new Map(
        planColumns.map((col) => [
          col.planId,
          new Map(Object.entries(col.statuses).map(([id, s]) => [Number(id), s.progress])),
        ]),
      ),
    [planColumns],
  );
  const visible = useMemo(() => {
    if (pinnedOrder) return applyPinnedOrder(roster, pinnedOrder);
    const tagIds = memberIdSet(tags, tagFilter);
    const base = tagIds === null ? roster : roster.filter((e) => tagIds.has(e.character.id));
    return sortRoster(filterRoster(base, filters, tagNames), sort, tagNames, planShares);
  }, [roster, tags, tagFilter, filters, sort, tagNames, planShares, pinnedOrder]);
  const filtered = visible.length !== roster.length;
  const visibleIds = useMemo(() => visible.map((e) => e.character.id), [visible]);
  const selection = useMemo(
    () =>
      resolveSelection(
        selected,
        roster.map((e) => e.character.id),
        visibleIds,
      ),
    [selected, roster, visibleIds],
  );
  const headerState = headerSelection(selected, visibleIds);

  /** One bulk action on the selection: one IPC call, one transaction, one reload. */
  function bulk(key: string, action: (ids: number[]) => Promise<unknown>): void {
    const ids = selection.ids;
    if (ids.length === 0) return;
    void run(key, () => action(ids));
  }

  function bulkAssignAccount(value: string): void {
    // Same hold as the per-row dropdown: the rows just moved must not re-sort
    // or drop out of an "Unassigned" filter while they are still selected.
    setPinnedOrder((prev) => prev ?? visibleIds);
    bulk('account', (ids) =>
      mco.characters.assignAccounts(ids, value === 'none' ? null : Number(value)),
    );
  }

  // Selection column + character column + visible optional columns + plan
  // columns + the actions column.
  const colCount =
    2 + ROSTER_COLUMNS.filter((col) => columns[col.key]).length + planColumns.length + 1;

  return (
    <section className="page page--fill">
      <div className="toolbar">
        <h2>Roster</h2>
        <div className="toolbar__actions">
          {adding ? (
            <>
              <span className="muted login-status" data-testid="add-status">
                {adding.several
                  ? `${adding.added} added — sign in to the next one in your browser`
                  : 'Waiting for EVE SSO in your browser…'}
              </span>
              <button
                type="button"
                onClick={() => void mco.characters.cancelLogin()}
                data-testid="add-cancel"
              >
                {adding.several ? 'Done' : 'Cancel'}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void addCharacters(false)}
                data-testid="add-character"
              >
                Add character
              </button>
              <button
                type="button"
                className="ghost"
                disabled={busy !== null}
                title="Keep signing characters in, one after another, until you press Done"
                onClick={() => void addCharacters(true)}
                data-testid="add-several"
              >
                Add several…
              </button>
            </>
          )}
          <button
            type="button"
            className="ghost"
            disabled={busy !== null || roster.length === 0}
            onClick={() => void run('syncAll', () => mco.characters.syncAll())}
            data-testid="sync-all"
          >
            {busy === 'syncAll' ? 'Syncing…' : 'Sync all'}
          </button>
        </div>
      </div>

      {roster.length > 0 && (
        <div className="stats-strip">
          <span className="stat-chip">
            <strong>{summary.total}</strong> characters
          </span>
          <span className="stat-chip stat-chip--ok">
            <strong>{summary.training}</strong> training
          </span>
          <span className="stat-chip">
            <strong>{summary.idle}</strong> idle
          </span>
          <span className="stat-chip">
            <strong>{formatSp(summary.totalSp)}</strong> combined
          </span>
          <span className="stat-chip">
            <strong>{formatIsk(summary.totalWallet)}</strong> wallet
          </span>
        </div>
      )}

      {roster.length > 0 && (
        <div className="filter-bar">
          <input
            type="search"
            placeholder="Search name, account, skill, or tag…"
            value={filters.search}
            onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
            data-testid="roster-search"
          />
          <select
            value={typeof filters.account === 'number' ? String(filters.account) : filters.account}
            onChange={(e) => {
              const v = e.target.value;
              setFilters((f) => ({
                ...f,
                account: v === 'all' || v === 'unassigned' ? v : Number(v),
              }));
            }}
            aria-label="Filter by account"
          >
            <option value="all">All accounts</option>
            <option value="unassigned">Unassigned</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
          <select
            value={filters.training}
            onChange={(e) =>
              setFilters((f) => ({ ...f, training: e.target.value as RosterFilters['training'] }))
            }
            aria-label="Filter by training state"
          >
            <option value="all">Training + idle</option>
            <option value="training">Training only</option>
            <option value="idle">Idle only</option>
          </select>
          <TagSelect
            tags={tags}
            value={tagFilter}
            onChange={setTagFilter}
            testId="roster-tag-filter"
          />
          <ColumnPicker visibility={columns} onToggle={toggleColumn} />
          <span className="filter-bar__count">
            {filtered ? `${visible.length} of ${roster.length}` : `${roster.length} characters`}
          </span>
        </div>
      )}

      {selection.ids.length > 0 && (
        <div className="bulk-bar" data-testid="bulk-bar">
          <span className="bulk-bar__count" data-testid="bulk-count">
            <strong>{selection.ids.length}</strong> selected
            {selection.hidden > 0 && (
              <span className="muted"> · {selection.hidden} hidden by filters</span>
            )}
          </span>
          <select
            value=""
            disabled={busy !== null}
            onChange={(e) => bulkAssignAccount(e.target.value)}
            aria-label="Assign selected characters to an account"
            data-testid="bulk-account"
          >
            <option value="" disabled>
              Assign account…
            </option>
            <option value="none">Unassigned</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
          <BulkMembershipMenu
            label="Tags"
            items={tags}
            emptyText="No tags yet — create some on the Tags page."
            characterIds={selection.ids}
            busy={busy !== null}
            onAdd={(tagId) => bulk('tag', (ids) => mco.tags.addMembers(tagId, ids))}
            onRemove={(tagId) => bulk('tag', (ids) => mco.tags.removeMembers(tagId, ids))}
            testId="bulk-tags"
          />
          <BulkMembershipMenu
            label="Groups"
            items={groups}
            emptyText="No groups yet — create some on the Groups page."
            characterIds={selection.ids}
            busy={busy !== null}
            onAdd={(groupId) => bulk('group', (ids) => mco.groups.addMembers(groupId, ids))}
            onRemove={(groupId) => bulk('group', (ids) => mco.groups.removeMembers(groupId, ids))}
            testId="bulk-groups"
          />
          <button
            type="button"
            className="ghost btn-sm"
            disabled={busy !== null}
            onClick={() => bulk('syncSelected', (ids) => mco.characters.syncMany(ids))}
            data-testid="bulk-sync"
          >
            {busy === 'syncSelected' ? 'Syncing…' : 'Sync selected'}
          </button>
          <button
            type="button"
            className="ghost btn-sm"
            onClick={() => {
              setSelected(new Set());
              setAnchor(null);
            }}
            data-testid="bulk-clear"
          >
            Clear
          </button>
        </div>
      )}

      {planProgress?.needsSkillData && (
        <p className="muted" data-testid="roster-plans-need-sde">
          Skill plan columns need static skill data — re-import static data to show them.
        </p>
      )}

      {error && (
        <div className="error-box" data-testid="roster-error">
          {error}
        </div>
      )}

      {roster.length === 0 ? (
        <div className="empty-state">
          <h3>No characters yet</h3>
          <p>
            Click “Add character” to sign in with EVE SSO, or “Add several…” to sign in one
            character after another without coming back here in between.
          </p>
        </div>
      ) : (
        <div className="table-scroll">
          <table className="data-table" data-testid="roster-table">
            <thead>
              <tr>
                <th className="select-cell">
                  <input
                    type="checkbox"
                    checked={headerState === 'all'}
                    ref={(el) => {
                      if (el) el.indeterminate = headerState === 'some';
                    }}
                    disabled={visible.length === 0}
                    onChange={() => setSelected((prev) => toggleAllVisible(prev, visibleIds))}
                    aria-label={filtered ? 'Select all shown characters' : 'Select all characters'}
                    title={filtered ? 'Select all shown' : 'Select all'}
                    data-testid="select-all"
                  />
                </th>
                <SortHeader
                  label="Character"
                  active={sort.key === 'name'}
                  dir={sort.dir}
                  onSort={() => toggleSort('name')}
                />
                {ROSTER_COLUMNS.filter((col) => columns[col.key]).map((col) => (
                  <SortHeader
                    key={col.key}
                    label={col.label}
                    active={sort.key === col.key}
                    dir={sort.dir}
                    numeric={col.numeric}
                    onSort={() => toggleSort(col.key)}
                  />
                ))}
                {planColumns.map((col) => {
                  const key = planSortKey(col.planId);
                  return (
                    <SortHeader
                      key={key}
                      label={col.planName}
                      active={sort.key === key}
                      dir={sort.dir}
                      className="roster-plan-head"
                      title={`Skill plan: ${col.planName}`}
                      testId={`roster-plan-head-${col.planId}`}
                      onSort={() => toggleSort(key)}
                    />
                  );
                })}
                <th aria-label="actions" />
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && (
                <tr>
                  <td colSpan={colCount} className="no-matches">
                    No characters match the current filters.
                  </td>
                </tr>
              )}
              {visible.map((entry) => (
                <tr
                  key={entry.character.id}
                  data-testid={`roster-row-${entry.character.id}`}
                  className={selected.has(entry.character.id) ? 'is-selected' : undefined}
                  onContextMenu={(e) => openTagMenu(e, entry)}
                >
                  <td className="select-cell">
                    <input
                      type="checkbox"
                      checked={selected.has(entry.character.id)}
                      onChange={(e) => {
                        // The change comes from a click (or Space); shift on it
                        // extends the selection from the last row clicked.
                        const shift = (e.nativeEvent as MouseEvent).shiftKey === true;
                        const id = entry.character.id;
                        setSelected((prev) => clickSelection(prev, visibleIds, id, anchor, shift));
                        setAnchor(id);
                      }}
                      aria-label={`Select ${entry.character.name}`}
                      data-testid={`select-${entry.character.id}`}
                    />
                  </td>
                  <td>
                    <span className="cell-with-avatar">
                      <CharacterAvatar characterId={entry.character.id} />
                      <span className="cell-name">
                        <Link to={`/character/${entry.character.id}`}>{entry.character.name}</Link>
                      </span>
                    </span>
                  </td>
                  {columns.account && (
                    <td>
                      <select
                        value={entry.character.accountId ?? ''}
                        onChange={(e) => {
                          // Hold the current row order so the reload below can't
                          // re-sort or filter this row away under the cursor.
                          setPinnedOrder((prev) => prev ?? visible.map((v) => v.character.id));
                          void run('account', () =>
                            mco.characters.assignAccount(
                              entry.character.id,
                              e.target.value === '' ? null : Number(e.target.value),
                            ),
                          );
                        }}
                        data-testid={`account-select-${entry.character.id}`}
                      >
                        <option value="">Unassigned</option>
                        {accounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.label}
                          </option>
                        ))}
                      </select>
                    </td>
                  )}
                  {columns.tags && (
                    <td>
                      {tagNames.has(entry.character.id) ? (
                        <span className="tag-chips">
                          {tagsForCharacter(tags, entry.character.id).map((t) => (
                            <span
                              key={t.id}
                              className="chip tag-chip"
                              style={
                                t.color ? ({ '--tag-color': t.color } as CSSProperties) : undefined
                              }
                            >
                              {t.name}
                            </span>
                          ))}
                        </span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  )}
                  {columns.location && (
                    <td>{entry.systemName ?? <span className="muted">—</span>}</td>
                  )}
                  {columns.ship && (
                    <td>{entry.shipTypeName ?? <span className="muted">—</span>}</td>
                  )}
                  {columns.training && (
                    <td className="train-skill">
                      <TrainingCell entry={entry} />
                    </td>
                  )}
                  {columns.timeleft && (
                    <td className="time-left">
                      <TimeLeftCell entry={entry} />
                    </td>
                  )}
                  {columns.queue && (
                    <td className="time-left">
                      <QueueCell entry={entry} />
                    </td>
                  )}
                  {columns.fatigue && (
                    <td>
                      <FatigueCell entry={entry} />
                    </td>
                  )}
                  {columns.clonejump && (
                    <td>
                      <CloneJumpCell entry={entry} />
                    </td>
                  )}
                  {columns.sp && <td className="num">{formatSp(entry.totalSp)}</td>}
                  {columns.wallet && (
                    <td className="num">
                      {entry.walletBalance !== null ? (
                        formatIsk(entry.walletBalance)
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  )}
                  {columns.sync && (
                    <td className="muted">{formatDate(entry.character.refreshedAt)}</td>
                  )}
                  {planColumns.map((col) => (
                    <td key={col.planId}>
                      <PlanCell planId={col.planId} status={col.statuses[entry.character.id]} />
                    </td>
                  ))}
                  <td className="row-actions">
                    <button
                      type="button"
                      className="ghost btn-sm"
                      disabled={busy !== null}
                      onClick={() =>
                        void run('sync', () => mco.characters.sync(entry.character.id))
                      }
                    >
                      Sync
                    </button>
                    <button
                      type="button"
                      className="danger btn-sm"
                      disabled={busy !== null}
                      onClick={() => void removeCharacter(entry)}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tagMenu && (
        <CharacterContextMenu
          x={tagMenu.x}
          y={tagMenu.y}
          characterId={tagMenu.characterId}
          characterName={tagMenu.characterName}
          tags={tags}
          groups={groups}
          busy={busy !== null}
          onToggleTag={(tagId, assigned) => toggleTag(tagId, tagMenu.characterId, assigned)}
          onToggleGroup={(groupId, member) => toggleGroup(groupId, tagMenu.characterId, member)}
          onClose={() => setTagMenu(null)}
        />
      )}
    </section>
  );
}
