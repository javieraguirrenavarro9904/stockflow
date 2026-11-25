import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  Activity, Archive, ArrowDownLeft, ArrowLeft, ArrowLeftRight, ArrowUpRight, Bell, Boxes,
  Building2, CalendarClock, Check, ChevronDown, ChevronRight, CircleHelp, ClipboardList,
  Command, Download, LayoutDashboard, Layers, LockKeyhole, LogOut,
  Map, Menu, Package, Pencil, Plus, Printer, QrCode, Search, Settings2, ShieldCheck, Sparkles,
  ShoppingCart, Trash2, Upload, UserPlus, Users, X, ZoomIn, ZoomOut
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import WarehouseMap2D from './WarehouseMap2D';
import {
  cargarPlanoJSON, exportarPlanoJSON, isRackWithinPerimeter,
  rackOverlapsStructures, MAP_GRID_SIZE, MAP_RENDER_SCALE, type WarehousePoint, type WarehouseStructure
} from './warehousePlan';
import { PurchasingPage, SalesOrdersPage, type PurchaseOrder, type ReplenishmentItem, type SalesOrder } from './BusinessPages';

const API = (import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? 'http://localhost:3001/api' : '')).replace(/\/+$/, '');
const RackViewer3D = lazy(() => import('./RackViewer3D'));
let authToken: string | null = sessionStorage.getItem('stockflow.session');
const qrWarehouseId = new URLSearchParams(window.location.search).get('warehouseId');
let activeWarehouseId: string | null = qrWarehouseId ?? localStorage.getItem('stockflow.warehouse');
if (qrWarehouseId) localStorage.setItem('stockflow.warehouse', qrWarehouseId);

type AuthUser = { id: string; name: string; email: string; role: 'admin' | 'employee' };
type Product = {
  id: string; sku: string; name: string; barcode: string | null; category: string | null;
  supplier: string | null; unit_of_measure: string; stock: string | number;
  reserved: string | number; min_stock: string | number; category_id: string | null;
  supplier_id: string | null; active?: boolean;
};

type CatalogOption = { id: string; name: string };
type ExpectedProduct = { productId: string; sku: string; name: string; quantity: string | number };
type Warehouse = {
  id: string; name: string; code: string; map_width: string | number; map_height: string | number;
  map_perimeter?: WarehousePoint[]; map_structures?: WarehouseStructure[];
};
type WarehouseMap = Warehouse;
type Aisle = {
  id: string; zone_id: string; name: string; code: string; zone: string;
  map_x: string | number; map_y: string | number; map_width: string | number; map_height: string | number;
};
type Location = {
  id: string; code: string; barcode: string | null; capacity: string | null; display_name: string | null;
  warehouse_id: string; warehouse: string;
  map_x: string | number; map_y: string | number; map_width: string | number; map_height: string | number;
  width_units: number; slot_position: number; depth_position: number;
  status: string; in_use: boolean; zone: string; aisle_id: string; aisle: string; rack_id: string; rack: string; level_number: number;
  quantity: string | number; products: { productId: string; sku: string; name: string; quantity: string | number; lot: string | null }[];
  expected_products: ExpectedProduct[];
};
type Rack = {
  id: string; aisle_id: string; name: string; code: string;
  map_x: string | number; map_y: string | number; map_width: string | number; map_height: string | number;
  zone: string; aisle: string; level_count: number; bins_per_level: number; depth_slots: number; bin_count: number;
  level_heights: (string | number)[]; units: string | number;
};
type UserEntry = AuthUser & { active: boolean; created_at: string };
type Movement = {
  id: string; type: string; reference: string | null; products: string;
  units: string | number; created_at: string;
};
type InUseLoan = {
  id: string; product_id: string; sku: string; name: string;
  quantity: string | number; returned_quantity: string | number; remaining_quantity: string | number;
  lot_code: string | null; reference: string | null; created_at: string;
  original_bin_id: string; original_location: string;
};
type EmployeeMovementAlert = Movement & {
  user_id: string; user_name: string; user_email: string; unread: boolean;
};
type Overview = {
  stats: { products: number; units: string | number; locations: number; low_stock: number };
  movements: Movement[];
  lowStock: Product[];
  expiring: { name: string; lot_code: string; expires_at: string; quantity: number }[];
};
type Page = 'overview' | 'inventory' | 'map' | 'movements' | 'purchasing' | 'salesOrders' | 'assistant' | 'settings';

const navItems: { id: Page; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'overview', label: 'Resumen', icon: LayoutDashboard },
  { id: 'inventory', label: 'Inventario', icon: Boxes },
  { id: 'map', label: 'Mapa almacén', icon: Map },
  { id: 'movements', label: 'Movimientos', icon: ArrowLeftRight },
  { id: 'purchasing', label: 'Compras', icon: ShoppingCart },
  { id: 'salesOrders', label: 'Pedidos de salida', icon: ClipboardList },
  { id: 'assistant', label: 'Asistente IA', icon: Sparkles }
];
const movementNames: Record<string, string> = {
  receipt: 'Entrada', dispatch: 'Salida', transfer: 'Transferencia', adjustment: 'Ajuste',
  in_use: 'En uso', return: 'Devolución'
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (!API) throw new Error('Falta configurar VITE_API_URL con la dirección pública de la API');
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...(activeWarehouseId ? { 'X-Warehouse-Id': activeWarehouseId } : {}),
      ...init?.headers
    }
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    if (response.status === 401 && path !== '/auth/login') window.dispatchEvent(new Event('stockflow:unauthorized'));
    throw new Error(body.error ?? `Error HTTP ${response.status}`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function number(value: string | number | null | undefined) {
  return Number(value ?? 0);
}
function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toLocaleUpperCase() ?? '').join('');
}
function formatNumber(value: string | number) {
  return new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 }).format(number(value));
}
function formatQuantity(value: string | number) {
  return new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 }).format(number(value));
}
function locationLabel(location: Location) {
  const position = location.code.split('-').at(-1) ?? location.code;
  const level = location.level_number === 0 ? 'Suelo' : `Nivel ${String(location.level_number).padStart(2, '0')}`;
  const route = `${location.warehouse} · ${location.zone} · Pasillo ${location.aisle} · Estantería ${location.rack} · ${level} · Hueco ${position}`;
  return location.display_name ? `${location.display_name} · ${route}` : route;
}
function formatDate(value: string) {
  return new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}
function todayLabel() {
  return new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: '2-digit', month: 'long' }).format(new Date()).toLocaleUpperCase('es');
}
function downloadCsv(filename: string, rows: (string | number | null | undefined)[][]) {
  const csv = rows.map((row) => row.map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function parseCsv(text: string) {
  const firstLine = text.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0] ?? '';
  const delimiter = (firstLine.match(/;/g) ?? []).length >= (firstLine.match(/,/g) ?? []).length ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const source = text.replace(/^\uFEFF/, '');

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '"' && quoted && source[index + 1] === '"') {
      field += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === delimiter && !quoted) {
      row.push(field);
      field = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && source[index + 1] === '\n') index += 1;
      row.push(field);
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
      field = '';
    } else {
      field += character;
    }
  }
  row.push(field);
  if (row.some((cell) => cell.trim())) rows.push(row);
  return rows;
}

function normalizeCsvHeader(value: string) {
  return value.trim().toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    const expireSession = () => {
      authToken = null;
      sessionStorage.removeItem('stockflow.session');
      setUser(null);
    };
    window.addEventListener('stockflow:unauthorized', expireSession);
    if (!authToken) {
      setCheckingSession(false);
    } else {
      void request<AuthUser>('/auth/me').then(setUser).catch(() => {
        authToken = null;
        sessionStorage.removeItem('stockflow.session');
      }).finally(() => setCheckingSession(false));
    }
    return () => window.removeEventListener('stockflow:unauthorized', expireSession);
  }, []);

  const signIn = async (email: string, password: string) => {
    const result = await request<{ token: string; user: AuthUser }>('/auth/login', {
      method: 'POST', body: JSON.stringify({ email, password })
    });
    authToken = result.token;
    sessionStorage.setItem('stockflow.session', result.token);
    setUser(result.user);
  };

  const register = async (name: string, email: string, password: string, confirmPassword: string) => {
    const result = await request<{ token: string; user: AuthUser }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name, email, password, confirmPassword })
    });
    authToken = result.token;
    sessionStorage.setItem('stockflow.session', result.token);
    setUser(result.user);
  };

  const signOut = async () => {
    try { await request('/auth/logout', { method: 'POST' }); }
    catch (reason) { console.error('No se pudo revocar la sesión en el servidor:', reason); }
    finally {
      authToken = null;
      sessionStorage.removeItem('stockflow.session');
      setUser(null);
    }
  };

  if (checkingSession) return <div className="auth-loading">Comprobando sesión segura…</div>;
  if (!user) return <LoginPage onLogin={signIn} onRegister={register} />;
  return <WmsApp user={user} onSignOut={() => void signOut()} />;
}

function WmsApp({ user, onSignOut }: { user: AuthUser; onSignOut: () => void }) {
  const isAdmin = user.role === 'admin';
  const [page, setPage] = useState<Page>('overview');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<CatalogOption[]>([]);
  const [suppliers, setSuppliers] = useState<CatalogOption[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [racks, setRacks] = useState<Rack[]>([]);
  const [warehouseMap, setWarehouseMap] = useState<WarehouseMap | null>(null);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string | null>(activeWarehouseId);
  const [aisles, setAisles] = useState<Aisle[]>([]);
  const [users, setUsers] = useState<UserEntry[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [inUseLoans, setInUseLoans] = useState<InUseLoan[]>([]);
  const [employeeMovementAlerts, setEmployeeMovementAlerts] = useState<EmployeeMovementAlert[]>([]);
  const [unreadEmployeeMovementAlerts, setUnreadEmployeeMovementAlerts] = useState(0);
  const [replenishment, setReplenishment] = useState<ReplenishmentItem[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [salesOrders, setSalesOrders] = useState<SalesOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [movementError, setMovementError] = useState('');
  const [movementSaving, setMovementSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedLocation, setSelectedLocation] = useState<Location | null>(null);
  const [modal, setModal] = useState<'product' | 'editProduct' | 'movement' | 'bulkReceipt' | 'employee' | 'warehouse' | null>(null);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [movementDefaults, setMovementDefaults] = useState<{ type: string; fromBinId?: string } | null>(null);
  const [toast, setToast] = useState('');
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [warehouseOpen, setWarehouseOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mapEditing, setMapEditing] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const deepLinkHandledRef = useRef(false);
  const [qrRackId, setQrRackId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError('');
    try {
      const warehouseList = await request<Warehouse[]>('/warehouses');
      if (!warehouseList.length) throw new Error('No hay almacenes configurados');
      const selectedWarehouse = warehouseList.find((warehouse) => warehouse.id === activeWarehouseId) ?? warehouseList[0];
      activeWarehouseId = selectedWarehouse.id;
      localStorage.setItem('stockflow.warehouse', selectedWarehouse.id);
      setWarehouses(warehouseList);
      setSelectedWarehouseId(selectedWarehouse.id);
      const [summary, stock, bins, history, catalog, rackList, mapLayout, reorderList, purchaseOrderList, salesOrderList, loanList] = await Promise.all([
        request<Overview>('/overview'),
        request<Product[]>('/products'),
        request<Location[]>('/locations'),
        request<Movement[]>('/movements'),
        request<{ categories: CatalogOption[]; suppliers: CatalogOption[] }>('/catalog-options'),
        request<Rack[]>('/racks'),
        request<{ warehouse: WarehouseMap; aisles: Aisle[] }>('/map-layout'),
        request<ReplenishmentItem[]>('/replenishment'),
        request<PurchaseOrder[]>('/purchase-orders'),
        request<SalesOrder[]>('/sales-orders'),
        request<InUseLoan[]>('/in-use')
      ]);
      setOverview(summary);
      setProducts(stock);
      setCategories(catalog.categories);
      setSuppliers(catalog.suppliers);
      setLocations(bins);
      setWarehouseMap(mapLayout.warehouse);
      setAisles(mapLayout.aisles);
      setSelectedLocation((current) => current ? bins.find((location) => location.id === current.id) ?? null : null);
      setMovements(history);
      setRacks(rackList);
      setReplenishment(reorderList);
      setPurchaseOrders(purchaseOrderList);
      setSalesOrders(salesOrderList);
      setInUseLoans(loanList);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo cargar el almacén');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!isAdmin) return;
    let active = true;
    const controller = new AbortController();
    const loadAlerts = async () => {
      try {
        const result = await request<{ alerts: EmployeeMovementAlert[]; unreadCount: number }>('/admin/employee-movement-alerts');
        if (!active) return;
        setEmployeeMovementAlerts(result.alerts);
        setUnreadEmployeeMovementAlerts(result.unreadCount);
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : 'No se pudieron cargar las alertas de movimientos');
      }
    };
    const connectToAlertEvents = async () => {
      while (active) {
        try {
          const response = await fetch(`${API}/admin/employee-movement-alerts/events`, {
            headers: { Accept: 'text/event-stream', Authorization: `Bearer ${authToken}` },
            signal: controller.signal
          });
          if (response.status === 401) {
            window.dispatchEvent(new Event('stockflow:unauthorized'));
            return;
          }
          if (!response.ok || !response.body) throw new Error('No se pudo conectar con las alertas en tiempo real');
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          while (active) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
            let boundary = buffer.indexOf('\n\n');
            while (boundary >= 0) {
              const message = buffer.slice(0, boundary);
              buffer = buffer.slice(boundary + 2);
              const eventName = message.split('\n').find((line) => line.startsWith('event:'))?.slice(6).trim();
              if (eventName === 'ready' || eventName === 'movement') void loadAlerts();
              boundary = buffer.indexOf('\n\n');
            }
          }
        } catch (reason) {
          if (!active || controller.signal.aborted) break;
          console.error('Conexión de alertas interrumpida; se reintentará:', reason);
        }
        if (active) await new Promise((resolve) => window.setTimeout(resolve, 3000));
      }
    };
    void loadAlerts();
    void connectToAlertEvents();
    const intervalId = window.setInterval(() => void loadAlerts(), 30000);
    const refreshVisibleAlerts = () => {
      if (document.visibilityState === 'visible') void loadAlerts();
    };
    window.addEventListener('focus', refreshVisibleAlerts);
    document.addEventListener('visibilitychange', refreshVisibleAlerts);
    return () => {
      active = false;
      controller.abort();
      window.clearInterval(intervalId);
      window.removeEventListener('focus', refreshVisibleAlerts);
      document.removeEventListener('visibilitychange', refreshVisibleAlerts);
    };
  }, [isAdmin]);

  useEffect(() => {
    if (loading || error || deepLinkHandledRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const locationId = params.get('locationId');
    const rackId = params.get('rackId');
    const levelParam = params.get('level');
    const level = levelParam ? Number(levelParam) : null;
    if (!locationId && !rackId) return;

    deepLinkHandledRef.current = true;
    const rack = rackId ? racks.find((item) => item.id === rackId) : undefined;
    const location = locationId
      ? locations.find((item) => item.id === locationId)
      : level !== null
        ? locations
        .filter((item) => item.rack_id === rackId && item.level_number === level)
        .sort((left, right) => left.code.localeCompare(right.code, 'es'))[0]
        : undefined;
    if ((rackId && !rack) || (locationId && !location) || (levelParam && (!Number.isInteger(level) || !location))) {
      setError('No se encontró la ubicación del QR en este almacén. Comprueba el almacén activo.');
      return;
    }

    setQrRackId(rack?.id ?? location?.rack_id ?? null);
    setSelectedLocation(location ?? null);
    setPage('map');
    params.delete('locationId');
    params.delete('rackId');
    params.delete('level');
    params.delete('warehouseId');
    const query = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
  }, [error, loading, locations, racks]);

  useEffect(() => {
    if (page !== 'settings' || !isAdmin) return;
    void request<UserEntry[]>('/users').then(setUsers).catch((reason) => {
      setError(reason instanceof Error ? reason.message : 'No se pudo cargar la lista de empleados');
    });
  }, [page, isAdmin]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, []);

  const visibleProducts = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('es');
    return products.filter((p) => `${p.name} ${p.sku} ${p.barcode ?? ''}`.toLocaleLowerCase('es').includes(term));
  }, [products, search]);

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 2800);
  };

  const navigateToPage = (nextPage: Page) => {
    if (mapEditing && nextPage !== 'map') {
      if (!window.confirm('El plano sigue en modo edición. ¿Descartar los cambios y salir?')) return;
      setMapEditing(false);
    }
    setPage(nextPage);
  };

  const signOutFromEditor = () => {
    if (mapEditing && !window.confirm('El plano sigue en modo edición. ¿Descartar los cambios y cerrar sesión?')) return;
    setMapEditing(false);
    onSignOut();
  };

  const saveProduct = async (event: FormEvent<HTMLFormElement>, product?: Product) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await request(product ? `/products/${product.id}` : '/products', {
        method: product ? 'PATCH' : 'POST',
        body: JSON.stringify({
          sku: form.get('sku'), name: form.get('name'), barcode: form.get('barcode') || null,
          unit_of_measure: form.get('unit_of_measure') || 'ud', min_stock: Number(form.get('min_stock') || 0),
          category_id: form.get('category_id') || null, supplier_id: form.get('supplier_id') || null
        })
      });
      setModal(null);
      setEditingProduct(null);
      setMovementDefaults(null);
      await refresh();
      notify(product ? 'Producto actualizado' : 'Producto añadido al catálogo');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo crear el producto');
    }
  };

  const saveWarehouse = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const created = await request<Warehouse>('/warehouses', {
        method: 'POST',
        body: JSON.stringify({ name: form.get('name'), code: form.get('code') })
      });
      activeWarehouseId = created.id;
      localStorage.setItem('stockflow.warehouse', created.id);
      setSelectedWarehouseId(created.id);
      setModal(null);
      await refresh();
      notify('Almacén creado y seleccionado');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo crear el almacén');
    }
  };

  const deleteWarehouse = async (warehouse: Warehouse) => {
    const activeEditorWarning = warehouse.id === selectedWarehouseId && mapEditing
      ? ' También se descartarán los cambios sin guardar del plano.'
      : '';
    if (!window.confirm(`¿Eliminar el almacén «${warehouse.name}»? Solo se pueden eliminar almacenes sin existencias ni movimientos asociados y debe quedar al menos uno.${activeEditorWarning}`)) return;

    try {
      await request<void>(`/warehouses/${warehouse.id}`, { method: 'DELETE' });
      const remainingWarehouses = warehouses.filter((item) => item.id !== warehouse.id);
      if (warehouse.id === selectedWarehouseId) {
        activeWarehouseId = remainingWarehouses[0].id;
        localStorage.setItem('stockflow.warehouse', activeWarehouseId);
        setSelectedWarehouseId(activeWarehouseId);
        setSelectedLocation(null);
        setMapEditing(false);
      }
      setWarehouseOpen(false);
      await refresh();
      notify(`Almacén «${warehouse.name}» eliminado`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo eliminar el almacén');
    }
  };

  const saveMovement = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (movementSaving) return;
    const form = new FormData(event.currentTarget);
    const type = String(form.get('type'));
    const lotCode = String(form.get('lotCode') ?? '').trim();
    const expiresAt = String(form.get('expiresAt') ?? '').trim();
    if (expiresAt && !lotCode) {
      setMovementError('Para guardar la caducidad, indica también el código de lote o deja la fecha vacía.');
      return;
    }
    const payload: Record<string, unknown> = {
      type, productId: type === 'return' ? undefined : form.get('productId'), quantity: Number(form.get('quantity')),
      loanId: type === 'return' ? form.get('loanId') : undefined,
      lotCode: lotCode || undefined, expiresAt: expiresAt || undefined,
      binName: form.get('binName') || undefined,
      binWidthUnits: form.get('binWidthUnits') ? Number(form.get('binWidthUnits')) : undefined,
      reference: form.get('reference') || undefined,
      destinationWarehouseId: type === 'transfer' ? form.get('destinationWarehouseId') : undefined
    };

    const from = form.get('fromBinId');
    const to = form.get('toBinId');
    if (from) payload.fromBinId = from;
    if (to) payload.toBinId = to;
    setMovementSaving(true);
    setMovementError('');
    try {
      await request('/movements', { method: 'POST', body: JSON.stringify(payload) });
      setModal(null);
      setMovementDefaults(null);
      await refresh();
      notify('Movimiento registrado correctamente');
    } catch (reason) {
      setMovementError(reason instanceof Error ? reason.message : 'No se pudo registrar el movimiento');
    } finally {
      setMovementSaving(false);
    }
  };

  const saveBulkReceipt = async (reference: string, lines: { sku: string; name: string; binId: string; quantity: number; lotCode?: string; expiresAt?: string }[]) => {
    if (movementSaving) return;
    setMovementSaving(true);
    setMovementError('');
    try {
      const result = await request<{ createdProductCount: number }>('/movements/bulk-receipt', {
        method: 'POST',
        body: JSON.stringify({ reference: reference.trim() || undefined, lines })
      });
      setModal(null);
      await refresh();
      notify(`${lines.length} líneas importadas · ${result.createdProductCount} productos nuevos`);
    } catch (reason) {
      setMovementError(reason instanceof Error ? reason.message : 'No se pudo importar el archivo');
    } finally {
      setMovementSaving(false);
    }
  };

  const saveExpectedContent = async (locationId: string, expected: { productId: string; quantity: number }[]): Promise<boolean> => {
    try {
      await request(`/locations/${locationId}/expected-content`, {
        method: 'PUT',
        body: JSON.stringify({ products: expected })
      });
      await refresh();
      notify('Contenido esperado actualizado');
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo actualizar el contenido esperado');
      return false;
    }
  };

  const saveLocationName = async (locationId: string, displayName: string | null): Promise<boolean> => {
    try {
      await request(`/locations/${locationId}/display-name`, {
        method: 'PATCH',
        body: JSON.stringify({ displayName })
      });
      await refresh();
      notify('Nombre de caja actualizado');
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo actualizar el nombre de la caja');
      return false;
    }
  };

  const createPurchaseOrders = async (lines: { productId: string; quantity: number }[]): Promise<boolean> => {
    try {
      const created = await request<{ id: string }[]>('/purchase-orders', {
        method: 'POST', body: JSON.stringify({ lines })
      });
      await refresh();
      notify(created.length === 1 ? 'Pedido a proveedor creado' : `${created.length} pedidos a proveedores creados`);
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudieron crear los pedidos a proveedores');
      return false;
    }
  };

  const receivePurchaseOrder = async (orderId: string, lines: { lineId: string; binId: string; binName?: string; lotCode?: string; expiresAt?: string }[]): Promise<boolean> => {
    try {
      await request(`/purchase-orders/${orderId}/receive`, {
        method: 'POST', body: JSON.stringify({ lines })
      });
      await refresh();
      notify('Recepción completa registrada en el inventario');
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo recibir el pedido');
      return false;
    }
  };

  const cancelPurchaseOrder = async (orderId: string) => {
    if (!window.confirm('¿Cancelar este pedido pendiente a proveedor?')) return;
    try {
      await request(`/purchase-orders/${orderId}/cancel`, { method: 'POST' });
      await refresh();
      notify('Pedido a proveedor cancelado');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo cancelar el pedido');
    }
  };

  const createSalesOrder = async (order: { customerName: string; reference?: string; lines: { productId: string; quantity: number }[] }): Promise<boolean> => {
    try {
      await request('/sales-orders', { method: 'POST', body: JSON.stringify(order) });
      await refresh();
      notify('Pedido creado y existencias reservadas');
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo crear el pedido de salida');
      return false;
    }
  };

  const changeSalesOrder = async (orderId: string, action: 'picking' | 'fulfill' | 'cancel') => {
    if (action === 'cancel' && !window.confirm('¿Cancelar el pedido y liberar las existencias reservadas?')) return;
    try {
      await request(`/sales-orders/${orderId}/${action}`, { method: 'POST' });
      await refresh();
      notify(action === 'picking' ? 'Lista de picking preparada' : action === 'fulfill' ? 'Salida registrada en el Kardex' : 'Pedido cancelado y reservas liberadas');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo actualizar el pedido');
    }
  };

  const saveEmployee = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await request('/users', { method: 'POST', body: JSON.stringify({
        name: form.get('name'), email: form.get('email'), password: form.get('password'), role: 'employee'
      }) });
      setModal(null);
      setUsers(await request<UserEntry[]>('/users'));
      notify('Cuenta de empleado creada');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo crear el empleado');
    }
  };

  const toggleEmployee = async (employee: UserEntry) => {
    try {
      await request(`/users/${employee.id}/active`, {
        method: 'PATCH', body: JSON.stringify({ active: !employee.active })
      });
      setUsers(await request<UserEntry[]>('/users'));
      notify(employee.active ? 'Sesión del empleado desactivada' : 'Empleado reactivado');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo actualizar el empleado');
    }
  };

  const changePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      const result = await request<{ token: string }>('/auth/password', {
        method: 'PATCH',
        body: JSON.stringify({ currentPassword: form.get('currentPassword'), newPassword: form.get('newPassword') })
      });
      authToken = result.token;
      sessionStorage.setItem('stockflow.session', result.token);
      formElement.reset();
      notify('Contraseña actualizada');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo cambiar la contraseña');
    }
  };

  const createCatalogEntry = async (kind: 'categories' | 'suppliers', name: string): Promise<boolean> => {
    try {
      await request(`/${kind}`, { method: 'POST', body: JSON.stringify({ name }) });
      await refresh();
      notify(kind === 'categories' ? 'Categoría añadida' : 'Proveedor añadido');
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo guardar');
      return false;
    }
  };

  const deleteCatalogEntry = async (kind: 'categories' | 'suppliers', entry: CatalogOption): Promise<boolean> => {
    const label = kind === 'categories' ? 'categoría' : 'proveedor';
    const consequence = kind === 'categories'
      ? 'Los productos asociados quedarán sin categoría.'
      : 'Los productos asociados quedarán sin proveedor. No se pueden eliminar proveedores con pedidos de compra en el historial.';
    if (!window.confirm(`¿Eliminar ${label} «${entry.name}»? ${consequence}`)) return false;
    try {
      await request(`/${kind}/${entry.id}`, { method: 'DELETE' });
      await refresh();
      notify(kind === 'categories' ? 'Categoría eliminada' : 'Proveedor eliminado');
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : `No se pudo eliminar ${label}`);
      return false;
    }
  };

  const markEmployeeAlertsRead = async () => {
    try {
      await request('/admin/employee-movement-alerts/read', { method: 'POST' });
      setEmployeeMovementAlerts((current) => current.map((alert) => ({ ...alert, unread: false })));
      setUnreadEmployeeMovementAlerts(0);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudieron marcar las alertas como leídas');
    }
  };

  const pageTitle = page === 'settings' ? 'Configuración' : navItems.find((item) => item.id === page)?.label ?? 'Resumen';
  const operationalAlertCount = (overview?.lowStock.length ?? 0) + (overview?.expiring.length ?? 0);
  const notificationCount = operationalAlertCount + (isAdmin ? unreadEmployeeMovementAlerts : 0);
  return (
    <div className={`app-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark"><Boxes size={20} strokeWidth={2.2} /></div><span>stockflow<span className="brand-dot">.</span></span></div>
        <button className={`warehouse-switch ${warehouseOpen ? 'open' : ''}`} onClick={() => setWarehouseOpen((open) => !open)} aria-expanded={warehouseOpen}>
          <span className="warehouse-icon"><Building2 size={17} /></span><span className="warehouse-copy"><span className="overline">ALMACÉN ACTIVO</span><strong>{warehouses.find((warehouse) => warehouse.id === selectedWarehouseId)?.name ?? 'Cargando almacén…'}</strong></span><ChevronDown size={15} className="muted-icon" />
        </button>
        {warehouseOpen && <div className="warehouse-popover"><strong>Selecciona un almacén</strong>{warehouses.map((warehouse) => <div key={warehouse.id} className="warehouse-option">
          <button className={`warehouse-option-select ${selectedWarehouseId === warehouse.id ? 'active' : ''}`} onClick={() => {
            activeWarehouseId = warehouse.id;
            localStorage.setItem('stockflow.warehouse', warehouse.id);
            setSelectedWarehouseId(warehouse.id);
            setWarehouseOpen(false);
            void refresh();
          }}><Building2 size={14} /><span className="warehouse-option-name">{warehouse.name}</span><small>{warehouse.code}</small></button>
          {isAdmin && warehouses.length > 1 && <button className="warehouse-delete" title={`Eliminar ${warehouse.name}`} aria-label={`Eliminar almacén ${warehouse.name}`} onClick={() => void deleteWarehouse(warehouse)}><Trash2 size={14} /></button>}
        </div>)}{isAdmin && <button className="warehouse-add" onClick={() => { setWarehouseOpen(false); setModal('warehouse'); }}><Plus size={14} /> Añadir almacén</button>}<button onClick={() => { setWarehouseOpen(false); navigateToPage('map'); }}>Abrir mapa <ChevronRight size={13} /></button></div>}
        <div className="nav-heading">OPERACIONES</div>
        <nav className="nav-list">
          {navItems.map(({ id, label, icon: Icon }) => (
            <button key={id} className={`nav-item ${page === id ? 'selected' : ''}`} onClick={() => navigateToPage(id)}>
              <Icon size={18} strokeWidth={1.8} /><span>{label}</span>
              {id === 'inventory' && overview?.stats.low_stock ? <span className="nav-count">{overview.stats.low_stock}</span> : null}
              {id === 'assistant' && <span className="beta-tag">BETA</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sync-status"><span className="status-pulse" /><div><strong>Sistema operativo</strong><small>Sincronizado ahora</small></div></div>
          <button className={`nav-item ${page === 'settings' ? 'selected' : ''}`} onClick={() => navigateToPage('settings')}><Settings2 size={18} /><span>Configuración</span></button>
          <button className="profile" onClick={signOutFromEditor} title="Cerrar sesión para cambiar de cuenta" aria-label="Cerrar sesión para cambiar de cuenta">
            <div className="avatar">{initials(user.name)}</div>
            <div className="profile-copy"><strong>{user.name}</strong><small>{isAdmin ? 'Administrador' : 'Empleado'}</small></div>
            <LogOut size={16} className="muted-icon" />
          </button>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="topbar-leading">
            <button className="sidebar-toggle" aria-label={sidebarCollapsed ? 'Mostrar menú' : 'Ocultar menú'} title={sidebarCollapsed ? 'Mostrar menú' : 'Ocultar menú'} aria-expanded={!sidebarCollapsed} onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}><Menu size={18} /></button>
            <div className="breadcrumbs"><span>Almacén</span><ChevronRight size={14} /><strong>{pageTitle}</strong></div>
          </div>
          <div className="top-actions">
            <label className="global-search"><Search size={16} /><input ref={searchInputRef} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar SKU, producto..." /><kbd><Command size={11} /> K</kbd></label>
            <div className="notification-wrap"><button className="icon-button notification-button" aria-label="Notificaciones" aria-expanded={notificationsOpen} onClick={() => setNotificationsOpen((open) => !open)}><Bell size={18} />{notificationCount > 0 && <i />}</button>
              {notificationsOpen && <div className="notification-popover"><div className="notification-title"><strong>Notificaciones</strong><span>{notificationCount}</span></div>
                {(overview?.lowStock ?? []).slice(0, 3).map((product) => <button key={product.id} className="notification-item" onClick={() => { setNotificationsOpen(false); navigateToPage('inventory'); }}><span className="notification-alert" /><span><strong>Stock bajo</strong><small>{product.name} · {formatNumber(product.stock)} uds.</small></span><ChevronRight size={14} /></button>)}
                {(overview?.expiring ?? []).slice(0, 3).map((lot) => <button key={lot.lot_code} className="notification-item" onClick={() => { setNotificationsOpen(false); navigateToPage('inventory'); }}><span className="notification-alert expiry" /><span><strong>Caducidad próxima</strong><small>{lot.name} · {new Date(lot.expires_at).toLocaleDateString('es-ES')}</small></span><ChevronRight size={14} /></button>)}
                {isAdmin && employeeMovementAlerts.filter((alert) => alert.unread).slice(0, 3).map((alert) => <button key={alert.id} className="notification-item" onClick={() => { setNotificationsOpen(false); navigateToPage('settings'); }}><span className="notification-alert movement" /><span><strong>{movementNames[alert.type] ?? alert.type} · {alert.user_name}</strong><small>{alert.products} · {formatDate(alert.created_at)}</small></span><ChevronRight size={14} /></button>)}
                {!notificationCount && <div className="notification-empty"><ShieldCheck size={17} /> No tienes alertas pendientes</div>}
                {isAdmin && <button className="notification-view-all" onClick={() => { setNotificationsOpen(false); navigateToPage('settings'); }}>Ver alertas de movimientos <ChevronRight size={13} /></button>}
              </div>}
            </div>
            <button className="top-avatar top-avatar-button" onClick={() => navigateToPage('settings')} title="Perfil y configuración">{initials(user.name)}</button>
          </div>
        </header>

        <div className="page-content">
          {error && <div className="error-banner"><CircleHelp size={17} /><span>{error}. Comprueba que la API y PostgreSQL estén en ejecución.</span><button onClick={() => void refresh()}>Reintentar</button></div>}
          {loading && <div className="loading-line"><span /> Conectando con el almacén…</div>}
          {page === 'overview' && <OverviewPage overview={overview} movements={movements} onNavigate={navigateToPage} />}
          {page === 'inventory' && <InventoryPage products={visibleProducts} locations={locations} search={search} isAdmin={isAdmin} onAdd={() => { setEditingProduct(null); setModal('product'); }} onBulkReceipt={() => { setMovementError(''); setModal('bulkReceipt'); }} onEdit={(product) => { setEditingProduct(product); setModal('editProduct'); }} onMovement={() => { setMovementDefaults(null); setMovementError(''); setModal('movement'); }} onDelete={async (id) => {
            if (!window.confirm('¿Archivar este producto? No aparecerá en el catálogo activo.')) return;
            try { await request(`/products/${id}`, { method: 'DELETE' }); await refresh(); notify('Producto archivado'); }
            catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo archivar'); }
          }} />}
          {page === 'map' && warehouseMap && <MapPage products={products} locations={locations} racks={racks} warehouse={warehouseMap} aisles={aisles} selected={selectedLocation} initialRackId={qrRackId} isAdmin={isAdmin} onSelect={setSelectedLocation} onRefresh={refresh} onNotify={notify} onMoveStock={(location) => { setMovementDefaults({ type: isAdmin ? 'transfer' : 'in_use', fromBinId: location.id }); setMovementError(''); setModal('movement'); }} onSaveExpected={saveExpectedContent} onSaveLocationName={saveLocationName} onEditingChange={setMapEditing} />}
          {page === 'movements' && <MovementsPage movements={movements} onAdd={() => { setMovementDefaults(null); setMovementError(''); setModal('movement'); }} onExport={() => downloadCsv('movimientos.csv', [['Tipo', 'Referencia', 'Productos', 'Unidades', 'Fecha'], ...movements.map((item) => [movementNames[item.type] ?? item.type, item.reference, item.products, item.units, item.created_at])])} />}
          {page === 'purchasing' && <PurchasingPage suggestions={replenishment} orders={purchaseOrders} locations={locations} isAdmin={isAdmin} onCreateOrder={createPurchaseOrders} onReceiveOrder={receivePurchaseOrder} onCancelOrder={cancelPurchaseOrder} />}
          {page === 'salesOrders' && <SalesOrdersPage orders={salesOrders} products={products} locations={locations} isAdmin={isAdmin} onCreateOrder={createSalesOrder} onStartPicking={(id) => changeSalesOrder(id, 'picking')} onFulfill={(id) => changeSalesOrder(id, 'fulfill')} onCancelOrder={(id) => changeSalesOrder(id, 'cancel')} />}
          {page === 'assistant' && <AssistantPage />}
          {page === 'settings' && <SettingsPage user={user} users={users} categories={categories} suppliers={suppliers} employeeMovementAlerts={employeeMovementAlerts} unreadEmployeeMovementAlerts={unreadEmployeeMovementAlerts} isAdmin={isAdmin} onAddUser={() => setModal('employee')} onToggleUser={(entry) => void toggleEmployee(entry)} onChangePassword={changePassword} onCreateCatalogEntry={createCatalogEntry} onDeleteCatalogEntry={deleteCatalogEntry} onMarkEmployeeAlertsRead={() => void markEmployeeAlertsRead()} />}
        </div>
      </main>
      {modal && <Modal wide={modal === 'movement' || modal === 'bulkReceipt'} error={modal === 'movement' || modal === 'bulkReceipt' ? movementError : ''} title={modal === 'product' ? 'Añadir producto' : modal === 'editProduct' ? 'Editar producto' : modal === 'employee' ? 'Crear cuenta de empleado' : modal === 'warehouse' ? 'Añadir almacén' : modal === 'bulkReceipt' ? 'Entrada masiva desde CSV' : 'Registrar movimiento'} onClose={() => { setModal(null); setEditingProduct(null); setMovementDefaults(null); setMovementError(''); }}>
        {(modal === 'product' || modal === 'editProduct')
          ? <ProductForm initial={editingProduct} categories={categories} suppliers={suppliers} onSubmit={(event) => void saveProduct(event, editingProduct ?? undefined)} onCancel={() => { setModal(null); setEditingProduct(null); }} />
          : modal === 'employee'
            ? <EmployeeForm onSubmit={saveEmployee} onCancel={() => setModal(null)} />
        : modal === 'warehouse'
          ? <WarehouseForm onSubmit={saveWarehouse} onCancel={() => setModal(null)} />
        : modal === 'bulkReceipt'
          ? <BulkReceiptForm products={products} locations={locations} saving={movementSaving} onSubmit={(reference, lines) => void saveBulkReceipt(reference, lines)} onCancel={() => setModal(null)} />
          : <MovementForm key={`${movementDefaults?.type ?? 'receipt'}-${movementDefaults?.fromBinId ?? 'new'}`} products={products} locations={locations} racks={racks} warehouses={warehouses} inUseLoans={inUseLoans} currentWarehouseId={selectedWarehouseId ?? ''} isAdmin={isAdmin} initialType={movementDefaults?.type} initialFromBinId={movementDefaults?.fromBinId} saving={movementSaving} onSubmit={saveMovement} onCancel={() => { setModal(null); setMovementDefaults(null); setMovementError(''); }} />}
      </Modal>}
      {toast && <div className="toast"><Check size={17} />{toast}</div>}
    </div>
  );
}

function PageIntro({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: ReactNode }) {
  return <div className="page-intro"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div><div className="intro-actions">{actions}</div></div>;
}

function LoginPage({ onLogin, onRegister }: {
  onLogin: (email: string, password: string) => Promise<void>;
  onRegister: (name: string, email: string, password: string, confirmPassword: string) => Promise<void>;
}) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [registering, setRegistering] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const fromQr = ['rackId', 'locationId'].some((key) => new URLSearchParams(window.location.search).has(key));

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    if (registering && password !== confirmPassword) {
      setError('Las contraseñas no coinciden.');
      return;
    }
    setBusy(true);
    try {
      if (registering) await onRegister(name, email, password, confirmPassword);
      else await onLogin(email, password);
    } catch (reason) { setError(reason instanceof Error ? reason.message : registering ? 'No se pudo crear la cuenta' : 'No se pudo iniciar sesión'); }
    finally { setBusy(false); }
  };

  return <main className="login-page"><section className="login-card">
    <div className="login-brand"><div className="brand-mark"><Boxes size={21} /></div><span>stockflow<span className="brand-dot">.</span></span></div>
    <span className="eyebrow">{fromQr ? 'ACCESO A UBICACIÓN QR' : 'GESTIÓN INTELIGENTE DE ALMACÉN'}</span><h1>{registering ? 'Crear cuenta de empleado' : 'Bienvenido de nuevo'}</h1><p className="login-subtitle">{registering ? 'Crea tu cuenta para consultar y trabajar en el almacén.' : fromQr ? 'Inicia sesión o crea una cuenta para consultar esta estantería.' : 'Inicia sesión con tu correo y contraseña. El tipo de cuenta determina tus permisos.'}</p>
    <form className="form-grid login-form" onSubmit={(event) => void submit(event)}>
      {registering && <label>Nombre o apodo<input autoComplete="nickname" required minLength={2} maxLength={120} value={name} onChange={(event) => setName(event.target.value)} placeholder="Cómo te llamamos" /></label>}
      <label>Correo electrónico<input autoComplete="username" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="nombre@empresa.com" /></label>
      <label>Contraseña<input autoComplete={registering ? 'new-password' : 'current-password'} type="password" required minLength={registering ? 10 : undefined} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={registering ? 'Mínimo 10 caracteres' : 'Tu contraseña'} /></label>
      {registering && <label>Repite la contraseña<input autoComplete="new-password" type="password" required minLength={10} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="Escríbela de nuevo" /></label>}
      {error && <div className="login-error">{error}</div>}
      <button className="button button-primary login-submit" disabled={busy}>{busy ? registering ? 'Creando cuenta…' : 'Validando…' : <><LockKeyhole size={16} /> {registering ? 'Crear cuenta de empleado' : 'Iniciar sesión'}</>}</button>
    </form>
    <button type="button" className="login-mode-switch" onClick={() => { setRegistering((current) => !current); setError(''); setPassword(''); setConfirmPassword(''); }}>
      {registering ? '¿Ya tienes una cuenta? Iniciar sesión' : '¿No tienes cuenta? Crear cuenta de empleado'}
    </button>
    {!registering && <p className="login-admin-hint">Para entrar como administrador, inicia sesión con el correo y la contraseña de una cuenta administradora.</p>}
    {import.meta.env.DEV && !registering && <div className="demo-accounts"><strong>Cuentas de demostración</strong><button type="button" onClick={() => { setEmail('admin@stockflow.local'); setPassword('Stockflow2026!'); }}>Administrador <span>admin@stockflow.local</span></button><button type="button" onClick={() => { setEmail('empleado@stockflow.local'); setPassword('Empleado2026!'); }}>Empleado <span>empleado@stockflow.local</span></button><small>Cambia las contraseñas de demostración antes de usar datos reales.</small></div>}
  </section></main>;
}

function SettingsPage({ user, users, categories, suppliers, employeeMovementAlerts, unreadEmployeeMovementAlerts, isAdmin, onAddUser, onToggleUser, onChangePassword, onCreateCatalogEntry, onDeleteCatalogEntry, onMarkEmployeeAlertsRead }: {
  user: AuthUser; users: UserEntry[]; categories: CatalogOption[]; suppliers: CatalogOption[]; isAdmin: boolean; onAddUser: () => void;
  employeeMovementAlerts: EmployeeMovementAlert[]; unreadEmployeeMovementAlerts: number;
  onToggleUser: (user: UserEntry) => void; onChangePassword: (event: FormEvent<HTMLFormElement>) => void;
  onCreateCatalogEntry: (kind: 'categories' | 'suppliers', name: string) => Promise<boolean>;
  onDeleteCatalogEntry: (kind: 'categories' | 'suppliers', entry: CatalogOption) => Promise<boolean>;
  onMarkEmployeeAlertsRead: () => void;
}) {
  return <>
    <PageIntro eyebrow="CUENTA Y PERMISOS" title="Configuración" description="Gestiona tu sesión y los accesos del equipo al almacén." />
    <div className="settings-grid">
      <section className="panel settings-account"><div className="panel-heading"><div><h2>Sesión actual</h2><p>Acceso personal protegido por contraseña</p></div><span className={`role-chip ${user.role}`}>{isAdmin ? 'ADMINISTRADOR' : 'EMPLEADO'}</span></div>
        <div className="settings-user"><div className="settings-avatar">{initials(user.name)}</div><div><strong>{user.name}</strong><span>{user.email}</span></div><ShieldCheck size={18} /></div>
        <form className="form-grid password-form" onSubmit={onChangePassword}><div className="settings-section-title"><LockKeyhole size={16} /><strong>Cambiar contraseña</strong></div>
          <label>Contraseña actual<input name="currentPassword" type="password" required autoComplete="current-password" /></label>
          <label>Nueva contraseña <small>Mínimo 10 caracteres</small><input name="newPassword" type="password" required minLength={10} autoComplete="new-password" /></label>
          <div className="settings-form-actions"><button className="button button-primary"><Check size={15} /> Actualizar contraseña</button></div>
        </form>
      </section>
      {isAdmin && <section className="panel team-panel"><div className="panel-heading"><div><h2>Equipo del almacén</h2><p>Crea y administra cuentas de empleado.</p></div><button className="button button-primary" onClick={onAddUser}><UserPlus size={15} /> Añadir empleado</button></div>
        <div className="team-list">{users.map((entry) => <div className="team-row" key={entry.id}><div className={`settings-avatar small ${entry.role}`}>{initials(entry.name)}</div><div className="team-user"><strong>{entry.name}</strong><span>{entry.email}</span></div><span className={`team-role ${entry.role}`}>{entry.role === 'admin' ? 'Admin' : 'Empleado'}</span><span className={`team-status ${entry.active ? 'active' : 'inactive'}`}>{entry.active ? 'Activo' : 'Inactivo'}</span>{entry.role === 'employee' && <button className={`button ${entry.active ? 'button-secondary' : 'button-primary'} team-toggle`} onClick={() => onToggleUser(entry)}>{entry.active ? 'Desactivar' : 'Activar'}</button>}</div>)}
          {!users.length && <div className="table-empty">Cargando usuarios…</div>}</div>
        <div className="team-footnote"><ShieldCheck size={14} /> Desactivar una cuenta cierra también las sesiones abiertas.</div>
      </section>}
      {isAdmin && <EmployeeMovementAlerts alerts={employeeMovementAlerts} unreadCount={unreadEmployeeMovementAlerts} onMarkRead={onMarkEmployeeAlertsRead} />}
      {isAdmin && <CatalogManagement categories={categories} suppliers={suppliers} onCreate={onCreateCatalogEntry} onDelete={onDeleteCatalogEntry} />}
      {!isAdmin && <section className="panel employee-permissions"><div className="settings-section-title"><Users size={16} /><strong>Permisos del empleado</strong></div><p>Puedes consultar el inventario, registrar movimientos, explorar el mapa y utilizar el asistente. La configuración de productos y estanterías está reservada a administradores.</p></section>}
    </div>
  </>;
}

function EmployeeMovementAlerts({ alerts, unreadCount, onMarkRead }: {
  alerts: EmployeeMovementAlert[]; unreadCount: number; onMarkRead: () => void;
}) {
  return <section className="panel employee-alerts">
    <div className="panel-heading"><div><h2>Alertas de movimientos</h2><p>Movimientos registrados por empleados, con autor y fecha.</p></div>
      {unreadCount > 0 && <button className="button button-secondary" onClick={onMarkRead}>Marcar como leídas ({unreadCount})</button>}
    </div>
    {!alerts.length
      ? <div className="table-empty">Todavía no hay movimientos de empleados.</div>
      : <div className="employee-alert-list">{alerts.map((alert) => <article className={`employee-alert-row ${alert.unread ? 'unread' : ''}`} key={alert.id}>
        <span className="employee-alert-type">{movementNames[alert.type] ?? alert.type}</span>
        <div className="employee-alert-description"><strong>{alert.products}</strong><small>{alert.reference ? `Referencia ${alert.reference} · ` : ''}{formatNumber(alert.units)} uds.</small></div>
        <div className="employee-alert-user"><strong>{alert.user_name}</strong><small>{alert.user_email}</small></div>
        <time dateTime={alert.created_at}>{formatDate(alert.created_at)}</time>
      </article>)}</div>}
    <div className="team-footnote"><Bell size={14} /> Se actualiza automáticamente cada 30 segundos. Se muestran hasta 100 movimientos.</div>
  </section>;
}

function CatalogManagement({ categories, suppliers, onCreate, onDelete }: {
  categories: CatalogOption[]; suppliers: CatalogOption[];
  onCreate: (kind: 'categories' | 'suppliers', name: string) => Promise<boolean>;
  onDelete: (kind: 'categories' | 'suppliers', entry: CatalogOption) => Promise<boolean>;
}) {
  const [categoryName, setCategoryName] = useState('');
  const [supplierName, setSupplierName] = useState('');
  const [saving, setSaving] = useState<'categories' | 'suppliers' | ''>('');
  const [deleting, setDeleting] = useState('');

  const submit = async (event: FormEvent<HTMLFormElement>, kind: 'categories' | 'suppliers', name: string) => {
    event.preventDefault();
    setSaving(kind);
    try {
      if (await onCreate(kind, name.trim())) {
        if (kind === 'categories') setCategoryName('');
        else setSupplierName('');
      }
    } finally {
      setSaving('');
    }
  };

  const remove = async (kind: 'categories' | 'suppliers', entry: CatalogOption) => {
    setDeleting(entry.id);
    try {
      await onDelete(kind, entry);
    } finally {
      setDeleting('');
    }
  };

  return <section className="panel catalog-management">
    <div className="panel-heading"><div><h2>Categorías y proveedores</h2><p>Administra las opciones disponibles al crear o editar productos.</p></div></div>
    <div className="catalog-management-columns">
      {([
        { kind: 'categories' as const, title: 'Categorías', items: categories, name: categoryName, setName: setCategoryName },
        { kind: 'suppliers' as const, title: 'Proveedores', items: suppliers, name: supplierName, setName: setSupplierName }
      ]).map(({ kind, title, items, name, setName }) => <div className="catalog-management-group" key={kind}>
        <h3>{title}<span>{items.length}</span></h3>
        <form className="catalog-add-form" onSubmit={(event) => void submit(event, kind, name)}>
          <input required minLength={2} maxLength={120} value={name} onChange={(event) => setName(event.target.value)} placeholder={`Nueva ${kind === 'categories' ? 'categoría' : 'proveedor'}`} aria-label={`Nombre de ${kind === 'categories' ? 'categoría' : 'proveedor'}`} />
          <button type="submit" className="button button-primary" disabled={saving === kind || name.trim().length < 2}>{saving === kind ? 'Guardando…' : <><Plus size={14} /> Añadir</>}</button>
        </form>
        <div className="catalog-entry-list">{items.map((entry) => <div className="catalog-entry" key={entry.id}>
          <span>{entry.name}</span>
          <button type="button" className="button button-secondary catalog-delete" disabled={deleting === entry.id} onClick={() => void remove(kind, entry)}>{deleting === entry.id ? '…' : 'Eliminar'}</button>
        </div>)}
          {!items.length && <p className="catalog-empty">Todavía no hay {kind === 'categories' ? 'categorías' : 'proveedores'}.</p>}
        </div>
      </div>)}
    </div>
  </section>;
}

function EmployeeForm({ onSubmit, onCancel }: { onSubmit: (event: FormEvent<HTMLFormElement>) => void; onCancel: () => void }) {
  return <form className="form-grid" onSubmit={onSubmit}>
    <label>Nombre completo<input name="name" required minLength={2} maxLength={120} placeholder="Nombre del empleado" /></label>
    <label>Correo electrónico<input name="email" type="email" required placeholder="empleado@empresa.com" /></label>
    <label>Contraseña inicial<input name="password" type="password" required minLength={10} autoComplete="new-password" placeholder="Al menos 10 caracteres" /></label>
    <div className="form-hint">Se creará una cuenta de empleado. Podrá cambiar su contraseña desde Configuración.</div>
    <div className="form-actions"><button type="button" className="button button-secondary" onClick={onCancel}>Cancelar</button><button className="button button-primary"><UserPlus size={16} /> Crear empleado</button></div>
  </form>;
}

function WarehouseForm({ onSubmit, onCancel }: { onSubmit: (event: FormEvent<HTMLFormElement>) => void; onCancel: () => void }) {
  return <form className="form-grid" onSubmit={onSubmit}>
    <p className="form-hint">Cada almacén tendrá su propio mapa y sus propias existencias. El catálogo de productos se comparte para poder transferir mercancía.</p>
    <label>Nombre del almacén<input name="name" required minLength={2} maxLength={120} placeholder="Ej. Almacén de Valencia" /></label>
    <label>Código interno<input name="code" required minLength={2} maxLength={24} pattern="[A-Za-z0-9-]+" placeholder="Ej. VAL-01" /></label>
    <div className="form-actions"><button type="button" className="button button-secondary" onClick={onCancel}>Cancelar</button><button className="button button-primary"><Building2 size={16} /> Crear almacén</button></div>
  </form>;
}

function RackConfigForm({ rack, onChange, onDelete }: {
  rack: Rack; onChange: (field: string, value: string | number) => void; onDelete: () => void
}) {
  const maximumBins = Math.max(rack.bins_per_level, Math.min(
    maxRackBinsForWidth(number(rack.map_width)),
    Math.floor(100 / (rack.level_count * rack.depth_slots))
  ));
  const maximumDepthSlots = Math.max(rack.depth_slots, maxRackDepthSlots(rack.level_count, rack.bins_per_level, number(rack.map_height)));
  const minimumDepth = Math.max(130, Math.ceil(rack.depth_slots * 20 / 0.72));
  const maximumLevels = Math.max(rack.level_count, Math.min(12, Math.floor(100 / (rack.bins_per_level * rack.depth_slots))));
  const totalHeight = calculateRackHeightCm(rack.level_heights.map(number));
  return <div className="rack-config-form">
    <label>Nombre<input required minLength={2} maxLength={100} value={rack.name} onChange={(event) => onChange('name', event.target.value)} /></label>
    <label>Código<input required pattern="[A-Za-z0-9-]{2,24}" value={rack.code} onChange={(event) => onChange('code', event.target.value.toUpperCase())} /></label>
    <div className="form-row"><label>Niveles<input type="number" min={rack.level_count} max={maximumLevels} value={rack.level_count} onChange={(event) => onChange('level_count', Number(event.target.value))} /></label><label>Huecos / nivel<input type="number" min={rack.bins_per_level} max={maximumBins} value={rack.bins_per_level} onChange={(event) => onChange('bins_per_level', Number(event.target.value))} /></label></div>
    <div className="form-row"><label>Ancho (cm)<input type="number" min={Math.min(220, number(rack.map_width))} max="2000" step="10" value={number(rack.map_width)} onChange={(event) => onChange('map_width', Number(event.target.value))} /><small className="field-help">Mínimo: {Math.min(220, number(rack.map_width))} cm · Máximo: 2000 cm.</small></label><label>Fondo (cm)<input type="number" min={minimumDepth} max="1200" step="10" value={number(rack.map_height)} onChange={(event) => onChange('map_height', Number(event.target.value))} /><small className="field-help">Mínimo: {minimumDepth} cm · Máximo: 1200 cm.</small></label></div>
    <label>Huecos de fondo<input type="number" min={rack.depth_slots} max={maximumDepthSlots} value={rack.depth_slots} onChange={(event) => onChange('depth_slots', Number(event.target.value))} /></label>
    <div className="rack-level-heights"><strong>Separación vertical de cada nivel</strong><span>Altura total: {totalHeight} cm · máximo 1200 cm</span>{rack.level_heights.map((height, index) => <label key={index}>Nivel {index + 1} (cm)<input type="number" min="30" max="1000" value={number(height)} onChange={(event) => onChange(`height_${index}`, Number(event.target.value))} /></label>)}</div>
    <small className="rack-config-note">Los niveles y huecos con historial no se pueden reducir ni eliminar.</small>
    <button className="button button-danger full-button" onClick={onDelete}><Archive size={15} /> Eliminar estantería</button>
  </div>;
}

function OverviewPage({ overview, movements, onNavigate }: { overview: Overview | null; movements: Movement[]; onNavigate: (page: Page) => void }) {
  const stats = overview?.stats;
  return <>
    <PageIntro eyebrow={todayLabel()} title="Buenos días, Alex 👋" description="Aquí tienes lo que está pasando hoy en tu almacén." actions={<button className="button button-primary" onClick={() => onNavigate('movements')}><Plus size={17} /> Nuevo movimiento</button>} />
    <section className="stats-grid">
      <StatCard label="Referencias activas" value={formatNumber(stats?.products ?? 0)} note="en catálogo" icon={<Package size={18} />} tone="green" />
      <StatCard label="Unidades en stock" value={formatNumber(stats?.units ?? 0)} note="en todo el almacén" icon={<Boxes size={18} />} tone="blue" />
      <StatCard label="Ubicaciones" value={formatNumber(stats?.locations ?? 0)} note="posiciones activas" icon={<Map size={18} />} tone="purple" />
      <StatCard label="Stock bajo" value={formatNumber(stats?.low_stock ?? 0)} note="requieren atención" icon={<Activity size={18} />} tone="orange" alert={number(stats?.low_stock) > 0} />
    </section>
    <div className="dashboard-grid">
      <section className="panel activity-panel">
        <div className="panel-heading"><div><h2>Actividad reciente</h2><p>Últimos movimientos registrados</p></div><button className="text-button" onClick={() => onNavigate('movements')}>Ver todo <ChevronRight size={15} /></button></div>
        <MovementTable movements={movements.slice(0, 5)} />
      </section>
      <section className="panel attention-panel">
        <div className="panel-heading"><div><h2>Necesita atención</h2><p>Prioridades de tu almacén</p></div><span className="attention-count">{(overview?.lowStock.length ?? 0) + (overview?.expiring.length ?? 0)}</span></div>
        <div className="attention-list">
          {(overview?.lowStock ?? []).slice(0, 3).map((p) => <div className="attention-row" key={p.id}><div className="attention-icon orange"><Package size={16} /></div><div className="attention-copy"><strong>Stock bajo</strong><span>{p.name}</span></div><span className="attention-value">{formatNumber(p.stock)} / {formatNumber(p.min_stock)}</span></div>)}
          {(overview?.expiring ?? []).slice(0, 2).map((lot) => <div className="attention-row" key={lot.lot_code}><div className="attention-icon yellow"><CalendarClock size={16} /></div><div className="attention-copy"><strong>Próxima caducidad</strong><span>{lot.name} · lote {lot.lot_code}</span></div><span className="attention-value">{new Date(lot.expires_at).toLocaleDateString('es-ES')}</span></div>)}
          {!overview?.lowStock.length && !overview?.expiring.length && <div className="empty-inline"><ShieldCheck size={20} /> Todo bajo control. No hay alertas activas.</div>}
        </div>
        <button className="attention-link" onClick={() => onNavigate('inventory')}>Revisar inventario <ChevronRight size={15} /></button>
      </section>
    </div>
    <section className="quick-actions">
      <div><span className="eyebrow">ACCESOS RÁPIDOS</span><h2>¿Qué necesitas hacer?</h2></div>
      <button className="quick-card" onClick={() => onNavigate('inventory')}><div className="quick-icon green"><Package size={19} /></div><span><strong>Consultar stock</strong><small>Busca productos y ubicaciones</small></span><ChevronRight size={17} /></button>
      <button className="quick-card" onClick={() => onNavigate('map')}><div className="quick-icon blue"><Map size={19} /></div><span><strong>Ver mapa del almacén</strong><small>Explora tus ubicaciones</small></span><ChevronRight size={17} /></button>
      <button className="quick-card" onClick={() => onNavigate('assistant')}><div className="quick-icon purple"><Sparkles size={19} /></div><span><strong>Preguntar al asistente</strong><small>Resuelve dudas en segundos</small></span><ChevronRight size={17} /></button>
    </section>
  </>;
}

function StatCard({ label, value, note, icon, tone, alert }: { label: string; value: string; note: string; icon: ReactNode; tone: string; alert?: boolean }) {
  return <div className="stat-card"><div className={`stat-icon ${tone}`}>{icon}</div><span className="stat-label">{label}</span><div className="stat-value">{value}{alert && <span className="stat-alert">Atención</span>}</div><span className="stat-note">{note}</span></div>;
}

function MovementTable({ movements }: { movements: Movement[] }) {
  if (!movements.length) return <div className="table-empty">Aún no hay movimientos registrados.</div>;
  return <div className="table-wrap"><table><thead><tr><th>TIPO</th><th>REFERENCIA / PRODUCTO</th><th>UNIDADES</th><th>FECHA</th></tr></thead><tbody>
    {movements.map((m) => {
      const incoming = m.type === 'receipt' || m.type === 'return';
      const outgoing = m.type === 'dispatch' || m.type === 'in_use';
      return <tr key={m.id}><td><span className={`movement-type ${incoming ? 'incoming' : outgoing ? 'outgoing' : 'neutral'}`}>{incoming ? <ArrowDownLeft size={14} /> : outgoing ? <ArrowUpRight size={14} /> : <ArrowLeftRight size={14} />}{movementNames[m.type] ?? m.type}</span></td><td><strong className="table-primary">{m.reference || m.products}</strong><span className="table-secondary">{m.reference ? m.products : `ID ${m.id.slice(0, 8)}`}</span></td><td className="unit-value">{incoming ? '+' : outgoing ? '−' : ''}{formatNumber(m.units)}</td><td className="date-value">{formatDate(m.created_at)}</td></tr>;
    })}
  </tbody></table></div>;
}

function InventoryPage({ products, locations, search, isAdmin, onAdd, onBulkReceipt, onEdit, onMovement, onDelete }: { products: Product[]; locations: Location[]; search: string; isAdmin: boolean; onAdd: () => void; onBulkReceipt: () => void; onEdit: (product: Product) => void; onMovement: () => void; onDelete: (id: string) => void }) {
  const [filter, setFilter] = useState('Todos');
  const filtered = products.filter((p) => filter === 'Todos' || (filter === 'Stock bajo' ? number(p.stock) - number(p.reserved) <= number(p.min_stock) : filter === 'En stock' ? number(p.stock) - number(p.reserved) > number(p.min_stock) : true));
  return <>
    <PageIntro eyebrow="CONTROL DE EXISTENCIAS" title="Inventario" description="Consulta el catálogo propio de este almacén, sus existencias y alertas de reposición." actions={<><button className="button button-secondary" onClick={onMovement}><ArrowLeftRight size={16} /> Movimiento</button>{isAdmin && <><button className="button button-secondary" onClick={onBulkReceipt}><Upload size={15} /> Carga masiva CSV</button><button className="button button-primary" onClick={onAdd}><Plus size={17} /> Añadir producto</button></>}</>} />
    <section className="panel inventory-panel">
      <div className="inventory-toolbar"><div className="filter-tabs">{['Todos', 'En stock', 'Stock bajo'].map((f) => <button key={f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>{f}{f === 'Stock bajo' && <span className="filter-count">{products.filter((p) => number(p.stock) - number(p.reserved) <= number(p.min_stock)).length}</span>}</button>)}</div><div className="inventory-tools"><span>{search ? `${filtered.length} resultados` : `${filtered.length} productos`}</span><button className="icon-button" aria-label="Descargar inventario" title="Descargar CSV" onClick={() => downloadCsv('inventario.csv', [['SKU', 'Producto', 'Categoría', 'Proveedor', 'Stock', 'Reservado', 'Mínimo', 'Ubicación'], ...filtered.map((p) => [p.sku, p.name, p.category, p.supplier, p.stock, p.reserved, p.min_stock, locations.find((bin) => bin.products.some((stock) => stock.productId === p.id))?.code ?? ''])])}><Download size={17} /></button></div></div>
      <div className="table-wrap inventory-table"><table><thead><tr><th>PRODUCTO</th><th>CATEGORÍA</th><th>SKU / CÓDIGO</th><th>STOCK DISPONIBLE</th><th>UBICACIÓN</th><th>ESTADO</th><th /></tr></thead><tbody>
        {filtered.map((p, index) => {
          const low = number(p.stock) - number(p.reserved) <= number(p.min_stock);
          const location = locations.find((bin) => bin.products.some((stock) => stock.productId === p.id));
          return <tr key={p.id}><td><div className="product-cell"><div className={`product-thumb thumb-${index % 5}`}><Package size={18} /></div><span><strong>{p.name}</strong><small>{p.supplier ?? 'Sin proveedor'}</small></span></div></td><td><span className="category-chip">{p.category ?? 'Sin categoría'}</span></td><td><strong className="sku-text">{p.sku}</strong><small className="barcode-text">{p.barcode ?? '—'}</small></td><td><strong className="stock-number">{formatNumber(number(p.stock) - number(p.reserved))}</strong><small className="barcode-text">Mín. {formatNumber(p.min_stock)} {p.unit_of_measure}</small></td><td><span className="location-code" title={location ? locationLabel(location) : ''}><Map size={13} />{location ? locationLabel(location) : 'Sin ubicación'}</span></td><td><span className={`stock-status ${low ? 'low' : 'healthy'}`}><i />{low ? 'Stock bajo' : 'En stock'}</span></td><td>{isAdmin && <div className="row-actions"><button className="row-menu" title="Editar producto" aria-label={`Editar ${p.name}`} onClick={() => onEdit(p)}><Pencil size={14} /></button><button className="row-menu archive-action" title="Archivar producto" aria-label={`Archivar ${p.name}`} onClick={() => onDelete(p.id)}><Archive size={14} /></button></div>}</td></tr>;
        })}
        {!filtered.length && <tr><td colSpan={7} className="table-empty">{search ? 'No se encontraron productos.' : 'No hay productos en esta vista.'}</td></tr>}
      </tbody></table></div>
      <div className="table-footer"><span>Mostrando <strong>{filtered.length}</strong> de <strong>{products.length}</strong> referencias</span><span>Inventario actualizado en tiempo real</span></div>
    </section>
  </>;
}

type RackCreationValues = {
  aisleId: string; name: string; code: string; width: number; depth: number;
  binsPerLevel: number; depthSlots: number; levelHeights: number[];
};

const RACK_BASE_HEIGHT_CM = 12;
const RACK_TOP_CLEARANCE_CM = 10;
const RACK_MAX_BOX_HEIGHT_CM = 62;
const RACK_MIN_LEVEL_SPACING_CM = 30;
const RACK_MAX_HEIGHT_CM = 1200;

function calculateRackHeightCm(levelHeights: number[]) {
  const lastLevel = levelHeights.at(-1) ?? 0;
  const boxHeight = Math.min(RACK_MAX_BOX_HEIGHT_CM, Math.max(12, lastLevel * 0.65));
  return Math.round(RACK_BASE_HEIGHT_CM + levelHeights.reduce((sum, height) => sum + height, 0) + boxHeight + RACK_TOP_CLEARANCE_CM);
}

function getMinimumRackHeightCm(levelCount: number) {
  return RACK_BASE_HEIGHT_CM + RACK_TOP_CLEARANCE_CM +
    levelCount * RACK_MIN_LEVEL_SPACING_CM + RACK_MIN_LEVEL_SPACING_CM * 0.65;
}

function getMaximumRackHeightCm(levelCount: number) {
  return Math.min(RACK_MAX_HEIGHT_CM, RACK_BASE_HEIGHT_CM + RACK_TOP_CLEARANCE_CM +
    levelCount * 1000 + RACK_MAX_BOX_HEIGHT_CM);
}

function makeRackLevelHeights(totalHeightCm: number, levelCount: number) {
  const minimum = Math.ceil(getMinimumRackHeightCm(levelCount));
  const maximum = getMaximumRackHeightCm(levelCount);
  const total = Math.max(minimum, Math.min(maximum, Math.round(totalHeightCm)));
  if (levelCount === 1) {
    const spacing = total <= RACK_BASE_HEIGHT_CM + RACK_TOP_CLEARANCE_CM + 96 + RACK_MAX_BOX_HEIGHT_CM
      ? (total - RACK_BASE_HEIGHT_CM - RACK_TOP_CLEARANCE_CM) / 1.65
      : total - RACK_BASE_HEIGHT_CM - RACK_TOP_CLEARANCE_CM - RACK_MAX_BOX_HEIGHT_CM;
    return [Math.max(RACK_MIN_LEVEL_SPACING_CM, Math.min(1000, spacing))];
  }
  const usableHeight = total - RACK_BASE_HEIGHT_CM - RACK_TOP_CLEARANCE_CM;
  let spacing = usableHeight / (levelCount + 0.65);
  if (spacing * 0.65 > RACK_MAX_BOX_HEIGHT_CM)
    spacing = (usableHeight - RACK_MAX_BOX_HEIGHT_CM) / levelCount;
  const wholeSpacing = Math.floor(spacing);
  const remainingCm = Math.round(spacing * levelCount) - wholeSpacing * levelCount;
  const levelHeights = Array.from({ length: levelCount }, (_value, index) => wholeSpacing + (index < remainingCm ? 1 : 0));
  levelHeights[0] += total - calculateRackHeightCm(levelHeights);
  return levelHeights;
}

function maxRackBinsForWidth(widthCm: number) {
  return Math.max(1, Math.min(12, Math.floor((widthCm - 44) / 38)));
}

function maxRackDepthSlots(levelCount: number, binsPerLevel: number, depthCm: number) {
  return Math.max(1, Math.min(12, Math.floor(depthCm * 0.72 / 20), Math.floor(100 / (levelCount * binsPerLevel))));
}

function RackCreationForm({ initialAisleId, initialWidth, initialDepth, maxWidth, maxDepth, existingCodes, onSubmit, onCancel }: {
  initialAisleId: string; initialWidth: number; initialDepth: number; maxWidth: number; maxDepth: number;
  existingCodes: string[]; onSubmit: (values: RackCreationValues) => void; onCancel: () => void
}) {
  const aisleId = initialAisleId;
  const [levelCount, setLevelCount] = useState(3);
  const [levelHeights, setLevelHeights] = useState(() => makeRackLevelHeights(240, 3));
  const [rackHeightInput, setRackHeightInput] = useState(() => String(calculateRackHeightCm(makeRackLevelHeights(240, 3))));
  const [rackWidth, setRackWidth] = useState(initialWidth);
  const [rackDepth, setRackDepth] = useState(initialDepth);
  const [binsPerLevel, setBinsPerLevel] = useState(Math.min(4, maxRackBinsForWidth(initialWidth)));
  const [depthSlots, setDepthSlots] = useState(1);
  const maximumDepthSlots = maxRackDepthSlots(levelCount, binsPerLevel, rackDepth);
  const maximumBinsPerLevel = Math.max(1, Math.min(
    maxRackBinsForWidth(rackWidth),
    Math.floor(100 / (levelCount * depthSlots))
  ));
  const [codeError, setCodeError] = useState('');
  const [dimensionError, setDimensionError] = useState('');
  const [code, setCode] = useState(() => {
    let suffix = 1;
    let candidate = 'R-01';
    while (existingCodes.includes(candidate)) {
      suffix += 1;
      candidate = `R-${String(suffix).padStart(2, '0')}`;
    }
    return candidate;
  });

  const changeLevelCount = (value: number) => {
    const count = Math.max(1, Math.min(12, value));
    const nextBinsPerLevel = Math.min(binsPerLevel, Math.max(1, Math.floor(100 / (count * depthSlots))));
    const totalHeight = Number(rackHeightInput) || calculateRackHeightCm(levelHeights);
    const nextLevelHeights = makeRackLevelHeights(totalHeight, count);
    setLevelCount(count);
    setBinsPerLevel(nextBinsPerLevel);
    setLevelHeights(nextLevelHeights);
    setRackHeightInput(String(calculateRackHeightCm(nextLevelHeights)));
    setDepthSlots((current) => Math.min(current, maxRackDepthSlots(count, nextBinsPerLevel, rackDepth)));
  };

  return <form className="rack-wizard-form" onSubmit={(event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const rackCode = String(form.get('code')).trim().toUpperCase();
    const requestedHeight = Number(rackHeightInput);
    const minimumHeight = Math.ceil(getMinimumRackHeightCm(levelCount));
    const maximumHeight = getMaximumRackHeightCm(levelCount);
    if (existingCodes.some((existingCode) => existingCode.toUpperCase() === rackCode)) {
      setCodeError('Ya existe una estantería con este código.');
      return;
    }
    if (!Number.isFinite(requestedHeight) || requestedHeight < minimumHeight || requestedHeight > maximumHeight) {
      setDimensionError(`La altura total debe estar entre ${minimumHeight} y ${maximumHeight} cm.`);
      return;
    }
    const submittedLevelHeights = makeRackLevelHeights(requestedHeight, levelCount);
    const submittedHeight = calculateRackHeightCm(submittedLevelHeights);
    setLevelHeights(submittedLevelHeights);
    setRackHeightInput(String(submittedHeight));
    setCodeError('');
    setDimensionError('');
    onSubmit({
      aisleId,
      name: String(form.get('name')).trim(),
      code: rackCode,
      width: Number(form.get('width')),
      depth: rackDepth,
      binsPerLevel: Number(form.get('binsPerLevel')),
      depthSlots,
      levelHeights: submittedLevelHeights
    });
  }}>
    <p className="rack-wizard-intro">Configura la estructura y el espacio útil. La estantería aparecerá en 3D al crearla.</p>
    <div className="form-row"><label>Nombre<input name="name" required minLength={2} maxLength={100} defaultValue="Estantería nueva" /></label><label>Código<input name="code" required pattern="[A-Za-z0-9-]{2,24}" value={code} onChange={(event) => { setCode(event.target.value.toUpperCase()); setCodeError(''); }} />{codeError && <small className="rack-form-error">{codeError}</small>}</label></div>
    <div className="form-row"><label>Ancho (cm)<input name="width" type="number" min="220" max={maxWidth} step="10" value={rackWidth} onChange={(event) => {
      const width = Number(event.target.value);
      const nextBinsPerLevel = Math.min(binsPerLevel, maxRackBinsForWidth(width));
      setRackWidth(width);
      setBinsPerLevel(nextBinsPerLevel);
      setDepthSlots((current) => Math.min(current, maxRackDepthSlots(levelCount, nextBinsPerLevel, rackDepth)));
    }} required /><small className="field-help">Mínimo: 220 cm · Máximo: {maxWidth} cm.</small></label><label>Fondo (cm)<input name="depth" type="number" min={Math.max(130, Math.ceil(depthSlots * 20 / 0.72))} max={maxDepth} step="10" value={rackDepth} onChange={(event) => {
      const depth = Number(event.target.value);
      setRackDepth(depth);
      setDepthSlots((current) => Math.min(current, maxRackDepthSlots(levelCount, binsPerLevel, depth)));
    }} required /><small className="field-help">Mínimo: {Math.max(130, Math.ceil(depthSlots * 20 / 0.72))} cm · Máximo: {maxDepth} cm.</small></label></div>
    <div className="form-row"><label>Número de niveles<input type="number" min="1" max="12" value={levelCount} onChange={(event) => changeLevelCount(Number(event.target.value))} required /><small className="field-help">Mínimo: 1 · Máximo: 12 niveles.</small></label><label>Huecos por nivel<input name="binsPerLevel" type="number" min="1" max={maximumBinsPerLevel} value={binsPerLevel} onChange={(event) => {
      const nextBinsPerLevel = Math.max(1, Math.min(maximumBinsPerLevel, Number(event.target.value)));
      setBinsPerLevel(nextBinsPerLevel);
      setDepthSlots((current) => Math.min(current, maxRackDepthSlots(levelCount, nextBinsPerLevel, rackDepth)));
    }} required /></label></div>
    <div className="form-row"><label>Huecos de fondo<input name="depthSlots" type="number" min="1" max={maximumDepthSlots} value={depthSlots} onChange={(event) => setDepthSlots(Math.max(1, Math.min(maximumDepthSlots, Number(event.target.value))))} required /><small className="field-help">Máximo: {maximumDepthSlots} filas por nivel · 100 ubicaciones por estantería.</small></label><label>Altura total (cm)<input type="number" min={Math.ceil(getMinimumRackHeightCm(levelCount))} max={getMaximumRackHeightCm(levelCount)} value={rackHeightInput} onChange={(event) => {
      const value = event.target.value;
      setRackHeightInput(value);
      if (value !== '' && Number.isFinite(Number(value)))
        setLevelHeights(makeRackLevelHeights(Number(value), levelCount));
    }} onBlur={() => {
      const value = Number(rackHeightInput);
      const nextLevelHeights = Number.isFinite(value)
        ? makeRackLevelHeights(value, levelCount)
        : levelHeights;
      setLevelHeights(nextLevelHeights);
      setRackHeightInput(String(calculateRackHeightCm(nextLevelHeights)));
    }} required /><small className="field-help">Mínimo: {Math.ceil(getMinimumRackHeightCm(levelCount))} cm · Máximo: {getMaximumRackHeightCm(levelCount)} cm. Los niveles se reparten dentro de esta altura.</small></label></div>
    {dimensionError && <small className="rack-form-error">{dimensionError}</small>}
    <div className="rack-wizard-levels"><strong>Separación vertical de cada nivel</strong><span>Se calcula desde la altura total; puedes ajustar cada balda.</span>{levelHeights.map((height, index) => <label key={index}><span>Nivel {index + 1}</span><input type="number" min={RACK_MIN_LEVEL_SPACING_CM} max="1000" value={height} onChange={(event) => {
      const nextLevelHeights = levelHeights.map((item, position) => position === index ? Number(event.target.value) : item);
      setLevelHeights(nextLevelHeights);
      setRackHeightInput(String(calculateRackHeightCm(nextLevelHeights)));
    }} required /><small>cm</small></label>)}</div>
    <div className="form-actions"><button type="button" className="button button-secondary" onClick={onCancel}>Cancelar</button><button className="button button-primary"><Layers size={15} /> Crear estantería 3D</button></div>
  </form>;
}

function Rack3DView({ rack, locations, selected, products, warehouseId, isAdmin, editing, saving, onBack, onSelect, onMoveStock, onSaveExpected, onSaveLocationName, onChange, onDelete, onSave, onDiscard }: {
  rack: Rack; locations: Location[]; selected: Location | null; products: Product[]; warehouseId: string;
  isAdmin: boolean; editing: boolean; saving: boolean;
  onBack: () => void; onSelect: (location: Location | null) => void;
  onMoveStock: (location: Location) => void;
  onSaveExpected: (locationId: string, expected: { productId: string; quantity: number }[]) => Promise<boolean>;
  onSaveLocationName: (locationId: string, displayName: string | null) => Promise<boolean>;
  onChange: (field: string, value: string | number) => void;
  onDelete: () => void; onSave: () => void; onDiscard: () => void
}) {
  const showExpectedContent = false; // Temporarily disabled; keep the comparison available to re-enable later.
  const [editingExpectedLocationId, setEditingExpectedLocationId] = useState<string | null>(null);
  const [qrLabelsOpen, setQrLabelsOpen] = useState(false);
  const [nameSaving, setNameSaving] = useState(false);
  const [displayName, setDisplayName] = useState(selected?.display_name ?? '');
  useEffect(() => {
    setEditingExpectedLocationId(null);
  }, [rack.id, selected?.level_number]);
  const currentBin = selected?.rack_id === rack.id ? selected : null;
  useEffect(() => {
    setDisplayName(currentBin?.display_name ?? '');
  }, [currentBin?.id, currentBin?.display_name]);

  return <>
    <PageIntro eyebrow="VISTA 3D" title={rack.name} description={`${rack.level_count} niveles · ${rack.bins_per_level} huecos por nivel`} actions={<>
      {editing && <><button className="button button-secondary" disabled={saving} onClick={onDiscard}>Descartar cambios</button><button className="button button-primary" disabled={saving} onClick={onSave}><Check size={15} />{saving ? 'Guardando…' : 'Guardar y salir'}</button></>}
      {!editing && isAdmin && <button className="button button-secondary" onClick={() => setQrLabelsOpen(true)}><QrCode size={15} /> Imprimir etiquetas QR</button>}
      <button className="button button-secondary" onClick={onBack}><ArrowLeft size={15} /> {editing ? 'Volver al editor 2D' : 'Volver al mapa 2D'}</button>
    </>} />
    <section className="rack3d-layout">
      <div className="panel rack3d-panel">
        <div className="rack3d-heading"><div><span className="eyebrow">ESTANTERÍA INDUSTRIAL · VISTA 3D</span><h2>{rack.name}</h2><p>Selecciona un paquete para consultar el producto y su ubicación.</p></div></div>
        <div className="rack3d-stage"><Suspense fallback={<div className="rack3d-loading">Cargando visor 3D…</div>}><RackViewer3D rack={rack} locations={locations} selectedId={selected?.id ?? null} showLocationLabels={!qrLabelsOpen} onSelectProduct={(_products, location) => {
          onSelect(locations.find((item) => item.id === location.id) ?? null);
        }} /></Suspense></div>
      </div>
      <aside className="panel rack3d-detail">
        {editing && isAdmin ? <><div className="location-heading"><div><span className="eyebrow">CONFIGURACIÓN</span><h2>Estantería</h2></div></div><RackConfigForm rack={rack} onChange={onChange} onDelete={onDelete} /></>
          : currentBin ? <><div className="location-heading"><div><span className="eyebrow">CAJA</span><h2>{currentBin.display_name || currentBin.code}</h2><small>{currentBin.code}</small></div><span className={`rack3d-unit-pill ${currentBin.in_use ? 'in-use' : ''}`}>{currentBin.in_use ? 'En uso' : `${formatNumber(currentBin.quantity)} uds.`}</span></div><div className="rack3d-detail-content">
              {currentBin.in_use && <div className="in-use-location-notice">Esta ubicación está reservada. Devuelve aquí los artículos pendientes; no se puede almacenar nada más.</div>}
              <h3>Existencias reales</h3>{currentBin.products.filter((product) => number(product.quantity) > 0).map((product) => <div className="location-product" key={`${product.productId}-${product.lot}`}><span className="product-thumb thumb-0"><Package size={16} /></span><span><strong>{product.name}</strong><small>{product.sku}{product.lot ? ` · Lote ${product.lot}` : ''}</small></span><b>{formatNumber(product.quantity)} uds.</b></div>)}
              {!currentBin.products.some((product) => number(product.quantity) > 0) && <div className="location-empty">{currentBin.in_use ? 'El artículo está en uso y el hueco queda reservado.' : 'Este hueco está vacío.'}</div>}
            </div>{showExpectedContent && <ExpectedContentsPanel location={currentBin} />}
            {isAdmin && <form className="bin-name-editor" onSubmit={(event) => {
              event.preventDefault();
              setNameSaving(true);
              void onSaveLocationName(currentBin.id, displayName.trim() || null).finally(() => setNameSaving(false));
            }}>
              <label>Nombre de la caja<input maxLength={100} value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder={currentBin.code} /></label>
              <button type="submit" className="button button-secondary full-button" disabled={nameSaving || displayName.trim() === (currentBin.display_name ?? '')}>{nameSaving ? 'Guardando…' : 'Guardar nombre de caja'}</button>
            </form>}
            {showExpectedContent && isAdmin && <button className="button button-secondary full-button" onClick={() => setEditingExpectedLocationId(currentBin.id)}><Pencil size={14} /> Editar contenido esperado</button>}
            {showExpectedContent && editingExpectedLocationId === currentBin.id && <ExpectedContentEditor key={currentBin.id} location={currentBin} products={products} onSave={onSaveExpected} onCancel={() => setEditingExpectedLocationId(null)} />}
            <button className="button button-primary full-button" disabled={!currentBin.products.some((product) => number(product.quantity) > 0)} onClick={() => onMoveStock(currentBin)}><ArrowLeftRight size={15} /> Mover productos</button>
          </> : <div className="location-placeholder"><div className="placeholder-icon"><Package size={21} /></div><h3>Estantería completa</h3><p>Se muestran las ubicaciones de suelo y las cajas ocupadas. Selecciona una caja para consultar su contenido.</p><span className="rack3d-unit-pill">{formatNumber(rack.units)} unidades en esta estantería</span></div>}
      </aside>
    </section>
    {qrLabelsOpen && <QrLabelsModal rack={rack} warehouseId={warehouseId} onClose={() => setQrLabelsOpen(false)} />}
  </>;
}

function expectedComparisonRows(location: Location) {
  const expectedById = new globalThis.Map(location.expected_products.map((item) => [item.productId, item]));
  const actualById = new globalThis.Map<string, { sku: string; name: string; quantity: number }>();
  for (const product of location.products) {
    const quantity = number(product.quantity);
    if (quantity <= 0) continue;
    const current = actualById.get(product.productId);
    actualById.set(product.productId, {
      sku: product.sku,
      name: product.name,
      quantity: (current?.quantity ?? 0) + Math.round(quantity * 100)
    });
  }
  const productIds = new Set([...expectedById.keys(), ...actualById.keys()]);
  return [...productIds].map((productId) => {
    const expected = expectedById.get(productId);
    const actual = actualById.get(productId);
    const expectedCents = expected ? Math.round(number(expected.quantity) * 100) : null;
    const actualCents = actual?.quantity ?? 0;
    const expectedQuantity = expectedCents === null ? null : expectedCents / 100;
    const actualQuantity = actualCents / 100;
    const state = expectedCents === null
      ? 'unexpected'
      : expectedCents === actualCents ? 'matched' : actualCents < expectedCents ? 'shortage' : 'surplus';
    const status = expectedCents === null
      ? 'No previsto'
      : expectedCents === actualCents ? 'Correcto'
        : actualCents < expectedCents ? `Faltan ${formatQuantity((expectedCents - actualCents) / 100)}`
          : `Sobran ${formatQuantity((actualCents - expectedCents) / 100)}`;
    return {
      productId,
      name: expected?.name ?? actual?.name ?? 'Producto',
      sku: expected?.sku ?? actual?.sku ?? '',
      expected: expectedQuantity,
      actual: actualQuantity,
      state,
      status
    };
  });
}

function ExpectedContentsPanel({ location }: { location: Location }) {
  const rows = expectedComparisonRows(location);
  return <section className="expected-content-panel">
    <div className="location-products-heading"><h3>Esperado vs. real</h3><span>{location.expected_products.length ? `${location.expected_products.length} previstos` : 'Sin plan'}</span></div>
    {!location.expected_products.length && <p className="expected-content-empty">Todavía no hay productos ni cantidades planificados para este hueco.</p>}
    {rows.map((row) => <div key={row.productId} className={`expected-content-row ${row.state}`}>
      <span><strong>{row.name}</strong><small>{row.sku} · Esperado: {row.expected === null ? '—' : `${formatQuantity(row.expected)} uds.`} · Real: {formatQuantity(row.actual)} uds.</small></span>
      <b>{row.status}</b>
    </div>)}
  </section>;
}

function ExpectedContentEditor({ location, products, onSave, onCancel }: {
  location: Location;
  products: Product[];
  onSave: (locationId: string, expected: { productId: string; quantity: number }[]) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [lines, setLines] = useState(() => location.expected_products.map((item) => ({
    productId: item.productId,
    quantity: String(item.quantity)
  })));
  const [saving, setSaving] = useState(false);
  const options = products.map(({ id, sku, name }) => ({ id, sku, name }));
  for (const expected of location.expected_products) {
    if (!options.some((product) => product.id === expected.productId))
      options.push({ id: expected.productId, sku: expected.sku, name: expected.name });
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    try {
      const saved = await onSave(location.id, lines.map((line) => ({
        productId: line.productId,
        quantity: Number(line.quantity)
      })));
      if (saved) onCancel();
    } finally {
      setSaving(false);
    }
  };

  return <form className="expected-content-editor" onSubmit={(event) => void submit(event)}>
    <strong>Plan esperado por hueco</strong>
    {!lines.length && <p>Añade los productos y cantidades que deberían estar aquí.</p>}
    {lines.map((line, index) => <div className="expected-content-edit-row" key={index}>
      <select required aria-label={`Producto esperado ${index + 1}`} value={line.productId} onChange={(event) => setLines((current) => current.map((item, row) => row === index ? { ...item, productId: event.target.value } : item))}>
        <option value="">Selecciona un producto</option>
        {options.map((product) => <option key={product.id} value={product.id}>{product.sku} · {product.name}</option>)}
      </select>
      <input required aria-label={`Cantidad esperada ${index + 1}`} type="number" min="0.01" step="0.01" value={line.quantity} onChange={(event) => setLines((current) => current.map((item, row) => row === index ? { ...item, quantity: event.target.value } : item))} />
      <button type="button" className="row-menu" aria-label={`Eliminar producto esperado ${index + 1}`} onClick={() => setLines((current) => current.filter((_item, row) => row !== index))}><Trash2 size={14} /></button>
    </div>)}
    <button type="button" className="button button-secondary expected-add-button" onClick={() => setLines((current) => [...current, { productId: '', quantity: '1' }])}><Plus size={14} /> Añadir producto</button>
    <div className="form-actions"><button type="button" className="button button-secondary" disabled={saving} onClick={onCancel}>Cancelar</button><button type="submit" className="button button-primary" disabled={saving}>{saving ? 'Guardando…' : 'Guardar plan'}</button></div>
  </form>;
}

function qrCodeUrl(params: { warehouseId: string; locationId?: string; rackId?: string; level?: number }) {
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('warehouseId', params.warehouseId);
  if (params.locationId) url.searchParams.set('locationId', params.locationId);
  if (params.rackId) url.searchParams.set('rackId', params.rackId);
  if (params.level) url.searchParams.set('level', String(params.level));
  return url.toString();
}

function QrLabelsModal({ rack, warehouseId, onClose }: {
  rack: Rack; warehouseId: string; onClose: () => void;
}) {
  const labels = [
    { kind: 'ESTANTERÍA · VISTA 3D', title: rack.name, code: rack.code, url: qrCodeUrl({ warehouseId, rackId: rack.id }) }
  ];

  return <div className="modal-backdrop qr-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="modal qr-label-modal">
      <div className="modal-heading qr-label-actions"><div><span className="eyebrow">ETIQUETA DE ESTANTERÍA</span><h2>QR · {rack.code}</h2></div><button className="icon-button" aria-label="Cerrar" onClick={onClose}><X size={18} /></button></div>
      <div className="qr-print-actions"><p>Un QR abre la estantería completa en el visor 3D, con los nombres de sus cajas.</p><button className="button button-primary" onClick={() => window.print()}><Printer size={15} /> Imprimir etiqueta</button></div>
      <p className="qr-print-note">Imprime usando una dirección accesible desde los móviles del almacén. La vista 3D requiere iniciar sesión.</p>
      <div className="qr-label-sheet single">{labels.map((label) => <article className="qr-label" key={`${label.kind}-${label.code}`}>
        <span className="qr-label-kind">{label.kind}</span><strong>{label.title}</strong><small>{label.code}</small>
        <QRCodeSVG value={label.url} size={112} level="M" includeMargin />
      </article>)}</div>
    </section>
  </div>;
}

export function LegacyMapPage({ locations, racks, selected, isAdmin, onSelect, onRefresh, onNotify, onMoveStock }: {
  locations: Location[]; racks: Rack[]; selected: Location | null; isAdmin: boolean;
  onSelect: (location: Location | null) => void; onRefresh: () => Promise<void>;
  onNotify: (message: string) => void; onMoveStock: (location: Location) => void
}) {
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [zoom, setZoom] = useState(0.7);
  const [selectedRackId, setSelectedRackId] = useState<string | null>(null);
  const [rackDraft, setRackDraft] = useState<Record<string, { x: number; y: number }>>({});
  const [dragging, setDragging] = useState<{ id: string; dx: number; dy: number } | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setRackDraft(Object.fromEntries(racks.map((rack) => [rack.id, { x: number(rack.map_x), y: number(rack.map_y) }])));
  }, [racks]);

  useEffect(() => {
    if (selectedRackId && !racks.some((rack) => rack.id === selectedRackId)) setSelectedRackId(null);
  }, [racks, selectedRackId]);

  const saveLayout = async () => {
    const changed = racks.flatMap((rack) => {
      const position = rackDraft[rack.id];
      return position && (position.x !== number(rack.map_x) || position.y !== number(rack.map_y))
        ? [{ id: rack.id, map_x: position.x, map_y: position.y }]
        : [];
    });
    if (!changed.length) { setEditMode(false); return; }
    setSaving(true);
    try {
      await request('/racks/map', { method: 'PATCH', body: JSON.stringify({ racks: changed }) });
      setEditMode(false);
      await onRefresh();
      onNotify('Plano guardado');
    } catch (reason) {
      window.alert(reason instanceof Error ? reason.message : 'No se pudo guardar el plano');
    } finally {
      setSaving(false);
    }
  };

  const moveRack = (event: React.PointerEvent<HTMLDivElement>, rack: Rack) => {
    if (!editMode || !isAdmin || (event.target instanceof HTMLElement && event.target.closest('.rack-bin'))) return;
    event.preventDefault();
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    setDragging({
      id: rack.id,
      dx: (event.clientX - rect.left) / zoom - number(rack.map_x),
      dy: (event.clientY - rect.top) / zoom - number(rack.map_y)
    });
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const updateRackPosition = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!editMode || !dragging || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    setRackDraft((current) => ({
      ...current,
      [dragging.id]: {
        x: Math.max(0, Math.round((event.clientX - rect.left) / zoom - dragging.dx)),
        y: Math.max(0, Math.round((event.clientY - rect.top) / zoom - dragging.dy))
      }
    }));
  };

  const addRackAt = async (clientX: number, clientY: number) => {
    const aisleId = racks[0]?.aisle_id ?? locations[0]?.aisle_id;
    if (!aisleId || !canvasRef.current) {
      window.alert('Configura primero una zona y un pasillo para poder añadir estanterías.');
      return;
    }
    const rect = canvasRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.round((clientX - rect.left) / zoom - 8));
    const y = Math.max(0, Math.round((clientY - rect.top) / zoom - 8));
    const code = `R-${Date.now().toString(36).slice(-5).toUpperCase()}`;
    setSaving(true);
    try {
      const created = await request<{ id: string }>('/racks', {
        method: 'POST',
        body: JSON.stringify({
          aisleId, name: 'Nueva estantería', code, levelCount: 3, binsPerLevel: 4,
          map_x: x, map_y: y, map_width: 480, map_height: 280
        })
      });
      await onRefresh();
      setSelectedRackId(created.id);
      onSelect(null);
      setEditMode(false);
      onNotify('Estantería creada. Puedes configurar sus niveles y ubicaciones.');
    } catch (reason) {
      window.alert(reason instanceof Error ? reason.message : 'No se pudo crear la estantería');
    } finally {
      setSaving(false);
    }
  };

  const occupied = locations.filter((location) => number(location.quantity) > 0).length;
  const inUse = locations.filter((location) => location.in_use).length;
  const available = locations.filter((location) => number(location.quantity) <= 0 && !location.in_use).length;
  const canvasWidth = Math.max(520, ...racks.map((rack) => number(rackDraft[rack.id]?.x ?? rack.map_x) + number(rack.map_width) + 45));
  const canvasHeight = Math.max(340, ...racks.map((rack) => number(rackDraft[rack.id]?.y ?? rack.map_y) + number(rack.map_height) + 45));
  const selectedRack = racks.find((rack) => rack.id === selectedRackId) ?? null;
  const rackLocations = selectedRack ? locations.filter((location) => location.rack_id === selectedRack.id) : [];
  const rackLevels = selectedRack
    ? [0, ...Array.from({ length: selectedRack.level_count }, (_, index) => index + 1)].map((level) => ({
        level, bins: rackLocations.filter((location) => location.level_number === level)
      }))
    : [];
  const zoomedWidth = Math.round(canvasWidth * zoom);
  const zoomedHeight = Math.round(canvasHeight * zoom);

  return <>
    <PageIntro eyebrow="LAYOUT Y UBICACIONES" title="Mapa del almacén" description="Arrastra estanterías al plano, colócalas y configura sus niveles y ubicaciones." actions={<><button className="button button-secondary" onClick={() => downloadCsv('ubicaciones.csv', [['Ubicación', 'Zona', 'Pasillo', 'Estantería', 'Nivel', 'Unidades'], ...locations.map((location) => [location.code, location.zone, location.aisle, location.rack, location.level_number === 0 ? 'Suelo' : location.level_number, location.quantity])])}><Download size={16} /> Exportar CSV</button>{isAdmin && (editMode ? <><button className="button button-secondary" onClick={() => { setEditMode(false); setRackDraft(Object.fromEntries(racks.map((rack) => [rack.id, { x: number(rack.map_x), y: number(rack.map_y) }]))); }}>Cancelar</button><button className="button button-primary" disabled={saving} onClick={() => void saveLayout()}><Check size={16} /> {saving ? 'Guardando…' : 'Guardar plano'}</button></> : <button className="button button-primary" onClick={() => setEditMode(true)}><Pencil size={15} /> Editar plano</button>)}</>} />
    <div className="map-summary"><div className="map-summary-item"><span className="map-dot occupied" />Ubicaciones ocupadas <strong>{occupied}</strong></div><div className="map-summary-item"><span className="map-dot in-use" />En uso <strong>{inUse}</strong></div><div className="map-summary-item"><span className="map-dot available" />Vacías <strong>{available}</strong></div><div className="map-summary-item"><Layers size={14} />Estanterías <strong>{racks.length}</strong></div><div className="map-summary-spacer" /><div className="map-floor"><Building2 size={15} /> Madrid · Planta principal</div></div>
    <div className="map-layout">
      {isAdmin && editMode && <aside className="map-toolbox panel"><span className="eyebrow">ELEMENTOS</span><h3>Plano del almacén</h3><div className="map-tool-hint">Arrastra una estantería y suéltala donde quieras en el plano.</div><div className="rack-template" draggable onDragStart={(event) => event.dataTransfer.setData('application/stockflow-rack', 'new')}><div className="rack-template-icon"><Layers size={19} /></div><span><strong>Estantería</strong><small>3 niveles · 4 ubicaciones</small></span><Plus size={16} /></div><div className="map-tool-note"><ShieldCheck size={14} /> Las posiciones se guardan en la base de datos.</div></aside>}
      <section className="panel map-panel"><div className="map-panel-heading"><div><h2>Plano de planta</h2><p>{racks.length} estanterías <span>·</span> {locations.length} ubicaciones</p></div><div className="zoom-controls"><button aria-label="Alejar" title="Alejar" onClick={() => setZoom((value) => Math.max(.5, Math.round((value - .1) * 10) / 10))}><ZoomOut size={15} /></button><span>{Math.round(zoom * 100)}%</span><button aria-label="Acercar" title="Acercar" onClick={() => setZoom((value) => Math.min(1.6, Math.round((value + .1) * 10) / 10))}><ZoomIn size={15} /></button></div></div>
        <div className="map-canvas-wrap" onDragOver={(event) => { if (event.dataTransfer.types.includes('application/stockflow-rack')) event.preventDefault(); }} onDrop={(event) => { if (event.dataTransfer.getData('application/stockflow-rack')) { event.preventDefault(); void addRackAt(event.clientX, event.clientY); } }}>
          <div className="map-zoom-frame" style={{ width: zoomedWidth, height: zoomedHeight }}>
            <div ref={canvasRef} className={`map-canvas ${editMode ? 'editing' : ''}`} style={{ width: canvasWidth, height: canvasHeight, transform: `scale(${zoom})`, transformOrigin: 'top left' }}>
              <svg className="map-grid" width={canvasWidth} height={canvasHeight} aria-hidden="true"><defs><pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M 24 0 L 0 0 0 24" fill="none" stroke="#edf0ee" strokeWidth="1" /></pattern></defs><rect width="100%" height="100%" fill="url(#grid)" /></svg>
              {racks.map((rack) => {
                const position = rackDraft[rack.id] ?? { x: number(rack.map_x), y: number(rack.map_y) };
                const bins = locations.filter((location) => location.rack_id === rack.id);
                const levels = [0, ...Array.from({ length: rack.level_count }, (_, index) => index + 1)];
                return <div key={rack.id} role="group" tabIndex={0} aria-label={`Estantería ${rack.name}`} className={`map-rack ${selectedRackId === rack.id ? 'selected' : ''} ${editMode && isAdmin ? 'draggable' : ''}`} style={{ left: position.x, top: position.y, width: number(rack.map_width), height: number(rack.map_height) }} onPointerDown={(event) => moveRack(event, rack)} onPointerMove={updateRackPosition} onPointerUp={() => setDragging(null)} onPointerCancel={() => setDragging(null)} onClick={() => { setSelectedRackId(rack.id); onSelect(null); }} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') setSelectedRackId(rack.id); }}>
                  <div className="map-rack-heading"><Layers size={15} /><strong>{rack.name}</strong><small>{formatNumber(rack.units)} uds.</small></div>
                  <div className="rack-shelves">{levels.map((level) => {
                    const levelBins = bins.filter((bin) => bin.level_number === level);
                    return <div className="rack-shelf-row" key={level}><span className="shelf-level">{level === 0 ? 'Suelo' : String(level).padStart(2, '0')}</span><div className="rack-bin-list">{levelBins.map((bin) => <button key={bin.id} className={`rack-bin ${number(bin.quantity) > 0 ? 'filled' : ''} ${bin.in_use ? 'in-use' : ''} ${selected?.id === bin.id ? 'active' : ''}`} title={`${bin.code} · ${bin.in_use ? 'En uso · ubicación reservada' : `${formatNumber(bin.quantity)} unidades`}`} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); setSelectedRackId(rack.id); onSelect(bin); }}>{bin.code.split('-').slice(-1)[0]}<small>{bin.in_use ? 'USO' : number(bin.quantity) > 0 ? formatNumber(bin.quantity) : '·'}</small></button>)}</div></div>;
                  })}</div>
                </div>;
              })}
              {!racks.length && <div className="map-empty">Activa “Editar plano” y arrastra una estantería aquí.</div>}
            </div>
          </div>
        </div>
        <div className="map-footer"><span><ShieldCheck size={15} /> Datos sincronizados en tiempo real</span><span>Última actualización: ahora</span></div>
      </section>
      <aside className="panel location-panel">
        {selectedRack ? <><div className="location-heading"><div><span className="eyebrow">ESTANTERÍA</span><h2>{selectedRack.name}</h2></div><button className="icon-button" aria-label="Cerrar estantería" onClick={() => { setSelectedRackId(null); onSelect(null); }}><X size={17} /></button></div>
          <div className="location-path"><Map size={15} />{selectedRack.zone} <ChevronRight size={13} /> Pasillo {selectedRack.aisle} <ChevronRight size={13} /> {selectedRack.name}</div>
          <div className="location-stats"><div><span>Niveles</span><strong>{selectedRack.level_count}</strong></div><div><span>Ubicaciones</span><strong>{selectedRack.bin_count}</strong></div></div>
          <div className="rack-detail-actions">{isAdmin && <button className="button button-secondary" onClick={() => setEditMode((editing) => !editing)}><Settings2 size={15} /> {editMode ? 'Ocultar ajustes' : 'Configurar estantería'}</button>}</div>
          {isAdmin && editMode && <RackConfigForm key={`${selectedRack.id}-${selectedRack.code}-${selectedRack.map_width}-${selectedRack.map_height}`} rack={selectedRack} onChange={() => undefined} onDelete={() => undefined} />}
          <div className="location-products-heading"><h3>Ubicaciones por nivel</h3><span>{selectedRack.bin_count}</span></div>
          <div className="rack-bin-details">{rackLevels.map(({ level, bins }) => <section key={level}><strong className="rack-level-title">{level === 0 ? 'Suelo' : `Nivel ${level}`}</strong>{bins.map((bin) => <button className={`rack-bin-detail ${bin.in_use ? 'in-use' : ''} ${selected?.id === bin.id ? 'selected' : ''}`} key={bin.id} onClick={() => onSelect(bin)}><span><strong>{bin.code}{bin.in_use && <small className="in-use-badge">En uso</small>}</strong><small>Fondo {bin.depth_position} · {bin.products.length ? bin.products.map((product) => product.name).join(', ') : bin.in_use ? 'Ubicación reservada' : 'Disponible'}</small></span><b>{formatNumber(bin.quantity)} uds.</b></button>)}</section>)}</div>
          {selected && <div className="selected-bin-card"><div className="location-products-heading"><h3>Ubicación {selected.code}</h3><span>{selected.products.length} productos</span></div>
            {selected.in_use && <div className="in-use-location-notice">En uso: esta ubicación está reservada para la devolución del artículo original.</div>}
            <div className="location-products">{selected.products.map((product) => <div className="location-product" key={`${product.productId}-${product.lot}`}><div className="product-thumb thumb-0"><Package size={16} /></div><div><strong>{product.name}</strong><small>{product.sku}{product.lot ? ` · Lote ${product.lot}` : ''}</small></div><b>{formatNumber(product.quantity)} uds.</b></div>)}
              {!selected.products.length && <div className="location-empty">{selected.in_use ? 'El hueco está reservado mientras el artículo siga en uso.' : 'Esta ubicación está disponible.'}</div>}
            </div><button className="button button-primary full-button" disabled={!selected.products.length} onClick={() => onMoveStock(selected)}><ArrowLeftRight size={16} /> Mover stock</button>
          </div>}
        </> : selected ? <><div className="location-heading"><div><span className="eyebrow">DETALLE DE UBICACIÓN</span><h2>{selected.code}</h2></div><button className="icon-button" aria-label="Cerrar detalle" onClick={() => onSelect(null)}><X size={17} /></button></div>
          <div className="location-path"><Map size={15} />{selected.zone} <ChevronRight size={13} /> Pasillo {selected.aisle} <ChevronRight size={13} /> {selected.level_number === 0 ? 'Suelo' : `Nivel ${selected.level_number}`}</div>
          <div className="location-stats"><div><span>Unidades</span><strong>{formatNumber(selected.quantity)}</strong></div><div><span>Capacidad</span><strong>{selected.capacity ? `${formatNumber(selected.capacity)} uds.` : 'Sin límite'}</strong></div></div>
          {selected.in_use && <div className="in-use-location-notice">En uso: ubicación reservada; las devoluciones deben volver aquí.</div>}
          <div className="occupancy-label"><span>Ocupación</span><strong>{selected.in_use ? 'En uso' : selected.capacity ? `${Math.min(100, Math.round(number(selected.quantity) / number(selected.capacity) * 100))}%` : number(selected.quantity) > 0 ? 'En uso' : 'Vacía'}</strong></div>
          <div className="occupancy-track"><span style={{ width: `${selected.capacity ? Math.min(100, number(selected.quantity) / number(selected.capacity) * 100) : number(selected.quantity) ? 58 : 0}%` }} /></div>
          <div className="location-products-heading"><h3>Productos almacenados</h3><span>{selected.products.length}</span></div>
          <div className="location-products">{selected.products.map((p) => <div className="location-product" key={`${p.productId}-${p.lot}`}><div className="product-thumb thumb-0"><Package size={16} /></div><div><strong>{p.name}</strong><small>{p.sku}{p.lot ? ` · Lote ${p.lot}` : ''}</small></div><b>{formatNumber(p.quantity)} uds.</b></div>)}
            {!selected.products.length && <div className="location-empty">{selected.in_use ? 'El hueco está reservado mientras el artículo siga en uso.' : 'Esta ubicación está disponible para almacenar productos.'}</div>}
          </div>
          <button className="button button-primary full-button" disabled={!selected.products.length} onClick={() => onMoveStock(selected)}><ArrowLeftRight size={16} /> Mover stock</button>
        </> : <div className="location-placeholder"><div className="placeholder-icon"><Map size={21} /></div><h3>Selecciona una estantería</h3><p>Haz clic en el mapa para consultar y configurar sus niveles y ubicaciones.</p></div>}
      </aside>
    </div>
  </>;
}

function MapPage({ products, locations, racks, warehouse, aisles, selected, initialRackId, isAdmin, onSelect, onRefresh, onNotify, onMoveStock, onSaveExpected, onSaveLocationName, onEditingChange }: {
  products: Product[]; locations: Location[]; racks: Rack[]; warehouse: WarehouseMap; aisles: Aisle[];
  selected: Location | null; initialRackId: string | null; isAdmin: boolean; onSelect: (location: Location | null) => void;
  onRefresh: () => Promise<void>; onNotify: (message: string) => void; onMoveStock: (location: Location) => void;
  onSaveExpected: (locationId: string, expected: { productId: string; quantity: number }[]) => Promise<boolean>;
  onSaveLocationName: (locationId: string, displayName: string | null) => Promise<boolean>;
  onEditingChange: (editing: boolean) => void
}) {
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [selectedRackId, setSelectedRackId] = useState<string | null>(initialRackId);
  const [rackDraft, setRackDraft] = useState<Rack[]>(racks);
  const [warehouseDraft, setWarehouseDraft] = useState(warehouse);
  const [rackWizard, setRackWizard] = useState<{ aisleId: string; x: number; y: number } | null>(null);
  const [structures, setStructures] = useState<WarehouseStructure[]>(warehouse.map_structures ?? []);
  const [structureDraft, setStructureDraft] = useState<WarehouseStructure[]>(warehouse.map_structures ?? []);
  const [drawingStructureType, setDrawingStructureType] = useState<WarehouseStructure['type'] | null>(null);
  const [selectedStructureId, setSelectedStructureId] = useState<string | null>(null);
  const [perimeter, setPerimeter] = useState<WarehousePoint[]>([]);
  const [perimeterDraft, setPerimeterDraft] = useState<WarehousePoint[]>([]);
  const [drawingPerimeter, setDrawingPerimeter] = useState(false);
  const [editingPerimeter, setEditingPerimeter] = useState(false);
  const perimeterFileRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const mapViewportRef = useRef<HTMLDivElement>(null);
  const perimeterStorageKey = `stockflow.warehouse-plan.${warehouse.id}`;

  useEffect(() => {
    try {
      const saved = localStorage.getItem(perimeterStorageKey);
      const savedPlan = saved ? cargarPlanoJSON(saved) : null;
      const savedPerimeter = savedPlan?.perimeter.map(([x, y]) => ({ x, y })) ?? [];
      setPerimeter(warehouse.map_perimeter?.length ? warehouse.map_perimeter : savedPerimeter);
      const savedStructures = savedPlan?.structures ?? [];
      const currentStructures = warehouse.map_structures?.length ? warehouse.map_structures : savedStructures;
      setStructures(currentStructures);
      setStructureDraft(currentStructures);
    } catch (reason) {
      setPerimeter([]);
      setStructures(warehouse.map_structures ?? []);
      setStructureDraft(warehouse.map_structures ?? []);
      onNotify(reason instanceof Error ? `No se pudo cargar el perímetro: ${reason.message}` : 'No se pudo cargar el perímetro.');
    }
    setPerimeterDraft([]);
    setDrawingPerimeter(false);
    setDrawingStructureType(null);
    setEditingPerimeter(false);
    setDrawingStructureType(null);
  }, [warehouse.id, warehouse.map_perimeter, warehouse.map_structures]);

  useEffect(() => {
    if (editMode) return;
    setRackDraft(racks);
    setWarehouseDraft(warehouse);
  }, [editMode, racks, warehouse]);

  useEffect(() => {
    onEditingChange(editMode);
    if (!editMode) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [editMode, onEditingChange]);

  useEffect(() => {
    if (selected) setSelectedRackId(selected.rack_id);
  }, [selected?.id, selected?.rack_id]);

  const startEditing = () => {
    setRackDraft(racks.map((rack) => ({ ...rack, level_heights: rack.level_heights.map(number) })));
    setWarehouseDraft({ ...warehouse });
    setStructureDraft(structures.map((structure) => ({ ...structure })));
    setSelectedStructureId(null);
    setEditMode(true);
  };

  const discardChanges = () => {
    setRackDraft(racks);
    setWarehouseDraft(warehouse);
    setStructureDraft(structures);
    setDrawingStructureType(null);
    setSelectedStructureId(null);
    setPerimeterDraft([]);
    setDrawingPerimeter(false);
    setEditingPerimeter(false);
    setEditMode(false);
  };

  const saveLayout = async () => {
    setSaving(true);
    try {
      await request('/map-layout', {
        method: 'PUT',
        body: JSON.stringify({
          warehouse: { map_width: number(warehouseDraft.map_width), map_height: number(warehouseDraft.map_height) },
          perimeter,
          structures: structureDraft,
          aisles: aisles.map(({ zone, ...aisle }) => aisle),
          racks: rackDraft.map(({ id, aisle_id, zone, aisle, level_count, bins_per_level, depth_slots, bin_count, units, level_heights, ...rack }) => ({
            ...rack,
            ...(id.startsWith('draft-') ? { clientId: id } : { id }),
            aisleId: aisle_id,
            binsPerLevel: number(bins_per_level),
            depthSlots: number(depth_slots),
            levelHeights: level_heights.map(number)
          })),
          deleteRackIds: racks.filter((rack) => !rackDraft.some((draft) => draft.id === rack.id)).map((rack) => rack.id),
          deleteAisleIds: []
        })
      });
      setStructures(structureDraft);
      localStorage.setItem(perimeterStorageKey, JSON.stringify(exportarPlanoJSON(
        perimeter.length ? perimeter : [
          { x: 4, y: 4 },
          { x: Math.max(4, number(warehouseDraft.map_width) - 4), y: 4 },
          { x: Math.max(4, number(warehouseDraft.map_width) - 4), y: Math.max(4, number(warehouseDraft.map_height) - 4) },
          { x: 4, y: Math.max(4, number(warehouseDraft.map_height) - 4) }
        ],
        rackDraft,
        structureDraft
      )));
      setEditMode(false);
      setSelectedRackId(null);
      onSelect(null);
      await onRefresh();
      onNotify('Plano del almacén guardado');
    } catch (reason) {
      window.alert(reason instanceof Error ? reason.message : 'No se pudo guardar el plano');
    } finally {
      setSaving(false);
    }
  };

  const updateRack = (id: string, field: string, value: string | number) => {
    setRackDraft((current) => current.map((rack) => {
      if (rack.id !== id) return rack;
      if (field.startsWith('height_')) {
        const index = Number(field.slice(7));
        return { ...rack, level_heights: rack.level_heights.map((height, position) => position === index ? value : height) };
      }
      if (field === 'level_count') {
        const maximumLevels = Math.max(rack.level_count, Math.min(12, Math.floor(100 / (rack.bins_per_level * rack.depth_slots))));
        const count = Math.max(rack.level_count, Math.min(maximumLevels, Number(value)));
        const totalHeight = calculateRackHeightCm(rack.level_heights.map(number));
        return {
          ...rack, level_count: count,
          bin_count: (count + 1) * rack.bins_per_level * rack.depth_slots,
          level_heights: makeRackLevelHeights(totalHeight, count)
        };
      }
      if (field === 'bins_per_level') {
        const maximumBins = Math.max(rack.bins_per_level, Math.min(
          maxRackBinsForWidth(number(rack.map_width)),
          Math.floor(100 / (rack.level_count * rack.depth_slots))
        ));
        const binsPerLevel = Math.max(rack.bins_per_level, Math.min(maximumBins, Number(value)));
        return { ...rack, bins_per_level: binsPerLevel, bin_count: (rack.level_count + 1) * binsPerLevel * rack.depth_slots };
      }
      if (field === 'depth_slots') {
        const depthSlots = Math.max(rack.depth_slots, Math.min(
          maxRackDepthSlots(rack.level_count, rack.bins_per_level, number(rack.map_height)), Number(value)
        ));
        return { ...rack, depth_slots: depthSlots, bin_count: (rack.level_count + 1) * rack.bins_per_level * depthSlots };
      }
      return { ...rack, [field]: value };
    }));
  };

  const openRackWizard = (x = number(warehouseDraft.map_width) / 2, y = number(warehouseDraft.map_height) / 2) => {
    const aisle = aisles[0];
    if (!aisle) {
      window.alert('No hay una zona de almacenamiento configurada para crear estanterías.');
      return;
    }
    const width = Math.min(480, number(warehouseDraft.map_width), 2000);
    const depth = Math.min(280, number(warehouseDraft.map_height), 1200);
    const mapWidth = number(warehouseDraft.map_width);
    const mapHeight = number(warehouseDraft.map_height);
    setRackWizard({
      aisleId: aisle.id,
      x: Math.max(0, Math.min(Math.round((x - width / 2) / MAP_GRID_SIZE) * MAP_GRID_SIZE, mapWidth - width)),
      y: Math.max(0, Math.min(Math.round((y - depth / 2) / MAP_GRID_SIZE) * MAP_GRID_SIZE, mapHeight - depth))
    });
  };

  const addElementAt = (x: number, y: number) => openRackWizard(x, y);

  const savePerimeter = (
    points: WarehousePoint[],
    message = 'Perímetro actualizado; guarda el plano para aplicarlo al almacén',
    nextStructures = structureDraft
  ) => {
    try {
      const rectangle = [
        { x: 4, y: 4 },
        { x: Math.max(4, canvasWidth - 4), y: 4 },
        { x: Math.max(4, canvasWidth - 4), y: Math.max(4, canvasHeight - 4) },
        { x: 4, y: Math.max(4, canvasHeight - 4) }
      ];
      localStorage.setItem(perimeterStorageKey, JSON.stringify(exportarPlanoJSON(points.length ? points : rectangle, activeRacks, nextStructures)));
      setPerimeter(points);
      setStructures(nextStructures);
      setStructureDraft(nextStructures);
      setPerimeterDraft([]);
      setDrawingPerimeter(false);
      setEditingPerimeter(false);
      onNotify(message);
      return true;
    } catch (reason) {
      window.alert(reason instanceof Error ? reason.message : 'No se pudo guardar el perímetro.');
      return false;
    }
  };

  const finishPerimeter = () => {
    if (perimeterDraft.length < 3) {
      window.alert('Añade al menos tres vértices para cerrar el perímetro.');
      return;
    }
    if (!activeRacks.every((rack) => isRackWithinPerimeter({
      x: number(rack.map_x), y: number(rack.map_y),
      width: number(rack.map_width), height: number(rack.map_height)
    }, perimeterDraft))) {
      window.alert('Todas las estanterías deben quedar completamente dentro del perímetro.');
      return;
    }
    if (!structureDraft.every((structure) => isRackWithinPerimeter(structure, perimeterDraft))) {
      window.alert('Todas las paredes y puertas deben quedar dentro del perímetro.');
      return;
    }
    savePerimeter(perimeterDraft);
  };

  const setStructureDrawingMode = (type: WarehouseStructure['type']) => {
    setDrawingPerimeter(false);
    setPerimeterDraft([]);
    setEditingPerimeter(false);
    setSelectedStructureId(null);
    setDrawingStructureType((current) => current === type ? null : type);
  };

  const addStructure = (structure: WarehouseStructure) => {
    if (structure.x + structure.width > canvasWidth || structure.y + structure.height > canvasHeight ||
        !isRackWithinPerimeter(structure, perimeter)) {
      window.alert('La pared o puerta debe quedar dentro del perímetro y las dimensiones del almacén.');
      return;
    }
    if (activeRacks.some((rack) => rackOverlapsStructures({
      x: number(rack.map_x), y: number(rack.map_y),
      width: number(rack.map_width), height: number(rack.map_height)
    }, [structure]))) {
      window.alert('No se puede dibujar una pared o puerta sobre una estantería.');
      return;
    }
    setStructureDraft((current) => [...current, structure]);
    setSelectedStructureId(structure.id);
  };

  const removeSelectedStructure = () => {
    if (!selectedStructureId) return;
    setStructureDraft((current) => current.filter((structure) => structure.id !== selectedStructureId));
    setSelectedStructureId(null);
  };

  const exportPlan = () => {
    const points = perimeter.length ? perimeter : [
      { x: 4, y: 4 },
      { x: Math.max(4, canvasWidth - 4), y: 4 },
      { x: Math.max(4, canvasWidth - 4), y: Math.max(4, canvasHeight - 4) },
      { x: 4, y: Math.max(4, canvasHeight - 4) }
    ];
    const data = exportarPlanoJSON(points, activeRacks, editMode ? structureDraft : structures);
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${warehouse.code.toLowerCase()}-plano.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const importPlan = async (file: File) => {
    try {
      const plan = cargarPlanoJSON(await file.text());
      if (!plan.structures.every((structure) => isRackWithinPerimeter(structure, plan.perimeter.map(([x, y]) => ({ x, y }))) ||
        plan.perimeter.length < 3)) {
        window.alert('Las paredes y puertas importadas deben quedar dentro del perímetro.');
        return;
      }
      if (activeRacks.some((rack) => rackOverlapsStructures({
        x: number(rack.map_x), y: number(rack.map_y),
        width: number(rack.map_width), height: number(rack.map_height)
      }, plan.structures))) {
        window.alert('Una estantería se solapa con una pared o puerta del plano importado.');
        return;
      }
      savePerimeter(
        plan.perimeter.map(([x, y]) => ({ x, y })),
        'Perímetro, paredes y puertas importados; guarda el plano para aplicarlos al almacén.',
        plan.structures
      );
    } catch (reason) {
      window.alert(reason instanceof Error ? reason.message : 'No se pudo importar el plano.');
    } finally {
      if (perimeterFileRef.current) perimeterFileRef.current.value = '';
    }
  };

  const createRackDraft = (values: RackCreationValues) => {
    const aisle = aisles.find((item) => item.id === values.aisleId);
    if (!aisle || !rackWizard) {
      window.alert('No se pudo asignar la estantería a la zona de almacenamiento.');
      return;
    }
    const id = `draft-rack-${Date.now()}`;
    const width = Math.min(values.width, number(warehouseDraft.map_width));
    const height = Math.max(130, Math.min(values.depth, number(warehouseDraft.map_height), 1200));
    const rack: Rack = {
      id, aisle_id: aisle.id, aisle: aisle.code, zone: aisle.zone, name: values.name,
      code: values.code.trim().toUpperCase(),
      map_x: Math.max(0, Math.min(rackWizard.x, number(warehouseDraft.map_width) - width)),
      map_y: Math.max(0, Math.min(rackWizard.y, number(warehouseDraft.map_height) - height)),
      map_width: width, map_height: height, level_count: values.levelHeights.length,
      bins_per_level: values.binsPerLevel, depth_slots: values.depthSlots,
      bin_count: (values.levelHeights.length + 1) * values.binsPerLevel * values.depthSlots,
      level_heights: values.levelHeights, units: 0
    };
    if (!isRackWithinPerimeter({
      x: number(rack.map_x), y: number(rack.map_y),
      width: number(rack.map_width), height: number(rack.map_height)
    }, perimeter)) {
      window.alert('La estantería debe quedar completamente dentro del perímetro del almacén.');
      return;
    }
    if (rackOverlapsStructures({
      x: number(rack.map_x), y: number(rack.map_y),
      width: number(rack.map_width), height: number(rack.map_height)
    }, structureDraft)) {
      window.alert('La estantería no puede solaparse con una pared o puerta.');
      return;
    }
    setRackDraft((current) => [...current, rack]);
    setSelectedRackId(id);
    setRackWizard(null);
    onSelect(null);
  };

  const removeRack = (rack: Rack) => {
    if (!window.confirm(`¿Eliminar la estantería ${rack.code}? Los cambios se aplicarán al guardar el plano.`)) return;
    setRackDraft((current) => current.filter((item) => item.id !== rack.id));
    setSelectedRackId(null);
  };

  const activeRacks: Rack[] = editMode ? rackDraft : racks;
  const activeStructures = editMode ? structureDraft : structures;
  const canvasWidth = number(editMode ? warehouseDraft.map_width : warehouse.map_width);
  const canvasHeight = number(editMode ? warehouseDraft.map_height : warehouse.map_height);
  useEffect(() => {
    const viewport = mapViewportRef.current;
    if (!viewport) return;
    const fitMap = () => {
      const availableWidth = Math.max(1, viewport.clientWidth - 24);
      const availableHeight = Math.max(1, viewport.clientHeight - 24);
      const renderedWidth = canvasWidth * MAP_RENDER_SCALE;
      const renderedHeight = canvasHeight * MAP_RENDER_SCALE;
      setZoom(Math.max(0.05, Math.min(1, availableWidth / renderedWidth, availableHeight / renderedHeight)));
    };
    fitMap();
    const observer = new ResizeObserver(fitMap);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [warehouse.id, canvasWidth, canvasHeight, selectedRackId]);
  const selectedRack: Rack | null = activeRacks.find((rack) => rack.id === selectedRackId) ?? null;
  const rackLocations = selectedRack ? locations.filter((location) => location.rack_id === selectedRack.id) : [];
  const occupied = locations.filter((location) => number(location.quantity) > 0).length;
  const inUse = locations.filter((location) => location.in_use).length;
  const available = locations.filter((location) => number(location.quantity) <= 0 && !location.in_use).length;
  const zoomedWidth = Math.round(canvasWidth * MAP_RENDER_SCALE * zoom);
  const zoomedHeight = Math.round(canvasHeight * MAP_RENDER_SCALE * zoom);
  const startPerimeterEdit = () => {
    setDrawingStructureType(null);
    setPerimeterDraft(perimeter.map((point) => ({ ...point })));
    setDrawingPerimeter(true);
    setEditingPerimeter(perimeter.length > 0);
  };
  const discardPerimeterEdit = () => {
    setPerimeterDraft([]);
    setDrawingPerimeter(false);
    setEditingPerimeter(false);
    onNotify('Cambios del perímetro descartados');
  };

  if (selectedRack) return <Rack3DView
    rack={selectedRack}
    locations={rackLocations}
    selected={selected?.rack_id === selectedRack.id ? selected : null}
    products={products}
    warehouseId={warehouse.id}
    isAdmin={isAdmin}
    editing={editMode}
    saving={saving}
    onBack={() => { setSelectedRackId(null); onSelect(null); }}
    onSelect={onSelect}
    onMoveStock={onMoveStock}
    onSaveExpected={onSaveExpected}
    onSaveLocationName={onSaveLocationName}
    onChange={(field, value) => updateRack(selectedRack.id, field, value)}
    onDelete={() => removeRack(selectedRack)}
    onSave={() => void saveLayout()}
    onDiscard={discardChanges}
  />;

  return <>
    <PageIntro eyebrow="PLANO CENITAL 2D" title="Mapa del almacén" description="Selecciona una estantería para abrir su visor 3D interactivo." actions={<>
      <button className="button button-secondary" onClick={() => downloadCsv('ubicaciones.csv', [['Ubicación', 'Zona', 'Pasillo', 'Estantería', 'Nivel', 'Unidades'], ...locations.map((location) => [location.code, location.zone, location.aisle, location.rack, location.level_number === 0 ? 'Suelo' : location.level_number, location.quantity])])}><Download size={16} /> Exportar CSV</button>
      {isAdmin && (editMode ? <><button className="button button-secondary" disabled={saving} onClick={discardChanges}>Descartar cambios</button><button className="button button-primary" disabled={saving || drawingPerimeter || drawingStructureType !== null} title={drawingPerimeter || drawingStructureType ? 'Finaliza o cancela el dibujo activo' : undefined} onClick={() => void saveLayout()}><Check size={16} /> {saving ? 'Guardando…' : 'Guardar y salir'}</button></> : <button className="button button-primary" onClick={startEditing}><Pencil size={15} /> Editar plano</button>)}
    </>} />
    <div className="map-summary"><div className="map-summary-item"><span className="map-dot occupied" />Ubicaciones ocupadas <strong>{occupied}</strong></div><div className="map-summary-item"><span className="map-dot in-use" />En uso <strong>{inUse}</strong></div><div className="map-summary-item"><span className="map-dot available" />Vacías <strong>{available}</strong></div><div className="map-summary-item"><Layers size={14} />Estanterías <strong>{activeRacks.length}</strong></div><div className="map-summary-spacer" /><div className="map-floor"><Building2 size={15} /> {warehouse.name}</div></div>
    <div className="map-layout">
      {isAdmin && editMode && <aside className="map-toolbox panel"><span className="eyebrow">PLANO DEL ALMACÉN</span><h3>Dimensiones</h3>
        <div className="warehouse-dimensions"><label>Ancho (cm)<input type="number" min="520" max="30000" step="50" value={number(warehouseDraft.map_width)} onChange={(event) => setWarehouseDraft((current) => ({ ...current, map_width: Number(event.target.value) }))} /></label><label>Fondo (cm)<input type="number" min="340" max="30000" step="50" value={number(warehouseDraft.map_height)} onChange={(event) => setWarehouseDraft((current) => ({ ...current, map_height: Number(event.target.value) }))} /></label></div>
        <div className="perimeter-tools">
          {!drawingPerimeter
            ? <button className="button button-secondary full-button" disabled={drawingStructureType !== null} onClick={startPerimeterEdit}>{perimeter.length ? 'Editar perímetro' : 'Dibujar perímetro'}</button>
            : <>
              <span className="map-tool-hint">{editingPerimeter ? 'Arrastra los vértices para moverlos o pulsa para añadir otro.' : 'Haz clic para añadir vértices y pulsa el primero para cerrar.'} Los puntos se ajustan a la cuadrícula (1 m); las líneas pueden ser diagonales.</span>
              <button className="button button-primary full-button" onClick={finishPerimeter}>Finalizar plano</button>
              <button className="button button-secondary full-button" disabled={!perimeterDraft.length} onClick={() => setPerimeterDraft((points) => points.slice(0, -1))}>Deshacer punto</button>
              <button className="button button-secondary full-button" onClick={discardPerimeterEdit}>Descartar cambios del perímetro</button>
            </>}
          <button className="button button-secondary full-button" onClick={exportPlan}><Download size={14} /> Exportar plano JSON</button>
          <button className="button button-secondary full-button" onClick={() => perimeterFileRef.current?.click()}><Upload size={14} /> Cargar plano JSON</button>
          <input ref={perimeterFileRef} className="perimeter-file-input" type="file" accept="application/json,.json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importPlan(file); }} />
        </div>
        <div className="perimeter-tools">
          <strong className="map-tool-hint">Paredes y puertas interiores</strong>
          <button className={`button ${drawingStructureType === 'wall' ? 'button-primary' : 'button-secondary'} full-button`} disabled={drawingPerimeter} onClick={() => setStructureDrawingMode('wall')}>{drawingStructureType === 'wall' ? 'Finalizar paredes' : 'Dibujar pared'}</button>
          <button className={`button ${drawingStructureType === 'door' ? 'button-primary' : 'button-secondary'} full-button`} disabled={drawingPerimeter} onClick={() => setStructureDrawingMode('door')}>{drawingStructureType === 'door' ? 'Finalizar puertas' : 'Marcar puerta'}</button>
          {drawingStructureType && <span className="map-tool-hint">Arrastra en el plano para dibujar un tramo horizontal o vertical de al menos 1 m. Dibuja la pared en segmentos y deja el hueco para la puerta.</span>}
          {selectedStructureId && !drawingStructureType && <button className="button button-danger full-button" onClick={removeSelectedStructure}><Trash2 size={14} /> Eliminar {structureDraft.find((structure) => structure.id === selectedStructureId)?.type === 'door' ? 'puerta' : 'pared'}</button>}
        </div>
        <div className="map-tool-hint">El perímetro se guarda junto al plano del almacén; las estanterías siguen gestionándose con el flujo actual.</div>
        <div className="map-tool-hint">Arrastra estanterías para moverlas y usa el tirador de la esquina inferior derecha para cambiar su tamaño. No pueden salir del perímetro.</div>
        <div className="map-tool-hint">Ajuste magnético activo: posiciones y tamaños se alinean a la cuadrícula de 1 m.</div>
        <div className="rack-template" draggable onDragStart={(event) => event.dataTransfer.setData('application/stockflow-map-element', 'rack')}><div className="rack-template-icon"><Layers size={19} /></div><span><strong>Estantería</strong><small>Añadir directamente al plano</small></span><Plus size={16} /></div>
        <button className="button button-secondary full-button rack-create-button" onClick={() => openRackWizard()}><Plus size={15} /> Añadir estantería</button>
        <div className="map-tool-note"><ShieldCheck size={14} /> Las estanterías quedan dentro del perímetro del almacén.</div>
        <div className="map-tool-note"><ShieldCheck size={14} /> Las estanterías no pueden solaparse con paredes ni puertas.</div>
      </aside>}
      <section className="panel map-panel"><div className="map-panel-heading"><div><h2>{warehouse.name}</h2><p>{activeRacks.length} estanterías <span>·</span> {locations.length} ubicaciones</p></div><div className="zoom-controls"><button aria-label="Alejar" title="Alejar" onClick={() => setZoom((value) => Math.max(.05, Math.round((value - .1) * 100) / 100))}><ZoomOut size={15} /></button><span>{Math.round(zoom * 100)}%</span><button aria-label="Acercar" title="Acercar" onClick={() => setZoom((value) => Math.min(1.6, Math.round((value + .1) * 100) / 100))}><ZoomIn size={15} /></button></div></div>
        <div ref={mapViewportRef} className="map-canvas-wrap">
          <div className="map-zoom-frame" style={{ width: zoomedWidth, height: zoomedHeight }}>
            <WarehouseMap2D
              width={canvasWidth}
              height={canvasHeight}
              zoom={zoom}
              racks={activeRacks}
              locations={locations}
              structures={activeStructures}
              selectedRackId={selectedRackId}
              selectedStructureId={selectedStructureId}
              editing={editMode && isAdmin}
              drawingStructureType={drawingStructureType}
              perimeter={perimeter}
              perimeterDraft={perimeterDraft}
              drawingPerimeter={drawingPerimeter}
              editingPerimeter={editingPerimeter}
              canvasRef={canvasRef}
              onSelectRack={(rackId) => { setSelectedRackId(rackId); setSelectedStructureId(null); onSelect(null); }}
              onMoveRack={(rackId, x, y) => {
                const rack = activeRacks.find((item) => item.id === rackId);
                if (!rack) return;
                const nextX = Math.min(x, Math.max(0, canvasWidth - number(rack.map_width)));
                const nextY = Math.min(y, Math.max(0, canvasHeight - number(rack.map_height)));
                if (!isRackWithinPerimeter({
                  x: nextX, y: nextY, width: number(rack.map_width), height: number(rack.map_height)
                }, perimeter)) return;
                if (rackOverlapsStructures({
                  x: nextX, y: nextY, width: number(rack.map_width), height: number(rack.map_height)
                }, activeStructures)) return;
                updateRack(rackId, 'map_x', nextX);
                updateRack(rackId, 'map_y', nextY);
              }}
              onResizeRack={(rackId, width, height) => {
                const rack = activeRacks.find((item) => item.id === rackId);
                if (!rack) return;
                const nextWidth = Math.max(220, Math.min(2000, canvasWidth - number(rack.map_x), Math.round(width)));
                const nextHeight = Math.max(130, Math.min(1200, canvasHeight - number(rack.map_y), Math.round(height)));
                if (!isRackWithinPerimeter({
                  x: number(rack.map_x), y: number(rack.map_y), width: nextWidth, height: nextHeight
                }, perimeter)) return;
                if (rackOverlapsStructures({
                  x: number(rack.map_x), y: number(rack.map_y), width: nextWidth, height: nextHeight
                }, activeStructures)) return;
                updateRack(rackId, 'map_width', nextWidth);
                updateRack(rackId, 'map_height', nextHeight);
              }}
              onDropRack={addElementAt}
              onAddPerimeterPoint={(point) => setPerimeterDraft((points) => [...points, point])}
              onMovePerimeterPoint={(index, point) => setPerimeterDraft((points) => {
                const next = points.map((current, position) => position === index ? point : current);
                return next.length < 3 || activeRacks.every((rack) => isRackWithinPerimeter({
                  x: number(rack.map_x), y: number(rack.map_y),
                  width: number(rack.map_width), height: number(rack.map_height)
                }, next)) ? next : points;
              })}
              onFinishPerimeter={finishPerimeter}
              onAddStructure={addStructure}
              onSelectStructure={(structureId) => {
                setSelectedStructureId(structureId);
                setSelectedRackId(null);
                onSelect(null);
              }}
            />
          </div>
        </div>
        <div className="map-footer"><span><ShieldCheck size={15} />{editMode ? 'Cambios pendientes: guarda o descarta para salir' : 'Estanterías y perímetro vinculados al almacén'}</span><span>{canvasWidth} × {canvasHeight} cm</span></div>
      </section>
      <aside className="panel location-panel">
        {selected ? <><div className="location-heading"><div><span className="eyebrow">UBICACIÓN</span><h2>{selected.code}</h2></div><button className="icon-button" aria-label="Cerrar ubicación" onClick={() => onSelect(null)}><X size={17} /></button></div><div className="location-stats"><div><span>Unidades</span><strong>{formatNumber(selected.quantity)}</strong></div><div><span>Ubicación</span><strong>{selected.level_number === 0 ? 'Suelo' : `Nivel ${selected.level_number}`}</strong></div></div><div className="location-products">{selected.products.map((product) => <div className="location-product" key={`${product.productId}-${product.lot}`}><div><strong>{product.name}</strong><small>{product.sku}</small></div><b>{formatNumber(product.quantity)} uds.</b></div>)}{!selected.products.length && <div className="location-empty">Ubicación disponible.</div>}</div><button className="button button-primary full-button" onClick={() => onMoveStock(selected)}><ArrowLeftRight size={16} /> Mover stock</button></>
          : <div className="location-placeholder"><div className="placeholder-icon"><Map size={21} /></div><h3>Selecciona una estantería</h3><p>Elige una estantería del plano para consultar sus niveles y ubicaciones en 3D.</p></div>}
      </aside>
    </div>
    {rackWizard && <Modal title="Diseña tu estantería" onClose={() => setRackWizard(null)}>
      <RackCreationForm initialAisleId={rackWizard.aisleId} initialWidth={Math.min(480, canvasWidth, 2000)} initialDepth={Math.min(280, canvasHeight, 1200)} maxWidth={Math.min(2000, canvasWidth)} maxDepth={Math.min(canvasHeight, 1200)} existingCodes={rackDraft.map((rack) => rack.code)} onSubmit={createRackDraft} onCancel={() => setRackWizard(null)} />
    </Modal>}
  </>;
}

function MovementsPage({ movements, onAdd, onExport }: { movements: Movement[]; onAdd: () => void; onExport: () => void }) {
  const [filter, setFilter] = useState('Todos');
  const filtered = movements.filter((movement) => {
    if (filter === 'Entradas') return movement.type === 'receipt' || movement.type === 'return';
    if (filter === 'Salidas') return movement.type === 'dispatch' || movement.type === 'in_use';
    if (filter === 'Transferencias') return movement.type === 'transfer';
    return true;
  });
  return <>
    <PageIntro eyebrow="TRAZABILIDAD Y KARDEX" title="Movimientos" description="Historial de entradas, salidas, transferencias, artículos en uso y devoluciones." actions={<><button className="button button-secondary" onClick={onExport}><Download size={16} /> Exportar</button><button className="button button-primary" onClick={onAdd}><Plus size={17} /> Registrar movimiento</button></>} />
    <section className="panel movement-history"><div className="inventory-toolbar"><div className="filter-tabs">{['Todos', 'Entradas', 'Salidas', 'Transferencias'].map((name) => <button key={name} className={filter === name ? 'active' : ''} onClick={() => setFilter(name)}>{name}</button>)}</div><div className="inventory-tools"><span>{filtered.length} movimientos</span></div></div><MovementTable movements={filtered} /><div className="table-footer"><span>Mostrando <strong>{filtered.length}</strong> movimientos</span><span><ShieldCheck size={14} /> Registro auditado</span></div></section>
  </>;
}

function AssistantPage() {
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState<{ role: 'user' | 'assistant'; text: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const ask = async (text: string) => {
    if (!text.trim() || busy) return;
    setMessages((old) => [...old, { role: 'user', text }]);
    setQuestion('');
    setBusy(true);
    try {
      const result = await request<{ answer: string }>('/assistant', { method: 'POST', body: JSON.stringify({ question: text }) });
      setMessages((old) => [...old, { role: 'assistant', text: result.answer }]);
    } catch (reason) {
      setMessages((old) => [...old, { role: 'assistant', text: reason instanceof Error ? reason.message : 'No se pudo consultar el almacén.' }]);
    } finally {
      setBusy(false);
    }
  };
  return <>
    <PageIntro eyebrow="INTELIGENCIA PARA TU ALMACÉN" title="Asistente de almacén" description="Consulta existencias, ubicaciones y alertas usando lenguaje natural." />
    <section className="assistant-layout">
      <div className="panel assistant-chat">
        <div className="assistant-heading"><div className="assistant-avatar"><Sparkles size={18} /></div><div><strong>Stockflow AI</strong><span><i /> Conectado a los datos del almacén</span></div><span className="beta-tag">BETA</span></div>
        <div className="chat-messages">
          <div className="chat-message assistant-message"><div className="assistant-avatar small"><Sparkles size={14} /></div><div><span>¡Hola, Alex! Soy tu asistente de almacén. Puedo ayudarte a encontrar productos, revisar niveles de stock y detectar lotes próximos a caducar.</span><small>Asistente · ahora</small></div></div>
          {messages.map((message, index) => <div key={index} className={`chat-message ${message.role === 'user' ? 'user-message' : 'assistant-message'}`}>{message.role === 'assistant' && <div className="assistant-avatar small"><Sparkles size={14} /></div>}<div><span>{message.text}</span>{message.role === 'assistant' && <small>Asistente · ahora</small>}</div></div>)}
          {busy && <div className="typing-indicator"><span /><span /><span /> Consultando datos del almacén…</div>}
        </div>
        {messages.length === 0 && <div className="suggestion-row">{['¿Qué productos están bajo mínimos?', '¿Qué lotes caducan pronto?', '¿Dónde está el SKU-1001?'].map((example) => <button key={example} onClick={() => void ask(example)}>{example}<ArrowUpRight size={13} /></button>)}</div>}
        <form className="chat-input" onSubmit={(e) => { e.preventDefault(); void ask(question); }}><input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Pregunta sobre tu almacén..." /><button disabled={!question.trim() || busy} aria-label="Enviar pregunta"><ArrowUpRight size={17} /></button></form>
        <div className="ai-disclaimer"><ShieldCheck size={13} /> El asistente consulta el stock y el catálogo, pero no ejecuta operaciones.</div>
      </div>
      <aside className="assistant-side"><div className="assistant-info-icon"><Sparkles size={18} /></div><h3>Tu almacén, en palabras</h3><p>Obtén respuestas rápidas con los datos actuales de inventario y ubicaciones.</p><div className="capability"><Check size={15} /><span>Consulta de stock y ubicaciones</span></div><div className="capability"><Check size={15} /><span>Alertas de reposición</span></div><div className="capability"><Check size={15} /><span>Seguimiento de caducidades</span></div><div className="assistant-note"><CircleHelp size={15} /><span>Respuestas locales por defecto. Configura OPENAI_API_KEY para activar el modelo generativo, enviando una pregunta y un contexto limitado de inventario.</span></div></aside>
    </section>
  </>;
}

function Modal({ title, onClose, children, wide = false, error = '' }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; error?: string }) {
  return <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><section className={`modal ${wide ? 'wide' : ''}`}><div className="modal-heading"><div><span className="eyebrow">GESTIÓN DE ALMACÉN</span><h2>{title}</h2></div><button className="icon-button" onClick={onClose} aria-label="Cerrar"><X size={18} /></button></div>{error && <p className="form-error movement-submit-error" role="alert">{error}</p>}{children}</section></div>;
}

function BulkReceiptForm({ products, locations, saving, onSubmit, onCancel }: {
  products: Product[];
  locations: Location[];
  saving: boolean;
  onSubmit: (reference: string, lines: { sku: string; name: string; binId: string; quantity: number; lotCode?: string; expiresAt?: string }[]) => void;
  onCancel: () => void;
}) {
  type ImportRow = {
    lineNumber: number; sku: string; productName: string; isNew: boolean; locationCode: string;
    quantity: number; lotCode: string; expiresAt: string; binId: string; error: string;
  };
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [fileError, setFileError] = useState('');
  const [reference, setReference] = useState('');
  const validRows = rows.filter((row) => !row.error);
  const invalidRows = rows.filter((row) => row.error);

  const handleFile = async (file?: File) => {
    setRows([]);
    setFileError('');
    setFileName(file?.name ?? '');
    if (!file) return;
    try {
      const csvRows = parseCsv(await file.text());
      if (csvRows.length < 2) throw new Error('El CSV debe incluir una cabecera y al menos una línea.');
      const headers = csvRows[0].map(normalizeCsvHeader);
      const indexOf = (...names: string[]) => headers.findIndex((header) => names.includes(header));
      const skuIndex = indexOf('sku');
      const nameIndex = indexOf('nombre', 'producto', 'nombre producto');
      const locationIndex = indexOf('ubicacion', 'location', 'codigo ubicacion', 'codigo de ubicacion');
      const quantityIndex = indexOf('cantidad', 'quantity');
      const lotIndex = indexOf('lote', 'lot');
      const expiryIndex = indexOf('caducidad', 'expiresat', 'expiry');
      if (skuIndex < 0 || locationIndex < 0 || quantityIndex < 0)
        throw new Error('Faltan columnas obligatorias: SKU, Ubicación y Cantidad.');
      const dataRows = csvRows.slice(1);
      if (dataRows.length > 500) throw new Error('El archivo supera el límite de 500 líneas por importación.');

      const productBySku = new globalThis.Map(products.filter((product) => product.active !== false).map((product) => [product.sku.trim().toLocaleUpperCase('es'), product]));
      const locationByCode = new globalThis.Map(locations.map((location) => [location.code.trim().toLocaleUpperCase('es'), location]));
      const newProductsBySku = new globalThis.Map<string, { sku: string; name: string }>();
      setRows(dataRows.map((cells, index) => {
        const sku = (cells[skuIndex] ?? '').trim();
        const suppliedName = nameIndex >= 0 ? (cells[nameIndex] ?? '').trim() : '';
        const locationCode = (cells[locationIndex] ?? '').trim();
        const quantityText = (cells[quantityIndex] ?? '').trim();
        const quantity = Number(quantityText.replace(',', '.'));
        const lotCode = lotIndex >= 0 ? (cells[lotIndex] ?? '').trim() : '';
        const expiresAt = expiryIndex >= 0 ? (cells[expiryIndex] ?? '').trim() : '';
        const product = productBySku.get(sku.toLocaleUpperCase('es'));
        let resolvedSku = product?.sku ?? sku;
        let productName = product?.name ?? suppliedName;
        const isNew = !product && Boolean(sku && suppliedName);
        const location = locationByCode.get(locationCode.toLocaleUpperCase('es'));
        const errors = [];
        if (!sku) errors.push('Falta el SKU');
        else if (!product && !suppliedName) errors.push(`El SKU nuevo ${sku} necesita un nombre de producto`);
        else if (!product && suppliedName.length < 2) errors.push('El nombre del producto debe tener al menos 2 caracteres');
        if (isNew) {
          const skuKey = sku.toLocaleUpperCase('es');
          const previous = newProductsBySku.get(skuKey);
          if (previous && previous.name !== suppliedName) errors.push(`El SKU ${sku} tiene nombres distintos en el archivo`);
          else if (previous) {
            resolvedSku = previous.sku;
            productName = previous.name;
          } else newProductsBySku.set(skuKey, { sku, name: suppliedName });
        }
        if (!locationCode) errors.push('Falta la ubicación');
        else if (!location) errors.push(`No existe la ubicación ${locationCode}`);
        else if (location.status !== 'active') errors.push('La ubicación está bloqueada');
        else if (location.in_use) errors.push('La ubicación está reservada En uso');
        if (!quantityText || !Number.isFinite(quantity) || quantity <= 0) errors.push('La cantidad debe ser mayor que cero');
        if (expiresAt && !lotCode) errors.push('La caducidad requiere un lote');
        if (expiresAt && (Number.isNaN(Date.parse(expiresAt)) || new Date(expiresAt).toISOString().slice(0, 10) !== expiresAt))
          errors.push('La fecha debe tener formato AAAA-MM-DD');
        return {
          lineNumber: index + 2, sku: resolvedSku, productName, isNew, locationCode,
          quantity, lotCode, expiresAt, binId: location?.id ?? '',
          error: errors.join(' · ')
        };
      }));
    } catch (reason) {
      setFileError(reason instanceof Error ? reason.message : 'No se pudo leer el archivo CSV');
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!rows.length || rows.some((row) => row.error)) return;
    onSubmit(reference, validRows.map(({ sku, productName, binId, quantity, lotCode, expiresAt }) => ({
      sku, name: productName, binId, quantity, lotCode: lotCode || undefined, expiresAt: expiresAt || undefined
    })));
  };

  return <form className="form-grid bulk-receipt-form" onSubmit={submit}>
    <div className="bulk-import-instructions">
      <strong>Prepara productos y ubicaciones en una hoja de cálculo y carga todo de una vez.</strong>
      <span>Columnas principales: SKU, Ubicación y Cantidad. Añade Nombre cuando quieras crear un SKU nuevo; los productos existentes conservan el nombre del catálogo. Lote y Caducidad (AAAA-MM-DD) son opcionales. Las altas nuevas usan unidad «ud» y stock mínimo 0. Usa el código exacto de ubicación y separa con punto y coma o coma.</span>
      <button type="button" className="text-button" onClick={() => downloadCsv('plantilla-entrada-masiva.csv', [['SKU', 'Nombre', 'Ubicación', 'Cantidad', 'Lote', 'Caducidad']])}><Download size={14} /> Descargar plantilla CSV</button>
    </div>
    <label>Archivo CSV<input type="file" accept=".csv,text/csv" onChange={(event) => void handleFile(event.currentTarget.files?.[0])} /></label>
    {fileName && <small className="field-help">Archivo: {fileName}</small>}
    {fileError && <p className="form-error" role="alert">{fileError}</p>}
    {rows.length > 0 && <div className="bulk-import-preview">
      <div className="bulk-import-summary"><strong>{validRows.length} de {rows.length} líneas válidas</strong><span>La importación solo se hará si todas las líneas son válidas.</span></div>
      <div className="table-wrap"><table><thead><tr><th>LÍNEA</th><th>SKU / PRODUCTO</th><th>UBICACIÓN</th><th>CANTIDAD</th><th>VALIDACIÓN</th></tr></thead><tbody>
        {rows.slice(0, 12).map((row) => <tr key={row.lineNumber}><td>{row.lineNumber}</td><td><strong>{row.sku}</strong><small className="table-secondary">{row.productName}{row.isNew ? ' · Se creará' : ' · Existente'}</small></td><td>{row.locationCode}</td><td>{Number.isFinite(row.quantity) ? formatQuantity(row.quantity) : '—'}</td><td className={row.error ? 'bulk-import-error' : 'bulk-import-valid'}>{row.error || (row.isNew ? 'Producto nuevo' : 'Lista')}</td></tr>)}
      </tbody></table></div>
      {rows.length > 12 && <small className="field-help">Se muestran las primeras 12 líneas; el archivo completo se ha validado.</small>}
      {invalidRows.length > 0 && <div className="bulk-import-issues" role="alert">
        {invalidRows.slice(0, 20).map((row) => <span key={row.lineNumber}>Línea {row.lineNumber}: {row.error}</span>)}
        {invalidRows.length > 20 && <span>Y {invalidRows.length - 20} errores más. Corrige el archivo y vuelve a cargarlo.</span>}
      </div>}
    </div>}
    <label>Albarán o referencia común (opcional)<input maxLength={120} value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Ej. Inventario inicial 2026" /></label>
    <div className="form-actions"><button type="button" className="button button-secondary" onClick={onCancel}>Cancelar</button><button type="submit" className="button button-primary" disabled={saving || !rows.length || rows.some((row) => row.error)}>{saving ? 'Importando…' : <><Upload size={15} /> Registrar {rows.length} líneas</>}</button></div>
  </form>;
}

function ProductForm({ initial, categories, suppliers, onSubmit, onCancel }: { initial: Product | null; categories: CatalogOption[]; suppliers: CatalogOption[]; onSubmit: (event: FormEvent<HTMLFormElement>) => void; onCancel: () => void }) {
  return <form className="form-grid" onSubmit={onSubmit}>
    <label>SKU <input required name="sku" placeholder="SKU-1006" defaultValue={initial?.sku ?? ''} /></label>
    <label>Nombre del producto <input required name="name" placeholder="Nombre descriptivo" defaultValue={initial?.name ?? ''} /></label>
    <label>Código de barras (opcional) <input name="barcode" placeholder="Escanea la etiqueta del producto" defaultValue={initial?.barcode ?? ''} /><small className="field-help">Si el producto trae código EAN/UPC, escanéalo o escríbelo. Si no tiene, déjalo vacío: el SKU sirve para identificarlo.</small></label>
    <div className="form-row"><label>Categoría<select name="category_id" defaultValue={initial?.category_id ?? ''}><option value="">Sin categoría</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label><label>Proveedor<select name="supplier_id" defaultValue={initial?.supplier_id ?? ''}><option value="">Sin proveedor</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label></div>
    <div className="form-row"><label>Unidad <input name="unit_of_measure" defaultValue={initial?.unit_of_measure ?? 'ud'} /></label><label>Stock mínimo <input name="min_stock" type="number" min="0" step="1" defaultValue={initial?.min_stock ?? 0} /></label></div>
    <div className="form-actions"><button type="button" className="button button-secondary" onClick={onCancel}>Cancelar</button><button className="button button-primary">{initial ? <Check size={16} /> : <Plus size={16} />} {initial ? 'Guardar cambios' : 'Crear producto'}</button></div>
  </form>;
}

function MovementForm({ products, locations, racks, warehouses, inUseLoans, currentWarehouseId, isAdmin, initialType, initialFromBinId, saving, onSubmit, onCancel }: {
  products: Product[]; locations: Location[]; racks: Rack[]; warehouses: Warehouse[];
  inUseLoans: InUseLoan[];
  currentWarehouseId: string; isAdmin: boolean; initialType?: string; initialFromBinId?: string;
  saving: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void; onCancel: () => void
}) {
  type MovementType = 'receipt' | 'dispatch' | 'transfer' | 'adjustment' | 'in_use' | 'return';
  type LocationRole = 'from' | 'to';
  const [type, setType] = useState<MovementType>(
    isAdmin ? (initialType as MovementType | undefined) ?? 'receipt' : initialType === 'return' ? 'return' : 'in_use'
  );
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [adjustmentDirection, setAdjustmentDirection] = useState<'increase' | 'decrease'>('increase');
  const [productId, setProductId] = useState('');
  const [loanId, setLoanId] = useState('');
  const [locationRole, setLocationRole] = useState<LocationRole>('from');
  const [fromBinId, setFromBinId] = useState('');
  const [toBinId, setToBinId] = useState('');
  const [destinationWarehouseId, setDestinationWarehouseId] = useState(currentWarehouseId);
  const [destinationLocations, setDestinationLocations] = useState(locations);
  const [destinationRacks, setDestinationRacks] = useState(racks);
  const [selectedRackId, setSelectedRackId] = useState('');
  const [loadingLocations, setLoadingLocations] = useState(false);
  const [locationsError, setLocationsError] = useState('');
  const selectedProduct = products.find((product) => product.id === productId);
  const selectedLoan = inUseLoans.find((loan) => loan.id === loanId);
  const preselectedRackId = initialFromBinId ? locations.find((location) => location.id === initialFromBinId)?.rack_id ?? '' : '';

  useEffect(() => {
    let active = true;
    if (type !== 'transfer' || destinationWarehouseId === currentWarehouseId) {
      setDestinationLocations(locations);
      setDestinationRacks(racks);
      setLocationsError('');
      setLoadingLocations(false);
      return;
    }
    setDestinationLocations([]);
    setDestinationRacks([]);
    setLocationsError('');
    setLoadingLocations(true);
    void Promise.all([
      request<Location[]>(`/locations?warehouseId=${encodeURIComponent(destinationWarehouseId)}`),
      request<Rack[]>(`/racks?warehouseId=${encodeURIComponent(destinationWarehouseId)}`)
    ]).then(([nextLocations, nextRacks]) => {
      if (!active) return;
      setDestinationLocations(nextLocations);
      setDestinationRacks(nextRacks);
    }).catch((reason) => {
      if (active) setLocationsError(reason instanceof Error ? reason.message : 'No se pudieron cargar las ubicaciones');
    }).finally(() => {
      if (active) setLoadingLocations(false);
    });
    return () => { active = false; };
  }, [type, destinationWarehouseId, currentWarehouseId, locations, racks]);

  const firstLocationRole: LocationRole = type === 'receipt' || type === 'return' || (type === 'adjustment' && adjustmentDirection === 'increase')
    ? 'to'
    : 'from';
  const availableLocations = locationRole === 'from'
    ? locations
    : type === 'transfer' ? destinationLocations : locations;
  const availableRacks = locationRole === 'from'
    ? racks
    : type === 'transfer' ? destinationRacks : racks;
  const hasProduct = (location: Location) => location.products.some((item) => item.productId === productId && number(item.quantity) > 0);
  const isEmpty = (location: Location) => !location.products.some((item) => number(item.quantity) > 0);
  const eligibleLocations = availableLocations.filter((location) => {
    if (location.status !== 'active') return false;
    if (locationRole === 'from') return hasProduct(location);
    if (type === 'return') return location.id === selectedLoan?.original_bin_id;
    if (location.in_use) return false;
    if (location.id === fromBinId) return false;
    return hasProduct(location) || isEmpty(location);
  });
  const racksForProduct = availableRacks
    .filter((rack) => eligibleLocations.some((location) => location.rack_id === rack.id))
    .sort((left, right) => left.code.localeCompare(right.code, 'es'));
  const selectedRack = racksForProduct.find((rack) => rack.id === selectedRackId) ?? null;
  const selectedRackLocations = selectedRack
    ? availableLocations.filter((location) => location.rack_id === selectedRack.id)
    : [];
  const selectableRackLocations = selectedRackLocations.filter((location) => eligibleLocations.some((eligible) => eligible.id === location.id));
  const selectedSource = locations.find((location) => location.id === fromBinId);
  const selectedDestination = destinationLocations.find((location) => location.id === toBinId)
    ?? locations.find((location) => location.id === toBinId);
  const sourceLots = (selectedSource?.products ?? [])
    .filter((item) => item.productId === productId && number(item.quantity) > 0)
    .flatMap((item) => item.lot ? [{ code: item.lot, quantity: item.quantity }] : []);
  const choosesExistingLot = type === 'dispatch' || type === 'transfer' || type === 'in_use' || (type === 'adjustment' && adjustmentDirection === 'decrease');

  const beginLocationSelection = () => {
    setLocationRole(firstLocationRole);
    setSelectedRackId(firstLocationRole === 'from' ? preselectedRackId : '');
    setStep(3);
  };

  const chooseLocation = (location: Location) => {
    if (locationRole === 'from') {
      setFromBinId(location.id);
      if (type === 'transfer') {
        setLocationRole('to');
        setSelectedRackId('');
        return;
      }
    } else {
      setToBinId(location.id);
    }
    setStep(4);
  };

  const goBack = () => {
    if (step === 4) {
      if (type === 'transfer') {
        setLocationRole('to');
        setToBinId('');
      } else {
        setLocationRole(firstLocationRole);
        if (firstLocationRole === 'from') setFromBinId('');
        else setToBinId('');
      }
      setSelectedRackId('');
      setStep(3);
      return;
    }
    if (step === 3 && type === 'transfer' && locationRole === 'to') {
      setToBinId('');
      setLocationRole('from');
      setSelectedRackId(preselectedRackId);
      return;
    }
    if (step === 3) {
      setStep(2);
      setSelectedRackId('');
      return;
    }
    if (step === 2) setStep(1);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    if (step !== 4) {
      event.preventDefault();
      return;
    }
    onSubmit(event);
  };

  const roleLabel = locationRole === 'from' ? 'origen' : 'destino';
  const stepThreeLabel = type === 'transfer' ? `Ubicación de ${roleLabel}` : 'Ubicación';
  const stepNames = ['Movimiento', 'Producto', stepThreeLabel, 'Cantidad y lote'];
  return <form className="form-grid movement-wizard" onSubmit={handleSubmit}>
    <div className="movement-stepper">{stepNames.map((name, index) => {
      const stepNumber = index + 1;
      return <div key={`${stepNumber}-${name}`} className={`movement-step ${step === stepNumber ? 'current' : step > stepNumber ? 'complete' : ''}`}><span>{step > stepNumber ? <Check size={13} /> : stepNumber}</span><small>{name}</small></div>;
    })}</div>
    <input type="hidden" name="type" value={type} />
    <input type="hidden" name="productId" value={productId} />
    <input type="hidden" name="loanId" value={loanId} />
    <input type="hidden" name="fromBinId" value={fromBinId} />
    <input type="hidden" name="toBinId" value={toBinId} />
    <input type="hidden" name="destinationWarehouseId" value={destinationWarehouseId} />

    {step === 1 && <div className="movement-step-content">
      <label>¿Qué movimiento vas a registrar?<select value={type} onChange={(event) => {
        setType(event.target.value as MovementType);
        setProductId('');
        setLoanId('');
        setFromBinId('');
        setToBinId('');
        setSelectedRackId('');
        setLocationRole(event.target.value === 'receipt' || event.target.value === 'return' ? 'to' : 'from');
        setDestinationWarehouseId(currentWarehouseId);
        setAdjustmentDirection('increase');
      }}>{isAdmin
        ? <><option value="receipt">Entrada</option><option value="dispatch">Salida</option><option value="transfer">Transferencia</option><option value="adjustment">Ajuste de inventario</option><option value="in_use">En uso</option><option value="return">Devolución</option></>
        : <><option value="in_use">En uso</option><option value="return">Devolución</option></>}</select></label>
      {type === 'adjustment' && <label>Tipo de ajuste<select value={adjustmentDirection} onChange={(event) => setAdjustmentDirection(event.target.value as 'increase' | 'decrease')}><option value="increase">Incrementar stock</option><option value="decrease">Descontar stock</option></select></label>}
      <p className="form-hint">{type === 'transfer' ? 'Se elegirán primero la ubicación de origen y después la de destino. El mismo SKU debe existir en ambos almacenes.' : type === 'in_use' ? 'Se descontará el artículo del stock disponible y quedará pendiente de devolución.' : type === 'return' ? 'Elige un artículo pendiente; puedes registrar una devolución parcial.' : 'A continuación elegirás el producto y su ubicación en el almacén.'}</p>
      <div className="form-actions"><button type="button" className="button button-secondary" onClick={onCancel}>Cancelar</button><button type="button" className="button button-primary" onClick={() => setStep(2)}>Continuar <ChevronRight size={15} /></button></div>
    </div>}

    {step === 2 && <div className="movement-step-content">
      {type === 'return'
        ? <><label>Artículo pendiente<select value={loanId} onChange={(event) => {
          const nextLoan = inUseLoans.find((loan) => loan.id === event.target.value);
          setLoanId(event.target.value);
          setProductId(nextLoan?.product_id ?? '');
          setFromBinId('');
          setToBinId('');
          setSelectedRackId('');
        }}><option value="">Selecciona un artículo</option>{inUseLoans.map((loan) => <option key={loan.id} value={loan.id}>{loan.sku} · {loan.name} · pendientes: {formatQuantity(loan.remaining_quantity)} · {loan.original_location}</option>)}</select></label>{!inUseLoans.length && <small className="field-help">No hay artículos pendientes de devolución en este almacén.</small>}</>
        : <label>Producto<select value={productId} onChange={(event) => { setProductId(event.target.value); setFromBinId(''); setToBinId(''); setSelectedRackId(''); }}><option value="">Selecciona un producto</option>{products.map((product) => <option key={product.id} value={product.id}>{product.sku} · {product.name}</option>)}</select></label>}
      {(selectedProduct || selectedLoan) && <p className="form-hint">{type === 'return' ? <>Se devolverá <strong>{selectedLoan?.name}</strong> al stock de este almacén.</> : <>Selecciona después una estantería donde esté almacenado <strong>{selectedProduct?.name}</strong>. En entradas también podrás elegir un hueco vacío.</>}</p>}
      <div className="form-actions"><button type="button" className="button button-secondary" onClick={goBack}>Atrás</button><button type="button" className="button button-primary" disabled={type === 'return' ? !loanId : !productId} onClick={beginLocationSelection}>Elegir ubicación <ChevronRight size={15} /></button></div>
    </div>}

    {step === 3 && <div className="movement-location-step">
      <div className="movement-location-heading"><div><strong>Selecciona la estantería de {roleLabel}</strong><span>{selectedProduct?.sku ?? selectedLoan?.sku} · {selectedProduct?.name ?? selectedLoan?.name}</span></div>{type === 'transfer' && locationRole === 'to' && <label>Almacén de destino<select value={destinationWarehouseId} onChange={(event) => { setDestinationWarehouseId(event.target.value); setSelectedRackId(''); setToBinId(''); }}><option value="">Selecciona almacén</option>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name} · {warehouse.code}</option>)}</select></label>}</div>
      <div className="movement-location-layout">
        <div className="movement-rack-list">
          {loadingLocations && <div className="rack-list-message">Cargando estanterías…</div>}
          {locationsError && <div className="form-error">{locationsError}</div>}
          {!loadingLocations && !locationsError && racksForProduct.map((rack) => {
            const rackBins = eligibleLocations.filter((location) => location.rack_id === rack.id);
            const productBins = rackBins.filter(hasProduct).length;
            const emptyBins = rackBins.filter(isEmpty).length;
            return <button type="button" key={rack.id} className={`movement-rack-option ${selectedRackId === rack.id ? 'selected' : ''}`} onClick={() => setSelectedRackId(rack.id)}>
              <span><strong>{rack.name}</strong><small>{rack.zone} · Pasillo {rack.aisle} · {rack.code}</small></span>
              <small>{productBins} con producto{locationRole === 'to' ? ` · ${emptyBins} vacíos` : ''}</small>
            </button>;
          })}
          {!loadingLocations && !locationsError && !racksForProduct.length && <div className="rack-list-message">{locationRole === 'from'
            ? 'Este producto no tiene existencias en ubicaciones activas de este almacén.'
            : 'No hay ubicaciones activas compatibles. Libera un hueco o añade estanterías en el mapa.'}</div>}
        </div>
        <div className="movement-rack-view">
          {selectedRack ? <><div className="movement-rack-legend"><span><i className="product-bin-legend" /> Ubicación con este producto</span>{locationRole === 'to' && <span><i className={type === 'return' ? 'in-use-bin-legend' : 'empty-bin-legend'} /> {type === 'return' ? 'Ubicación original para devolver' : 'Hueco vacío disponible'}</span>}</div><div className="movement-rack-canvas"><Suspense fallback={<div className="rack3d-loading">Cargando estantería 3D…</div>}><RackViewer3D key={`${selectedRack.id}-${productId}`} rack={selectedRack} locations={selectedRackLocations} selectedId={null} productId={productId} selectableLocationIds={selectableRackLocations.map((location) => location.id)} showAllLocations onSelectProduct={(_storedProducts, rackLocation) => {
            const location = selectedRackLocations.find((item) => item.id === rackLocation.id);
            if (location) chooseLocation(location);
          }} /></Suspense></div><p className="movement-rack-hint">Haz clic en una caja resaltada para seleccionar la ubicación. Las cajas grises no se pueden elegir.</p></>
            : <div className="movement-rack-placeholder"><Package size={22} /><strong>Elige una estantería</strong><span>Las ubicaciones disponibles se resaltarán en el visor 3D.</span></div>}
        </div>
      </div>
      <div className="form-actions"><button type="button" className="button button-secondary" onClick={goBack}>Atrás</button>{type === 'transfer' && locationRole === 'to' && <span className="movement-stage-note">Origen: {selectedSource?.code ?? 'sin seleccionar'}</span>}</div>
    </div>}

    {step === 4 && <div className="movement-step-content">
      <div className="movement-location-summary">
        {fromBinId && <div><span>Origen</span><strong>{selectedSource ? locationLabel(selectedSource) : fromBinId}</strong></div>}
        {toBinId && <div><span>Destino</span><strong>{selectedDestination ? locationLabel(selectedDestination) : toBinId}</strong></div>}
      </div>
      <label>Cantidad<input required name="quantity" type="number" min="0.01" max={type === 'return' ? selectedLoan?.remaining_quantity : undefined} step="0.01" placeholder={type === 'return' ? String(selectedLoan?.remaining_quantity ?? '0') : '0'} defaultValue={type === 'return' ? selectedLoan?.remaining_quantity : undefined} autoFocus /></label>
        {toBinId && selectedDestination && isEmpty(selectedDestination) && <>
          <label>Nombre de la caja (opcional)<input name="binName" maxLength={100} placeholder="Ej. Caja azul · tornillería M8" /><small className="field-help">Se guardará en esta ubicación y aparecerá en el visor 3D.</small></label>
          <label>Tamaño de la caja<select name="binWidthUnits" defaultValue={selectedDestination.width_units}>
            {Array.from({ length: Math.min(12, (destinationRacks.find((rack) => rack.id === selectedDestination.rack_id)?.bins_per_level ?? 1) - selectedDestination.slot_position + 1) }, (_value, index) => index + 1).map((units) => <option key={units} value={units}>{units} {units === 1 ? 'hueco' : 'huecos'} seguidos</option>)}
          </select><small className="field-help">Se crea ocupando huecos contiguos a la derecha en la misma balda. Solo se puede hacer con huecos vacíos.</small></label>
        </>}
      {type === 'return'
        ? <p className="form-hint">Se conservará el lote original{selectedLoan?.lot_code ? ` ${selectedLoan.lot_code}` : ''} del artículo.</p>
        : choosesExistingLot
        ? <label>Lote (opcional; necesario para caducidad)<select name="lotCode" defaultValue=""><option value="">Automático (FIFO)</option>{sourceLots.map((lot) => <option key={lot.code} value={lot.code}>{lot.code} · {formatNumber(lot.quantity)} uds.</option>)}</select><small className="field-help">Déjalo en automático para descontar primero el lote más antiguo.</small></label>
        : <label>Lote (opcional; necesario para caducidad)<input name="lotCode" placeholder="Código impreso en el envase" /></label>}
      {type === 'receipt' && <label>Caducidad del lote (opcional)<input name="expiresAt" type="date" /><small className="field-help">Para guardar la caducidad, indica también el código de lote.</small></label>}
      <label>Albarán o referencia (opcional)<input name="reference" placeholder="Ej. ALB-2026-0042" /></label>
      <div className="form-actions"><button type="button" className="button button-secondary" onClick={goBack}>Atrás</button><button type="submit" className="button button-primary" disabled={saving}>{saving ? 'Guardando…' : <><Check size={16} /> Confirmar movimiento</>}</button></div>
    </div>}
  </form>;
}
