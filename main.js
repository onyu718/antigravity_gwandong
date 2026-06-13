const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, 'data');
const SETTINGS_PATH = path.join(DATA_DIR, 'settings.json');
const DATA_PATH = path.join(DATA_DIR, 'gwandong.json');

function ensureDataDirectory() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    title: '관동별곡 인터랙티브 학습 플랫폼',
    autoHideMenuBar: true
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  
  // Use DevTools if needed during testing
  // mainWindow.webContents.openDevTools();
}

app.whenReady().then(() => {
  ensureDataDirectory();
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

// IPC handler to read settings
ipcMain.handle('read-settings', () => {
  try {
    ensureDataDirectory();
    if (!fs.existsSync(SETTINGS_PATH)) {
      const defaultSettings = {
        kakao_api_key: '',
        last_location_id: '',
        completed_quizzes: []
      };
      fs.writeFileSync(SETTINGS_PATH, JSON.stringify(defaultSettings, null, 2), 'utf-8');
      return defaultSettings;
    }
    const data = fs.readFileSync(SETTINGS_PATH, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading settings:', error);
    return { kakao_api_key: '', last_location_id: '', completed_quizzes: [] };
  }
});

// IPC handler to write settings
ipcMain.handle('write-settings', (event, newSettings) => {
  try {
    ensureDataDirectory();
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(newSettings, null, 2), 'utf-8');
    return { success: true };
  } catch (error) {
    console.error('Error writing settings:', error);
    return { success: false, error: error.message };
  }
});

// IPC handler to read Gwandongbyeolgok data
ipcMain.handle('read-gwandong-data', () => {
  try {
    ensureDataDirectory();
    if (!fs.existsSync(DATA_PATH)) {
      return null; // Will trigger seed-data creation in renderer
    }
    const data = fs.readFileSync(DATA_PATH, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading gwandong data:', error);
    return null;
  }
});

// IPC handler to write Gwandongbyeolgok data (real-time synchronization)
ipcMain.handle('write-gwandong-data', (event, updatedData) => {
  try {
    ensureDataDirectory();
    fs.writeFileSync(DATA_PATH, JSON.stringify(updatedData, null, 2), 'utf-8');
    return { success: true };
  } catch (error) {
    console.error('Error writing gwandong data:', error);
    return { success: false, error: error.message };
  }
});
