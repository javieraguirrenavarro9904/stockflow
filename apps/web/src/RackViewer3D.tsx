import { Canvas, useThree } from '@react-three/fiber';
import { Html, OrbitControls } from '@react-three/drei';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';

type RackLocation = {
  id: string;
  code: string;
  display_name: string | null;
  level_number: number;
  slot_position: number;
  width_units: number;
  quantity: string | number;
  products: { productId: string; sku: string; name: string; quantity: string | number; lot: string | null }[];
};

type Rack = {
  code: string;
  map_width: string | number;
  map_height: string | number;
  level_count: number;
  bins_per_level: number;
  level_heights: (string | number)[];
};

type Props = {
  rack: Rack;
  locations: RackLocation[];
  selectedId: string | null;
  onSelectProduct: (products: RackLocation['products'], location: RackLocation) => void;
  productId?: string;
  selectableLocationIds?: string[];
  showAllLocations?: boolean;
  showLocationLabels?: boolean;
};

const number = (value: string | number) => Number(value) || 0;

function ResizeCamera() {
  const { camera, size } = useThree();

  useEffect(() => {
    if (!(camera instanceof THREE.PerspectiveCamera) || !size.height) return;
    camera.aspect = size.width / size.height;
    camera.updateProjectionMatrix();
  }, [camera, size.width, size.height]);

  return null;
}

function RackScene({ rack, locations, selectedId, onSelectProduct, productId, selectableLocationIds, showAllLocations, showLocationLabels = true }: Props) {
  const width = Math.max(1.6, number(rack.map_width) / 100);
  const depth = Math.max(1, number(rack.map_height) / 100);
  const uprightWidth = Math.min(0.12, Math.max(0.05, width * 0.025));
  const uprightDepth = Math.min(0.12, Math.max(0.05, depth * 0.1));
  const beamHeight = Math.min(0.08, Math.max(0.04, width * 0.01));
  const selectableIds = useMemo(() => new Set(selectableLocationIds ?? locations.map((location) => location.id)), [locations, selectableLocationIds]);
  const levelPositions = useMemo(() => {
    let height = 0.12;
    return Array.from({ length: rack.level_count }, (_, index) => {
      height += Math.max(1, number(rack.level_heights[index] ?? 240)) / 100;
      return height;
    });
  }, [rack.level_count, rack.level_heights]);
  const finalLevelSpacing = Math.max(0.01, number(rack.level_heights.at(-1) ?? 240) / 100);
  const finalBoxHeight = Math.min(0.62, Math.max(0.12, finalLevelSpacing * 0.65));
  const rackHeight = (levelPositions.at(-1) ?? 0.12) + finalBoxHeight + 0.1;
  const gridSize = Math.max(12, Math.ceil(Math.max(width, depth) * 1.5 / 2) * 2);
  const gridDivisions = Math.max(24, Math.round(gridSize * 2));
  const usableWidth = width - uprightWidth * 2;
  const slotPitch = usableWidth / Math.max(1, rack.bins_per_level);
  const boxGap = Math.min(0.06, slotPitch * 0.15);
  const boxDepth = Math.max(0.2, depth * 0.72);

  return (
    <>
      <color attach="background" args={['#f5f8f6']} />
      <ambientLight intensity={1.6} />
      <directionalLight position={[5, 8, 6]} intensity={2.2} />
      <directionalLight position={[-5, 4, -4]} intensity={1} />
      <gridHelper args={[gridSize, gridDivisions, '#cdd8d0', '#e4eae6']} position={[0, 0.01, 0]} />

      {[-1, 1].flatMap((xSide) => [-1, 1].map((zSide) => (
        <mesh key={`upright-${xSide}-${zSide}`} position={[xSide * (width / 2 - uprightWidth / 2), rackHeight / 2, zSide * (depth / 2 - uprightDepth / 2)]} castShadow>
          <boxGeometry args={[uprightWidth, rackHeight, uprightDepth]} />
          <meshStandardMaterial color="#1769aa" metalness={0.72} roughness={0.3} />
        </mesh>
      )))}

      {levelPositions.map((y, index) => (
        <group key={`level-${index}`} position={[0, y, 0]}>
          {[-1, 1].map((zSide) => (
            <mesh key={zSide} position={[0, 0, zSide * (depth / 2 - uprightDepth / 2)]} castShadow>
              <boxGeometry args={[width - uprightWidth, beamHeight, uprightDepth]} />
              <meshStandardMaterial color="#f28a24" metalness={0.55} roughness={0.38} />
            </mesh>
          ))}
          <mesh position={[0, -beamHeight / 2, 0]} receiveShadow>
            <boxGeometry args={[width - uprightWidth, 0.035, depth - uprightDepth]} />
            <meshStandardMaterial color="#aeb8b2" metalness={0.55} roughness={0.45} />
          </mesh>
        </group>
      ))}

      {locations.filter((location) => showAllLocations || number(location.quantity) > 0).map((location, index) => {
        const levelIndex = Math.max(0, Math.min(rack.level_count - 1, location.level_number - 1));
        const levelY = levelPositions[levelIndex] ?? 1;
        const x = -width / 2 + uprightWidth + slotPitch * (location.slot_position - 1 + location.width_units / 2);
        const slotWidth = slotPitch * location.width_units - boxGap;
        const levelSpacing = Math.max(0.01, number(rack.level_heights[levelIndex] ?? 240) / 100);
        const boxHeight = Math.min(0.62, Math.max(0.12, levelSpacing * 0.65));
        const isSelected = location.id === selectedId;
        const hasProduct = productId
          ? location.products.some((product) => product.productId === productId && number(product.quantity) > 0)
          : true;
        const isSelectable = selectableIds.has(location.id);
        const isHighlighted = Boolean(productId && hasProduct && isSelectable);
        const isEmptyDestination = showAllLocations && number(location.quantity) <= 0 && isSelectable;
        return (
          <group key={location.id}>
            <mesh
              position={[x, levelY + boxHeight / 2 + beamHeight / 2, 0]}
              castShadow
              onClick={isSelectable ? (event) => {
                event.stopPropagation();
                onSelectProduct(location.products, location);
              } : undefined}
            >
              <boxGeometry args={[Math.max(0.03, slotWidth), boxHeight, boxDepth]} />
              <meshStandardMaterial
                color={isSelected ? '#f4a340' : isHighlighted ? (index % 2 ? '#51a879' : '#78c495') : isEmptyDestination ? '#77a9bd' : productId ? '#aeb8b2' : index % 2 ? '#c78d54' : '#d6a56c'}
                roughness={0.68}
                emissive={isSelected ? '#a84c08' : isHighlighted ? '#164d2c' : '#000000'}
                emissiveIntensity={isSelected ? 0.25 : isHighlighted ? 0.12 : 0}
              />
            </mesh>
            {showLocationLabels && number(location.quantity) > 0 && <Html position={[x, levelY + boxHeight + beamHeight / 2 + 0.08, 0]} center distanceFactor={8} style={{ pointerEvents: 'none', whiteSpace: 'nowrap' }}><span className="rack-bin-name">{location.display_name || location.code}</span></Html>}
          </group>
        );
      })}

      <OrbitControls makeDefault enableDamping minDistance={2} maxDistance={100} target={[0, rackHeight / 2, 0]} />
    </>
  );
}

export default function RackViewer3D(props: Props) {
  const camera = useMemo(() => {
    const levelHeights = props.rack.level_heights.map((level) => number(level) / 100);
    const finalLevelSpacing = Math.max(0.01, levelHeights.at(-1) ?? 2.4);
    const height = 0.22 + levelHeights.reduce((sum, level) => sum + level, 0) +
      Math.min(0.62, Math.max(0.12, finalLevelSpacing * 0.65));
    const width = Math.max(1.6, number(props.rack.map_width) / 100);
    const depth = Math.max(1, number(props.rack.map_height) / 100);
    const distance = Math.max(height, width, depth) * 1.65;
    const result = new THREE.PerspectiveCamera(42, 1, 0.1, 1000);
    result.position.set(distance * 0.55, height / 2 + distance * 0.35, distance * 0.8);
    return result;
  }, [props.rack.level_heights, props.rack.map_height, props.rack.map_width]);

  return (
    <div className="rack-webgl-canvas" role="application" aria-label={`Visor 3D de la estantería ${props.rack.code}`}>
      <Canvas key={props.rack.code} camera={camera} shadows>
        <ResizeCamera />
        <RackScene {...props} />
      </Canvas>
      <span className="rack-webgl-hint">Arrastra para rotar · rueda para zoom · clic en un paquete para seleccionarlo</span>
    </div>
  );
}
