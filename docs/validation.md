# Validación — plan

Los siguientes criterios corresponden al alcance completo; los resultados de la entrega actual se detallan abajo.

- Reserva de un cupo válido, persistente tras recargar.
- Dos reservas simultáneas superpuestas: exactamente una aceptada.
- Intervalos contiguos permitidos; superposición parcial y total rechazadas.
- Rechazo de pasado, fuera de horario y bloqueos.
- Cálculo de fin en el servidor; duración original conservada al modificar el servicio.
- Cliente ajeno no puede leer ni cancelar la reserva de otro usuario.
- Cancelación antes del inicio libera el cupo; cancelación tardía rechazada.
- Agenda del responsable muestra correctamente fecha y estado.
- Cambios de disponibilidad incompatibles con reservas existentes rechazados.
- Horarios y límites de día coherentes en America/La_Paz.

Las pruebas de concurrencia deben ejecutarse contra PostgreSQL real. Incluir controles de permisos, validación de entradas y recorridos de interfaz. Registrar evidencias por entrega sin presentar funciones pendientes como completadas.

## Resultado de la primera entrega — 11 de noviembre de 2026

- Compilación NestJS/TypeScript: aprobada.
- Compilación Angular de producción: aprobada (189,53 kB iniciales).
- Cuatro pruebas de interfaz aprobadas: selección y horas de Bolivia, rechazo de respuestas obsoletas, vacío frente a error y rechazo local de fechas pasadas.
- Pruebas de integración preparadas para PostgreSQL: catálogo, duración/cierre, bloqueos y extremos contiguos, día cerrado y validación de entradas.
- Integración PostgreSQL verificada: seis pruebas aprobadas. Se corrigió la transferencia de la contraseña al pool del esquema de pruebas (pg la mantiene como propiedad no enumerable).
- Migración aplicada y aplicación iniciada localmente. Comprobación HTTP a través del servidor Angular: página 200, tres servicios y 26 horarios para el 12 de noviembre de 2026.
- Revisión visual manual pendiente. Reservas y cuentas todavía no implementadas.

## Segunda entrega — 11 de noviembre de 2026

Se añadieron cuentas, sesiones, reservas persistentes y la sección Mis citas. Los usuarios nuevos tienen rol cliente. La duración y nombre del servicio quedan conservados en cada reserva. No se implementaron todavía cancelaciones ni el panel del responsable.

- 14 pruebas de servidor aprobadas con PostgreSQL real: catálogo, fechas, bloqueos, cuentas, sesiones, protección de escrituras, aislamiento entre clientes, reserva persistente, intervalos contiguos, duración conservada, sesión vencida y límite de intentos.
- Concurrencia HTTP: dos solicitudes superpuestas aceptan exactamente una. Comprobación adicional con dos conexiones SQL: la restricción de exclusión rechaza el segundo intervalo incluso sin pasar por la API.
- 11 pruebas Angular aprobadas: las cuatro anteriores y siete de registro, sesión, selección sin reserva, confirmación y doble envío, conflicto, caducidad, cierre de sesión con respuesta obsoleta y restauración de citas al recargar.
- Compilaciones de servidor y producción Angular aprobadas (210,50 kB iniciales).
- Migración 002 aplicada a la base local conservando catálogo y horarios existentes. API reiniciada.
- Revisión en navegador de la consulta y selección sin sesión: 26 horarios el 12/11/2026 y resumen 09:00–09:30; solicita iniciar sesión antes de confirmar. La creación de cuenta y confirmación visual con una cuenta elegida por el usuario quedan para su recorrido manual. Esos flujos ya tienen pruebas automatizadas de interfaz y API.

Las pruebas usan esquemas temporales independientes y no crean cuentas ni reservas en las tablas de la demostración.

## Tercera entrega — 11 de noviembre de 2026

Cancelación de citas propias antes de su inicio y agenda del responsable por fecha boliviana y estado. Las cancelaciones conservan el historial y liberan el intervalo. El responsable puede registrar Atendida o No asistió solo después de finalizar una cita confirmada. Cada cambio de estado usa una escritura condicional atómica.

- 22 pruebas del servidor aprobadas contra PostgreSQL real (ocho nuevas): propietario y sesión, liberación del cupo y nueva reserva, cancelaciones concurrentes, límite temporal, permisos del responsable, filtros y zona horaria, estados finales y resultados concurrentes.
- 20 pruebas Angular aprobadas (nueve nuevas): confirmación previa a cancelar, doble envío, conflictos, respuestas obsoletas, visibilidad por rol, filtros, horas de Bolivia, registro de resultado y errores de permisos.
- Compilación del servidor y producción Angular aprobadas (230,07 kB iniciales).
- La API local fue reiniciada. No se modificaron los datos de cuentas o citas de la demostración; las pruebas utilizaron esquemas temporales.
- La activación de una cuenta responsable y su recorrido visual permanecen pendientes de selección y autorización del usuario. No se ha asignado ese rol a ninguna cuenta real de la demostración.

Próximo alcance: gestión de servicios y disponibilidad, recorrido visual con cuentas autorizadas, evidencias, CI y publicación.

## Activación del responsable — 11 de noviembre de 2026

Tras la selección y autorización del usuario, se verificó la cuenta Responsable Demo y se activó su rol manager. La herramienta confirmó el cambio y una consulta posterior verificó el rol. Sus sesiones previas fueron revocadas; debe iniciar sesión nuevamente. No se accedió a su contraseña. El recorrido visual autenticado sigue pendiente.


### Revisión visual de la sesión responsable

Se verificó en el navegador la sesión de Responsable Demo y la sección Agenda del responsable. El filtro por fecha 12/11/2026 y estado Confirmada completó la consulta y mostró correctamente que no existen citas para esa selección. No se crearon ni modificaron citas durante esta revisión. El recorrido con citas y registro de resultado sigue cubierto por pruebas automatizadas y pendiente de evidencia visual con datos de demostración.


## Gestión de servicios y disponibilidad — 11 de noviembre de 2026

Se implementaron alta y edición de servicios, activación/desactivación, reemplazo de franjas de un día semanal, creación y eliminación de bloqueos por fecha. Todas las escrituras requieren responsable y confirmación en la interfaz.

- 30 pruebas del servidor aprobadas contra PostgreSQL real. Ocho pruebas nuevas cubren permisos, servicios e historial, horarios protegidos, validación de franjas, bloqueos, fechas y dos carreras entre configuración y reservas.
- 27 pruebas Angular aprobadas. Siete pruebas nuevas cubren carga, edición sin mutar datos originales, confirmación explícita, alta de servicio, cierre conflictivo, bloqueos y errores de permisos.
- Producción Angular compilada: 248,00 kB iniciales. Servidor compilado y reiniciado.
- Verificación visual con la sesión Responsable Demo: carga de los tres servicios, edición con valores existentes, domingo cerrado y confirmación previa. Se volvió sin guardar; no se alteró la configuración de demostración.
- No se añadieron dependencias ni migraciones; se reutilizaron las tablas existentes. Las pruebas de escritura se ejecutaron en esquemas temporales aislados.

Pendiente para la entrega pública: evidencia visual del recorrido completo con citas de demostración, integración continua, revisión de publicación y licencia del Proyecto 02.

## Preparación para publicación — 11 de noviembre de 2026

Se prepararon GitHub Actions, documentación de CI, capturas reales y un plan de publicación. Se creó únicamente el repositorio Git local, sin remoto. El flujo YAML pasó el parser de Prettier; los commits de acciones oficiales se verificaron mediante la API de GitHub. Se reutilizan Node.js y PostgreSQL ya empleados en el laboratorio.

No se ha ejecutado el flujo en GitHub ni publicado el proyecto. Las 57 pruebas documentadas corresponden a la versión funcional validada localmente antes de esta preparación; en esta etapa no se alteró su comportamiento.
