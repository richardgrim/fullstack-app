# Ejecución local — Agenda Clara

Requisitos: Node.js 22.23.1, npm y Docker Desktop con motor Linux. No se necesita instalar Angular CLI ni Nest CLI globalmente. Proyecto independiente del ERP.

## Primera preparación

Desde la raíz del proyecto, copia .env.example a .env solo si todavía no existe y define una contraseña local en DB_PASSWORD. No publiques ese archivo.

```powershell
if (!(Test-Path .env)) { Copy-Item .env.example .env }
notepad .env
docker compose up -d --wait
cd backend
npm.cmd ci
cd ../frontend
npm.cmd ci
cd ..
.\scripts\start-api.ps1
```

El script compila y aplica las migraciones 001 y 002 una sola vez en una transacción; crea servicios ficticios y horarios de demostración. Base de datos reservas en 127.0.0.1:5434; API en 127.0.0.1:3001. El volumen reservas-lab_reservas-data conserva los datos. No usar down -v para detener.

En otra terminal, dentro de frontend: npm.cmd start. Abrir http://127.0.0.1:4201.

## Funciones de esta entrega

Seleccionar servicio y fecha y consultar horarios. Catálogo: orientación de 30 minutos, asesoría de 60 minutos y seguimiento de 45 minutos. Agenda ficticia: lunes a viernes 09:00–12:00 y 14:00–18:00; sábado 09:00–12:00; domingo cerrado. Cupos cada 15 minutos, solo futuros, hasta 90 días, zona America/La_Paz. Cada servicio debe caber completo dentro del horario. La API también excluye bloqueos registrados en schedule_blocks.

Crear una cuenta de prueba con nombre y correo ficticios y contraseña de 12 a 128 caracteres. Seleccionar un horario y pulsar Confirmar reserva; verificar la cita en Mis citas y recargar para comprobar persistencia. Cerrar sesión revoca el acceso. Se pueden cancelar citas propias confirmadas antes de su inicio. La agenda del responsable requiere activar expresamente una cuenta, como se explica abajo. Los bloques aún no tienen formulario; se validan en las pruebas de integración. Un horario consultado no constituye una cita confirmada.

## Pruebas

Frontend: npm.cmd test -- --watch=false y npm.cmd run build desde frontend.

Backend: con PostgreSQL iniciado y DB_PASSWORD disponible en el entorno, npm.cmd test desde backend. Las pruebas crean esquemas temporales test_catalog_*, test_bookings_* y test_agenda_* y lo eliminan al finalizar; no modifican las tablas de la aplicación. No ejecutar con una base de datos de producción.

## Detener

Ctrl+C en las terminales de interfaz y API. Desde la raíz: docker compose stop. No altera el contenedor ni la base del ERP.

## Activar responsable (solo tras autorización)

Primero crea la cuenta deseada en la interfaz. No hay responsable predeterminado y el registro nunca asigna ese rol. La cuenta seleccionada podrá consultar nombres y citas de todos los clientes y registrar su resultado.

Desde backend, con DB_PASSWORD cargada en el entorno y el servidor compilado, la siguiente consulta solo muestra la cuenta seleccionada y no la cambia:

```powershell
node dist/src/promote-manager.js correo-de-la-cuenta
```

Tras aprobar expresamente esa cuenta y sus permisos, añadir --confirm realiza el cambio. Se revocan las sesiones anteriores; será necesario volver a iniciar sesión. No ejecutar sobre una cuenta diferente de la aprobada.

Con el rol activo aparece Agenda del responsable al final de la página. Elige fecha y estado; después del fin de la cita, usa Marcar atendida o Marcar no asistió y confirma el resultado. No se habilita la edición posterior de ese resultado.

En Mis citas, Cancelar cita pide confirmación y solo está disponible antes del inicio de una cita confirmada. La cita cancelada queda en el historial. La consulta de disponibilidad se invalida para evitar mostrar horarios obsoletos.

## Gestionar servicios, horarios y bloqueos

Con la sesión responsable, al final de la página pulsa Gestionar servicios y horarios.

- Servicios: selecciona Editar o Nuevo servicio, completa nombre, descripción, duración entera de 15 a 240 minutos y disponibilidad. Pulsa Revisar servicio y luego Confirmar cambio. Desactivar no cancela citas existentes.
- Horario semanal: selecciona el día, añade o quita franjas y pulsa Revisar horario. Sin franjas, el día queda cerrado. Los horarios son del mismo día; los turnos que cruzan medianoche no se admiten. Un cambio que deje citas confirmadas fuera de atención se rechaza.
- Bloqueos: elige una fecha futura dentro de 90 días y horas de inicio/fin en Bolivia. Revisa y confirma. No se admiten intervalos superpuestos con citas confirmadas u otros bloqueos. Quitar bloqueo también pide confirmación.

Después de guardar se actualiza la configuración y el catálogo, y se descartan resultados anteriores de disponibilidad. Las citas existentes conservan su nombre de servicio e intervalo originales.
