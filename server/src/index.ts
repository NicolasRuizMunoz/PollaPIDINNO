// Arranque para desarrollo local (en Vercel se usa /api/index.ts).
import "dotenv/config";
import { app } from "./app.js";
import { ensureSchema } from "./db.js";

const PORT = Number(process.env.PORT ?? 4000);

ensureSchema()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`API de la polla escuchando en http://localhost:${PORT}`);
    });
  })
  .catch((e) => {
    console.error("No se pudo iniciar la base de datos:", e);
    process.exit(1);
  });
