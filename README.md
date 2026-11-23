# Stockflow WMS

Aplicación web de gestión de almacén: SPA en React + TypeScript, API REST en Express y base de datos relacional PostgreSQL. La API utiliza SQL explícito y consultas parametrizadas (`pg`); no usa ORM ni NoSQL.

## Requisitos

- Node.js 20 o superior
- Docker Desktop con Docker Compose

## Puesta en marcha

Desde la raíz del proyecto:

```powershell
Copy-Item .env.example .env
docker compose up -d db
npm install
npm run dev
```

La aplicación web estará en `http://localhost:5173` y la API en `http://localhost:3001`. La base de datos se inicializa automáticamente con el esquema, las migraciones SQL y los datos de demostración en el primer arranque del volumen. La API también aplica de forma idempotente las migraciones de sesiones, geometría, compras, nombre de ubicaciones, contenido esperado y cajas grandes al arrancar.

### Cuentas locales de demostración

| Rol | Usuario | Contraseña inicial |
|---|---|---|
| Administrador | `admin@stockflow.local` | `Stockflow2026!` |
| Empleado | `empleado@stockflow.local` | `Empleado2026!` |

Las contraseñas se guardan como hashes `scrypt`. Cambia ambas contraseñas desde **Configuración** antes de cargar información real. Las variables `ADMIN_PASSWORD` y `EMPLOYEE_PASSWORD` permiten establecer contraseñas de bootstrap en una base aún vacía; no sobrescriben cuentas que ya existan.

## Despliegue público: Vercel + Render + Neon

Vercel sirve la web estática; no ejecuta la API Express de este proyecto ni proporciona su PostgreSQL. La configuración de [`vercel.json`](./vercel.json) publica la SPA y redirige sus rutas a `index.html`; [`render.yaml`](./render.yaml) define la API como servicio Node en Render. PostgreSQL se aloja aparte, por ejemplo en Neon.

1. **Sube el proyecto a GitHub.** Vercel y Render necesitan un repositorio Git conectado. El archivo `.gitignore` excluye `.env`; no subas contraseñas ni cadenas de conexión.
2. **Crea una base PostgreSQL en Neon.** Copia su cadena de conexión, preferiblemente la URL pooled con SSL. La API crea el esquema, aplica las migraciones y prepara el primer usuario/almacén al arrancar; no es necesario ejecutar `seed.sql` en producción.
3. **Despliega la API en Render.** Crea un Blueprint desde el repositorio y usa `render.yaml`. En las variables secretas del servicio establece:
   - `DATABASE_URL`: cadena de conexión de Neon.
   - `ADMIN_PASSWORD` y `EMPLOYEE_PASSWORD`: contraseñas iniciales distintas, aleatorias y de al menos 12 caracteres. La API las exige si la base aún no tiene usuarios inicializados.
   - `CORS_ORIGINS`: dominio exacto de la web, por ejemplo `https://stockflow.vercel.app`, sin `/` final. Puedes separar varios dominios con comas.
   - `NODE_ENV=production` ya está definido en el Blueprint.
4. **Despliega la web en Vercel.** Importa el mismo repositorio, deja el directorio raíz del proyecto en la raíz del repositorio y configura `VITE_API_URL` como la URL de Render terminada en `/api` (por ejemplo, `https://stockflow-api.onrender.com/api`). Esta variable se incorpora a la web durante la compilación; después de cambiarla, vuelve a desplegar.
5. **Ajusta CORS y comprueba el servicio.** En Render, verifica que `CORS_ORIGINS` contiene el dominio de producción de Vercel y, si usas dominio propio, añádelo también. Comprueba `https://stockflow-api.onrender.com/api/health` y luego abre la web, inicia sesión y confirma que carga el almacén. Las cuentas iniciales son `admin@stockflow.local` y `empleado@stockflow.local`; cambia las contraseñas al entrar.

No pongas `DATABASE_URL`, contraseñas ni otros secretos en Vercel o en variables `VITE_*`: las variables `VITE_*` son públicas y quedan incluidas en el JavaScript. Render Free puede suspender la API cuando no se usa y tardar en responder al primer acceso; para uso diario, valora un servicio siempre activo y copias de seguridad de PostgreSQL. Imprime los QR desde el dominio público de Vercel para que los móviles abran la dirección correcta.

### Varios almacenes y transferencias

El administrador puede crear almacenes desde el selector de **Almacén activo**, en la barra lateral. Cada uno tiene su propio mapa, ubicaciones y existencias; el catálogo de productos se comparte para poder transferir mercancía entre ellos. Para mover stock, abre **Movimientos → Transferencia**, elige el almacén de destino y después su ubicación. El historial de la transferencia aparece en ambos almacenes.

### Compras, reposición y pedidos de salida

**Compras** calcula las sugerencias por almacén con el stock disponible (existencias menos reservas), el stock mínimo y las cantidades pendientes de pedidos a proveedor. El administrador puede seleccionar productos y crear pedidos; si hay varios proveedores, se genera un pedido por proveedor. Al recibir un pedido completo, se indica una ubicación por producto y opcionalmente lote/caducidad o nombre de caja si la ubicación está vacía. La recepción aumenta las existencias y crea una entrada trazable en el Kardex; esta primera versión no admite recepciones parciales. Los pedidos pendientes se pueden cancelar.

**Pedidos de salida** permite registrar un cliente y una referencia, añadir productos y reservar stock automáticamente por ubicación y lote. La lista de picking muestra las ubicaciones asignadas. Al confirmar la salida, se descuentan las reservas y existencias y se registra el movimiento de salida asociado al pedido. Un pedido pendiente o en preparación puede cancelarse para liberar sus reservas. Los nombres de cliente se guardan en cada pedido; todavía no existe un módulo de CRM ni una ficha central de clientes.

Las ubicaciones se describen con su ruta completa: almacén, zona, pasillo, estantería, nivel y hueco. El formulario de movimientos guía el registro en cuatro pasos: tipo, producto, ubicación(es) en el visor 3D y cantidad. En origen solo se pueden seleccionar huecos con ese producto; en destino se resaltan los huecos que ya lo contienen y también se permiten ubicaciones vacías para entradas y transferencias. Al guardar en una ubicación vacía se puede asignar un nombre opcional y elegir una caja de 1 a 4 huecos contiguos; se conserva en la ubicación y aparece en el visor 3D.

El código de barras del producto es opcional: se escanea la etiqueta EAN/UPC si existe; si no, se deja vacío y se usa el SKU. El lote es el código que figura en el envase y también puede dejarse vacío; sin lote indicado, las salidas descuentan primero el más antiguo. La referencia/albarán es opcional y sirve para guardar el número del documento del proveedor o pedido.

### Etiqueta QR y contenido esperado

En **Mapa almacén**, abre una estantería y usa **Imprimir etiquetas QR** para imprimir una única etiqueta. Al escanearla, la aplicación abre el visor 3D de toda la estantería, mostrando únicamente las cajas ocupadas; sus nombres no se superponen al código QR impreso. Se requiere iniciar sesión para consultar la información. La persona puede entrar con una cuenta existente o crear una cuenta de empleado indicando nombre o apodo, correo y contraseña dos veces. El registro público nunca crea administradores. Para acceder como administrador, cierra la sesión e inicia con el correo y la contraseña de una cuenta administradora ya existente.

Selecciona un hueco en el visor y, como administrador, elige **Editar contenido esperado** para asignar productos y cantidades exactas. El plan se guarda aparte y no modifica las existencias. La aplicación compara lo esperado con el stock real y señala faltantes, sobrantes o productos no previstos.

Para probar los QR desde un móvil en la misma red Wi-Fi:

1. En el PC que ejecuta Stockflow, consulta `ipconfig` y apunta la dirección IPv4 de su red local, por ejemplo `192.168.1.25`.
2. En `.env`, cambia `VITE_API_URL` a `http://192.168.1.25:3001/api` (usa tu propia IP) y reinicia `npm run dev`.
3. En el móvil, abre `http://192.168.1.25:5173`, inicia sesión y genera/imprime el QR desde esa dirección, no desde `localhost`.
4. Comprueba desde el móvil que `http://192.168.1.25:3001/api/health` muestra `{"status":"ok"}` y escanea la etiqueta. Si no carga, permite los puertos 5173 y 3001 en el Firewall de Windows para redes privadas y verifica que ambos dispositivos estén en la misma Wi-Fi.

`localhost` siempre se refiere al dispositivo que lo usa: al escanear un QR que contiene `localhost`, el móvil intenta conectarse a sí mismo, no al PC. No expongas estos puertos a Internet; para acceso remoto, despliega la aplicación detrás de HTTPS y usa direcciones accesibles desde los dispositivos. Las migraciones de la base de datos se aplican al arrancar la API.

### Cajas grandes

Al registrar una entrada o transferencia hacia una ubicación vacía, elige el tamaño de caja de 1 a 4 huecos contiguos y, si quieres, asígnale un nombre. La caja ocupa los módulos siguientes en la misma balda y se usa como una única ubicación. También se puede ajustar el tamaño desde la configuración de una ubicación. Solo se permite combinar o separar cuando todas las ubicaciones afectadas están vacías y no tienen contenido esperado. No se combinan niveles distintos; para artículos altos, ajusta la altura del nivel en la configuración de la estantería.

Los movimientos de empleados generan alertas persistentes para los administradores. Se consultan desde **Configuración → Alertas de movimientos** o desde la campana de notificaciones, donde aparece el autor, el tipo de movimiento, sus productos, unidades y fecha. Cada administrador puede marcar las alertas como leídas.

Las dimensiones del plano se introducen en centímetros (por ejemplo, 5000 × 3000 cm son 50 × 30 m). El mapa reduce su escala para mostrar el almacén completo y ajusta la vista al abrirlo. El perímetro forma parte del almacén, se comparte entre usuarios y la API impide guardar estanterías que lo atraviesen o queden fuera. Al eliminar almacenes o estanterías se borran físicamente junto con sus dependencias; se conserva el bloqueo de borrado cuando hay stock o movimientos asociados para proteger la trazabilidad.

Para una base creada antes del editor de estanterías, la API aplica las migraciones al arrancar. También se pueden ejecutar manualmente:

```powershell
docker compose exec -T db psql -U wms -d wms -f /docker-entrypoint-initdb.d/002-migration.sql
docker compose exec -T db psql -U wms -d wms -f /docker-entrypoint-initdb.d/003-warehouse-perimeter-and-centimeters.sql
docker compose exec -T db psql -U wms -d wms -f /docker-entrypoint-initdb.d/005-bin-display-name.sql
docker compose exec -T db psql -U wms -d wms -f /docker-entrypoint-initdb.d/006-bin-expectations.sql
docker compose exec -T db psql -U wms -d wms -f /docker-entrypoint-initdb.d/007-wide-bins.sql
```

Variables disponibles en `.env`:

| Variable | Uso | Valor local |
|---|---|---|
| `DATABASE_URL` | Conexión PostgreSQL de la API | `postgresql://wms:wms@localhost:5432/wms` |
| `API_PORT` | Puerto HTTP de la API | `3001` |
| `VITE_API_URL` | URL base REST usada por el frontend | `http://localhost:3001/api` |
| `CORS_ORIGINS` | Orígenes web permitidos por la API en producción (separados por comas) | localhost en desarrollo |
| `OPENAI_API_KEY` | Activa respuestas generativas con contexto de inventario | Vacía (modo estructurado local) |
| `OPENAI_MODEL` | Modelo usado por la API de OpenAI | `gpt-4o-mini` |
| `ADMIN_PASSWORD` | Contraseña inicial del administrador en una base vacía | `Stockflow2026!` |
| `EMPLOYEE_PASSWORD` | Contraseña inicial del empleado en una base vacía | `Empleado2026!` |

## Estructura

```text
apps/
  api/
    src/
      db/schema.sql       # Esquema relacional, índices y auditoría inmutable
      db/migrations/      # Migraciones SQL versionadas
      db/seed.sql         # Datos de demostración
      index.ts            # API, validación y transacciones de inventario
  web/
    src/
      App.tsx             # Vistas, flujos y formularios
      WarehouseMap2D.tsx  # Plano cenital 2D vectorial con ocupación por estantería
      RackViewer3D.tsx    # Visor WebGL de estanterías con selección y OrbitControls
      styles.css          # Diseño responsive
      main.tsx            # Entrada React
docker-compose.yml        # PostgreSQL local
```

## Modelo de datos y operaciones

El modelo de datos relaciona almacén, zona, pasillo, estantería, nivel y ubicación (`bin`); los pasillos se conservan como relación interna de compatibilidad. `WarehouseMap2D` representa el recinto y las estanterías con SVG vectorial para mantener la nitidez al ampliar. En edición, la posición y el tamaño de las estanterías se ajustan a una cuadrícula de 1 m y se validan contra el perímetro. Se añaden y mueven directamente sobre el suelo del almacén, sin dibujar ni configurar pasillos. Al seleccionar una estantería se abre su detalle individual. `RackViewer3D` usa Three.js con React Three Fiber y OrbitControls para mostrar bastidores y largueros metálicos y paquetes en sus huecos; al seleccionar un paquete se consulta su producto y ubicación. Antes de crear una estantería, el asistente permite definir su nombre, código, dimensiones, número de niveles, altura individual y huecos por nivel. Se pueden definir las dimensiones del almacén y cada nivel admite una altura distinta. Los cambios se mantienen como borrador hasta **Guardar y salir**; **Descartar cambios** revierte el borrador. El editor protege la trazabilidad: no permite eliminar estanterías con stock o movimientos asociados ni reducir los niveles o ubicaciones existentes.

El catálogo se relaciona con categorías y proveedores. El stock se mantiene por producto, lote y ubicación; los lotes pueden llevar fecha de caducidad. `movements` y `movement_lines` forman el Kardex.

El administrador puede añadir o eliminar categorías y proveedores desde **Configuración → Categorías y proveedores**. Al borrar una categoría, los productos asociados quedan sin categoría; al borrar un proveedor, sus productos quedan sin proveedor. No se permite eliminar proveedores con pedidos de compra en el historial, para conservar la trazabilidad.

El alta de movimientos se valida en el servidor. La API bloquea los saldos afectados con `SELECT … FOR UPDATE`, selecciona lotes FIFO, comprueba el stock libre y registra cantidades y auditoría en una transacción PostgreSQL. Los movimientos contabilizados son inmutables: cualquier corrección debe ser un nuevo movimiento.

Las sesiones usan tokens aleatorios de corta duración (8 horas); la base conserva solo el SHA-256 del token. Las contraseñas se verifican con `scrypt`, hay limitación de intentos de inicio de sesión y cierre/revocación de sesiones. El administrador puede crear/desactivar empleados, gestionar el catálogo y modificar el plano, además de crear y cancelar pedidos a proveedores. El equipo puede consultar el almacén, usar el asistente, registrar movimientos, crear/preparar pedidos de salida y recibir pedidos a proveedores. Los roles también se verifican en la API, no solo en la interfaz.

## API principal

- `GET /api/health`, `GET /api/overview`
- `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/logout`, `PATCH /api/auth/password`
- `GET /api/users`, `POST /api/users`, `PATCH /api/users/:id/active` (administrador)
- `GET /api/products?search=...`, `POST /api/products`, `PATCH /api/products/:id`, `DELETE /api/products/:id`
- `GET /api/catalog-options`, `POST /api/categories`, `DELETE /api/categories/:id`, `POST /api/suppliers`, `DELETE /api/suppliers/:id` (administrador)
- `GET /api/map-layout`, `PUT /api/map-layout` (administrador; guarda el plano completo en una transacción SQL)
- `GET /api/locations`, `PUT /api/locations/:id/expected-content`, `PUT /api/locations/:id/width` y `PATCH /api/locations/:id/display-name` (administrador), `GET /api/racks?warehouseId=...`, `POST /api/racks`, `PATCH /api/racks/:id`, `PATCH /api/racks/map`
- `GET /api/movements`, `POST /api/movements`
- `GET /api/replenishment`, `GET /api/purchase-orders`, `POST /api/purchase-orders`, `POST /api/purchase-orders/:id/receive`, `POST /api/purchase-orders/:id/cancel`
- `GET /api/sales-orders`, `POST /api/sales-orders`, `POST /api/sales-orders/:id/picking`, `POST /api/sales-orders/:id/fulfill`, `POST /api/sales-orders/:id/cancel`
- `POST /api/assistant`

## Asistente y seguridad

El asistente responde con consultas parametrizadas sobre stock, ubicaciones, mínimos y caducidades; no genera ni ejecuta SQL a partir del texto. Por defecto clasifica consultas localmente. Si se configura `OPENAI_API_KEY`, envía la pregunta y un contexto limitado de inventario a OpenAI. No se envían datos a terceros sin configurar explícitamente esa clave.

Antes de desplegarlo, reemplaza las credenciales de demostración, restringe CORS a los orígenes permitidos, usa TLS y secretos de entorno, y añade pruebas de integración y reglas de caducidad/reservas adaptadas al negocio.
