// キャンバス・描画コンテキストの取得
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const startScreen = document.getElementById('startScreen');

// ゲーム設定用の変数
let columns = 4; // 列数（キー数に応じて変化）
let colWidth = 0; // 1列の幅
let keys = ['D', 'F', 'J', 'K']; // 反応するキー
let keyMap = { 'KeyD': 0, 'KeyF': 1, 'KeyJ': 2, 'KeyK': 3 }; // キー→列番号
let fallingSpeed = 3; // 落下速度（60fps換算で1フレームあたりのpx。内部では px/秒 = fallingSpeed * 60）
let spawnIntervalMs = 200; // 落下間隔（ms）。BPM指定時はBPMとノーツ間隔から計算
let clearScore = 100; // クリアスコア
let clearMode = 'combo'; // クリア条件（'combo' or 'score'）
let clearCombo = 50; // クリアコンボ数
let intervalMode = 'ms'; // 間隔の指定方法（'ms' or 'bpm'）
let bpm = 120; // BPM（BPM指定時）
let seEnabled = true; // 効果音・手拍子ON/OFF
let comboOpacity = 0.85; // 中央コンボ表示の濃さ（0〜1）
let autoPlay = false; // オートプレイ（プレビュー）

const FRAME_BASE = 60; // 速度・アニメーションの基準fps（旧仕様の「1フレームあたり」を秒あたりに換算する）

// 判定ゾーンの変数
let hitZoneTop, hitZoneBottom, hitZoneHeight;
let fastZoneTop, fastZoneBottom, goodZoneTop, goodZoneBottom, lateZoneTop, lateZoneBottom;

// ゲーム状態管理用の変数
const fallingObjs = []; // 落下オブジェクト配列
let score = 0; // 現在のスコア
let gameStarted = false; // ゲーム開始フラグ
let isCountingDown = false; // カウントダウン中フラグ
let isPaused = false; // 一時停止フラグ
let countdownTimers = []; // カウントダウン用タイマー
let rafId = null; // requestAnimationFrame のID
let lastFrameTime = null; // 前フレームの時刻（ms）
let spawnTimer = 0; // 前回生成からの経過時間（ms）
let missCount = 0; // ミス回数
let combo = 0; // 現在のコンボ数
let maxCombo = 0; // 最大コンボ数
let isResultShown = false; // リザルト画面表示中フラグ
let statsChartInstance = null; // Chart.js のインスタンス

// 統計情報
let stats = { fast: 0, perfect: 0, late: 0, miss: 0 };
let lastCol = -1; // 直前の列番号
let prevCol = -1; // 2つ前の列番号

// 判定結果を表示するための変数
let judgeTexts = []; // 判定テキストの配列

const CANVAS_MAX_W = 600; // canvasの最大幅（縦横比3:4なので最大高さ800）
const CANVAS_BORDER = 2; // 枠線の太さ（style.cssと合わせる）
const WRAP_MARGIN_TOP = 12; // #gameWrap の上マージン（style.cssと合わせる）
const BOTTOM_GAP = 12; // 画面下の余白

// ウィンドウに収まる最大サイズ（縦横比3:4）をcanvasの表示サイズとして設定
function fitCanvas() {
    const header = document.querySelector('body > p'); // 「Pキー・Escキーで停止／再開」の行
    const headerBottom = header ? header.getBoundingClientRect().bottom + window.scrollY : 0;
    const border2 = CANVAS_BORDER * 2;
    const availH = window.innerHeight - headerBottom - WRAP_MARGIN_TOP - BOTTOM_GAP - border2;
    const availW = Math.min(CANVAS_MAX_W, document.documentElement.clientWidth - 16 - border2);
    let w = Math.min(availW, availH * 3 / 4);
    w = Math.max(240, Math.floor(w)); // 極端に小さい画面でも最低限のサイズ
    const h = Math.floor(w * 4 / 3);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    return { w, h };
}

// 画面サイズに合わせてcanvasサイズ・各種値を更新
function resizeCanvasVars() {
    const oldW = canvas.width, oldH = canvas.height;
    const { w, h } = fitCanvas();
    // 描画解像度 = 表示サイズ（枠線を含まない）にしてにじみを防ぐ
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    colWidth = canvas.width / columns;

    // プレイ中にサイズが変わった場合、ノーツの横位置・幅は新しいレーン幅で計算し直し、縦位置と判定文字は比率で合わせる
    if (oldW > 0 && oldH > 0 && (oldW !== w || oldH !== h)) {
        const rx = w / oldW, ry = h / oldH;
        for (const o of fallingObjs) {
            ({ x: o.x, width: o.width } = noteRect(o.column));
            o.y *= ry; o.height *= ry;
        }
        for (const t of judgeTexts) { t.x *= rx; t.y *= ry; }
    }

    // 判定ゾーンの計算
    hitZoneBottom = canvas.height - 20;
    hitZoneTop = canvas.height - 180;
    hitZoneHeight = hitZoneBottom - hitZoneTop;

    // 判定範囲を3分割
    fastZoneTop = hitZoneTop;
    fastZoneBottom = hitZoneTop + hitZoneHeight * 0.3;
    goodZoneTop = fastZoneBottom;
    goodZoneBottom = hitZoneTop + hitZoneHeight * 0.7;
    lateZoneTop = goodZoneBottom;
    lateZoneBottom = hitZoneBottom;
}

window.addEventListener('resize', () => {
    resizeCanvasVars();
    updateConfigUI();
});

// 初期化（イベント登録はここに一本化）
window.addEventListener('DOMContentLoaded', () => {
    // index.html が古い（新しい設定項目がない）場合は警告して止める
    const required = ['speedPreview', 'bpmConfig', 'divisionConfig', 'clearComboConfig', 'seConfig', 'resultOverlay', 'comboOpacityConfig', 'autoPlayConfig', 'loadLastBtn'];
    const missing = required.filter(id => !document.getElementById(id));
    if (missing.length > 0) {
        const msg = '⚠ index.html が古いバージョンです。script.js と同じ時に渡した最新の index.html に置き換えてください。';
        const el = document.getElementById('loadError');
        if (el) { el.textContent = msg; el.style.display = 'block'; } else { alert(msg); }
        return;
    }

    resizeCanvasVars();
    document.getElementById('resumeBtn').onclick = resumeGame;
    document.getElementById('restartBtn').onclick = restartGame;
    document.getElementById('backToStartBtn').onclick = backToStartScreen;
    document.getElementById('startBtn').onclick = startGame;
    document.getElementById('loadLastBtn').onclick = applyLastConfig;
    updateLoadLastBtn();
    document.getElementById('resultRetryBtn').onclick = restartGame;
    document.getElementById('resultBackBtn').onclick = backToStartScreen;

    // 設定UIの切り替え・プレビュー
    document.querySelectorAll('input[name="intervalMode"], input[name="clearMode"]').forEach(r => r.addEventListener('change', updateConfigUI));
    ['keyConfig', 'speedConfig', 'intervalConfig', 'bpmConfig', 'divisionConfig', 'clearComboConfig', 'clearScoreConfig', 'comboOpacityConfig'].forEach(id => document.getElementById(id).addEventListener('input', updateConfigUI));
    updateConfigUI();
});

// ===== 効果音（Web Audioで合成。音声ファイル不要） =====
let audioCtx = null;
let noiseBuffer = null;

function getAudio() {
    if (!audioCtx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        audioCtx = new AC();
        // 手拍子用のホワイトノイズ
        noiseBuffer = audioCtx.createBuffer(1, audioCtx.sampleRate * 0.2, audioCtx.sampleRate);
        const data = noiseBuffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
}

// 手拍子（when: AudioContextの時刻）
function playClap(when) {
    const ac = getAudio();
    if (!ac || !seEnabled) return;
    const t = when ?? ac.currentTime;
    const src = ac.createBufferSource();
    src.buffer = noiseBuffer;
    const filter = ac.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1500;
    filter.Q.value = 0.8;
    const gain = ac.createGain();
    // 細かい3連の立ち上がり＋減衰で手拍子っぽく
    gain.gain.setValueAtTime(0, t);
    [0, 0.01, 0.02].forEach(d => {
        gain.gain.setValueAtTime(0.9, t + d);
        gain.gain.exponentialRampToValueAtTime(0.2, t + d + 0.008);
    });
    gain.gain.setValueAtTime(0.7, t + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    src.connect(filter).connect(gain).connect(ac.destination);
    src.start(t);
    src.stop(t + 0.2);
}

// 成功時の効果音（PERFECTは少し高い音）
function playHitSE(judge) {
    const ac = getAudio();
    if (!ac || !seEnabled) return;
    const t = ac.currentTime;
    const osc = ac.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = judge === 'PERFECT' ? 1320 : 880;
    const gain = ac.createGain();
    gain.gain.setValueAtTime(0.35, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    osc.connect(gain).connect(ac.destination);
    osc.start(t);
    osc.stop(t + 0.12);
}

// ===== 速度の目安計算 =====
// 画面上のcanvasの高さ（fitCanvas() で設定した表示サイズ。非表示中でも取得できる）
function measureCanvasHeight() {
    return parseFloat(canvas.style.height) || canvas.height;
}

// ノーツが画面上端から判定バー中央に届くまでの時間（ms）
function travelTimeMs(speed, h) {
    const noteH = Math.max(20, h * 0.025);
    const dist = (h - 100) + noteH / 2; // ノーツ中心(-noteH/2) → 判定バー中央(h-100)
    return dist / (speed * FRAME_BASE) * 1000;
}

// canvas内の文字サイズ・位置を画面幅に合わせて縮める（幅360px以上は等倍、それ未満は最小0.6倍まで縮小）
function px(n) {
    return Math.round(n * clamp(canvas.width / 360, 0.6, 1));
}

// 数値を範囲内に収める
function clamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
}

// 現在選択中の間隔指定方法
function getIntervalMode() {
    const checked = document.querySelector('input[name="intervalMode"]:checked');
    return checked ? checked.value : 'ms';
}

// BPMとノーツ間隔（n分音符）から生成間隔(ms)を計算
function bpmToIntervalMs(bpm, division) {
    // 1拍 = 4分音符 = 60000/BPM ms。n分音符はその 4/n 倍
    return (60000 / bpm) * (4 / division);
}

// 現在選択中のクリア条件
function getClearMode() {
    const checked = document.querySelector('input[name="clearMode"]:checked');
    return checked ? checked.value : 'combo';
}

// 設定UIの有効/無効とプレビュー表示を更新
function updateConfigUI() {
    // 間隔の指定方法
    const mode = getIntervalMode();
    document.getElementById('intervalConfig').disabled = mode !== 'ms';
    document.getElementById('bpmConfig').disabled = mode !== 'bpm';
    document.getElementById('divisionConfig').disabled = mode !== 'bpm';
    document.getElementById('msRow').style.opacity = mode === 'ms' ? 1 : 0.4;
    document.getElementById('bpmRow').style.opacity = mode === 'bpm' ? 1 : 0.4;

    const uiBpm = clamp(Number(document.getElementById('bpmConfig').value) || 120, 30, 400);
    const division = Number(document.getElementById('divisionConfig').value) || 8;
    document.getElementById('intervalPreview').textContent = ` → ${Math.round(bpmToIntervalMs(uiBpm, division))}ms間隔`;

    // コンボ表示の濃さ
    document.getElementById('comboOpacityValue').textContent =
        `${document.getElementById('comboOpacityConfig').value}%`;

    // クリア条件
    const cMode = getClearMode();
    document.getElementById('clearComboConfig').disabled = cMode !== 'combo';
    document.getElementById('clearScoreConfig').disabled = cMode !== 'score';
    document.getElementById('clearComboRow').style.opacity = cMode === 'combo' ? 1 : 0.4;
    document.getElementById('clearScoreRow').style.opacity = cMode === 'score' ? 1 : 0.4;

    // 入力チェック（エラーがあれば各欄の下に表示）
    validateConfig();

    // 落下速度の目安（今の画面サイズで、上端から判定バーまでの時間）
    const h = measureCanvasHeight();
    if (h <= 0) return;
    const speed = clamp(Number(document.getElementById('speedConfig').value) || 3, 1, 20);
    const beatMs = 60000 / uiBpm;
    const fmt = s => {
        const ms = travelTimeMs(s, h);
        let text = `約${(ms / 1000).toFixed(2)}秒`;
        if (mode === 'bpm') text += `（${(ms / beatMs).toFixed(1)}拍）`;
        return text;
    };
    document.getElementById('speedPreview').textContent = ` → 判定バーまで${fmt(speed)}`;

    const rows = [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20].map(s => {
        const cur = s === speed ? ' style="color:yellow; font-weight:bold;"' : '';
        return `<tr${cur}><td style="padding:1px 8px;">${s}</td><td style="padding:1px 8px; text-align:left;">${fmt(s)}</td></tr>`;
    }).join('');
    document.getElementById('speedTable').innerHTML =
        `<tr><th style="padding:1px 8px;">速度</th><th style="padding:1px 8px;">判定バーまで</th></tr>${rows}`;
}

// 判定テキストのクラス
class JudgeText {
    constructor(x, y, text, color) {
        this.x = x;
        this.y = y;
        this.text = text;
        this.color = color;
        this.alpha = 1.0;
        this.life = 1.0; // 1秒表示（旧: 60フレーム）
    }

    update(dt) {
        this.y -= 1 * FRAME_BASE * dt; // 上に移動
        this.life -= dt;
        this.alpha = Math.max(0, this.life);
    }

    draw() {
        ctx.save();
        ctx.globalAlpha = this.alpha;
        ctx.fillStyle = this.color;
        ctx.font = `${px(20)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(this.text, this.x, this.y);
        ctx.restore();
    }
}

// レーンごとの色（1,3,5…レーン＝赤／2,4,6…レーン＝白 を交互に）
const LANE_COLORS = [
    { note: '#ff3b3b', missed: '#7a1010', lane: 'rgba(255, 60, 60, 0.12)', hit: 'rgba(255, 90, 90, 0.35)' },   // 奇数レーン（赤）
    { note: '#ffffff', missed: '#666666', lane: 'rgba(255, 255, 255, 0.06)', hit: 'rgba(255, 255, 255, 0.3)' } // 偶数レーン（白）
];
function laneColor(column) {
    return LANE_COLORS[column % LANE_COLORS.length];
}

// レーン背景を描画
function drawLanes() {
    for (let i = 0; i < columns; i++) {
        ctx.fillStyle = laneColor(i).lane;
        ctx.fillRect(i * colWidth, 0, colWidth, canvas.height);
    }
    // レーンの区切り線
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 1;
    for (let i = 1; i < columns; i++) {
        const x = Math.round(i * colWidth) + 0.5;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
    }
}

// レーン内のノーツ横位置と幅（左右の余白はレーン幅の15%、最大20px。レーン数が多くても幅は必ず正になる）
function noteRect(column) {
    const pad = Math.min(20, colWidth * 0.15);
    return { x: column * colWidth + pad, width: colWidth - pad * 2 };
}

// 落下オブジェクトのクラス
class Falling {
    // column: どの列に落ちるか
    constructor(column) {
        this.column = column;
        ({ x: this.x, width: this.width } = noteRect(column));
        this.y = -Math.max(20, canvas.height * 0.025);
        this.speed = fallingSpeed * FRAME_BASE; // px/秒（60fpsで旧仕様と同じ速さ）
        this.hit = false;
        this.missed = false;
        this.height = Math.max(20, canvas.height * 0.025);
    }

    // 経過時間に応じてy座標を更新
    update(dt) {
        this.y += this.speed * dt;

        // ヒットゾーンを通り過ぎた場合、ミス判定
        if (!this.hit && !this.missed && this.y > hitZoneBottom) {
            this.missed = true;
            registerMiss();
            judgeTexts.push(new JudgeText(this.x + this.width / 2, hitZoneBottom, 'MISS', 'gray'));
        }
    }

    draw() {
        const lc = laneColor(this.column);
        let color = lc.note;
        if (this.hit) color = 'gray';
        if (this.missed) color = lc.missed;
        ctx.fillStyle = color;
        ctx.fillRect(this.x, this.y, this.width, this.height);
    }
}

// ミス時の共通処理
function registerMiss() {
    missCount++;
    stats.miss++;
    combo = 0;
}

// 落下オブジェクトを生成（直近2回の列と被らないように。列数が少ない場合は可能な範囲で避ける）
function spawn() {
    const all = [...Array(columns).keys()];
    let candidates = all.filter(c => c !== lastCol && c !== prevCol);
    if (candidates.length === 0) candidates = all.filter(c => c !== lastCol); // 2列：直前だけ避ける
    if (candidates.length === 0) candidates = all; // 1列：制約なし
    const col = candidates[Math.floor(Math.random() * candidates.length)];
    prevCol = lastCol;
    lastCol = col;
    fallingObjs.push(new Falling(col));
}

// ヒットゾーンを描画
function drawHitZone() {
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 2;

    for (let i = 0; i < columns; i++) {
        ctx.fillStyle = laneColor(i).hit;
        const { x, width } = noteRect(i);
        const height = Math.max(20, canvas.height * 0.025);
        const y = hitZoneTop + hitZoneHeight / 2 - height / 2;
        ctx.fillRect(x, y, width, height);
        ctx.strokeRect(x, y, width, height);
    }
}

// コンボ表示
function drawCombo() {
    if (combo < 2 || comboOpacity <= 0) return;
    ctx.save();
    ctx.fillStyle = `rgba(255, 255, 255, ${comboOpacity})`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${px(48)}px sans-serif`;
    ctx.fillText(combo, canvas.width / 2, canvas.height * 0.35);
    ctx.font = `${px(20)}px sans-serif`;
    ctx.fillText('COMBO', canvas.width / 2, canvas.height * 0.35 + px(38));
    ctx.restore();
}

// メインループの開始・停止
function startLoop() {
    stopLoop();
    lastFrameTime = null;
    rafId = requestAnimationFrame(updateGame);
}
function stopLoop() {
    if (rafId !== null) cancelAnimationFrame(rafId);
    rafId = null;
}

// ゲームループ（毎フレーム描画・判定）
function updateGame(now) {
    rafId = null;
    if (!gameStarted || isPaused) return;

    if (lastFrameTime === null) lastFrameTime = now;
    const dt = Math.min((now - lastFrameTime) / 1000, 0.1); // タブ切替等の大ジャンプを抑制
    lastFrameTime = now;

    // 経過時間でノーツ生成（BPMのリズムが崩れないよう余りを持ち越す）
    spawnTimer += dt * 1000;
    while (spawnTimer >= spawnIntervalMs) {
        spawnTimer -= spawnIntervalMs;
        spawn();
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawLanes();

    for (let i = fallingObjs.length - 1; i >= 0; i--) {
        const obj = fallingObjs[i];
        obj.update(dt);
        // オートプレイ：判定バーの中央に来たら自動で叩く
        if (autoPlay && !obj.hit && !obj.missed && obj.y + obj.height / 2 >= hitZoneTop + hitZoneHeight / 2) {
            obj.y = hitZoneTop + hitZoneHeight / 2 - obj.height / 2; // 描画が遅い環境で行き過ぎても、必ず中央（PERFECT）で叩く
            obj.hit = true;
            judgeHit(obj, obj.column);
        }
        obj.draw();
        if (obj.y > canvas.height + 100) fallingObjs.splice(i, 1);
    }

    drawHitZone();
    drawCombo();

    for (let i = judgeTexts.length - 1; i >= 0; i--) {
        const judgeText = judgeTexts[i];
        judgeText.update(dt);
        judgeText.draw();
        if (judgeText.life <= 0) judgeTexts.splice(i, 1);
    }

    // スコア・ミス数・コンボ表示
    ctx.fillStyle = 'white';
    ctx.font = `${px(25)}px sans-serif`;
    ctx.textAlign = 'start';
    ctx.fillText(`Score: ${score}`, px(15), px(40));
    ctx.fillText(`Miss: ${missCount}`, px(15), px(70));
    ctx.fillText(clearMode === 'combo' ? `Combo: ${combo} / ${clearCombo}` : `Combo: ${combo}`, px(15), px(100));
    if (autoPlay) {
        ctx.save();
        ctx.fillStyle = 'orange';
        ctx.textAlign = 'right';
        ctx.fillText('AUTO', canvas.width - px(15), px(40));
        ctx.restore();
    }

    const cleared = clearMode === 'combo' ? combo >= clearCombo : score >= clearScore;
    if (cleared) {
        gameClear();
        return;
    }
    rafId = requestAnimationFrame(updateGame);
}

// 判定処理を行う関数
function judgeHit(obj, col) {
    const objCenter = obj.y + obj.height / 2;
    let judge = null;
    let points = 0;
    let color = 'white';

    if (objCenter >= fastZoneTop && objCenter <= fastZoneBottom) {
        judge = 'FAST'; points = 0.5; color = 'cyan'; stats.fast++;
    } else if (objCenter >= goodZoneTop && objCenter <= goodZoneBottom) {
        judge = 'PERFECT'; points = 1; color = 'yellow'; stats.perfect++;
    } else if (objCenter >= lateZoneTop && objCenter <= lateZoneBottom) {
        judge = 'LATE'; points = 0.5; color = 'red'; stats.late++;
    } else {
        // ヒットゾーン外での入力はミス
        judge = 'MISS'; points = 0; color = 'gray';
        registerMiss();
    }

    if (judge !== 'MISS') {
        playHitSE(judge);
        combo++;
        if (combo > maxCombo) maxCombo = combo;
    }

    judgeTexts.push(new JudgeText(obj.x + obj.width / 2, objCenter, judge, color));
    score += points;
    return judge !== 'MISS';
}

// キー入力イベント
document.addEventListener('keydown', e => {
    // P・Esc：プレイ中なら一時停止、一時停止中なら再開（押しっぱなしでの連続切替は無視）
    if ((e.code === 'KeyP' || e.code === 'Escape') && gameStarted) {
        if (e.repeat) return;
        if (isPaused) resumeGame(); else pauseGame();
        return;
    }
    if (isPaused) return;
    if (!gameStarted && !isCountingDown && e.code === 'Space') {
        // 設定欄に入力中のスペースではスタートしない
        const tag = e.target && e.target.tagName;
        if (tag === 'INPUT' || tag === 'SELECT' || tag === 'BUTTON') return;
        e.preventDefault();
        startGame();
        return;
    }
    if (!gameStarted || e.repeat) return; // キー押しっぱなしの連続入力は無視
    if (autoPlay) return; // オートプレイ中はキー入力で判定しない
    if (!keyMap.hasOwnProperty(e.code)) return;

    const col = keyMap[e.code];
    for (const obj of fallingObjs) {
        if (!obj.hit && !obj.missed && obj.column === col) {
            obj.hit = true;
            judgeHit(obj, col);
            break;
        }
    }
});

// 状態リセット（共通）
function resetState() {
    stopLoop();
    countdownTimers.forEach(clearTimeout);
    countdownTimers = [];
    gameStarted = false;
    isCountingDown = false;
    isPaused = false;
    score = 0;
    missCount = 0;
    combo = 0;
    maxCombo = 0;
    stats = { fast: 0, perfect: 0, late: 0, miss: 0 };
    fallingObjs.length = 0;
    judgeTexts.length = 0;
    lastCol = -1;
    prevCol = -1;
    spawnTimer = 0;
    removeStatsChart();
    document.getElementById('pauseMenu').style.display = 'none';
}

// ===== 前回プレイした設定の保存・反映（クッキー） =====
const LAST_CONFIG_KEY = 'otimonoLastConfig';
const SAVED_VALUE_IDS = ['keyConfig', 'speedConfig', 'intervalConfig', 'bpmConfig', 'divisionConfig', 'clearComboConfig', 'clearScoreConfig', 'comboOpacityConfig'];
const SAVED_CHECK_IDS = ['seConfig', 'autoPlayConfig'];

// クッキーから値を取り出す（なければ null）
function readCookie(name) {
    const hit = document.cookie.split('; ').find(c => c.startsWith(name + '='));
    return hit ? decodeURIComponent(hit.slice(name.length + 1)) : null;
}

// 保存してある設定を読み込む（なければ・壊れていれば null）
function loadLastConfig() {
    let text = readCookie(LAST_CONFIG_KEY);
    // index.html を直接開いた場合（file://）はクッキーが使えないブラウザがあるため、予備の保存先も見る
    if (text === null) {
        try { text = localStorage.getItem(LAST_CONFIG_KEY); } catch (e) { text = null; }
    }
    if (text === null) return null;
    try {
        const data = JSON.parse(text);
        return data && typeof data === 'object' ? data : null;
    } catch (e) {
        return null;
    }
}

// 現在のフォームの内容を保存（1年間有効）
function saveLastConfig() {
    const data = { intervalMode: getIntervalMode(), clearMode: getClearMode() };
    SAVED_VALUE_IDS.forEach(id => { data[id] = document.getElementById(id).value; });
    SAVED_CHECK_IDS.forEach(id => { data[id] = document.getElementById(id).checked; });
    const text = JSON.stringify(data);
    document.cookie = `${LAST_CONFIG_KEY}=${encodeURIComponent(text)}; max-age=${60 * 60 * 24 * 365}; path=/; SameSite=Lax`;
    if (readCookie(LAST_CONFIG_KEY) === null) {
        try { localStorage.setItem(LAST_CONFIG_KEY, text); } catch (e) { /* 保存できない環境では何もしない */ }
    }
    updateLoadLastBtn();
}

// 保存してある設定をフォームに反映
function applyLastConfig() {
    const data = loadLastConfig();
    if (!data) return;
    SAVED_VALUE_IDS.forEach(id => { if (typeof data[id] === 'string') document.getElementById(id).value = data[id]; });
    SAVED_CHECK_IDS.forEach(id => { if (typeof data[id] === 'boolean') document.getElementById(id).checked = data[id]; });
    for (const name of ['intervalMode', 'clearMode']) {
        const radio = [...document.querySelectorAll(`input[name="${name}"]`)].find(r => r.value === data[name]);
        if (radio) radio.checked = true;
    }
    updateConfigUI(); // 有効/無効・目安表示・入力チェックを更新
}

// 保存がない時は「前回の設定」ボタンを押せなくする
function updateLoadLastBtn() {
    const btn = document.getElementById('loadLastBtn');
    const has = loadLastConfig() !== null;
    btn.disabled = !has;
    btn.title = has ? '' : 'まだプレイした記録がありません';
}

// ===== 入力チェック =====
// 数値欄のルール（無効化されている欄＝今のモードで使わない欄はチェックしない）
const NUMBER_RULES = [
    { id: 'speedConfig', min: 1, max: 20 },
    { id: 'intervalConfig', min: 50, max: 2000 },
    { id: 'bpmConfig', min: 30, max: 400 },
    { id: 'clearComboConfig', min: 1, max: 10000, integer: true },
    { id: 'clearScoreConfig', min: 1, max: 10000 }
];

// キー設定を解析。1文字ずつキーとして扱うので「dasf」でも「D,A,S,F」でもよい（カンマ・読点・空白は区切りとして無視、全角文字も可）
function parseKeys(str) {
    const tokens = [...str.normalize('NFKC').replace(/[,、\s]/g, '').toUpperCase()];
    const problems = [];
    const invalid = [...new Set(tokens.filter(k => !/^[A-Z]$/.test(k)))];
    const valid = tokens.filter(k => /^[A-Z]$/.test(k));
    const dup = [...new Set(valid.filter((k, i) => valid.indexOf(k) !== i))];
    if (tokens.length === 0) problems.push('キーを1つ以上入力してください（例: DFJK）');
    if (invalid.length > 0) problems.push(`使えないキーがあります: ${invalid.join(', ')}（アルファベットのみ使えます）`);
    if (valid.includes('P')) problems.push('P は一時停止用のため使えません');
    if (dup.length > 0) problems.push(`キーが重複しています: ${dup.join(', ')}`);
    return { keys: valid, error: problems.join(' / ') };
}

// 数値欄1つをチェックしてエラーメッセージを返す（問題なければ空文字）
function checkNumber(rule) {
    const el = document.getElementById(rule.id);
    if (el.disabled) return '';
    const raw = el.value.trim();
    const n = Number(raw);
    if (raw === '' || !Number.isFinite(n)) return '数値を入力してください'; // 数値以外の入力は value が空になる
    if (n < rule.min || n > rule.max) return `${rule.min}〜${rule.max} の範囲で入力してください`;
    if (rule.integer && !Number.isInteger(n)) return '整数で入力してください';
    return '';
}

// 入力欄の下にエラーメッセージを表示／消去（表示用の要素は初回に自動で作る）
function setFieldError(id, message) {
    const input = document.getElementById(id);
    let box = document.getElementById(id + 'Error');
    if (!box) {
        box = document.createElement('div');
        box.id = id + 'Error';
        box.className = 'field-error';
        input.closest('div').appendChild(box);
        input.setAttribute('aria-describedby', box.id);
    }
    box.textContent = message;
    box.style.display = message ? 'block' : 'none';
    input.classList.toggle('invalid', message !== '');
    input.setAttribute('aria-invalid', message !== '' ? 'true' : 'false');
}

// 設定フォーム全体をチェックしてエラー表示を更新。問題なければ { keys } を、あれば null を返す
function validateConfig() {
    let ok = true;
    const parsed = parseKeys(document.getElementById('keyConfig').value);
    setFieldError('keyConfig', parsed.error);
    if (parsed.error) ok = false;
    for (const rule of NUMBER_RULES) {
        const error = checkNumber(rule);
        setFieldError(rule.id, error);
        if (error) ok = false;
    }
    return ok ? { keys: parsed.keys } : null;
}

// 設定フォームから値を読み込む（config: validateConfig() のチェック済みの結果）
function readConfig(config) {
    keys = config.keys;
    columns = keys.length;
    keyMap = {};
    keys.forEach((k, i) => { keyMap['Key' + k] = i; });

    fallingSpeed = clamp(Number(document.getElementById('speedConfig').value) || 3, 1, 20);
    intervalMode = getIntervalMode();
    if (intervalMode === 'bpm') {
        bpm = clamp(Number(document.getElementById('bpmConfig').value) || 120, 30, 400);
        const division = Number(document.getElementById('divisionConfig').value) || 8;
        spawnIntervalMs = bpmToIntervalMs(bpm, division);
    } else {
        spawnIntervalMs = clamp(Number(document.getElementById('intervalConfig').value) || 200, 50, 2000);
    }
    clearMode = getClearMode();
    clearScore = clamp(Number(document.getElementById('clearScoreConfig').value) || 100, 1, 10000);
    clearCombo = clamp(Math.floor(Number(document.getElementById('clearComboConfig').value)) || 50, 1, 10000);
    seEnabled = document.getElementById('seConfig').checked;
    comboOpacity = clamp(Number(document.getElementById('comboOpacityConfig').value), 0, 100) / 100;
    autoPlay = document.getElementById('autoPlayConfig').checked;
}

// BPM指定時：最初のノーツがカウントイン後の拍の頭（ノーツ間隔のグリッド）で判定バーに届くよう、生成タイマーの初期値を決める
function initialSpawnTimer() {
    if (intervalMode !== 'bpm') return 0; // ms指定は従来通り
    const travel = travelTimeMs(fallingSpeed, canvas.height);
    const firstSpawnAt = ((-travel % spawnIntervalMs) + spawnIntervalMs) % spawnIntervalMs; // 開始から最初の生成までの時間
    return spawnIntervalMs - firstSpawnAt; // spawnTimer がこの値から始まると firstSpawnAt 後に生成される
}

// ゲーム開始（設定値取得・初期化・カウントダウン）
function startGame() {
    if (gameStarted || isCountingDown) return; // 二重スタート防止
    // 設定に不正な値があれば開始せず、最初のエラー欄にカーソルを移す
    const config = validateConfig();
    if (!config) {
        if (startScreen.style.display === 'none') backToStartScreen();
        const bad = document.querySelector('#configForm .invalid');
        if (bad) bad.focus();
        return;
    }
    resetState();
    readConfig(config);
    saveLastConfig(); // 今回プレイする設定を「前回の設定」として保存
    startScreen.style.display = 'none';
    canvas.style.display = 'block';
    resizeCanvasVars(); // canvas表示後・列数確定後にサイズ再計算
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    isCountingDown = true;
    getAudio(); // ユーザー操作中に音声を有効化（ブラウザの自動再生制限対策）
    if (intervalMode === 'bpm') {
        bpmCountIn();
    } else {
        countdown(3);
    }
}

// カウントダウン用の大きい文字を描画
function drawCountText(text) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'white';
    ctx.font = `${px(80)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
}

// プレイ開始（カウントダウン終了時）
function beginPlay() {
    countdownTimers = [];
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    isCountingDown = false;
    gameStarted = true;
    spawnTimer = initialSpawnTimer();
    startLoop();
}

// カウントダウン表示（3,2,1,スタート）※ms指定時
function countdown(n) {
    if (n > 0) {
        drawCountText(n);
        countdownTimers.push(setTimeout(() => countdown(n - 1), 800));
    } else {
        drawCountText('スタート!');
        countdownTimers.push(setTimeout(beginPlay, 800));
    }
}

// BPMの4分間隔で手拍子4回（4,3,2,1）→次の拍でスタート ※BPM指定時
function bpmCountIn() {
    const beatMs = 60000 / bpm;
    const leadMs = 100; // 音のスケジュール用の少しの余裕
    const ac = getAudio();
    const audioStart = ac ? ac.currentTime + leadMs / 1000 : 0;
    drawCountText('');
    for (let i = 0; i < 4; i++) {
        if (ac) playClap(audioStart + i * beatMs / 1000); // 音は正確な時刻で予約
        countdownTimers.push(setTimeout(() => drawCountText(4 - i), leadMs + i * beatMs));
    }
    countdownTimers.push(setTimeout(beginPlay, leadMs + 4 * beatMs));
}

// 一時停止処理
function pauseGame() {
    isPaused = true;
    stopLoop();
    document.getElementById('pauseMenu').style.display = 'flex';
}

// 一時停止解除
function resumeGame() {
    if (!isPaused) return;
    isPaused = false;
    document.getElementById('pauseMenu').style.display = 'none';
    startLoop(); // 生成タイマーの経過時間は保持される
}

// 最初からやり直し
function restartGame() {
    resetState();
    startGame();
}

// スタート画面に戻る
function backToStartScreen() {
    resetState();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    startScreen.style.display = 'flex'; // CSSと同じflexに戻す
    canvas.style.display = 'none';
}

// クリア時の処理（リザルト画面をcanvasの上に表示）
function gameClear() {
    stopLoop();
    gameStarted = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    document.getElementById('resultScore').textContent = score;
    document.getElementById('resultMiss').textContent = missCount;
    document.getElementById('resultMaxCombo').textContent = maxCombo;
    document.querySelector('#resultOverlay .result-title').textContent = autoPlay ? 'クリア！（オート）' : 'クリア！';
    document.getElementById('resultOverlay').style.display = 'flex';
    isResultShown = true;

    createStatsChart();
}

// リザルト画面を閉じ、統計チャートを破棄
function removeStatsChart() {
    if (statsChartInstance) {
        statsChartInstance.destroy();
        statsChartInstance = null;
    }
    const overlay = document.getElementById('resultOverlay');
    if (overlay) overlay.style.display = 'none';
    isResultShown = false;
}

// 統計チャート作成関数（リザルト画面内の枠に収まるよう responsive で描画）
function createStatsChart() {
    if (statsChartInstance) {
        statsChartInstance.destroy();
        statsChartInstance = null;
    }
    if (typeof Chart === 'undefined') return; // オフライン等でChart.jsが読めない場合はグラフなし

    const chartCtx = document.getElementById('statsChart').getContext('2d');
    statsChartInstance = new Chart(chartCtx, {
        type: 'bar',
        data: {
            labels: ['FAST', 'PERFECT', 'LATE', 'MISS'],
            datasets: [{
                label: '判定回数',
                data: [stats.fast, stats.perfect, stats.late, stats.miss],
                backgroundColor: [
                    'rgba(0, 255, 255, 0.8)',
                    'rgba(255, 255, 0, 0.8)',
                    'rgba(255, 0, 0, 0.8)',
                    'rgba(128, 128, 128, 0.8)'
                ],
                borderColor: [
                    'rgba(0, 255, 255, 1)',
                    'rgba(255, 255, 0, 1)',
                    'rgba(255, 0, 0, 1)',
                    'rgba(128, 128, 128, 1)'
                ],
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                title: { display: true, text: '判定統計', color: '#fff', font: { size: 16 } },
                legend: { display: false }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: { color: '#fff', stepSize: 1 },
                    grid: { color: 'rgba(255, 255, 255, 0.2)' }
                },
                x: {
                    ticks: { color: '#fff' },
                    grid: { color: 'rgba(255, 255, 255, 0.2)' }
                }
            }
        }
    });
}
