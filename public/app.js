// WMO Weather interpretation codes (WW) in Italian
const WMO_WEATHER_MAP = {
  0: { label: 'Cielo sereno', emoji: '☀️' },
  1: { label: 'Prevalentemente sereno', emoji: '🌤️' },
  2: { label: 'Parzialmente nuvoloso', emoji: '⛅' },
  3: { label: 'Coperto', emoji: '☁️' },
  45: { label: 'Nebbia', emoji: '🌫️' },
  48: { label: 'Nebbia con brina', emoji: '🌫️' },
  51: { label: 'Pioggerella leggera', emoji: '🌦️' },
  53: { label: 'Pioggerella moderata', emoji: '🌦️' },
  55: { label: 'Pioggerella densa', emoji: '🌧️' },
  56: { label: 'Pioggerella gelata leggera', emoji: '🌧️❄️' },
  57: { label: 'Pioggerella gelata densa', emoji: '🌧️❄️' },
  61: { label: 'Pioggia debole', emoji: '🌧️' },
  63: { label: 'Pioggia moderata', emoji: '🌧️' },
  65: { label: 'Pioggia forte', emoji: '🌧️🌧️' },
  66: { label: 'Pioggia gelata leggera', emoji: '🧊🌧️' },
  67: { label: 'Pioggia gelata pesante', emoji: '🧊🌧️' },
  71: { label: 'Nevicata debole', emoji: '🌨️' },
  73: { label: 'Nevicata moderata', emoji: '🌨️' },
  75: { label: 'Nevicata forte', emoji: '❄️🌨️' },
  77: { label: 'Granuli di neve', emoji: '❄️' },
  80: { label: 'Rovesci di pioggia deboli', emoji: '🌦️' },
  81: { label: 'Rovesci di pioggia moderati', emoji: '🌧️' },
  82: { label: 'Rovesci violenti', emoji: '⛈️' },
  85: { label: 'Rovesci di neve deboli', emoji: '🌨️' },
  86: { label: 'Rovesci di neve forti', emoji: '❄️🌨️' },
  95: { label: 'Temporale', emoji: '⛈️' },
  96: { label: 'Temporale con grandine debole', emoji: '⛈️' },
  99: { label: 'Temporale con grandine forte', emoji: '⛈️' }
};

function getWeatherInfo(code) {
  if (code in WMO_WEATHER_MAP) {
    return WMO_WEATHER_MAP[code];
  }
  return { label: 'Condizioni variabili', emoji: '🌡️' };
}

// State
let currentCityData = null;
let favoriteCities = [];

// DOM Elements
const searchForm = document.getElementById('searchForm');
const cityInput = document.getElementById('cityInput');
const searchBtn = document.getElementById('searchBtn');
const clearCacheBtn = document.getElementById('clearCacheBtn');
const cacheCount = document.getElementById('cacheCount');
const statusAlert = document.getElementById('statusAlert');
const loadingIndicator = document.getElementById('loadingIndicator');
const weatherResult = document.getElementById('weatherResult');

const cityName = document.getElementById('cityName');
const countryName = document.getElementById('countryName');
const coordsLabel = document.getElementById('coordsLabel');
const sourceBadge = document.getElementById('sourceBadge');
const badgeText = document.getElementById('badgeText');
const favoriteToggleBtn = document.getElementById('favoriteToggleBtn');

const weatherEmoji = document.getElementById('weatherEmoji');
const tempValue = document.getElementById('tempValue');
const weatherDesc = document.getElementById('weatherDesc');
const apparentTempValue = document.getElementById('apparentTempValue');
const humidityValue = document.getElementById('humidityValue');
const windSpeedValue = document.getElementById('windSpeedValue');
const responseTimeValue = document.getElementById('responseTimeValue');
const cachedAtLabel = document.getElementById('cachedAtLabel');

const favoritesList = document.getElementById('favoritesList');
const favoritesEmptyMsg = document.getElementById('favoritesEmptyMsg');

// Alerts helper
function showAlert(message, type = 'error', durationMs = 5000) {
  statusAlert.textContent = message;
  statusAlert.className = `alert-box alert-${type}`;
  statusAlert.classList.remove('hidden');

  if (durationMs > 0) {
    setTimeout(() => {
      statusAlert.classList.add('hidden');
    }, durationMs);
  }
}

function hideAlert() {
  statusAlert.classList.add('hidden');
}

// Fetch and update cache stats
async function updateCacheStats() {
  try {
    const res = await fetch('/api/cache/stats');
    if (res.ok) {
      const data = await res.json();
      cacheCount.textContent = data.size || 0;
    }
  } catch (err) {
    console.warn('Impossibile recuperare statistiche cache:', err);
  }
}

// Clear backend cache
clearCacheBtn.addEventListener('click', async () => {
  try {
    const res = await fetch('/api/cache', { method: 'DELETE' });
    const data = await res.json();
    showAlert(`Cache del server svuotata (0 elementi in memoria).`, 'success');
    await updateCacheStats();
    if (currentCityData) {
      updateFavoriteButtonState();
    }
  } catch (err) {
    showAlert('Errore durante lo svuotamento della cache: ' + err.message, 'error');
  }
});

// Favorites management
async function loadFavorites() {
  try {
    const res = await fetch('/api/favorites');
    if (res.ok) {
      favoriteCities = await res.json();
      renderFavorites();
      updateFavoriteButtonState();
    }
  } catch (err) {
    console.warn('Impossibile caricare i preferiti:', err);
  }
}

function renderFavorites() {
  favoritesList.innerHTML = '';
  if (!favoriteCities || favoriteCities.length === 0) {
    favoritesEmptyMsg.classList.remove('hidden');
    return;
  }

  favoritesEmptyMsg.classList.add('hidden');
  favoriteCities.forEach((fav) => {
    const pill = document.createElement('div');
    pill.className = 'favorite-pill';

    const label = document.createElement('span');
    label.className = 'favorite-pill-name';
    label.textContent = fav.country ? `${fav.city}, ${fav.country}` : fav.city;
    label.addEventListener('click', () => {
      cityInput.value = fav.city;
      fetchWeather(fav.city);
    });

    const removeBtn = document.createElement('span');
    removeBtn.className = 'favorite-pill-delete';
    removeBtn.innerHTML = '&times;';
    removeBtn.title = 'Rimuovi dai preferiti';
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteFavorite(fav.city);
    });

    pill.appendChild(label);
    pill.appendChild(removeBtn);
    favoritesList.appendChild(pill);
  });
}

function updateFavoriteButtonState() {
  if (!currentCityData) return;
  const isFav = favoriteCities.some(
    (f) => f.city.toLowerCase() === currentCityData.city.toLowerCase()
  );

  if (isFav) {
    favoriteToggleBtn.textContent = '⭐ Rimuovi dai Preferiti';
    favoriteToggleBtn.className = 'btn btn-secondary';
  } else {
    favoriteToggleBtn.textContent = '⭐ Salva nei Preferiti';
    favoriteToggleBtn.className = 'btn btn-outline';
  }
}

async function toggleFavorite() {
  if (!currentCityData) return;
  const cityNameTarget = currentCityData.city;
  const isFav = favoriteCities.some(
    (f) => f.city.toLowerCase() === cityNameTarget.toLowerCase()
  );

  if (isFav) {
    await deleteFavorite(cityNameTarget);
  } else {
    await addFavorite(cityNameTarget, currentCityData.country);
  }
}

async function addFavorite(city, country) {
  try {
    const res = await fetch('/api/favorites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ city, country })
    });

    if (res.ok) {
      const data = await res.json();
      favoriteCities.push(data.favorite);
      renderFavorites();
      updateFavoriteButtonState();
      showAlert(`"${city}" aggiunta ai preferiti!`, 'success');
    } else {
      const err = await res.json();
      showAlert(err.message || 'Errore nel salvataggio del preferito', 'error');
    }
  } catch (err) {
    showAlert('Errore di connessione: ' + err.message, 'error');
  }
}

async function deleteFavorite(city) {
  try {
    const res = await fetch(`/api/favorites/${encodeURIComponent(city)}`, {
      method: 'DELETE'
    });

    if (res.ok) {
      favoriteCities = favoriteCities.filter(
        (f) => f.city.toLowerCase() !== city.toLowerCase()
      );
      renderFavorites();
      updateFavoriteButtonState();
      showAlert(`"${city}" rimossa dai preferiti.`, 'success');
    } else {
      const err = await res.json();
      showAlert(err.message || 'Errore nella rimozione', 'error');
    }
  } catch (err) {
    showAlert('Errore di rete: ' + err.message, 'error');
  }
}

favoriteToggleBtn.addEventListener('click', toggleFavorite);

// Main Weather Fetch
async function fetchWeather(city) {
  if (!city || !city.trim()) return;

  hideAlert();
  loadingIndicator.classList.remove('hidden');
  weatherResult.classList.add('hidden');
  searchBtn.disabled = true;

  try {
    const response = await fetch(`/api/weather?city=${encodeURIComponent(city.trim())}`);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || `Errore HTTP ${response.status}`);
    }

    currentCityData = data;
    displayWeatherData(data);
    await updateCacheStats();
  } catch (error) {
    showAlert(error.message, 'error', 7000);
  } finally {
    loadingIndicator.classList.add('hidden');
    searchBtn.disabled = false;
  }
}

// Display Result Card
function displayWeatherData(data) {
  const { city, country, coordinates, current, source, cachedAt, responseTimeMs } = data;

  cityName.textContent = city;
  countryName.textContent = country ? `${country}` : '';
  coordsLabel.textContent = `Lat: ${coordinates.lat.toFixed(2)}°, Lon: ${coordinates.lon.toFixed(2)}°`;

  // Weather condition
  const condition = getWeatherInfo(current.weatherCode);
  weatherEmoji.textContent = condition.emoji;
  weatherDesc.textContent = condition.label;
  tempValue.textContent = Math.round(current.temperature);

  // Metrics
  apparentTempValue.textContent = `${Math.round(current.apparentTemperature)} °C`;
  humidityValue.textContent = `${current.humidity} %`;
  windSpeedValue.textContent = `${current.windSpeed} km/h`;
  responseTimeValue.textContent = `${responseTimeMs} ms`;

  // Source Badge (Cache vs API)
  sourceBadge.className = 'source-badge';
  if (source === 'cache') {
    sourceBadge.classList.add('badge-cache');
    badgeText.innerHTML = `Sorgente: <strong>Cache Server</strong> (${responseTimeMs} ms)`;
  } else {
    sourceBadge.classList.add('badge-api');
    badgeText.innerHTML = `Sorgente: <strong>API Esterna</strong> (${responseTimeMs} ms)`;
  }

  // Cached timestamp
  const dateObj = new Date(cachedAt);
  cachedAtLabel.textContent = `Dati acquisiti alle ${dateObj.toLocaleTimeString('it-IT')}`;

  updateFavoriteButtonState();
  weatherResult.classList.remove('hidden');
}

// Search form event listener
searchForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const query = cityInput.value.trim();
  if (query) {
    cityInput.value = '';
    fetchWeather(query);
  }
});

// Initial boot
(async function init() {
  await loadFavorites();
  await updateCacheStats();
})();
