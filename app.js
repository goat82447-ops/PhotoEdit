"use strict";

/* ============================================================
   Prompt Photo Editor — local, in-browser image editing.
   No servers, no API keys. Uses the Canvas 2D API + CSS filters.
   ============================================================ */

// --- State ---------------------------------------------------
const DEFAULTS = {
  brightness: 100,
  contrast: 100,
  saturate: 100,
  grayscale: 0,
  sepia: 0,
  hue: 0,
  blur: 0,
  invert: 0,
};

let filters = { ...DEFAULTS };
let rotation = 0;      // degrees, multiples of 90
let flipH = false;
let flipV = false;
let sourceImage = null; // HTMLImageElement of the loaded photo

// Multi-mode state
let mode = "photo";        // 'photo' | 'video' | 'create'
let sourceVideo = null;    // <video> element used as source in video mode
let videoRAF = null;       // preview loop handle (video)
let trimStart = 0, trimEnd = 0;
let isExporting = false;
let lastVideoBlob = null;  // last exported clip (for re-share)
let createImages = [];     // Image[] for the generator
let createRAF = null;      // preview loop handle (create)
let lastGenBlob = null;    // last generated video (for re-share)
let songBuffer = null;     // decoded AudioBuffer for the music video

// --- Element refs -------------------------------------------
const $ = (id) => document.getElementById(id);

const canvas = $("canvas");
const ctx = canvas.getContext("2d");
const dropzone = $("dropzone");
const dropzoneInner = $("dropzoneInner");
const fileInput = $("fileInput");

const sliders = {
  brightness: $("brightness"),
  contrast: $("contrast"),
  saturate: $("saturate"),
  grayscale: $("grayscale"),
  sepia: $("sepia"),
  hue: $("hue"),
  blur: $("blur"),
  invert: $("invert"),
};

const valueLabels = {
  brightness: $("brightnessVal"),
  contrast: $("contrastVal"),
  saturate: $("saturateVal"),
  grayscale: $("grayscaleVal"),
  sepia: $("sepiaVal"),
  hue: $("hueVal"),
  blur: $("blurVal"),
  invert: $("invertVal"),
};

const promptInput = $("promptInput");
const promptFeedback = $("promptFeedback");

const downloadBtn = $("downloadBtn");
const resetBtn = $("resetBtn");
const newImageBtn = $("newImageBtn");
const savePhotoBtn = $("savePhotoBtn");
const tabsNav = $("tabs");

// Recolor tool refs
const recolorFrom = $("recolorFrom");
const recolorTo = $("recolorTo");
const recolorTol = $("recolorTol");
const recolorTolVal = $("recolorTolVal");
const recolorBtn = $("recolorBtn");
const pickColorBtn = $("pickColorBtn");
const recolorFeedback = $("recolorFeedback");
// Style-match (reference look) refs
const styleRefBtn = $("styleRefBtn");
const styleRefInput = $("styleRefInput");
const styleRefThumb = $("styleRefThumb");
const styleStrength = $("styleStrength");
const styleStrengthVal = $("styleStrengthVal");
const styleMatchBtn = $("styleMatchBtn");
const styleFeedback = $("styleFeedback");
// Video mode refs
const video = $("video");
const videoDrop = $("videoDrop");
const videoDropInner = $("videoDropInner");
const videoInput = $("videoInput");
const videoBrowseBtn = $("videoBrowseBtn");
const videoCanvas = $("videoCanvas");
const vctx = videoCanvas.getContext("2d");
const videoControls = $("videoControls");
const playPauseBtn = $("playPauseBtn");
const videoTime = $("videoTime");
const trimStartEl = $("trimStart");
const trimEndEl = $("trimEnd");
const trimStartVal = $("trimStartVal");
const trimEndVal = $("trimEndVal");
const exportVideoBtn = $("exportVideoBtn");
const saveVideoBtn = $("saveVideoBtn");
const resetVideoBtn = $("resetVideoBtn");
const newVideoBtn = $("newVideoBtn");
const videoProgress = $("videoProgress");
const videoProgressBar = $("videoProgressBar");
const videoStatus = $("videoStatus");

// Create (video generator) mode refs
const createDrop = $("createDrop");
const createDropInner = $("createDropInner");
const createInput = $("createInput");
const createBrowseBtn = $("createBrowseBtn");
const createCanvas = $("createCanvas");
const cctx = createCanvas.getContext("2d");
const thumbs = $("thumbs");
const generateBtn = $("generateBtn");
const saveGenBtn = $("saveGenBtn");
const clearGenBtn = $("clearGenBtn");
const genProgress = $("genProgress");
const genProgressBar = $("genProgressBar");
const genStatus = $("genStatus");
const effectSelect = $("effectSelect");
const perDuration = $("perDuration");
const perDurationVal = $("perDurationVal");
const resSelect = $("resSelect");
const fadeEl = $("fade");
const fadeVal = $("fadeVal");
// Music-video refs
const musicBtn = $("musicBtn");
const musicInput = $("musicInput");
const musicName = $("musicName");
const beatReact = $("beatReact");
const beatVal = $("beatVal");
const showBars = $("showBars");
const barsVal = $("barsVal");
const danceMode = $("danceMode");
const danceVal = $("danceVal");

// Text -> image/video generator (offline) refs
const artPrompt = $("artPrompt");
const makeImgBtn = $("makeImgBtn");
const makeVidBtn = $("makeVidBtn");

// --- Filter string builder ----------------------------------
function buildFilterString() {
  return [
    `brightness(${filters.brightness}%)`,
    `contrast(${filters.contrast}%)`,
    `saturate(${filters.saturate}%)`,
    `grayscale(${filters.grayscale}%)`,
    `sepia(${filters.sepia}%)`,
    `hue-rotate(${filters.hue}deg)`,
    `blur(${filters.blur}px)`,
    `invert(${filters.invert}%)`,
  ].join(" ");
}

// --- Rendering ----------------------------------------------
// Draw any source (image OR live video frame) into `cv` applying the
// current filters + rotation + flips. `w`,`h` = source pixel size.
function drawWithTransform(context, cv, source, w, h) {
  const rotated = rotation % 180 !== 0;
  cv.width = rotated ? h : w;
  cv.height = rotated ? w : h;
  context.save();
  context.clearRect(0, 0, cv.width, cv.height);
  context.filter = buildFilterString();
  context.translate(cv.width / 2, cv.height / 2);
  context.rotate((rotation * Math.PI) / 180);
  context.scale(flipH ? -1 : 1, flipV ? -1 : 1);
  context.drawImage(source, -w / 2, -h / 2, w, h);
  context.restore();
}

function render() {
  if (!sourceImage) return;
  drawWithTransform(ctx, canvas, sourceImage, sourceImage.naturalWidth, sourceImage.naturalHeight);
}

// --- UI sync ------------------------------------------------
const LABEL_SUFFIX = {
  brightness: "%", contrast: "%", saturate: "%", grayscale: "%",
  sepia: "%", hue: "°", blur: "px", invert: "%",
};

function syncControls() {
  for (const key of Object.keys(sliders)) {
    sliders[key].value = filters[key];
    valueLabels[key].textContent = `${filters[key]}${LABEL_SUFFIX[key]}`;
  }
}

function enableTools(enabled) {
  downloadBtn.disabled = !enabled;
  resetBtn.disabled = !enabled;
  newImageBtn.disabled = !enabled;
  if (savePhotoBtn) savePhotoBtn.disabled = !enabled;
  if (recolorBtn) recolorBtn.disabled = !enabled;
  if (styleMatchBtn) styleMatchBtn.disabled = !(enabled && styleRefImage);
}

// --- Image loading ------------------------------------------
function loadFile(file) {
  if (!file || !file.type.startsWith("image/")) {
    promptFeedback.textContent = "Please choose a valid image file.";
    return;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      sourceImage = img;
      resetAll(false);
      canvas.classList.remove("hidden");
      dropzoneInner.classList.add("hidden");
      enableTools(true);
      render();
    };
    img.onerror = () => { promptFeedback.textContent = "Could not load that image."; };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

// --- Reset --------------------------------------------------
function resetAll(rerender = true) {
  filters = { ...DEFAULTS };
  rotation = 0;
  flipH = false;
  flipV = false;
  syncControls();
  promptFeedback.textContent = "";
  if (rerender) render();
}

// --- Download -----------------------------------------------
function download() {
  if (!sourceImage) return;
  const link = document.createElement("a");
  link.download = "edited-photo.png";
  link.href = canvas.toDataURL("image/png");
  link.click();
}

/* ============================================================
   PROMPT INTERPRETER  (typo-tolerant, handles almost any prompt)
   Maps free-form English text to filter presets / adjustments,
   numeric commands, transforms — and always does *something*.
   ============================================================ */
function clamp(v, min, max) { return Math.min(max, Math.max(min, Math.round(v))); }

// Each preset is applied on top of a fresh default base, so looks
// are consistent no matter what was applied before.
const PRESETS = {
  vintage:   { sepia: 55, contrast: 95,  saturate: 85,  brightness: 105, hue: 8 },
  sunset:    { sepia: 30, saturate: 140, brightness: 108, hue: 350, contrast: 105 },
  bw:        { grayscale: 100, contrast: 110 },
  noir:      { grayscale: 100, contrast: 145, brightness: 88 },
  cool:      { hue: 200, saturate: 110, brightness: 100 },
  warm:      { sepia: 25, saturate: 120, brightness: 106, hue: 10 },
  dramatic:  { contrast: 155, saturate: 120, brightness: 94 },
  vivid:     { saturate: 175, contrast: 115, brightness: 108 },
  faded:     { contrast: 82, saturate: 72, brightness: 112 },
  dreamy:    { blur: 3, brightness: 112, saturate: 115, contrast: 92 },
  invert:    { invert: 100 },
  matte:     { contrast: 88, saturate: 90, brightness: 104, sepia: 12 },
  sepia:     { sepia: 90, contrast: 100, brightness: 104 },
  cinematic: { contrast: 120, saturate: 90, brightness: 98, hue: 200, sepia: 8 },
  teal:      { hue: 170, saturate: 130, contrast: 110 },
  cyberpunk: { hue: 280, saturate: 200, contrast: 130, brightness: 105 },
  neon:      { saturate: 250, contrast: 125, brightness: 110, hue: 300 },
  pastel:    { saturate: 70, brightness: 115, contrast: 92, sepia: 8 },
  summer:    { saturate: 150, brightness: 110, contrast: 108, hue: 5 },
  winter:    { hue: 210, saturate: 90, brightness: 104, contrast: 105 },
  autumn:    { sepia: 40, saturate: 130, hue: 12, brightness: 102 },
  spring:    { saturate: 140, brightness: 110, hue: 90, contrast: 102 },
  moody:     { contrast: 125, saturate: 80, brightness: 90, sepia: 10 },
  hdr:       { contrast: 140, saturate: 145, brightness: 105 },
  polaroid:  { sepia: 35, contrast: 90, saturate: 95, brightness: 110 },
  lomo:      { saturate: 160, contrast: 130, brightness: 100, hue: 15 },
  grunge:    { contrast: 135, saturate: 70, brightness: 92, sepia: 20 },
  night:     { brightness: 78, contrast: 115, hue: 210, saturate: 90 },
  golden:    { sepia: 30, saturate: 135, brightness: 110, hue: 8, contrast: 105 },
  rose:      { hue: 330, saturate: 130, brightness: 108, contrast: 102 },
  emerald:   { hue: 120, saturate: 140, contrast: 110 },
  purple:    { hue: 270, saturate: 150, contrast: 110 },
  sketch:    { grayscale: 100, contrast: 190, brightness: 105 },
  thermal:   { hue: 90, saturate: 260, contrast: 130 },
  xray:      { invert: 100, grayscale: 100, contrast: 120 },
  enhance:   { contrast: 112, saturate: 118, brightness: 106 },
};

// A "look" rule = keyword synonyms -> a full preset.
const LOOK_RULES = [
  { kw: ["vintage", "retro", "oldphoto", "oldschool", "antique", "aged"], preset: "vintage", msg: "Vintage look." },
  { kw: ["sunset", "goldenhour", "warmsunset", "dusk"], preset: "sunset", msg: "Warm sunset tone." },
  { kw: ["blackandwhite", "black&white", "bw", "b&w", "monochrome", "greyscale", "grayscale", "gray", "grey", "mono"], preset: "bw", msg: "Black & white." },
  { kw: ["noir", "filmnoir"], preset: "noir", msg: "Moody noir." },
  { kw: ["cool", "cold", "icy", "bluetone", "cooltone"], preset: "cool", msg: "Cool tone." },
  { kw: ["warm", "warmtone", "cozy", "cosy"], preset: "warm", msg: "Warm tone." },
  { kw: ["dramatic", "highcontrast", "punchy", "bold", "intense"], preset: "dramatic", msg: "Dramatic contrast." },
  { kw: ["vivid", "vibrant", "pop", "colorful", "colourful"], preset: "vivid", msg: "Vivid & bright." },
  { kw: ["faded", "washedout", "pale", "vintagefade"], preset: "faded", msg: "Faded look." },
  { kw: ["dreamy", "dream", "hazy", "ethereal"], preset: "dreamy", msg: "Soft dreamy blur." },
  { kw: ["invert", "negative", "inverted"], preset: "invert", msg: "Inverted colors." },
  { kw: ["matte"], preset: "matte", msg: "Matte finish." },
  { kw: ["sepia", "brown", "coffee"], preset: "sepia", msg: "Sepia tone." },
  { kw: ["cinematic", "movie", "film", "teal&orange", "hollywood"], preset: "cinematic", msg: "Cinematic grade." },
  { kw: ["teal"], preset: "teal", msg: "Teal grade." },
  { kw: ["cyberpunk", "cyber"], preset: "cyberpunk", msg: "Cyberpunk vibe." },
  { kw: ["neon", "glow"], preset: "neon", msg: "Neon glow." },
  { kw: ["pastel", "soft"], preset: "pastel", msg: "Pastel look." },
  { kw: ["summer", "sunny", "tropical"], preset: "summer", msg: "Summer vibe." },
  { kw: ["winter", "frost", "snow"], preset: "winter", msg: "Wintry tone." },
  { kw: ["autumn", "fall"], preset: "autumn", msg: "Autumn tone." },
  { kw: ["spring", "fresh"], preset: "spring", msg: "Spring tone." },
  { kw: ["moody", "mood", "gloomy"], preset: "moody", msg: "Moody grade." },
  { kw: ["hdr", "clarity", "crisp"], preset: "hdr", msg: "HDR clarity." },
  { kw: ["polaroid", "instant"], preset: "polaroid", msg: "Polaroid look." },
  { kw: ["lomo", "lomography"], preset: "lomo", msg: "Lomo look." },
  { kw: ["grunge", "gritty"], preset: "grunge", msg: "Grunge look." },
  { kw: ["night", "midnight", "dark"], preset: "night", msg: "Night look." },
  { kw: ["golden", "goldenglow"], preset: "golden", msg: "Golden glow." },
  { kw: ["rose", "pink", "romantic"], preset: "rose", msg: "Rosy tone." },
  { kw: ["emerald", "green", "forest"], preset: "emerald", msg: "Emerald tone." },
  { kw: ["purple", "violet", "lavender"], preset: "purple", msg: "Purple tone." },
  { kw: ["sketch", "drawing", "pencil"], preset: "sketch", msg: "Sketch effect." },
  { kw: ["thermal", "heatmap", "infrared"], preset: "thermal", msg: "Thermal effect." },
  { kw: ["xray", "x-ray"], preset: "xray", msg: "X-ray effect." },
  { kw: ["enhance", "improve", "fix", "better", "auto", "beautify"], preset: "enhance", msg: "Auto-enhanced." },
];

// Directional nudges (combine with looks and each other).
const NUDGES = [
  { kw: ["brighter", "brighten", "lighter", "brightness+", "morelight", "lighten"], fn: () => bump("brightness", +20), msg: "Brightened." },
  { kw: ["darker", "darken", "dim", "dull"], fn: () => bump("brightness", -20), msg: "Darkened." },
  { kw: ["morecontrast", "sharper", "sharpen", "contrast+", "crisper"], fn: () => bump("contrast", +20), msg: "More contrast." },
  { kw: ["lesscontrast", "softercontrast", "flat", "contrast-"], fn: () => bump("contrast", -20), msg: "Less contrast." },
  { kw: ["moresaturation", "morecolor", "morecolour", "saturate", "morevivid", "saturation+"], fn: () => bump("saturate", +30), msg: "More saturation." },
  { kw: ["lesssaturation", "desaturate", "muted", "duller", "saturation-"], fn: () => bump("saturate", -30), msg: "Less saturation." },
  { kw: ["blur", "soften", "blurry", "smooth"], fn: () => bump("blur", +3), msg: "Added blur." },
  { kw: ["unblur", "deblur", "focus", "sharp"], fn: () => bump("blur", -3), msg: "Reduced blur." },
];

// Adjustable channels + synonyms for numeric / absolute commands.
const ADJUSTABLES = [
  { key: "brightness", names: ["brightness", "bright", "exposure", "light"], min: 0, max: 200 },
  { key: "contrast",   names: ["contrast"],                                   min: 0, max: 200 },
  { key: "saturate",   names: ["saturation", "saturate", "colour", "color", "vibrance"], min: 0, max: 300 },
  { key: "grayscale",  names: ["grayscale", "greyscale"],                     min: 0, max: 100 },
  { key: "sepia",      names: ["sepia"],                                      min: 0, max: 100 },
  { key: "hue",        names: ["hue", "tint"],                                min: 0, max: 360 },
  { key: "blur",       names: ["blur"],                                       min: 0, max: 20 },
  { key: "invert",     names: ["invert"],                                     min: 0, max: 100 },
];

function bump(key, delta) {
  const a = ADJUSTABLES.find((x) => x.key === key);
  filters[key] = clamp(filters[key] + delta, a.min, a.max);
}

// --- Fuzzy matching (typo tolerance) ------------------------
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

// Allowed edit distance grows with word length. Short keywords must match
// (near-)exactly so common words like "by" don't collide with "bw".
function editThreshold(len) { return len <= 3 ? 0 : len <= 6 ? 1 : 2; }

// Filler words are ignored during fuzzy matching to cut false positives.
const FILLERS = new Set(["make", "made", "makes", "it", "the", "a", "an", "to",
  "my", "this", "that", "please", "pls", "you", "of", "on", "in", "is", "with",
  "photo", "image", "picture", "pic", "kindly", "could", "would", "do", "now"]);

function nearWord(word, phrase) {
  const thr = editThreshold(phrase.length);
  return Math.abs(word.length - phrase.length) <= thr && levenshtein(word, phrase) <= thr;
}

// Does the prompt contain `phrase` (typo-tolerant for single words)?
function matchesKeyword(compact, words, phrase) {
  if (compact.includes(phrase)) return true;      // handles multi-word joined
  if (/[^a-z0-9]/.test(phrase)) return false;     // symbol phrases: exact only
  return words.some((w) => nearWord(w, phrase));
}
function matchAny(compact, words, kwList) {
  return kwList.some((k) => matchesKeyword(compact, words, k));
}

function interpretPrompt(text) {
  const raw = text.toLowerCase().trim();
  if (!raw) return "Type a prompt first, e.g. \u201cwarm vintage look\u201d.";

  const words = raw.split(/[^a-z0-9]+/).filter((w) => w && !FILLERS.has(w));
  const compact = raw.replace(/\s+/g, "");        // "black and white" -> "blackandwhite"
  const messages = [];

  // 0) Reset / original
  if (matchAny(compact, words, ["reset", "clear", "original", "removeedits", "undoall", "revert"])) {
    resetAll(true);
    return "\u21ba Reset to the original photo.";
  }

  // 0b) Recolor via prompt, e.g. "change red dress to blue", "make the red blue",
  //     "recolour red to green". Keeps face/body/expression — only the colour changes.
  {
    const rc = detectRecolor(raw);
    const sep = /->|=>|\u2192|\b(?:to|into|instead of)\b/.test(raw);
    const intent = matchAny(compact, words, ["recolor", "recolour", "change", "turn", "replace", "swap", "dress", "shirt", "colour", "color", "recolor"]);
    if (rc && (sep || intent)) {
      if (!sourceImage) return "Load a photo first, then say e.g. \u201cchange red dress to blue\u201d.";
      recolorFrom.value = rc.from.hex;
      recolorTo.value = rc.to.hex;
      applyRecolor();
      return `\ud83c\udfa8 Changed ${rc.from.name} \u2192 ${rc.to.name}. Face, body & expression unchanged. If skin changed too, lower \u201cMatch range\u201d or use \u201cPick from photo\u201d.`;
    }
  }

  // 1) Transforms
  if (/\brotate\s*180\b/.test(raw) || matchAny(compact, words, ["upsidedown"])) { rotation = (rotation + 180) % 360; messages.push("Rotated 180\u00b0."); }
  else if (matchAny(compact, words, ["rotateleft", "rotateccw", "counterclockwise", "anticlockwise"])) { rotation = (rotation - 90 + 360) % 360; messages.push("Rotated left."); }
  else if (matchAny(compact, words, ["rotate", "rotateright", "clockwise", "turn"])) { rotation = (rotation + 90) % 360; messages.push("Rotated right."); }
  if (matchAny(compact, words, ["fliphorizontal", "mirror", "fliph"])) { flipH = !flipH; messages.push("Flipped horizontally."); }
  if (matchAny(compact, words, ["flipvertical", "flipv", "upsidedownflip"])) { flipV = !flipV; messages.push("Flipped vertically."); }

  // 2) Numeric / absolute commands, e.g. "brightness 150", "set contrast to 80",
  //    "increase saturation by 40", "hue +30", "blur 5".
  for (const a of ADJUSTABLES) {
    for (const name of a.names) {
      // increase/decrease by N
      let m = new RegExp(`(increase|raise|add|more|boost|decrease|reduce|lower|less)\\s+(?:the\\s+)?${name}(?:\\s+by)?\\s*(\\d+)`).exec(raw)
           || new RegExp(`${name}\\s*([+-])\\s*(\\d+)`).exec(raw);
      if (m) {
        const isMinus = /^(decrease|reduce|lower|less|-)$/.test(m[1]);
        const n = Number(m[2]);
        filters[a.key] = clamp(filters[a.key] + (isMinus ? -n : n), a.min, a.max);
        messages.push(`${cap(a.key)} ${isMinus ? "-" : "+"}${n}.`);
        break;
      }
      // absolute "name to N" / "set name N" / "name N" / "name = N"
      m = new RegExp(`${name}\\s*(?:to|=|:|at)?\\s*(\\d+)`).exec(raw)
       || new RegExp(`set\\s+${name}\\s+(\\d+)`).exec(raw);
      if (m) {
        filters[a.key] = clamp(Number(m[1]), a.min, a.max);
        messages.push(`${cap(a.key)} = ${filters[a.key]}.`);
        break;
      }
    }
  }

  // 3) Looks / presets — first match becomes the base grade (from defaults).
  //    Special-case "black and white" (needs both words, typo-tolerant).
  const hasBlack = words.some((w) => nearWord(w, "black"));
  const hasWhite = words.some((w) => nearWord(w, "white"));
  let lookApplied = false;
  if (compact.includes("blackandwhite") || compact.includes("blackwhite") || (hasBlack && hasWhite)) {
    filters = { ...DEFAULTS, ...PRESETS.bw };
    messages.unshift("Black & white.");
    lookApplied = true;
  }
  if (!lookApplied) {
    for (const rule of LOOK_RULES) {
      if (matchAny(compact, words, rule.kw)) {
        filters = { ...DEFAULTS, ...PRESETS[rule.preset] };
        messages.unshift(rule.msg);
        break;
      }
    }
  }

  // 4) Directional nudges (all matching apply, layered on top).
  for (const nudge of NUDGES) {
    if (matchAny(compact, words, nudge.kw)) {
      nudge.fn();
      messages.push(nudge.msg);
    }
  }

  // 5) "random"/"surprise" — pick a random look.
  if (messages.length === 0 && matchAny(compact, words, ["random", "surprise", "anything", "whatever"])) {
    const keys = Object.keys(PRESETS);
    const pick = keys[Math.floor(Math.random() * keys.length)];
    filters = { ...DEFAULTS, ...PRESETS[pick] };
    messages.push(`Surprise \u2014 applied \u201c${pick}\u201d.`);
  }

  // 6) Smart fallback — never fail. Auto-enhance and hint.
  let note = "";
  if (messages.length === 0) {
    filters = { ...DEFAULTS, ...PRESETS.enhance };
    messages.push("Auto-enhanced (I wasn\u2019t sure what you meant).");
    note = " Try words like vintage, cinematic, cool, warm, neon, sketch, brighter, blur, or \u2018brightness 150\u2019.";
  }

  syncControls();
  render();
  return "\u2728 " + messages.join(" ") + note;
}

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

/* ============================================================
   SAVE / SHARE  (works on mobile via the Web Share API, with a
   plain download fallback on desktop / unsupported browsers)
   ============================================================ */
function canvasToBlob(cv, type = "image/png", quality) {
  return new Promise((res) => cv.toBlob((b) => res(b), type, quality));
}

async function saveOrShare(blob, filename, statusEl) {
  const file = new File([blob], filename, { type: blob.type || "application/octet-stream" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      if (statusEl) statusEl.textContent = "✅ Shared. Pick “Save to Photos / Files” on your phone.";
      return;
    } catch (e) {
      if (e && e.name === "AbortError") return; // user cancelled the share sheet
    }
  }
  // Fallback: trigger a normal download.
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  if (statusEl) statusEl.textContent = "✅ Saved to your downloads.";
}

async function sharePhoto() {
  if (!sourceImage) { promptFeedback.textContent = "Load a photo first."; return; }
  const blob = await canvasToBlob(canvas, "image/png");
  await saveOrShare(blob, "edited-photo.png", promptFeedback);
}

function pickVideoMime() {
  const types = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"];
  return types.find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || "";
}

/* ============================================================
   MODE SWITCHING
   ============================================================ */
function setMode(next) {
  mode = next;
  document.querySelectorAll(".tab").forEach((t) =>
    t.classList.toggle("active", t.dataset.mode === next)
  );
  // Show / hide any element tagged with data-modes.
  document.querySelectorAll("[data-modes]").forEach((el) => {
    const on = el.dataset.modes.split(/\s+/).includes(next);
    el.classList.toggle("hidden", !on);
  });
  // Manage preview loops.
  stopVideoLoop();
  stopCreateLoop();
  if (next === "video" && sourceVideo) startVideoLoop();
  if (next === "create" && createImages.length) startCreateLoop();
}

/* ============================================================
   VIDEO MODE  (load a clip, apply the same filters, trim, export)
   ============================================================ */
function loadVideoFile(file) {
  if (!file || !file.type.startsWith("video/")) {
    videoStatus.textContent = "Please choose a valid video file.";
    return;
  }
  const url = URL.createObjectURL(file);
  video.src = url;
  video.load();
  video.onloadedmetadata = () => {
    resetAll(false);
    sourceVideo = video;
    trimStart = 0;
    trimEnd = video.duration || 0;
    const dur = (video.duration || 0);
    trimStartEl.max = trimEndEl.max = dur.toFixed(2);
    trimStartEl.step = trimEndEl.step = "0.1";
    trimStartEl.value = 0;
    trimEndEl.value = dur;
    updateTrimLabels();
    videoDropInner.classList.add("hidden");
    videoCanvas.classList.remove("hidden");
    videoControls.classList.remove("hidden");
    [exportVideoBtn, resetVideoBtn, newVideoBtn].forEach((b) => (b.disabled = false));
    saveVideoBtn.disabled = true;
    videoStatus.textContent = "";
    playPauseBtn.textContent = "▶️ Play";
    // Nudge to decode the first frame for the preview.
    try { video.currentTime = 0.05; } catch (_) {}
    startVideoLoop();
  };
  video.onerror = () => {
    videoStatus.textContent = "Could not load that video (this browser may not support the format).";
  };
}

function startVideoLoop() {
  stopVideoLoop();
  const loop = () => {
    if (mode !== "video" || !sourceVideo) return;
    if (sourceVideo.videoWidth) {
      drawWithTransform(vctx, videoCanvas, sourceVideo, sourceVideo.videoWidth, sourceVideo.videoHeight);
    }
    if (!sourceVideo.paused && sourceVideo.currentTime >= trimEnd) {
      sourceVideo.currentTime = trimStart; // loop within the trim range
    }
    updateVideoTime();
    videoRAF = requestAnimationFrame(loop);
  };
  videoRAF = requestAnimationFrame(loop);
}
function stopVideoLoop() { if (videoRAF) cancelAnimationFrame(videoRAF); videoRAF = null; }

function updateVideoTime() {
  if (!sourceVideo) return;
  videoTime.textContent =
    `${sourceVideo.currentTime.toFixed(1)}s / ${(sourceVideo.duration || 0).toFixed(1)}s`;
}
function updateTrimLabels() {
  trimStartVal.textContent = `${trimStart.toFixed(1)}s`;
  trimEndVal.textContent = `${trimEnd.toFixed(1)}s`;
}

function togglePlay() {
  if (!sourceVideo) return;
  if (sourceVideo.paused) {
    if (sourceVideo.currentTime < trimStart || sourceVideo.currentTime >= trimEnd) {
      sourceVideo.currentTime = trimStart;
    }
    sourceVideo.muted = false;
    sourceVideo.play().catch(() => {});
    playPauseBtn.textContent = "⏸️ Pause";
  } else {
    sourceVideo.pause();
    playPauseBtn.textContent = "▶️ Play";
  }
}

function seekVideo(t) {
  return new Promise((res) => {
    const on = () => { video.removeEventListener("seeked", on); res(); };
    video.addEventListener("seeked", on);
    video.currentTime = t;
  });
}

async function exportVideo() {
  if (!sourceVideo || isExporting) return;
  if (trimEnd - trimStart < 0.1) { videoStatus.textContent = "Trim range is too short."; return; }
  isExporting = true;
  exportVideoBtn.disabled = true;
  sourceVideo.pause();
  playPauseBtn.textContent = "▶️ Play";
  videoProgress.classList.remove("hidden");
  videoProgressBar.style.width = "0%";
  videoStatus.textContent = "Exporting… keep this tab in the foreground.";

  const mime = pickVideoMime();
  const stream = videoCanvas.captureStream(30);
  const wasMuted = sourceVideo.muted;
  try {
    if (typeof sourceVideo.captureStream === "function") {
      sourceVideo.muted = false;
      sourceVideo.captureStream().getAudioTracks().forEach((t) => stream.addTrack(t));
    }
  } catch (_) {}

  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  const stopped = new Promise((r) => (rec.onstop = r));

  await seekVideo(trimStart);
  rec.start(100);
  await sourceVideo.play().catch(() => {});

  await new Promise((resolve) => {
    const check = () => {
      const p = Math.min(1, (sourceVideo.currentTime - trimStart) / (trimEnd - trimStart));
      videoProgressBar.style.width = `${Math.round(p * 100)}%`;
      if (sourceVideo.currentTime >= trimEnd || sourceVideo.ended) { resolve(); return; }
      requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  });

  sourceVideo.pause();
  rec.stop();
  await stopped;
  sourceVideo.muted = wasMuted;

  const blob = new Blob(chunks, { type: chunks.length ? chunks[0].type : "video/webm" });
  lastVideoBlob = blob;
  saveVideoBtn.disabled = false;
  videoProgressBar.style.width = "100%";
  videoStatus.textContent = "✅ Clip ready — opening Save / Share…";
  isExporting = false;
  exportVideoBtn.disabled = false;
  setTimeout(() => videoProgress.classList.add("hidden"), 800);
  await saveOrShare(blob, "edited-video.webm", videoStatus);
}

/* ============================================================
   CREATE MODE  (turn photos into a Ken-Burns slideshow video)
   ============================================================ */
function addCreateFiles(fileList) {
  const files = Array.from(fileList).filter((f) => f.type.startsWith("image/"));
  if (!files.length) return;
  let pending = files.length;
  files.forEach((file) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => { createImages.push(img); if (--pending === 0) afterCreateAdd(); };
      img.onerror = () => { if (--pending === 0) afterCreateAdd(); };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}
function afterCreateAdd() {
  renderThumbs();
  createDropInner.classList.add("hidden");
  createCanvas.classList.remove("hidden");
  generateBtn.disabled = createImages.length === 0;
  clearGenBtn.disabled = createImages.length === 0;
  startCreateLoop();
}
function renderThumbs() {
  thumbs.innerHTML = "";
  createImages.forEach((img, i) => {
    const d = document.createElement("div");
    d.className = "thumb";
    const im = document.createElement("img");
    im.src = img.src;
    const rm = document.createElement("button");
    rm.className = "rm"; rm.textContent = "×"; rm.title = "Remove";
    rm.addEventListener("click", () => {
      createImages.splice(i, 1);
      renderThumbs();
      if (!createImages.length) {
        createCanvas.classList.add("hidden");
        createDropInner.classList.remove("hidden");
        generateBtn.disabled = true;
        clearGenBtn.disabled = true;
        stopCreateLoop();
      }
    });
    const idx = document.createElement("span");
    idx.className = "idx"; idx.textContent = i + 1;
    d.append(im, rm, idx);
    thumbs.appendChild(d);
  });
}
function clearCreate() {
  createImages = [];
  lastGenBlob = null;
  renderThumbs();
  stopCreateLoop();
  createCanvas.classList.add("hidden");
  createDropInner.classList.remove("hidden");
  generateBtn.disabled = true;
  clearGenBtn.disabled = true;
  saveGenBtn.disabled = true;
  genStatus.textContent = "";
}

// Draw one Ken-Burns frame (t = 0..1 progress through the image).
function drawKenBurns(context, W, H, img, effect, t, fade, beat) {
  context.save();
  context.filter = "none";
  context.fillStyle = "#000";
  context.fillRect(0, 0, W, H);
  context.filter = buildFilterString();

  const iw = img.naturalWidth, ih = img.naturalHeight;
  const cover = Math.max(W / iw, H / ih); // object-fit: cover
  let zoom = 1.06;
  if (effect === "zoomin") zoom = 1 + 0.18 * t;
  else if (effect === "zoomout") zoom = 1.18 - 0.18 * t;
  else if (effect === "kenburns") zoom = 1.06 + 0.12 * t;
  else if (effect === "still") zoom = 1.02;
  else if (effect === "panlr") zoom = 1.12;
  if (beat) zoom += beat * 0.14; // pulse on the music beat

  const scale = cover * zoom;
  const dw = iw * scale, dh = ih * scale;
  let cx = (W - dw) / 2, cy = (H - dh) / 2;

  if (effect === "panlr") cx = -(dw - W) * t;
  else if (effect === "kenburns") {
    cx += (dw - W) * 0.12 * (0.5 - t);
    cy += (dh - H) * 0.12 * (t - 0.5);
  }
  context.drawImage(img, cx, cy, dw, dh);
  context.restore();

  if (fade) {
    const edge = 0.18;
    let a = 0;
    if (t < edge) a = 1 - t / edge;
    else if (t > 1 - edge) a = (t - (1 - edge)) / edge;
    if (a > 0) {
      context.save();
      context.filter = "none";
      context.globalAlpha = a;
      context.fillStyle = "#000";
      context.fillRect(0, 0, W, H);
      context.restore();
    }
  }
}

function startCreateLoop() {
  stopCreateLoop();
  if (!createImages.length) return;
  const [W, H] = resSelect.value.split("x").map(Number);
  createCanvas.width = W; createCanvas.height = H;
  const dur = Math.max(0.5, Number(perDuration.value)) * 1000;
  let start = performance.now();
  const startAll = start;
  let idx = 0;
  const loop = (now) => {
    if (mode !== "create" || !createImages.length) return;
    let t = (now - start) / dur;
    if (t >= 1) { start = now; idx = (idx + 1) % createImages.length; t = 0; }
    if (danceMode && Number(danceMode.value) === 1) {
      const el = (now - startAll) / 1000;
      const fakeBeat = 0.35 + 0.35 * Math.abs(Math.sin(2 * Math.PI * el * 2));
      drawDance(cctx, W, H, createImages[idx], el, fakeBeat, fakeBeat);
    } else {
      drawKenBurns(cctx, W, H, createImages[idx], effectSelect.value, t, Number(fadeEl.value) === 1);
    }
    createRAF = requestAnimationFrame(loop);
  };
  createRAF = requestAnimationFrame(loop);
}
function stopCreateLoop() { if (createRAF) cancelAnimationFrame(createRAF); createRAF = null; }

function animateOne(W, H, img, effect, durMs, fade, onProg) {
  return new Promise((resolve) => {
    const start = performance.now();
    const frame = (now) => {
      const t = Math.min(1, (now - start) / durMs);
      drawKenBurns(cctx, W, H, img, effect, t, fade);
      if (onProg) onProg(t);
      if (t < 1) requestAnimationFrame(frame); else resolve();
    };
    requestAnimationFrame(frame);
  });
}

async function generateVideo() {
  if (!createImages.length || isExporting) return;
  if (songBuffer) return generateMusicVideo();
  isExporting = true;
  generateBtn.disabled = true;
  stopCreateLoop();
  const [W, H] = resSelect.value.split("x").map(Number);
  createCanvas.width = W; createCanvas.height = H;
  genProgress.classList.remove("hidden");
  genProgressBar.style.width = "0%";
  genStatus.textContent = "Rendering… keep this tab in the foreground.";

  const mime = pickVideoMime();
  const stream = createCanvas.captureStream(30);
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  const stopped = new Promise((r) => (rec.onstop = r));
  rec.start(100);

  const perMs = Math.max(0.5, Number(perDuration.value)) * 1000;
  const fade = Number(fadeEl.value) === 1;
  const effect = effectSelect.value;
  const total = createImages.length;
  for (let i = 0; i < total; i++) {
    await animateOne(W, H, createImages[i], effect, perMs, fade, (p) => {
      genProgressBar.style.width = `${Math.round(((i + p) / total) * 100)}%`;
    });
  }

  rec.stop();
  await stopped;
  const blob = new Blob(chunks, { type: chunks.length ? chunks[0].type : "video/webm" });
  lastGenBlob = blob;
  saveGenBtn.disabled = false;
  genProgressBar.style.width = "100%";
  genStatus.textContent = "✅ Video ready — opening Save / Share…";
  isExporting = false;
  generateBtn.disabled = false;
  startCreateLoop();
  setTimeout(() => genProgress.classList.add("hidden"), 800);
  await saveOrShare(blob, "generated-video.webm", genStatus);
}

/* ============================================================
   MUSIC VIDEO  (offline) — add your OWN song, get a beat-reacting
   slideshow exported WITH the audio track. Length = song length.
   ============================================================ */
function loadSong(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      const ctxA = new AC();
      const buf = await ctxA.decodeAudioData(e.target.result);
      ctxA.close();
      songBuffer = buf;
      const secs = Math.round(buf.duration);
      musicName.textContent = `🎵 ${file.name} — ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}. Add photos/scenes, then Generate.`;
    } catch (err) {
      songBuffer = null;
      musicName.textContent = "Couldn't read that audio file — try an MP3, M4A, WAV or OGG.";
    }
  };
  reader.readAsArrayBuffer(file);
}

/* Make the photo "dance" to the beat — offline motion effect.
   Cycles through many moves so the person shows "all their skills".
   Not an AI that re-poses limbs (that needs paid cloud AI). */
const DANCE_MOVES = [
  "bounce", "sway", "spin", "jump", "twist",
  "shimmy", "headbang", "pump", "wave", "groove"
];
function drawDance(context, W, H, img, elapsed, beat, energy) {
  context.save();
  context.filter = "none";
  context.fillStyle = "#000";
  context.fillRect(0, 0, W, H);
  context.filter = buildFilterString();

  const iw = img.naturalWidth, ih = img.naturalHeight;
  const cover = Math.max(W / iw, H / ih);
  // change move every ~2.2s so it goes through all the skills
  const move = DANCE_MOVES[Math.floor(elapsed / 2.2) % DANCE_MOVES.length];
  const bt = 2 * Math.PI * elapsed * 2;        // ~2 beats/sec base motion
  const amp = 0.5 + energy * 0.7;              // louder music = bigger moves
  const kick = beat * beat;                    // sharp kick on strong beats

  let dx = 0, dy = 0, rot = 0, sx = 1, sy = 1, zoom = 1.12;

  switch (move) {
    case "bounce":
      dy = -Math.abs(Math.sin(bt)) * H * 0.05 * amp - kick * H * 0.04;
      sy = 1 + Math.abs(Math.sin(bt)) * 0.04 * amp; sx = 2 - sy; break;
    case "sway":
      dx = Math.sin(bt * 0.5) * W * 0.05 * amp;
      rot = Math.sin(bt * 0.5) * 0.10 * amp; break;
    case "spin":
      rot = (elapsed % 2.2) / 2.2 * Math.PI * 2; zoom = 1.18; break;
    case "jump":
      dy = -Math.pow(Math.max(0, Math.sin(bt * 0.5)), 0.6) * H * 0.08 * amp - kick * H * 0.05; break;
    case "twist":
      sx = 1 + Math.sin(bt) * 0.10 * amp; rot = Math.sin(bt) * 0.06; break;
    case "shimmy":
      dx = Math.sin(bt * 2) * W * 0.03 * amp; rot = Math.sin(bt * 2) * 0.05; break;
    case "headbang":
      rot = -Math.abs(Math.sin(bt)) * 0.18 * amp; dy = Math.abs(Math.sin(bt)) * H * 0.03; break;
    case "pump":
      zoom = 1.12 + (Math.abs(Math.sin(bt)) * 0.10 + kick * 0.10) * amp; break;
    case "wave":
      dx = Math.sin(bt) * W * 0.04 * amp; dy = Math.cos(bt * 1.5) * H * 0.03 * amp;
      rot = Math.sin(bt) * 0.05; break;
    default: // groove
      dx = Math.sin(bt * 0.5) * W * 0.03 * amp; dy = Math.abs(Math.sin(bt)) * H * 0.025 * amp;
      rot = Math.sin(bt * 0.5) * 0.06 * amp; zoom = 1.12 + kick * 0.06;
  }

  const scale = cover * (zoom + beat * 0.05);
  const dw = iw * scale, dh = ih * scale;
  context.translate(W / 2 + dx, H / 2 + dy);
  context.rotate(rot);
  context.scale(sx, sy);
  context.drawImage(img, -dw / 2, -dh / 2, dw, dh);
  context.restore();
}

function drawBars(context, W, H, freq) {
  const n = 48;
  const bw = W / n;
  context.save();
  context.filter = "none";
  context.globalAlpha = 0.55;
  for (let i = 0; i < n; i++) {
    const v = freq[Math.floor((i / n) * freq.length)] / 255;
    const bh = v * H * 0.28;
    context.fillStyle = `hsl(${200 + (i / n) * 140}, 90%, 60%)`;
    context.fillRect(i * bw + bw * 0.1, H - bh, bw * 0.8, bh);
  }
  context.restore();
}

async function generateMusicVideo() {
  if (!createImages.length || !songBuffer || isExporting) return;
  isExporting = true;
  generateBtn.disabled = true;
  stopCreateLoop();
  const [W, H] = resSelect.value.split("x").map(Number);
  createCanvas.width = W; createCanvas.height = H;
  genProgress.classList.remove("hidden");
  genProgressBar.style.width = "0%";
  genStatus.textContent = "Rendering music video… keep this tab in the foreground.";

  const AC = window.AudioContext || window.webkitAudioContext;
  const audioCtx = new AC();
  const source = audioCtx.createBufferSource();
  source.buffer = songBuffer;
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 256;
  const freq = new Uint8Array(analyser.frequencyBinCount);
  const dest = audioCtx.createMediaStreamDestination();
  source.connect(analyser);
  analyser.connect(dest);
  analyser.connect(audioCtx.destination); // so you can hear it while rendering

  const mime = pickVideoMime();
  const stream = createCanvas.captureStream(30);
  const at = dest.stream.getAudioTracks()[0];
  if (at) stream.addTrack(at);
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  const stopped = new Promise((r) => (rec.onstop = r));
  rec.start(100);

  const duration = songBuffer.duration;
  const perImg = Math.max(0.5, Number(perDuration.value));
  const fade = Number(fadeEl.value) === 1;
  const effect = effectSelect.value;
  const useBeat = Number(beatReact.value) === 1;
  const useBars = Number(showBars.value) === 1;
  const useDance = Number(danceMode.value) === 1;
  const n = createImages.length;

  source.start();
  const start = performance.now();
  await new Promise((resolve) => {
    const loop = (now) => {
      const elapsed = (now - start) / 1000;
      analyser.getByteFrequencyData(freq);
      let beat = 0, energy = 0;
      let s = 0; for (let i = 0; i < 8; i++) s += freq[i];
      energy = Math.min(1, (s / 8) / 255);
      if (useBeat) beat = energy;
      const idx = Math.floor(elapsed / perImg) % n;
      const t = (elapsed % perImg) / perImg;
      if (useDance) {
        drawDance(cctx, W, H, createImages[idx], elapsed, beat, energy);
      } else {
        drawKenBurns(cctx, W, H, createImages[idx], effect, t, fade, beat);
      }
      if (useBars) drawBars(cctx, W, H, freq);
      genProgressBar.style.width = `${Math.min(100, Math.round((elapsed / duration) * 100))}%`;
      if (elapsed < duration) requestAnimationFrame(loop);
      else resolve();
    };
    requestAnimationFrame(loop);
  });

  try { source.stop(); } catch (e) { /* already stopped */ }
  rec.stop();
  await stopped;
  audioCtx.close();
  const blob = new Blob(chunks, { type: chunks.length ? chunks[0].type : "video/webm" });
  lastGenBlob = blob;
  saveGenBtn.disabled = false;
  genProgressBar.style.width = "100%";
  genStatus.textContent = "✅ Music video ready — opening Save / Share…";
  isExporting = false;
  generateBtn.disabled = false;
  startCreateLoop();
  setTimeout(() => genProgress.classList.add("hidden"), 800);
  await saveOrShare(blob, "music-video.webm", genStatus);
}

/* ============================================================
   TEXT -> IMAGE / VIDEO  (100% offline procedural art)
   Turns any prompt into a painted scene, then those scenes can
   be animated into a full-length video by the create pipeline.
   No internet, no API keys, no cost. Not photorealistic AI.
   ============================================================ */
const COLOR_WORDS = {
  red: "#e23b3b", crimson: "#dc143c", scarlet: "#ff2400",
  blue: "#3b6fe2", navy: "#1b2a5b", sky: "#7ec8ff", azure: "#3aa0ff",
  green: "#3ba55d", forest: "#1e6b3a", emerald: "#2ecc71", teal: "#14b8a6",
  cyan: "#22d3ee", yellow: "#f5d442", gold: "#e6b800", golden: "#e6b800",
  orange: "#ff8c1a", amber: "#ffbf47", purple: "#8a5cff", violet: "#7c3aed",
  indigo: "#4b0082", pink: "#ff6ea9", rose: "#ff5c8a", magenta: "#e83e8c",
  white: "#f5f5f5", black: "#0a0a0a", gray: "#7a7a7a", grey: "#7a7a7a",
  brown: "#8b5a2b", silver: "#c0c0c0", turquoise: "#40e0d0", lime: "#a3e635",
  peach: "#ffb27a", coral: "#ff7f50", mint: "#7be0b0", lavender: "#c4a7ff",
};

// Tiny seeded PRNG so each generated scene is varied but repeatable.
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickColors(lower) {
  const found = [];
  for (const [k, v] of Object.entries(COLOR_WORDS)) if (lower.includes(k)) found.push(v);
  return found;
}

// Paint a scene described by `prompt` onto a 2D context of size W×H.
function paintScene(context, W, H, prompt, seed) {
  const rnd = mulberry32((seed || 1) >>> 0);
  const lower = (prompt || "").toLowerCase();
  const has = (...ws) => ws.some((w) => lower.includes(w));
  const cols = pickColors(lower);
  context.save();
  context.filter = "none";
  context.globalAlpha = 1;

  const vgrad = (stops) => {
    const g = context.createLinearGradient(0, 0, 0, H);
    stops.forEach(([o, c]) => g.addColorStop(o, c));
    return g;
  };
  const TAU = Math.PI * 2;

  if (has("sunset", "sunrise", "dusk", "dawn", "golden hour")) {
    context.fillStyle = vgrad([[0, "#241247"], [0.45, "#7a2f6d"], [0.7, "#ff7a3d"], [1, "#ffd36b"]]);
    context.fillRect(0, 0, W, H);
    const sx = W * (0.3 + 0.4 * rnd()), sy = H * 0.62, r = Math.min(W, H) * 0.12;
    const sg = context.createRadialGradient(sx, sy, 0, sx, sy, r * 2.2);
    sg.addColorStop(0, "#fff6d5"); sg.addColorStop(0.4, "#ffdf8a"); sg.addColorStop(1, "rgba(255,180,90,0)");
    context.fillStyle = sg; context.beginPath(); context.arc(sx, sy, r * 2.2, 0, TAU); context.fill();
    context.fillStyle = "#ffdf8a"; context.beginPath(); context.arc(sx, sy, r, 0, TAU); context.fill();
    context.fillStyle = "rgba(20,10,40,0.55)"; context.fillRect(0, H * 0.72, W, H * 0.28);
    for (let i = 0; i < 40; i++) {
      const y = H * 0.73 + rnd() * H * 0.25;
      context.fillStyle = `rgba(255,210,130,${0.05 + rnd() * 0.12})`;
      context.fillRect(0, y, W, 1 + rnd() * 2);
    }
  } else if (has("night", "star", "galaxy", "space", "cosmos", "moon", "midnight")) {
    context.fillStyle = vgrad([[0, "#05060d"], [0.6, "#0a1030"], [1, "#12183f"]]);
    context.fillRect(0, 0, W, H);
    if (cols.length) {
      const g = context.createRadialGradient(W * 0.5, H * 0.4, 0, W * 0.5, H * 0.4, W * 0.6);
      g.addColorStop(0, cols[0] + "55"); g.addColorStop(1, "rgba(0,0,0,0)");
      context.fillStyle = g; context.fillRect(0, 0, W, H);
    }
    for (let i = 0; i < 240; i++) {
      const x = rnd() * W, y = rnd() * H, r = rnd() * 1.6 + 0.2;
      context.fillStyle = `rgba(255,255,255,${0.3 + rnd() * 0.7})`;
      context.beginPath(); context.arc(x, y, r, 0, TAU); context.fill();
    }
    if (has("moon")) {
      const mx = W * 0.72, my = H * 0.28, mr = Math.min(W, H) * 0.1;
      const mg = context.createRadialGradient(mx, my, 0, mx, my, mr * 1.6);
      mg.addColorStop(0, "#fdfbf0"); mg.addColorStop(0.6, "#e8e6d8"); mg.addColorStop(1, "rgba(230,230,210,0)");
      context.fillStyle = mg; context.beginPath(); context.arc(mx, my, mr * 1.6, 0, TAU); context.fill();
      context.fillStyle = "#f2f0e2"; context.beginPath(); context.arc(mx, my, mr, 0, TAU); context.fill();
    }
  } else if (has("city", "building", "skyline", "urban", "town", "street")) {
    const night = has("night", "dark");
    context.fillStyle = night ? vgrad([[0, "#0a1130"], [1, "#33264d"]]) : vgrad([[0, "#8ec9ff"], [1, "#ffd9a0"]]);
    context.fillRect(0, 0, W, H);
    let x = 0;
    while (x < W) {
      const bw = W * (0.05 + rnd() * 0.08), bh = H * (0.25 + rnd() * 0.5), by = H - bh;
      context.fillStyle = night ? "rgba(15,20,45,0.95)" : `rgba(60,70,100,${0.75 + rnd() * 0.2})`;
      context.fillRect(x, by, bw - 2, bh);
      for (let wy = by + 6; wy < H - 6; wy += 12)
        for (let wx = x + 4; wx < x + bw - 6; wx += 11)
          if (rnd() > 0.4) {
            context.fillStyle = night ? `rgba(255,220,120,${0.5 + rnd() * 0.5})` : "rgba(200,220,255,0.5)";
            context.fillRect(wx, wy, 4, 5);
          }
      x += bw;
    }
  } else if (has("mountain", "forest", "hill", "valley", "nature", "tree", "wood", "jungle", "landscape")) {
    context.fillStyle = vgrad([[0, "#bfe3ff"], [0.6, "#e9f6ff"], [1, "#f7fbe9"]]);
    context.fillRect(0, 0, W, H);
    const sx = W * 0.75, sy = H * 0.22, r = Math.min(W, H) * 0.08;
    context.fillStyle = "#fff3c4"; context.beginPath(); context.arc(sx, sy, r, 0, TAU); context.fill();
    [["#7fa8c9", 0.55], ["#5b83a8", 0.68], ["#3f6184", 0.8]].forEach(([c, base]) => {
      context.fillStyle = c; context.beginPath(); context.moveTo(0, H);
      let x = 0, y = H * base; context.lineTo(0, y);
      const step = W / 6;
      while (x < W) { x += step; y = H * base + (rnd() - 0.5) * H * 0.18; context.lineTo(x, y); }
      context.lineTo(W, H); context.closePath(); context.fill();
    });
    if (has("tree", "forest", "jungle", "wood")) {
      for (let i = 0; i < 14; i++) {
        const tx = rnd() * W, th = H * (0.1 + rnd() * 0.12), ty = H * 0.84;
        context.fillStyle = "#245c34"; context.beginPath();
        context.moveTo(tx, ty - th); context.lineTo(tx - th * 0.4, ty); context.lineTo(tx + th * 0.4, ty);
        context.closePath(); context.fill();
      }
    }
    context.fillStyle = "#6fae54"; context.fillRect(0, H * 0.84, W, H * 0.16);
  } else if (has("ocean", "sea", "beach", "water", "wave", "tropical", "island", "lake")) {
    context.fillStyle = vgrad([[0, "#7ec8ff"], [0.5, "#bfe9ff"], [0.5, "#0f7fbf"], [1, "#054e7a"]]);
    context.fillRect(0, 0, W, H);
    const sx = W * 0.7, sy = H * 0.24, r = Math.min(W, H) * 0.09;
    context.fillStyle = "#fff3c4"; context.beginPath(); context.arc(sx, sy, r, 0, TAU); context.fill();
    for (let i = 0; i < 40; i++) {
      const y = H * 0.52 + rnd() * H * 0.45;
      context.fillStyle = `rgba(255,255,255,${0.06 + rnd() * 0.12})`;
      context.fillRect(0, y, W, 1 + rnd() * 2);
    }
    if (has("beach", "island", "tropical")) {
      context.fillStyle = "#f2daa6"; context.beginPath();
      context.moveTo(0, H); context.lineTo(W, H); context.lineTo(W, H * 0.86);
      context.quadraticCurveTo(W * 0.5, H * 0.8, 0, H * 0.9); context.closePath(); context.fill();
    }
  } else if (has("fire", "lava", "flame", "ember", "inferno", "volcano")) {
    const g = context.createRadialGradient(W * 0.5, H * 0.75, 0, W * 0.5, H * 0.75, Math.max(W, H) * 0.85);
    g.addColorStop(0, "#fff2b0"); g.addColorStop(0.25, "#ff9d2f"); g.addColorStop(0.6, "#e83015"); g.addColorStop(1, "#2a0505");
    context.fillStyle = g; context.fillRect(0, 0, W, H);
    for (let i = 0; i < 130; i++) {
      const x = rnd() * W, y = H * (0.4 + rnd() * 0.6), r = rnd() * 2.5;
      context.fillStyle = `rgba(255,${(150 + rnd() * 80) | 0},60,${0.4 + rnd() * 0.5})`;
      context.beginPath(); context.arc(x, y, r, 0, TAU); context.fill();
    }
  } else if (has("rain", "storm", "cloud", "fog", "mist", "overcast")) {
    context.fillStyle = vgrad([[0, "#5a6675"], [1, "#93a1b0"]]); context.fillRect(0, 0, W, H);
    for (let i = 0; i < 6; i++) {
      const cx = rnd() * W, cy = H * (0.15 + rnd() * 0.3), cw = W * 0.25;
      context.fillStyle = "rgba(230,235,240,0.7)";
      context.beginPath(); context.ellipse(cx, cy, cw, cw * 0.4, 0, 0, TAU); context.fill();
    }
    if (has("rain", "storm")) {
      context.strokeStyle = "rgba(200,220,240,0.5)"; context.lineWidth = 1;
      for (let i = 0; i < 200; i++) {
        const x = rnd() * W, y = rnd() * H;
        context.beginPath(); context.moveTo(x, y); context.lineTo(x - 6, y + 14); context.stroke();
      }
    }
  } else if (has("rainbow")) {
    const rc = ["#ff3b3b", "#ff8c1a", "#f5d442", "#3ba55d", "#3b6fe2", "#7c3aed", "#a855f7"];
    context.fillStyle = "#dff1ff"; context.fillRect(0, 0, W, H);
    rc.forEach((c, i) => {
      context.strokeStyle = c; context.lineWidth = H * 0.03;
      context.beginPath(); context.arc(W * 0.5, H * 1.05, H * (0.55 + i * 0.045), Math.PI, TAU); context.stroke();
    });
  } else {
    const pal = cols.length ? cols : ["#6c8cff", "#8a6bff", "#22d3ee", "#ff6ea9"];
    const g = context.createLinearGradient(0, 0, W, H);
    pal.forEach((c, i) => g.addColorStop(i / (pal.length - 1 || 1), c));
    context.fillStyle = g; context.fillRect(0, 0, W, H);
    for (let i = 0; i < 10; i++) {
      const x = rnd() * W, y = rnd() * H, r = (0.1 + rnd() * 0.25) * Math.min(W, H);
      const c = pal[(rnd() * pal.length) | 0];
      const bg = context.createRadialGradient(x, y, 0, x, y, r);
      bg.addColorStop(0, c + "aa"); bg.addColorStop(1, c + "00");
      context.fillStyle = bg; context.beginPath(); context.arc(x, y, r, 0, TAU); context.fill();
    }
  }

  // Soft film grain
  const grains = Math.floor((W * H) / 900);
  for (let i = 0; i < grains; i++) {
    context.fillStyle = `rgba(255,255,255,${rnd() * 0.04})`;
    context.fillRect(rnd() * W, rnd() * H, 1, 1);
  }
  // Vignette
  const vg = context.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.75);
  vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,0.35)");
  context.fillStyle = vg; context.fillRect(0, 0, W, H);
  context.restore();
}

function makeArtImage(prompt, seed) {
  return new Promise((resolve) => {
    let [W, H] = resSelect.value.split("x").map(Number);
    if (!Number.isFinite(W) || !Number.isFinite(H) || W < 1 || H < 1) { W = 1280; H = 720; }
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    paintScene(c.getContext("2d"), W, H, prompt, seed);
    const img = new Image();
    img.onload = () => resolve(img);
    img.src = c.toDataURL("image/png");
  });
}

async function generateArt(count, autoVideo) {
  const prompt = (artPrompt.value || "").trim();
  if (!prompt) { genStatus.textContent = "Type what you want to see first."; return; }
  makeImgBtn.disabled = true; makeVidBtn.disabled = true;
  genStatus.textContent = "🎨 Painting your scene…";
  const base = Date.now();
  for (let i = 0; i < count; i++) {
    const img = await makeArtImage(prompt, base + i * 9973);
    createImages.push(img);
  }
  afterCreateAdd();
  makeImgBtn.disabled = false; makeVidBtn.disabled = false;
  genStatus.textContent = `Added ${count} scene${count > 1 ? "s" : ""} from “${prompt}”. Tap Generate video, or add more.`;
  if (autoVideo) await generateVideo();
}

/* ============================================================
   RECOLOR TOOL  (offline)
   Swap one colour for another (e.g. red dress -> blue dress)
   while keeping the face, body and expression identical. Only
   pixels matching the chosen colour change; their brightness
   (shading/folds) is preserved so it looks natural.
   ============================================================ */
let picking = false; // eyedropper active

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}
function rgbToHex(r, g, b) {
  const c = (n) => n.toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0; const l = (max + min) / 2;
  const d = max - min;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return [h, s, l];
}
function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

function applyRecolor() {
  if (!sourceImage) { recolorFeedback.textContent = "Load a photo first."; return; }
  const from = hexToRgb(recolorFrom.value);
  const to = hexToRgb(recolorTo.value);
  const [fh, fs, fl] = rgbToHsl(from.r, from.g, from.b);
  const [th, ts] = rgbToHsl(to.r, to.g, to.b);
  const tolDeg = Number(recolorTol.value);
  const fromIsGray = fs < 0.12;

  const W = sourceImage.naturalWidth, H = sourceImage.naturalHeight;
  const oc = document.createElement("canvas");
  oc.width = W; oc.height = H;
  const octx = oc.getContext("2d", { willReadFrequently: true });
  octx.drawImage(sourceImage, 0, 0);
  const id = octx.getImageData(0, 0, W, H);
  const d = id.data;

  let changed = 0;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const [h, s, l] = rgbToHsl(r, g, b);
    let match, w = 1;
    if (fromIsGray) {
      match = s < 0.15 && Math.abs(l - fl) < 0.25;
    } else {
      let dh = Math.abs(h - fh); if (dh > 180) dh = 360 - dh;
      match = dh <= tolDeg && s >= 0.12;
      if (match) { const t = 1 - dh / tolDeg; w = t * t * (3 - 2 * t); } // feather edges
    }
    if (!match) continue;
    const ns = fromIsGray ? ts : Math.min(1, s * 0.6 + ts * 0.4);
    const [nr, ng, nb] = hslToRgb(th, ns, l); // keep pixel lightness => shading preserved
    d[i] = Math.round(r + (nr - r) * w);
    d[i + 1] = Math.round(g + (ng - g) * w);
    d[i + 2] = Math.round(b + (nb - b) * w);
    changed++;
  }
  octx.putImageData(id, 0, 0);
  const img = new Image();
  img.onload = () => { sourceImage = img; render(); };
  img.src = oc.toDataURL("image/png");
  const pct = Math.round((changed / (W * H)) * 100);
  recolorFeedback.textContent = changed
    ? `✅ Recoloured ${pct}% of the photo. Face, body & expression unchanged.`
    : "No matching colour found — use “Pick from photo”, or widen the Match range.";
}

// Detect a recolor request in a plain-English prompt, e.g.
// "change red dress to blue", "make the red blue", "recolour red to green".
// Returns {from:{name,hex}, to:{name,hex}} or null.
function detectRecolor(raw) {
  const hits = [];
  for (const [name, hex] of Object.entries(COLOR_WORDS)) {
    const m = new RegExp(`\\b${name}\\b`).exec(raw);
    if (m) hits.push({ name, hex, idx: m.index });
  }
  if (hits.length < 2) return null;
  hits.sort((a, b) => a.idx - b.idx);
  const sep = /->|=>|→|\b(?:to|into|instead of)\b/.exec(raw);
  let from, to;
  if (sep) {
    const before = hits.filter((h) => h.idx < sep.index);
    const after = hits.filter((h) => h.idx >= sep.index + sep[0].length);
    from = before.length ? before[before.length - 1] : hits[0];
    to = after.length ? after[0] : hits[hits.length - 1];
  } else {
    from = hits[0]; to = hits[1];
  }
  if (from.hex === to.hex) return null;
  return { from, to };
}

function startEyedropper() {
  if (!sourceImage) { recolorFeedback.textContent = "Load a photo first."; return; }
  picking = !picking;
  pickColorBtn.classList.toggle("active", picking);
  canvas.classList.toggle("picking", picking);
  recolorFeedback.textContent = picking ? "Click the colour on the photo you want to change." : "";
}

function handleCanvasPick(e) {
  if (!picking) return;
  const rect = canvas.getBoundingClientRect();
  const x = Math.floor(((e.clientX - rect.left) / rect.width) * canvas.width);
  const y = Math.floor(((e.clientY - rect.top) / rect.height) * canvas.height);
  const px = ctx.getImageData(Math.max(0, Math.min(canvas.width - 1, x)), Math.max(0, Math.min(canvas.height - 1, y)), 1, 1).data;
  recolorFrom.value = rgbToHex(px[0], px[1], px[2]);
  picking = false;
  pickColorBtn.classList.remove("active");
  canvas.classList.remove("picking");
  recolorFeedback.textContent = "Picked colour ✓ — now set “To” and tap Apply recolor.";
}

/* ============================================================
   MATCH A LOOK  (offline colour transfer from a reference photo)
   Give a reference image (e.g. a screenshot from Instagram) and
   copy its colour palette / mood onto the current photo using
   Reinhard mean–std transfer. Face & body stay the same; only the
   overall colour grade changes. Not a full AI face-swap.
   ============================================================ */
let styleRefImage = null;

// Mean & standard deviation per RGB channel, sampled at reduced size for speed.
function imageColorStats(img) {
  const max = 220;
  const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const cx = c.getContext("2d", { willReadFrequently: true });
  cx.drawImage(img, 0, 0, w, h);
  const d = cx.getImageData(0, 0, w, h).data;
  const n = w * h;
  const sum = [0, 0, 0], sumSq = [0, 0, 0];
  for (let i = 0; i < d.length; i += 4) {
    for (let c2 = 0; c2 < 3; c2++) {
      const v = d[i + c2];
      sum[c2] += v; sumSq[c2] += v * v;
    }
  }
  const mean = sum.map((s) => s / n);
  const std = sumSq.map((sq, c2) => Math.sqrt(Math.max(1, sq / n - mean[c2] * mean[c2])));
  return { mean, std };
}

function applyStyleMatch() {
  if (!sourceImage) { styleFeedback.textContent = "Load your photo first."; return; }
  if (!styleRefImage) { styleFeedback.textContent = "Add a reference photo first."; return; }
  const strength = Number(styleStrength.value) / 100;
  const src = imageColorStats(sourceImage);
  const ref = imageColorStats(styleRefImage);
  // clamp per-channel std ratio so it never blows out
  const ratio = [0, 1, 2].map((c) => {
    let r = ref.std[c] / (src.std[c] || 1);
    return Math.max(0.4, Math.min(2.5, r));
  });

  const W = sourceImage.naturalWidth, H = sourceImage.naturalHeight;
  const oc = document.createElement("canvas");
  oc.width = W; oc.height = H;
  const octx = oc.getContext("2d", { willReadFrequently: true });
  octx.drawImage(sourceImage, 0, 0);
  const id = octx.getImageData(0, 0, W, H);
  const d = id.data;
  for (let i = 0; i < d.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const o = d[i + c];
      let v = (o - src.mean[c]) * ratio[c] + ref.mean[c]; // Reinhard transfer
      v = o + (v - o) * strength;                          // blend by strength
      d[i + c] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
  }
  octx.putImageData(id, 0, 0);
  const img = new Image();
  img.onload = () => { sourceImage = img; render(); };
  img.src = oc.toDataURL("image/png");
  styleFeedback.textContent = "✅ Matched the reference look. Your face & body are unchanged — tap Save / Share.";
}

function loadStyleRef(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      styleRefImage = img;
      styleRefThumb.src = img.src;
      styleRefThumb.classList.remove("hidden");
      if (styleMatchBtn) styleMatchBtn.disabled = !sourceImage;
      styleFeedback.textContent = sourceImage
        ? "Reference added ✓ — tap “Match this look”."
        : "Reference added ✓ — now load your photo above.";
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

// --- Event wiring -------------------------------------------
function init() {
  // File input / browse
  $("browseBtn").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", (e) => loadFile(e.target.files[0]));

  // Drag & drop
  ["dragenter", "dragover"].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.classList.add("dragover"); })
  );
  ["dragleave", "drop"].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.classList.remove("dragover"); })
  );
  dropzone.addEventListener("drop", (e) => {
    if (e.dataTransfer.files.length) loadFile(e.dataTransfer.files[0]);
  });

  // Sliders (shared by all modes — the live preview loops read them each frame)
  for (const key of Object.keys(sliders)) {
    sliders[key].addEventListener("input", (e) => {
      filters[key] = Number(e.target.value);
      valueLabels[key].textContent = `${filters[key]}${LABEL_SUFFIX[key]}`;
      if (mode === "photo") render();
    });
  }

  // Transform buttons
  $("rotateLeftBtn").addEventListener("click", () => { rotation = (rotation - 90 + 360) % 360; if (mode === "photo") render(); });
  $("rotateRightBtn").addEventListener("click", () => { rotation = (rotation + 90) % 360; if (mode === "photo") render(); });
  $("flipHBtn").addEventListener("click", () => { flipH = !flipH; if (mode === "photo") render(); });
  $("flipVBtn").addEventListener("click", () => { flipV = !flipV; if (mode === "photo") render(); });

  // Photo actions
  downloadBtn.addEventListener("click", download);
  resetBtn.addEventListener("click", () => resetAll(true));
  newImageBtn.addEventListener("click", () => fileInput.click());
  if (savePhotoBtn) savePhotoBtn.addEventListener("click", sharePhoto);

  // Recolor tool
  if (recolorBtn) recolorBtn.addEventListener("click", applyRecolor);
  if (pickColorBtn) pickColorBtn.addEventListener("click", startEyedropper);
  if (recolorTol) recolorTol.addEventListener("input", (e) => { recolorTolVal.textContent = e.target.value; });
  canvas.addEventListener("click", handleCanvasPick);

  // Match a look (reference photo)
  if (styleRefBtn) styleRefBtn.addEventListener("click", () => styleRefInput.click());
  if (styleRefInput) styleRefInput.addEventListener("change", (e) => loadStyleRef(e.target.files[0]));
  if (styleStrength) styleStrength.addEventListener("input", (e) => { styleStrengthVal.textContent = e.target.value; });
  if (styleMatchBtn) styleMatchBtn.addEventListener("click", applyStyleMatch);

  // Prompt (works on the active mode's source)
  const runPrompt = (text) => {
    if (mode === "photo" && !sourceImage) { promptFeedback.textContent = "Load a photo first."; return; }
    if (mode === "video" && !sourceVideo) { promptFeedback.textContent = "Load a video first."; return; }
    promptFeedback.textContent = interpretPrompt(text);
  };
  $("applyPromptBtn").addEventListener("click", () => runPrompt(promptInput.value));
  promptInput.addEventListener("keydown", (e) => { if (e.key === "Enter") runPrompt(promptInput.value); });
  document.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      promptInput.value = chip.dataset.prompt;
      runPrompt(chip.dataset.prompt);
    });
  });

  // ---- Tabs ----
  if (tabsNav) {
    tabsNav.querySelectorAll(".tab").forEach((t) =>
      t.addEventListener("click", () => setMode(t.dataset.mode))
    );
  }

  // ---- Video mode ----
  if (videoBrowseBtn) videoBrowseBtn.addEventListener("click", () => videoInput.click());
  if (videoInput) videoInput.addEventListener("change", (e) => loadVideoFile(e.target.files[0]));
  if (videoDrop) {
    ["dragenter", "dragover"].forEach((evt) =>
      videoDrop.addEventListener(evt, (e) => { e.preventDefault(); videoDrop.classList.add("dragover"); })
    );
    ["dragleave", "drop"].forEach((evt) =>
      videoDrop.addEventListener(evt, (e) => { e.preventDefault(); videoDrop.classList.remove("dragover"); })
    );
    videoDrop.addEventListener("drop", (e) => { if (e.dataTransfer.files.length) loadVideoFile(e.dataTransfer.files[0]); });
  }
  if (playPauseBtn) playPauseBtn.addEventListener("click", togglePlay);
  if (trimStartEl) trimStartEl.addEventListener("input", (e) => {
    trimStart = Math.min(Number(e.target.value), trimEnd - 0.1);
    trimStartEl.value = trimStart;
    if (sourceVideo && sourceVideo.currentTime < trimStart) sourceVideo.currentTime = trimStart;
    updateTrimLabels();
  });
  if (trimEndEl) trimEndEl.addEventListener("input", (e) => {
    trimEnd = Math.max(Number(e.target.value), trimStart + 0.1);
    trimEndEl.value = trimEnd;
    updateTrimLabels();
  });
  if (exportVideoBtn) exportVideoBtn.addEventListener("click", exportVideo);
  if (saveVideoBtn) saveVideoBtn.addEventListener("click", () => { if (lastVideoBlob) saveOrShare(lastVideoBlob, "edited-video.webm", videoStatus); });
  if (resetVideoBtn) resetVideoBtn.addEventListener("click", () => {
    resetAll(false);
    if (sourceVideo) {
      trimStart = 0; trimEnd = sourceVideo.duration || 0;
      trimStartEl.value = 0; trimEndEl.value = trimEnd;
      updateTrimLabels();
    }
  });
  if (newVideoBtn) newVideoBtn.addEventListener("click", () => videoInput.click());

  // ---- Create mode ----
  if (createBrowseBtn) createBrowseBtn.addEventListener("click", () => createInput.click());
  if (createInput) createInput.addEventListener("change", (e) => addCreateFiles(e.target.files));
  if (createDrop) {
    ["dragenter", "dragover"].forEach((evt) =>
      createDrop.addEventListener(evt, (e) => { e.preventDefault(); createDrop.classList.add("dragover"); })
    );
    ["dragleave", "drop"].forEach((evt) =>
      createDrop.addEventListener(evt, (e) => { e.preventDefault(); createDrop.classList.remove("dragover"); })
    );
    createDrop.addEventListener("drop", (e) => { if (e.dataTransfer.files.length) addCreateFiles(e.dataTransfer.files); });
  }
  if (generateBtn) generateBtn.addEventListener("click", generateVideo);
  if (saveGenBtn) saveGenBtn.addEventListener("click", () => { if (lastGenBlob) saveOrShare(lastGenBlob, "generated-video.webm", genStatus); });
  if (clearGenBtn) clearGenBtn.addEventListener("click", clearCreate);

  // Text -> image / video generator (offline)
  if (makeImgBtn) makeImgBtn.addEventListener("click", () => generateArt(1, false));
  if (makeVidBtn) makeVidBtn.addEventListener("click", () => generateArt(4, true));
  if (artPrompt) artPrompt.addEventListener("keydown", (e) => { if (e.key === "Enter") generateArt(1, false); });
  if (effectSelect) effectSelect.addEventListener("change", () => startCreateLoop());
  if (resSelect) resSelect.addEventListener("change", () => startCreateLoop());
  if (perDuration) perDuration.addEventListener("input", (e) => {
    perDurationVal.textContent = `${Number(e.target.value).toFixed(1)}s`;
    startCreateLoop();
  });
  if (fadeEl) fadeEl.addEventListener("input", (e) => {
    fadeVal.textContent = Number(e.target.value) === 1 ? "On" : "Off";
  });

  // Music video (bring your own song)
  if (musicBtn) musicBtn.addEventListener("click", () => musicInput.click());
  if (musicInput) musicInput.addEventListener("change", (e) => loadSong(e.target.files[0]));
  if (beatReact) beatReact.addEventListener("input", (e) => { beatVal.textContent = Number(e.target.value) === 1 ? "On" : "Off"; });
  if (showBars) showBars.addEventListener("input", (e) => { barsVal.textContent = Number(e.target.value) === 1 ? "On" : "Off"; });
  if (danceMode) danceMode.addEventListener("input", (e) => {
    danceVal.textContent = Number(e.target.value) === 1 ? "On" : "Off";
    if (mode === "create" && createImages.length) startCreateLoop();
  });

  setMode("photo");
  syncControls();
}

document.addEventListener("DOMContentLoaded", init);
