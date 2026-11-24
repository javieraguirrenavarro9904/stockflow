import { useId, useRef, useState, type DragEvent, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import {
  createWarehouseStructure, MAP_GRID_SIZE, MAP_RENDER_SCALE,
  type WarehousePoint, type WarehouseStructure
} from './warehousePlan';

type MapRack = {
  id: string;
  name: string;
  code: string;
  map_x: string | number;
  map_y: string | number;
  map_width: string | number;
  map_height: string | number;
  bin_count: number;
};

type MapLocation = { rack_id: string; quantity: string | number; in_use: boolean };

type Props = {
  width: number;
  height: number;
  zoom: number;
  racks: MapRack[];
  locations: MapLocation[];
  selectedRackId: string | null;
  editing: boolean;
  perimeter: WarehousePoint[];
  perimeterDraft: WarehousePoint[];
  drawingPerimeter: boolean;
  editingPerimeter: boolean;
  structures: WarehouseStructure[];
  drawingStructureType: WarehouseStructure['type'] | null;
  selectedStructureId: string | null;
  canvasRef: RefObject<HTMLDivElement>;
  onSelectRack: (rackId: string) => void;
  onMoveRack: (rackId: string, x: number, y: number) => void;
  onResizeRack: (rackId: string, width: number, height: number) => void;
  onDropRack: (x: number, y: number) => void;
  onAddPerimeterPoint: (point: WarehousePoint) => void;
  onMovePerimeterPoint: (index: number, point: WarehousePoint) => void;
  onFinishPerimeter: () => void;
  onAddStructure: (structure: WarehouseStructure) => void;
  onSelectStructure: (structureId: string) => void;
};

const value = (input: string | number) => Number(input) || 0;
const handleHitDistance = 140;
const createStructureId = () => typeof crypto.randomUUID === 'function'
  ? crypto.randomUUID()
  : `structure-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export default function WarehouseMap2D({
  width, height, zoom, racks, locations, selectedRackId, editing,
  perimeter, perimeterDraft, drawingPerimeter, editingPerimeter, structures, drawingStructureType, selectedStructureId, canvasRef,
  onSelectRack, onMoveRack, onResizeRack, onDropRack, onAddPerimeterPoint, onMovePerimeterPoint, onFinishPerimeter,
  onAddStructure, onSelectStructure
}: Props) {
  const drag = useRef<
    | { type: 'moveRack'; id: string; offsetX: number; offsetY: number; moved: boolean }
    | { type: 'resizeRack'; id: string; startX: number; startY: number; initialWidth: number; initialHeight: number }
    | null
  >(null);
  const draggedPerimeterVertex = useRef<number | null>(null);
  const structureDrag = useRef<{ type: WarehouseStructure['type']; start: WarehousePoint } | null>(null);
  const [structurePreview, setStructurePreview] = useState<WarehouseStructure | null>(null);
  const [pointerPosition, setPointerPosition] = useState<WarehousePoint | null>(null);
  const gridId = useId().replace(/:/g, '');

  const pointFromEvent = (event: ReactPointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * width / rect.width,
      y: (event.clientY - rect.top) * height / rect.height
    };
  };

  const snapToGrid = (point: WarehousePoint): WarehousePoint => ({
    x: Math.max(0, Math.min(width, Math.round(point.x / MAP_GRID_SIZE) * MAP_GRID_SIZE)),
    y: Math.max(0, Math.min(height, Math.round(point.y / MAP_GRID_SIZE) * MAP_GRID_SIZE))
  });

  const findRack = (x: number, y: number) => [...racks].reverse().find((rack) =>
    x >= value(rack.map_x) && y >= value(rack.map_y) &&
    x <= value(rack.map_x) + value(rack.map_width) &&
    y <= value(rack.map_y) + value(rack.map_height)
  );

  const pointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    const { x, y } = pointFromEvent(event);
    if (drawingStructureType) {
      event.preventDefault();
      structureDrag.current = { type: drawingStructureType, start: snapToGrid({ x, y }) };
      setStructurePreview(null);
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (drawingPerimeter) {
      event.preventDefault();
      if (editingPerimeter) {
        const vertexIndex = perimeterDraft.findIndex((point) =>
          Math.hypot(x - point.x, y - point.y) <= handleHitDistance
        );
        if (vertexIndex >= 0) {
          draggedPerimeterVertex.current = vertexIndex;
          event.currentTarget.setPointerCapture(event.pointerId);
          return;
        }
      }
      const firstPoint = perimeterDraft[0];
      if (!editingPerimeter && perimeterDraft.length >= 3 && firstPoint &&
        Math.hypot(x - firstPoint.x, y - firstPoint.y) <= handleHitDistance) {
        onFinishPerimeter();
      } else {
        onAddPerimeterPoint(snapToGrid({ x, y }));
      }
      return;
    }

    if (editing) {
      const resizeRack = [...racks].reverse().find((rack) =>
        Math.abs(x - (value(rack.map_x) + value(rack.map_width))) <= handleHitDistance &&
        Math.abs(y - (value(rack.map_y) + value(rack.map_height))) <= handleHitDistance
      );
      if (resizeRack) {
        drag.current = {
          type: 'resizeRack',
          id: resizeRack.id,
          startX: x,
          startY: y,
          initialWidth: value(resizeRack.map_width),
          initialHeight: value(resizeRack.map_height)
        };
        event.currentTarget.setPointerCapture(event.pointerId);
        return;
      }
    }

    const rack = findRack(x, y);
    if (!rack) return;
    if (editing) {
      drag.current = {
        type: 'moveRack',
        id: rack.id,
        offsetX: x - value(rack.map_x),
        offsetY: y - value(rack.map_y),
        moved: false
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    } else {
      onSelectRack(rack.id);
    }
  };

  const pointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const point = pointFromEvent(event);
    if (structureDrag.current) {
      const { type, start } = structureDrag.current;
      setStructurePreview(createWarehouseStructure(type, start, snapToGrid(point), 'preview'));
      return;
    }
    if (drawingPerimeter) {
      if (draggedPerimeterVertex.current !== null) {
        onMovePerimeterPoint(draggedPerimeterVertex.current, snapToGrid(point));
      } else if (!editingPerimeter) {
        setPointerPosition(snapToGrid(point));
      }
      return;
    }
    setPointerPosition(null);
    if (!editing) return;

    if (!drag.current) {
      const hoveringResizeHandle = [...racks].reverse().some((rack) =>
        Math.abs(point.x - (value(rack.map_x) + value(rack.map_width))) <= handleHitDistance &&
        Math.abs(point.y - (value(rack.map_y) + value(rack.map_height))) <= handleHitDistance
      );
      event.currentTarget.style.cursor = hoveringResizeHandle ? 'nwse-resize' : 'grab';
      return;
    }

    if (drag.current.type === 'moveRack') {
      const currentDrag = drag.current;
      const rack = racks.find((item) => item.id === currentDrag.id);
      if (!rack) return;
      currentDrag.moved = true;
      const maxX = Math.max(0, width - value(rack.map_width));
      const maxY = Math.max(0, height - value(rack.map_height));
      const x = Math.max(0, Math.min(maxX, Math.round((point.x - currentDrag.offsetX) / MAP_GRID_SIZE) * MAP_GRID_SIZE));
      const y = Math.max(0, Math.min(maxY, Math.round((point.y - currentDrag.offsetY) / MAP_GRID_SIZE) * MAP_GRID_SIZE));
      onMoveRack(currentDrag.id, x, y);
    } else {
      const currentDrag = drag.current;
      const snappedWidth = currentDrag.initialWidth +
        Math.round((point.x - currentDrag.startX) / MAP_GRID_SIZE) * MAP_GRID_SIZE;
      const snappedHeight = currentDrag.initialHeight +
        Math.round((point.y - currentDrag.startY) / MAP_GRID_SIZE) * MAP_GRID_SIZE;
      onResizeRack(currentDrag.id, snappedWidth, snappedHeight);
    }
  };

  const pointerUp = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (structureDrag.current) {
      const { type, start } = structureDrag.current;
      const structure = createWarehouseStructure(type, start, snapToGrid(pointFromEvent(event)), createStructureId());
      if (structure) onAddStructure(structure);
      structureDrag.current = null;
      setStructurePreview(null);
    }
    draggedPerimeterVertex.current = null;
    const currentDrag = drag.current;
    if (currentDrag) {
      if (currentDrag.type === 'moveRack' && !currentDrag.moved) onSelectRack(currentDrag.id);
      drag.current = null;
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const drop = (event: DragEvent<HTMLDivElement>) => {
    if (event.dataTransfer.getData('application/stockflow-map-element') !== 'rack') return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    onDropRack(
      Math.max(0, Math.min(width, (event.clientX - rect.left) * width / rect.width)),
      Math.max(0, Math.min(height, (event.clientY - rect.top) * height / rect.height))
    );
  };

  const handleKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    const selectedIndex = racks.findIndex((rack) => rack.id === selectedRackId);
    if (event.key === 'Enter' && selectedRackId) onSelectRack(selectedRackId);
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      if (racks.length) onSelectRack(racks[(selectedIndex < 0 ? 0 : selectedIndex + 1) % racks.length].id);
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (racks.length) onSelectRack(racks[(selectedIndex < 0 ? racks.length - 1 : selectedIndex - 1 + racks.length) % racks.length].id);
    }
  };

  const perimeterPoints = (points: WarehousePoint[]) => points.map((point) => `${point.x},${point.y}`).join(' ');

  return (
    <div
      ref={canvasRef}
      className={`warehouse-map-canvas ${editing ? 'editing' : ''} ${drawingPerimeter ? 'drawing-perimeter' : ''}`}
      style={{ width: width * MAP_RENDER_SCALE, height: height * MAP_RENDER_SCALE, transform: `scale(${zoom})`, transformOrigin: 'top left' }}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('application/stockflow-map-element')) event.preventDefault();
      }}
      onDrop={drop}
    >
      <svg
        aria-label="Plano cenital del almacén. Navega entre estanterías con las flechas y pulsa Intro para abrir una."
        role="application"
        tabIndex={0}
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height="100%"
        preserveAspectRatio="none"
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerLeave={() => setPointerPosition(null)}
        onPointerUp={pointerUp}
        onPointerCancel={() => {
          drag.current = null;
          draggedPerimeterVertex.current = null;
          structureDrag.current = null;
          setStructurePreview(null);
        }}
        onKeyDown={handleKeyDown}
      >
        <defs>
          <pattern id={`${gridId}-fine`} width={MAP_GRID_SIZE} height={MAP_GRID_SIZE} patternUnits="userSpaceOnUse">
            <path d={`M ${MAP_GRID_SIZE} 0 L 0 0 0 ${MAP_GRID_SIZE}`} fill="none" stroke="#e8eeea" strokeWidth="6" />
          </pattern>
          <pattern id={`${gridId}-major`} width={MAP_GRID_SIZE * 5} height={MAP_GRID_SIZE * 5} patternUnits="userSpaceOnUse">
            <path d={`M ${MAP_GRID_SIZE * 5} 0 L 0 0 0 ${MAP_GRID_SIZE * 5}`} fill="none" stroke="#dce5df" strokeWidth="12" />
          </pattern>
        </defs>
        <rect width={width} height={height} fill="#f8faf8" />
        <rect width={width} height={height} fill={`url(#${gridId}-fine)`} />
        <rect width={width} height={height} fill={`url(#${gridId}-major)`} />

        {perimeter.length >= 3
          ? <polygon points={perimeterPoints(perimeter)} fill="#dce9dfb8" stroke="#71877a" strokeWidth="30" />
          : <rect x="4" y="4" width={width - 8} height={height - 8} fill="none" stroke="#a8b7ac" strokeWidth="30" />}

        {drawingPerimeter && perimeterDraft.length > 0 && <>
          {editingPerimeter
            ? <polygon points={perimeterPoints(perimeterDraft)} fill="#b9dfc855" stroke="#168158" strokeWidth="30" />
            : <polyline
                points={perimeterPoints(pointerPosition ? [...perimeterDraft, pointerPosition] : perimeterDraft)}
                fill="none"
                stroke="#168158"
                strokeWidth="30"
                strokeDasharray="80 50"
              />}
          {perimeterDraft.map((point, index) => (
            <circle
              key={`${point.x}-${point.y}-${index}`}
              cx={point.x}
              cy={point.y}
              r={!editingPerimeter && index === 0 ? 70 : 50}
              fill={!editingPerimeter && index === 0 ? '#168158' : '#fff'}
              stroke="#168158"
              strokeWidth="20"
            />
          ))}
        </>}

        {structures.map((structure) => (
          <g
            key={structure.id}
            style={{ cursor: editing ? 'pointer' : 'default' }}
            onPointerDown={(event) => {
              if (!editing || drawingPerimeter || drawingStructureType) return;
              event.stopPropagation();
              onSelectStructure(structure.id);
            }}
          >
            <rect
              x={structure.x}
              y={structure.y}
              width={structure.width}
              height={structure.height}
              rx="4"
              fill={structure.type === 'wall' ? '#65736b' : '#f4e3b6'}
              stroke={selectedStructureId === structure.id ? '#168158' : structure.type === 'wall' ? '#3d4b43' : '#ae7a2c'}
              strokeWidth={selectedStructureId === structure.id ? 12 : 6}
            />
            {structure.type === 'door' && <text
              x={structure.x + structure.width / 2}
              y={structure.y + structure.height / 2}
              fill="#815d24"
              fontSize="55"
              fontWeight="700"
              textAnchor="middle"
              dominantBaseline="middle"
            >PUERTA</text>}
          </g>
        ))}
        {structurePreview && <rect
          x={structurePreview.x}
          y={structurePreview.y}
          width={structurePreview.width}
          height={structurePreview.height}
          fill={structurePreview.type === 'wall' ? '#65736b99' : '#f4e3b699'}
          stroke={structurePreview.type === 'wall' ? '#3d4b43' : '#ae7a2c'}
          strokeWidth="8"
          strokeDasharray="35 20"
          pointerEvents="none"
        />}

        {racks.map((rack) => {
          const x = value(rack.map_x);
          const y = value(rack.map_y);
          const rackWidth = value(rack.map_width);
          const rackHeight = value(rack.map_height);
          const occupied = locations.filter((location) =>
            location.rack_id === rack.id && (value(location.quantity) > 0 || location.in_use)
          ).length;
          const occupancy = Math.min(1, occupied / Math.max(1, rack.bin_count));
          const selected = rack.id === selectedRackId;
          const fill = occupancy >= 0.8 ? '#fff1e9' : occupancy >= 0.4 ? '#f5f4e8' : '#eaf5ee';
          const accent = occupancy >= 0.8 ? '#d88958' : occupancy >= 0.4 ? '#b5a65b' : '#4b9b70';
          const centerX = x + rackWidth / 2;
          const centerY = y + rackHeight / 2;
          const barWidth = Math.min(rackWidth * 0.62, 1500);

          return (
            <g
              key={rack.id}
              aria-label={`Estantería ${rack.name}`}
              style={{ cursor: editing ? 'grab' : 'pointer' }}
            >
              <rect
                x={x}
                y={y}
                width={rackWidth}
                height={rackHeight}
                fill={fill}
                stroke={selected ? '#177e55' : accent}
                strokeWidth={selected ? 30 : 20}
              />
              <text
                x={centerX}
                y={centerY - 35}
                fill="#283b30"
                fontSize={Math.max(20, Math.min(140, rackWidth * 0.72 / Math.max(1, rack.name.length * 0.56)))}
                fontWeight="700"
                textAnchor="middle"
                dominantBaseline="middle"
              >{rack.name}</text>
              <rect x={centerX - barWidth / 2} y={centerY + 20} width={barWidth} height="50" fill="#d7e1da" />
              <rect x={centerX - barWidth / 2} y={centerY + 20} width={barWidth * occupancy} height="50" fill={accent} />
              <text
                x={centerX}
                y={centerY + 100}
                fill="#65736a"
                fontSize="70"
                textAnchor="middle"
                dominantBaseline="middle"
              >{Math.round(occupancy * 100)}%</text>
              {editing && <>
                <rect x={x + rackWidth - 100} y={y + rackHeight - 100} width="140" height="140" fill="#fff" stroke="#177e55" strokeWidth="20" />
                <path d={`M ${x + rackWidth - 80} ${y + rackHeight - 20} L ${x + rackWidth - 20} ${y + rackHeight - 80}`} fill="none" stroke="#177e55" strokeWidth="20" />
              </>}
            </g>
          );
        })}
        {!racks.length && <text x={width / 2} y={height / 2} fill="#97a39c" fontSize="110" textAnchor="middle" dominantBaseline="middle">Activa “Editar plano” y añade una estantería.</text>}
      </svg>
    </div>
  );
}
