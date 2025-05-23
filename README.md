# 处理手表设备的数据通信和控制TCP服务器项目

本项目实现了一个基于 Node.js 的 TCP 服务器，用于处理手表设备的数据通信和控制。服务器支持双向通信流程，实现了设备数据上报和远程控制功能。


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


## 系统架构

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
