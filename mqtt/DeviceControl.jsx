import React, { useEffect, useState } from 'react'
import mqtt from 'mqtt'

function DeviceControl() {
  const [client, setClient] = useState(null)
  const [deviceStatus, setDeviceStatus] = useState({})
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    // 连接到 MQTT 服务器（WebSocket）
    const mqttClient = mqtt.connect('ws://localhost:8888')

    mqttClient.on('connect', () => {
      console.log('浏览器已连接到 MQTT 服务器')
      setConnected(true)
      
      // 订阅所有设备的状态更新
      mqttClient.subscribe('browser/+/status')
    })

    // 接收设备状态更新
    mqttClient.on('message', (topic, message) => {
      try {
        const status = JSON.parse(message.toString())
        setDeviceStatus(prev => ({
          ...prev,
          [status.deviceId]: status
        }))
      } catch (error) {
        console.error('状态解析错误:', error)
      }
    })

    setClient(mqttClient)

    return () => {
      if (mqttClient) {
        mqttClient.end()
      }
    }
  }, [])

  // 发送控制命令到设备
  const sendCommand = (deviceId, action, params = {}) => {
    if (!client || !connected) return

    const command = {
      deviceId,
      action,
      params,
      timestamp: new Date().toISOString()
    }

    client.publish('browser/control/' + deviceId, JSON.stringify(command))
  }

  return (
    <div>
      <h2>设备控制面板</h2>
      <div>连接状态: {connected ? '已连接' : '未连接'}</div>

      {/* 设备状态显示 */}
      <div>
        <h3>设备状态:</h3>
        {Object.entries(deviceStatus).map(([deviceId, status]) => (
          <div key={deviceId}>
            <h4>设备 ID: {deviceId}</h4>
            <p>温度: {status.temperature}°C</p>
            <p>湿度: {status.humidity}%</p>
            <p>最后更新: {new Date(status.timestamp).toLocaleString()}</p>
            
            {/* 控制按钮 */}
            <button onClick={() => sendCommand(deviceId, 'powerOn')}>
              开启
            </button>
            <button onClick={() => sendCommand(deviceId, 'powerOff')}>
              关闭
            </button>
            <button onClick={() => sendCommand(deviceId, 'getData')}>
              获取数据
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

export default DeviceControl
