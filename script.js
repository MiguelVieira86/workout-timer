// ===== CONFIGURAÇÃO POR OMISSÃO =====
// Cada ronda tem o seu próprio tempo de exercício e de descanso, totalmente
// independentes das restantes. O utilizador edita ronda a ronda antes de
// começar (setas "‹ RONDA 3/4 ›" para navegar, ＋/－ para adicionar/remover).
const DEFAULT_WORK_SECONDS = 60; // 1 minuto
const DEFAULT_REST_SECONDS = 10; // 10 segundos
const DEFAULT_NUM_ROUNDS = 4;

function criarRondaOmissao(isUltima = false) {
  return { work: DEFAULT_WORK_SECONDS, rest: isUltima ? 0 : DEFAULT_REST_SECONDS };
}

const STORAGE_KEY = "cardioTimerRoundsV1";

function carregarRondasGuardadas() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    // Valida a forma dos dados antes de confiar neles
    const valido = parsed.every(r =>
      r && typeof r.work === "number" && typeof r.rest === "number" &&
      r.work >= 0 && r.rest >= 0
    );
    return valido ? parsed : null;
  } catch (_) {
    return null;
  }
}

function guardarRondas() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rounds));
  } catch (_) {
    // Se o armazenamento local não estiver disponível, a app continua a
    // funcionar normalmente, só não guarda as preferências entre sessões.
  }
}

function criarRondasOmissao(n) {
  return Array.from({ length: n }, (_, i) => criarRondaOmissao(i === n - 1));
}

let rounds = carregarRondasGuardadas() || criarRondasOmissao(DEFAULT_NUM_ROUNDS);

const textColor = "#ffffff";
const bgColorSetup = "#000000";     // fundo enquanto configuras / parado
const bgColorExercicio = "#8f0d0d"; // fundo vermelho durante o exercício
const bgColorDescanso  = "#0d6b2f"; // fundo verde durante o descanso
const bgColorPrep = bgColorExercicio; // (já não usado como cor própria, mantido por compatibilidade)
const flashColor = "#ffffff";       // cor do flash de alerta (inverte sobre o fundo da fase)

// Fonte "Anonymous Pro" (ficheiro local AnonymousPro-Regular.ttf, licença aberta,
// zero traçado tal como o Menlo do Mac). Se por algum motivo não carregar, cai no
// monospace do sistema como reserva.
const DIGIT_FONT_FAMILY = "'Anonymous Pro', ui-monospace, Menlo, Consolas, monospace";

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

const WARNING_SECONDS = 5; // últimos segundos de cada fase onde apita a avisar
const PREP_SECONDS = 3;    // segundos de "compasso de espera" antes de cada início de treino
const LIVE_EDIT_FREEZE_MS = 1300; // tempo que a contagem fica "congelada" após cada ajuste manual
// =======================

// ---------- Estado de edição (antes de começar o treino) ----------
let editRoundIndex = 0;       // índice (0-based) da ronda a ser editada
let editTarget = "EXERCICIO"; // 'EXERCICIO' | 'DESCANSO' — o que os botões MIN/SEG editam

// ---------- Estado da sessão de treino ----------
let sessionStarted = false; // true assim que se carrega em play pela 1ª vez (volta a false com reset)
let running = false;        // true enquanto a contagem está activa (não pausada)
let phase = null;           // 'PREPARANDO' | 'EXERCICIO' | 'DESCANSO' | null (null = ainda não começou)
let prepRemaining = 0;      // segundos restantes da contagem de preparação (3, 2, 1)
let liveEditFreezeUntil = 0; // timestamp até ao qual a contagem fica pausada por edição manual
let currentRound = 0;       // 1-indexed depois de começar
let remainingSeconds = 0;   // segundos restantes na fase actual
let finished = false;       // true quando terminou todas as rondas

let timerId = null;

// Sistema de flash de alerta
let isFlashingTransition = false;
let isFlashingEnd = false;

// Sistema de piscar ao terminar tudo
let isBlinking = false;
let blinkVisible = true;
let blinkTimer = null;

// Tecla B pressionada — flash manual (mantido do timer original)
let bKeyHeld = false;

const canvas = document.getElementById("screen");
const ctx = canvas.getContext("2d");
const controls = document.getElementById("controls");

// Ícone da app (mostrado, a piscar, no ecrã final em vez da palavra "FIM")
const appIconImg = new Image();
let appIconLoaded = false;
appIconImg.onload = () => {
  appIconLoaded = true;
  if (finished) drawTimer();
};
appIconImg.src = "icon-512.png";

// ---------- Áudio (beep via Web Audio, sem ficheiros externos) ----------
let audioCtx = null;
let audioCompressor = null;

function ensureAudioContext() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) {
      audioCtx = new AC();
      // Um compressor à saída permite subir bastante o ganho sem distorcer
      // (o som fica "mais cheio" e mais alto na prática, sem cortar/estalar).
      audioCompressor = audioCtx.createDynamicsCompressor();
      audioCompressor.threshold.value = -14;
      audioCompressor.knee.value = 12;
      audioCompressor.ratio.value = 8;
      audioCompressor.attack.value = 0.003;
      audioCompressor.release.value = 0.15;
      audioCompressor.connect(audioCtx.destination);
    }
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
    // Sine soa mais suave/agradável; o ganho a 1.0 + compressor já ajudam
    // bastante no volume percebido sem precisar de mudar a forma de onda.
    osc.type = "sine";
    osc.frequency.value = frequencia;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(1.0, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duracaoMs / 1000);
    osc.connect(gain);
    gain.connect(audioCompressor || audioCtx.destination);
    osc.start(t);
    osc.stop(t + duracaoMs / 1000 + 0.02);
    t += (duracaoMs + intervaloMs) / 1000;
  }
}

// ---------- util ----------
function clampDuracao(segundos) {
  return Math.max(0, Math.min(MAX_MINUTES_DURACAO * 60 + 59, segundos));
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
      if (screen.orientation && screen.orientation.lock) {
        screen.orientation.lock("landscape").catch(() => {});
      }
    }
  } catch (_) {}
  resetAutoHide();
}

// Se a app estiver instalada (aberta a partir do ícone, não do browser),
// entra automaticamente em fullscreen e bloqueia a orientação horizontal.
function isStandalonePWA() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches ||
    window.navigator.standalone === true // iOS
  );
}

async function autoEnterFullscreenIfInstalled() {
  if (!isStandalonePWA()) return;
  try {
    if (!isFullscreen()) {
      await requestFs(document.documentElement);
    }
    if (screen.orientation && screen.orientation.lock) {
      await screen.orientation.lock("landscape").catch(() => {});
    }
  } catch (_) {
    // Alguns browsers exigem interação do utilizador antes do fullscreen
    // funcionar; nesse caso o botão ⛶ continua disponível como reserva.
  }
}

// ---------- Canvas ----------
function getViewportSize() {
  // visualViewport é mais fiável do que window.innerWidth/innerHeight em
  // modo fullscreen no Android, onde por vezes o innerWidth/innerHeight
  // fica ligeiramente desatualizado e corta conteúdo nas margens.
  if (window.visualViewport) {
    return {
      w: Math.round(window.visualViewport.width),
      h: Math.round(window.visualViewport.height),
    };
  }
  return { w: window.innerWidth, h: window.innerHeight };
}

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const { w, h } = getViewportSize();

  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  canvas.style.width = w + "px";
  canvas.style.height = h + "px";

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// Escala o menu para caber sempre no ecrã, limitado por largura E altura
function scaleMenu() {
  const { w: W, h: H } = getViewportSize();

  const panelW = 4 * 92 + 3 * 18 + 2 * 26; // 474px
  const panelH = 2 * 64 + 30 + 2 * 14 + 2 * 22 + 56; // + linha de navegação de rondas (maior, mais fácil de tocar)

  const scaleByWidth  = (W * 0.92) / panelW;
  const scaleByHeight = (H * 0.36) / panelH;

  let scale = Math.min(scaleByWidth, scaleByHeight, 1);

  const isPortrait = H > W;
  if (!isPortrait) scale = Math.min(scale * 1.5, 1);

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
  if (finished) return bgColorDescanso; // ecrã final usa as cores do descanso (verde)
  if (!sessionStarted) {
    // Durante a edição, o fundo já mostra a cor da fase que estás a editar,
    // como prévia do que vais ver durante o treino.
    return editTarget === "EXERCICIO" ? bgColorExercicio : bgColorDescanso;
  }
  if (phase === "PREPARANDO") return bgColorExercicio; // mesma cor do exercício (vermelho)
  if (phase === "EXERCICIO") return bgColorExercicio;
  if (phase === "DESCANSO") return bgColorDescanso;
  return bgColorSetup;
}

// ---------- Desenho principal ----------
function drawTimer(forceFlash = false) {
  const { w: W, h: H } = getViewportSize();

  if (bKeyHeld) forceFlash = true;

  const bg = getBgColor();
  ctx.fillStyle = forceFlash ? flashColor : bg;
  ctx.fillRect(0, 0, W, H);

  const textCol = forceFlash ? bg : textColor;

  if (!sessionStarted) {
    // ---------- Ecrã de configuração (ronda a ronda) ----------
    const ronda = rounds[editRoundIndex];
    const isUltimaRonda = editRoundIndex === rounds.length - 1;

    const roundaLabel = `RONDA ${editRoundIndex + 1}/${rounds.length}`;
    let faseLabel, str;
    if (editTarget === "EXERCICIO") {
      faseLabel = "EXERCÍCIO";
      str = formatMMSS(ronda.work);
    } else {
      faseLabel = `DESCANSO${isUltimaRonda ? " (não usado)" : ""}`;
      str = formatMMSS(ronda.rest);
    }
    drawTopLabel(roundaLabel, W, Math.round(H * 0.11));
    drawTopLabel(faseLabel, W, Math.round(H * 0.20));
    drawDigits(str, W, H, 0.70, textCol);
    return;
  }

  // ---------- Sessão em curso, pausada, ou terminada ----------
  if (finished) {
    drawTopLabel("TREINO CONCLUÍDO", W, Math.round(H * 0.14));
    if (!isBlinking || blinkVisible) {
      if (appIconLoaded) {
        const size = Math.min(W, H) * 0.5;
        ctx.drawImage(appIconImg, (W - size) / 2, (H - size) / 2, size, size);
      } else {
        drawDigits("FIM", W, H, 0.55, textCol);
      }
    }
    return;
  }

  if (phase === "PREPARANDO") {
    drawTopLabel("A COMEÇAR EM", W, Math.round(H * 0.14));
    drawDigits(String(prepRemaining), W, H, 0.70, textCol);
    return;
  }

  const faseLabel = phase === "EXERCICIO" ? "EXERCÍCIO" : "DESCANSO";
  const roundaLabel2 = `RONDA ${currentRound}/${rounds.length}`;
  drawTopLabel(roundaLabel2, W, Math.round(H * 0.11));
  drawTopLabel(`${faseLabel}${!running ? "  (PAUSA)" : ""}`, W, Math.round(H * 0.20));
  drawDigits(formatMMSS(remainingSeconds), W, H, 0.70, textCol);
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

// ---------- Labels, botão de alternar exercício/descanso, e navegação de rondas ----------
function updateEditUI() {
  const labelMin = document.getElementById("labelMin");
  const labelSec = document.getElementById("labelSec");
  const cycleBtn = document.getElementById("cycleTarget");
  const roundNav = document.getElementById("roundNav");
  const roundIndicator = document.getElementById("roundIndicator");
  const prevBtn = document.getElementById("prevRound");
  const nextBtn = document.getElementById("nextRound");
  const addBtn = document.getElementById("addRound");
  const removeBtn = document.getElementById("removeRound");
  if (!labelMin || !labelSec || !cycleBtn) return;

  labelMin.textContent = "MIN";
  labelSec.textContent = "SEG";

  const nomes = { EXERCICIO: "EXERCÍCIO ▸", DESCANSO: "DESCANSO ▸" };
  cycleBtn.textContent = nomes[editTarget];

  if (roundIndicator) {
    roundIndicator.textContent = `RONDA ${editRoundIndex + 1}/${rounds.length}`;
  }

  // só se pode navegar/adicionar/remover rondas e alternar exercício-descanso antes de começar
  const bloqueadoConfig = sessionStarted;
  cycleBtn.disabled = bloqueadoConfig;

  // os ajustes de tempo (▲▼) ficam sempre disponíveis, mesmo a treino a decorrer —
  // só desligam quando o treino termina (aí já não há nada para ajustar)
  const bloqueadoAjuste = finished;
  document.getElementById("plusMin").disabled = bloqueadoAjuste;
  document.getElementById("plusSec").disabled = bloqueadoAjuste;
  document.getElementById("minusMin").disabled = bloqueadoAjuste;
  document.getElementById("minusSec").disabled = bloqueadoAjuste;

  if (roundNav) roundNav.classList.toggle("hidden", bloqueadoConfig);
  if (prevBtn) prevBtn.disabled = bloqueadoConfig || editRoundIndex === 0;
  if (nextBtn) nextBtn.disabled = bloqueadoConfig || editRoundIndex === rounds.length - 1;
  if (addBtn) addBtn.disabled = bloqueadoConfig || rounds.length >= MAX_RONDAS;
  if (removeBtn) removeBtn.disabled = bloqueadoConfig || rounds.length <= MIN_RONDAS;
}

function cycleEditTarget() {
  if (sessionStarted) return;
  editTarget = editTarget === "EXERCICIO" ? "DESCANSO" : "EXERCICIO";
  updateEditUI();
  drawTimer();
  resetAutoHide();
}

// ---------- Navegação e gestão de rondas (só disponível antes de começar) ----------
function navRound(delta) {
  if (sessionStarted) return;
  editRoundIndex = Math.max(0, Math.min(rounds.length - 1, editRoundIndex + delta));
  updateEditUI();
  drawTimer();
  resetAutoHide();
}

function addRound() {
  if (sessionStarted || rounds.length >= MAX_RONDAS) return;
  // Nova ronda com os valores por omissão (1 min exercício / 15s descanso),
  // inserida a seguir à ronda atual.
  rounds.splice(editRoundIndex + 1, 0, criarRondaOmissao());
  editRoundIndex++;
  // Se a nova ronda ficou em último lugar, o descanso dela não é usado — fica a 0
  if (editRoundIndex === rounds.length - 1) {
    rounds[editRoundIndex].rest = 0;
  }
  guardarRondas();
  updateEditUI();
  drawTimer();
  resetAutoHide();
}

function removeRound() {
  if (sessionStarted || rounds.length <= MIN_RONDAS) return;
  rounds.splice(editRoundIndex, 1);
  editRoundIndex = Math.min(editRoundIndex, rounds.length - 1);
  guardarRondas();
  updateEditUI();
  drawTimer();
  resetAutoHide();
}

// ---------- Ajustes de tempo ----------
// Antes de começar: ajusta o tempo programado da ronda selecionada.
// A treino a decorrer (ou em pausa): ajusta directamente a contagem actual,
// sem precisar de pausar primeiro.
function adjustMinutes(delta) {
  if (finished || phase === "PREPARANDO") return;
  if (sessionStarted) {
    remainingSeconds = clampDuracao(remainingSeconds + delta * 60);
    liveEditFreezeUntil = Date.now() + LIVE_EDIT_FREEZE_MS;
    drawTimer();
    resetAutoHide();
    return;
  }
  const ronda = rounds[editRoundIndex];
  if (editTarget === "EXERCICIO") ronda.work = clampDuracao(ronda.work + delta * 60);
  else ronda.rest = clampDuracao(ronda.rest + delta * 60);
  guardarRondas();
  drawTimer();
  resetAutoHide();
}

function adjustSeconds(delta) {
  if (finished || phase === "PREPARANDO") return;
  if (sessionStarted) {
    let { mm, ss } = getMMSS(remainingSeconds);
    if (delta > 0) { ss++; if (ss === 60) { ss = 0; mm++; } }
    else { ss--; if (ss === -1) { ss = 59; mm = Math.max(0, mm - 1); } }
    remainingSeconds = clampDuracao(mm * 60 + ss);
    liveEditFreezeUntil = Date.now() + LIVE_EDIT_FREEZE_MS;
    drawTimer();
    resetAutoHide();
    return;
  }
  const ronda = rounds[editRoundIndex];
  const campo = editTarget === "EXERCICIO" ? "work" : "rest";
  let { mm, ss } = getMMSS(ronda[campo]);
  if (delta > 0) { ss++; if (ss === 60) { ss = 0; mm++; } }
  else { ss--; if (ss === -1) { ss = 59; mm = Math.max(0, mm - 1); } }
  ronda[campo] = clampDuracao(mm * 60 + ss);
  guardarRondas();
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

    // Enquanto o utilizador estiver a ajustar o tempo manualmente, a contagem
    // fica "congelada" por instantes, para os números não continuarem a
    // descer ao mesmo tempo que se edita (ficava confuso).
    if (Date.now() < liveEditFreezeUntil) return;

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
    if (currentRound >= rounds.length) {
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
    // Passa a descanso (usa o tempo de descanso definido para ESTA ronda)
    phase = "DESCANSO";
    remainingSeconds = rounds[currentRound - 1].rest;
    beep(2, 120, 523, 110);
    triggerTransitionFlash(() => drawTimer());
  } else if (phase === "DESCANSO") {
    // Passa à ronda seguinte de exercício (usa o tempo dessa nova ronda)
    currentRound++;
    phase = "EXERCICIO";
    remainingSeconds = rounds[currentRound - 1].work;
    beep(1, 150, 880, 0);
    triggerTransitionFlash(() => drawTimer());
  }
}

function startTimer() {
  ensureAudioContext();

  if (!sessionStarted) {
    // Antes de começar de facto a contagem, há um pequeno "compasso de
    // espera" de 3 segundos (3, 2, 1) com sinal sonoro, para o utilizador
    // se preparar. Só depois é que a ronda selecionada começa a contar.
    sessionStarted = true;
    finished = false;
    currentRound = editRoundIndex + 1;
    phase = "PREPARANDO";
    prepRemaining = PREP_SECONDS;
    updateEditUI();
    stopBlinking();
    running = true;
    updatePlayPauseButton();
    beep(1, 130, 660, 0);
    drawTimer();
    resetAutoHide();

    if (timerId) clearInterval(timerId);
    timerId = setInterval(() => {
      prepRemaining--;
      if (prepRemaining > 0) {
        beep(1, 130, 660, 0);
        drawTimer();
      } else {
        clearInterval(timerId);
        timerId = null;
        phase = "EXERCICIO";
        remainingSeconds = rounds[editRoundIndex].work;
        beep(2, 150, 880, 100);
        drawTimer();
        startCountdownInterval();
      }
    }, 1000);
    return;
  }

  if (finished) return; // não se retoma depois de terminado; usar reset
  if (phase === "PREPARANDO") return; // já está a decorrer a preparação

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

function stopTimer() {
  // "Parar" não é um reset total: guarda em que ronda estava, para que ao
  // premir play de novo o treino recomece nessa mesma ronda (não na primeira).
  running = false;
  finished = false;
  sessionStarted = false;
  const rondaOndeParou = currentRound > 0 ? currentRound - 1 : editRoundIndex;
  editRoundIndex = Math.max(0, Math.min(rounds.length - 1, rondaOndeParou));
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
  const prevBtn = document.getElementById("prevRound");
  const nextBtn = document.getElementById("nextRound");
  const addBtn = document.getElementById("addRound");
  const removeBtn = document.getElementById("removeRound");

  bindHoldButton(plusMin,  () => adjustMinutes(+1));
  bindHoldButton(minusMin, () => adjustMinutes(-1));
  bindHoldButton(plusSec,  () => adjustSeconds(+1));
  bindHoldButton(minusSec, () => adjustSeconds(-1));

  if (playPauseBtn) playPauseBtn.addEventListener("click", () => { ensureAudioContext(); toggleStartPause(); });
  if (resetBtn) resetBtn.addEventListener("click", stopTimer);
  if (cycleBtn) cycleBtn.addEventListener("click", cycleEditTarget);

  if (prevBtn) prevBtn.addEventListener("click", () => navRound(-1));
  if (nextBtn) nextBtn.addEventListener("click", () => navRound(+1));
  if (addBtn) addBtn.addEventListener("click", addRound);
  if (removeBtn) removeBtn.addEventListener("click", removeRound);

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
      stopTimer();
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
    if (e.code === "BracketLeft") {
      e.preventDefault();
      navRound(-1);
      return;
    }
    if (e.code === "BracketRight") {
      e.preventDefault();
      navRound(+1);
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

  // Espera que a fonte Anonymous Pro esteja pronta antes do primeiro desenho,
  // para não haver um "salto" visual de outra fonte para esta.
  if (document.fonts && document.fonts.load) {
    try {
      await document.fonts.load("48px 'Anonymous Pro'");
      await document.fonts.ready;
    } catch (_) {}
  }

  bindControls();
  bindKeyboardShortcuts();
  bindCanvasDoubleClick();
  bindDraggableControls();
  bindAutoHide();

  updateEditUI();
  drawTimer();
  updatePlayPauseButton();
  resetAutoHide();

  // Se a app foi aberta a partir do ícone instalado, tenta logo fullscreen + landscape.
  await autoEnterFullscreenIfInstalled();
  resizeCanvas();
  scaleMenu();
  drawTimer();
}

// ---------- Arrastar menu de controlo ----------
function bindDraggableControls() {
  if (!controls) return;

  let isDragging = false;
  let offsetX = 0;
  let offsetY = 0;

  function startDrag(e) {
    if (e.target.closest('.btn') || e.target.closest('.btn-cycle') || e.target.closest('.navbtn')) return;
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

function fullRelayout() {
  resizeCanvas();
  scaleMenu();
  drawTimer();
  resetControlsPosition();
  resetAutoHide();
}

window.addEventListener("resize", fullRelayout);

document.addEventListener("fullscreenchange", fullRelayout);
document.addEventListener("webkitfullscreenchange", fullRelayout);

// orientationchange dispara por vezes antes das dimensões da janela
// assentarem no valor final — voltamos a medir pouco depois, para
// evitar cortes temporários nas margens.
window.addEventListener("orientationchange", () => {
  fullRelayout();
  setTimeout(fullRelayout, 300);
  setTimeout(fullRelayout, 700);
});

screen.orientation && screen.orientation.addEventListener("change", () => {
  fullRelayout();
  setTimeout(fullRelayout, 300);
  setTimeout(fullRelayout, 700);
});

if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", fullRelayout);
}

start();
