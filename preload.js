const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  readSettings: () => ipcRenderer.invoke('read-settings'),
  writeSettings: (newSettings) => ipcRenderer.invoke('write-settings', newSettings),
  readGwandongData: () => ipcRenderer.invoke('read-gwandong-data'),
  writeGwandongData: (updatedData) => ipcRenderer.invoke('write-gwandong-data', updatedData)
});
