// ===== CONFIGURAÇÃO POR OMISSÃO =====
// Estes são os valores iniciais. O utilizador pode alterá-los na app
// antes de começar o treino (botão "EXERCÍCIO ▸" alterna o que se edita).
let workSeconds = 20;   // duração do exercício, em segundos
let restSeconds = 10;   // duração do descanso, em segundos
let totalRounds = 8;    // número de rondas

const textColor = "#ffffff";
const bgColorSetup = "#000000";     // fundo enquanto configuras / parado
const bgColorExercicio = "#8f0d0d"; // fundo vermelho durante o exercício
const bgColorDescanso  = "#0d6b2f"; // fundo verde durante o descanso
const flashColor = "#ffffff";       // cor do flash de alerta (inverte sobre o fundo da fase)

// Pilha de fontes monospace do sistema (sem depender de nenhum ficheiro .ttf externo)
const DIGIT_FONT_FAMILY = "ui-monospace, 'SF Mono', SFMono-Regular, Menlo, Consolas, 'Roboto Mono', monospace";

const GAP_EM = 0.08;
const OUTER_MARGIN = 0.05;

const MAX_MINUTES_DURACAO = 59; // limite razoável para exercício/descanso
const MAX_RONDAS = 99;
const MIN_RONDAS = 1;

const MENU_HIDE_DELAY = 2500;   // começa fade aos 2.5s
const CURSOR_HIDE_DELAY = 3000; // cursor some brusco aos 3s

const FLASH_DURATION = 150; // Duração de cada flash em ms
const FLASH_COUNT = 2;      // Número de flashes em transições normais
const FLASH_INTERVAL = 200; // Intervalo entre flashes

const WARNING_SECONDS = 3; // últimos segundos de cada fase onde apita a avisar
// =======================

// ---------- Estado da sessão de treino ----------
// editTarget: o que os botões MIN/SEG estão a editar enquanto a sessão não começou
// 'EXERCICIO' | 'DESCANSO' | 'RONDAS'
let editTarget = "EXERCICIO";

let sessionStarted = false; // true assim que se carrega em play pela 1ª vez (volta a false com reset)
let running = false;        // true enquanto a contagem está activa (não pausada)
let phase = null;           // 'EXERCICIO' | 'DESCANSO' | null (null = ainda não começou)
let currentRound = 0;       // 1-indexed depois de começar
let remainingSeconds = 0;   // segundos restantes na fase actual
let finished = false;       // true quando terminou todas as rondas

let timerId = null;

// Sistema de flash de alerta
let isFlashingTransition = false;
let isFlashingEnd = false;
let hasWarnedThisPhase = false; // evita apitar mais do que uma vez por segundo

// Sistema de piscar ao terminar tudo
let isBlinking = false;
let blinkVisible = true;
let blinkTimer = null;

// Tecla B pressionada — flash manual (mantido do timer original)
let bKeyHeld = false;

const canvas = document.getElementById("screen");
const ctx = canvas.getContext("2d");
const controls = document.getElementById("controls");

// ---------- Áudio (beep via Web Audio, sem ficheiros externos) ----------
let audioCtx = null;

function ensureAudioContext() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) audioCtx = new AC();
  }
  if (audioCtx && audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => {});
  }
}

function beep(vezes = 1, duracaoMs = 120, frequencia = 880, intervaloMs = 130) {
  if (!audioCtx) return;
  let t = audioCtx.currentTime;
  for (let i = 0; i < vezes; i++) {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.value = frequencia;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.35, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duracaoMs / 1000);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + duracaoMs / 1000 + 0.02);
    t += (duracaoMs + intervaloMs) / 1000;
  }
}

// ---------- util ----------
function clampDuracao(segundos) {
  return Math.max(0, Math.min(MAX_MINUTES_DURACAO * 60 + 59, segundos));
}
function clampRondas(n) {
  return Math.max(MIN_RONDAS, Math.min(MAX_RONDAS, n));
}
function getMMSS(secondsTotal) {
  const c = Math.max(0, secondsTotal);
  return { mm: Math.floor(c / 60), ss: c % 60 };
}
function formatMMSS(secondsTotal) {
  const { mm, ss } = getMMSS(secondsTotal);
  return String(mm).padStart(2, "0") + ":" + String(ss).padStart(2, "0");
}

// ---------- Auto-hide (menu fade + cursor brusco) ----------
let menuTimer = null;
let cursorTimer = null;

function showMenu() {
  if (!controls) return;
  controls.classList.remove("is-fading");
}
function fadeMenu() {
  if (!controls) return;
  controls.classList.add("is-fading");
}

function showCursor() {
  document.body.style.cursor = "";
}
function hideCursor() {
  document.body.style.cursor = "none";
}

function resetAutoHide() {
  if (menuTimer) clearTimeout(menuTimer);
  showMenu();
  menuTimer = setTimeout(() => {
    fadeMenu();
  }, MENU_HIDE_DELAY);

  if (cursorTimer) clearTimeout(cursorTimer);
  showCursor();
  cursorTimer = setTimeout(() => {
    hideCursor();
  }, CURSOR_HIDE_DELAY);
}

function hideNow() {
  if (menuTimer) clearTimeout(menuTimer);
  menuTimer = null;
  fadeMenu();
  hideCursor();
}

function bindAutoHide() {
  const wake = (e) => {
    if (e && e.code === "KeyB") return;
    resetAutoHide();
  };

  window.addEventListener("mousemove", wake, { passive: true });
  window.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "touch" && e.target === canvas) return;
    wake(e);
  }, { passive: true });
  window.addEventListener("keydown", wake);

  canvas.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && !controls.classList.contains("is-fading")) {
      e.stopPropagation();
      hideNow();
    }
  });

  canvas.addEventListener("touchend", (e) => {
    e.preventDefault();
    if (controls.classList.contains("is-fading")) {
      resetAutoHide();
    } else {
      hideNow();
    }
  }, { passive: false });

  window.addEventListener("blur", () => {
    showMenu();
    showCursor();
    if (menuTimer) clearTimeout(menuTimer);
    if (cursorTimer) clearTimeout(cursorTimer);
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      showMenu();
      showCursor();
      if (menuTimer) clearTimeout(menuTimer);
      if (cursorTimer) clearTimeout(cursorTimer);
    } else {
      resetAutoHide();
    }
  });
}

// ---------- Fullscreen (cross-browser) ----------
function isFullscreen() {
  return !!(
    document.fullscreenElement ||
    document.webkitFullscreenElement ||
    document.mozFullScreenElement ||
    document.msFullscreenElement
  );
}
function requestFs(el) {
  if (el.requestFullscreen) return el.requestFullscreen();
  if (el.webkitRequestFullscreen) return el.webkitRequestFullscreen();
  if (el.mozRequestFullScreen) return el.mozRequestFullScreen();
  if (el.msRequestFullscreen) return el.msRequestFullscreen();
  return Promise.reject(new Error("Fullscreen not supported"));
}
function exitFs() {
  if (document.exitFullscreen) return document.exitFullscreen();
  if (document.webkitExitFullscreen) return document.webkitExitFullscreen();
  if (document.mozCancelFullScreen) return document.mozCancelFullScreen();
  if (document.msExitFullscreen) return document.msExitFullscreen();
  return Promise.reject(new Error("Exit fullscreen not supported"));
}
async function toggleFullscreen() {
  try {
    if (isFullscreen()) {
      await exitFs();
      if (screen.orientation && screen.orientation.unlock) {
        screen.orientation.unlock();
      }
    } else {
      await requestFs(document.documentElement);
    }
  } catch (_) {}
  resetAutoHide();
}

// ---------- Canvas ----------
function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const w = window.innerWidth;
  const h = window.innerHeight;

  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  canvas.style.width = w + "px";
  canvas.style.height = h + "px";

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// Escala o menu para caber sempre no ecrã, limitado por largura E altura
function scaleMenu() {
  const W = window.innerWidth;
  const H = window.innerHeight;

  const panelW = 4 * 92 + 3 * 18 + 2 * 26; // 474px
  const panelH = 2 * 64 + 30 + 2 * 14 + 2 * 22; // 230px

  const scaleByWidth  = (W * 0.92) / panelW;
  const scaleByHeight = (H * 0.32) / panelH;

  let scale = Math.min(scaleByWidth, scaleByHeight, 1);

  const isPortrait = H > W;
  if (!isPortrait) scale = Math.min(scale * 1.56, 1);

  const r = document.documentElement;
  r.style.setProperty('--btn-w',        Math.round(92  * scale) + 'px');
  r.style.setProperty('--btn-h',        Math.round(64  * scale) + 'px');
  r.style.setProperty('--gap-x',        Math.round(18  * scale) + 'px');
  r.style.setProperty('--row-gap',      Math.round(14  * scale) + 'px');
  r.style.setProperty('--label-h',      Math.round(30  * scale) + 'px');
  r.style.setProperty('--panel-pad-x',  Math.round(26  * scale) + 'px');
  r.style.setProperty('--panel-pad-y',  Math.round(22  * scale) + 'px');
  r.style.setProperty('--panel-radius', Math.round(26  * scale) + 'px');
  r.style.setProperty('--label-font',   Math.round(13  * scale) + 'px');
  r.style.setProperty('--icon-font',    Math.round(22  * scale) + 'px');
  r.style.setProperty('--icon-font-sm', Math.round(19  * scale) + 'px');
  r.style.setProperty('--cycle-font',   Math.round(12  * scale) + 'px');
}

function measureGlyph(ch) {
  const m = ctx.measureText(ch);
  return {
    width: (m.actualBoundingBoxLeft ?? 0) + (m.actualBoundingBoxRight ?? m.width),
    left: (m.actualBoundingBoxLeft ?? 0),
    ascent: (m.actualBoundingBoxAscent ?? 0),
    descent: (m.actualBoundingBoxDescent ?? 0),
  };
}

let _cachedFontSize = 0;
let _cachedBaseline = { realAscent: 0, realDescent: 0 };

function measureGlyphPixels(fontSize) {
  if (fontSize === _cachedFontSize) return _cachedBaseline;

  const tmpCanvas = document.createElement('canvas');
  const tmpSize = Math.ceil(fontSize * 1.5);
  tmpCanvas.width  = tmpSize;
  tmpCanvas.height = tmpSize;
  const tmpCtx = tmpCanvas.getContext('2d');
  tmpCtx.font = `${fontSize}px ${DIGIT_FONT_FAMILY}`;
  tmpCtx.fillStyle = '#fff';
  tmpCtx.fillText('8', 0, fontSize);
  const imgData = tmpCtx.getImageData(0, 0, tmpSize, tmpSize).data;

  let topPx = tmpSize, bottomPx = 0;
  for (let y = 0; y < tmpSize; y++) {
    for (let x = 0; x < tmpSize; x++) {
      if (imgData[(y * tmpSize + x) * 4 + 3] > 10) {
        if (y < topPx)    topPx    = y;
        if (y > bottomPx) bottomPx = y;
      }
    }
  }

  _cachedFontSize = fontSize;
  _cachedBaseline = {
    realAscent:  fontSize - topPx,
    realDescent: bottomPx - fontSize,
  };
  return _cachedBaseline;
}

// Calcula o tamanho de letra e o layout para uma string arbitrária
// (dígitos e, opcionalmente, ':'), ajustando à largura disponível.
function computeFontSizeAndLayout(str, W, H, maxHeightFraction) {
  let fs = Math.floor(H * maxHeightFraction);

  function calc(size) {
    ctx.font = `${size}px ${DIGIT_FONT_FAMILY}`;
    const d = measureGlyph("8");
    const c = measureGlyph(":");
    const g = size * GAP_EM;

    let total = 0;
    const widths = [];
    for (const ch of str) {
      const w = ch === ":" ? c.width : d.width;
      widths.push(w);
      total += w;
    }
    total += g * (str.length - 1);

    return { total, widths, gap: g, fontSize: size };
  }

  const maxW = W * (1 - OUTER_MARGIN * 2);
  let L = calc(fs);

  let guard = 0;
  while (L.total > maxW && guard < 40) {
    fs = Math.floor(fs * 0.97);
    L = calc(fs);
    guard++;
  }

  return L;
}

function drawDigits(str, W, H, maxHeightFraction, colorOverride) {
  const { fontSize, widths, gap } = computeFontSizeAndLayout(str, W, H, maxHeightFraction);
  ctx.font = `${fontSize}px ${DIGIT_FONT_FAMILY}`;
  ctx.fillStyle = colorOverride;

  const { realAscent, realDescent } = measureGlyphPixels(fontSize);
  const baselineY = Math.round((H + realAscent - realDescent) / 2);

  const totalW = widths.reduce((a, b) => a + b, 0) + gap * (str.length - 1);
  let x = (W - totalW) / 2;

  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    const m = measureGlyph(ch);
    const drawX = x + (widths[i] - m.width) / 2 + m.left;
    ctx.fillText(ch, drawX, baselineY);
    x += widths[i] + gap;
  }
}

function drawTopLabel(text, W, topY) {
  ctx.font = `700 ${Math.max(14, Math.round(W * 0.028))}px system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif`;
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(text, W / 2, topY);
  ctx.textAlign = "start";
}

// ---------- Cores consoante o estado ----------
function getBgColor() {
  if (!sessionStarted || finished) return bgColorSetup;
  if (phase === "EXERCICIO") return bgColorExercicio;
  if (phase === "DESCANSO") return bgColorDescanso;
  return bgColorSetup;
}

// ---------- Desenho principal ----------
function drawTimer(forceFlash = false) {
  const W = window.innerWidth;
  const H = window.innerHeight;

  if (bKeyHeld) forceFlash = true;

  const bg = getBgColor();
  ctx.fillStyle = forceFlash ? flashColor : bg;
  ctx.fillRect(0, 0, W, H);

  const textCol = forceFlash ? bg : textColor;

  if (!sessionStarted) {
    // ---------- Ecrã de configuração ----------
    let label, str, heightFraction;
    if (editTarget === "EXERCICIO") {
      label = "EXERCÍCIO";
      str = formatMMSS(workSeconds);
      heightFraction = 0.80;
    } else if (editTarget === "DESCANSO") {
      label = "DESCANSO";
      str = formatMMSS(restSeconds);
      heightFraction = 0.80;
    } else {
      label = "NÚMERO DE RONDAS";
      str = String(totalRounds).padStart(2, "0");
      heightFraction = 0.80;
    }
    drawTopLabel(label, W, Math.round(H * 0.14));
    drawDigits(str, W, H, heightFraction, textCol);
    return;
  }

  // ---------- Sessão em curso, pausada, ou terminada ----------
  if (finished) {
    drawTopLabel("TREINO CONCLUÍDO", W, Math.round(H * 0.14));
    if (!isBlinking || blinkVisible) {
      drawDigits("FIM", W, H, 0.55, textCol);
    }
    return;
  }

  const faseLabel = phase === "EXERCICIO" ? "EXERCÍCIO" : "DESCANSO";
  const topLabel = `${faseLabel}  —  RONDA ${currentRound}/${totalRounds}${!running ? "  (PAUSA)" : ""}`;
  drawTopLabel(topLabel, W, Math.round(H * 0.12));
  drawDigits(formatMMSS(remainingSeconds), W, H, 0.78, textCol);
}

// ---------- Sistema de Flash de Alerta ----------
function triggerTransitionFlash(onDone) {
  isFlashingTransition = true;
  let flashesRemaining = FLASH_COUNT;

  function doFlash() {
    if (flashesRemaining <= 0) {
      isFlashingTransition = false;
      drawTimer(false);
      if (onDone) onDone();
      return;
    }
    drawTimer(true);
    setTimeout(() => {
      drawTimer(false);
      flashesRemaining--;
      if (flashesRemaining > 0) {
        setTimeout(doFlash, FLASH_INTERVAL);
      } else {
        isFlashingTransition = false;
        drawTimer(false);
        if (onDone) onDone();
      }
    }, FLASH_DURATION);
  }

  doFlash();
}

function triggerEndFlashThenBlink() {
  isFlashingEnd = true;
  let flashesRemaining = FLASH_COUNT + 1; // um pouco mais chamativo no fim de tudo

  function doFlash() {
    if (flashesRemaining <= 0) {
      isFlashingEnd = false;
      drawTimer(false);
      startBlinking();
      return;
    }
    drawTimer(true);
    setTimeout(() => {
      drawTimer(false);
      flashesRemaining--;
      if (flashesRemaining > 0) {
        setTimeout(doFlash, FLASH_INTERVAL);
      } else {
        isFlashingEnd = false;
        drawTimer(false);
        startBlinking();
      }
    }, FLASH_DURATION);
  }

  doFlash();
}

function startBlinking() {
  if (isBlinking) return;
  isBlinking = true;
  blinkVisible = true;

  function tick() {
    blinkVisible = !blinkVisible;
    drawTimer();
    blinkTimer = setTimeout(tick, 500);
  }

  drawTimer();
  blinkTimer = setTimeout(tick, 500);
}

function stopBlinking() {
  if (!isBlinking) return;
  isBlinking = false;
  blinkVisible = true;
  if (blinkTimer) {
    clearTimeout(blinkTimer);
    blinkTimer = null;
  }
}

// ---------- Atualizar ícone do botão play/pause ----------
function updatePlayPauseButton() {
  const playPauseBtn = document.getElementById("playPause");
  if (!playPauseBtn) return;

  if (running) {
    playPauseBtn.textContent = "❚❚";
    playPauseBtn.setAttribute("aria-label", "pause");
  } else {
    playPauseBtn.textContent = "▶";
    playPauseBtn.setAttribute("aria-label", "play");
  }
}

// ---------- Labels e botão de alternar alvo de edição ----------
function updateEditUI() {
  const labelMin = document.getElementById("labelMin");
  const labelSec = document.getElementById("labelSec");
  const cycleBtn = document.getElementById("cycleTarget");
  if (!labelMin || !labelSec || !cycleBtn) return;

  if (editTarget === "RONDAS") {
    labelMin.textContent = "x5";
    labelSec.textContent = "x1";
  } else {
    labelMin.textContent = "MIN";
    labelSec.textContent = "SEG";
  }

  const nomes = { EXERCICIO: "EXERCÍCIO ▸", DESCANSO: "DESCANSO ▸", RONDAS: "RONDAS ▸" };
  cycleBtn.textContent = nomes[editTarget];

  // só se pode editar antes de começar o treino
  cycleBtn.disabled = sessionStarted;
  document.getElementById("plusMin").disabled = sessionStarted;
  document.getElementById("plusSec").disabled = sessionStarted;
  document.getElementById("minusMin").disabled = sessionStarted;
  document.getElementById("minusSec").disabled = sessionStarted;
}

function cycleEditTarget() {
  if (sessionStarted) return;
  const ordem = ["EXERCICIO", "DESCANSO", "RONDAS"];
  const i = ordem.indexOf(editTarget);
  editTarget = ordem[(i + 1) % ordem.length];
  updateEditUI();
  drawTimer();
  resetAutoHide();
}

// ---------- Ajustes (só disponíveis antes de começar) ----------
function adjustMinutes(delta) {
  if (sessionStarted) return;

  if (editTarget === "RONDAS") {
    totalRounds = clampRondas(totalRounds + delta * 5);
  } else if (editTarget === "EXERCICIO") {
    workSeconds = clampDuracao(workSeconds + delta * 60);
  } else {
    restSeconds = clampDuracao(restSeconds + delta * 60);
  }
  drawTimer();
  resetAutoHide();
}

function adjustSeconds(delta) {
  if (sessionStarted) return;

  if (editTarget === "RONDAS") {
    totalRounds = clampRondas(totalRounds + delta);
  } else if (editTarget === "EXERCICIO") {
    let { mm, ss } = getMMSS(workSeconds);
    if (delta > 0) { ss++; if (ss === 60) { ss = 0; mm++; } }
    else { ss--; if (ss === -1) { ss = 59; mm = Math.max(0, mm - 1); } }
    workSeconds = clampDuracao(mm * 60 + ss);
  } else {
    let { mm, ss } = getMMSS(restSeconds);
    if (delta > 0) { ss++; if (ss === 60) { ss = 0; mm++; } }
    else { ss--; if (ss === -1) { ss = 59; mm = Math.max(0, mm - 1); } }
    restSeconds = clampDuracao(mm * 60 + ss);
  }
  drawTimer();
  resetAutoHide();
}

// ---------- Motor do timer ----------
function startCountdownInterval() {
  if (timerId) {
    clearInterval(timerId);
    timerId = null;
  }
  timerId = setInterval(() => {
    if (!running) return;

    remainingSeconds--;

    if (remainingSeconds <= WARNING_SECONDS && remainingSeconds > 0 && !isFlashingTransition && !isFlashingEnd) {
      beep(1, 90, 880, 0);
    }

    if (remainingSeconds <= 0) {
      handlePhaseEnd();
    } else {
      drawTimer();
    }
  }, 1000);
}

function handlePhaseEnd() {
  if (phase === "EXERCICIO") {
    if (currentRound >= totalRounds) {
      // Treino completo!
      clearInterval(timerId);
      timerId = null;
      finished = true;
      running = true; // mantém para o botão mostrar pause (irrelevante, fica escondido no ecrã final)
      updatePlayPauseButton();
      beep(3, 180, 660, 120);
      triggerEndFlashThenBlink();
      return;
    }
    // Passa a descanso
    phase = "DESCANSO";
    remainingSeconds = restSeconds;
    beep(2, 120, 523, 110);
    triggerTransitionFlash(() => drawTimer());
  } else if (phase === "DESCANSO") {
    // Passa à ronda seguinte de exercício
    currentRound++;
    phase = "EXERCICIO";
    remainingSeconds = workSeconds;
    beep(1, 150, 880, 0);
    triggerTransitionFlash(() => drawTimer());
  }
}

function startTimer() {
  ensureAudioContext();

  if (!sessionStarted) {
    // Começar um treino novo a partir da configuração
    sessionStarted = true;
    finished = false;
    currentRound = 1;
    phase = "EXERCICIO";
    remainingSeconds = workSeconds;
    updateEditUI();
    beep(1, 150, 880, 0);
  }

  if (finished) return; // não se retoma depois de terminado; usar reset

  stopBlinking();
  running = true;
  startCountdownInterval();
  updatePlayPauseButton();
  drawTimer();
  resetAutoHide();
}

function pauseTimer() {
  running = false;
  if (timerId) clearInterval(timerId);
  timerId = null;
  drawTimer();
  updatePlayPauseButton();
  resetAutoHide();
}

function toggleStartPause() {
  if (finished) return; // no fim, só reset reinicia
  if (running) pauseTimer();
  else startTimer();
}

function resetTimer() {
  running = false;
  finished = false;
  sessionStarted = false;
  phase = null;
  currentRound = 0;
  remainingSeconds = 0;
  if (timerId) clearInterval(timerId);
  timerId = null;
  stopBlinking();
  updateEditUI();
  updatePlayPauseButton();
  drawTimer();
  resetAutoHide();
}

// ---------- Duplo clique no canvas para fullscreen ----------
function bindCanvasDoubleClick() {
  if (!canvas) return;

  canvas.addEventListener("dblclick", (e) => {
    e.preventDefault();
    toggleFullscreen();
  });
}

// ---------- Bind UI (robusto) ----------
function bindHoldButton(el, action) {
  if (!el) return;

  let holdTimer = null;
  let holdInterval = null;

  function start(e) {
    if (el.disabled) return;
    e.preventDefault();
    action();
    holdTimer = setTimeout(() => {
      holdInterval = setInterval(action, 50);
    }, 500);
  }

  function stop() {
    if (holdTimer)    clearTimeout(holdTimer);
    if (holdInterval) clearInterval(holdInterval);
    holdTimer = null;
    holdInterval = null;
  }

  el.addEventListener("pointerdown", start);
  window.addEventListener("pointerup",     stop);
  window.addEventListener("pointercancel", stop);
}

function bindControls() {
  const plusMin = document.getElementById("plusMin");
  const minusMin = document.getElementById("minusMin");
  const plusSec = document.getElementById("plusSec");
  const minusSec = document.getElementById("minusSec");
  const playPauseBtn = document.getElementById("playPause");
  const resetBtn = document.getElementById("reset");
  const fsBtn = document.getElementById("fullscreen");
  const cycleBtn = document.getElementById("cycleTarget");

  bindHoldButton(plusMin,  () => adjustMinutes(+1));
  bindHoldButton(minusMin, () => adjustMinutes(-1));
  bindHoldButton(plusSec,  () => adjustSeconds(+1));
  bindHoldButton(minusSec, () => adjustSeconds(-1));

  if (playPauseBtn) playPauseBtn.addEventListener("click", () => { ensureAudioContext(); toggleStartPause(); });
  if (resetBtn) resetBtn.addEventListener("click", resetTimer);
  if (cycleBtn) cycleBtn.addEventListener("click", cycleEditTarget);

  if (fsBtn) {
    fsBtn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      toggleFullscreen();
    });
  }
}

// ---------- Atalhos ----------
function bindKeyboardShortcuts() {
  window.addEventListener("keydown", (e) => {
    if (e.code === "KeyB" && !e.repeat) {
      e.preventDefault();
      bKeyHeld = true;
      drawTimer(true);
      return;
    }

    resetAutoHide();

    if (e.code === "Space") {
      e.preventDefault();
      ensureAudioContext();
      toggleStartPause();
      return;
    }
    if (e.code === "KeyR") {
      e.preventDefault();
      resetTimer();
      return;
    }
    if (e.code === "KeyF") {
      e.preventDefault();
      toggleFullscreen();
      return;
    }
    if (e.code === "Tab") {
      e.preventDefault();
      cycleEditTarget();
      return;
    }

    if (e.code === "ArrowUp") {
      e.preventDefault();
      if (e.shiftKey) adjustMinutes(+1);
      else adjustSeconds(+1);
      return;
    }
    if (e.code === "ArrowDown") {
      e.preventDefault();
      if (e.shiftKey) adjustMinutes(-1);
      else adjustSeconds(-1);
      return;
    }
  });

  window.addEventListener("keyup", (e) => {
    if (e.code === "KeyB") {
      e.preventDefault();
      bKeyHeld = false;
      drawTimer(false);
    }
  });
}

// ---------- Start ----------
async function start() {
  resizeCanvas();
  scaleMenu();

  bindControls();
  bindKeyboardShortcuts();
  bindCanvasDoubleClick();
  bindDraggableControls();
  bindAutoHide();

  updateEditUI();
  drawTimer();
  updatePlayPauseButton();
  resetAutoHide();
}

// ---------- Arrastar menu de controlo ----------
function bindDraggableControls() {
  if (!controls) return;

  let isDragging = false;
  let offsetX = 0;
  let offsetY = 0;

  function startDrag(e) {
    if (e.target.closest('.btn') || e.target.closest('.btn-cycle')) return;
    isDragging = true;

    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    const rect = controls.getBoundingClientRect();
    offsetX = clientX - rect.left;
    offsetY = clientY - rect.top;

    controls.style.transform = 'none';
    controls.style.left   = rect.left + 'px';
    controls.style.top    = rect.top  + 'px';
    controls.style.bottom = 'auto';
    controls.style.cursor = 'grabbing';

    resetAutoHide();
    e.preventDefault();
  }

  function drag(e) {
    if (!isDragging) return;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    const pw = controls.offsetWidth;
    const ph = controls.offsetHeight;
    const newX = Math.min(Math.max(0, clientX - offsetX), window.innerWidth  - pw);
    const newY = Math.min(Math.max(0, clientY - offsetY), window.innerHeight - ph);

    controls.style.left = newX + 'px';
    controls.style.top  = newY + 'px';

    resetAutoHide();
    e.preventDefault();
  }

  function stopDrag() {
    if (!isDragging) return;
    isDragging = false;
    controls.style.cursor = '';
    resetAutoHide();
  }

  controls.addEventListener('mousedown',  startDrag);
  window.addEventListener('mousemove',    drag);
  window.addEventListener('mouseup',      stopDrag);

  controls.addEventListener('touchstart', startDrag, { passive: false });
  window.addEventListener('touchmove',    drag,      { passive: false });
  window.addEventListener('touchend',     stopDrag);
}

function resetControlsPosition() {
  if (!controls) return;
  controls.style.left      = '50%';
  controls.style.top       = '';
  controls.style.bottom    = '0px';
  controls.style.transform = 'translateX(-50%)';
  controls.style.cursor    = '';
}

window.addEventListener("resize", () => {
  resizeCanvas();
  scaleMenu();
  drawTimer();
  resetControlsPosition();
  resetAutoHide();
});

document.addEventListener("fullscreenchange", () => {
  resizeCanvas();
  scaleMenu();
  drawTimer();
  resetControlsPosition();
  resetAutoHide();
});
document.addEventListener("webkitfullscreenchange", () => {
  resizeCanvas();
  scaleMenu();
  drawTimer();
  resetControlsPosition();
  resetAutoHide();
});

screen.orientation && screen.orientation.addEventListener("change", () => {
  resizeCanvas();
  scaleMenu();
  drawTimer();
  resetControlsPosition();
  resetAutoHide();
});

start();
