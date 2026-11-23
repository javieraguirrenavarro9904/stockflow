export type WarehousePoint = { x: number; y: number };

export const MAP_GRID_SIZE = 100;
export const MAP_RENDER_SCALE = 0.1;

export type WarehouseRackBounds = { x: number; y: number; width: number; height: number };

export function isRackWithinPerimeter(rack: WarehouseRackBounds, perimeter: WarehousePoint[]): boolean {
  if (perimeter.length < 3) return true;

  const corners = [
    { x: rack.x, y: rack.y },
    { x: rack.x + rack.width, y: rack.y },
    { x: rack.x + rack.width, y: rack.y + rack.height },
    { x: rack.x, y: rack.y + rack.height }
  ];
  const midpoints = corners.map((point, index) => {
    const next = corners[(index + 1) % corners.length];
    return { x: (point.x + next.x) / 2, y: (point.y + next.y) / 2 };
  });
  const contains = (point: WarehousePoint) => {
    let inside = false;
    for (let index = 0, previous = perimeter.length - 1; index < perimeter.length; previous = index, index += 1) {
      const start = perimeter[previous];
      const end = perimeter[index];
      const cross = (point.x - start.x) * (end.y - start.y) - (point.y - start.y) * (end.x - start.x);
      if (Math.abs(cross) < 1e-7 &&
        point.x >= Math.min(start.x, end.x) - 1e-7 && point.x <= Math.max(start.x, end.x) + 1e-7 &&
        point.y >= Math.min(start.y, end.y) - 1e-7 && point.y <= Math.max(start.y, end.y) + 1e-7) return true;
      if ((start.y > point.y) !== (end.y > point.y) &&
        point.x < (end.x - start.x) * (point.y - start.y) / (end.y - start.y) + start.x) inside = !inside;
    }
    return inside;
  };
  const orientation = (a: WarehousePoint, b: WarehousePoint, c: WarehousePoint) =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

  if (![...corners, ...midpoints, {
    x: rack.x + rack.width / 2,
    y: rack.y + rack.height / 2
  }].every(contains)) return false;

  for (let rackEdge = 0; rackEdge < corners.length; rackEdge += 1) {
    const start = corners[rackEdge];
    const end = corners[(rackEdge + 1) % corners.length];
    for (let perimeterEdge = 0; perimeterEdge < perimeter.length; perimeterEdge += 1) {
      const boundaryStart = perimeter[perimeterEdge];
      const boundaryEnd = perimeter[(perimeterEdge + 1) % perimeter.length];
      const first = orientation(start, end, boundaryStart);
      const second = orientation(start, end, boundaryEnd);
      const third = orientation(boundaryStart, boundaryEnd, start);
      const fourth = orientation(boundaryStart, boundaryEnd, end);
      if (first * second < -1e-7 && third * fourth < -1e-7) return false;
    }
  }
  return true;
}

export type WarehousePlanRack = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  label: string;
};

export type WarehousePlan = {
  perimeter: [number, number][];
  racks: WarehousePlanRack[];
};

type RackSource = {
  id: string;
  code: string;
  map_x: string | number;
  map_y: string | number;
  map_width: string | number;
  map_height: string | number;
};

export function exportarPlanoJSON(perimeter: WarehousePoint[], racks: RackSource[]): WarehousePlan {
  return {
    perimeter: perimeter.map(({ x, y }) => [x, y]),
    racks: racks.map((rack) => ({
      id: rack.id,
      x: Number(rack.map_x),
      y: Number(rack.map_y),
      width: Number(rack.map_width),
      height: Number(rack.map_height),
      rotation: 0,
      label: rack.code
    }))
  };
}

export function cargarPlanoJSON(datosJSON: unknown): WarehousePlan {
  const parsed = typeof datosJSON === 'string' ? JSON.parse(datosJSON) as unknown : datosJSON;
  if (!parsed || typeof parsed !== 'object') throw new Error('El archivo no contiene un plano válido.');
  const data = parsed as { perimeter?: unknown; racks?: unknown };
  if (!Array.isArray(data.perimeter) || !Array.isArray(data.racks)) {
    throw new Error('El plano debe incluir perimeter y racks.');
  }

  const perimeter = data.perimeter.map((point): [number, number] => {
    if (!Array.isArray(point) || point.length !== 2) throw new Error('El perímetro contiene un vértice no válido.');
    const [x, y] = point as unknown[];
    if (typeof x !== 'number' || !Number.isFinite(x) || typeof y !== 'number' || !Number.isFinite(y)) {
      throw new Error('Las coordenadas del perímetro deben ser números válidos.');
    }
    return [x, y];
  });
  if (perimeter.length !== 0 && perimeter.length < 3) {
    throw new Error('El perímetro debe tener al menos tres vértices.');
  }

  const racks = data.racks.map((rack): WarehousePlanRack => {
    if (!rack || typeof rack !== 'object') throw new Error('El plano contiene una estantería no válida.');
    const item = rack as Record<string, unknown>;
    const { id, x, y, width, height, rotation, label } = item;
    if (typeof id !== 'string' || typeof label !== 'string' ||
      typeof x !== 'number' || !Number.isFinite(x) ||
      typeof y !== 'number' || !Number.isFinite(y) ||
      typeof width !== 'number' || !Number.isFinite(width) || width <= 0 ||
      typeof height !== 'number' || !Number.isFinite(height) || height <= 0 ||
      typeof rotation !== 'number' || !Number.isFinite(rotation)) {
      throw new Error('Las propiedades de una estantería no son válidas.');
    }
    return { id, x, y, width, height, rotation, label };
  });

  return { perimeter, racks };
}
