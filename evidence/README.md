# Evidencias de Agenda Clara

Fecha: **11 de noviembre de 2026**, America/La_Paz. Entorno local Windows, Node.js 22.23.1, Angular 21.2, NestJS 11.2.9 y PostgreSQL 17 en Docker. Primera versión funcional publicada: commit 89df666.

## Capturas reales

- [Catálogo y disponibilidad](screenshots/catalogo-disponibilidad.jpg): sesión de Responsable Demo, servicio Orientación inicial y consulta del 12/11/2026; 26 horarios disponibles. No se confirmó una reserva para producir esta captura.
- [Configuración](screenshots/configuracion.jpg): sesión del responsable, tres servicios, formulario de edición, horario semanal y bloqueos. No se guardaron cambios durante esta captura.

Las cuentas y servicios mostrados son ficticios; las capturas no contienen contraseñas ni tokens. La fecha de consulta es la utilizada al capturar, no una promesa de disponibilidad futura. El inventario de citas visible estaba vacío.

## Pruebas ejecutadas

30 pruebas de servidor y 27 de interfaz aprobadas. Compilación TypeScript y Angular de producción aprobadas. El detalle por entrega figura en [validation.md](../docs/validation.md).

Las pruebas de API verifican creación y persistencia de reservas, acceso por propietario, cancelaciones, resultados de atención, horarios, bloqueos y solicitudes concurrentes. Se ejecutan en esquemas temporales; no cambian las cuentas ni las citas de la demostración.

## Límites de la evidencia

Las capturas acreditan la interfaz y la consulta/configuración visible. El recorrido completo de creación y cancelación de una cita se acredita por las pruebas automatizadas, no por estas imágenes. [GitHub Actions aprobado](https://github.com/richardgrim/fullstack-app/actions/runs/43143041184): ambos trabajos completados, incluyendo pruebas, compilación y migraciones. No hay evidencia de despliegue público.
