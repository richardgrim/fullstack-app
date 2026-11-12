# Arquitectura — Reservas

Estado: catálogo, cuentas y reservas implementados localmente; gestión del responsable pendiente.

Angular → API NestJS → PostgreSQL. Una aplicación y una base de datos independientes del ERP. API modular: identidad, catálogo, disponibilidad y reservas. No se requieren microservicios ni servicios cloud para este alcance.

## Decisiones

- Angular reutiliza las herramientas y patrones de interfaz ya practicados.
- NestJS incorpora desarrollo de backend con TypeScript al portafolio.
- Una agenda y un negocio limitan la complejidad de disponibilidad.
- La API calcula fin y duración; no confía en intervalos enviados por el cliente.
- Instantes persistidos con zona horaria; reglas de agenda interpretadas en America/La_Paz.
- Intervalos semiabiertos [inicio, fin): dos citas pueden tocar sus extremos sin superponerse.
- La base de datos debe impedir reservas activas superpuestas; una comprobación previa en la API no basta frente a solicitudes simultáneas.
- Las reservas conservan duración e intervalo originales aunque cambie el catálogo.
- La gestión futura deberá rechazar cambios de horario o bloqueos que contradigan reservas vigentes.

## Modelo previsto

Usuario (rol), servicio (nombre, duración, activo), horario semanal, bloqueo (inicio/fin) y reserva (cliente, servicio, inicio, fin, estado, creación). Estados: confirmada, cancelada, atendida y no asistió. No se permite cancelar una cita ya iniciada ni marcar una cita como atendida/no asistió antes de su fin.

## Decisiones iniciales (resueltas en las entregas siguientes)

Fijar versiones compatibles y herramienta de migraciones; definir contratos HTTP y manejo de conflictos; concretar sesiones, CSRF y preparación local de cuentas. No publicar credenciales ni reutilizar la base de datos del ERP.

## Primera entrega implementada — 11 de noviembre de 2026

Catálogo y consulta de disponibilidad con PostgreSQL y consultas parametrizadas mediante node-postgres. API NestJS 11.2.9 y Angular 21.2; dependencias fijadas en package-lock.json. SQL versionado: tabla schema_migrations, bloqueo de migración y transacción. No se utiliza ORM en esta entrega.

La disponibilidad se calcula en PostgreSQL con generate_series, intervalos de 15 minutos y conversión explícita America/La_Paz. El servicio debe caber completamente en la ventana de apertura; los bloques usan comparación de intervalos semiabiertos. Se omiten cupos anteriores a now(). Solo se consultan fechas desde hoy hasta 90 días.

GET /api/services devuelve servicios activos. GET /api/services/:id/availability?date=AAAA-MM-DD devuelve fecha, zona, duración y cupos con inicio/fin UTC. 400 para entrada inválida o fuera del horizonte; 404 para servicio inexistente/inactivo.

## Segunda entrega implementada

Migración 002: accounts, sessions y bookings. Contraseñas con scrypt y sesiones opacas de 12 horas en cookie HttpOnly; token almacenado como hash. La interfaz restaura la sesión al cargar, muestra solo citas propias y pide confirmación explícita después de seleccionar un horario.

La consulta de disponibilidad y la creación utilizan la misma función. POST /api/bookings abre una transacción, valida el horario y calcula su fin; una restricción EXCLUDE USING gist sobre tstzrange(starts_at,ends_at,'[)') impide superposiciones para estados distintos de cancelled. El control de concurrencia no depende de la consulta previa. Nombre del servicio, inicio y fin se conservan como datos históricos.

| Método y ruta | Resultado |
| --- | --- |
| POST /api/auth/register | Crea cliente y sesión; 201 |
| POST /api/auth/login | Valida credenciales y crea sesión; 200 |
| GET /api/auth/me | Perfil de la sesión; 200 o 401 |
| POST /api/auth/logout | Revoca sesión; 204 |
| GET /api/bookings | Citas del usuario autenticado |
| POST /api/bookings | Recibe serviceId y startsAt UTC; devuelve cita confirmada, 201; conflicto 409 |

Todas las escrituras requieren X-Agenda-Request: 1. Los campos sensibles no se devuelven. Los cambios de disponibilidad y los permisos de responsable siguen pendientes; no hay endpoints administrativos en esta entrega.

## Cancelaciones y responsable

POST /api/bookings/:id/cancel exige sesión y propietario. Solo cambia confirmed a cancelled cuando starts_at es posterior al momento de la solicitud. Una cita ajena o inexistente devuelve 404; una cita propia que ya comenzó o cambió de estado devuelve 409. La reserva se conserva. La restricción de exclusión deja de ocupar ese intervalo.

GET /api/management/agenda?date=AAAA-MM-DD&status=confirmed requiere rol manager; status es opcional. Consulta el día de America/La_Paz con límites [medianoche, siguiente medianoche), ordenado por hora. Devuelve nombre del cliente, servicio, intervalo y estado; no devuelve correo, contraseña ni sesión.

POST /api/management/bookings/:id/outcome acepta attended o missed, requiere manager y que una cita confirmed ya haya finalizado. Una escritura condicional impide sobrescribir resultados en solicitudes concurrentes. No se permite reabrir citas desde esta entrega.

Las capacidades canCancel y canComplete se calculan en el servidor para orientar la interfaz. Cada escritura vuelve a comprobar permisos, tiempo y estado; no confía en esos indicadores del navegador.

La herramienta local promote-manager es la única vía preparada para asignar el rol. Requiere una cuenta existente y confirmación explícita; invalida sus sesiones para exigir un nuevo acceso. No se ha ejecutado en las cuentas de la aplicación. La gestión de servicios, horarios y bloqueos sigue pendiente.

## Configuración del negocio

GET /api/management/settings devuelve servicios (incluidos inactivos), franjas semanales y bloqueos vigentes solo al responsable. POST en services crea un servicio y services/:id lo actualiza. Desactivarlo impide nuevas reservas sin modificar nombre, inicio o fin de citas ya registradas.

POST hours/:weekday reemplaza las franjas de ese día (0 domingo a 6 sábado). Admite hasta ocho franjas, sin superposición y dentro del mismo día; una lista vacía cierra el día. Rechaza el cambio si alguna cita confirmada pendiente o en curso queda fuera de una franja completa.

POST blocks recibe date, opens y closes en hora boliviana; solo permite bloqueos futuros dentro de 90 días, sin superponer citas confirmadas ni otros bloqueos. POST blocks/:id/remove elimina un bloqueo y recupera la disponibilidad que permitan las demás reglas. La interfaz pide confirmar previamente cada acción.

La creación de reservas y las operaciones de configuración usan el mismo bloqueo transaccional pg_advisory_xact_lock(22002). Cada operación valida después de adquirirlo, con lectura actual y escritura dentro de la transacción; así no puede insertarse una reserva entre la comprobación de un bloqueo y su creación. Las consultas de disponibilidad comprueban el tiempo de la sentencia, no el inicio anterior de la transacción. La restricción EXCLUDE de PostgreSQL sigue garantizando la no superposición entre reservas.

Esta coordinación protege las escrituras a través de la API. Las modificaciones SQL manuales de horarios o bloqueos pueden eludirla y no deben usarse como vía de administración. El laboratorio es de una sola agenda. No se incluye historial de ediciones de configuración ni detección de editores simultáneos; el último cambio válido de configuración es el vigente.
