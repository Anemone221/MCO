import { type CSSProperties } from 'react';
import { Link, useParams } from 'react-router-dom';
import type {
  CharacterDetail as Detail,
  CharacterPlanProgress,
  JumpCloneEntry,
  OrgRef,
} from '@shared/types';
import { mco } from '../lib/ipc';
import { useMcoData } from '../lib/useMcoData';
import {
  formatDate,
  formatIsk,
  formatIskExact,
  formatSp,
  formatTimeUntil,
  romanLevel,
} from '../lib/format';
import { formatCost, loadCostView } from '../lib/costView';
import CharacterAvatar from '../components/CharacterAvatar';
import StatusSquare from '../components/StatusSquare';
import SkillGroupRadarChart from '../components/charts/SkillGroupRadarChart';

/** Queue entries shown on the card; the shared card height is sized to fit this. */
const QUEUE_LIMIT = 10;

/** Matches the default “Almost there” threshold on the Plan/Fit detail pages. */
const CLOSE_ENOUGH_SP = 500_000;

function cloneLocation(
  clone: Pick<JumpCloneEntry, 'locationId' | 'locationType' | 'locationName'>,
): string {
  if (clone.locationName) return clone.locationName;
  if (clone.locationType === 'structure' && clone.locationId !== null) {
    return `Structure ${clone.locationId}`;
  }
  if (clone.locationId !== null) return `Location ${clone.locationId}`;
  return 'Unknown location';
}

/**
 * At-a-glance red/green toolbar pills. Deliberately not the in-game colors used
 * elsewhere (fatigue-blue, neutral idle): these squares answer "can this
 * character act right now" and use traffic-light semantics instead.
 */
function StatusSquares({ detail }: { detail: Detail }) {
  const now = Date.now();

  const fatigueExpire = detail.jumpFatigue?.expireDate ?? null;
  const fatigued = fatigueExpire !== null && new Date(fatigueExpire).getTime() > now;

  const nextJump = detail.nextCloneJumpAt;
  const jcCooldown = nextJump !== null && new Date(nextJump).getTime() > now;

  // Green: this character trains. Grey: a sibling holds the account's training
  // slot (routine). Red: an Omega account is training nobody — wasted time.
  let trainingTone: 'ok' | 'danger' | 'idle' = 'idle';
  if (detail.isTraining) {
    trainingTone = 'ok';
  } else if (
    detail.accountStatus !== null &&
    detail.accountStatus.isOmega &&
    !detail.accountStatus.otherCharacterTraining
  ) {
    trainingTone = 'danger';
  }

  return (
    <div className="status-squares">
      <StatusSquare
        title="Fatigue"
        tone={fatigued ? 'danger' : 'ok'}
        label={fatigued ? formatTimeUntil(fatigueExpire).replace(/^in /, '') : 'Clear'}
        testId="square-fatigue"
      />
      <StatusSquare
        title="Jump Clone"
        tone={jcCooldown ? 'danger' : 'ok'}
        label={jcCooldown ? formatTimeUntil(nextJump).replace(/^in /, '') : 'Ready'}
        testId="square-jump-clone"
      />
      <StatusSquare
        title="Training"
        tone={trainingTone}
        label={detail.isTraining ? 'Training' : 'Idle'}
        testId="square-training"
      />
    </div>
  );
}

function WalletCard({ detail }: { detail: Detail }) {
  const wallet = detail.wallet;
  return (
    <div className="card">
      <h3>Wallet</h3>
      <div className="card-body">
        {wallet ? (
          <>
            <p className="wallet-balance" data-testid="detail-wallet" title={formatIskExact(wallet.balance)}>
              {formatIsk(wallet.balance)}
            </p>
            <p className="muted">{formatIskExact(wallet.balance)}</p>
          </>
        ) : detail.walletStatus === 'scope-missing' ? (
          <p className="muted">Wallet scope not granted — re-add this character to enable it.</p>
        ) : detail.walletStatus === 'login-expired' ? (
          <p className="muted">Login expired — re-add this character.</p>
        ) : (
          <p className="muted">No wallet data synced yet.</p>
        )}
      </div>
    </div>
  );
}

function FatigueCard({ detail }: { detail: Detail }) {
  const fatigue = detail.jumpFatigue;
  const expire = fatigue?.expireDate ?? null;
  const fatigued = expire !== null && new Date(expire).getTime() > Date.now();

  return (
    <div className="card">
      <h3>Jump fatigue</h3>
      <div className="card-body">
        {!fatigue ? (
          <p className="muted">No fatigue data synced yet.</p>
        ) : (
          <dl>
            <dt>Fatigue</dt>
            <dd>
              {fatigued ? (
                <>
                  <span className="chip chip--fatigue" data-testid="detail-fatigue">
                    {formatTimeUntil(expire).replace(/^in /, '')}
                  </span>{' '}
                  <span className="muted">clears {formatDate(expire)}</span>
                </>
              ) : (
                '—'
              )}
            </dd>
            <dt>Last jump</dt>
            <dd>{formatDate(fatigue.lastJumpDate)}</dd>
          </dl>
        )}
      </div>
    </div>
  );
}

function AttributesCard({ detail }: { detail: Detail }) {
  const attrs = detail.attributes;
  const remapAt = attrs?.accruedRemapCooldownDate ?? null;
  const remapOnCooldown = remapAt !== null && new Date(remapAt).getTime() > Date.now();

  return (
    <div className="card">
      <h3>Attributes</h3>
      <div className="card-body">
        {!attrs ? (
          <p className="muted">No attribute data synced yet.</p>
        ) : (
          <dl data-testid="detail-attributes">
            <dt>Intelligence</dt>
            <dd>{attrs.intelligence}</dd>
            <dt>Memory</dt>
            <dd>{attrs.memory}</dd>
            <dt>Perception</dt>
            <dd>{attrs.perception}</dd>
            <dt>Willpower</dt>
            <dd>{attrs.willpower}</dd>
            <dt>Charisma</dt>
            <dd>{attrs.charisma}</dd>
            <dt>Bonus remaps</dt>
            <dd>{attrs.bonusRemaps ?? '—'}</dd>
            <dt>Next remap</dt>
            <dd data-testid="detail-next-remap">
              {remapOnCooldown ? (
                <>
                  <span className="chip chip--fatigue">
                    {formatTimeUntil(remapAt).replace(/^in /, '')}
                  </span>{' '}
                  <span className="muted">ready {formatDate(remapAt)}</span>
                </>
              ) : (
                'Available'
              )}
            </dd>
            <dt>Last remap</dt>
            <dd>{formatDate(attrs.lastRemapDate)}</dd>
          </dl>
        )}
      </div>
    </div>
  );
}

function ChipListCard({
  title,
  items,
  emptyText,
  testId,
}: {
  title: string;
  items: OrgRef[];
  emptyText: string;
  testId: string;
}) {
  return (
    <div className="card">
      <h3>
        {title} ({items.length})
      </h3>
      <div className="card-body" data-testid={testId}>
        {items.length === 0 ? (
          <p className="muted">{emptyText}</p>
        ) : (
          <div className="tag-chips">
            {items.map((item) => (
              <span
                key={item.id}
                className="chip tag-chip"
                style={
                  item.color ? ({ '--tag-color': item.color } as CSSProperties) : undefined
                }
              >
                {item.name}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PlanProgressRow({ plan }: { plan: CharacterPlanProgress }) {
  const pct = plan.progress * 100;
  // Cost shown in the system chosen on that plan's detail page.
  const system = loadCostView('plan', plan.planId).system;
  // Unknown time falls back to the SP gap — no room here to explain why.
  const timeUnknown = system === 'time' && plan.timeGapMinutes === null;
  const costText = timeUnknown ? formatSp(plan.spGap) : formatCost(system, plan);
  // Tick where “remaining SP == threshold”; pointless on plans smaller than it,
  // and meaningless when the plan measures cost in another system.
  const tick =
    system === 'sp' && plan.totalSp > CLOSE_ENOUGH_SP
      ? (1 - CLOSE_ENOUGH_SP / plan.totalSp) * 100
      : null;

  return (
    <div className="plan-progress" data-testid={`plan-progress-${plan.planId}`}>
      <div className="plan-progress__label">
        <Link to={`/plans/${plan.planId}`}>{plan.planName}</Link>
        <span
          className="muted"
          title={
            timeUnknown
              ? 'No training-time data — attributes not synced or static data needs re-import'
              : undefined
          }
        >
          {plan.complete ? 'Complete' : `${Math.floor(pct)}% · ${costText} left`}
        </span>
      </div>
      <div
        className="plan-progress__bar"
        title={
          tick !== null
            ? `Marker: within ${formatSp(CLOSE_ENOUGH_SP)} of completing the plan`
            : undefined
        }
      >
        <div
          className="plan-progress__fill"
          style={{
            width: `${pct}%`,
            // Hue tracks completion: pure red at 0%, through amber, pure green at 100%.
            background: `color-mix(in hsl, var(--ok) ${pct}%, var(--danger))`,
          }}
        />
        {tick !== null && <span className="plan-progress__tick" style={{ left: `${tick}%` }} />}
      </div>
    </div>
  );
}

function SkillPlansCard({ detail }: { detail: Detail }) {
  return (
    <div className="card">
      <h3>Skill plans ({detail.plans.length})</h3>
      <div className="card-body" data-testid="detail-plans">
        {detail.plansNeedSkillData ? (
          <p className="muted">
            Static data has no skill-requirement data yet. Re-import static data (top of the
            Roster page) to enable plan analysis.
          </p>
        ) : detail.plans.length === 0 ? (
          // Covers both "none imported" and "every plan opted out of the sheet",
          // so it points at the page where either is fixed.
          <p className="muted">
            No skill plans to show. Import one, or turn a plan on for character sheets, on the{' '}
            <Link to="/plans">Skill Plans</Link> page.
          </p>
        ) : (
          detail.plans.map((plan) => <PlanProgressRow key={plan.planId} plan={plan} />)
        )}
      </div>
    </div>
  );
}

function SkillRadarCard({ detail }: { detail: Detail }) {
  // Every group's ceiling comes from sde_skill_ranks; with none imported there is
  // nothing to divide by, so say that rather than draw a web pinned at zero.
  const hasGroupCeilings = detail.skillGroups.some((g) => g.maxSp > 0);
  return (
    <div className="card skill-radar-card" data-testid="detail-skill-radar">
      <h3>Skills by group (% trained)</h3>
      {detail.skillGroups.length === 0 ? (
        <div className="card-body">
          <p className="muted">No skill data synced yet.</p>
        </div>
      ) : !hasGroupCeilings ? (
        <div className="card-body">
          <p className="muted">
            Static data has no skill ranks yet. Re-import static data (top of the Roster page) to
            show how far each group is trained.
          </p>
        </div>
      ) : (
        <SkillGroupRadarChart groups={detail.skillGroups} />
      )}
    </div>
  );
}

function JumpClonesCard({ detail }: { detail: Detail }) {
  return (
    <div className="card">
      <h3>Jump clones ({detail.clones.length})</h3>
      <div className="card-body">
        {detail.clonesUpdatedAt === null ? (
          <p className="muted">No clone data synced yet.</p>
        ) : detail.clones.length === 0 ? (
          <p className="muted">No jump clones.</p>
        ) : (
          detail.clones.map((clone) => (
            <details key={clone.jumpCloneId} className="clone-block">
              <summary data-testid={`clone-toggle-${clone.jumpCloneId}`}>
                {clone.name ?? 'Jump clone'}
                <span className="muted">
                  {' '}
                  · {cloneLocation(clone)} · {clone.implants.length} implants
                </span>
              </summary>
              {clone.implants.length === 0 ? (
                <p className="muted">No implants.</p>
              ) : (
                <ul className="implant-list">
                  {clone.implants.map((i) => (
                    <li key={i.typeId}>{i.typeName ?? `Implant ${i.typeId}`}</li>
                  ))}
                </ul>
              )}
            </details>
          ))
        )}
      </div>
    </div>
  );
}

export default function CharacterDetail() {
  const params = useParams<{ id: string }>();
  const characterId = Number(params.id);

  const {
    data: detail,
    error,
    loading,
    reload,
  } = useMcoData<Detail>(() => mco.characters.detail(characterId), { deps: [characterId] });

  return (
    <section className="page">
      <div className="toolbar">
        <h2 className="cell-with-avatar">
          <Link to="/roster" className="back-link">
            ← Roster
          </Link>
          {detail && (
            <>
              <CharacterAvatar characterId={detail.character.id} size={48} />
              {detail.character.name}
            </>
          )}
        </h2>
        <div className="toolbar__actions">
          {detail && <StatusSquares detail={detail} />}
          <button type="button" className="ghost" onClick={() => void reload()} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && <div className="error-box" data-testid="detail-error">{error}</div>}

      {detail && (
        <div className="detail-grid detail-grid--uniform">
          <div className="card-pair">
            <ChipListCard
              title="Groups"
              items={detail.groups}
              emptyText="Not in any group."
              testId="detail-groups"
            />
            <ChipListCard
              title="Tags"
              items={detail.tags}
              emptyText="No tags assigned."
              testId="detail-tags"
            />
          </div>

          <div className="card-pair card-pair--stack">
            <WalletCard detail={detail} />
            <FatigueCard detail={detail} />
          </div>

          <div className="card">
            <h3>Overview</h3>
            <div className="card-body">
              <dl>
                <dt>Total SP</dt>
                <dd>{formatSp(detail.totalSp)}</dd>
                <dt>Location</dt>
                <dd>
                  {detail.location
                    ? (detail.location.solarSystemName ?? `System ${detail.location.solarSystemId}`)
                    : '—'}
                </dd>
                <dt>Active ship</dt>
                <dd>
                  {detail.ship
                    ? `${detail.ship.typeName ?? `Type ${detail.ship.typeId}`} — ${detail.ship.name}`
                    : '—'}
                </dd>
                <dt>Next jump</dt>
                <dd data-testid="detail-next-jump">
                  {detail.clonesUpdatedAt === null ? (
                    '—'
                  ) : detail.nextCloneJumpAt !== null &&
                    new Date(detail.nextCloneJumpAt).getTime() > Date.now() ? (
                    <>
                      <span className="chip chip--fatigue">
                        {formatTimeUntil(detail.nextCloneJumpAt).replace(/^in /, '')}
                      </span>{' '}
                      <span className="muted">ready {formatDate(detail.nextCloneJumpAt)}</span>
                    </>
                  ) : (
                    'Ready'
                  )}
                </dd>
                <dt>Med clone</dt>
                <dd data-testid="detail-med-clone">
                  {detail.medicalClone ? cloneLocation(detail.medicalClone) : '—'}
                </dd>
                <dt>Last sync</dt>
                <dd>{formatDate(detail.character.refreshedAt)}</dd>
              </dl>
            </div>
          </div>

          <AttributesCard detail={detail} />

          <div className="card">
            <h3>Skill queue ({detail.skillQueue.length})</h3>
            <div className="card-body">
              {detail.skillQueue.length === 0 ? (
                <p className="muted">Queue is empty.</p>
              ) : (
                <>
                  <ol className="queue-list">
                    {detail.skillQueue.slice(0, QUEUE_LIMIT).map((q) => (
                      <li key={q.position}>
                        <span>
                          {q.skillName ?? `Type ${q.skillTypeId}`} {romanLevel(q.finishLevel)}
                        </span>
                        <span className="muted">{formatTimeUntil(q.finishDate)}</span>
                      </li>
                    ))}
                  </ol>
                  {detail.skillQueue.length > QUEUE_LIMIT && (
                    <p className="muted queue-more">
                      +{detail.skillQueue.length - QUEUE_LIMIT} more in queue
                    </p>
                  )}
                </>
              )}
            </div>
          </div>

          <SkillPlansCard detail={detail} />

          <div className="card">
            <h3>Implants ({detail.implants.length})</h3>
            <div className="card-body">
              {detail.implants.length === 0 ? (
                <p className="muted">No implants reported.</p>
              ) : (
                <ul className="implant-list">
                  {detail.implants.map((i) => (
                    <li key={i.typeId}>{i.typeName ?? `Type ${i.typeId}`}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <JumpClonesCard detail={detail} />

          <SkillRadarCard detail={detail} />
        </div>
      )}
    </section>
  );
}
