/**
 * At-a-glance labeled pill: a small titled box holding a traffic-light chip.
 * Used top-right on the character sheet (Fatigue / Jump Clone / Training) and
 * in the Settings sync-status header.
 */
export default function StatusSquare({
  title,
  tone,
  label,
  testId,
}: {
  title: string;
  tone: 'ok' | 'danger' | 'idle';
  label: string;
  testId: string;
}) {
  return (
    <div className="status-square">
      <span className="status-square__title">{title}</span>
      <span className={`chip chip--${tone}`} data-testid={testId}>
        {label}
      </span>
    </div>
  );
}
