import { useState, type FormEvent, type ReactNode } from 'react';
import { ArrowDownLeft, Check, ChevronDown, ChevronRight, ClipboardList, Package, Plus, ShoppingCart, Trash2 } from 'lucide-react';

export type ReplenishmentItem = {
  id: string;
  sku: string;
  name: string;
  unit_of_measure: string;
  min_stock: string | number;
  supplier_id: string | null;
  supplier: string | null;
  available: string | number;
  on_order: string | number;
  suggested_quantity: string | number;
};

export type PurchaseOrderLine = {
  id: string;
  productId: string;
  sku: string;
  name: string;
  quantity: string | number;
  receivedQuantity: string | number;
};

export type PurchaseOrder = {
  id: string;
  supplier_id: string;
  supplier: string;
  status: 'ordered' | 'received' | 'cancelled';
  created_at: string;
  received_at: string | null;
  units: string | number;
  line_count: number;
  lines: PurchaseOrderLine[];
};

export type SalesOrderAllocation = {
  binId: string;
  location: string;
  lotCode: string | null;
  quantity: string | number;
  picked: boolean;
};

export type SalesOrderLine = {
  id: string;
  productId: string;
  sku: string;
  name: string;
  quantity: string | number;
  allocations: SalesOrderAllocation[];
};

export type SalesOrder = {
  id: string;
  customer_name: string;
  reference: string | null;
  status: 'pending' | 'picking' | 'fulfilled' | 'cancelled';
  created_at: string;
  fulfilled_at: string | null;
  units: string | number;
  lines: SalesOrderLine[];
};

export type OrderProduct = {
  id: string;
  sku: string;
  name: string;
  stock: string | number;
  reserved: string | number;
  unit_of_measure: string;
};

export type OrderLocation = {
  id: string;
  code: string;
  display_name: string | null;
  quantity: string | number;
  in_use: boolean;
  warehouse: string;
  zone: string;
  aisle: string;
  rack: string;
  level_number: number;
};

function amount(value: string | number) {
  return Number(value) || 0;
}

function quantity(value: string | number) {
  return new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 }).format(amount(value));
}

function orderCode(prefix: string, id: string) {
  return `${prefix}-${id.slice(0, 8).toUpperCase()}`;
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function PageIntro({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: ReactNode }) {
  return <div className="page-intro"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div><div className="intro-actions">{actions}</div></div>;
}

function StatusChip({ status }: { status: PurchaseOrder['status'] | SalesOrder['status'] }) {
  const labels: Record<typeof status, string> = {
    ordered: 'Pendiente',
    received: 'Recibido',
    cancelled: 'Cancelado',
    pending: 'Pendiente',
    picking: 'Preparando',
    fulfilled: 'Enviado'
  };
  return <span className={`business-status ${status}`}>{labels[status]}</span>;
}

export function PurchasingPage({ suggestions, orders, locations, isAdmin, onCreateOrder, onReceiveOrder, onCancelOrder }: {
  suggestions: ReplenishmentItem[];
  orders: PurchaseOrder[];
  locations: OrderLocation[];
  isAdmin: boolean;
  onCreateOrder: (lines: { productId: string; quantity: number }[]) => Promise<boolean>;
  onReceiveOrder: (orderId: string, lines: { lineId: string; binId: string; binName?: string; lotCode?: string; expiresAt?: string }[]) => Promise<boolean>;
  onCancelOrder: (orderId: string) => Promise<void>;
}) {
  const [tab, setTab] = useState<'replenishment' | 'orders'>('replenishment');
  const [selected, setSelected] = useState<string[]>([]);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [receivingOrder, setReceivingOrder] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedBins, setSelectedBins] = useState<Record<string, string>>({});
  const receivableLocations = locations.filter((location) => !location.in_use);

  const createOrder = async () => {
    const lines = suggestions
      .filter((item) => selected.includes(item.id) && item.supplier_id)
      .map((item) => ({ productId: item.id, quantity: Number(quantities[item.id] ?? item.suggested_quantity) }));
    if (!lines.length || lines.some((line) => !Number.isFinite(line.quantity) || line.quantity <= 0)) return;
    setBusy(true);
    try {
      if (await onCreateOrder(lines)) {
        setSelected([]);
        setQuantities({});
        setTab('orders');
      }
    } finally {
      setBusy(false);
    }
  };

  const receiveOrder = async (event: FormEvent<HTMLFormElement>, order: PurchaseOrder) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const lines = order.lines.map((line) => ({
      lineId: line.id,
      binId: String(data.get(`bin-${line.id}`) ?? ''),
      binName: String(data.get(`bin-name-${line.id}`) ?? '').trim() || undefined,
      lotCode: String(data.get(`lot-${line.id}`) ?? '').trim() || undefined,
      expiresAt: String(data.get(`expiry-${line.id}`) ?? '') || undefined
    }));
    if (lines.some((line) => !line.binId)) return;
    setBusy(true);
    try {
      if (await onReceiveOrder(order.id, lines)) setReceivingOrder(null);
    } finally {
      setBusy(false);
    }
  };

  const selectedOrder = orders.find((order) => order.id === receivingOrder);
  return <>
    <PageIntro eyebrow="COMPRAS Y REPOSICIÓN" title="Compras" description="Anticipa faltantes y convierte las sugerencias de reposición en pedidos a proveedores." actions={isAdmin && tab === 'replenishment' ? <button className="button button-primary" disabled={busy || !selected.length || selected.some((id) => !suggestions.find((item) => item.id === id)?.supplier_id)} onClick={() => void createOrder()}><ShoppingCart size={16} /> Crear pedidos seleccionados{selected.length ? ` (${selected.length})` : ''}</button> : undefined} />
    <section className="panel business-panel">
      <div className="inventory-toolbar business-toolbar">
        <div className="filter-tabs">
          <button className={tab === 'replenishment' ? 'active' : ''} onClick={() => { setTab('replenishment'); setReceivingOrder(null); }}>Reposición <span className="filter-count">{suggestions.length}</span></button>
          <button className={tab === 'orders' ? 'active' : ''} onClick={() => { setTab('orders'); setReceivingOrder(null); }}>Pedidos a proveedor <span className="filter-count">{orders.filter((order) => order.status === 'ordered').length}</span></button>
        </div>
        <span>{tab === 'replenishment' ? 'Stock disponible menos reservas y pedidos abiertos' : `${orders.length} pedidos registrados`}</span>
      </div>
      {tab === 'replenishment' ? <>
        <div className="table-wrap"><table><thead><tr>{isAdmin && <th /> }<th>PRODUCTO</th><th>PROVEEDOR</th><th>DISPONIBLE</th><th>EN PEDIDO</th><th>MÍNIMO</th><th>SUGERIDO</th></tr></thead><tbody>
          {suggestions.map((item) => {
            const checked = selected.includes(item.id);
            return <tr key={item.id}>
              {isAdmin && <td><input aria-label={`Seleccionar ${item.name}`} type="checkbox" disabled={!item.supplier_id} checked={checked} onChange={(event) => setSelected((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} /></td>}
              <td><strong className="table-primary">{item.name}</strong><span className="table-secondary">{item.sku}</span></td>
              <td>{item.supplier ?? <span className="business-warning">Asigna un proveedor</span>}</td>
              <td>{quantity(item.available)} {item.unit_of_measure}</td>
              <td>{quantity(item.on_order)} {item.unit_of_measure}</td>
              <td>{quantity(item.min_stock)} {item.unit_of_measure}</td>
              <td>{isAdmin && item.supplier_id
                ? <input className="business-quantity" aria-label={`Cantidad sugerida de ${item.name}`} type="number" min="0.01" step="0.01" value={quantities[item.id] ?? String(item.suggested_quantity)} onChange={(event) => setQuantities((current) => ({ ...current, [item.id]: event.target.value }))} />
                : `${quantity(item.suggested_quantity)} ${item.unit_of_measure}`}</td>
            </tr>;
          })}
          {!suggestions.length && <tr><td colSpan={isAdmin ? 7 : 6} className="table-empty"><Check size={18} /> Todo cubierto: no hay artículos que reponer.</td></tr>}
        </tbody></table></div>
        {!isAdmin && <div className="table-footer">Pide a un administrador que cree los pedidos a proveedores.</div>}
      </> : selectedOrder ? <form className="purchase-receive-form" onSubmit={(event) => void receiveOrder(event, selectedOrder)}>
        <div className="panel-heading"><div><h2>Recibir {orderCode('PO', selectedOrder.id)}</h2><p>{selectedOrder.supplier} · La recepción completa actualizará las existencias y el Kardex.</p></div><button type="button" className="button button-secondary" onClick={() => setReceivingOrder(null)}>Volver</button></div>
        <div className="table-wrap"><table><thead><tr><th>PRODUCTO</th><th>CANTIDAD</th><th>UBICACIÓN DE DESTINO</th><th>LOTE (OPCIONAL)</th><th>CADUCIDAD</th></tr></thead><tbody>
          {selectedOrder.lines.map((line) => <tr key={line.id}>
            <td><strong className="table-primary">{line.name}</strong><span className="table-secondary">{line.sku}</span></td>
            <td>{quantity(line.quantity)}</td>
            <td><select required name={`bin-${line.id}`} defaultValue="" onChange={(event) => setSelectedBins((current) => ({ ...current, [line.id]: event.target.value }))}><option value="" disabled>Selecciona ubicación</option>{receivableLocations.map((location) => <option key={location.id} value={location.id}>{location.display_name ? `${location.display_name} · ` : ''}{location.warehouse} · {location.zone} · {location.aisle} · {location.rack} · {location.level_number === 0 ? 'Suelo' : `N${location.level_number}`} · {location.code}</option>)}</select>
              {receivableLocations.find((location) => location.id === selectedBins[line.id] && amount(location.quantity) <= 0) && <label>Nombre de la caja (opcional)<input name={`bin-name-${line.id}`} maxLength={100} placeholder="Ej. Caja azul · tornillería M8" /></label>}
            </td>
            <td><input name={`lot-${line.id}`} maxLength={100} placeholder="Lote del fabricante" /></td>
            <td><input name={`expiry-${line.id}`} type="date" /></td>
          </tr>)}
        </tbody></table></div>
        <div className="business-form-footer"><button type="button" className="button button-secondary" onClick={() => setReceivingOrder(null)}>Cancelar</button><button className="button button-primary" disabled={busy || !receivableLocations.length}><ArrowDownLeft size={16} /> {busy ? 'Registrando…' : 'Confirmar recepción completa'}</button></div>
        {!receivableLocations.length && <p className="form-hint">{locations.length ? 'Todas las ubicaciones disponibles están reservadas por artículos En uso.' : 'Este almacén no tiene ubicaciones activas donde recibir mercancía.'}</p>}
      </form> : <div className="table-wrap"><table><thead><tr><th>PEDIDO</th><th>PROVEEDOR</th><th>ESTADO</th><th>LÍNEAS / UNIDADES</th><th>FECHA</th><th /></tr></thead><tbody>
        {orders.map((order) => <tr key={order.id}>
          <td><strong className="table-primary">{orderCode('PO', order.id)}</strong></td><td>{order.supplier}</td><td><StatusChip status={order.status} /></td>
          <td>{order.line_count} líneas · {quantity(order.units)} uds.</td><td>{dateLabel(order.created_at)}</td>
          <td><div className="business-actions">
            {order.status === 'ordered' && <>{isAdmin
              ? <button className="button button-secondary" disabled={!receivableLocations.length} onClick={() => { setSelectedBins({}); setReceivingOrder(order.id); }}><ArrowDownLeft size={14} /> Recibir</button>
              : <span className="business-muted">Recepción solo por administrador</span>}
              {isAdmin && <button className="row-menu" title="Cancelar pedido" aria-label={`Cancelar ${orderCode('PO', order.id)}`} onClick={() => void onCancelOrder(order.id)}><Trash2 size={14} /></button>}</>}
            {order.status !== 'ordered' && <span className="business-muted">{order.status === 'received' ? dateLabel(order.received_at ?? order.created_at) : '—'}</span>}
          </div></td>
        </tr>)}
        {!orders.length && <tr><td colSpan={6} className="table-empty">Aún no hay pedidos a proveedor.</td></tr>}
      </tbody></table></div>}
      {tab === 'orders' && !selectedOrder && <div className="table-footer"><span>Las recepciones completas generan automáticamente una entrada trazable en Movimientos.</span></div>}
    </section>
  </>;
}

export function SalesOrdersPage({ orders, products, locations, isAdmin, onCreateOrder, onStartPicking, onFulfill, onCancelOrder }: {
  orders: SalesOrder[];
  products: OrderProduct[];
  locations: OrderLocation[];
  isAdmin: boolean;
  onCreateOrder: (order: { customerName: string; reference?: string; lines: { productId: string; quantity: number }[] }) => Promise<boolean>;
  onStartPicking: (orderId: string) => Promise<void>;
  onFulfill: (orderId: string) => Promise<void>;
  onCancelOrder: (orderId: string) => Promise<void>;
}) {
  const [customerName, setCustomerName] = useState('');
  const [reference, setReference] = useState('');
  const [lines, setLines] = useState([{ productId: '', quantity: '1' }]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canSubmit = customerName.trim().length >= 2 && lines.length > 0 && lines.every((line) => line.productId && Number(line.quantity) > 0);

  const createOrder = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    try {
      const created = await onCreateOrder({
        customerName: customerName.trim(),
        reference: reference.trim() || undefined,
        lines: lines.map((line) => ({ productId: line.productId, quantity: Number(line.quantity) }))
      });
      if (created) {
        setCustomerName('');
        setReference('');
        setLines([{ productId: '', quantity: '1' }]);
      }
    } finally {
      setBusy(false);
    }
  };

  const changeLine = (index: number, field: 'productId' | 'quantity', value: string) => {
    setLines((current) => current.map((line, position) => position === index ? { ...line, [field]: value } : line));
  };

  return <>
    <PageIntro eyebrow="PEDIDOS Y PREPARACIÓN" title="Pedidos de salida" description="Reserva existencias, prepara una lista de picking por ubicación y registra la salida con trazabilidad." />
    <div className="sales-order-layout">
      <section className="panel sales-order-create">
        <div className="panel-heading"><div><h2>Nuevo pedido</h2><p>El stock se reserva al crear el pedido.</p></div><ClipboardList size={18} /></div>
        <form className="form-grid" onSubmit={(event) => void createOrder(event)}>
          <label>Cliente<input required minLength={2} maxLength={120} value={customerName} onChange={(event) => setCustomerName(event.target.value)} placeholder="Nombre del cliente" /></label>
          <label>Referencia del pedido (opcional)<input maxLength={120} value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Ej. PED-1042" /></label>
          <div className="sales-order-lines-heading"><strong>Productos</strong><button type="button" className="text-button" onClick={() => setLines((current) => [...current, { productId: '', quantity: '1' }])}><Plus size={14} /> Añadir línea</button></div>
          {lines.map((line, index) => {
            const product = products.find((item) => item.id === line.productId);
            const available = product ? amount(product.stock) - amount(product.reserved) : 0;
            return <div className="sales-order-line" key={index}>
              <label>Producto<select required value={line.productId} onChange={(event) => changeLine(index, 'productId', event.target.value)}><option value="" disabled>Selecciona producto</option>{products.map((item) => <option key={item.id} value={item.id} disabled={amount(item.stock) <= amount(item.reserved)}>{item.sku} · {item.name} · disponible {quantity(amount(item.stock) - amount(item.reserved))}</option>)}</select></label>
              <label>Cantidad<input required type="number" min="0.01" step="0.01" value={line.quantity} onChange={(event) => changeLine(index, 'quantity', event.target.value)} /></label>
              {lines.length > 1 && <button className="row-menu" type="button" title="Eliminar línea" aria-label="Eliminar línea" onClick={() => setLines((current) => current.filter((_, position) => position !== index))}><Trash2 size={14} /></button>}
              {product && Number(line.quantity) > available && <small className="business-warning sales-line-warning">Disponible: {quantity(available)} {product.unit_of_measure}</small>}
            </div>;
          })}
          <div className="business-form-footer"><button className="button button-primary" disabled={!canSubmit || busy}><Plus size={15} /> {busy ? 'Creando…' : 'Crear y reservar'}</button></div>
        </form>
      </section>

      <section className="panel sales-order-list">
        <div className="panel-heading"><div><h2>Pedidos recientes</h2><p>{orders.length} pedidos en este almacén</p></div><span className="filter-count">{orders.filter((order) => order.status === 'pending' || order.status === 'picking').length} activos</span></div>
        <div className="sales-orders">
          {orders.map((order) => <article className="sales-order-card" key={order.id}>
            <div className="sales-order-card-heading">
              <button className="sales-order-expand" onClick={() => setExpanded((current) => current === order.id ? null : order.id)} aria-expanded={expanded === order.id}>
                {expanded === order.id ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                <span><strong>{order.customer_name}</strong><small>{order.reference || orderCode('SO', order.id)} · {dateLabel(order.created_at)}</small></span>
              </button>
              <StatusChip status={order.status} />
            </div>
            <div className="sales-order-card-meta"><span>{order.lines.length} productos · {quantity(order.units)} uds.</span>
              {order.status === 'pending' && <button className="button button-secondary" disabled={busy} onClick={() => { setBusy(true); void onStartPicking(order.id).finally(() => setBusy(false)); }}><ClipboardList size={14} /> Preparar picking</button>}
              {order.status === 'picking' && (isAdmin
                ? <button className="button button-primary" disabled={busy} onClick={() => { setBusy(true); void onFulfill(order.id).finally(() => setBusy(false)); }}><Check size={14} /> Confirmar salida</button>
                : <span className="business-muted">Salida solo por administrador</span>)}
              {(order.status === 'pending' || order.status === 'picking') && <button className="row-menu" disabled={busy} title="Cancelar pedido" aria-label={`Cancelar pedido de ${order.customer_name}`} onClick={() => { setBusy(true); void onCancelOrder(order.id).finally(() => setBusy(false)); }}><Trash2 size={14} /></button>}
              {order.status === 'fulfilled' && <span className="business-muted">{order.fulfilled_at ? dateLabel(order.fulfilled_at) : ''}</span>}
            </div>
            {expanded === order.id && <div className="sales-order-detail">{order.lines.map((line) => <div className="sales-order-detail-line" key={line.id}>
              <span className="product-thumb thumb-0"><Package size={15} /></span>
              <span className="sales-order-detail-product"><strong>{line.name}</strong><small>{line.sku} · {quantity(line.quantity)} uds.</small>
                {line.allocations.map((allocation, index) => <small className="pick-location" key={`${allocation.binId}-${index}`}>{allocation.picked ? '✓ ' : ''}{allocation.location}{allocation.lotCode ? ` · Lote ${allocation.lotCode}` : ''} · {quantity(allocation.quantity)} uds.</small>)}
              </span>
            </div>)}</div>}
          </article>)}
          {!orders.length && <div className="table-empty">Aún no hay pedidos de salida.</div>}
        </div>
        {!locations.length && <div className="table-footer">Añade ubicaciones al almacén para poder crear pedidos con stock reservable.</div>}
      </section>
    </div>
  </>;
}
