let watchId = null;
let timer = null;
let startTime = 0;

let distance = 0;
let lastPos = null;
let routePoints = [];

let running = false;
let paused = false;

/* =========================
   INICIAR TREINO
========================= */
function startRun() {

  if (running) return;

  running = true;
  paused = false;

  startTime = Date.now();
  distance = 0;
  lastPos = null;
  routePoints = [];

  document.getElementById("dist").textContent = "0.00";
  document.getElementById("pace").textContent = "--";
  document.getElementById("time").textContent = "0:00";
  document.getElementById("status").textContent = "Rodando";

  speak("Treino iniciado");

  clearInterval(timer);
  timer = setInterval(updateTimer, 1000);

  if (navigator.geolocation) {
    watchId = navigator.geolocation.watchPosition(
      updateGPS,
      gpsError,
      {
        enableHighAccuracy: true,
        maximumAge: 1000,
        timeout: 10000
      }
    );
  } else {
    alert("GPS não suportado");
  }
}

/* =========================
   PAUSAR / RETOMAR
========================= */
function pauseRun() {

  if (!running) return;

  paused = !paused;

  if (paused) {
    clearInterval(timer);
    document.getElementById("status").textContent = "Pausado";
    speak("Pausado");
  } else {
    startTime = Date.now() - elapsedSeconds() * 1000;
    timer = setInterval(updateTimer, 1000);
    document.getElementById("status").textContent = "Rodando";
    speak("Retomado");
  }
}

/* =========================
   FINALIZAR
========================= */
function stopRun() {
  finishRun();
}

function finishRun() {

  if (!running) return;

  running = false;
  paused = false;

  clearInterval(timer);

  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }

  document.getElementById("status").textContent = "Finalizado";

  speak("Treino finalizado");

  /* replay automático */
  if (routePoints.length > 1) {
    setTimeout(() => {
      startFlyover();
    }, 1200);
  } else {
    alert("Treino finalizado. Sem rota suficiente para replay.");
  }
}

/* =========================
   TIMER
========================= */
function elapsedSeconds() {
  return Math.floor((Date.now() - startTime) / 1000);
}

function updateTimer() {

  if (!running || paused) return;

  let sec = elapsedSeconds();

  let min = Math.floor(sec / 60);
  let s = String(sec % 60).padStart(2, "0");

  document.getElementById("time").textContent = min + ":" + s;

  updatePace(sec);
}

/* =========================
   GPS
========================= */
function updateGPS(pos) {

  let lat = pos.coords.latitude;
  let lon = pos.coords.longitude;

  if (lastPos) {
    distance += calc(
      lastPos.lat,
      lastPos.lon,
      lat,
      lon
    );
  }

  lastPos = { lat, lon };

  routePoints.push([lat, lon]);

  document.getElementById("dist").textContent =
    (distance / 1000).toFixed(2);
}

function gpsError(err) {
  console.log(err);
  alert("Erro no GPS");
}

/* =========================
   PACE
========================= */
function updatePace(sec) {

  if (distance < 20) return;

  let pace = sec / (distance / 1000);

  let min = Math.floor(pace / 60);
  let s = String(Math.round(pace % 60)).padStart(2, "0");

  document.getElementById("pace").textContent =
    min + ":" + s;
}

/* =========================
   DISTÂNCIA (HAVERSINE)
========================= */
function calc(a, b, c, d) {

  const R = 6371000;
  const p = Math.PI / 180;

  const x = (c - a) * p;
  const y = (d - b) * p;

  const q =
    Math.sin(x / 2) ** 2 +
    Math.cos(a * p) *
    Math.cos(c * p) *
    Math.sin(y / 2) ** 2;

  return 2 * R * Math.asin(Math.sqrt(q));
}

/* =========================
   VOZ
========================= */
function speak(txt) {

  if ("speechSynthesis" in window) {

    let u = new SpeechSynthesisUtterance(txt);
    u.lang = "pt-BR";

    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }
}

/* =========================
   FLYOVER FINAL
========================= */
let flyMap = null;
let flyMarker = null;
let flyTimer = null;

function startFlyover() {

  const modal = document.getElementById("flyoverModal");
  const mapDiv = document.getElementById("flyMap");

  if (!modal || !mapDiv) {
    alert("Flyover não encontrado no HTML");
    return;
  }

  modal.style.display = "block";

  if (flyMap) {
    flyMap.remove();
    flyMap = null;
  }

  flyMap = L.map("flyMap", {
    zoomControl: false,
    attributionControl: false
  });

  L.tileLayer(
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    { maxZoom: 19 }
  ).addTo(flyMap);

  const line = L.polyline(routePoints, {
    color: "#ff7a00",
    weight: 6
  }).addTo(flyMap);

  flyMap.fitBounds(line.getBounds(), {
    padding: [40, 40]
  });

  flyMarker = L.circleMarker(routePoints[0], {
    radius: 8,
    color: "#fff",
    fillColor: "#ff7a00",
    fillOpacity: 1
  }).addTo(flyMap);

  let i = 0;

  clearInterval(flyTimer);

  flyTimer = setInterval(() => {

    if (i >= routePoints.length) {
      clearInterval(flyTimer);
      return;
    }

    flyMarker.setLatLng(routePoints[i]);

    flyMap.panTo(routePoints[i], {
      animate: true,
      duration: 0.8
    });

    i++;

  }, 650);
}

function closeFlyover() {

  document.getElementById("flyoverModal").style.display = "none";

  clearInterval(flyTimer);

  if (flyMap) {
    flyMap.remove();
    flyMap = null;
  }
}
