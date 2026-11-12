# Seguridad — demostración local

La aplicación escucha exclusivamente en 127.0.0.1. Angular envía /api a NestJS mediante proxy; no se habilita CORS. PostgreSQL y su volumen pertenecen exclusivamente a Agenda Clara. No exponer esta demostración a Internet.

## Controles implementados

- Contraseñas de 12 a 128 caracteres, máximo 256 bytes; scrypt asíncrono (N=65536, r=8, p=1), sal aleatoria de 16 bytes y comparación de tiempo constante.
- El registro siempre asigna el rol cliente. No se aceptan roles ni propietarios suministrados por el navegador.
- Sesiones con tokens aleatorios de 32 bytes; solo el hash SHA-256 se guarda en PostgreSQL. Caducan en 12 horas; cerrar sesión revoca el token.
- Cookie HttpOnly, SameSite=Strict y Path=/api; Secure cuando NODE_ENV=production. El laboratorio usa HTTP local.
- Las escrituras requieren X-Agenda-Request: 1. Sin CORS, un origen ajeno no puede enviar ese encabezado desde el navegador. No habilitar CORS permisivo sin revisar CSRF.
- Respuestas no-store y nosniff; contraseñas y tokens no se devuelven en JSON ni se almacenan en localStorage.
- Límite de 20 intentos de registro/inicio de sesión por IP cada 15 minutos. Contador en memoria, apropiado solo para una instancia local; se reinicia al reiniciar la API.
- Consultas parametrizadas y validación de entradas. Cada usuario solo puede listar sus propias reservas; la cuenta proviene de la sesión.
- Restricción PostgreSQL EXCLUDE sobre intervalos [inicio, fin) para impedir reservas superpuestas, incluso concurrentes. La API calcula fin, valida horario, pasado y bloqueos, y devuelve 409 ante conflicto.
- .env y evidencias locales están excluidos de Git. No hay cuentas ni contraseñas de demostración predeterminadas.

## Límites actuales

Solo datos ficticios. No hay verificación de correo, recuperación de contraseña ni administración general de usuarios desde la interfaz. Antes de un despliegue público se requiere revisar HTTPS, configuración de cookies/proxy, límites compartidos, permisos mínimos de base de datos, recuperación de cuentas y protección contra abuso. Las migraciones y las pruebas locales requieren permisos para crear tablas y esquemas; no usar esta cuenta de laboratorio en producción.

## Referencias

- [Node.js: crypto y scrypt](https://nodejs.org/api/crypto.html)
- [PostgreSQL 17: rangos y restricciones de exclusión](https://www.postgresql.org/docs/17/rangetypes.html)

## Permisos de agenda y cancelación

El cliente solo cancela citas propias confirmadas antes de su inicio. El responsable consulta la agenda y registra resultados después del fin, pero no cancela citas ajenas. Los cambios de estado son condicionales y atómicos; no se sobrescriben estados finales. La promoción a responsable solo se prepara como herramienta local con confirmación explícita; no hay endpoint público de promoción. Al promover se revocan las sesiones de esa cuenta. La cuenta responsable elegida por el usuario fue activada con su autorización; futuras promociones requieren autorización específica.

## Configuración protegida

Solo el responsable puede crear y editar servicios, modificar franjas o administrar bloqueos. Cada escritura vuelve a comprobar el rol desde la sesión. Reservas y configuración comparten un bloqueo transaccional y validan contra datos actuales para impedir carreras entre cierre de horario, bloqueos y nuevas citas. No modificar horarios ni bloqueos por SQL fuera de esta coordinación. No se implementó auditoría histórica de cambios de configuración en esta versión local.
