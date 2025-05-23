const net = require('net');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const writeFile = promisify(fs.writeFile);

// 配置参数
const TCP_PORT = 3000;
const WS_PORT = 8080;
const HEARTBEAT_TIMEOUT = 35000; // 35秒，比客户端的30秒多5秒
const RECONNECT_TIMEOUT = 60000; // 60秒重连超时
const MAX_PACKET_SIZE = 1024 * 1024; // 1MB
const STATE_DIR = path.join(__dirname, 'state');
const AUDIO_DIR = path.join(__dirname, 'audio');

// 确保目录存在
[STATE_DIR, AUDIO_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

class DeviceConnection {
    constructor(socket, id) {
        this.socket = socket;
        this.id = id;
        this.lastHeartbeat = Date.now();
        this.sequence = 0;
        this.buffer = Buffer.alloc(0);
        this.isProcessingPacket = false;
        this.pendingAcks = new Map();
        this.reconnectTimer = null;
        this.heartbeatTimer = null;
        this.audioBuffer = [];
        this.isAuthenticated = false;
        
        this.loadState();
        this.setupSocket();
        this.startHeartbeatCheck();
    }
    
    async loadState() {
        try {
            const statePath = path.join(STATE_DIR, `device_${this.id}.json`);
            if (fs.existsSync(statePath)) {
                const state = JSON.parse(await fs.promises.readFile(statePath, 'utf8'));
                this.sequence = state.sequence || 0;
                console.log(`已加载设备 ${this.id} 的状态，序列号: ${this.sequence}`);
            }
        } catch (err) {
            console.error(`加载设备 ${this.id} 状态失败:`, err);
        }
    }
    
    async saveState() {
        try {
            const state = {
                sequence: this.sequence,
                lastHeartbeat: this.lastHeartbeat
            };
            await writeFile(
                path.join(STATE_DIR, `device_${this.id}.json`),
                JSON.stringify(state, null, 2)
            );
        } catch (err) {
            console.error(`保存设备 ${this.id} 状态失败:`, err);
        }
    }
    
    setupSocket() {
        this.socket.on('data', this.handleData.bind(this));
        this.socket.on('error', this.handleError.bind(this));
        this.socket.on('close', this.handleClose.bind(this));
        
        // 设置socket选项
        this.socket.setKeepAlive(true, 10000);
        this.socket.setNoDelay(true);
    }
    
    startHeartbeatCheck() {
        this.heartbeatTimer = setInterval(() => {
            const now = Date.now();
            if (now - this.lastHeartbeat > HEARTBEAT_TIMEOUT) {
                console.error(`设备 ${this.id} 心跳超时`);
                this.socket.destroy();
            }
        }, 5000);
    }
    
    handleData(data) {
        try {
            this.buffer = Buffer.concat([this.buffer, data]);
            
            // 处理所有完整的数据包
            while (this.buffer.length >= 12) { // 最小包头大小
                if (this.isProcessingPacket) {
                    return; // 等待当前包处理完成
                }
                
                const magic = this.buffer.readUInt32BE(0);
                const sequence = this.buffer.readUInt32BE(4);
                
                switch (magic) {
                    case 0xDEADBEEF: // 连接确认包
                        if (this.buffer.length >= 12) {
                            this.handleConnectionConfirmation(sequence);
                            this.buffer = this.buffer.slice(12);
                        }
                        break;
                        
                    case 0xAABBCCDD: // 音频数据包
                        if (this.buffer.length >= 16) {
                            const length = this.buffer.readUInt32BE(8);
                            const timestamp = this.buffer.readUInt32BE(12);
                            
                            if (length > MAX_PACKET_SIZE) {
                                throw new Error('数据包过大');
                            }
                            
                            if (this.buffer.length >= 16 + length) {
                                this.isProcessingPacket = true;
                                this.handleAudioPacket(sequence, timestamp, this.buffer.slice(16, 16 + length))
                                    .finally(() => {
                                        this.isProcessingPacket = false;
                                    });
                                this.buffer = this.buffer.slice(16 + length);
                            } else {
                                break; // 等待更多数据
                            }
                        }
                        break;
                        
                    case 0xFFEEDDCC: // 心跳包
                        if (this.buffer.length >= 12) {
                            this.handleHeartbeat(sequence);
                            this.buffer = this.buffer.slice(12);
                        }
                        break;
                        
                    default:
                        console.error(`设备 ${this.id} 收到未知数据包: ${magic.toString(16)}`);
                        this.buffer = this.buffer.slice(4); // 跳过未知魔数
                }
            }
        } catch (err) {
            console.error(`设备 ${this.id} 处理数据错误:`, err);
            this.socket.destroy();
        }
    }
    
    handleConnectionConfirmation(sequence) {
        if (!this.isAuthenticated) {
            console.log(`设备 ${this.id} 认证成功`);
            this.isAuthenticated = true;
            this.sequence = sequence;
            
            // 发送确认响应
            const response = Buffer.alloc(4);
            response.writeUInt32BE(0xDEADBEEF, 0);
            this.socket.write(response);
        }
    }
    
    async handleAudioPacket(sequence, timestamp, audioData) {
        try {
            if (sequence < this.sequence) {
                console.warn(`设备 ${this.id} 收到过期数据包: ${sequence}`);
                return;
            }
            
            if (sequence > this.sequence) {
                console.warn(`设备 ${this.id} 数据包乱序: 期望 ${this.sequence}, 收到 ${sequence}`);
                // 可以实现重传请求机制
                return;
            }
            
            // 保存音频数据
            const filename = `${this.id}_${timestamp}_${sequence}.raw`;
            await writeFile(path.join(AUDIO_DIR, filename), audioData);
            
            // 发送到AI服务
            await this.sendToAIService(audioData, timestamp, sequence);
            
            // 发送ACK
            const ack = Buffer.alloc(8);
            ack.writeUInt32BE(0xAABBCCDD, 0);
            ack.writeUInt32BE(sequence, 4);
            this.socket.write(ack);
            
            this.sequence++;
            await this.saveState();
            
        } catch (err) {
            console.error(`设备 ${this.id} 处理音频数据错误:`, err);
        }
    }
    
    handleHeartbeat(sequence) {
        this.lastHeartbeat = Date.now();
        
        // 发送心跳响应
        const response = Buffer.alloc(8);
        response.writeUInt32BE(0xFFEEDDCC, 0);
        response.writeUInt32BE(sequence, 4);
        this.socket.write(response);
    }
    
    async sendToAIService(audioData, timestamp, sequence) {
        try {
            // 这里实现发送到AI服务的逻辑
            // 可以使用WebSocket或HTTP请求
            if (wsServer && wsServer.clients) {
                wsServer.clients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({
                            type: 'audio',
                            deviceId: this.id,
                            timestamp,
                            sequence,
                            data: audioData.toString('base64')
                        }));
                    }
                });
            }
        } catch (err) {
            console.error(`发送数据到AI服务失败:`, err);
            // 可以实现重试机制
        }
    }
    
    handleError(err) {
        console.error(`设备 ${this.id} 连接错误:`, err);
    }
    
    handleClose() {
        console.log(`设备 ${this.id} 断开连接`);
        clearInterval(this.heartbeatTimer);
        
        // 设置重连超时
        this.reconnectTimer = setTimeout(() => {
            console.log(`设备 ${this.id} 重连超时，清理资源`);
            this.cleanup();
        }, RECONNECT_TIMEOUT);
    }
    
    cleanup() {
        clearTimeout(this.reconnectTimer);
        this.socket.destroy();
        // 清理其他资源
    }
}

// 创建TCP服务器
const tcpServer = net.createServer((socket) => {
    const deviceId = `${socket.remoteAddress}:${socket.remotePort}`;
    console.log(`新设备连接: ${deviceId}`);
    
    const deviceConnection = new DeviceConnection(socket, deviceId);
}).on('error', (err) => {
    console.error('TCP服务器错误:', err);
});

// 创建WebSocket服务器
const wsServer = new WebSocket.Server({ port: WS_PORT }, () => {
    console.log(`WebSocket服务器运行在端口 ${WS_PORT}`);
});

wsServer.on('connection', (ws) => {
    console.log('AI服务已连接');
    
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            // 处理来自AI服务的消息
            console.log('收到AI服务消息:', data);
        } catch (err) {
            console.error('处理AI服务消息错误:', err);
        }
    });
    
    ws.on('close', () => {
        console.log('AI服务断开连接');
    });
});

// 启动TCP服务器
tcpServer.listen(TCP_PORT, () => {
    console.log(`TCP服务器运行在端口 ${TCP_PORT}`);
}); 