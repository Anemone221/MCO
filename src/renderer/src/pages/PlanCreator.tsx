import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type {
  Fit,
  NeuralAttributes,
  PlanDraftEntry,
  PlanDraftSource,
  PlanSkillInfo,
  ShipInfo,
  TrainingAttribute,
} from '@shared/types';
import {
  attributeAbbr,
  BALANCED_ATTRIBUTES,
  MAX_ATTRIBUTE,
  MIN_ATTRIBUTE,
  TRAINING_ATTRIBUTES,
} from '@shared/training';
import { errorMessage, mco } from '../lib/ipc';
import { useMcoData } from '../lib/useMcoData';
import { formatDuration, formatSp, romanLevel } from '../lib/format';
import { prefersReducedMotion } from '../lib/motion';
import {
  addRequirements,
  breaksGroupStandard,
  draftIssues,
  draftText,
  draftTotals,
  entryKey,
  entrySpCosts,
  entryTimeCosts,
  expandLevels,
  filterGroups,
  groupSkills,
  ISSUE_LABEL,
  lowerSkill,
  MAX_LEVEL,
  mergeSkills,
  moveEntry,
  optimizeAttributes,
  planLevel,
  raiseSkill,
  removeEntry,
  removeFromLevel,
  sortByPrereqs,
  type SkillGroup,
  type SkillMap,
} from '../lib/planDraft';
import {
  isBalanced,
  loadPlanAttributes,
  savePlanAttributes,
  withAttribute,
} from '../lib/planAttributes';
import ShipBrowser from '../components/ShipBrowser';

/** DOM id of a skill's row in the browser, so the plan can scroll to it. */
function browserSkillId(skillTypeId: number): string {
  return `browser-skill-${skillTypeId}`;
}

/** The skill/level pairs a draft source contributes; id-less lines can't be trained. */
function sourceRequirements(source: PlanDraftSource): Array<{ skillTypeId: number; level: number }> {
  return source.entries
    .filter((entry): entry is PlanDraftEntry & { skillTypeId: number } => entry.skillTypeId !== null)
    .map((entry) => ({ skillTypeId: entry.skillTypeId, level: entry.level }));
}

/**
 * The attributes training time is priced at. A plan is written for a character
 * who will often remap before training it, so these are set rather than synced.
 */
function AttributeEditor({
  attributes,
  canOptimize,
  onChange,
  onOptimize,
  onReset,
}: {
  attributes: NeuralAttributes;
  canOptimize: boolean;
  onChange: (attribute: TrainingAttribute, value: number) => void;
  onOptimize: () => void;
  onReset: () => void;
}) {
  return (
    <div className="card attribute-editor" data-testid="attribute-editor">
      <div className="bucket-head">
        <h3>Training attributes</h3>
        <div className="toolbar__actions">
          <button
            type="button"
            className="btn-sm"
            disabled={!canOptimize}
            title="Rearrange these points into the fastest legal remap for this plan"
            onClick={onOptimize}
            data-testid="optimize-attributes"
          >
            Optimize attributes
          </button>
          <button type="button" className="ghost btn-sm" onClick={onReset}>
            Reset to balanced
          </button>
        </div>
      </div>
      <p className="muted">
        What this character will have while training the plan — remap plus implants. Every
        attribute starts at {MIN_ATTRIBUTE} with 14 points to spread (27 max before implants);
        balanced spends them evenly. <strong>Optimize</strong> keeps the total you've set and
        rearranges it into the fastest arrangement this plan allows.
      </p>
      <div className="attribute-editor__fields">
        {TRAINING_ATTRIBUTES.map((attribute) => (
          <label key={attribute}>
            <span>{attributeAbbr(attribute)}</span>
            <input
              type="number"
              min={MIN_ATTRIBUTE}
              max={MAX_ATTRIBUTE}
              value={attributes[attribute]}
              onChange={(e) => onChange(attribute, Number(e.target.value))}
              data-testid={`attribute-${attribute}`}
            />
          </label>
        ))}
      </div>
    </div>
  );
}

/** One skill row in the browser: its level in the plan, and the − / + that set it. */
function BrowserSkill({
  skill,
  group,
  level,
  disabled,
  revealed,
  onRaise,
  onLower,
}: {
  skill: PlanSkillInfo;
  group: SkillGroup;
  level: number;
  disabled: boolean;
  /** Just jumped to from the plan — highlighted until the eye has found it. */
  revealed: boolean;
  onRaise: () => void;
  onLower: () => void;
}) {
  // The group header already states the pair its skills train against; only the
  // ones that break it repeat it.
  const deviates = breaksGroupStandard(group, skill);
  return (
    <li
      id={browserSkillId(skill.skillTypeId)}
      className={[
        'skill-browser__skill',
        level > 0 ? 'skill-browser__skill--queued' : '',
        revealed ? 'skill-browser__skill--revealed' : '',
      ]
        .join(' ')
        .trim()}
    >
      <span className="skill-browser__name" title={`Rank ${skill.rank}`}>
        {skill.name}
        {deviates && (
          <span className="skill-browser__attrs muted">
            {' · '}
            {attributeAbbr(skill.primaryAttribute)}/{attributeAbbr(skill.secondaryAttribute)}
          </span>
        )}
      </span>
      <span className="skill-browser__level" data-testid={`browser-level-${skill.skillTypeId}`}>
        {level > 0 ? romanLevel(level) : '—'}
      </span>
      <span className="skill-browser__buttons">
        <button
          type="button"
          className="btn-sm"
          disabled={disabled || level === 0}
          title={`Remove ${skill.name} ${romanLevel(level)}`}
          onClick={onLower}
          data-testid={`browser-minus-${skill.skillTypeId}`}
        >
          −
        </button>
        <button
          type="button"
          className="btn-sm"
          disabled={disabled || level >= MAX_LEVEL}
          title={`Add ${skill.name} ${romanLevel(Math.min(level + 1, MAX_LEVEL))}`}
          onClick={onRaise}
          data-testid={`browser-plus-${skill.skillTypeId}`}
        >
          +
        </button>
      </span>
    </li>
  );
}

/** Pull a whole fit's skill requirements in — either a saved one or pasted EFT. */
function FitImporter({
  fits,
  disabled,
  onOpenShips,
  onAddFit,
  onAddEft,
}: {
  fits: Fit[];
  disabled: boolean;
  onOpenShips: () => void;
  onAddFit: (fitId: number) => void;
  onAddEft: (eftText: string) => void;
}) {
  const [fitId, setFitId] = useState('');
  const [eftOpen, setEftOpen] = useState(false);
  const [eftText, setEftText] = useState('');

  return (
    <div className="creator-source">
      <div className="toolbar__actions">
        <button
          type="button"
          disabled={disabled}
          onClick={onOpenShips}
          data-testid="open-ship-browser"
        >
          Ship Browser
        </button>
        <select
          value={fitId}
          disabled={disabled || fits.length === 0}
          onChange={(e) => setFitId(e.target.value)}
          data-testid="creator-fit-select"
        >
          <option value="">{fits.length === 0 ? 'No saved fits' : 'Add the skills for a fit…'}</option>
          {fits.map((fit) => (
            <option key={fit.id} value={fit.id}>
              {fit.name} · {fit.shipName}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={disabled || fitId === ''}
          onClick={() => onAddFit(Number(fitId))}
          data-testid="creator-add-fit"
        >
          Add fit skills
        </button>
        <button type="button" className="ghost" onClick={() => setEftOpen((open) => !open)}>
          {eftOpen ? 'Hide EFT' : 'Paste EFT…'}
        </button>
      </div>

      {eftOpen && (
        <>
          <textarea
            className="eft-input"
            rows={5}
            value={eftText}
            placeholder={'[Hurricane, My Hurricane]\n425mm AutoCannon II\n...'}
            onChange={(e) => setEftText(e.target.value)}
            data-testid="creator-eft-input"
          />
          <div className="toolbar__actions">
            <button
              type="button"
              disabled={disabled || eftText.trim() === ''}
              onClick={() => onAddEft(eftText)}
              data-testid="creator-add-eft"
            >
              Add pasted fit's skills
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Build a skill plan by hand: browse every skill in the game on the right, tick
 * levels into the training queue on the left, drag them into the order you
 * want, and save it as a plan or copy it out for EVE's own skill-plan import.
 *
 * The queue is one row per level, the way a plan actually trains. Prerequisites
 * are added with the level that needs them, so a draft is in trainable order as
 * it is built.
 */
export default function PlanCreator() {
  const params = useParams<{ id: string }>();
  const editingId = params.id ? Number(params.id) : null;
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [entries, setEntries] = useState<PlanDraftEntry[]>([]);
  const [unresolved, setUnresolved] = useState<string[]>([]);
  const [attributes, setAttributes] = useState<NeuralAttributes>(() => loadPlanAttributes());
  const [attributesOpen, setAttributesOpen] = useState(false);
  const [shipBrowserOpen, setShipBrowserOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [openGroups, setOpenGroups] = useState<ReadonlySet<number>>(new Set());
  /**
   * The skill just jumped to, with a sequence number: clicking the same skill
   * again has to re-scroll to it, and identical state would not re-run the
   * effect that does.
   */
  const [revealed, setRevealed] = useState<{ skillTypeId: number; seq: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  /** The row whose grip is held down — the only row HTML5 drag may start on. */
  const [dragArmed, setDragArmed] = useState<number | null>(null);

  const { data, error, loading, setError } = useMcoData(
    async () => {
      const [catalog, ships, fits, sde, source] = await Promise.all([
        mco.plans.skillCatalog(),
        mco.plans.shipCatalog(),
        mco.fits.list(),
        mco.sde.status(),
        editingId === null ? Promise.resolve(null) : mco.plans.draft(editingId),
      ]);
      return { catalog, ships, fits, sde, source };
    },
    { deps: [editingId] },
  );
  const fits = data?.fits ?? [];
  const ships = data?.ships ?? [];
  const sde = data?.sde ?? null;

  const skills: SkillMap = useMemo(
    () => mergeSkills(new Map(), data?.catalog ?? []),
    [data?.catalog],
  );
  const groups = useMemo(() => groupSkills(data?.catalog ?? []), [data?.catalog]);
  const visibleGroups = useMemo(() => filterGroups(groups, filter), [groups, filter]);
  // A filter narrow enough to name skills opens what it found; browsing by hand
  // leaves the groups as the user left them.
  const filtering = filter.trim().length > 0;

  // Seed the queue once the plan being edited has loaded. Only a fresh load
  // writes here, so nothing the user has since typed is overwritten.
  const source = data?.source ?? null;
  useEffect(() => {
    if (!source) return;
    setEntries(expandLevels(source.entries));
    setUnresolved(source.unresolved);
    setName(source.suggestedName ?? '');
  }, [source]);

  useEffect(() => {
    if (notice === null) return;
    const timer = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  // Scroll the revealed skill into the browser's view once its group has
  // rendered open, and drop the highlight after long enough to find it.
  useEffect(() => {
    if (revealed === null) return;
    document.getElementById(browserSkillId(revealed.skillTypeId))?.scrollIntoView({
      block: 'center',
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    });
    const timer = window.setTimeout(() => setRevealed(null), 2500);
    return () => window.clearTimeout(timer);
  }, [revealed]);

  const costs = useMemo(() => entrySpCosts(entries, skills), [entries, skills]);
  const times = useMemo(
    () => entryTimeCosts(entries, skills, attributes),
    [entries, skills, attributes],
  );
  const issues = useMemo(() => draftIssues(entries, skills), [entries, skills]);
  const totals = useMemo(
    () => draftTotals(entries, skills, attributes),
    [entries, skills, attributes],
  );
  const orderIssueCount = useMemo(
    () => [...issues.values()].filter((issue) => issue.kind === 'order').length,
    [issues],
  );

  /** Running training time down the rows — when this line finishes. */
  const elapsed = useMemo(() => {
    let running = 0;
    return times.map((minutes) => {
      running += minutes ?? 0;
      return running;
    });
  }, [times]);

  function changeAttribute(attribute: TrainingAttribute, value: number): void {
    setAttributes((prev) => {
      const next = withAttribute(prev, attribute, value);
      savePlanAttributes(next);
      return next;
    });
  }

  /** Rearrange the attributes into the fastest legal remap for this plan. */
  function optimize(): void {
    const next = optimizeAttributes(entries, skills, attributes);
    setAttributes(next);
    savePlanAttributes(next);
    const after = draftTotals(entries, skills, next).minutes;
    setNotice(
      after < totals.minutes
        ? `Attributes optimised — ${formatDuration(totals.minutes)} → ${formatDuration(after)}.`
        : 'Already the fastest arrangement for this plan.',
    );
  }

  /** Every skill a hull needs, straight from the ship browser. */
  function addShip(ship: ShipInfo): void {
    setShipBrowserOpen(false);
    const grown = addRequirements(entries, ship.requirements, skills);
    const added = grown.length - entries.length;
    setEntries(grown);
    if (name.trim() === '') setName(ship.name);
    setNotice(
      added === 0
        ? `Every skill for the ${ship.name} is already in the plan.`
        : `Added ${added} level${added === 1 ? '' : 's'} to fly the ${ship.name}.`,
    );
  }

  async function addSource(load: () => Promise<PlanDraftSource>): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      const next = await load();
      const grown = addRequirements(entries, sourceRequirements(next), skills);
      setEntries(grown);
      setUnresolved(next.unresolved);
      if (name.trim() === '' && next.suggestedName) setName(next.suggestedName);
      const added = grown.length - entries.length;
      setNotice(
        added === 0
          ? 'Every skill that fit needs is already in the plan.'
          : `Added ${added} level${added === 1 ? '' : 's'} for ${next.suggestedName ?? 'the fit'}.`,
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function move(from: number, to: number): void {
    setEntries((prev) => moveEntry(prev, from, to));
  }

  /**
   * Jump from a queued level to the skill it trains, in the browser: opens its
   * group, scrolls to it and marks it, so its − / + are right there. A filter
   * that already shows the skill is left alone; one that hides it is cleared,
   * since an open group the filter excludes would show nothing.
   */
  function reveal(skillTypeId: number | null): void {
    if (skillTypeId === null) return;
    const groupId = skills.get(skillTypeId)?.groupId;
    if (groupId === null || groupId === undefined) return;

    const shown = visibleGroups.some((group) =>
      group.skills.some((skill) => skill.skillTypeId === skillTypeId),
    );
    if (!shown) setFilter('');
    setOpenGroups((prev) => new Set(prev).add(groupId));
    setRevealed((prev) => ({ skillTypeId, seq: (prev?.seq ?? 0) + 1 }));
  }

  function endDrag(): void {
    setDragIndex(null);
    setDropIndex(null);
    setDragArmed(null);
  }

  async function save(asNew: boolean): Promise<void> {
    const planName = name.trim();
    if (planName === '' || entries.length === 0) return;
    setError(null);
    setBusy(true);
    try {
      const text = draftText(entries);
      const plan =
        editingId === null || asNew
          ? await mco.plans.import(planName, text)
          : await mco.plans.update(editingId, planName, text);
      navigate(`/plans/${plan.id}`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function copy(): Promise<void> {
    setError(null);
    try {
      await mco.system.copyText(draftText(entries));
      setNotice("Copied — paste it into EVE's skill plan import.");
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function clear(): Promise<void> {
    if (!(await mco.system.confirm('Clear every skill from this draft?', 'Clear'))) return;
    setEntries([]);
    setUnresolved([]);
  }

  const canSave = name.trim() !== '' && entries.length > 0 && !busy;
  const attributeSummary = TRAINING_ATTRIBUTES.map((a) => attributes[a]).join('/');

  return (
    <section className="page page--fill">
      <div className="toolbar">
        <h2>
          <Link to="/plans" className="back-link">
            ← Skill Plans
          </Link>
          {editingId === null ? ' · New plan' : ' · Edit plan'}
        </h2>
        <div className="toolbar__actions">
          <input
            value={name}
            placeholder="Plan name"
            disabled={loading}
            onChange={(e) => setName(e.target.value)}
            data-testid="creator-name"
          />
          <button
            type="button"
            className="ghost"
            onClick={() => setAttributesOpen((open) => !open)}
            title="Attributes training time is estimated at"
            data-testid="creator-attributes-toggle"
          >
            Attributes {attributeSummary}
            {isBalanced(attributes) ? ' (balanced)' : ''}
          </button>
          <button
            type="button"
            className="ghost"
            disabled={entries.length === 0}
            onClick={() => void copy()}
            data-testid="creator-copy"
          >
            Copy to clipboard
          </button>
          {editingId !== null && (
            <button
              type="button"
              className="ghost"
              disabled={!canSave}
              onClick={() => void save(true)}
              data-testid="creator-save-as-new"
            >
              Save as new
            </button>
          )}
          <button
            type="button"
            disabled={!canSave}
            onClick={() => void save(false)}
            data-testid="creator-save"
          >
            {editingId === null ? 'Save plan' : 'Save changes'}
          </button>
        </div>
      </div>

      {error && (
        <div className="error-box" data-testid="creator-error">
          {error}
        </div>
      )}
      {notice && (
        <div className="creator-notice" data-testid="creator-notice">
          {notice}
        </div>
      )}
      {sde && !sde.hasSkillData && (
        <div className="config-banner" data-testid="creator-needs-skill-data">
          Static data has no skill data yet, so skills can't be browsed or costed. Import it from
          the banner at the top of the Roster page.
        </div>
      )}

      {attributesOpen && (
        <AttributeEditor
          attributes={attributes}
          canOptimize={entries.length > 0}
          onChange={changeAttribute}
          onOptimize={optimize}
          onReset={() => {
            setAttributes(BALANCED_ATTRIBUTES);
            savePlanAttributes(BALANCED_ATTRIBUTES);
          }}
        />
      )}

      <div className="plan-split">
        <div className="plan-split__pane" data-testid="creator-plan-pane">
          <div className="bucket-head">
            <h3>Plan ({entries.length})</h3>
            <div className="toolbar__actions">
              <button
                type="button"
                className="ghost btn-sm"
                disabled={entries.length === 0}
                onClick={() => setEntries((prev) => sortByPrereqs(prev, skills))}
                data-testid="creator-fix-order"
              >
                Fix training order
              </button>
              <button
                type="button"
                className="danger btn-sm"
                disabled={entries.length === 0}
                onClick={() => void clear()}
                data-testid="creator-clear"
              >
                Clear
              </button>
            </div>
          </div>

          <div className="stats-strip">
            <span className="stat-chip" data-testid="creator-total-time">
              <strong>{formatDuration(totals.minutes)}</strong> training
            </span>
            <span className="stat-chip">
              <strong>{formatSp(totals.sp)}</strong> total
              {totals.unknown > 0 && <span className="muted"> · {totals.unknown} unknown</span>}
            </span>
            {orderIssueCount > 0 && (
              <span className="stat-chip stat-chip--warn" data-testid="creator-order-warning">
                <strong>{orderIssueCount}</strong> out of order
              </span>
            )}
          </div>

          {unresolved.length > 0 && (
            <p className="muted" data-testid="creator-unresolved">
              No static data for: {unresolved.join(', ')}
            </p>
          )}

          {entries.length === 0 ? (
            <div className="empty-state">
              <h3>Nothing in this plan yet</h3>
              <p>
                Add levels from the skill list on the right, or pull in every skill a fit needs.
                Prerequisites come along automatically, in the order they have to be trained.
              </p>
            </div>
          ) : (
            <div className="table-scroll">
              <table className="data-table plan-draft" data-testid="creator-table">
                <thead>
                  <tr>
                    <th className="num">#</th>
                    <th className="plan-draft__name-head">Skill</th>
                    <th title="Level this row trains to">Lv</th>
                    <th title="Primary and secondary training attribute">Attr</th>
                    <th className="num">SP</th>
                    <th className="num">Time</th>
                    <th className="num" title="Training time once this level is done">
                      Done at
                    </th>
                    <th aria-label="actions" />
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry, index) => {
                    const key = entryKey(entry);
                    const skill = entry.skillTypeId === null ? null : skills.get(entry.skillTypeId);
                    const issue = issues.get(key);
                    const cost = costs[index];
                    const minutes = times[index];
                    return (
                      <tr
                        key={key}
                        // Only the grip starts a drag. With the whole row
                        // draggable, any click that drifts a few pixels — most
                        // of them, on a row this short — became a drag instead,
                        // and Chromium fires no click after a drag.
                        draggable={dragArmed === index}
                        onClick={(e) => {
                          // The row's own controls are not a reveal.
                          if ((e.target as HTMLElement).closest('button, select')) return;
                          reveal(entry.skillTypeId);
                        }}
                        onMouseUp={() => setDragArmed(null)}
                        onDragStart={(e) => {
                          setDragIndex(index);
                          e.dataTransfer.effectAllowed = 'move';
                          e.dataTransfer.setData('text/plain', key);
                        }}
                        onDragOver={(e) => {
                          if (dragIndex === null) return;
                          e.preventDefault();
                          e.dataTransfer.dropEffect = 'move';
                          setDropIndex(index);
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          if (dragIndex !== null) move(dragIndex, index);
                          endDrag();
                        }}
                        onDragEnd={endDrag}
                        className={[
                          dragIndex === index ? 'plan-draft__row--dragging' : '',
                          dropIndex === index && dragIndex !== index ? 'plan-draft__row--over' : '',
                        ]
                          .join(' ')
                          .trim()}
                        data-testid={`creator-row-${index}`}
                      >
                        <td className="num muted">{index + 1}</td>
                        <td
                          className={
                            entry.skillTypeId === null
                              ? 'plan-draft__name'
                              : 'plan-draft__name plan-draft__name--linked'
                          }
                          title={
                            entry.skillTypeId === null
                              ? entry.skillName
                              : `${entry.skillName} — click to find it in the skill list`
                          }
                          role={entry.skillTypeId === null ? undefined : 'button'}
                          tabIndex={entry.skillTypeId === null ? undefined : 0}
                          onKeyDown={(e) => {
                            if (e.key !== 'Enter' && e.key !== ' ') return;
                            e.preventDefault();
                            reveal(entry.skillTypeId);
                          }}
                          data-testid={`creator-reveal-${index}`}
                        >
                          <span
                            className="plan-draft__grip"
                            title="Drag to reorder"
                            onMouseDown={() => setDragArmed(index)}
                            aria-hidden="true"
                          >
                            ⠿
                          </span>
                          {issue && (
                            <span
                              className={`plan-draft__issue plan-draft__issue--${issue.kind}`}
                              title={issue.message}
                              data-testid={`creator-issue-${index}`}
                            >
                              {ISSUE_LABEL[issue.kind]}
                            </span>
                          )}
                          {entry.skillName}
                        </td>
                        <td className="plan-draft__level">{romanLevel(entry.level)}</td>
                        <td
                          className="muted"
                          title={
                            skill?.primaryAttribute
                              ? `Primary ${skill.primaryAttribute}, secondary ${skill.secondaryAttribute}`
                              : undefined
                          }
                        >
                          {attributeAbbr(skill?.primaryAttribute)}/
                          {attributeAbbr(skill?.secondaryAttribute)}
                        </td>
                        <td className="num">
                          {cost === null || cost === undefined ? '—' : formatSp(cost)}
                        </td>
                        <td className="num">
                          {minutes === null || minutes === undefined
                            ? '—'
                            : formatDuration(minutes)}
                        </td>
                        <td className="num muted">{formatDuration(elapsed[index] ?? 0)}</td>
                        <td className="row-actions">
                          <button
                            type="button"
                            className="btn-sm"
                            disabled={index === 0}
                            title="Move up"
                            onClick={() => move(index, index - 1)}
                            data-testid={`creator-up-${index}`}
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            className="btn-sm"
                            disabled={index === entries.length - 1}
                            title="Move down"
                            onClick={() => move(index, index + 1)}
                            data-testid={`creator-down-${index}`}
                          >
                            ↓
                          </button>
                          <button
                            type="button"
                            className="danger btn-sm"
                            title="Remove this level (and any above it)"
                            onClick={() =>
                              setEntries((prev) =>
                                entry.skillTypeId === null
                                  ? removeEntry(prev, key)
                                  : removeFromLevel(prev, entry.skillTypeId, entry.level),
                              )
                            }
                            data-testid={`creator-remove-${index}`}
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="plan-split__pane" data-testid="creator-browser-pane">
          <div className="bucket-head">
            <h3>Skills</h3>
            <span className="muted">{groups.length} groups</span>
          </div>

          <FitImporter
            fits={fits}
            disabled={busy}
            onOpenShips={() => setShipBrowserOpen(true)}
            onAddFit={(fitId) => void addSource(() => mco.plans.draftFromFit(fitId))}
            onAddEft={(eftText) => void addSource(() => mco.plans.draftFromEft(eftText))}
          />

          <input
            type="search"
            placeholder="Filter skills…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            data-testid="skill-filter"
          />

          <div className="table-scroll skill-browser" data-testid="skill-browser">
            {visibleGroups.length === 0 ? (
              <p className="muted skill-browser__empty">
                {groups.length === 0
                  ? 'No skill data — import static data from the Roster page.'
                  : 'No skill matches that filter.'}
              </p>
            ) : (
              visibleGroups.map((group) => (
                <details
                  key={group.groupId}
                  open={filtering || openGroups.has(group.groupId)}
                  onToggle={(e) => {
                    if (filtering) return;
                    const open = (e.target as HTMLDetailsElement).open;
                    setOpenGroups((prev) => {
                      const next = new Set(prev);
                      if (open) next.add(group.groupId);
                      else next.delete(group.groupId);
                      return next;
                    });
                  }}
                  data-testid={`skill-group-${group.groupId}`}
                >
                  <summary>
                    <span className="skill-browser__group">{group.name}</span>
                    <span className="muted">
                      {attributeAbbr(group.primaryAttribute)}/
                      {attributeAbbr(group.secondaryAttribute)} · {group.skills.length}
                    </span>
                  </summary>
                  <ul className="skill-browser__list">
                    {group.skills.map((skill) => (
                      <BrowserSkill
                        key={skill.skillTypeId}
                        skill={skill}
                        group={group}
                        level={planLevel(entries, skill.skillTypeId)}
                        disabled={busy}
                        revealed={revealed?.skillTypeId === skill.skillTypeId}
                        onRaise={() =>
                          setEntries((prev) => raiseSkill(prev, skill.skillTypeId, skills))
                        }
                        onLower={() => setEntries((prev) => lowerSkill(prev, skill.skillTypeId))}
                      />
                    ))}
                  </ul>
                </details>
              ))
            )}
          </div>
        </div>
      </div>

      {shipBrowserOpen && (
        <ShipBrowser
          ships={ships}
          onSelect={addShip}
          onClose={() => setShipBrowserOpen(false)}
        />
      )}
    </section>
  );
}
