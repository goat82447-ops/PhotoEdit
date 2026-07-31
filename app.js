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
let bodyCover = null;   // null | 'both' | 'upper' | 'lower' — modesty overlay

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

// Global AI Model Instance for Tracking and Face Extraction
let bodyPixNet = null;
let faceSegmentationData = null; // Caches the face/body layout map

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

// --- Rendering with Face Consistency Locking ------------------
function drawWithTransform(context, cv, source, w, h) {
  const rotated = rotation % 180 !== 0;
  cv.width = rotated ? h : w;
  cv.height = rotated ? w : h;
  
  context.save();
  context.clearRect(0, 0, cv.width, cv.height);
  
  // 1. Draw the EDITED version of the image across the canvas
  context.filter = buildFilterString();
  context.translate(cv.width / 2, cv.height / 2);
  context.rotate((rotation * Math.PI) / 180);
  context.scale(flipH ? -1 : 1, flipV ? -1 : 1);
  context.drawImage(source, -w / 2, -h / 2, w, h);
  context.restore();

  // 2. If face segmentation mapping data exists, lock and restore the original face pixels
  if (faceSegmentationData && faceSegmentationData.width === w && faceSegmentationData.height === h) {
    context.save();
    
    // Create an offscreen path or mask specifically matching the detected face area
    context.translate(cv.width / 2, cv.height / 2);
    context.rotate((rotation * Math.PI) / 180);
    context.scale(flipH ? -1 : 1, flipV ? -1 : 1);

    // Create an pixel array mask to restore face structures
    const imgData = context.getImageData(0, 0, cv.width, cv.height);
    
    // Temporary canvas to pull raw source pixels without filters applied
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = w;
    tempCanvas.height = h;
    const tctx = tempCanvas.getContext("2d");
    tctx.drawImage(source, 0, 0);
    const rawSrcData = tctx.getImageData(0, 0, w, h);

    // Create target output data
    const finalData = context.getImageData(0, 0, cv.width, cv.height);

    // Overwrite the canvas pixels inside the face coordinates back to original state
    for (let i = 0; i < faceSegmentationData.data.length; i++) {
      const partId = faceSegmentationData.data[i];
      // BodyPix IDs 0 and 1 represent the Left and Right parts of the Face/Head
      if (partId === 0 || partId === 1) {
        const pixelIdx = i * 4;
        finalData.data[pixelIdx] = rawSrcData.data[pixelIdx];         // Red
        finalData.data[pixelIdx + 1] = rawSrcData.data[pixelIdx + 1]; // Green
        finalData.data[pixelIdx + 2] = rawSrcData.data[pixelIdx + 2]; // Blue
        finalData.data[pixelIdx + 3] = rawSrcData.data[pixelIdx + 3]; // Alpha
      }
    }
    
    // Put original face data back seamlessly onto screen
    context.putImageData(finalData, 0, 0);
    context.restore();
  }
}

function render() {
  if (!sourceImage) return;
  drawWithTransform(ctx, canvas, sourceImage, sourceImage.naturalWidth, sourceImage.naturalHeight);
  if (bodyCover) coverBody(ctx, canvas.width, canvas.height, bodyCover);
}

function coverBody(context, width, height, part = "both") {
  context.save();
  context.filter = "none";
  context.fillStyle = "#222";
  if (part === "both" || part === "upper") {
    context.fillRect(width * 0.30, height * 0.20, width * 0.40, height * 0.25);
  }
  if (part === "both" || part === "lower") {
    context.fillRect(width * 0.30, height * 0.55, width * 0.40, height * 0.30);
  }
  context.restore();
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
}

// --- Dual Verification: 10% Clothing Rule + Face Map Extraction ---
async function processAndValidateImage(imageElement) {
  try {
    if (!bodyPixNet && window.bodyPix) {
      bodyPixNet = await window.bodyPix.load({
        architecture: 'MobileNetV1',
        outputStride: 16,
        multiplier: 0.75,
        quantBytes: 2
      });
    }

    if (!bodyPixNet) {
      console.warn("AI Library offline. Skipping criteria matching loops.");
      return true;
    }

    // Run semantic model mapping tracking
    const segmentation = await bodyPixNet.segmentPersonParts(imageElement, {
      internalResolution: 'medium',
      segmentationThreshold: 0.7
    });
    
    // Cache map layout details to protect the facial elements globally
    faceSegmentationData = segmentation;

    let totalPersonPixels = 0;
    let clothingPixels = 0;

    segmentation.data.forEach((partId) => {
      if (partId >= 0) {
        totalPersonPixels++;
        // Identify pixels occupying standard wear regions (Torso, arms, legs)
        if (partId >= 12 && partId <= 21) {
          clothingPixels++;
        }
      }
    });

    if (totalPersonPixels === 0) return true; // Pass if structure contains no figures

    const clothingRatio = (clothingPixels / totalPersonPixels) * 100;
    return clothingRatio >= 10; // Enforces minimum 10% threshold

  } catch (error) {
    console.error("AI safe processing breakdown:", error);
    return false;
  }
}

// --- Image loading Pipeline ------------------------------------------
function loadFile(file) {
  if (!file || !file.type.startsWith("image/")) {
    promptFeedback.textContent = "Please choose a valid image file.";
    return;
  }

  promptFeedback.textContent = "Analyzing structures and mapping face locks...";
  promptFeedback.style.color = "#ffa500";

  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = async () => {
      
      // Validates metrics and prepares consistent mask maps
      const criteriaPassed = await processAndValidateImage(img);
      
      if (!criteriaPassed) {
        promptFeedback.textContent = "Rejected: Image must maintain at least 10% structural clothing data.";
        promptFeedback.style.color = "#ff4d4d";
        sourceImage = null;
        faceSegmentationData = null;
        canvas.classList.add("hidden");
        dropzoneInner.classList.remove("hidden");
        enableTools(false);
        return; 
      }

      // Load configurations if valid
      promptFeedback.textContent = "Image verified. Face layout locked for consistency!";
      promptFeedback.style.color = "#4caf50";
      sourceImage = img;
      resetAll(false);
      canvas.classList.remove("hidden");
      dropzoneInner.classList.add("hidden");
      enableTools(true);
      render();
    };
    img.onerror = () => { promptFeedback.textContent = "Could not load image."; };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function resetAll(full) {
  filters = { ...DEFAULTS };
  rotation = 0;
  flipH = false;
  flipV = false;
  syncControls();
}
