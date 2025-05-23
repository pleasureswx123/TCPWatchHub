const aedes = require('aedes')()
const net = require('net')
const ws = require('websocket-stream')
const http = require('http')

// 创建 TCP 服务器 (用于硬件设备连接)
const tcpServer = net.createServer(aedes.handle)
const tcpPort = 1883

// 创建 WebSocket 服务器 (用于浏览器连接)
const httpServer = http.createServer()
const wsPort = 8888
ws.createServer({ server: httpServer }, aedes.handle)

// 设备消息处理
aedes.on('publish', async function (packet, client) {
  if (!client) return // 忽略没有客户端的消息

  // 1. 处理来自设备的消息
  if (packet.topic.startsWith('device/')) {
    console.log('收到设备消息:', {
      clientId: client.id,
      topic: packet.topic,
      message: packet.payload.toString()
    })

    try {
      // 解析设备消息
      const message = JSON.parse(packet.payload.toString())
      
      // 转发到浏览器的主题
      const browserTopic = `browser/${packet.topic.split('/')[1]}/status`
      
      // 转发消息到浏览器
      aedes.publish({
        topic: browserTopic,
        payload: Buffer.from(JSON.stringify({
          deviceId: client.id,
          ...message,
          timestamp: new Date().toISOString()
        }))
      })
    } catch (error) {
      console.error('消息处理错误:', error)
    }
  }
  
  // 2. 处理来自浏览器的控制命令
  if (packet.topic.startsWith('browser/control/')) {
    console.log('收到浏览器控制命令:', {
      clientId: client.id,
      topic: packet.topic,
      message: packet.payload.toString()
    })

    try {
      // 解析控制命令
      const command = JSON.parse(packet.payload.toString())
      
      // 转发到对应设备的主题
      const deviceTopic = `device/${command.deviceId}/command`
      
      // 发送命令到设备
      aedes.publish({
        topic: deviceTopic,
        payload: Buffer.from(JSON.stringify({
          command: command.action,
          params: command.params,
          timestamp: new Date().toISOString()
        }))
      })
    } catch (error) {
      console.error('命令处理错误:', error)
    }
  }
})

// 客户端连接事件
aedes.on('client', function (client) {
  console.log('客户端连接:', client.id)
})

// 客户端断开连接事件
aedes.on('clientDisconnect', function (client) {
  console.log('客户端断开连接:', client.id)
})

// 启动服务器
tcpServer.listen(tcpPort, function () {
  console.log('MQTT TCP 服务器（用于设备）运行在端口', tcpPort)
})

httpServer.listen(wsPort, function () {
  console.log('MQTT WebSocket 服务器（用于浏览器）运行在端口', wsPort)
})

// 错误处理
tcpServer.on('error', function (err) {
  console.error('Server error:', err)
  process.exit(1)
})

httpServer.on('error', function (err) {
  console.error('Server error:', err)
  process.exit(1)
})

// 优雅关闭
process.on('SIGINT', function () {
  console.log('\nClosing MQTT server...')
  tcpServer.close(() => {
    console.log('MQTT TCP server closed')
    process.exit(0)
  })
  httpServer.close(() => {
    console.log('MQTT WebSocket server closed')
    process.exit(0)
  })
}) 