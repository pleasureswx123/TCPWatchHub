# MQTT 服务器

这是一个基于 Node.js 和 Aedes 的 MQTT 服务器实现。

## 功能特点

- 支持 MQTT 3.1.1 协议
- 支持 QoS 0, 1, 2
- 支持保留消息
- 支持主题订阅和发布
- 支持客户端认证
- 支持 SSL/TLS 加密连接
- 完整的日志记录
- 优雅关闭处理

## 通信架构

### 系统架构图
```
┌──────────────┐                                      ┌──────────────┐
│   硬件设备   │                                      │    浏览器    │
│  TCP:1883    │                                      │   WS:8888    │
└──────┬───────┘                                      └──────┬───────┘
       │                                                     │
       │              ┌──────────────────────┐              │
       │              │      MQTT 服务器      │              │
       └──────────────┤  TCP:1883/WS:8888    ├──────────────┘
                      │                      │
                      └──────────────────────┘

消息流向：
1. 设备 -> 服务器 -> 浏览器：
   device/123/status ──> 服务器 ──> browser/123/status

2. 浏览器 -> 服务器 -> 设备：
   browser/control/123 ──> 服务器 ──> device/123/command
```

### 连接方式
- 硬件设备：使用 TCP 连接 (mqtt://)，默认端口 1883
- 浏览器：使用 WebSocket 连接 (ws://)，默认端口 8888
- 服务器：同时支持 TCP 和 WebSocket 连接

### 主题设计
```
设备发送状态：    device/{deviceId}/status
设备接收命令：    device/{deviceId}/command
浏览器发送命令：  browser/control/{deviceId}
浏览器接收状态：  browser/{deviceId}/status
```

### 通信流程

1. **硬件设备 -> 浏览器的数据流**：
   - 设备通过 TCP 连接（mqtt://）发送状态到服务器
   - 设备发布消息到主题：`device/{deviceId}/status`
   - 服务器接收并转发到浏览器主题：`browser/{deviceId}/status`
   - 浏览器通过 WebSocket 接收状态更新

   示例代码：
   ```javascript
   // 设备端发送状态
   deviceClient.publish(`device/${deviceId}/status`, JSON.stringify({
     temperature: 25,
     humidity: 60
   }))

   // 浏览器端接收状态
   browserClient.subscribe('browser/+/status')
   browserClient.on('message', (topic, message) => {
     const status = JSON.parse(message.toString())
     console.log('设备状态:', status)
   })
   ```

2. **浏览器 -> 硬件设备的控制流**：
   - 浏览器通过 WebSocket 发送控制命令
   - 浏览器发布命令到主题：`browser/control/{deviceId}`
   - 服务器接收并转发到设备主题：`device/{deviceId}/command`
   - 设备通过 TCP 连接接收并执行命令

   示例代码：
   ```javascript
   // 浏览器端发送命令
   browserClient.publish(`browser/control/${deviceId}`, JSON.stringify({
     action: 'powerOn',
     params: { duration: 3600 }
   }))

   // 设备端接收命令
   deviceClient.subscribe(`device/${deviceId}/command`)
   deviceClient.on('message', (topic, message) => {
     const command = JSON.parse(message.toString())
     console.log('收到命令:', command)
   })
   ```

## 安装

确保你已经安装了 Node.js (>= 12.0.0)，然后运行：

```bash
npm install
```

## 配置

配置文件位于 `config.js`，你可以通过环境变量或直接修改配置文件来更改服务器设置：

- `MQTT_PORT`: MQTT 服务器端口（默认：1883）
- `MQTT_HOST`: MQTT 服务器主机地址（默认：localhost）
- `LOG_LEVEL`: 日志级别（默认：info）

## 运行

启动服务器：

```bash
node mqtt-server.js
```

## 使用示例

### 连接到服务器

使用 MQTT 客户端（如 MQTT.js）连接到服务器：

```javascript
const mqtt = require('mqtt')
const client = mqtt.connect('mqtt://localhost:1883')

client.on('connect', () => {
  console.log('Connected to MQTT server')
})
```

### 发布消息

```javascript
client.publish('test/topic', 'Hello MQTT!')
```

### 订阅主题

```javascript
client.subscribe('test/topic', (err) => {
  if (!err) {
    console.log('Subscribed to test/topic')
  }
})
```

## 安全性

- 支持用户名/密码认证
- 支持 SSL/TLS 加密
- 可配置允许/禁止匿名连接

## 错误处理

服务器包含完整的错误处理机制：

- 连接错误处理
- 发布/订阅错误处理
- 优雅关闭处理

## 贡献

欢迎提交 Issue 和 Pull Request。

## 许可证

MIT 