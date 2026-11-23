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

function RackScene({ rack, locations, selectedId, onSelectProduct, productId, selectableLocationIds, showAllLocations }: Props) {
  const width = Math.max(3, rack.bins_per_level * 1.15);
  const depth = 1.35;
  const selectableIds = useMemo(() => new Set(selectableLocationIds ?? locations.map((location) => location.id)), [locations, selectableLocationIds]);
  const levelPositions = useMemo(() => {
    let height = 0.55;
    return Array.from({ length: rack.level_count }, (_, index) => {
      height += Math.max(1, number(rack.level_heights[index] ?? 240)) / 100;
      return height;
    });
  }, [rack.level_count, rack.level_heights]);
  const rackHeight = (levelPositions.at(-1) ?? 2.95) + 0.5;

  return (
    <>
      <color attach="background" args={['#f5f8f6']} />
      <ambientLight intensity={1.6} />
      <directionalLight position={[5, 8, 6]} intensity={2.2} />
      <directionalLight position={[-5, 4, -4]} intensity={1} />
      <gridHelper args={[12, 24, '#cdd8d0', '#e4eae6']} position={[0, 0.01, 0]} />

      {[-1, 1].flatMap((xSide) => [-1, 1].map((zSide) => (
        <mesh key={`upright-${xSide}-${zSide}`} position={[xSide * (width / 2 - 0.08), rackHeight / 2, zSide * (depth / 2 - 0.08)]} castShadow>
          <boxGeometry args={[0.12, rackHeight, 0.12]} />
          <meshStandardMaterial color="#1769aa" metalness={0.72} roughness={0.3} />
        </mesh>
      )))}

      {levelPositions.map((y, index) => (
        <group key={`level-${index}`} position={[0, y, 0]}>
          {[-1, 1].map((zSide) => (
            <mesh key={zSide} position={[0, 0, zSide * (depth / 2 - 0.08)]} castShadow>
              <boxGeometry args={[width - 0.18, 0.09, 0.1]} />
              <meshStandardMaterial color="#f28a24" metalness={0.55} roughness={0.38} />
            </mesh>
          ))}
          <mesh position={[0, -0.07, 0]} receiveShadow>
            <boxGeometry args={[width - 0.25, 0.035, depth - 0.28]} />
            <meshStandardMaterial color="#aeb8b2" metalness={0.55} roughness={0.45} />
          </mesh>
        </group>
      ))}

      {locations.filter((location) => showAllLocations || number(location.quantity) > 0).map((location, index) => {
        const levelIndex = Math.max(0, Math.min(rack.level_count - 1, location.level_number - 1));
        const levelY = levelPositions[levelIndex] ?? 1;
        const slotWidth = (width - 0.35) / Math.max(1, rack.bins_per_level);
        const x = -width / 2 + 0.175 + slotWidth * (location.slot_position - 1 + location.width_units / 2);
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
              position={[x, levelY + 0.35, 0]}
              castShadow
              onClick={isSelectable ? (event) => {
                event.stopPropagation();
                onSelectProduct(location.products, location);
              } : undefined}
            >
              <boxGeometry args={[Math.max(0.35, slotWidth * location.width_units - 0.18), 0.62, depth * 0.62]} />
              <meshStandardMaterial
                color={isSelected ? '#f4a340' : isHighlighted ? (index % 2 ? '#51a879' : '#78c495') : isEmptyDestination ? '#77a9bd' : productId ? '#aeb8b2' : index % 2 ? '#c78d54' : '#d6a56c'}
                roughness={0.68}
                emissive={isSelected ? '#a84c08' : isHighlighted ? '#164d2c' : '#000000'}
                emissiveIntensity={isSelected ? 0.25 : isHighlighted ? 0.12 : 0}
              />
            </mesh>
            <Html position={[x, levelY + 0.78, 0]} center distanceFactor={8} style={{ pointerEvents: 'none', whiteSpace: 'nowrap' }}><span className="rack-bin-name">{location.display_name || location.code}</span></Html>
          </group>
        );
      })}

      <OrbitControls makeDefault enableDamping minDistance={2} maxDistance={100} target={[0, rackHeight / 2, 0]} />
    </>
  );
}

export default function RackViewer3D(props: Props) {
  const camera = useMemo(() => {
    const height = props.rack.level_heights.reduce<number>((sum, level) => sum + number(level) / 100, 1);
    const width = Math.max(3, props.rack.bins_per_level * 1.15);
    const distance = Math.max(height, width) * 1.45;
    const result = new THREE.PerspectiveCamera(42, 1, 0.1, 1000);
    result.position.set(distance * 0.55, height / 2 + distance * 0.35, distance * 0.8);
    return result;
  }, [props.rack.bins_per_level, props.rack.level_heights]);

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
