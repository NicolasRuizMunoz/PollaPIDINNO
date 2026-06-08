# 🏆 Polla Mundial 2026 · Copec

Polla (prode) para el Mundial 2026. Cada participante pronostica los marcadores de
todos los partidos y los bonos del torneo; gana quien acumule más puntos.

- **Backend**: Node + Express + TypeScript + SQLite (`node:sqlite`, sin compilar nada).
- **Frontend**: React + Vite + TypeScript.
- **Login**: Google (sin contraseñas). En el primer ingreso eliges tu **apodo**.
  Si no configuras Google, queda activo un *login de desarrollo* por email.

## Puntaje

**Por partido** (acumulativo):

| Aciertas | Puntos |
|---|---|
| Marcador exacto (3-1 y queda 3-1) | **5** |
| Ganador / empate | **3** |
| …y además la diferencia de goles (3-1 y queda 4-2) | **+1** (→ 4) |
| Nada | 0 |

**Bonos del torneo** (se eligen antes): **campeón = 15 pts**; subcampeón, goleador y
mejor arquero = **10 pts** c/u.

> Pasa el mouse por encima de cualquier puntaje (en los partidos o en los bonos) para
> ver el **desglose**: qué regla te dio cuántos puntos.

- Las predicciones de cada partido se pueden editar **hasta el minuto en que arranca**.
- Los **bonos** se pueden editar hasta que se juega el **último partido de la 1ª fecha**
  de la fase de grupos (configurable por el admin).

## Cómo se llenan las eliminatorias

No las llena nadie a mano: cuando el admin **publica los resultados** de la fase de
grupos, el sistema calcula las posiciones, los clasificados (1º y 2º de cada grupo +
los 8 mejores terceros) y arma los cruces. Al publicar cada partido de eliminatorias,
el ganador avanza solo a la ronda siguiente, hasta la final y el tercer puesto.

## Requisitos

- Node.js 24+ (usa el SQLite integrado `node:sqlite`).

## Puesta en marcha

```bash
# 1) instalar dependencias (raíz + server + web)
npm run install:all

# 2) cargar los datos del Mundial (48 equipos, 12 grupos, 104 partidos)
npm run seed

# 3) levantar backend (:4000) y frontend (:5173) juntos
npm run dev
```

Abre **http://localhost:5173**. El **primer usuario** que entra queda como **admin**.

> Sin `GOOGLE_CLIENT_ID` configurado, la pantalla de login te deja entrar solo con tu
> email (modo desarrollo). Perfecto para probar de inmediato.

## Configurar Google (opcional, para uso real)

1. En [Google Cloud Console](https://console.cloud.google.com/) crea un
   **ID de cliente de OAuth** del tipo *Aplicación web*.
2. En *Orígenes de JavaScript autorizados* agrega la URL donde corre el frontend
   (ej. `http://localhost:5173` y tu dominio de producción).
3. Copia `server/.env.example` a `server/.env` y completa:

   ```env
   GOOGLE_CLIENT_ID=tu-client-id.apps.googleusercontent.com
   ADMIN_EMAILS=nruiz@copec.cl
   ```

4. Reinicia el backend. La pantalla de login mostrará el botón de Google.

## Panel de administración

Visible solo para admins, pestaña **Admin**:

- **Resultados y fixture**: editar fecha/hora de cada partido, cargar marcadores y
  **publicar** (reparte puntos al instante y avanza las eliminatorias). Botón
  *Recalcular cuadro* para rearmar las llaves si corriges un resultado.
- **Bonos y ajustes**: definir campeón/subcampeón/goleador/mejor arquero reales y la
  fecha de cierre de los bonos.

## Notas sobre los datos

- Los **equipos y grupos** son los del sorteo final oficial (5 dic 2025).
- Las **fechas y horarios** de los partidos son aproximados (dentro de la ventana real
  11 jun – 19 jul 2026) y se ajustan uno a uno desde el panel de admin.
- Horarios mostrados en hora de **Chile** (America/Santiago).

## Scripts útiles

| Comando | Qué hace |
|---|---|
| `npm run dev` | Backend + frontend en modo desarrollo |
| `npm run seed` | Recarga los datos del Mundial (⚠️ borra partidos/predicciones) |
| `npm run build` | Build de producción del frontend (`web/dist`) |
| `npm --prefix server run selftest` | Prueba el motor de puntaje y de avance |

## Despliegue (resumen)

1. `npm --prefix web run build` → archivos estáticos en `web/dist` (servir en tu hosting).
2. Backend: definir `GOOGLE_CLIENT_ID`, `ADMIN_EMAILS`, `PORT` y correr `npm --prefix server start`.
3. Apunta el frontend al backend (en dev se usa el proxy de Vite hacia `:4000`).
