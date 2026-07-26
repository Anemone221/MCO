import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { Link } from 'react-router-dom';
import type { AccountBucket, CharacterGroup, RosterEntry, Tag } from '@shared/types';
import { mco } from '../lib/ipc';
import { formatDate, formatIsk, formatSp, formatTimeUntil, romanLevel } from '../lib/format';
import {
  applyPinnedOrder,
  cloneJumpRemainingMs,
  fatigueRemainingMs,
  filterRoster,
  loadColumnVisibility,
  NO_ROSTER_FILTERS,
  ROSTER_COLUMNS,
  saveColumnVisibility,
  sortRoster,
  summarizeRoster,
  type RosterColumnKey,
  type RosterFilters,
  type RosterSort,
  type RosterSortKey,
} from '../lib/rosterView';
import { ALL_TAGS, memberIdSet, tagsForCharacter, type TagFilter } from '../lib/tags';
import CharacterAvatar from '../components/CharacterAvatar';
import TagSelect from '../components/TagSelect';
import ColumnPicker from '../components/ColumnPicker';
import CharacterContextMenu from '../components/CharacterContextMenu';

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

export default function Roster() {
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [accounts, setAccounts] = useState<AccountBucket[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [groups, setGroups] = useState<CharacterGroup[]>([]);
  const [tagFilter, setTagFilter] = useState<TagFilter>(ALL_TAGS);
  const [tagMenu, setTagMenu] = useState<TagMenuState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<RosterFilters>(NO_ROSTER_FILTERS);
  const [sort, setSort] = useState<RosterSort>({ key: 'name', dir: 'asc' });
  const [columns, setColumns] = useState(loadColumnVisibility);
  // While set, rows render in this captured id order instead of live
  // sort/filter results, so assigning an account never shifts the table
  // (the row would otherwise re-sort away or drop out of an "Unassigned"
  // filter mid-bulk-assignment). Cleared when sort or any filter changes.
  const [pinnedOrder, setPinnedOrder] = useState<number[] | null>(null);

  useEffect(() => {
    setPinnedOrder(null);
  }, [filters, sort, tagFilter]);

  const load = useCallback(async () => {
    const [r, a, t, g] = await Promise.all([
      mco.characters.roster(),
      mco.accounts.list(),
      mco.tags.list(),
      mco.groups.list(),
    ]);
    setRoster(r);
    setAccounts(a);
    setTags(t);
    setGroups(g);
  }, []);

  useEffect(() => {
    void load().catch((e: unknown) => setError(String(e)));
    // Refresh the roster when a background sync sweep updates character data.
    return mco.characters.onChanged(() => {
      void load().catch((e: unknown) => setError(String(e)));
    });
  }, [load]);

  async function run(key: string, action: () => Promise<unknown>): Promise<void> {
    // The pin only services back-to-back account assignments; any other action
    // (add/remove/sync/tag) resumes live sorting so its result shows normally.
    if (key !== 'account') setPinnedOrder(null);
    setBusy(key);
    setError(null);
    try {
      await action();
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
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

  function toggleSort(key: RosterSortKey): void {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'sp' || key === 'wallet' ? 'desc' : 'asc' },
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
  const visible = useMemo(() => {
    if (pinnedOrder) return applyPinnedOrder(roster, pinnedOrder);
    const tagIds = memberIdSet(tags, tagFilter);
    const base = tagIds === null ? roster : roster.filter((e) => tagIds.has(e.character.id));
    return sortRoster(filterRoster(base, filters), sort, tagNames);
  }, [roster, tags, tagFilter, filters, sort, tagNames, pinnedOrder]);
  const filtered = visible.length !== roster.length;
  // Character column + visible optional columns + the actions column.
  const colCount = 1 + ROSTER_COLUMNS.filter((col) => columns[col.key]).length + 1;

  return (
    <section className="page page--fill">
      <div className="toolbar">
        <h2>Roster</h2>
        <div className="toolbar__actions">
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void run('add', () => mco.characters.add())}
            data-testid="add-character"
          >
            {busy === 'add' ? 'Waiting for EVE SSO…' : 'Add character'}
          </button>
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
            placeholder="Search name, account, or skill…"
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

      {error && (
        <div className="error-box" data-testid="roster-error">
          {error}
        </div>
      )}

      {roster.length === 0 ? (
        <div className="empty-state">
          <h3>No characters yet</h3>
          <p>Click “Add character” to sign in with EVE SSO.</p>
        </div>
      ) : (
        <div className="table-scroll">
          <table className="data-table" data-testid="roster-table">
            <thead>
              <tr>
                <th
                  className="sortable"
                  aria-sort={
                    sort.key === 'name'
                      ? sort.dir === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : undefined
                  }
                  onClick={() => toggleSort('name')}
                >
                  Character
                  {sort.key === 'name' && (
                    <span className="sort-arrow">{sort.dir === 'asc' ? '▲' : '▼'}</span>
                  )}
                </th>
                {ROSTER_COLUMNS.filter((col) => columns[col.key]).map((col) => (
                  <th
                    key={col.key}
                    className={col.numeric ? 'sortable num' : 'sortable'}
                    aria-sort={
                      sort.key === col.key
                        ? sort.dir === 'asc'
                          ? 'ascending'
                          : 'descending'
                        : undefined
                    }
                    onClick={() => toggleSort(col.key)}
                  >
                    {col.label}
                    {sort.key === col.key && (
                      <span className="sort-arrow">{sort.dir === 'asc' ? '▲' : '▼'}</span>
                    )}
                  </th>
                ))}
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
                  onContextMenu={(e) => openTagMenu(e, entry)}
                >
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
