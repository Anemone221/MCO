import { useEffect, useMemo, useState } from 'react';
import type { RosterEntry, Tag } from '@shared/types';
import { errorMessage, mco } from '../lib/ipc';
import { useMcoData } from '../lib/useMcoData';

function TagCard({
  tag,
  roster,
  busy,
  onRename,
  onSetColor,
  onRemove,
  onToggleMember,
}: {
  tag: Tag;
  roster: RosterEntry[];
  busy: boolean;
  onRename: (name: string) => void;
  onSetColor: (color: string | null) => void;
  onRemove: () => void;
  onToggleMember: (characterId: number, member: boolean) => void;
}) {
  const [name, setName] = useState(tag.name);
  const [editing, setEditing] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    setName(tag.name);
  }, [tag.name]);

  const members = useMemo(() => new Set(tag.characterIds), [tag.characterIds]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return roster;
    return roster.filter((e) => e.character.name.toLowerCase().includes(needle));
  }, [roster, search]);

  function commit(): void {
    const trimmed = name.trim();
    if (trimmed && trimmed !== tag.name) onRename(trimmed);
    else setName(tag.name);
  }

  return (
    <div className="card" data-testid={`tag-row-${tag.id}`}>
      <div className="toolbar">
        <input
          type="color"
          className="color-swatch"
          value={tag.color ?? '#2f81f7'}
          disabled={busy}
          onChange={(e) => onSetColor(e.target.value)}
          aria-label="Tag color"
          data-testid={`tag-color-${tag.id}`}
        />
        <input
          className="account-name"
          value={name}
          disabled={busy}
          onChange={(e) => setName(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
          data-testid={`tag-name-${tag.id}`}
        />
        <div className="toolbar__actions">
          <span className="stat-chip">
            <strong>{tag.characterIds.length}</strong> characters
          </span>
          <button
            type="button"
            className="ghost btn-sm"
            onClick={() => setEditing((prev) => !prev)}
            data-testid={`edit-tag-members-${tag.id}`}
          >
            {editing ? 'Done' : 'Assign'}
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
              data-testid={`tag-member-search-${tag.id}`}
            />
            <span className="filter-bar__count">
              {tag.characterIds.length} of {roster.length} have it
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
                    data-testid={`tag-member-check-${tag.id}-${entry.character.id}`}
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

export default function Tags() {
  const [newTag, setNewTag] = useState('');
  const [busy, setBusy] = useState(false);

  const { data, error, reload, setError } = useMcoData(async () => {
    const [tags, roster] = await Promise.all([mco.tags.list(), mco.characters.roster()]);
    return { tags, roster };
  });
  const { tags = [], roster = [] } = data ?? {};

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

  async function createTag(): Promise<void> {
    const name = newTag.trim();
    if (!name) return;
    setNewTag('');
    await run(() => mco.tags.create(name));
  }

  async function removeTag(tag: Tag): Promise<void> {
    const count = tag.characterIds.length;
    if (
      count > 0 &&
      !(await mco.system.confirm(
        `"${tag.name}" is on ${count} character(s) and any group roles using it. Delete the tag?`,
        'Delete',
      ))
    ) {
      return;
    }
    void run(() => mco.tags.remove(tag.id));
  }

  function toggleMember(tagId: number, characterId: number, member: boolean): void {
    void run(() =>
      member
        ? mco.tags.addMember(tagId, characterId)
        : mco.tags.removeMember(tagId, characterId),
    );
  }

  return (
    <section className="page">
      <div className="toolbar">
        <h2>Tags ({tags.length})</h2>
      </div>

      <div className="card">
        <h3>Add tag</h3>
        <p className="muted">
          A tag is a capability — what a character <em>can do</em> (e.g. "Cyno", "Hyper HIC",
          "Fax", "Command Boost"). Tags stay with the character across every group.
        </p>
        <div className="toolbar__actions">
          <input
            value={newTag}
            placeholder="Capability (e.g. Cyno)"
            disabled={busy}
            onChange={(e) => setNewTag(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void createTag();
            }}
            data-testid="new-tag-input"
          />
          <button type="button" disabled={busy} onClick={() => void createTag()} data-testid="add-tag">
            Add
          </button>
        </div>
      </div>

      {error && <div className="error-box" data-testid="tags-error">{error}</div>}

      {tags.length === 0 ? (
        <div className="empty-state">
          <h3>No tags yet</h3>
          <p>
            Create a capability tag above (e.g. "Cyno", "Fax", "Command Boost"), then tick the
            characters able to do it. Within a group you can then assign these as roles.
          </p>
        </div>
      ) : (
        <div className="detail-grid" data-testid="tags-list">
          {tags.map((tag) => (
            <TagCard
              key={tag.id}
              tag={tag}
              roster={roster}
              busy={busy}
              onRename={(name) => void run(() => mco.tags.rename(tag.id, name))}
              onSetColor={(color) => void run(() => mco.tags.setColor(tag.id, color))}
              onRemove={() => void removeTag(tag)}
              onToggleMember={(characterId, member) => toggleMember(tag.id, characterId, member)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
