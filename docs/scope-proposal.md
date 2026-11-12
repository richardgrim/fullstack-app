# Proyecto 02 — Alcance confirmado

Caso de uso confirmado por Richard: reservas de servicios y citas. Estado: catálogo, cuentas y reservas disponibles localmente; todavía no hay repositorio público. Los detalles siguientes delimitan la primera versión de trabajo.

## Reservas de servicios

Aplicación para que clientes consulten servicios y horarios disponibles, reserven una cita y gestionen sus reservas. El responsable configura servicios y disponibilidad. Un solo negocio y una sola agenda en la primera versión.

## Usuarios

- Cliente: consulta disponibilidad, reserva y cancela sus propias citas futuras.
- Responsable: configura servicios, horarios semanales y excepciones; consulta la agenda y marca citas como atendidas o no asistidas.

## Primera versión funcional

1. Inicio de sesión y permisos, sin envío de correos ni proveedores externos.
2. Catálogo de servicios con duración fija por servicio.
3. Horario semanal, bloqueos por fecha y zona horaria explícita del negocio (America/La_Paz para la demostración).
4. Consulta de cupos futuros y creación de reservas.
5. Rechazo de intervalos superpuestos, también ante solicitudes simultáneas; citas contiguas permitidas.
6. Mis reservas y cancelación antes del inicio. La cancelación libera el cupo.
7. Agenda del responsable con filtros por fecha y estado.
8. Pruebas, ejecución local, evidencias y GitHub Actions.

## Reglas de negocio

- La disponibilidad publicada no garantiza el cupo hasta confirmar la transacción.
- El servidor calcula la hora de finalización a partir de la duración del servicio.
- No aceptar reservas en el pasado, fuera de horario ni durante bloqueos.
- Un cliente solo consulta y modifica sus propias reservas.
- Los cambios de duración o disponibilidad no deben alterar silenciosamente reservas existentes.
- Estados iniciales propuestos: confirmada, cancelada, atendida y no asistió.

## Fuera de alcance inicial

Pagos, WhatsApp, correos automáticos, sincronización con calendarios externos, sucursales, varios profesionales, lista de espera, reservas recurrentes y aplicación móvil.

## Modelo conceptual

Usuario, servicio, horario semanal, bloqueo de agenda y reserva. Una reserva conserva inicio, fin, servicio y cliente. Las reglas contra superposición se garantizan en la base de datos y se traducen a un mensaje claro en la interfaz.

## Entregas propuestas

1. Catálogo, calendario y consulta de cupos con datos ficticios.
2. Reservas persistentes, permisos y prueba de concurrencia.
3. Cancelaciones y agenda del responsable.
4. Pruebas completas, documentación, CI y publicación autorizada.

## Tecnologías seleccionadas para la primera versión

Angular para reutilizar lo aprendido en el ERP; NestJS para desarrollar la API en TypeScript y demostrar un backend diferente de Spring Boot. PostgreSQL y Docker existentes para persistencia y ejecución local. Las versiones y el acceso a datos se verificarán al preparar el proyecto; no se instalarán herramientas globales.

## Criterios de aceptación

- Un cliente reserva un cupo disponible y puede volver a verlo tras recargar.
- Dos solicitudes simultáneas para un intervalo conflictivo producen una reserva y un rechazo, nunca dos confirmaciones.
- Otro cliente no puede leer ni cancelar esa reserva.
- Cancelar una cita futura vuelve a ofrecer su cupo.
- El responsable identifica las reservas del día y registra su resultado.
- Las pruebas contemplan límites de horario, fechas pasadas y zona horaria.

