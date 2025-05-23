const mqtt = require('mqtt')
const client = mqtt.connect('mqtt://localhost:1883', {
  clientId: `device_${Math.random().toString(16).slice(2, 8)}`
})

client.on('connect', () => {
  console.log('设备已连接到 MQTT 服务器')
  
  // 订阅控制命令主题
  client.subscribe(`device/${client.options.clientId}/command`)
  
  // 模拟定期发送状态
  setInterval(() => {
    const status = {
      temperature: Math.random() * 30 + 20,
      humidity: Math.random() * 50 + 30,
      timestamp: new Date().toISOString()
    }
    
    client.publish(`device/${client.options.clientId}`, JSON.stringify(status))
  }, 5000)
})

// 接收控制命令
client.on('message', (topic, message) => {
  if (topic.endsWith('/command')) {
    try {
      const command = JSON.parse(message.toString())
      console.log('收到控制命令:', command)
      
      // 执行命令
      executeCommand(command)
    } catch (error) {
      console.error('命令执行错误:', error)
    }
  }
})

function executeCommand(command) {
  // 实现命令执行逻辑
  console.log('执行命令:', command)
  // ... 具体的硬件控制逻辑
}
