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

const app = express()
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

app.set('json spaces', 4)
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(morgan('dev'));

app.use('/file', express.static(tmpDir))

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

app.post('/webp-to-png', upload.single('file'), async (req, res) => {
	if (!req.file) return res.status(400).json({
		success: false,
		message: 'No file uploaded. Please use form-data with "file" field'
	});
	const inputPath = req.file.path;
	const outputName = req.file.filename.replace(/\.[^.]+$/, '') + '.png';
	const outputPath = path.join(tmpDir, outputName);
	try {
		await sharp(inputPath).png().toFile(outputPath);
		fs.unlink(inputPath, () => {});
		res.json({
			success: true,
			message: 'Converted to PNG successfully',
			filename: outputName,
			mimetype: 'image/png',
			url: `${req.protocol}://${req.get('host')}/file/${outputName}`,
			expired: maxAge
		});
	} catch (err) {
		res.status(500).json({
			success: false,
			message: 'Failed to convert WEBP to PNG',
			error: err.message
		});
	}
});

app.post('/webp-to-gif', upload.single('file'), async (req, res) => {
	if (!req.file) return res.status(400).json({
		success: false,
		message: 'No file uploaded. Please use form-data with "file" field'
	});
	const inputPath = req.file.path;
	const outputName = req.file.filename.replace(/\.[^.]+$/, '') + '.gif';
	const outputPath = path.join(tmpDir, outputName);
	ffmpeg(inputPath)
	.output(outputPath)
	.on('end', () => {
		fs.unlink(inputPath, () => {});
		res.json({
			success: true,
			message: 'Converted to GIF successfully',
			filename: outputName,
			mimetype: 'image/gif',
			url: `${req.protocol}://${req.get('host')}/file/${outputName}`,
			expired: maxAge
		});
	})
	.on('error', (err) => {
		res.status(500).json({
			success: false,
			message: 'Failed to convert WEBP to GIF',
			error: err.message
		});
	})
	.run();
});

app.post('/gif-to-video', upload.single('file'), async (req, res) => {
	if (!req.file) return res.status(400).json({
		success: false,
		message: 'No file uploaded. Please use form-data with "file" field'
	});
	const inputPath = req.file.path;
	const outputName = req.file.filename.replace(/\.[^.]+$/, '') + '.mp4';
	const outputPath = path.join(tmpDir, outputName);
	ffmpeg(inputPath)
	.outputOptions('-movflags frag_keyframe+empty_moov')
	.toFormat('mp4')
	.save(outputPath)
	.on('end', () => {
		fs.unlink(inputPath, () => {});
		res.json({
			success: true,
			message: 'Converted to VIDEO successfully',
			filename: outputName,
			mimetype: 'video/mp4',
			url: `${req.protocol}://${req.get('host')}/file/${outputName}`,
			expired: maxAge
		});
	})
	.on('error', (err) => {
		res.status(500).json({
			success: false,
			message: 'Failed to convert GIF to VIDEO',
			error: err.message
		});
	})
	.run();
});

app.post('/video-to-image', upload.single('file'), async (req, res) => {
	if (!req.file) return res.status(400).json({
		success: false,
		message: 'No file uploaded. Please use form-data with "file" field'
	});
	const inputPath = req.file.path;
	const outputName = req.file.filename.replace(/\.[^.]+$/, '') + '.jpg';
	const outputPath = path.join(tmpDir, outputName);
	ffmpeg(inputPath)
	.screenshots({
		count: 1,
		filename: outputName,
		folder: tmpDir,
	})
	.on('end', () => {
		fs.unlink(inputPath, () => {});
		res.json({
			success: true,
			message: 'Converted to IMAGE successfully',
			filename: outputName,
			mimetype: 'image/jpeg',
			url: `${req.protocol}://${req.get('host')}/file/${outputName}`,
			expired: maxAge
		});
	})
	.on('error', (err) => {
		res.status(500).json({
			success: false,
			message: 'Failed to convert VIDEO to IMAGE',
			error: err.message
		});
	})
	.run();
});

app.post('/video-to-audio', upload.single('file'), async (req, res) => {
	if (!req.file) return res.status(400).json({
		success: false,
		message: 'No file uploaded. Please use form-data with "file" field'
	});
	const inputPath = req.file.path;
	const outputName = req.file.filename.replace(/\.[^.]+$/, '') + '.mp3';
	const outputPath = path.join(tmpDir, outputName);
	ffmpeg(inputPath)
	.toFormat('mp3')
	.save(outputPath)
	.on('end', () => {
		fs.unlink(inputPath, () => {});
		res.json({
			success: true,
			message: 'Converted to AUDIO successfully',
			filename: outputName,
			mimetype: 'audio/mp3',
			url: `${req.protocol}://${req.get('host')}/file/${outputName}`,
			expired: maxAge
		});
	})
	.on('error', (err) => {
		res.status(500).json({
			success: false,
			message: 'Failed to convert VIDEO to AUDIO',
			error: err.message
		});
	})
	.run();
});

app.get('*', (req, res) => {
	res.json({ success: true, time: new Date().toISOString() });
});

app.listen(PORT, () => {
	console.log('Server ready at http://localhost:3000');
});