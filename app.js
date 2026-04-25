let watchId = null;
let timer = null;
let startTime = 0;

let distance = 0;
let lastPos = null;
let routePoints = [];

let blocks = [];
let running = false;
let paused = false;
let currentIndex = 0;
let blockStart = 0;
let blockElapsed = 0;
let remainingSec = 0;
let elapsed = 0;

let gpsEnabled = false;
let lastPaceAlert = 0;
let livePaceSec = null;
let lastSpeedMps = null;

let flyMap = null;
let flyMarker = null;
let flyTimer = null;

document.addEventListener("DOMContentLoaded", () => {
  const blocksEl = document.getElementById("blocks");
  const gpsBtn = document.getElementById("gpsBtn");
  const addBlockBtn = document.getElementById("addBlockBtn");
  const startBtn = document.getElementById("startBtn");
  const pauseBtn = document.getElementById("pauseBtn");
  const stopBtn = document.getElementById("stopBtn");
  const flyoverCloseBtn = document.getElementById("flyoverCloseBtn");

  function speak(txt) {
    if ("speechSynthesis" in window) {
      const u = new SpeechSynthesisUtterance(txt);
      u.lang = "pt-BR";
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    }
  }

  function fmt(sec) {
    sec = Math.max(0, Math.floor(sec));
    const m = Math.floor(sec / 60);
    const s = String(sec % 60).padStart(2, "0");
    return `${m}:${s}`;
  }

  function paceToSeconds(p) {
    const m = String(p || "").match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    return (+m[1] * 60) + (+m[2]);
  }

  function calc(a, b, c, d) {
    const R = 6371000;
    const p = Math.PI / 180;
    const x = (c - a) * p;
    const y = (d - b) * p;
    const q = Math.sin(x / 2) ** 2 +
      Math.cos(a * p) * Math.cos(c * p) *
      Math.sin(y / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(q));
  }

  function bearingBetween(lat1, lon1, lat2, lon2) {
    const toRad = Math.PI / 180;
    const toDeg = 180 / Math.PI;
    const φ1 = lat1 * toRad;
    const φ2 = lat2 * toRad;
    const λ1 = lon1 * toRad;
    const λ2 = lon2 * toRad;
    const y = Math.sin(λ2 - λ1) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) -
              Math.sin(φ1) * Math.cos(φ2) * Math.cos(λ2 - λ1);
    return (Math.atan2(y, x) * toDeg + 360) % 360;
  }

  function setGpsStatus(state, main, sub) {
    const gpsDot = document.getElementById("gpsDot");
    const gpsText = document.getElementById("gpsText");
    const gpsSub = document.getElementById("gpsSub");
    if (!gpsDot || !gpsText || !gpsSub) return;
    gpsDot.className = "gps-dot" + (state ? " " + state : "");
    gpsText.childNodes[0].nodeValue = main;
    gpsSub.textContent = sub;
  }

  function addBlock(name = "Bloco", minutes = "5", pace = "6:00") {
    if (!blocksEl) return;
    const row = document.createElement("div");
    row.className = "block-row";
    row.innerHTML = `
      <input class="blk-name" placeholder="Nome" value="${name}">
      <input class="blk-min" type="number" min="1" step="1" placeholder="Min" value="${minutes}">
      <input class="blk-pace" placeholder="Ritmo/km" value="${pace}">
      <button class="remove-btn" type="button" title="Remover">✕</button>
    `;
    row.querySelector(".remove-btn").onclick = () => row.remove();
    blocksEl.appendChild(row);
  }

  function loadExample() {
    if (!blocksEl) return;
    blocksEl.innerHTML = "";
    addBlock("Aquecimento", 10, "7:13");
    addBlock("Bloco principal", 28, "5:58");
    addBlock("Volta à calma", 5, "7:13");
  }

  function readBlocks() {
    if (!blocksEl) return [];
    const rows = [...blocksEl.querySelectorAll(".block-row")];
    return rows.map(r => {
      const name = r.querySelector(".blk-name").value.trim() || "Bloco";
      const minutes = parseFloat(r.querySelector(".blk-min").value);
      const pace = r.querySelector(".blk-pace").value.trim();
      const sec = Math.max(1, Math.round((isFinite(minutes) ? minutes : 1) * 60));
      return { name, sec, pace };
    });
  }

  function maybeAlertPace(secPerKm) {
    if (!running || paused || currentIndex >= blocks.length) return;
    const target = paceToSeconds(blocks[currentIndex].pace);
    if (!target || !Number.isFinite(secPerKm) || secPerKm <= 0) return;

    const now = Date.now();
    if (now - lastPaceAlert < 20000) return;
    lastPaceAlert = now;

    const diff = secPerKm - target;
    if (Math.abs(diff) <= 12) return;

    if (diff > 0) speak("Acelera");
    else speak("Diminua o ritmo");
  }

  function renderCurrent() {
    const currentBlockEl = document.getElementById("currentBlock");
    const currentPaceEl = document.getElementById("currentPace");
    const remainingEl = document.getElementById("remaining");
    const blockBarEl = document.getElementById("blockBar");

    if (!blocks.length || !currentBlockEl || !currentPaceEl || !remainingEl || !blockBarEl) return;

    const b = blocks[currentIndex] || blocks[blocks.length - 1];
    if (!b) return;

    currentBlockEl.textContent = b.name;
    currentPaceEl.textContent = `${Math.floor(b.sec / 60)} min • ${b.pace}/km`;
    remainingEl.textContent = `Restante do bloco: ${fmt(remainingSec)}`;

    const pct = b.sec ? Math.max(0, Math.min(100, ((b.sec - remainingSec) / b.sec) * 100)) : 0;
    blockBarEl.style.width = pct + "%";
  }

  function updateStats() {
    const timeEl = document.getElementById("time");
    const distEl = document.getElementById("dist");
    const paceEl = document.getElementById("pace");
    const speedEl = document.getElementById("speed");
    const progressEl = document.getElementById("progress");

    if (timeEl) timeEl.textContent = fmt(elapsed);
    if (distEl) distEl.textContent = (distance / 1000).toFixed(2);

    if (progressEl) {
      if (!blocks.length) {
        progressEl.textContent = "0%";
      } else {
        const total = blocks.reduce((sum, b) => sum + (b.sec || 0), 0);
        const completedBefore = blocks.slice(0, currentIndex).reduce((sum, b) => sum + (b.sec || 0), 0);
        const currentDone = blocks[currentIndex] ? (blocks[currentIndex].sec * (1 - (remainingSec / blocks[currentIndex].sec))) : 0;
        const percent = total > 0 ? Math.round(((completedBefore + currentDone) / total) * 100) : 0;
        progressEl.textContent = `${Math.max(0, Math.min(100, percent))}%`;
      }
    }

    if (paceEl) {
      if (livePaceSec) {
        paceEl.textContent = fmt(livePaceSec);
      } else if (elapsed > 0 && distance > 20) {
        const paceSec = elapsed / (distance / 1000);
        paceEl.textContent = fmt(paceSec);
      } else {
        paceEl.textContent = "--";
      }
    }

    if (speedEl) {
      if (elapsed > 0 && distance > 0) {
        speedEl.textContent = ((distance / 1000) / (elapsed / 3600)).toFixed(1);
      } else {
        speedEl.textContent = "0.0";
      }
    }
  }

  function tick() {
    if (paused || !running) return;

    elapsed = Math.floor((Date.now() - startTime) / 1000);
    blockElapsed = Math.floor((Date.now() - blockStart) / 1000);
    remainingSec = Math.max(0, (blocks[currentIndex]?.sec || 0) - blockElapsed);

    if (remainingSec <= 0) {
      currentIndex++;
      if (currentIndex >= blocks.length) {
        finishRun(false);
        return;
      }
      blockStart = Date.now();
      blockElapsed = 0;
      remainingSec = blocks[currentIndex].sec;
      speak(blocks[currentIndex].name);
      lastPaceAlert = 0;
    }

    if (livePaceSec) maybeAlertPace(livePaceSec);
    else if (elapsed > 0 && distance > 20) maybeAlertPace(elapsed / (distance / 1000));

    updateStats();
    renderCurrent();
  }

  function startRun() {
    blocks = readBlocks();

    if (!blocks.length) {
      setGpsStatus("err", "Sem blocos", "Adicione pelo menos 1 bloco");
      const statusEl = document.getElementById("status");
      if (statusEl) statusEl.textContent = "Adicione pelo menos 1 bloco";
      return;
    }

    running = true;
    paused = false;
    currentIndex = 0;
    elapsed = 0;
    distance = 0;
    lastPos = null;
    routePoints = [];
    livePaceSec = null;
    lastSpeedMps = null;
    lastPaceAlert = 0;

    startTime = Date.now();
    blockStart = Date.now();
    remainingSec = blocks[0].sec;

    const statusEl = document.getElementById("status");
    if (statusEl) statusEl.textContent = "Treino iniciado";
    speak("Treino iniciado");

    renderCurrent();
    updateStats();

    clearInterval(timer);
    timer = setInterval(tick, 1000);

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        () => {
          gpsEnabled = true;
          setGpsStatus("on", "GPS ativo", "Localização liberada");
          if (watchId) navigator.geolocation.clearWatch(watchId);
          watchId = navigator.geolocation.watchPosition(updateGPS, onGpsError, {
            enableHighAccuracy: true,
            maximumAge: 1000,
            timeout: 10000
          });
        },
        err => {
          gpsEnabled = false;
          setGpsStatus(
            "err",
            err.code === 1 ? "Permissão negada" : "GPS indisponível",
            err.code === 1 ? "Permita a localização para medir ritmo e distância" : "Verifique o GPS do aparelho"
          );
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
      );
    } else {
      setGpsStatus("err", "GPS não suportado", "Este navegador não oferece localização");
    }
  }

  function pauseRun() {
    if (!running) return;

    paused = !paused;

    const statusEl = document.getElementById("status");
    if (paused) {
      clearInterval(timer);
      if (statusEl) statusEl.textContent = "Treino pausado";
      speak("Pausado");
    } else {
      startTime = Date.now() - elapsed * 1000;
      blockStart = Date.now() - blockElapsed * 1000;
      if (statusEl) statusEl.textContent = "Treino retomado";
      speak("Retomado");
      clearInterval(timer);
      timer = setInterval(tick, 1000);
    }
  }

  function stopRun(manual = false) {
    finishRun(manual);
  }

  function finishRun(manual = false) {
    running = false;
    paused = false;
    clearInterval(timer);

    if (watchId !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }

    const statusEl = document.getElementById("status");
    if (statusEl) statusEl.textContent = manual ? "Treino finalizado" : "Treino concluído";

    speak(manual ? "Treino finalizado" : "Treino concluído");

    if (routePoints.length > 1) {
      setTimeout(startFlyover3D, 1200);
    }
  }

  function updateGPS(pos) {
    const lat = pos.coords.latitude;
    const lon = pos.coords.longitude;
    const speed = pos.coords.speed;

    if (lastPos) {
      distance += calc(lastPos.lat, lastPos.lon, lat, lon);
    }

    lastPos = { lat, lon };
    routePoints.push([lat, lon]);

    if (Number.isFinite(speed) && speed >= 0) {
      lastSpeedMps = speed;
      if (speed > 0) {
        livePaceSec = 1000 / speed;
        maybeAlertPace(livePaceSec);
      }
    }

    updateStats();
  }

  function updateGPSFallback(pos) {
    updateGPS(pos);
  }

  function onGpsError(err) {
    gpsEnabled = false;
    setGpsStatus(
      "err",
      err.code === 1 ? "Permissão negada" : "GPS indisponível",
      err.code === 1 ? "Abra a permissão de localização no navegador" : "Tente novamente com o GPS ligado"
    );
  }

  function activateGPS() {
    if (!navigator.geolocation) {
      setGpsStatus("err", "GPS não suportado", "Este navegador não oferece localização");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      () => {
        gpsEnabled = true;
        setGpsStatus("on", "GPS ativo", "Localização liberada");
        if (!running) speak("GPS ativado");
      },
      err => {
        gpsEnabled = false;
        setGpsStatus(
          "err",
          err.code === 1 ? "Permissão negada" : "GPS indisponível",
          err.code === 1 ? "Permita a localização para iniciar" : "Confira o GPS do celular"
        );
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
    );
  }

  function startFlyover3D() {
    const modal = document.getElementById("flyoverModal");
    const mapEl = document.getElementById("flyMap");

    if (!modal || !mapEl) return;
    if (!window.maplibregl) {
      alert("MapLibre GL ainda não carregou.");
      return;
    }
    if (!routePoints || routePoints.length < 2) {
      alert("Treino finalizado. Sem rota suficiente para replay.");
      return;
    }

    modal.style.display = "block";
    modal.setAttribute("aria-hidden", "false");

    if (flyTimer) {
      clearTimeout(flyTimer);
      flyTimer = null;
    }
    if (flyMap) {
      flyMap.remove();
      flyMap = null;
    }

    const start = routePoints[0];
    flyMap = new maplibregl.Map({
      container: "flyMap",
      style: "https://demotiles.maplibre.org/style.json",
      center: [start[1], start[0]],
      zoom: 17.5,
      pitch: 72,
      bearing: 0,
      antialias: true
    });

    flyMap.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

    flyMap.on("load", () => {
      flyMap.addSource("route", {
        type: "geojson",
        data: {
          type: "Feature",
          properties: {},
          geometry: {
            type: "LineString",
            coordinates: routePoints.map(p => [p[1], p[0]])
          }
        }
      });

      flyMap.addLayer({
        id: "route-line-glow",
        type: "line",
        source: "route",
        paint: {
          "line-color": "#ffb347",
          "line-width": 10,
          "line-opacity": 0.25
        }
      });

      flyMap.addLayer({
        id: "route-line",
        type: "line",
        source: "route",
        paint: {
          "line-color": "#ff7a00",
          "line-width": 5.5,
          "line-opacity": 0.95
        }
      });

      flyMap.addSource("marker", {
        type: "geojson",
        data: {
          type: "Feature",
          properties: {},
          geometry: {
            type: "Point",
            coordinates: [start[1], start[0]]
          }
        }
      });

      flyMap.addLayer({
        id: "route-marker",
        type: "circle",
        source: "marker",
        paint: {
          "circle-radius": 7,
          "circle-color": "#ffffff",
          "circle-stroke-width": 4,
          "circle-stroke-color": "#ff7a00"
        }
      });

      const styleSources = flyMap.getStyle().sources || {};
      if (styleSources.openmaptiles || styleSources.composite) {
        const sourceName = styleSources.openmaptiles ? "openmaptiles" : "composite";
        const layers = flyMap.getStyle().layers || [];
        const firstLabel = layers.find(layer => layer.type === "symbol" && layer.layout && layer.layout["text-field"]);
        const beforeId = firstLabel ? firstLabel.id : undefined;

        try {
          flyMap.addLayer(
            {
              id: "3d-buildings",
              source: sourceName,
              "source-layer": "building",
              type: "fill-extrusion",
              minzoom: 15,
              paint: {
                "fill-extrusion-color": "#666666",
                "fill-extrusion-height": [
                  "interpolate",
                  ["linear"],
                  ["zoom"],
                  15, 0,
                  16, ["coalesce", ["get", "render_height"], ["get", "height"], 0]
                ],
                "fill-extrusion-base": [
                  "interpolate",
                  ["linear"],
                  ["zoom"],
                  15, 0,
                  16, ["coalesce", ["get", "render_min_height"], ["get", "min_height"], 0]
                ],
                "fill-extrusion-opacity": 0.58
              }
            },
            beforeId
          );
        } catch (e) {
          console.warn("Layer 3D buildings não pôde ser adicionada:", e);
        }
      }

      animateFlyover3D();
    });
  }

  function animateFlyover3D() {
    if (!flyMap || !routePoints.length) return;

    let i = 0;

    const step = () => {
      if (!flyMap || i >= routePoints.length) return;

      const current = routePoints[i];
      const next = routePoints[Math.min(i + 1, routePoints.length - 1)];

      const markerSrc = flyMap.getSource("marker");
      if (markerSrc) {
        markerSrc.setData({
          type: "Feature",
          properties: {},
          geometry: {
            type: "Point",
            coordinates: [current[1], current[0]]
          }
        });
      }

      const bearing = i < routePoints.length - 1
        ? bearingBetween(current[0], current[1], next[0], next[1])
        : flyMap.getBearing();

      flyMap.easeTo({
        center: [current[1], current[0]],
        zoom: 18.4,
        pitch: 76,
        bearing,
        duration: 850,
        essential: true
      });

      i += 1;
      flyTimer = setTimeout(step, 900);
    };

    step();
  }

  function closeFlyover() {
    const modal = document.getElementById("flyoverModal");
    if (modal) {
      modal.style.display = "none";
      modal.setAttribute("aria-hidden", "true");
    }

    if (flyTimer) {
      clearTimeout(flyTimer);
      flyTimer = null;
    }

    if (flyMap) {
      flyMap.remove();
      flyMap = null;
    }
  }

  if (gpsBtn) gpsBtn.onclick = activateGPS;
  if (addBlockBtn) addBlockBtn.onclick = () => addBlock("Novo bloco", 5, "6:00");
  if (startBtn) startBtn.onclick = startRun;
  if (pauseBtn) pauseBtn.onclick = pauseRun;
  if (stopBtn) stopBtn.onclick = () => stopRun(true);
  if (flyoverCloseBtn) flyoverCloseBtn.onclick = closeFlyover;

  loadExample();
  renderCurrent();
  updateStats();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }

  window.startFlyover3D = startFlyover3D;
  window.closeFlyover = closeFlyover;
  window.startRun = startRun;
  window.pauseRun = pauseRun;
  window.stopRun = stopRun;
  window.updateGPS = updateGPSFallback;
  window.updateTimer = tick;
  window.speak = speak;
  window.calc = calc;
});
