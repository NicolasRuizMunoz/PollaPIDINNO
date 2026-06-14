# 🏆 Polla Mundial 2026 · Copec

Polla (prode) para el Mundial 2026. Cada participante pronostica los marcadores de
todos los partidos y los bonos del torneo; gana quien acumule más puntos.

- **Frontend**: React + Vite + TypeScript.
- **Backend**: Express + TypeScript (rutas async).
- **Base de datos**: **libSQL / Turso** (SQLite serverless). En local usa un archivo
  `file:polla.db`; en producción, una base Turso en la nube.
- **Login**: Google (sin contraseñas). En el primer ingreso eliges tu **apodo**.
  Si no configuras Google, queda activo un *login de desarrollo* por email.
- **Listo para Vercel** (frontend estático + backend como función serverless).

## Puntaje

**Por partido** (acumulativo):

| Aciertas | Puntos |
|---|---|
| Marcador exacto (3-1 y queda 3-1) | **5** |
| Ganador / empate | **3** |
| …y además la diferencia de goles (3-1 y queda 4-2) | **+1** (→ 4) |
| Nada | 0 |

**Bonos del torneo** (se eligen antes): **campeón = 15 pts**; subcampeón, goleador,
mejor arquero, mejor jugador y mejor jugador joven = **10 pts** c/u.

> Pasa el mouse (o toca) cualquier puntaje para ver el **desglose** de qué regla te dio
> cuántos puntos.

- Las predicciones de cada partido se editan **hasta el minuto en que arranca**.
- Los **bonos** se editan hasta que se juega el **último partido de la 1ª fecha** de grupos.
- Cuando el admin **publica resultados**, se reparten los puntos y se **arman solas las
  eliminatorias** (1º y 2º de cada grupo + 8 mejores terceros, y los ganadores avanzan
  ronda a ronda hasta la final y el tercer puesto).

## Requisitos

- Node.js 18+ (recomendado 20/22; en local también sirve 24).

## Desarrollo local

```bash
# 1) instalar dependencias (raíz + server + web)
npm run install:all

# 2) cargar los datos del Mundial en la base local (file:polla.db)
npm run seed

# 3) levantar backend (:4000) y frontend (:5173)
npm run dev
```

Abre **http://localhost:5173**. El **primer usuario** que entra queda como **admin**.
Sin `GOOGLE_CLIENT_ID`, el login es por email (modo desarrollo) — ideal para probar ya.

---

## 🚀 Desplegar en Vercel (front + back)

El backend no puede usar un SQLite en disco en Vercel (es serverless, sin disco
persistente). Por eso la base va en **Turso** (SQLite en la nube). Pasos:

### 1. Crear la base en Turso

- Crea una cuenta en <https://turso.tech> y una base de datos.
- Obtén dos datos: la **URL** (`libsql://...`) y un **auth token**.
  (Desde la web de Turso, o con su CLI: `turso db create polla` y `turso db tokens create polla`.)

### 2. Cargar el esquema y los datos en Turso (una sola vez)

En tu máquina, crea `server/.env` con las credenciales de Turso y siembra:

```env
# server/.env
TURSO_DATABASE_URL=libsql://tu-base-xxxx.turso.io
TURSO_AUTH_TOKEN=eyJ...
```

```bash
npm run seed     # ⚠️ esto crea las tablas y carga los 104 partidos en Turso
```

> Vuelve a borrar/renombrar `server/.env` si quieres seguir desarrollando contra la base
> local. (Re-correr `seed` BORRA partidos y predicciones.)

### 3. (Opcional) Configurar Google

1. En [Google Cloud Console](https://console.cloud.google.com/) crea un **ID de cliente
   OAuth** tipo *Aplicación web*.
2. En *Orígenes de JavaScript autorizados* agrega tu dominio de Vercel
   (ej. `https://tu-polla.vercel.app`) y, para probar, `http://localhost:5173`.
3. Guarda el **Client ID** para el paso siguiente.

### 4. Conectar el repo en Vercel

1. En Vercel: **Add New → Project** e importa tu repo de GitHub.
2. No necesitas tocar Build/Output: ya vienen en `vercel.json`
   (build = `npm run vercel-build`, salida = `web/dist`, y la API en `/api/*`).
3. Agrega las **Environment Variables** del proyecto:

   | Variable | Valor |
   |---|---|
   | `TURSO_DATABASE_URL` | `libsql://tu-base-xxxx.turso.io` |
   | `TURSO_AUTH_TOKEN` | `eyJ...` |
   | `GOOGLE_CLIENT_ID` | tu client id (si usas Google; si no, omítelo) |
   | `ADMIN_EMAILS` | `nruiz@copec.cl` (admins fijos, separados por coma) |
   | `CRON_SECRET` | secreto para el cron de resultados en vivo (opcional) |
   | `LIVE_API_KEY` | API key de api-sports.io para marcadores en vivo (opcional) |

4. **Deploy**. Quedará el frontend y la API (`/api/...`) en el mismo dominio.

> El primer usuario que inicie sesión queda como admin; o usa `ADMIN_EMAILS` para fijarlo.

---

## Panel de administración

Pestaña **Admin** (solo admins):

- **Resultados y fixture**: editar fecha/hora, cargar marcadores y **publicar** (reparte
  puntos y avanza el cuadro). Botón *Recalcular cuadro* para rearmar las llaves.
- **Bonos y ajustes**: campeón/subcampeón/goleador/mejor arquero/mejor jugador/mejor jugador
  joven reales y cierre de bonos.

## Resultados en vivo (provisionales)

Durante los partidos, la app puede mostrar el **marcador en vivo** y un **puntaje
provisional** (no oficial) que se actualiza solo. Cómo funciona:

1. Un **cron externo** (p. ej. [cron-job.org](https://cron-job.org) o un GitHub Action)
   llama cada ~3 min a:

   ```
   GET https://tu-polla.vercel.app/api/cron/live?key=TU_CRON_SECRET
   ```

2. Ese endpoint consulta una **API deportiva** (API-Football / api-sports.io) **solo si
   hay partidos en ventana de juego** (para no gastar cuota) y guarda el marcador
   provisional. No marca el partido como finalizado.

3. El frontend (pestaña **Hoy** y **Tabla**) se autorefresca cada ~45–60 s y muestra el
   marcador con un indicador **🔴 EN VIVO** y los puntos provisionales. En la tabla, el
   total incluye el provisional con una marca `🔴 +N`.

4. El **puntaje oficial** sigue dependiendo de que el admin **publique** el resultado. En
   el panel **Admin → Hoy** aparece el marcador en vivo con un botón *usar N-N ⬇* para
   cargarlo de un clic.

**Configuración** (variables de entorno del backend):

| Variable | Para qué |
|---|---|
| `LIVE_API_KEY` | API key de api-sports.io. Sin esto, el endpoint queda inactivo. |
| `CRON_SECRET` | Secreto que debe traer el cron en `?key=`. Un admin logueado también puede llamarlo. |
| `LIVE_LEAGUE_ID` | Id de liga del Mundial en la API (default `1`). |
| `LIVE_SEASON` | Temporada (default `2026`). |

> Los nombres de equipo se emparejan por **código FIFA** (nuestros IDs son `ARG`, `BRA`…)
> con respaldo por nombre; verifica el calce la primera vez que haya partidos reales.

## Datos del Mundial

- **Equipos y grupos**: del sorteo final oficial (5 dic 2025).
- **Fechas y horarios**: aproximados (ventana real 11 jun – 19 jul 2026), editables desde
  el admin. Horarios mostrados en hora de **Chile** (America/Santiago).

## Scripts

| Comando (en la raíz) | Qué hace |
|---|---|
| `npm run install:all` | Instala todo (raíz + web + server) |
| `npm run dev` | Backend + frontend en desarrollo |
| `npm run seed` | Carga los datos del Mundial (⚠️ borra partidos/predicciones) |
| `npm run build` | Build de producción (web → `web/dist`, server → `server/dist`) |
| `npm run selftest` | Prueba el motor de puntaje y de avance |

## Estructura

```
api/[...path].mjs   función serverless de Vercel (reusa la app Express compilada)
vercel.json         build + ruteo (SPA + /api)
server/             Express + libSQL (src/) → compila a server/dist
web/                React + Vite (src/) → compila a web/dist
```
