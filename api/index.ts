// Punto de entrada serverless de Vercel.
// Todo /api/* se reescribe a esta función (ver vercel.json) y Express enruta
// según la URL original. Reutiliza la app Express compilada (server/dist).
import { app } from "../server/dist/app.js";

export default app;
