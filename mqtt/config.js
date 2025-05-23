module.exports = {
  // MQTT服务器配置
  mqtt: {
    port: process.env.MQTT_PORT || 1883,
    host: process.env.MQTT_HOST || 'localhost',
    // 默认QoS级别
    qos: 1,
    // 保留消息的最大数量
    maxRetainedMessages: 100,
    // 是否允许匿名连接
    allowAnonymous: true
  },

  // 安全配置
  security: {
    // SSL/TLS配置（如果需要）
    ssl: {
      enabled: false,
      key: '',
      cert: ''
    },
    // 认证配置
    auth: {
      enabled: false,
      username: '',
      password: ''
    }
  },

  // 日志配置
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    // 是否记录客户端连接日志
    logClientConnections: true,
    // 是否记录发布的消息
    logPublishedMessages: true
  }
} 