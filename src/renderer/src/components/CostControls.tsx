import type { CostSystem, CostView } from '../lib/costView';

const SYSTEMS: Array<{ id: CostSystem; label: string }> = [
  { id: 'sp', label: 'SP' },
  { id: 'lsi', label: 'Injectors' },
  { id: 'time', label: 'Time' },
];

const THRESHOLD_LABEL: Record<CostSystem, string> = {
  sp: '“Almost there” threshold (SP):',
  lsi: '“Almost there” threshold (injectors):',
  time: '“Almost there” threshold (days):',
};

const STEP: Record<CostSystem, number> = { sp: 50_000, lsi: 1, time: 0.5 };

function currentThreshold(view: CostView): number {
  if (view.system === 'sp') return view.thresholds.sp;
  if (view.system === 'lsi') return view.thresholds.lsi;
  return view.thresholds.timeDays;
}

function withThreshold(view: CostView, raw: string): CostView {
  let value = Math.max(0, Number(raw) || 0);
  if (view.system !== 'time') value = Math.floor(value);
  const key = view.system === 'sp' ? 'sp' : view.system === 'lsi' ? 'lsi' : 'timeDays';
  return { ...view, thresholds: { ...view.thresholds, [key]: value } };
}

/**
 * Cost-system selector (SP / Injectors / Time) plus the matching threshold
 * input. Each system keeps its own threshold so switching back restores it.
 */
export default function CostControls({
  view,
  onChange,
}: {
  view: CostView;
  onChange: (view: CostView) => void;
}) {
  return (
    <>
      <div className="tab-bar tab-bar--inline" role="tablist" aria-label="Cost system">
        {SYSTEMS.map((s) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={view.system === s.id}
            className={`tab${view.system === s.id ? ' tab--active' : ''}`}
            data-testid={`cost-system-${s.id}`}
            onClick={() => onChange({ ...view, system: s.id })}
          >
            {s.label}
          </button>
        ))}
      </div>
      <label className="threshold-control">
        {THRESHOLD_LABEL[view.system]}{' '}
        <input
          type="number"
          min={0}
          step={STEP[view.system]}
          value={currentThreshold(view)}
          onChange={(e) => onChange(withThreshold(view, e.target.value))}
          data-testid="threshold-input"
        />
      </label>
    </>
  );
}
