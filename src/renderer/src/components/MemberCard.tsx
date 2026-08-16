import { type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import type {
  GroupDetail as GroupDetailData,
  GroupMemberStatus,
  GroupObjectiveStatus,
} from '@shared/types';
import { formatSp, formatTimeUntil, romanLevel } from '../lib/format';
import { medicalCloneMismatch, summarizeQueue } from '../lib/groupView';
import { formatCost, loadCostView, type CostSystem } from '../lib/costView';
import CharacterAvatar from './CharacterAvatar';

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

/** One member of a group: identity, live facts, tags, and objective progress. */
export default function MemberCard({
  detail,
  member,
}: {
  detail: GroupDetailData;
  member: GroupMemberStatus;
}) {
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
