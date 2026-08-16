import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { CharacterGroup, RosterEntry } from '@shared/types';
import { errorMessage, mco } from '../lib/ipc';
import { useMcoData } from '../lib/useMcoData';

function GroupCard({
  group,
  roster,
  busy,
  onRename,
  onRemove,
  onToggleMember,
}: {
  group: CharacterGroup;
  roster: RosterEntry[];
  busy: boolean;
  onRename: (name: string) => void;
  onRemove: () => void;
  onToggleMember: (characterId: number, member: boolean) => void;
}) {
  const [name, setName] = useState(group.name);
  const [editing, setEditing] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    setName(group.name);
  }, [group.name]);

  const members = useMemo(() => new Set(group.characterIds), [group.characterIds]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return roster;
    return roster.filter((e) => e.character.name.toLowerCase().includes(needle));
  }, [roster, search]);

  function commit(): void {
    const trimmed = name.trim();
    if (trimmed && trimmed !== group.name) onRename(trimmed);
    else setName(group.name);
  }

  return (
    <div className="card" data-testid={`group-row-${group.id}`}>
      <div className="toolbar">
        <input
          className="account-name"
          value={name}
          disabled={busy}
          onChange={(e) => setName(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
          data-testid={`group-name-${group.id}`}
        />
        <div className="toolbar__actions">
          <span className="stat-chip">
            <strong>{group.characterIds.length}</strong> members
          </span>
          <Link to={`/groups/${group.id}`} className="link-btn" data-testid={`open-group-${group.id}`}>
            Open
          </Link>
          <button
            type="button"
            className="ghost btn-sm"
            onClick={() => setEditing((prev) => !prev)}
            data-testid={`edit-members-${group.id}`}
          >
            {editing ? 'Done' : 'Edit members'}
          </button>
          <button type="button" className="danger btn-sm" disabled={busy} onClick={onRemove}>
            Delete
          </button>
        </div>
      </div>

      {editing && (
        <>
          <div className="filter-bar">
            <input
              type="search"
              placeholder="Search characters…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              data-testid={`member-search-${group.id}`}
            />
            <span className="filter-bar__count">
              {group.characterIds.length} of {roster.length} selected
            </span>
          </div>
          <div className="member-checklist">
            {visible.map((entry) => {
              const checked = members.has(entry.character.id);
              return (
                <label key={entry.character.id} className="member-check">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={busy}
                    onChange={(e) => onToggleMember(entry.character.id, e.target.checked)}
                    data-testid={`member-check-${group.id}-${entry.character.id}`}
                  />
                  {entry.character.name}
                </label>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

export default function Groups() {
  const [newGroup, setNewGroup] = useState('');
  const [busy, setBusy] = useState(false);

  const { data, error, reload, setError } = useMcoData(async () => {
    const [groups, roster] = await Promise.all([mco.groups.list(), mco.characters.roster()]);
    return { groups, roster };
  });
  const { groups = [], roster = [] } = data ?? {};

  async function run(action: () => Promise<unknown>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await action();
      await reload();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function createGroup(): Promise<void> {
    const name = newGroup.trim();
    if (!name) return;
    setNewGroup('');
    await run(() => mco.groups.create(name));
  }

  async function removeGroup(group: CharacterGroup): Promise<void> {
    const count = group.characterIds.length;
    if (
      count > 0 &&
      !(await mco.system.confirm(
        `"${group.name}" has ${count} character(s). Delete the group?`,
        'Delete',
      ))
    ) {
      return;
    }
    void run(() => mco.groups.remove(group.id));
  }

  function toggleMember(groupId: number, characterId: number, member: boolean): void {
    void run(() =>
      member
        ? mco.groups.addMember(groupId, characterId)
        : mco.groups.removeMember(groupId, characterId),
    );
  }

  return (
    <section className="page">
      <div className="toolbar">
        <h2>Groups ({groups.length})</h2>
      </div>

      <div className="card">
        <h3>Add group</h3>
        <div className="toolbar__actions">
          <input
            value={newGroup}
            placeholder="Group name (e.g. WH defense)"
            disabled={busy}
            onChange={(e) => setNewGroup(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void createGroup();
            }}
            data-testid="new-group-input"
          />
          <button type="button" disabled={busy} onClick={() => void createGroup()} data-testid="add-group">
            Add
          </button>
        </div>
      </div>

      {error && <div className="error-box" data-testid="groups-error">{error}</div>}

      {groups.length === 0 ? (
        <div className="empty-state">
          <h3>No groups yet</h3>
          <p>
            Create a group above (e.g. "WH defense", "SuperCapital toons"), then add characters —
            a character can belong to as many groups as you like.
          </p>
        </div>
      ) : (
        <div className="detail-grid" data-testid="groups-list">
          {groups.map((group) => (
            <GroupCard
              key={group.id}
              group={group}
              roster={roster}
              busy={busy}
              onRename={(name) => void run(() => mco.groups.rename(group.id, name))}
              onRemove={() => void removeGroup(group)}
              onToggleMember={(characterId, member) => toggleMember(group.id, characterId, member)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
