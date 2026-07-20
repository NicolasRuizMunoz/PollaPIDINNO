import { createClient } from "@libsql/client";

const db = createClient({
  url: "libsql://pollacopec-nicorui.aws-us-east-2.turso.io",
  authToken: "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODA5NDg4NDAsImlkIjoiMDE5ZWE0YmEtYjEwMS03NWZjLTk0YTctN2NiYTE0OTRiNzI5IiwicmlkIjoiNDA2ZjIyOGEtYWMzYy00MDA3LWI1MmYtZTg5NzY0YmE2YjM3In0.nlaycbztfl0bddoh7qFabAFhnXeP3CEpSvD_RVK3MWvcmgV-PB3Dx9h12xJHbaXo6WP7DsVY0T8NI_fWhXJ1BQ",
});

// Mapeos de variantes → valor canónico
const normalizeMaps = {
  top_scorer: {
    "mbappe": "MBAPPE",
    "Mbappe": "MBAPPE",
    "MBAPPE": "MBAPPE",
    "mbappé": "MBAPPE",
    "Mbappé": "MBAPPE",
    "Kylian Mbappe": "MBAPPE",
    "kylian mbappe": "MBAPPE",
    "Kylian Mbappé": "MBAPPE",
    "kylian mbappé": "MBAPPE",
    "Kylian Mbapeé": "MBAPPE",
    "kylian mbapeé": "MBAPPE",
    "Killyan Mbappe": "MBAPPE",
    "Mbape": "MBAPPE",
    "mbape": "MBAPPE",

    "messi": "MESSI",
    "Messi": "MESSI",
    "MESSI": "MESSI",
    "Lionel Messi": "MESSI",
    "lionel messi": "MESSI",

    "harry kane": "KANE",
    "Harry Kane": "KANE",
    "KANE": "KANE",
  },

  best_goalkeeper: {
    "dibu": "MARTINEZ",
    "Dibu": "MARTINEZ",
    "DIBU": "MARTINEZ",
    "dibu martinez": "MARTINEZ",
    "Dibu martinez": "MARTINEZ",
    "emiliano dibu martinez": "MARTINEZ",
    "Emiliano Dibu Martinez": "MARTINEZ",
    "emiliano martínez": "MARTINEZ",
    "Emiliano Martínez": "MARTINEZ",

    "maignan": "MAIGNAN",
    "Maignan": "MAIGNAN",
    "MAIGNAN": "MAIGNAN",
    "maignian": "MAIGNAN",
    "Maignian": "MAIGNAN",
    "mike maignan": "MAIGNAN",
    "Mike Maignan": "MAIGNAN",

    "unai simón": "SIMON",
    "Unai Simón": "SIMON",
    "unai simon": "SIMON",
    "Unai Simon": "SIMON",
    "SIMON": "SIMON",

    "manuel neuer": "NEUER",
    "Manuel Neuer": "NEUER",

    "diogo costa": "COSTA",
    "Diogo Costa": "COSTA",

    "jordan pickford": "PICKFORD",
    "Jordan Pickford": "PICKFORD",
    "pickford": "PICKFORD",
    "Pickford": "PICKFORD",
  },

  best_player: {
    "mbappe": "MBAPPE",
    "Mbappe": "MBAPPE",
    "MBAPPE": "MBAPPE",
    "mbappé": "MBAPPE",
    "Mbappé": "MBAPPE",
    "kylian mbappe": "MBAPPE",
    "Kylian Mbappe": "MBAPPE",
    "kylian mbappé": "MBAPPE",
    "Kylian Mbappé": "MBAPPE",
    "kylian mbapeé": "MBAPPE",
    "Kylian Mbapeé": "MBAPPE",

    "messi": "MESSI",
    "Messi": "MESSI",
    "MESSI": "MESSI",
    "lionel messi": "MESSI",
    "Lionel Messi": "MESSI",

    "harry kane": "KANE",
    "Harry Kane": "KANE",

    "rodri": "RODRI",
    "Rodri": "RODRI",
    "RODRI": "RODRI",

    "michael olise": "OLISE",
    "Michael Olise": "OLISE",

    "lamine": "LAMINE",
    "Lamine": "LAMINE",
    "lamine yamal": "LAMINE",
    "Lamine Yamal": "LAMINE",
    "yamal": "LAMINE",
    "Yamal": "LAMINE",

    "vini jr": "VINI",
    "Vini Jr": "VINI",
    "Vini jr": "VINI",
  },

  best_young_player: {
    "lamine yamal": "LAMINE_YAMAL",
    "Lamine Yamal": "LAMINE_YAMAL",
    "lamine yamal": "LAMINE_YAMAL",
    "Lamine yamal": "LAMINE_YAMAL",
    "lamine": "LAMINE_YAMAL",
    "Lamine": "LAMINE_YAMAL",
    "yamal": "LAMINE_YAMAL",
    "Yamal": "LAMINE_YAMAL",

    "doue": "DOUE",
    "Doue": "DOUE",
    "DOUE": "DOUE",
    "doué": "DOUE",
    "Doué": "DOUE",
    "désiré doué": "DOUE",
    "Désiré Doué": "DOUE",

    "pau cubarsi": "CUBARSI",
    "Pau Cubarsi": "CUBARSI",
    "pau cubarsi": "CUBARSI",

    "endrick": "ENDRICK",
    "Endrick": "ENDRICK",
    "endrik": "ENDRICK",
    "Endrik": "ENDRICK",
  }
};

function normalize(field, value) {
  if (!value) return null;
  const map = normalizeMaps[field];
  if (!map) return value;
  return map[value.trim()] || value.trim().toUpperCase();
}

async function normalizeAllBonos() {
  console.log("Normalizando bonos...");

  const fields = ["top_scorer", "best_goalkeeper", "best_player", "best_young_player"];

  for (const field of fields) {
    console.log(`\n📝 Normalizando ${field}...`);

    const picks = await db.execute(`SELECT user_id, ${field} FROM tournament_picks WHERE ${field} IS NOT NULL`);

    for (const row of picks.rows) {
      const normalized = normalize(field, row[field]);
      if (normalized !== row[field]) {
        console.log(`  ${row.user_id}: "${row[field]}" → "${normalized}"`);
        await db.execute(
          `UPDATE tournament_picks SET ${field} = ? WHERE user_id = ?`,
          [normalized, row.user_id]
        );
      }
    }
  }

  console.log("\n✅ Normalización completada");
}

async function setResults() {
  console.log("\nGuardando resultados reales...");

  const results = {
    result_champion: "ESP",
    result_runner_up: "ARG",
    result_top_scorer: "MBAPPE",
    result_best_goalkeeper: "SIMON",
    result_best_player: "RODRI",
    result_best_young_player: "CUBARSI",
  };

  for (const [key, value] of Object.entries(results)) {
    await db.execute(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [key, value]
    );
    console.log(`  ${key} = ${value}`);
  }

  console.log("\n✅ Resultados guardados");
}

console.log("🚀 Iniciando normalización de bonos y guardado de resultados...");
await normalizeAllBonos();
await setResults();
console.log("\n🎉 ¡Listo!");
