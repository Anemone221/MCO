import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { Link } from 'react-router-dom';
import type {
  GroupDetail as GroupDetailData,
  PodIgnoredEntry,
  PodViolation,
} from '@shared/types';
import { loadPodSectionCollapsed, savePodSectionCollapsed } from '../lib/groupView';
import PodSystemPicker from './PodSystemPicker';

/** "Active pod" or "Jump clone · name" — shared by both pod tables. */
function PodLabel({ pod }: { pod: { kind: 'active' | 'jump-clone'; cloneName: string | null } }) {
  if (pod.kind === 'active') return <>Active pod</>;
  return (
    <>Jump clone{pod.cloneName && <span className="muted"> · {pod.cloneName}</span>}</>
  );
}

/** One flagged pod: who, which clone, and where it verifiably (or not) sits. */
function PodViolationRow({
  violation,
  onContextMenu,
}: {
  violation: PodViolation;
  onContextMenu: (e: ReactMouseEvent) => void;
}) {
  return (
    <tr
      data-testid={`pod-violation-${violation.characterId}-${violation.kind}`}
      onContextMenu={onContextMenu}
    >
      <td>
        <Link to={`/character/${violation.characterId}`}>{violation.characterName}</Link>
      </td>
      <td>
        <PodLabel pod={violation} />
      </td>
      <td className="num">{violation.implantCount}</td>
      <td>
        {violation.systemId !== null ? (
          <span className="med-clone-away">
            {violation.systemName ?? `System ${violation.systemId}`}
          </span>
        ) : (
          // Unresolved structure: can't verify the system — shown, not alarmed.
          <span className="muted">unresolved</span>
        )}
      </td>
      <td>
        {violation.kind === 'active' ? (
          <span className="muted">—</span>
        ) : (
          (violation.locationName ??
            (violation.locationId !== null ? `Location ${violation.locationId}` : '—'))
        )}
      </td>
    </tr>
  );
}

const POD_MENU_WIDTH = 220;
/** Minimum gap kept between the menu and every viewport edge. */
const POD_MENU_MARGIN = 8;

/**
 * Right-click menu for a flagged pod. One action for now (Ignore); closes on
 * Escape, outside click, or resize — same behavior as the Roster row menu.
 */
function PodIgnoreMenu({
  x,
  y,
  violation,
  onIgnore,
  onClose,
}: {
  x: number;
  y: number;
  violation: PodViolation;
  onIgnore: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [menuHeight, setMenuHeight] = useState(0);

  // Measure the rendered menu so the vertical clamp uses its real height
  // (runs before paint, so the unclamped position is never visible).
  useLayoutEffect(() => {
    setMenuHeight(ref.current?.offsetHeight ?? 0);
  }, []);

  useEffect(() => {
    function onPointerDown(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose();
    }
    // Capture-phase so a click on another row closes this menu first.
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
    POD_MENU_MARGIN,
    Math.min(x, window.innerWidth - POD_MENU_WIDTH - POD_MENU_MARGIN),
  );
  const top = Math.max(
    POD_MENU_MARGIN,
    Math.min(y, window.innerHeight - menuHeight - POD_MENU_MARGIN),
  );

  return (
    <div
      ref={ref}
      className="context-menu"
      style={{ left, top, width: POD_MENU_WIDTH }}
      role="menu"
      data-testid="pod-ignore-menu"
    >
      <div className="context-menu__title">
        {violation.characterName} — {violation.kind === 'active' ? 'Active pod' : (violation.cloneName ?? 'Jump clone')}
      </div>
      <button
        type="button"
        className="context-menu__item context-menu__item--button"
        role="menuitem"
        onClick={onIgnore}
        data-testid="pod-ignore-action"
      >
        Ignore this pod
      </button>
    </div>
  );
}

/** One ignored pod, with its exemption liftable via the Un-ignore button. */
function PodIgnoredRow({
  entry,
  busy,
  onUnignore,
}: {
  entry: PodIgnoredEntry;
  busy: boolean;
  onUnignore: () => void;
}) {
  return (
    <tr data-testid={`pod-ignored-${entry.characterId}-${entry.jumpCloneId ?? 'active'}`}>
      <td>
        <Link to={`/character/${entry.characterId}`}>{entry.characterName}</Link>
      </td>
      <td>
        <PodLabel pod={entry} />
        {!entry.exists && <span className="muted"> (no longer exists)</span>}
      </td>
      <td className="num">{entry.implantCount ?? <span className="muted">—</span>}</td>
      <td>
        {entry.systemId !== null ? (
          // Neutral, not red: this pod is exempt from the check.
          (entry.systemName ?? `System ${entry.systemId}`)
        ) : (
          <span className="muted">{entry.exists ? 'unresolved' : '—'}</span>
        )}
      </td>
      <td>
        {entry.kind === 'active' || entry.locationId === null ? (
          <span className="muted">—</span>
        ) : (
          (entry.locationName ?? `Location ${entry.locationId}`)
        )}
      </td>
      <td className="pod-ignored__actions">
        <button
          type="button"
          className="ghost btn-sm"
          disabled={busy}
          onClick={onUnignore}
          data-testid={`pod-unignore-${entry.characterId}-${entry.jumpCloneId ?? 'active'}`}
        >
          Un-ignore
        </button>
      </td>
    </tr>
  );
}

/**
 * Pod whitelist: the systems members' implanted pods are allowed to sit in.
 * Collapsible; two tabs split the pods into ones to move ("To move") and ones
 * the user right-clicked → Ignore ("Ignored", where the exemption is lifted).
 */
export default function PodWhitelistSection({
  detail,
  busy,
  onAdd,
  onRemove,
  onIgnore,
  onUnignore,
}: {
  detail: GroupDetailData;
  busy: boolean;
  onAdd: (system: { id: number; name: string }) => void;
  onRemove: (solarSystemId: number) => void;
  onIgnore: (violation: PodViolation) => void;
  onUnignore: (entry: PodIgnoredEntry) => void;
}) {
  const groupId = detail.group.id;
  const systems = detail.group.podSystems;
  const violations = detail.podViolations;
  const ignored = detail.podIgnored;
  const allowedIds = useMemo(() => new Set(systems.map((s) => s.solarSystemId)), [systems]);

  const [collapsed, setCollapsed] = useState(() => loadPodSectionCollapsed(groupId));
  const [tab, setTab] = useState<'flagged' | 'ignored'>('flagged');
  const [menu, setMenu] = useState<{ x: number; y: number; violation: PodViolation } | null>(null);

  // The section stays mounted when navigating between groups — re-sync.
  useEffect(() => {
    setCollapsed(loadPodSectionCollapsed(groupId));
    setTab('flagged');
    setMenu(null);
  }, [groupId]);

  function toggleCollapsed(): void {
    setCollapsed((prev) => {
      const next = !prev;
      savePodSectionCollapsed(groupId, next);
      return next;
    });
  }

  return (
    <div className="card" data-testid="pod-whitelist">
      <div className="pod-whitelist__header">
        <button
          type="button"
          className="collapse-toggle"
          aria-expanded={!collapsed}
          title={collapsed ? 'Expand' : 'Collapse'}
          onClick={toggleCollapsed}
          data-testid="pod-whitelist-toggle"
        >
          {collapsed ? '▸' : '▾'}
        </button>
        <h3>Pod locations</h3>
        {violations.length > 0 && (
          <span className="chip chip--danger" data-testid="pod-violation-count">
            {violations.length} to move
          </span>
        )}
      </div>

      {!collapsed && (
        <div data-testid="pod-whitelist-body">
          <p className="muted">
            Systems where members&apos; pods with implants are allowed to be. Active pods and
            jump clones carrying implants anywhere else are listed below — right-click a
            flagged pod to ignore it.
          </p>
          <div className="pod-whitelist__row">
            <div className="tag-chips pod-whitelist__systems">
              {systems.map((s) => (
                <span
                  key={s.solarSystemId}
                  className="chip"
                  data-testid={`pod-system-${s.solarSystemId}`}
                >
                  {s.systemName}
                  <button
                    type="button"
                    className="chip__remove"
                    title={`Remove ${s.systemName}`}
                    disabled={busy}
                    onClick={() => onRemove(s.solarSystemId)}
                    data-testid={`pod-system-remove-${s.solarSystemId}`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <PodSystemPicker excludeIds={allowedIds} disabled={busy} onSelect={onAdd} />
          </div>

          <div className="tab-bar" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'flagged'}
              className={`tab${tab === 'flagged' ? ' tab--active' : ''}`}
              onClick={() => setTab('flagged')}
              data-testid="pod-tab-flagged"
            >
              To move ({violations.length})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'ignored'}
              className={`tab${tab === 'ignored' ? ' tab--active' : ''}`}
              onClick={() => setTab('ignored')}
              data-testid="pod-tab-ignored"
            >
              Ignored ({ignored.length})
            </button>
          </div>

          {tab === 'flagged' &&
            (systems.length === 0 ? (
              <p className="muted" data-testid="pod-whitelist-empty">
                No systems whitelisted — add one (e.g. Jita, Amarr) to start checking.
              </p>
            ) : violations.length === 0 ? (
              <p className="pod-whitelist__ok" data-testid="pod-whitelist-ok">
                All pods with implants are in allowed systems.
              </p>
            ) : (
              <table className="data-table" data-testid="pod-violations">
                <thead>
                  <tr>
                    <th>Character</th>
                    <th>Pod</th>
                    <th>Implants</th>
                    <th>System</th>
                    <th>Station / structure</th>
                  </tr>
                </thead>
                <tbody>
                  {violations.map((v) => (
                    <PodViolationRow
                      key={`${v.characterId}:${v.jumpCloneId ?? 'active'}`}
                      violation={v}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setMenu({ x: e.clientX, y: e.clientY, violation: v });
                      }}
                    />
                  ))}
                </tbody>
              </table>
            ))}

          {tab === 'ignored' &&
            (ignored.length === 0 ? (
              <p className="muted" data-testid="pod-ignored-empty">
                No ignored pods — right-click a pod on the “To move” tab to ignore it.
              </p>
            ) : (
              <table className="data-table" data-testid="pod-ignored">
                <thead>
                  <tr>
                    <th>Character</th>
                    <th>Pod</th>
                    <th>Implants</th>
                    <th>System</th>
                    <th>Station / structure</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {ignored.map((entry) => (
                    <PodIgnoredRow
                      key={`${entry.characterId}:${entry.jumpCloneId ?? 'active'}`}
                      entry={entry}
                      busy={busy}
                      onUnignore={() => onUnignore(entry)}
                    />
                  ))}
                </tbody>
              </table>
            ))}
        </div>
      )}

      {menu && (
        <PodIgnoreMenu
          x={menu.x}
          y={menu.y}
          violation={menu.violation}
          onIgnore={() => {
            setMenu(null);
            onIgnore(menu.violation);
          }}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}
