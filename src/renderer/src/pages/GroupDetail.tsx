import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { errorMessage, mco } from '../lib/ipc';
import { useMcoData } from '../lib/useMcoData';
import HomeStationPicker from '../components/HomeStationPicker';
import PodWhitelistSection from '../components/PodWhitelistSection';
import MemberCard from '../components/MemberCard';

export default function GroupDetail() {
  const params = useParams<{ id: string }>();
  const groupId = Number(params.id);

  const [editing, setEditing] = useState(false);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);

  // Refreshes on mount, when the route's group changes, and when a background
  // sync sweep updates character data.
  const { data, error, loading, reload, setError } = useMcoData(
    async () => {
      const [detail, fits, plans, roster] = await Promise.all([
        mco.groups.detail(groupId),
        mco.fits.list(),
        mco.plans.list(),
        mco.characters.roster(),
      ]);
      return { detail, fits, plans, roster };
    },
    { deps: [groupId], onCharactersChanged: true },
  );
  const { detail = null, fits = [], plans = [], roster = [] } = data ?? {};

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
          <button type="button" className="ghost" onClick={() => void reload()} disabled={loading}>
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
