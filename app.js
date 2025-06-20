require('dotenv').config();

const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const multer = require('multer');
const cron = require('node-cron');
const morgan = require('morgan');
const express = require('express');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const ffprobeInstaller = require('@ffprobe-installer/ffprobe');

const app = express();
const tmpDir = path.join(os.tmpdir(), 'temp-files');
if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir);

const maxAge = 3 * 60 * 60 * 1000;
const PORT = process.env.PORT || 3000;

ffmpeg.setFfmpegPath(ffmpegInstaller.path);
ffmpeg.setFfprobePath(ffprobeInstaller.path);

cron.schedule('*/30 * * * *', () => {
  fs.readdir(tmpDir, (err, files) => {
    if (err) return;
    files.forEach(file => {
      const filePath = path.join(tmpDir, file);
      fs.stat(filePath, (err, stats) => {
        if (err) return;
        if (Date.now() - stats.mtimeMs > maxAge) {
          fs.unlink(filePath, err => {
            if (!err) console.log('File expired & deleted (cron):', filePath);
          });
        }
      });
    });
  });
});

const upload = multer({
  storage: multer.diskStorage({
    destination: tmpDir,
    filename: (req, file, next) => {
      const ext = path.extname(file.originalname);
      const randomName = Math.random().toString(36).substring(2, 10) + ext;
      next(null, randomName);
    }
  }),
  limits: {
    fileSize: 200 * 1024 * 1024
  }
});

app.set('json spaces', 4);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));
app.use('/file', express.static(tmpDir));

app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({
    success: false,
    message: 'No file uploaded. Please use form-data with "file" field'
  });
  res.json({
    success: true,
    message: 'File uploaded successfully',
    originalname: req.file.originalname,
    filename: req.file.filename,
    size: req.file.size,
    url: `${req.protocol}://${req.get('host') || req.hostname}/file/${req.file.filename}`,
    mimetype: req.file.mimetype,
    expired: maxAge
  });
});

function createFFmpegEndpoint(from, to, options = [], format = to, ext = to) {
  app.post(`/${from}-to-${to}`, upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded. Please use form-data with "file" field' });
    const inputPath = req.file.path;
    const outputName = req.file.filename.replace(/\.[^.]+$/, '') + `.${ext}`;
    const outputPath = path.join(tmpDir, outputName);
    const command = ffmpeg(inputPath);

    if (options.length) command.outputOptions(...options);
    command.toFormat(format).save(outputPath)
      .on('end', () => {
        fs.unlink(inputPath, () => {});
        res.json({
          success: true,
          message: `Converted to ${to.toUpperCase()} successfully`,
          filename: outputName,
          size: req.file.size,
          mimetype: `${to.startsWith('mp') ? 'video' : to}/` + ext,
          url: `${req.protocol}://${req.get('host')}/file/${outputName}`,
          expired: maxAge
        });
      })
      .on('error', (err) => {
        console.log(err);
        res.status(500).json({
          success: false,
          message: `Failed to convert ${from.toUpperCase()} to ${to.toUpperCase()}`,
          error: err.message
        });
      });
  });
}

function createSharpEndpoint(from, to) {
  app.post(`/${from}-to-${to}`, upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded. Please use form-data with "file" field' });
    const inputPath = req.file.path;
    const outputName = req.file.filename.replace(/\.[^.]+$/, '') + `.${to}`;
    const outputPath = path.join(tmpDir, outputName);
    try {
      await sharp(inputPath)[to]().toFile(outputPath);
      fs.unlink(inputPath, () => {});
      res.json({
        success: true,
        message: `Converted to ${to.toUpperCase()} successfully`,
        filename: outputName,
        size: req.file.size,
        mimetype: `image/${to}`,
        url: `${req.protocol}://${req.get('host')}/file/${outputName}`,
        expired: maxAge
      });
    } catch (err) {
      console.log(err);
      res.status(500).json({
        success: false,
        message: `Failed to convert ${from.toUpperCase()} to ${to.toUpperCase()}`,
        error: err.message
      });
    }
  });
}

createSharpEndpoint('webp', 'png');
createSharpEndpoint('webp', 'jpg');
createSharpEndpoint('jpg', 'webp');
createSharpEndpoint('png', 'webp');

createFFmpegEndpoint('webp', 'gif');
createFFmpegEndpoint('webp', 'mp4', ['-movflags frag_keyframe+empty_moov'], 'mp4');
createFFmpegEndpoint('gif', 'mp4', ['-movflags frag_keyframe+empty_moov'], 'mp4');
createFFmpegEndpoint('mp4', 'mp3', [], 'mp3');
createFFmpegEndpoint('mp4', 'webp', [], 'webp');
createFFmpegEndpoint('webp', 'mp3', [], 'mp3');
createFFmpegEndpoint('webp', 'jpg', [], 'jpg');
createFFmpegEndpoint('jpg', 'mp4', [], 'mp4');

app.post('/video-to-image', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded. Please use form-data with "file" field' });
  const inputPath = req.file.path;
  const outputName = req.file.filename.replace(/\.[^.]+$/, '') + '.jpg';
  const outputPath = path.join(tmpDir, outputName);
  ffmpeg(inputPath)
    .screenshots({
      count: 1,
      filename: outputName,
      folder: tmpDir
    })
    .on('end', () => {
      fs.unlink(inputPath, () => {});
      res.json({
        success: true,
        message: 'Converted to IMAGE successfully',
        filename: outputName,
        size: req.file.size,
        mimetype: 'image/jpeg',
        url: `${req.protocol}://${req.get('host')}/file/${outputName}`,
        expired: maxAge
      });
    })
    .on('error', (err) => {
      console.log(err);
      res.status(500).json({ success: false, message: 'Failed to convert VIDEO to IMAGE', error: err.message });
    });
});

app.get('/', (req, res) => {
  res.json({ success: true, time: new Date().toISOString() });
});

app.get('*', (req, res) => {
  res.status(404).json({ success: false, time: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log('Server ready at http://localhost:' + PORT);
});