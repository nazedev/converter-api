# 🎛️ Converter API

**Converter API** is a simple and lightweight Node.js + Express-based REST API that allows you to upload and convert various media files (images, videos, audio) with endpoints powered by `ffmpeg` and `sharp`. 

Files are stored temporarily and automatically deleted after 3 hours.

---

## ✨ Features

- 🖼 Convert WebP to PNG
- 🌀 Convert WebP to GIF
- 🎞 Convert GIF to MP4
- 📸 Extract image from video
- 🔊 Extract audio (MP3) from video
- 📤 Upload files via `multipart/form-data`
- 📁 Serve temporary files via `/file/:filename`
- 🧹 Automatic file cleanup every 30 minutes (via cron)

---

## 📦 Requirements

- Node.js (LTS)
- ffmpeg (installed via Docker or manually)

---

## 🚀 Getting Started

### Clone & Install

```bash
git clone https://github.com/yourname/converter-api.git
cd converter-api
npm install
```

### Run
```bash
npm start
```

