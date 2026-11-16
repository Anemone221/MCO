import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
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
  dropEntries,
  entryAttributes,
  entryKey,
  entrySpCosts,
  entryTimeCosts,
  expandLevels,
  filterGroups,
  groupSkills,
  ISSUE_LABEL,
  lowerSkill,
  magic14Requirements,
  MAX_LEVEL,
  mergeSkills,
  moveEntry,
  optimizeAllAttributes,
  optimizeAttributes,
  planLevel,
  raiseSkill,
  remapCount,
  removeEntry,
  removeFromLevel,
  setRemap,
  shiftEntries,
  sortByPrereqs,
  type SkillGroup,
  type SkillMap,
} from '../lib/planDraft';
import {
  attributeTotal,
  isBalanced,
  loadPlanAttributes,
  savePlanAttributes,
  withAttribute,
} from '../lib/planAttributes';
import {
  autoRemap,
  MAX_AUTO_REMAPS,
  type AutoRemapPoint,
  type AutoRemapResult,
} from '../lib/autoRemap';
import { useRowDrag } from '../lib/useRowDrag';
import ShipBrowser from '../components/ShipBrowser';
import SkillInfoMenu from '../components/SkillInfoMenu';

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
        What this character will have when they start training the plan — remap plus implants.
        Every attribute starts at {MIN_ATTRIBUTE} with 14 points to spread (27 max before
        implants); balanced spends them evenly. These hold until the first remap point (⇄ on a
        plan row). <strong>Optimize</strong> keeps each total you've set and rearranges it into
        the fastest arrangement for the rows it covers — these and every remap point.
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

/**
 * A remap point, drawn as its own thin row above the skill it precedes: the
 * attributes everything from here to the next remap trains at.
 */
function RemapRow({
  index,
  attributes,
  savedMinutes,
  dropLine,
  onChange,
  onOptimize,
  onRemove,
}: {
  index: number;
  attributes: NeuralAttributes;
  /** A dragged row would land just above this remap. */
  dropLine: boolean;
  /** How much faster the rows it governs train than without it; null if unknown. */
  savedMinutes: number | null;
  onChange: (attribute: TrainingAttribute, value: number) => void;
  onOptimize: () => void;
  onRemove: () => void;
}) {
  return (
    <tr
      className={dropLine ? 'plan-draft__remap plan-draft__row--drop-before' : 'plan-draft__remap'}
      data-drag-remap={index}
      data-testid={`creator-remap-${index}`}
    >
      <td colSpan={8} className="plan-draft__remap-cell">
        <div className="plan-draft__remap-body">
          <span className="plan-draft__remap-label" title="Remap before training the row below">
            ⇄ Remap
          </span>
          {TRAINING_ATTRIBUTES.map((attribute) => (
            <label key={attribute}>
              <span className="muted">{attributeAbbr(attribute)}</span>
              <input
                type="number"
                min={MIN_ATTRIBUTE}
                max={MAX_ATTRIBUTE}
                value={attributes[attribute]}
                onChange={(e) => onChange(attribute, Number(e.target.value))}
                data-testid={`remap-${index}-${attribute}`}
              />
            </label>
          ))}
          <span className="muted" title="Attribute points in this remap, implants included">
            {attributeTotal(attributes)} pts
          </span>
          {savedMinutes !== null && savedMinutes > 0 && (
            <span className="muted" title="Faster than carrying on at the attributes above">
              −{formatDuration(savedMinutes)}
            </span>
          )}
          <span className="plan-draft__remap-actions">
            <button
              type="button"
              className="btn-sm"
              title="Rearrange these points into the fastest remap for the rows it covers"
              onClick={onOptimize}
              data-testid={`remap-optimize-${index}`}
            >
              Optimize
            </button>
            <button
              type="button"
              className="danger btn-sm"
              title="Remove this remap point"
              onClick={onRemove}
              data-testid={`remap-remove-${index}`}
            >
              ✕
            </button>
          </span>
        </div>
      </td>
    </tr>
  );
}

/** One attribute of a remap: the value to set, flagged when it changes. */
function RemapAttribute({ point, attribute }: { point: AutoRemapPoint; attribute: TrainingAttribute }) {
  const to = point.attributes[attribute];
  const from = point.previous[attribute];
  const delta = to - from;
  return (
    <span
      className={
        delta > 0
          ? 'auto-remap__attr auto-remap__attr--up'
          : delta < 0
            ? 'auto-remap__attr auto-remap__attr--down'
            : 'auto-remap__attr muted'
      }
      title={delta === 0 ? 'Unchanged' : `${from} → ${to}`}
    >
      {attributeAbbr(attribute)} <strong>{to}</strong>
      {delta !== 0 && (
        <span className="auto-remap__delta">
          {' '}
          ({delta > 0 ? '+' : ''}
          {delta})
        </span>
      )}
    </span>
  );
}

/**
 * What auto remap did: the time it saved, how much of the queue it moved, and
 * for each remap point where it falls and the attributes to remap to there.
 */
function AutoRemapCard({
  result,
  onUndo,
  onDismiss,
}: {
  result: AutoRemapResult;
  onUndo: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="card auto-remap" data-testid="auto-remap-result">
      <div className="bucket-head">
        <h3>
          Auto remap · {formatDuration(result.beforeMinutes)} → {formatDuration(result.afterMinutes)}
        </h3>
        <div className="toolbar__actions">
          <button type="button" className="btn-sm" onClick={onUndo} data-testid="auto-remap-undo">
            Undo
          </button>
          <button type="button" className="ghost btn-sm" onClick={onDismiss}>
            Dismiss
          </button>
        </div>
      </div>
      <p className="muted">
        Saves {formatDuration(result.beforeMinutes - result.afterMinutes)}
        {result.moved > 0 ? ` · ${result.moved} rows reordered so each remap covers the skills it suits` : ''}
        {' · '}prerequisites still train first. Remap to these at each point:
      </p>
      <table className="data-table auto-remap__table">
        <thead>
          <tr>
            <th className="num">#</th>
            <th>Before</th>
            <th>Remap to</th>
            <th className="num" title="Faster than staying on the attributes before it">
              Saves
            </th>
          </tr>
        </thead>
        <tbody>
          {result.points.map((point, i) => (
            <tr key={point.index} data-testid={`auto-remap-point-${i}`}>
              <td className="num muted">{point.index + 1}</td>
              <td>
                {point.skillName} {romanLevel(point.level)}
              </td>
              <td className="auto-remap__attrs">
                {TRAINING_ATTRIBUTES.map((attribute) => (
                  <RemapAttribute key={attribute} point={point} attribute={attribute} />
                ))}
              </td>
              <td className="num">{formatDuration(point.savedMinutes)}</td>
            </tr>
          ))}
        </tbody>
      </table>
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
  onInfo,
}: {
  skill: PlanSkillInfo;
  group: SkillGroup;
  level: number;
  disabled: boolean;
  /** Just jumped to from the plan — highlighted until the eye has found it. */
  revealed: boolean;
  onRaise: () => void;
  onLower: () => void;
  /** Right-click: open the skill's info card at the pointer. */
  onInfo: (e: ReactMouseEvent) => void;
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
      onContextMenu={onInfo}
    >
      <span
        className="skill-browser__name"
        title={`Rank ${skill.rank} — right-click for info`}
      >
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

/**
 * "Magic 14" button: opens a small menu of levels I–V; picking one adds every
 * Magic 14 skill up to that level. Closes on outside click or Escape, like the
 * Roster's column picker.
 */
function Magic14Picker({
  disabled,
  onAdd,
}: {
  disabled: boolean;
  onAdd: (level: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="column-picker magic14-picker" ref={ref}>
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Add the Magic 14 core skills to a chosen level"
        onClick={() => setOpen((v) => !v)}
        data-testid="open-magic14"
      >
        Magic 14 ▾
      </button>
      {open && (
        <div className="column-picker__panel" role="menu">
          {Array.from({ length: MAX_LEVEL }, (_, i) => i + 1).map((level) => (
            <button
              key={level}
              type="button"
              role="menuitem"
              className="context-menu__item context-menu__item--button"
              onClick={() => {
                setOpen(false);
                onAdd(level);
              }}
              data-testid={`magic14-level-${level}`}
            >
              All to {romanLevel(level)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Pull a whole fit's skill requirements in — either a saved one or pasted EFT. */
function FitImporter({
  fits,
  disabled,
  onAddMagic14,
  onOpenShips,
  onAddFit,
  onAddEft,
}: {
  fits: Fit[];
  disabled: boolean;
  onAddMagic14: (level: number) => void;
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
        <Magic14Picker disabled={disabled} onAdd={onAddMagic14} />
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
  /** The skill whose info card is open (right-click), and where. */
  const [info, setInfo] = useState<{ skillTypeId: number; x: number; y: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  /** The queue's scroll box — what a drag hit-tests against and auto-scrolls. */
  const queueRef = useRef<HTMLDivElement>(null);
  const [autoRemapCount, setAutoRemapCount] = useState(1);
  /**
   * Rows picked for a group move (Ctrl/⌘-click, Shift-click for a range), by
   * entry key so the pick survives reordering. `anchor` is where a Shift range
   * starts.
   */
  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  /**
   * The last auto remap, with the queue it replaced (for Undo). Shown only
   * while the queue is still exactly what it produced — any edit retires it.
   */
  const [autoResult, setAutoResult] = useState<{
    result: AutoRemapResult;
    previous: PlanDraftEntry[];
  } | null>(null);

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

  const remaps = useMemo(() => remapCount(entries), [entries]);
  const inForce = useMemo(() => entryAttributes(entries, attributes), [entries, attributes]);

  /**
   * Per remap row, how much faster the rows it governs train than they would
   * carrying on at the attributes above it — what the remap is worth.
   */
  const remapSavings = useMemo(() => {
    const saved = new Map<number, number | null>();
    entries.forEach((entry, index) => {
      if (!entry.remapBefore) return;
      const without = entryTimeCosts(setRemap(entries, entryKey(entry), null), skills, attributes);
      let end = index + 1;
      while (end < entries.length && !entries[end]!.remapBefore) end += 1;
      let delta = 0;
      for (let row = index; row < end; row += 1) {
        const before = without[row];
        const after = times[row];
        if (before === null || before === undefined || after === null || after === undefined) {
          continue;
        }
        delta += before - after;
      }
      saved.set(index, delta);
    });
    return saved;
  }, [entries, skills, attributes, times]);

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

  /** Tell the user what an optimisation bought them. */
  function reportOptimized(after: number, what: string): void {
    setNotice(
      after < totals.minutes
        ? `${what} optimised — ${formatDuration(totals.minutes)} → ${formatDuration(after)}.`
        : 'Already the fastest arrangement for this plan.',
    );
  }

  /**
   * Rearrange the starting attributes, and every remap point, into the fastest
   * legal arrangement for the rows each one covers.
   */
  function optimize(): void {
    const next = optimizeAllAttributes(entries, skills, attributes);
    setAttributes(next.base);
    savePlanAttributes(next.base);
    setEntries(next.entries);
    reportOptimized(
      draftTotals(next.entries, skills, next.base).minutes,
      remaps > 0 ? 'Attributes and remaps' : 'Attributes',
    );
  }

  /**
   * Put a remap point before a row. It starts from whatever is in force there
   * and is optimised straight away for the rows it will cover — the reason to
   * remap at all — keeping that total.
   */
  function addRemap(index: number): void {
    const entry = entries[index];
    if (!entry || entry.remapBefore) return;
    const placed = setRemap(entries, entryKey(entry), inForce[index] ?? attributes);
    const best = optimizeAttributes(placed, skills, placed[index]!.remapBefore!, index);
    const next = setRemap(placed, entryKey(entry), best);
    setEntries(next);
    const after = draftTotals(next, skills, attributes).minutes;
    setNotice(
      after < totals.minutes
        ? `Remap added before ${entry.skillName} ${romanLevel(entry.level)} — ${formatDuration(totals.minutes)} → ${formatDuration(after)}.`
        : 'Remap added — the attributes above it are already the fastest for what follows.',
    );
  }

  function changeRemap(key: string, current: NeuralAttributes, attribute: TrainingAttribute, value: number): void {
    setEntries((prev) => setRemap(prev, key, withAttribute(current, attribute, value)));
  }

  function optimizeRemap(index: number): void {
    const entry = entries[index];
    if (!entry?.remapBefore) return;
    const best = optimizeAttributes(entries, skills, entry.remapBefore, index);
    const next = setRemap(entries, entryKey(entry), best);
    setEntries(next);
    reportOptimized(draftTotals(next, skills, attributes).minutes, 'Remap');
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

  /** Every Magic 14 skill up to `level`, prerequisites first. */
  function addMagic14(level: number): void {
    const { requirements, missing } = magic14Requirements(skills, level);
    const grown = addRequirements(entries, requirements, skills);
    const added = grown.length - entries.length;
    setEntries(grown);
    if (name.trim() === '') setName(`Magic 14 ${romanLevel(level)}`);
    const tail = missing.length > 0 ? ` No skill data for: ${missing.join(', ')}.` : '';
    setNotice(
      (added === 0
        ? `The Magic 14 to ${romanLevel(level)} is already in the plan.`
        : `Added ${added} level${added === 1 ? '' : 's'} for the Magic 14 to ${romanLevel(level)}.`) +
        tail,
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

  /** Queue indices of the selected rows, top to bottom; rows since removed drop out. */
  const selectedIndices = useMemo(() => {
    const out: number[] = [];
    entries.forEach((entry, i) => {
      if (selection.has(entryKey(entry))) out.push(i);
    });
    return out;
  }, [entries, selection]);
  const groupSelected = selectedIndices.length > 1;

  /** The rows a move on `index` acts on: the whole selection if it's part of one. */
  const moveSet = useCallback(
    (index: number): number[] =>
      selectedIndices.length > 1 && selectedIndices.includes(index) ? selectedIndices : [index],
    [selectedIndices],
  );

  /**
   * A click on a queue row. Ctrl/⌘ toggles it in the selection, Shift selects
   * the range from the last clicked row; a plain click clears the selection
   * and reveals the skill, as before.
   */
  function clickRow(e: ReactMouseEvent, index: number): void {
    const entry = entries[index];
    if (!entry) return;
    const key = entryKey(entry);
    if (e.shiftKey) {
      const from = entries.findIndex((row) => entryKey(row) === anchor);
      const start = from === -1 ? index : from;
      const [lo, hi] = start <= index ? [start, index] : [index, start];
      const range = entries.slice(lo, hi + 1).map(entryKey);
      setSelection((prev) => new Set(e.ctrlKey || e.metaKey ? [...prev, ...range] : range));
      if (from === -1) setAnchor(key);
      return;
    }
    setAnchor(key);
    if (e.ctrlKey || e.metaKey) {
      setSelection((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
      return;
    }
    setSelection(new Set());
    reveal(entry.skillTypeId);
  }

  function shiftSelection(direction: -1 | 1): void {
    setEntries((prev) => shiftEntries(prev, selectedIndices, direction));
  }

  function dropSelection(index: number): void {
    setEntries((prev) => dropEntries(prev, selectedIndices, { index, underRemap: false }));
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

  /** Right-click on a skill (queue row or browser): its info card at the pointer. */
  function openInfo(e: ReactMouseEvent, skillTypeId: number | null): void {
    if (skillTypeId === null) return;
    e.preventDefault();
    setInfo({ skillTypeId, x: e.clientX, y: e.clientY });
  }
  const closeInfo = useCallback(() => setInfo(null), []);

  // Dragging a row that is part of a multi-row selection carries the whole
  // selection; any other row moves on its own.
  const drag = useRowDrag(queueRef, entries.length, (from, target) =>
    setEntries((prev) => dropEntries(prev, moveSet(from), target)),
  );
  const dragging = useMemo(
    () => (drag.active ? new Set(moveSet(drag.active.from)) : null),
    [drag.active, moveSet],
  );

  /**
   * Where the drop line goes: the drag's target, unless dropping there would
   * change nothing (back onto its own place), in which case no line at all.
   */
  const dropAt = useMemo(() => {
    if (!drag.active?.target) return null;
    const { target } = drag.active;
    // dropEntries keeps every row object it doesn't change, so identity says it all.
    const after = dropEntries(entries, [...(dragging ?? [])], target);
    return after.every((entry, i) => entry === entries[i]) ? null : target;
  }, [drag.active, dragging, entries]);

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
      // EVE's import has no remap line, so the clipboard gets the skills alone.
      await mco.system.copyText(draftText(entries, { includeRemaps: false }));
      setNotice(
        remaps > 0
          ? "Copied — paste it into EVE's skill plan import. Remap points stay in MCO; EVE's import can't carry them."
          : "Copied — paste it into EVE's skill plan import.",
      );
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  /**
   * Work out where remap points pay off, reorder the queue so the skills each
   * one suits train under it, and place them. Applied only when it actually
   * beats the plan as it stands; the card it leaves lists what to remap to.
   */
  function runAutoRemap(): void {
    const result = autoRemap(entries, skills, attributes, autoRemapCount);
    if (!result) {
      setNotice('Nothing to remap for — no skill in the plan has training data.');
      return;
    }
    if (result.afterMinutes >= result.beforeMinutes - 1) {
      setAutoResult(null);
      setNotice(
        remaps > 0
          ? 'Auto remap found nothing faster than the remap points already in the plan.'
          : 'No remap would make this plan faster — your starting attributes already suit it.',
      );
      return;
    }
    setAutoResult({ result, previous: entries });
    setEntries(result.entries);
    setNotice(null);
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
            title="Attributes training time is estimated at, until the first remap point"
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

      {autoResult && autoResult.result.entries === entries && (
        <AutoRemapCard
          result={autoResult.result}
          onUndo={() => {
            setEntries(autoResult.previous);
            setAutoResult(null);
          }}
          onDismiss={() => setAutoResult(null)}
        />
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
              <select
                className="btn-sm"
                value={autoRemapCount}
                title="How many remap points auto remap may place"
                onChange={(e) => setAutoRemapCount(Number(e.target.value))}
                data-testid="auto-remap-count"
              >
                {Array.from({ length: MAX_AUTO_REMAPS }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    {n} remap{n === 1 ? '' : 's'}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="ghost btn-sm"
                disabled={entries.length === 0}
                title="Find where remapping pays off, move the skills that suit each remap under it, and place the remap points"
                onClick={runAutoRemap}
                data-testid="auto-remap"
              >
                Auto remap
              </button>
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
            {remaps > 0 && (
              <span className="stat-chip" data-testid="creator-remap-count">
                <strong>{remaps}</strong> remap{remaps === 1 ? '' : 's'}
              </span>
            )}
            {orderIssueCount > 0 && (
              <span className="stat-chip stat-chip--warn" data-testid="creator-order-warning">
                <strong>{orderIssueCount}</strong> out of order
              </span>
            )}
          </div>

          {selectedIndices.length > 0 && (
            <div className="plan-select-bar" data-testid="creator-selection-bar">
              <span>
                <strong>{selectedIndices.length}</strong> selected
              </span>
              <button
                type="button"
                className="btn-sm"
                title="Move the selected rows to the top of the plan"
                onClick={() => dropSelection(0)}
                data-testid="selection-top"
              >
                ⤒ Top
              </button>
              <button
                type="button"
                className="btn-sm"
                title="Move the selected rows up one"
                onClick={() => shiftSelection(-1)}
                data-testid="selection-up"
              >
                ↑
              </button>
              <button
                type="button"
                className="btn-sm"
                title="Move the selected rows down one"
                onClick={() => shiftSelection(1)}
                data-testid="selection-down"
              >
                ↓
              </button>
              <button
                type="button"
                className="btn-sm"
                title="Move the selected rows to the bottom of the plan"
                onClick={() => dropSelection(entries.length)}
                data-testid="selection-bottom"
              >
                ⤓ Bottom
              </button>
              <button
                type="button"
                className="ghost btn-sm"
                onClick={() => setSelection(new Set())}
                data-testid="selection-clear"
              >
                Clear
              </button>
              <span className="muted">
                Drag a selected row to move them all · Ctrl-click to add/remove · Shift-click for
                a range
              </span>
            </div>
          )}

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
            <div className="table-scroll" ref={queueRef}>
              <table
                className={drag.active ? 'data-table plan-draft plan-draft--dragging' : 'data-table plan-draft'}
                data-testid="creator-table"
              >
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
                    const remap = entry.remapBefore;
                    // The row's ↑ / ↓ move the whole selection when it's part of one.
                    const inGroup = groupSelected && selection.has(key);
                    return (
                      <Fragment key={key}>
                        {remap && (
                          <RemapRow
                            index={index}
                            attributes={remap}
                            savedMinutes={remapSavings.get(index) ?? null}
                            dropLine={dropAt?.index === index && !dropAt.underRemap}
                            onChange={(attribute, value) => changeRemap(key, remap, attribute, value)}
                            onOptimize={() => optimizeRemap(index)}
                            onRemove={() => setEntries((prev) => setRemap(prev, key, null))}
                          />
                        )}
                        <tr
                          // The whole row drags; a press only becomes a drag
                          // once it has moved a few pixels, so a click on the
                          // row still reveals its skill (see useRowDrag).
                          onPointerDown={(e) => drag.onRowPointerDown(index, e)}
                          onClick={(e) => {
                            if (drag.consumeClick()) return;
                            // The row's own controls are not a reveal.
                            if ((e.target as HTMLElement).closest('button, select')) return;
                            clickRow(e, index);
                          }}
                          onContextMenu={(e) => openInfo(e, entry.skillTypeId)}
                          data-drag-row={index}
                          data-has-remap={remap ? '' : undefined}
                          className={[
                            dragging?.has(index) ? 'plan-draft__row--dragging' : '',
                            selection.has(key) ? 'plan-draft__row--selected' : '',
                            dropAt &&
                            dropAt.index === index &&
                            (dropAt.underRemap || !remap)
                              ? 'plan-draft__row--drop-before'
                              : '',
                            dropAt?.index === entries.length && index === entries.length - 1
                              ? 'plan-draft__row--drop-after'
                              : '',
                          ]
                            .join(' ')
                            .trim()}
                          aria-selected={selection.has(key)}
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
                                : `${entry.skillName} — click to find it in the skill list, right-click for info`
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
                              title="Drag the row to reorder"
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
                              className="ghost btn-sm"
                              disabled={remap !== undefined}
                              title={
                                remap
                                  ? 'This row already has a remap point'
                                  : 'Remap before training this — optimised for the rows it covers'
                              }
                              onClick={() => addRemap(index)}
                              data-testid={`creator-add-remap-${index}`}
                            >
                              ⇄
                            </button>
                            <button
                              type="button"
                              className="btn-sm"
                              disabled={moveSet(index)[0] === 0}
                              title={inGroup ? 'Move the selected rows up' : 'Move up'}
                              onClick={() => (inGroup ? shiftSelection(-1) : move(index, index - 1))}
                              data-testid={`creator-up-${index}`}
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              className="btn-sm"
                              disabled={moveSet(index).at(-1) === entries.length - 1}
                              title={inGroup ? 'Move the selected rows down' : 'Move down'}
                              onClick={() => (inGroup ? shiftSelection(1) : move(index, index + 1))}
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
                      </Fragment>
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
            onAddMagic14={addMagic14}
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
                        onInfo={(e) => openInfo(e, skill.skillTypeId)}
                      />
                    ))}
                  </ul>
                </details>
              ))
            )}
          </div>
        </div>
      </div>

      {info && (
        <SkillInfoMenu
          key={`${info.skillTypeId}-${info.x}-${info.y}`}
          x={info.x}
          y={info.y}
          skillTypeId={info.skillTypeId}
          skills={skills}
          catalog={data?.catalog ?? []}
          attributes={attributes}
          planLevel={(id) => planLevel(entries, id)}
          onFind={reveal}
          onClose={closeInfo}
        />
      )}

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
