require('dotenv').config();

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const sharp = require('sharp');
const crypto = require('crypto');
const multer = require('multer');
const cron = require('node-cron');
const morgan = require('morgan');
const express = require('express');
const fetch = require('node-fetch');
const mime = require('mime-types');
const ffmpeg = require('fluent-ffmpeg');
const { generateFakeStory } = require('generator-fake');
const QuoteGenerator = require('qc-generator-whatsapp');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const ffprobeInstaller = require('@ffprobe-installer/ffprobe');
const { generateTTP, attpBlinkGenerate, attpGradientGenerate, attpWalkingGenerate } = require('attp-generator');
const { UltimateTextToImage, registerFont } = require('ultimate-text-to-image');

const app = express();
const tmpDir = path.join(os.tmpdir(), 'temp-files');
if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir);

registerFont(path.join(__dirname, 'fonts', 'AppleColorEmoji.ttf'), { family: 'AppleColorEmoji' });
registerFont(path.join(__dirname, 'fonts', 'NotoColorEmoji.ttf'), { family: 'NotoColorEmoji' });

function randomName(ext = '') {
	return path.join(tmpDir, `${crypto.randomBytes(6).readUIntLE(0, 6).toString(36)}${ext}`)
}

function delFile(file) {
	try {
		fs.unlinkSync(file)
	} catch {}
}

function ttp(text, font = 'AppleColorEmoji', color = '#ffffff', name = randomName('.png')) {
	new UltimateTextToImage(text, {
		width: 500,
		height: 500,
		fontColor: color,
		fontFamily: font,
		fontSize: 600,
		minFontSize: 10,
		lineHeight: 0,
		autoWrapLineHeightMultiplier: 1.2,
		margin: 0,
		align: 'center',
		valign: 'middle',
	})
	.render()
	.toFile(name);
	return name
}

async function attp(text, font) {
	let nome = randomName()
	let cores = ['#ff0000','#ffa600','#ffee00','#2bff00','#00ffea','#3700ff','#ff00ea']
	const lista = cores.map((cor, index) => {
		return ttp(text, font, cor, nome + index + '.png')
	});
	return new Promise(function (resolve, reject) {
		ffmpeg()
		.addInput((nome + '%d.png'))
		.addOutputOptions([
			'-vcodec', 'libwebp', '-vf',
			'scale=500:500:force_original_aspect_ratio=decrease,setsar=1, pad=500:500:-1:-1:color=white@0.0, split [a][b]; [a] palettegen=reserve_transparent=on:transparency_color=ffffff [p]; [b][p] paletteuse',
			'-loop', '0', '-preset', 'default'
		])
		.toFormat('webp')
		.on('end', () => {
			for (let img of lista) {
				delFile(img)
			}
			resolve(nome + '.webp')
		})
		.on('error', (err) => {
			for (let img of lista) {
				delFile(img)
			}
			reject(('erro ffmpeg ' + err))
		})
		.save((nome + '.webp'));
	});
}

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

app.all('/qc', async (req, res) => {
	const params = { ...req.query, ...req.body };
	if (Object.keys(params).length === 0) {
		return res.status(400).json({
			success: false,
			message: 'Params tidak boleh kosong'
		});
	}
	try {
		const result = await QuoteGenerator(params);
		res.set({
			'Content-Type': mime.lookup(result.image) || 'image/png',
			'Content-Length': result.image.length,
		});
		res.send(result.image);
	} catch (err) {
		res.status(500).json({ success: false, message: 'Failed to generate Qc image', error: err.message });
	}
});

app.get('/ttp', async (req, res) => {
	const text = req.query.text;
	const font = req.query.font;
	let fontFamily = 'NotoColorEmoji';
	if (font === 'iphone') fontFamily = 'AppleColorEmoji';
	if (!text) return res.status(400).json({ success: false, message: 'Missing ?text=' });
	try {
		const output = ttp(text, fontFamily);
		const buffer = fs.readFileSync(output);
		res.set({
			'Content-Type': mime.lookup(output) || 'image/png',
			'Content-Length': buffer.length,
		});
		res.send(buffer);
		fs.unlinkSync(output);
	} catch (err) {
		res.status(500).json({ success: false, message: 'Failed to generate TTP image', error: err.message });
	}
});

app.get('/ttp2', async (req, res) => {
	const text = req.query.text;
	if (!text) return res.status(400).json({ success: false, message: 'Missing ?text=' });
	try {
		const output = await generateTTP(text, { color: '#FF0000' }, 'Bangers');
		res.set({
			'Content-Type': mime.lookup(output) || 'image/png',
			'Content-Length': output.length,
		});
		res.send(output);
	} catch (err) {
		res.status(500).json({ success: false, message: 'Failed to generate TTP2 image', error: err.message });
	}
});

app.get('/attp', async (req, res) => {
	const text = req.query.text;
	const font = req.query.font;
	let fontFamily = 'NotoColorEmoji';
	if (font === 'iphone') fontFamily = 'AppleColorEmoji';
	if (!text) return res.status(400).json({ success: false, message: 'Missing ?text=' });
	try {
		const output = await attp(text, fontFamily);
		const buffer = fs.readFileSync(output);
		res.set({
			'Content-Type': 'image/webp',
			'Content-Length': buffer.length,
		});
		res.send(buffer);
		fs.unlinkSync(output);
	} catch (err) {
		res.status(500).json({ success: false, message: 'Failed to generate ATTP sticker', error: err.message });
	}
});

app.get('/attp2', async (req, res) => {
	const text = req.query.text;
	if (!text) return res.status(400).json({ success: false, message: 'Missing ?text=' });
	try {
		const output = await attpBlinkGenerate(text, 'Bangers');
		res.set({
			'Content-Type': mime.lookup(output) || 'image/png',
			'Content-Length': output.length,
		});
		res.send(output);
	} catch (err) {
		res.status(500).json({ success: false, message: 'Failed to generate ATTP2 image', error: err.message });
	}
});

app.get('/attp3', async (req, res) => {
	const text = req.query.text;
	if (!text) return res.status(400).json({ success: false, message: 'Missing ?text=' });
	try {
		const output = await attpGradientGenerate(text, 'SpicyRice', ['#FF0000', '#00FF00', '#0000FF']);
		res.set({
			'Content-Type': mime.lookup(output) || 'image/png',
			'Content-Length': output.length,
		});
		res.send(output);
	} catch (err) {
		res.status(500).json({ success: false, message: 'Failed to generate ATTP3 image', error: err.message });
	}
});

app.get('/attp4', async (req, res) => {
	const text = req.query.text;
	if (!text) return res.status(400).json({ success: false, message: 'Missing ?text=' });
	try {
		const output = await attpWalkingGenerate(text, 'SpicyRice');
		res.set({
			'Content-Type': mime.lookup(output) || 'image/png',
			'Content-Length': output.length,
		});
		res.send(output);
	} catch (err) {
		res.status(500).json({ success: false, message: 'Failed to generate ATTP4 image', error: err.message });
	}
});

app.get('/fake-story', async (req, res) => {
	const { username, caption, profile } = { ...req.query, ...req.body };
	if (!username || !caption || !profile) {
		return res.status(400).json({ success: false, message: 'Missing parameter username or caption or profile' });
	}
	
	try {
		const url = new URL(profile);
		const validExtensions = ['.jpg', '.jpeg', '.png', '.webp'];
		const lowerPath = url.pathname.toLowerCase();
		const isImage = validExtensions.some(ext => lowerPath.endsWith(ext));
		if (!isImage) {
			return res.status(400).json({
				success: false,
				message: 'Profile must be a valid image URL (jpg, png, gif, webp)'
			});
		}
	} catch (e) {
		return res.status(400).json({
			success: false,
			message: 'Profile must be a valid URL'
		});
	}
	
	try {
		const httpsAgent = new https.Agent({ rejectUnauthorized: true });
		const response = await fetch(profile, { agent: httpsAgent });
		const buffer = await response.buffer();
		const imageBuffer = await generateFakeStory({
			username, caption, profilePicBuffer: buffer
		});
		res.set({
			'Content-Type': 'image/webp',
			'Content-Length': imageBuffer.length,
		});
		res.send(imageBuffer);
	} catch (err) {
		res.status(500).json({ success: false, message: 'Failed to generate Fake Story', error: err.message });
	}
});

app.get('/fake-tweet', async (req, res) => {
	const { username, fullname, profile, comment } = { ...req.query, ...req.body };
	if (!username || !fullname || !profile || !comment) {
		return res.status(400).json({ success: false, message: 'Missing parameter username or fullname or comment or profile' });
	}
	
	try {
		const url = new URL(profile);
		const validExtensions = ['.jpg', '.jpeg', '.png', '.webp'];
		const lowerPath = url.pathname.toLowerCase();
		const isImage = validExtensions.some(ext => lowerPath.endsWith(ext));
		if (!isImage) {
			return res.status(400).json({
				success: false,
				message: 'Profile must be a valid image URL (jpg, png, gif, webp)'
			});
		}
	} catch (e) {
		return res.status(400).json({
			success: false,
			message: 'Profile must be a valid URL'
		});
	}
	
	try {
		const imageBuffer = await generateFakeStory({
			user: {
				username, displayName: fullname
			},
			verified: true,
			comment, avatarUrl: profile
			backgroundColor: '#15202b'
		});
		res.set({
			'Content-Type': 'image/webp',
			'Content-Length': imageBuffer.length,
		});
		res.send(imageBuffer);
	} catch (err) {
		res.status(500).json({ success: false, message: 'Failed to generate Fake Tweet', error: err.message });
	}
});

app.get('/', (req, res) => {
	res.json({ success: true, time: new Date().toISOString() });
});

app.use('*', (req, res) => {
	res.status(404).json({ success: false, time: new Date().toISOString() });
});

app.listen(PORT, () => {
	console.log('Server ready at http://localhost:' + PORT);
});
