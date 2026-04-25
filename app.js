let watchId;
let timer;
let startTime;
let distance = 0;
let lastPos = null;

let blocks = [];
let running = false;
let paused = false;
let currentIndex = 0;
let blockStart = 0;
let blockElapsed = 0;
let remainingSec = 0;
let elapsed = 0;

let routePoints = [];
let flyMap = null;
let flyMarker = null;
let flyTimer = null;

let gpsEnabled = false;
let lastPaceAlert = 0;
let livePaceSec = null;
let lastSpeedMps = null;

document.addEventListener("DOMContentLoaded", () => {
  const blocksEl = document.getElementById("blocks");
  const gpsDot = document.getElementById("gpsDot");
  const gpsText = document.getElementById("gpsText");
  const gpsSub = document.getElementById("gpsSub");
  const statusEl = document.getElementById("status");
  const currentBlockEl = document.getElementById("currentBlock");
  const currentPaceEl = document.getElementById("currentPace");
  const remainingEl = document.getElementById("remaining");
  const blockBarEl = document.getElementById("blockBar");

  const startBtn = document.getElementById("startBtn");
  const pauseBtn = document.getElementById("pauseBtn");
  const stopBtn = document.getElementById("stopBtn");
  const addBlockBtn = document.getElementById("addBlockBtn");
  const gpsBtn = document.getElementById("gpsBtn");

  function bindUI() {
    if (gpsBtn) gpsBtn.onclick = activateGPS;
    if (addBlockBtn) addBlockBtn.onclick = () => addBlock("Novo bloco", 5, "6:00");
    if (startBtn) startBtn.onclick = startRun;
    if (pauseBtn) pauseBtn.onclick = pauseRun;
    if (stopBtn) stopBtn.onclick = () => stopRun(true);
  }

  function setGpsStatus(state, main, sub) {
    if (!gpsDot || !gpsText || !gpsSub) return;
    gpsDot.className = "gps-dot" + (state ? " " + state : "");
    gpsText.childNodes[0].nodeValue = main;
    gpsSub.textContent = sub;
  }

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
    const arr = [];

    rows.forEach(r => {
      const name = r.querySelector(".blk-name").value.trim() || "Bloco";
      const minutes = parseFloat(r.querySelector(".blk-min").value);
      const pace = r.querySelector(".blk-pace").value.trim();
      const sec = Math.max(1, Math.round((isFinite(minutes) ? minutes : 1) * 60));
      arr.push({ name, sec, pace });
    });

    return arr;
  }

  function renderCurrent() {
    if (!blocks.length || !currentBlockEl || !currentPaceEl || !remainingEl || !blockBarEl) {
      return;
    }

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
        const current = blocks.slice(0, currentIndex).reduce((sum, b) => sum + (b.sec || 0), 0);
        const progressInBlock = blocks[currentIndex] ? (1 - (remainingSec / blocks[currentIndex].sec)) : 0;
        const percent = total > 0 ? Math.round((((current + (blocks[currentIndex] ? blocks[currentIndex].sec * progressInBlock : 0)) / total) * 100)) : 0;
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

          watchId = navigator.geolocation.watchPosition(
            updateGPS,
            onGpsError,
            { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 }
          );
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
    }
  }

  function pauseRun() {
    if (!running) return;

    paused = !paused;

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

    if (watchId != null && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }

    if (statusEl) {
      statusEl.textContent = manual ? "Treino finalizado" : "Treino concluído";
    }

    speak(manual ? "Treino finalizado" : "Treino concluído");

    if (routePoints.length > 1) {
      setTimeout(startFlyover, 1200);
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

  function updateTimer() {
    if (!running || paused) return;

    elapsed = Math.floor((Date.now() - startTime) / 1000);
    if (document.getElementById("time")) {
      document.getElementById("time").textContent = fmt(elapsed);
    }
    updatePace(elapsed);
  }

  function updatePace(sec) {
    if (distance < 20) return;

    const pace = sec / (distance / 1000);
    const min = Math.floor(pace / 60);
    const s = String(Math.round(pace % 60)).padStart(2, "0");

    const paceEl = document.getElementById("pace");
    if (paceEl) paceEl.textContent = `${min}:${s}`;
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

  function startFlyover() {
    const modal = document.getElementById("flyoverModal");
    const mapEl = document.getElementById("flyMap");

    if (!modal || !mapEl || routePoints.length < 2) return;

    modal.style.display = "block";

    if (flyMap) {
      flyMap.remove();
      flyMap = null;
    }

    flyMap = L.map("flyMap", {
      zoomControl: false,
      attributionControl: false
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19
    }).addTo(flyMap);

    const line = L.polyline(routePoints, {
      color: "#ff7a00",
      weight: 6,
      opacity: 0.95
    }).addTo(flyMap);

    flyMap.fitBounds(line.getBounds(), {
      padding: [40, 40]
    });

    flyMarker = L.circleMarker(routePoints[0], {
      radius: 8,
      color: "#fff",
      weight: 2,
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
    const modal = document.getElementById("flyoverModal");
    if (modal) modal.style.display = "none";

    clearInterval(flyTimer);

    if (flyMap) {
      flyMap.remove();
      flyMap = null;
    }
  }

  window.closeFlyover = closeFlyover;
  window.startFlyover = startFlyover;
  window.startRun = startRun;
  window.pauseRun = pauseRun;
  window.stopRun = stopRun;

  bindUI();
  loadExample();
  renderCurrent();
  updateStats();
});
