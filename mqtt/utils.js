const crypto = require('crypto')

// 生成唯一的客户端ID
exports.generateClientId = function () {
  return 'mqtt_' + crypto.randomBytes(8).toString('hex')
}

// 验证主题格式是否正确
exports.validateTopic = function (topic) {
  if (!topic || typeof topic !== 'string') {
    return false
  }
  // MQTT主题不能包含这些字符：+, #, 和 null
  return !topic.includes('\u0000') && 
         topic.length > 0 && 
         topic.length <= 65535
}

// 解析消息负载
exports.parsePayload = function (payload) {
  try {
    if (Buffer.isBuffer(payload)) {
      payload = payload.toString()
    }
    return JSON.parse(payload)
  } catch (err) {
    return payload
  }
}

// 创建响应对象
exports.createResponse = function (success, message, data = null) {
  return {
    success,
    message,
    data,
    timestamp: new Date().toISOString()
  }
}

// 日志格式化
exports.formatLog = function (level, message, meta = {}) {
  return {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...meta
  }
}

// QoS级别验证
exports.validateQoS = function (qos) {
  return [0, 1, 2].includes(Number(qos))
}

// 主题匹配检查
exports.topicMatch = function (subscription, topic) {
  const subParts = subscription.split('/')
  const topicParts = topic.split('/')

  for (let i = 0; i < subParts.length; i++) {
    const subPart = subParts[i]
    const topicPart = topicParts[i]

    if (subPart === '#') {
      return true
    }
    if (subPart !== '+' && subPart !== topicPart) {
      return false
    }
  }

  return topicParts.length === subParts.length
} 