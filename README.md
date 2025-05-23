# 处理手表设备的数据通信和控制TCP服务器项目

本项目实现了一个基于 Node.js 的 TCP 服务器，用于处理手表设备的数据通信和控制。服务器支持双向通信流程，实现了设备数据上报和远程控制功能。

## 系统架构

### 架构流程图
```
┌──────────────┐          ┌──────────────┐          ┌──────────────┐
│   手表设备   │          │  TCP 服务器  │          │  Java 后端   │
│  (TCP客户端) │          │ TCP + HTTP   │          │  (HTTP API)  │
└──────┬───────┘          └──────┬───────┘          └──────┬───────┘
       │                         │                         │
       │                         │                         │
       │                         │                         │
       │    1. TCP连接(8080)     │                         │
       │ ─────────────────────>  │                         │
       │                         │                         │
       │                         │                         │
       │   2. 发送数据(心率等)    │                         │
       │ ─────────────────────>  │                         │
       │                         │    3. HTTP转发数据       │
       │                         │ ─────────────────────>  │
       │                         │                         │
       │                         │                         │
       │                         │   4. HTTP控制命令        │
       │                         │ <─────────────────────  │
       │                         │                         │
       │    5. TCP控制命令       │                         │
       │ <─────────────────────  │                         │
       │                         │                         │
       │    6. 执行命令确认      │                         │
       │ ─────────────────────>  │                         │
       │                         │    7. HTTP响应确认       │
       │                         │ ─────────────────────>  │
       │                         │                         │

数据流说明：
1. 手表通过 TCP 协议连接到服务器（端口 8080）
2. 手表实时发送数据（心率、体温、血压等）
3. TCP 服务器通过 HTTP 转发数据到 Java API
4. Java 后端发送控制命令到 TCP 服务器
5. TCP 服务器将命令转发给手表设备
6. 手表执行命令并返回确认信息
7. TCP 服务器将确认信息转发给 Java 后端
```

### 1. 数据上报流程（手表 -> Java后端）

```
[手表设备] --TCP协议--> [TCP服务器] --HTTP(node-fetch)--> [Java API]
```

- 手表设备通过 TCP 协议连接到 TCP 服务器
- 手表发送数据（心率、体温、血压等）到 TCP 服务器
- TCP 服务器使用 node-fetch 将数据转发到 Java API
- Java 后端处理并存储数据

### 2. 控制指令流程（Java后端 -> 手表）

```
[Java服务] --HTTP--> [TCP服务器] --TCP协议--> [手表设备]
```

- Java 服务通过 HTTP 调用 TCP 服务器的 API
- TCP 服务器接收到 HTTP 请求
- TCP 服务器通过已建立的 TCP socket 连接发送命令到手表
- 手表执行相应的命令

## 通信协议对比

### TCP vs HTTP vs WebSocket

```
┌─────────────────────────────────────────────────────────────┐
│                        协议对比图                           │
├───────────────┬─────────────┬────────────┬────────────────┤
│    特性        │    TCP      │   HTTP     │   WebSocket    │
├───────────────┼─────────────┼────────────┼────────────────┤
│ 连接类型      │ 持久连接     │ 短连接      │ 持久连接       │
│ 通信方式      │ 双向通信     │ 请求-响应   │ 双向通信       │
│ 数据格式      │ 二进制流     │ 文本/二进制  │ 文本/二进制    │
│ 状态维护      │ 有状态       │ 无状态      │ 有状态         │
│ 实时性        │ 高          │ 低          │ 高            │
│ 资源消耗      │ 低          │ 低          │ 中等          │
│ 使用难度      │ 较难        │ 简单        │ 中等          │
└───────────────┴─────────────┴────────────┴────────────────┘
```

### 1. TCP vs HTTP 协议差异

#### TCP 协议特点
- 面向连接的持久通信
- 原始的二进制流传输
- 需要自定义应用层协议
- 适用场景：
  - 物联网设备通信
  - 实时数据传输
  - 需要保持长连接的应用
  - 对实时性要求高的场景

#### HTTP 协议特点
- 基于请求-响应的短连接
- 有标准的请求方法（GET/POST等）
- 自带状态码和头信息
- 适用场景：
  - 标准的 Web 应用
  - API 接口服务
  - 资源获取和提交
  - 不需要实时推送的场景

### 2. TCP vs WebSocket 协议差异

#### TCP 协议优势
- 更底层，性能更好
- 资源消耗更少
- 更灵活的协议设计
- 适用场景：
  - 嵌入式设备通信
  - 对性能要求极高的应用
  - 需要自定义协议的场景

#### WebSocket 优势
- 基于 Web 标准
- 自动处理代理和安全
- 浏览器原生支持
- 适用场景：
  - 网页实时应用
  - 浏览器推送服务
  - 在线游戏和聊天

### 3. HTTP vs WebSocket 协议差异

#### HTTP 协议优势
- 简单易用
- 广泛支持
- 无需保持连接
- 适用场景：
  - RESTful API
  - 文件上传下载
  - 普通的 Web 应用

#### WebSocket 优势
- 全双工通信
- 保持连接状态
- 低延迟通信
- 适用场景：
  - 实时数据展示
  - 在线协作工具
  - 需要服务器推送的应用

### 4. 本项目中的协议选择

1. **设备通信选择 TCP 的原因**
   - 设备需要保持长连接
   - 需要高效的二进制传输
   - 对实时性要求高
   - 资源消耗需要最小化

2. **后端通信选择 HTTP 的原因**
   - 标准的 API 接口
   - 无需保持长连接
   - 便于调试和维护
   - 良好的跨平台支持

3. **浏览器通信选择 WebSocket 的原因**
   - 浏览器原生支持
   - 需要实时数据推送
   - 双向通信需求
   - 自动处理代理和安全

### 5. 协议差异总结

#### TCP vs HTTP 主要差异
- **连接方式**：TCP 是持久连接，HTTP 是短连接（请求完就断开）
- **通信模式**：TCP 可以双向通信，HTTP 是请求-响应模式
- **使用场景**：
  - TCP 适合：物联网设备、实时数据传输、需要保持长连接的场景
  - HTTP 适合：Web API、资源获取、普通网页请求

#### TCP vs WebSocket 主要差异
- **协议层级**：TCP 是传输层协议，WebSocket 是应用层协议
- **使用环境**：
  - TCP 可以在任何网络环境使用，但浏览器不能直接使用
  - WebSocket 主要用于浏览器环境，但性能比 TCP 略低
- **使用场景**：
  - TCP 适合：硬件设备、性能敏感场景
  - WebSocket 适合：网页实时应用、浏览器推送

#### HTTP vs WebSocket 主要差异
- **通信模式**：
  - HTTP 是单向的请求-响应模式
  - WebSocket 是全双工的双向通信
- **连接特点**：
  - HTTP 每次请求都需要建立连接
  - WebSocket 建立一次连接后可以持续通信
- **使用场景**：
  - HTTP 适合：传统网页、API 接口、资源传输
  - WebSocket 适合：聊天应用、实时数据、在线游戏

#### 实际应用选择建议
1. **硬件设备通信**：优先选择 TCP
   - 原因：性能好、资源消耗低、可靠性高
   
2. **浏览器实时数据**：选择 WebSocket
   - 原因：浏览器原生支持、全双工通信、保持连接

3. **普通 Web API**：选择 HTTP
   - 原因：简单易用、广泛支持、标准化程度高

4. **文件传输**：选择 HTTP
   - 原因：有完善的传输机制、断点续传支持

5. **实时双向通信**：
   - 浏览器环境：选择 WebSocket
   - 非浏览器环境：选择 TCP

#### 网络距离与通信能力
1. **TCP 协议的距离限制**
   - 需要考虑网络延迟和稳定性
   - 长距离通信可能需要中继服务器
   - 跨网络环境时可能需要特殊配置
   - 受防火墙和 NAT 限制较大
   - 典型应用：局域网或专线网络中的设备通信

2. **HTTP 协议的距离特性**
   - 基于 TCP 但增加了应用层处理
   - 可以轻松穿越防火墙（80/443端口）
   - 支持全球范围的通信
   - 自动处理代理和路由
   - 典型应用：全球范围的 Web 服务

3. **WebSocket 协议的距离特性**
   - 类似 HTTP 的连接能力
   - 可以穿越防火墙和代理
   - 支持全球范围的实时通信
   - 自动处理连接保持
   - 典型应用：全球范围的实时web应用

#### 网络环境要求对比
```
┌──────────────┬────────────┬────────────┬────────────┐
│   要求项      │    TCP     │   HTTP     │ WebSocket  │
├──────────────┼────────────┼────────────┼────────────┤
│ 防火墙穿透    │   困难     │   容易     │   容易     │
│ 代理支持      │   不支持   │   支持     │   支持     │
│ 长距离通信    │   受限     │   支持     │   支持     │
│ 网络要求      │   严格     │   宽松     │   宽松     │
│ 端口限制      │   较多     │   较少     │   较少     │
└──────────────┴────────────┴────────────┴────────────┘
```

## 启动服务

### 1. 初始化项目
```bash
# 创建 package.json
npm init -y

# 安装所需依赖
npm install express cors node-fetch
```

### 2. 启动服务器
```bash
# 方式一：直接启动
node tcp-server.js

# 方式二：使用 nodemon 实现热重载（推荐开发环境使用）
# 先安装 nodemon
npm install -g nodemon
# 启动服务
nodemon tcp-server.js

# 方式三：使用 PM2 进程管理（推荐生产环境使用）
# 先安装 PM2
npm install -g pm2
# 启动服务
pm2 start tcp-server.js --name "tcp-server"
# 查看服务状态
pm2 status
# 查看日志
pm2 logs tcp-server
# 停止服务
pm2 stop tcp-server
# 重启服务
pm2 restart tcp-server
```

### 3. 服务启动后
服务器将同时启动两个服务：
- TCP 服务器（端口 8080）：用于与手表设备通信
- HTTP 服务器（端口 3000）：用于接收 Java 服务的请求

### 4. 验证服务是否正常运行
```bash
# 检查 TCP 服务器端口
lsof -i :8080

# 检查 HTTP 服务器端口
lsof -i :3000

# 测试 HTTP API 是否可访问
curl http://localhost:3000/api/devices/online
```

### 5. 常见问题处理
- 如果端口被占用：
  ```bash
  # 查找占用端口的进程
  lsof -i :8080
  # 或
  lsof -i :3000
  
  # 终止占用端口的进程
  kill -9 <进程ID>
  ```

- 如果需要修改端口：
  编辑 `tcp-server.js` 文件，修改 `TCP_PORT` 或 `HTTP_PORT` 常量的值

## 架构优势

1. **职责分离**
   - TCP 服务器专注于设备通信
   - Java 服务专注于业务逻辑处理

2. **松耦合**
   - 各服务之间通过标准协议通信
   - 可以独立升级或修改任一服务

3. **可扩展性**
   - 可以轻松添加新的设备类型
   - 可以方便地扩展 API 功能

4. **可维护性**
   - 清晰的通信流程
   - 标准的接口定义
   - 完善的错误处理

## 技术栈

- TCP 服务器：Node.js
- 通信协议：TCP、HTTP
- 依赖包：
  - `net`：Node.js 内置 TCP 模块
  - `express`：HTTP API 服务器
  - `cors`：跨域资源共享
  - `node-fetch`：HTTP 客户端

## API 接口

### HTTP API（供 Java 服务调用）

#### 设备数据获取
- `GET /api/device/:deviceId/heartrate` - 获取实时心率
- `GET /api/device/:deviceId/temperature` - 获取实时体温
- `GET /api/device/:deviceId/bloodpressure` - 获取实时血压

#### 设备控制
- `POST /api/device/:deviceId/interval` - 设置数据上报间隔
- `POST /api/device/:deviceId/powersave` - 设置省电模式
- `POST /api/device/:deviceId/restart` - 重启设备

#### 设备管理
- `GET /api/devices/online` - 获取在线设备列表

## TCP 应用场景与设备关联详解

### TCP 最佳使用场景

1. **局域网环境**
   ```
   ┌──────────────┐         ┌──────────────┐
   │   设备集群    │  局域网  │  TCP服务器   │
   │ 192.168.1.x  │ ───────>│ 192.168.1.100│
   └──────────────┘         └──────────────┘
   ```
   - 工厂内部设备通信
   - 企业内网系统
   - 办公网络环境
   - 家庭智能设备网络

2. **专线网络**
   ```
   ┌──────────────┐         ┌──────────────┐
   │ 远程设备集群  │  专线   │  TCP服务器   │
   │ (固定IP)     │ ───────>│ (固定IP)     │
   └──────────────┘         └──────────────┘
   ```
   - 企业专线连接
   - 跨区域数据中心
   - 大型设备监控网络

3. **公网固定IP**
   ```
   ┌──────────────┐         ┌──────────────┐
   │   设备        │  公网   │  TCP服务器   │
   │ (动态IP)     │ ───────>│ (固定IP)     │
   └──────────────┘         └──────────────┘
   ```
   - 服务器必须有固定公网IP
   - 需要端口映射配置
   - 适合单向连接场景

### 设备与服务器关联方式

1. **局域网直连模式**
```javascript
// 设备端代码
const net = require('net');
const client = net.connect({
    host: '192.168.1.100',  // 局域网服务器IP
    port: 8080
}, () => {
    console.log('已连接到服务器');
    // 发送设备标识
    client.write(JSON.stringify({
        type: 'device_auth',
        deviceId: 'DEVICE_001',
        deviceType: 'smartwatch'
    }));
});
```

2. **专线连接模式**
```javascript
// 设备端代码
const net = require('net');
const client = net.connect({
    host: '10.10.10.100',  // 专线IP
    port: 8080,
    // 专线通常需要额外的连接参数
    localAddress: '10.10.10.1',  // 本地绑定IP
    family: 4,  // 使用IPv4
}, () => {
    console.log('已连接到专线服务器');
});
```

3. **公网连接模式**
```javascript
// 设备端代码
const net = require('net');
const client = net.connect({
    host: 'server.example.com',  // 公网域名或IP
    port: 8080,
    // 可能需要的重连机制
    reconnectDelay: 5000,  // 断线5秒后重连
}, () => {
    console.log('已连接到公网服务器');
});
```

### 设备连接最佳实践

1. **心跳机制**
```javascript
// 设备端实现
function startHeartbeat(client) {
    setInterval(() => {
        client.write(JSON.stringify({
            type: 'heartbeat',
            deviceId: 'DEVICE_001',
            timestamp: Date.now()
        }));
    }, 30000); // 每30秒发送一次心跳
}
```

2. **断线重连**
```javascript
// 设备端实现
function connectWithRetry() {
    const client = net.connect({/*配置*/});
    
    client.on('error', (err) => {
        console.error('连接错误:', err);
        setTimeout(connectWithRetry, 5000);
    });
    
    client.on('close', () => {
        console.log('连接关闭，准备重连...');
        setTimeout(connectWithRetry, 5000);
    });
}
```

3. **数据加密**
```javascript
// 设备端实现
const crypto = require('crypto');

function encryptData(data, key) {
    const cipher = crypto.createCipher('aes-256-cbc', key);
    let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return encrypted;
}
```

4. **连接认证**
```javascript
// 设备端实现
function authenticate(client, deviceId, secretKey) {
    const timestamp = Date.now();
    const signature = crypto
        .createHmac('sha256', secretKey)
        .update(`${deviceId}:${timestamp}`)
        .digest('hex');
        
    client.write(JSON.stringify({
        type: 'auth',
        deviceId,
        timestamp,
        signature
    }));
}
```

### 网络环境要求

1. **基本要求**
   - 服务器需要固定IP（局域网/公网）
   - 需要开放特定端口（如8080）
   - 网络延迟要求：通常<100ms
   - 带宽要求：根据数据量决定

2. **安全要求**
   - 防火墙需要允许TCP指定端口
   - 建议使用VPN或专线
   - 必要时配置SSL/TLS加密
   - 实施访问控制策略

3. **运维建议**
   - 监控网络质量
   - 记录连接日志
   - 设置连接数限制
   - 实施流量控制

