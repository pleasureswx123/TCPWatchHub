const net = require('net');
const fetch = require('node-fetch');
const express = require('express');
const cors = require('cors');

const TCP_PORT = 8080;
const HTTP_PORT = 3000;
const API_BASE_URL = 'http://localhost:3000'; // API 服务器地址，根据实际情况修改

// 存储所有已连接的客户端，使用 deviceId 作为键
const clients = {
  // deviceId: { socket, clientId }
};

// 存储设备数据
const deviceData = {
  // deviceId: { heartRate: [], temperature: [], bloodPressure: [], lastUpdate: null }
};

// 临时存储未注册设备的映射关系
const tempClients = {
  // clientId: socket
};

let clientIdCounter = 1;

// 数据类型枚举
const DataTypes = {
  REGISTER: 'REG',     // 设备注册
  HEARTRATE: 'HR',     // 心率数据
  TEMPERATURE: 'TEMP', // 体温数据
  BLOODPRESSURE: 'BP', // 血压数据
  CMD: 'CMD'          // 命令
};

// 命令类型枚举
const CommandTypes = {
  GET_HEARTRATE: 'GET_HR',      // 获取心率
  GET_TEMPERATURE: 'GET_TEMP',   // 获取体温
  GET_BLOODPRESSURE: 'GET_BP',   // 获取血压
  SET_INTERVAL: 'SET_INTERVAL',  // 设置数据上报间隔
  RESTART: 'RESTART',           // 重启设备
  POWER_SAVE: 'POWER_SAVE'      // 省电模式
};

// 发送命令到设备
async function sendCommandToDevice(deviceId, commandType, params = {}) {
  if (!clients[deviceId]) {
    throw new Error(`设备 ${deviceId} 不在线`);
  }

  const command = `${DataTypes.CMD}|${commandType}|${JSON.stringify(params)}`;
  const socket = clients[deviceId].socket;

  return new Promise((resolve, reject) => {
    // 设置超时
    const timeout = setTimeout(() => {
      reject(new Error('命令执行超时'));
    }, 5000);

    // 等待设备响应
    const responseHandler = (data) => {
      const response = parseData(data);
      if (response && response.type === 'CMD_RESPONSE') {
        clearTimeout(timeout);
        socket.removeListener('data', responseHandler);
        resolve(response.value);
      }
    };

    socket.on('data', responseHandler);
    socket.write(command + '\n');
  });
}

// 设备控制接口
const deviceControl = {
  // 获取实时心率
  async getRealtimeHeartRate(deviceId) {
    try {
      const result = await sendCommandToDevice(deviceId, CommandTypes.GET_HEARTRATE);
      return result;
    } catch (error) {
      console.error(`获取心率失败:`, error);
      throw error;
    }
  },

  // 获取实时体温
  async getRealtimeTemperature(deviceId) {
    try {
      const result = await sendCommandToDevice(deviceId, CommandTypes.GET_TEMPERATURE);
      return result;
    } catch (error) {
      console.error(`获取体温失败:`, error);
      throw error;
    }
  },

  // 获取实时血压
  async getRealtimeBloodPressure(deviceId) {
    try {
      const result = await sendCommandToDevice(deviceId, CommandTypes.GET_BLOODPRESSURE);
      return result;
    } catch (error) {
      console.error(`获取血压失败:`, error);
      throw error;
    }
  },

  // 设置数据上报间隔（秒）
  async setDataInterval(deviceId, interval) {
    try {
      const result = await sendCommandToDevice(deviceId, CommandTypes.SET_INTERVAL, { interval });
      return result;
    } catch (error) {
      console.error(`设置上报间隔失败:`, error);
      throw error;
    }
  },

  // 重启设备
  async restartDevice(deviceId) {
    try {
      const result = await sendCommandToDevice(deviceId, CommandTypes.RESTART);
      return result;
    } catch (error) {
      console.error(`重启设备失败:`, error);
      throw error;
    }
  },

  // 设置省电模式
  async setPowerSaveMode(deviceId, enabled) {
    try {
      const result = await sendCommandToDevice(deviceId, CommandTypes.POWER_SAVE, { enabled });
      return result;
    } catch (error) {
      console.error(`设置省电模式失败:`, error);
      throw error;
    }
  }
};

// 发送数据到 API
async function sendDataToAPI(deviceId, type, data) {
  try {
    const response = await fetch(`${API_BASE_URL}/api/device/add`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        deviceId,
        type,
        data,
        timestamp: new Date().toISOString()
      })
    });

    if (!response.ok) {
      throw new Error(`API 请求失败: ${response.status}`);
    }

    const result = await response.json();
    console.log(`数据已发送到 API - 设备: ${deviceId}, 类型: ${type}`);
    return result;
  } catch (error) {
    console.error(`发送数据到 API 失败:`, error);
    // 这里可以添加重试逻辑
    return null;
  }
}

// 解析收到的数据
function parseData(data) {
  try {
    // 假设数据格式为：类型|设备ID|数据
    // 例如：HR|watch123|75 或 TEMP|watch123|36.5
    const [type, deviceId, value] = data.toString().trim().split('|');
    return { type, deviceId, value };
  } catch (err) {
    console.error('数据解析错误:', err);
    return null;
  }
}

// 存储设备数据
async function storeDeviceData(deviceId, type, value) {
  if (!deviceData[deviceId]) {
    deviceData[deviceId] = {
      heartRate: [],
      temperature: [],
      bloodPressure: [],
      lastUpdate: null
    };
  }

  const timestamp = new Date().toISOString();
  const data = { value, timestamp };

  // 存储到内存
  switch (type) {
    case DataTypes.HEARTRATE:
      deviceData[deviceId].heartRate.push(data);
      break;
    case DataTypes.TEMPERATURE:
      deviceData[deviceId].temperature.push(data);
      break;
    case DataTypes.BLOODPRESSURE:
      deviceData[deviceId].bloodPressure.push(data);
      break;
  }

  deviceData[deviceId].lastUpdate = timestamp;

  // 发送到 API
  await sendDataToAPI(deviceId, type, data);
}

const server = net.createServer((socket) => {
  const clientId = `client_${clientIdCounter++}`;
  tempClients[clientId] = socket;
  
  console.log(`客户端已连接，临时ID: ${clientId}`);

  socket.on('data', async (data) => {
    const parsedData = parseData(data);
    if (!parsedData) return;

    const { type, deviceId: receivedDeviceId, value } = parsedData;

    // 处理设备注册
    if (type === DataTypes.REGISTER) {
      // 如果设备已经注册且在线，拒绝新的注册
      if (clients[receivedDeviceId]) {
        socket.write(`设备 ${receivedDeviceId} 已在线，注册失败\n`);
        return;
      }

      // 从临时存储中移除
      delete tempClients[clientId];
      
      // 添加到已注册设备列表
      clients[receivedDeviceId] = {
        socket,
        clientId
      };

      // 发送注册信息到 API
      await sendDataToAPI(receivedDeviceId, 'REGISTER', { status: 'online' });

      console.log(`设备注册成功，设备ID: ${receivedDeviceId}`);
      socket.write(`注册成功: ${receivedDeviceId}\n`);
      return;
    }

    // 检查设备是否已注册
    if (!clients[receivedDeviceId]) {
      socket.write('请先注册设备\n');
      return;
    }

    // 存储数据
    await storeDeviceData(receivedDeviceId, type, value);
    console.log(`收到数据 - 设备: ${receivedDeviceId}, 类型: ${type}, 值: ${value}`);
    socket.write(`数据已记录: ${type}|${value}\n`);
  });

  socket.on('end', async () => {
    // 查找并移除设备连接
    const deviceId = Object.keys(clients).find(key => clients[key].clientId === clientId);
    if (deviceId) {
      console.log(`设备断开连接，设备ID: ${deviceId}`);
      // 发送离线状态到 API
      await sendDataToAPI(deviceId, 'STATUS', { status: 'offline' });
      delete clients[deviceId];
    } else {
      console.log(`未注册客户端断开连接，临时ID: ${clientId}`);
      delete tempClients[clientId];
    }
  });

  socket.on('error', async (err) => {
    const deviceId = Object.keys(clients).find(key => clients[key].clientId === clientId);
    console.error(`Socket 错误（${deviceId || clientId}）:`, err);
    
    if (deviceId) {
      // 发送错误状态到 API
      await sendDataToAPI(deviceId, 'ERROR', { error: err.message });
      delete clients[deviceId];
    } else {
      delete tempClients[clientId];
    }
  });
});

// 获取设备数据的API
function getDeviceData(deviceId) {
  return deviceData[deviceId] || null;
}

// 获取在线设备列表
function getOnlineDevices() {
  return Object.keys(clients);
}

// 获取指定设备的连接状态
function isDeviceOnline(deviceId) {
  return !!clients[deviceId];
}

server.on('error', (err) => {
  console.error('服务器错误:', err);
});

// 创建 HTTP 服务器
const app = express();
app.use(express.json());
app.use(cors());

// 获取实时心率
app.get('/api/device/:deviceId/heartrate', async (req, res) => {
    try {
        const { deviceId } = req.params;
        if (!isDeviceOnline(deviceId)) {
            return res.status(404).json({ error: '设备离线' });
        }
        const heartRate = await deviceControl.getRealtimeHeartRate(deviceId);
        res.json({ deviceId, heartRate });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 获取实时体温
app.get('/api/device/:deviceId/temperature', async (req, res) => {
    try {
        const { deviceId } = req.params;
        if (!isDeviceOnline(deviceId)) {
            return res.status(404).json({ error: '设备离线' });
        }
        const temperature = await deviceControl.getRealtimeTemperature(deviceId);
        res.json({ deviceId, temperature });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 获取实时血压
app.get('/api/device/:deviceId/bloodpressure', async (req, res) => {
    try {
        const { deviceId } = req.params;
        if (!isDeviceOnline(deviceId)) {
            return res.status(404).json({ error: '设备离线' });
        }
        const bloodPressure = await deviceControl.getRealtimeBloodPressure(deviceId);
        res.json({ deviceId, bloodPressure });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 设置数据上报间隔
app.post('/api/device/:deviceId/interval', async (req, res) => {
    try {
        const { deviceId } = req.params;
        const { interval } = req.body;
        if (!isDeviceOnline(deviceId)) {
            return res.status(404).json({ error: '设备离线' });
        }
        await deviceControl.setDataInterval(deviceId, interval);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 设置省电模式
app.post('/api/device/:deviceId/powersave', async (req, res) => {
    try {
        const { deviceId } = req.params;
        const { enabled } = req.body;
        if (!isDeviceOnline(deviceId)) {
            return res.status(404).json({ error: '设备离线' });
        }
        await deviceControl.setPowerSaveMode(deviceId, enabled);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 重启设备
app.post('/api/device/:deviceId/restart', async (req, res) => {
    try {
        const { deviceId } = req.params;
        if (!isDeviceOnline(deviceId)) {
            return res.status(404).json({ error: '设备离线' });
        }
        await deviceControl.restartDevice(deviceId);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 获取在线设备列表
app.get('/api/devices/online', (req, res) => {
    const onlineDevices = getOnlineDevices();
    res.json({ devices: onlineDevices });
});

// 修改 startServer 函数
function startServer() {
    // 启动 TCP 服务器
    const server = net.createServer(handleConnection);
    server.listen(TCP_PORT, () => {
        console.log(`TCP 服务器已启动，监听端口 ${TCP_PORT}`);
    });

    // 启动 HTTP 服务器
    app.listen(HTTP_PORT, () => {
        console.log(`HTTP 服务器已启动，监听端口 ${HTTP_PORT}`);
    });
}

module.exports = {
    startServer,
    deviceControl,
    getOnlineDevices,
    isDeviceOnline
};

// 如果是直接运行此文件（不是被其他文件引用），则启动服务器
if (require.main === module) {
    startServer();
} 