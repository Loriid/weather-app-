import express from 'express';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS) || 600000; // 10 minutes default

const FAVORITES_FILE = path.join(__dirname, 'data', 'favorites.json');

// In-memory cache map
const weatherCache = new Map();

// Middlewares
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Helper to ensure data folder and favorites file exist
async function getFavorites() {
  try {
    const raw = await readFile(FAVORITES_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') {
      await mkdir(path.dirname(FAVORITES_FILE), { recursive: true });
      await writeFile(FAVORITES_FILE, '[]', 'utf-8');
      return [];
    }
    throw err;
  }
}

async function saveFavorites(favorites) {
  await mkdir(path.dirname(FAVORITES_FILE), { recursive: true });
  await writeFile(FAVORITES_FILE, JSON.stringify(favorites, null, 2), 'utf-8');
}

// 1. Weather Proxy with Cache-Aside
app.get('/api/weather', async (req, res, next) => {
  const startTime = performance.now();
  try {
    const { city } = req.query;

    if (!city || typeof city !== 'string' || !city.trim()) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Il parametro query "city" è obbligatorio e non può essere vuoto.'
      });
    }

    const normalizedKey = city.trim().toLowerCase();
    const now = Date.now();

    // Cache HIT check
    if (weatherCache.has(normalizedKey)) {
      const cachedEntry = weatherCache.get(normalizedKey);
      if (now - cachedEntry.timestamp < CACHE_TTL_MS) {
        const responseTimeMs = Math.round(performance.now() - startTime);
        res.setHeader('X-Cache', 'HIT');
        return res.status(200).json({
          ...cachedEntry.data,
          source: 'cache',
          cachedAt: new Date(cachedEntry.timestamp).toISOString(),
          responseTimeMs
        });
      } else {
        // Expired entry
        weatherCache.delete(normalizedKey);
      }
    }

    // Cache MISS: Fetch from Open-Meteo
    const geocodingUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
      city.trim()
    )}&count=1&language=it&format=json`;

    let geocodingRes;
    try {
      geocodingRes = await fetch(geocodingUrl);
    } catch (err) {
      return res.status(502).json({
        error: 'Bad Gateway',
        message: `Impossibile raggiungere Open-Meteo Geocoding API: ${err.message}`
      });
    }

    if (!geocodingRes.ok) {
      return res.status(502).json({
        error: 'Bad Gateway',
        message: `Errore restituito da Open-Meteo Geocoding API (Status: ${geocodingRes.status})`
      });
    }

    const geocodingData = await geocodingRes.json();
    if (!geocodingData.results || geocodingData.results.length === 0) {
      return res.status(404).json({
        error: 'Not Found',
        message: `Nessun risultato trovato per la città "${city.trim()}".`
      });
    }

    const location = geocodingData.results[0];
    const { name, country, latitude, longitude } = location;

    // Fetch Forecast
    const forecastUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,wind_speed_10m,weather_code&timezone=auto`;

    let forecastRes;
    try {
      forecastRes = await fetch(forecastUrl);
    } catch (err) {
      return res.status(502).json({
        error: 'Bad Gateway',
        message: `Impossibile raggiungere Open-Meteo Forecast API: ${err.message}`
      });
    }

    if (!forecastRes.ok) {
      return res.status(502).json({
        error: 'Bad Gateway',
        message: `Errore restituito da Open-Meteo Forecast API (Status: ${forecastRes.status})`
      });
    }

    const forecastData = await forecastRes.json();
    const current = forecastData.current || {};

    const shapedData = {
      city: name,
      country: country || '',
      coordinates: {
        lat: latitude,
        lon: longitude
      },
      current: {
        temperature: current.temperature_2m,
        apparentTemperature: current.apparent_temperature,
        humidity: current.relative_humidity_2m,
        windSpeed: current.wind_speed_10m,
        weatherCode: current.weather_code
      }
    };

    // Store in cache
    weatherCache.set(normalizedKey, {
      data: shapedData,
      timestamp: now
    });

    const responseTimeMs = Math.round(performance.now() - startTime);
    res.setHeader('X-Cache', 'MISS');
    return res.status(200).json({
      ...shapedData,
      source: 'api',
      cachedAt: new Date(now).toISOString(),
      responseTimeMs
    });
  } catch (error) {
    next(error);
  }
});

// 2. Cache Inspection & Management
app.get('/api/cache/stats', (req, res) => {
  res.json({
    size: weatherCache.size,
    keys: Array.from(weatherCache.keys())
  });
});

app.delete('/api/cache', (req, res) => {
  weatherCache.clear();
  res.json({
    message: 'Cache svuotata con successo',
    size: 0
  });
});

// 3. Favorites CRUD
app.get('/api/favorites', async (req, res, next) => {
  try {
    const favorites = await getFavorites();
    res.json(favorites);
  } catch (err) {
    next(err);
  }
});

app.post('/api/favorites', async (req, res, next) => {
  try {
    const { city, country } = req.body;
    if (!city || typeof city !== 'string' || !city.trim()) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Il campo "city" è obbligatorio.'
      });
    }

    const trimmedCity = city.trim();
    const trimmedCountry = typeof country === 'string' ? country.trim() : '';

    const favorites = await getFavorites();
    const exists = favorites.some(
      (fav) => fav.city.toLowerCase() === trimmedCity.toLowerCase()
    );

    if (exists) {
      return res.status(409).json({
        error: 'Conflict',
        message: `La città "${trimmedCity}" è già presente nei preferiti.`
      });
    }

    const newFav = {
      city: trimmedCity,
      country: trimmedCountry,
      addedAt: new Date().toISOString()
    };

    favorites.push(newFav);
    await saveFavorites(favorites);

    res.status(201).json({
      message: 'Città aggiunta ai preferiti',
      favorite: newFav
    });
  } catch (err) {
    next(err);
  }
});

app.delete('/api/favorites/:city', async (req, res, next) => {
  try {
    const cityToDelete = req.params.city.trim().toLowerCase();
    const favorites = await getFavorites();

    const initialLength = favorites.length;
    const filtered = favorites.filter(
      (fav) => fav.city.toLowerCase() !== cityToDelete
    );

    if (filtered.length === initialLength) {
      return res.status(404).json({
        error: 'Not Found',
        message: `La città "${req.params.city}" non è presente nei preferiti.`
      });
    }

    await saveFavorites(filtered);
    res.json({
      message: 'Città rimossa dai preferiti',
      city: req.params.city
    });
  } catch (err) {
    next(err);
  }
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal Server Error',
    message: err.message || 'Si è verificato un errore inaspettato sul server.'
  });
});

// Start Server
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`Weather Proxy Server attivo su http://localhost:${PORT}`);
  });
}

export default app;
