# Integración continua

El flujo `.github/workflows/ci.yml` está preparado para push a main, pull requests y ejecución manual. **Todavía no se ha ejecutado en GitHub.** Su primera ejecución se verificará después de autorizar la publicación.

| Trabajo | Validación | Artefactos |
| --- | --- | --- |
| backend | npm ci; compilación TypeScript; 30 pruebas con PostgreSQL 17 real; migraciones dos veces | Informe de pruebas |
| frontend | npm ci; 27 pruebas Angular; compilación de producción | Informe de pruebas y aplicación compilada |

Node.js 22.23.1 y dependencias de ambos package-lock.json. Acciones oficiales fijadas a commits; permisos contents: read; checkout sin persistir credenciales; cancelación de ejecuciones anteriores de la misma referencia; límite de 15 minutos por trabajo; artefactos conservados siete días.

El servicio PostgreSQL del trabajo es temporal. Usa base y usuario reservas, y puerto del runner 5434 dirigido a 5432 del contenedor. Su contraseña pública es exclusivamente de ese contenedor desechable: no usa .env, la base local, tokens personales ni la sesión del responsable. Las pruebas crean y eliminan sus propios esquemas temporales.

Este flujo prueba y compila. No despliega la aplicación, no publica imágenes Docker ni modifica el repositorio. Los artefactos no incluyen .env, node_modules ni bases de datos.

## Validación antes de publicar

Las 57 pruebas y compilaciones pasaron localmente. Se verificaron los commits de las acciones en sus repositorios oficiales y la estructura YAML del flujo. La validación local no sustituye una ejecución en el runner Linux de GitHub; esa comprobación sigue pendiente.

## Referencias

- [Servicios PostgreSQL en GitHub Actions](https://docs.github.com/en/actions/tutorials/use-containerized-services/create-postgresql-service-containers).
- [setup-node oficial](https://github.com/actions/setup-node).
