// Punto de entrada serverless de Vercel (catch-all para /api/*).
// Reutiliza la misma app Express compilada (server/dist por "npm run build").
// La app expone las rutas /api/* y normaliza el prefijo, así funciona bajo /api.
import { app } from "../server/dist/app.js";

export default app;
