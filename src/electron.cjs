const windowStateManager = require('electron-window-state');
const contextMenu = require('electron-context-menu');
const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const {
	SlpParser,
	DolphinConnection,
	Ports,
	ConnectionEvent,
	ConnectionStatus,
	DolphinMessageType,
	Command,
	SlpParserEvent,
	SlpStream,
	SlpStreamEvent,
	SlippiGame,
	GameMode,
} = require('@slippi/slippi-js');
const serve = require('electron-serve');
const path = require('path');
const log = require('electron-log');
const fs = require('fs');

try {
	const os = require('os');

	const isMac = os.platform() === 'darwin';
	const isWindows = os.platform() === 'win32';
	const isLinux = os.platform() === 'linux';

	let gameStartTimeout;
	let gameEndTimeout;
	let returnHomeTimeout;

	if (isWindows && !fs.existsSync(path.join(`C:slippi-stats-display-logs`))) {
		fs.mkdirSync(path.join(`C:/slippi-stats-display-logs`), { recursive: true });
	}

	log.transports.file.resolvePath = () => path.join(`C:/slippi-stats-display-logs/main.logs`);

	log.info('start');

	//const { autoUpdater } = require('electron-github-autoupdater');
	const { autoUpdater } = require('electron-updater');

	autoUpdater.autoInstallOnAppQuit = true;

	try {
		require('electron-reloader')(module);
	} catch (e) {
		console.error(e);
	}

	const serveURL = serve({ directory: '.' });
	const port = process.env.PORT || 5173;
	const dev = !app.isPackaged;

	if (dev) require('dotenv').config();

	const MIN_WIDTH = 520;
	const MIN_HEIGHT = 380;

	const MAX_WIDTH = 600;

	const OBSWebSocket = require('obs-websocket-js').default;

	const obs = new OBSWebSocket();

	var dolphinConnection = new DolphinConnection();
	var parser = new SlpParser();
	var slpStream = new SlpStream();

	let gameDirectory = '';

	slpStream.on(SlpStreamEvent.COMMAND, (event) => {
		parser.handleCommand(event.command, event.payload);
		if (event.command == 54) {
			mainWindow.webContents.send(
				'game-start',
				parser.getSettings()?.players[0].connectCode,
				parser.getSettings()?.players[1].connectCode,
				parser.getSettings()
			);
		}
	});

	parser.on(SlpParserEvent.END, (frameEntry) => {
		// console.log(frameEntry.players[1].post.positionY);
		const slippiFiles = GetGameFiles();
		if (!slippiFiles.length) return;
		setTimeout(() => {
			let stats = GetRecentGameStats(slippiFiles);
			mainWindow.webContents.send('game-end', frameEntry, stats, parser.getSettings());
		}, 500);
	});

	dolphinConnection.on(ConnectionEvent.STATUS_CHANGE, (status) => {
		// Disconnect from Slippi server when we disconnect from Dolphin
		if (status === ConnectionStatus.DISCONNECTED) {
			mainWindow.webContents.send('disconnected-event', 'disconnected');
			dolphinConnection.connect('127.0.0.1', Ports.DEFAULT);
		}
		if (status === ConnectionStatus.CONNECTED) {
			mainWindow.webContents.send('connected-event', 'connected');
		}
		if (status === ConnectionStatus.CONNECTING) {
			mainWindow.webContents.send('connecting-event', 'connecting');
		}
	});

	dolphinConnection.on(ConnectionEvent.MESSAGE, (message) => {
		switch (message.type) {
			case DolphinMessageType.CONNECT_REPLY:
				console.log('Connected: ' + message);
				break;
			case DolphinMessageType.GAME_EVENT:
				var decoded = Buffer.from(message.payload, 'base64');
				slpStream.write(decoded);
				break;
		}
	});

	dolphinConnection.on(ConnectionEvent.ERROR, (err) => {
		// Log the error messages we get from Dolphin
		console.log('Dolphin connection error', err);
	});

	dolphinConnection.on(ConnectionEvent.ERROR, (err) => {
		// Log the error messages we get from Dolphin
		console.log('Dolphin connection error', err);
	});

	let mainWindow;

	function createWindow() {
		let windowState = windowStateManager({
			defaultWidth: MIN_WIDTH,
			defaultHeight: 620
		});

		const mainWindow = new BrowserWindow({
			backgroundColor: 'whitesmoke',
			titleBarStyle: 'hidden',
			autoHideMenuBar: true,
			trafficLightPosition: {
				x: 20,
				y: 20
			},
			minHeight: MIN_HEIGHT,
			minWidth: MIN_WIDTH,
			maxWidth: MAX_WIDTH,
			webPreferences: {
				enableRemoteModule: true,
				contextIsolation: true,
				nodeIntegration: true,
				spellcheck: false,
				devTools: true,
				preload: path.join(__dirname, 'preload.cjs')
			},
			x: windowState.x,
			y: windowState.y,
			width: windowState.width,
			height: windowState.height,
			icon: path.join(__dirname, '/static/icon.png')
		});

		windowState.manage(mainWindow);

		mainWindow.once('ready-to-show', () => {
			mainWindow.show();
			mainWindow.focus();
		});

		mainWindow.on('close', () => {
			windowState.saveState(mainWindow);
		});

		return mainWindow;
	}

	contextMenu({
		showLookUpSelection: false,
		showSearchWithGoogle: false,
		showCopyImage: false,
		showSelectAll: false,
		prepend: (defaultActions, params, browserWindow) => [
			{
				label: 'Reset score',
				click: () => {
					mainWindow.webContents.send('reset-score');
				}
			},
			{
				label: 'Player1 score +1',
				click: () => {
					mainWindow.webContents.send('increase-player1-score');
				}
			},
			{
				label: 'Player1 score -1',
				click: () => {
					mainWindow.webContents.send('decrease-player1-score');
				}
			},
			{
				label: 'Player2 score +1',
				click: () => {
					mainWindow.webContents.send('increase-player2-score');
				}
			},
			{
				label: 'Player2 score -1',
				click: () => {
					mainWindow.webContents.send('decrease-player2-score');
				}
			},
			{
				label: 'Settings menu',
				click: () => {
					mainWindow.webContents.send('return-home');
					clearTimeout(gameStartTimeout);
					clearTimeout(gameEndTimeout);
					clearTimeout(returnHomeTimeout);
				}
			}
		]
	});

	function loadVite(port) {
		mainWindow.loadURL(`http://localhost:${port}`).catch((e) => {
			console.log('Error loading URL, retrying', e);
			setTimeout(() => {
				loadVite(port);
			}, 200);
		});
	}

	function createMainWindow() {
		mainWindow = createWindow();
		mainWindow.once('close', () => {
			mainWindow = null;
		});

		mainWindow.webContents.once('dom-ready', () => {
			// Make the disconnected label appear first
			mainWindow.webContents.send('disconnected-event', 'disconnected');
			if (dolphinConnection.getStatus() === ConnectionStatus.DISCONNECTED) {
				// Now try connect to our local Dolphin instance
				dolphinConnection.connect('127.0.0.1', Ports.DEFAULT);
			}
		});

		if (dev) loadVite(port);
		else serveURL(mainWindow);
	}

	app.once('ready', async function () {
		if (!dev) {
			const exeName = path.basename(process.execPath);

			log.info(exeName);
		}

		createMainWindow();
	});
	app.on('activate', () => {
		if (!mainWindow) {
			createMainWindow();
		}
	});
	app.on('window-all-closed', () => {
		if (process.platform !== 'darwin') app.quit();
	});

	ipcMain.handle('update:check', async () => {
		if (dev) return;
		mainWindow.webContents.send('version', autoUpdater.currentVersion.version);
		log.info('current version', autoUpdater.currentVersion);
		autoUpdater
			.checkForUpdates()
			.then((data) => log.info('update', data))
			.catch((err) => log.error(err));
	});

	ipcMain.handle('update:download', async () => {
		log.info('Downloading..');
		autoUpdater
			.downloadUpdate()
			.then((data) => log.info(data))
			.catch((err) => log.error(err));
	});

	ipcMain.handle('update:install', async () => {
		log.info('Installing..');
		autoUpdater.quitAndInstall();
	});

	ipcMain.handle('external:url', async (_, url) => {
		log.info('external', url);
		const open = require('open');
		open(url);
	});

	autoUpdater.on('checking-for-update', () => {
		log.info('Checking for update');
		mainWindow.webContents.send('update-status', `Checking for update`);
	});

	autoUpdater.on('update-not-available', () => {
		log.info('update not available');
		mainWindow.webContents.send('update-status', `No update available`);
	});

	autoUpdater.on('update-available', (data) => {
		log.info(`update available: ${data.version}`);
		mainWindow.webContents.send('version', data.version);
		mainWindow.webContents.send('update-status', `Download`);
	});

	autoUpdater.on('update-downloaded', (data) => {
		log.info(`Download complete: ${data.version}`);
		log.info(
			`Download url: https://github.com/slprank/slpRank-app/releases/download/${data.releaseName}/${data.files[0].url}`
		); //
		setTimeout(() => {
			mainWindow.webContents.send('update-status', `Install`);
			mainWindow.webContents.send(
				'download-url',
				`https://github.com/slprank/slpRank-app/releases/download/${data.releaseName}/${data.files[0].url}`
			);
		}, 1000);
	});

	autoUpdater.on('download-progress', (data) => {
		log.info(`Downloading: ${data.percent.toFixed()}`);
		mainWindow.webContents.send('update-status', `Downloading: ${data.percent.toFixed()}%`);
	});

	ipcMain.on('to-main', (event, count) => {
		return mainWindow.webContents.send('from-main', `next count is ${count + 1}`);
	});

	ipcMain.handle('dialog:openDirectory', async () => {
		const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
			properties: ['openDirectory']
		});
		if (canceled) return;

		return filePaths[0];
	});

	ipcMain.handle('dialog:openFile', async () => {
		let base64 = 'data:audio/x-wav;base64, ';

		const { filePaths, canceled } = await dialog.showOpenDialog(mainWindow, {
			properties: ['openFile']
		});

		if (canceled) return;

		let file = await fs.promises.readFile(filePaths[0], { encoding: 'base64' });

		return base64 + file;
	});

	ipcMain.handle('get-file', async (_, destination, filename) => {

		const file = path.join(__dirname, destination, filename);

		console.log(file);

		if (!fs.existsSync(file)) return '';

		return `data:audio/x-wav;base64, ${fs.readFileSync(file, { encoding: 'base64' })}`;
	});

	ipcMain.handle('obs:switch', async (_, scene) => {
		if (!scene) return;
		try {
			await obs.connect('ws://127.0.0.1:4455');
			await obs.call('SetCurrentProgramScene', { sceneName: scene });
		} catch (error) {
			log.info(error);
		}
	});

	ipcMain.on('ipc', (event, arg) => {
		// Command to connect to Dolphin
		if (arg === 'connectDolphin') {
			if (dolphinConnection.getStatus() === ConnectionStatus.DISCONNECTED) {
				// Now try connect to our local Dolphin instance
				dolphinConnection.connect('127.0.0.1', Ports.DEFAULT);
			}
		}
	});

	// Not finished
	ipcMain.handle('init-game', async (_, dir, connectCode) => {
		gameDirectory = dir;
		currentPlayerConnectCode = connectCode;
		mainWindow.webContents.send('init-stats');

		GetPreviousOpponents()
			.then(previousOpponents => {
				mainWindow.webContents.send('previous-opponents', previousOpponents);
			})
			.catch(err => console.error(err));

	});

	ipcMain.handle('dolphin/status', async (_, dir) => {
		const status = dolphinConnection.getStatus();
		if (status === ConnectionStatus.DISCONNECTED) {
			mainWindow.webContents.send('disconnected-event', 'disconnected');
		}
		if (status === ConnectionStatus.CONNECTED) {
			mainWindow.webContents.send('connected-event', 'connected');
		}
		if (status === ConnectionStatus.CONNECTING) {
			mainWindow.webContents.send('connecting-event', 'connecting');
		}
	});

	function GetGameFiles() {
		const re = new RegExp('^Game_.*.slp$');

		let files = fs.readdirSync(gameDirectory).map((filename) => `${path.parse(filename).name}.slp`);

		files = files.filter((f) => re.test(f))
			.map((f) => path.format({
				dir: gameDirectory,
				base: path.basename(f),
			}));
		return files.sort((a, b) => a.length - b.length);
	}

	function GetRecentGameStats(files) {
		const game = new SlippiGame(files[files.length - 1]);

		return game.getStats();
	}

	async function GetPreviousOpponents() {

		let files = GetGameFiles();
		if (!files.length) return;
		files.sort((a, b) => {
			if (a < b) return 1;
			if (a > b) return -1;
			return 0;
		});

		const limitCountFiles = files.slice(0, 25);

		const previousOpponentsByConnectCode = {};

		for (const file of limitCountFiles) {

			const game = new SlippiGame(file);
			const settings = game.getSettings();
			if (settings.gameMode !== GameMode.ONLINE) continue;

			const metadata = game.getMetadata();

			const players = Object.entries(metadata.players)
				.map(([playerIndex, player]) => ({
					playerIndex: parseInt(playerIndex),
					characters: player.characters,
					dateStarted: metadata.startAt,
					...player.names,
				}));

			const userPlayer = players.find(p => p.code === currentPlayerConnectCode);
			if (!userPlayer) continue;

			const opponents = players.filter(p => p.code !== currentPlayerConnectCode);

			const winnersPlayerIndexes = game.getWinners().map(winner => winner.playerIndex);
			const didUserWin = winnersPlayerIndexes.includes(userPlayer.playerIndex);

			for (const opponent of opponents) {
				if (previousOpponentsByConnectCode[opponent.code]) continue;

				previousOpponentsByConnectCode[opponent.code] = {
					...opponent,
					name: opponent.netplay,
					connectCode: opponent.code,
					didUserWin,
				};
			}

			if (Object.keys(previousOpponentsByConnectCode).length >= 3) break;
		}

		return Object.values(previousOpponentsByConnectCode);
	}

	async function RunTests() {
		mainWindow.webContents.send('is-test');
		let files = GetGameFiles();
		let file = files.filter(
			(file) => new SlippiGame(file).getSettings()?.gameMode === GameMode.ONLINE
		)[Math.floor(Math.random() * files.length)];
		const game = new SlippiGame(file);
		gameStartTimeout = setTimeout(() => {
			mainWindow.webContents.send(
				'game-start',
				game.getSettings()?.players[0].connectCode,
				game.getSettings()?.players[1].connectCode,
				game.getSettings()
			);
			gameEndTimeout = setTimeout(() => {
				let stats = GetRecentGameStats([file]);
				mainWindow.webContents.send('game-end', game.getGameEnd(), stats);
				returnHomeTimeout = setTimeout(() => mainWindow.webContents.send('return-home'), 30000);
			}, 8000);
		}, 2000);
	}

	ipcMain.handle('run:tests', async () => {
		RunTests();
	});
} catch (err) {
	log.error(err);
}
