import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { NeuralAttributes, PlanSkillInfo } from '@shared/types';
import { formatDuration, formatSp, romanLevel } from '../lib/format';
import { skillDependents, skillLevelRows } from '../lib/skillInfo';

const CARD_WIDTH = 300;
/** Minimum gap kept between the card and every viewport edge. */
const VIEWPORT_MARGIN = 8;
/** Unlocked skills listed before the rest collapse into "+N more". */
const DEPENDENTS_SHOWN = 8;

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/** A skill name inside the card that re-targets the card at that skill. */
function SkillLink({
  id,
  name,
  onSelect,
}: {
  id: number;
  name: string;
  onSelect: (id: number) => void;
}) {
  return (
    <button
      type="button"
      className="skill-info__link"
      onClick={() => onSelect(id)}
      data-testid={`skill-info-link-${id}`}
    >
      {name}
    </button>
  );
}

/**
 * Right-click "show info" for a skill in the plan creator: its group, rank and
 * attributes, SP and training time per level (at the plan's starting
 * attributes), what it needs and what it unlocks. Prerequisite and unlock names
 * open their own info in place, like EVE's info window. Closes on Escape,
 * outside click, or resize. Key it by the clicked skill so a new right-click
 * starts fresh rather than on whatever was navigated to.
 */
export default function SkillInfoMenu({
  x,
  y,
  skillTypeId,
  skills,
  catalog,
  attributes,
  planLevel,
  onFind,
  onClose,
}: {
  x: number;
  y: number;
  skillTypeId: number;
  skills: ReadonlyMap<number, PlanSkillInfo>;
  catalog: readonly PlanSkillInfo[];
  attributes: NeuralAttributes;
  /** The highest level of a skill the plan already trains (0 when absent). */
  planLevel: (skillTypeId: number) => number;
  /** Jump to the skill in the browser; omitted where that makes no sense. */
  onFind?: (skillTypeId: number) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [currentId, setCurrentId] = useState(skillTypeId);
  const [menuHeight, setMenuHeight] = useState(0);

  const skill = skills.get(currentId) ?? null;
  const levels = useMemo(
    () => (skill ? skillLevelRows(skill, attributes) : []),
    [skill, attributes],
  );
  const dependents = useMemo(() => skillDependents(catalog, currentId), [catalog, currentId]);
  const inPlan = planLevel(currentId);
  // No skill with a description means the import predates them, not that
  // skills have none — say how to get them rather than showing nothing.
  const descriptionsImported = useMemo(
    () => catalog.some((s) => s.description !== null),
    [catalog],
  );

  // Re-measure whenever the shown skill changes: a different skill has a
  // different number of prereqs/unlocks, so a different height to clamp.
  useLayoutEffect(() => {
    setMenuHeight(ref.current?.offsetHeight ?? 0);
  }, [currentId]);

  useEffect(() => {
    function onPointerDown(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose();
    }
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
    VIEWPORT_MARGIN,
    Math.min(x, window.innerWidth - CARD_WIDTH - VIEWPORT_MARGIN),
  );
  const top = Math.max(
    VIEWPORT_MARGIN,
    Math.min(y, window.innerHeight - menuHeight - VIEWPORT_MARGIN),
  );

  return (
    <div
      ref={ref}
      className="context-menu skill-info"
      style={{ left, top, width: CARD_WIDTH }}
      role="dialog"
      aria-label={skill ? `${skill.name} info` : 'Skill info'}
      data-testid="skill-info-menu"
      // Keep a right-click inside the card from opening another one.
      onContextMenu={(e) => e.preventDefault()}
    >
      {skill === null ? (
        <div className="context-menu__empty">No static data for this skill.</div>
      ) : (
        <>
          <div className="context-menu__title skill-info__title" title={skill.name}>
            {currentId !== skillTypeId && (
              <button
                type="button"
                className="skill-info__back"
                title="Back"
                onClick={() => setCurrentId(skillTypeId)}
                data-testid="skill-info-back"
              >
                ←
              </button>
            )}
            {skill.name}
          </div>

          {skill.description !== null ? (
            <p className="skill-info__desc" data-testid="skill-info-description">
              {skill.description}
            </p>
          ) : (
            !descriptionsImported && (
              <p className="skill-info__desc muted" data-testid="skill-info-description-missing">
                Re-import static data (banner at the top) to see what skills do.
              </p>
            )
          )}

          <dl className="skill-info__facts">
            <dt>Group</dt>
            <dd>{skill.groupName ?? '—'}</dd>
            <dt>Rank</dt>
            <dd data-testid="skill-info-rank">{skill.rank}</dd>
            <dt>Attributes</dt>
            <dd>
              {skill.primaryAttribute && skill.secondaryAttribute
                ? `${capitalize(skill.primaryAttribute)} / ${capitalize(skill.secondaryAttribute)}`
                : '—'}
            </dd>
            <dt>In plan</dt>
            <dd>{inPlan > 0 ? `to ${romanLevel(inPlan)}` : '—'}</dd>
            {!skill.published && (
              <>
                <dt>Status</dt>
                <dd className="muted">Retired — not trainable</dd>
              </>
            )}
          </dl>

          <table className="skill-info__levels">
            <thead>
              <tr>
                <th>Lv</th>
                <th className="num">Total SP</th>
                <th
                  className="num"
                  title="Time for this level alone, at the plan's starting attributes"
                >
                  Time
                </th>
              </tr>
            </thead>
            <tbody>
              {levels.map((row) => (
                <tr
                  key={row.level}
                  className={row.level <= inPlan ? 'skill-info__level--planned' : undefined}
                >
                  <td>{romanLevel(row.level)}</td>
                  <td className="num">{formatSp(row.sp)}</td>
                  <td className="num">{row.minutes === null ? '—' : formatDuration(row.minutes)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="skill-info__section">
            <div className="skill-info__heading">Requires</div>
            {skill.prereqs.length === 0 ? (
              <div className="muted">—</div>
            ) : (
              <ul className="skill-info__list" data-testid="skill-info-prereqs">
                {skill.prereqs.map((req) => {
                  const name = skills.get(req.skillTypeId)?.name ?? `Skill ${req.skillTypeId}`;
                  const covered = planLevel(req.skillTypeId) >= req.level;
                  return (
                    <li key={req.skillTypeId}>
                      <SkillLink id={req.skillTypeId} name={name} onSelect={setCurrentId} /> {romanLevel(req.level)}
                      {covered && <span className="muted"> · in plan</span>}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="skill-info__section">
            <div className="skill-info__heading">Unlocks ({dependents.length})</div>
            {dependents.length === 0 ? (
              <div className="muted">—</div>
            ) : (
              <ul className="skill-info__list" data-testid="skill-info-unlocks">
                {dependents.slice(0, DEPENDENTS_SHOWN).map(({ skill: dep, level }) => (
                  <li key={dep.skillTypeId}>
                    <SkillLink id={dep.skillTypeId} name={dep.name} onSelect={setCurrentId} />{' '}
                    <span className="muted">at {romanLevel(level)}</span>
                  </li>
                ))}
                {dependents.length > DEPENDENTS_SHOWN && (
                  <li className="muted">+{dependents.length - DEPENDENTS_SHOWN} more</li>
                )}
              </ul>
            )}
          </div>

          {onFind && skill.published && (
            <button
              type="button"
              className="context-menu__item context-menu__item--button skill-info__action"
              onClick={() => {
                onFind(currentId);
                onClose();
              }}
              data-testid="skill-info-find"
            >
              Find in skill list
            </button>
          )}
        </>
      )}
    </div>
  );
}
