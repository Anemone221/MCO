import * as am5 from '@amcharts/amcharts5';
import * as am5hierarchy from '@amcharts/amcharts5/hierarchy';
import type { DashboardCharacterEntry } from '@shared/types';
import { formatSp } from '../../lib/format';
import { isDemoMode } from '../../lib/demo';
import { useAmChart } from './useAmChart';

interface SpDatum {
  id: number;
  name: string;
  value: number;
  spLabel: string;
  /** null in demo mode → circle keeps a plain color fill, no real portrait. */
  portraitUrl: string | null;
}

/**
 * Single-level packed circles (amCharts Pack — the d3 circle-packing layout),
 * one circle per character sized by total SP so the biggest circle is the
 * character with the most SP. Pack is deterministic and always fits inside the
 * container (unlike the ForceDirected physics graph, which sized nodes
 * inconsistently and pushed them off-screen). Circles are filled with the
 * character portrait (clipped to the circle); clicking one opens that
 * character's sheet. Portrait-only: name + SP show on hover.
 *
 * Demo-safe: in demo mode portraitUrl is null and circles keep a plain color
 * fill, so real portraits never leak (mirrors CharacterAvatar).
 */
export default function CharacterSpChart({
  characters,
  onSelect,
}: {
  characters: DashboardCharacterEntry[];
  onSelect: (characterId: number) => void;
}) {
  const demo = isDemoMode();
  const data: SpDatum[] = characters.map((c) => ({
    id: c.characterId,
    name: c.characterName,
    value: Math.max(c.totalSp, 1), // a zero-SP node would collapse to nothing
    spLabel: formatSp(c.totalSp),
    portraitUrl: demo
      ? null
      : `https://images.evetech.net/characters/${c.characterId}/portrait?size=128`,
  }));

  const dataKey = `${demo ? 'demo' : 'real'}:${characters
    .map((c) => `${c.characterId}:${c.totalSp}`)
    .join('|')}`;

  const containerRef = useAmChart((root, palette) => {
    const series = root.container.children.push(
      am5hierarchy.Pack.new(root, {
        valueField: 'value',
        categoryField: 'name',
        childDataField: 'children',
        // Show only the packed children; the enclosing root circle stays hidden.
        topDepth: 1,
        initialDepth: 1,
        // Biggest first, so it packs toward the centre.
        sort: 'descending',
        nodePadding: 4,
      }),
    );

    // Portrait-only: hide the built-in category labels; identity is the image.
    series.labels.template.set('forceHidden', true);

    series.circles.template.setAll({
      strokeWidth: 2,
      stroke: am5.color(palette.border),
      fillOpacity: 1,
      tooltipText: "{category}: {value.formatNumber('#.#a')} SP",
      cursorOverStyle: 'pointer',
    });

    series.nodes.template.events.on('click', (ev) => {
      const ctx = ev.target.dataItem?.dataContext as Partial<SpDatum> | undefined;
      if (ctx?.id != null) onSelect(ctx.id);
    });

    // Portraits: `fillPattern` on the circle doesn't paint on hierarchy nodes,
    // so overlay an `am5.Picture` on each node (a Container) inside a
    // circle-masked holder so the square portrait reads as a round avatar. The
    // holder is sized reactively to the circle's radius (`circle.on('radius')`)
    // so it always matches the packed size regardless of when the layout
    // settles — the fix for the earlier "all the same size" bug.
    const placed = new Set<number>();
    const placePortraits = (): void => {
      // Hide the enclosing root circle so only the packed character circles show.
      series.dataItems[0]?.get('circle')?.set('forceHidden', true);
      // The character circles are the root's children, not entries in the flat
      // `series.dataItems` (which holds only the hidden root).
      const childItems = series.dataItems[0]?.get('children') ?? [];
      childItems.forEach((dataItem) => {
        const ctx = dataItem.dataContext as Partial<SpDatum> | undefined;
        const node = dataItem.get('node');
        const circle = dataItem.get('circle');
        if (!ctx?.portraitUrl || ctx.id == null || !node || !circle || placed.has(ctx.id)) return;
        placed.add(ctx.id);

        const maskCircle = am5.Circle.new(root, { radius: 1 });
        const picture = am5.Picture.new(root, { src: ctx.portraitUrl });
        const holder = am5.Container.new(root, {
          centerX: am5.percent(50),
          centerY: am5.percent(50),
          x: am5.percent(50),
          y: am5.percent(50),
          mask: maskCircle,
        });
        holder.children.push(picture);
        node.children.push(holder);

        const sizeTo = (radius: number): void => {
          if (radius <= 0) return;
          const diameter = radius * 2;
          holder.setAll({ width: diameter, height: diameter });
          picture.setAll({ width: diameter, height: diameter });
          // A Circle draws around its x/y, so centre the mask in the holder.
          maskCircle.setAll({ radius, x: radius, y: radius });
        };
        sizeTo(circle.get('radius', 0));
        circle.on('radius', (radius) => sizeTo(radius ?? 0));
      });
    };

    // One hidden root holding every character; the packing lays its children
    // out as a single level of circles that fill the container.
    series.data.setAll([{ name: 'All characters', children: data }]);
    series.appear(800, 100);
    series.events.on('datavalidated', placePortraits);
  }, dataKey);

  return <div ref={containerRef} className="sp-chart" data-testid="sp-chart-canvas" />;
}
