# 🎬 Prompt Photo & Video Studio

A lightweight, **100% in-browser** photo **and video** studio. Edit photos or
videos with sliders or plain-English **prompts** like `warm sunset`, `vintage`,
or `black and white`, and **generate videos** from your photos (Ken Burns
slideshows). Save straight to your phone via the share sheet. Nothing is
uploaded anywhere — all processing happens locally using the Canvas 2D API,
CSS filters, and `MediaRecorder`. No API keys, no internet needed.

## How to run

Just open `index.html` in any modern browser (double-click it), or serve the
folder:

```powershell
# Optional: run a tiny local server
python -m http.server 5500
# then open http://localhost:5500
```

## Three modes (tabs at the top)

### 🖼️ Photo
- **Prompt editing** — type natural language and the app maps it to edits:
  - Looks: `vintage`, `warm sunset`, `black and white`, `noir`, `cool tone`,
    `warm tone`, `dramatic`, `vivid`, `faded`, `dreamy`, `matte`, `invert`
  - Adjustments: `brighten`, `darken`, `sharpen`, `blur`, `more color`,
    `desaturate`, `add sepia`
  - Transform: `rotate left`, `rotate right`, `flip horizontal`, `mirror`
- **Manual sliders** — brightness, contrast, saturation, grayscale, sepia,
  hue rotate, blur, invert.
- **Save / Share** — opens your phone's share sheet to save to Photos/Files
  (falls back to a normal download on desktop). Or **Download** as PNG.

### 🎞️ Video
- Load a clip (MP4/WEBM/MOV) and apply the **same filters + transforms** live.
- **Trim** with start/end sliders and preview playback loops within the range.
- **Export clip** re-encodes to WebM (audio included when available) and opens
  **Save / Share**.

### ✨ Create Video
- Drop **one or many photos** to build an animated clip / slideshow.
- Or **generate from text (offline)** — type a scene (`sunset over the ocean`,
  `purple night sky with stars and moon`, `city skyline at night`,
  `green forest with mountains`, `fire and lava`, `rainbow`, or any colors) and
  the app **paints an image from your words** with no internet or keys. Use
  **🎨 Image** to add one scene, or **🎬 Make full video from text** to paint
  several scenes and render a video automatically.
- Effects: **Ken Burns**, zoom in, zoom out, pan L→R, or still.
- Choose seconds-per-photo, output size (720p/1080p/portrait/square) and an
  optional crossfade. Filters from the prompt/sliders are baked in.
- **Generate video** renders to WebM and opens **Save / Share**.

> **About "AI" generation:** True photorealistic text→image / text→video (like
> ChatGPT, DALL·E or Sora) runs on paid cloud AI models and needs an API key —
> it cannot run offline in a browser. To stay 100% offline and free, the text
> generator here paints **colorful procedural art** from your keywords, not
> photographs. If you later want real generative AI, an online mode using an
> OpenAI/Stability/Replicate key (ideally via a small backend proxy so the key
> stays secret) can be added.

## Saving to your phone

The **Save / Share** buttons use the **Web Share API** (`navigator.share` with
files). On a phone this opens the native share sheet so you can pick
*Save to Photos* / *Files*. On browsers without file-share support it falls
back to a normal download. Note: sharing files requires a **secure context**
(`https://` or `localhost`), so host the folder over HTTPS for mobile use.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Tabbed UI: photo / video / create stages and controls |
| `styles.css` | Dark UI styling (tabs, video controls, thumbnails, progress) |
| `app.js` | Editing logic, prompt interpreter, video + generator modules |

## Notes

You chose "local editing only" (no AI API key). The prompt box uses a built-in
keyword interpreter — no external AI service is called. Video export/generation
uses the browser's `MediaRecorder`, producing **WebM**. Keep the tab focused
while exporting (canvas capture pauses on backgrounded tabs). If you later get
an OpenAI or Stability key and want true generative edits (e.g. "add a hat"),
that can be added as an optional online mode.
