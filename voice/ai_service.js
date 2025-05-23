const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const writeFile = promisify(fs.writeFile);

const app = express();
app.use(bodyParser.json({ limit: '50mb' }));

// 配置
const PORT = 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const AZURE_SPEECH_KEY = process.env.AZURE_SPEECH_KEY;
const AZURE_SPEECH_REGION = process.env.AZURE_SPEECH_REGION;

// Azure Speech SDK
const sdk = require('microsoft-cognitiveservices-speech-sdk');
const speechConfig = sdk.SpeechConfig.fromSubscription(AZURE_SPEECH_KEY, AZURE_SPEECH_REGION);

// 配置参数
const WS_PORT = 8080;
const TCP_SERVER_URL = 'ws://localhost:3000';
const AUDIO_DIR = path.join(__dirname, 'audio');
const RESULT_DIR = path.join(__dirname, 'results');
const RECONNECT_DELAY = 5000;
const MAX_RETRIES = 3;

// 确保目录存在
[AUDIO_DIR, RESULT_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

class AIService {
    constructor() {
        this.ws = null;
        this.isConnected = false;
        this.reconnectAttempts = 0;
        this.pendingRequests = new Map();
        this.processingQueue = [];
        this.isProcessing = false;
        
        this.connect();
    }
    
    connect() {
        console.log('正在连接TCP服务器...');
        
        this.ws = new WebSocket(TCP_SERVER_URL);
        
        this.ws.on('open', () => {
            console.log('已连接到TCP服务器');
            this.isConnected = true;
            this.reconnectAttempts = 0;
            
            // 处理之前积压的请求
            this.processQueue();
        });
        
        this.ws.on('message', async (data) => {
            try {
                const message = JSON.parse(data);
                if (message.type === 'audio') {
                    await this.handleAudioData(message);
                }
            } catch (err) {
                console.error('处理消息错误:', err);
            }
        });
        
        this.ws.on('close', () => {
            console.log('与TCP服务器的连接已断开');
            this.isConnected = false;
            this.handleReconnect();
        });
        
        this.ws.on('error', (err) => {
            console.error('WebSocket错误:', err);
            this.isConnected = false;
        });
    }
    
    handleReconnect() {
        if (this.reconnectAttempts >= MAX_RETRIES) {
            console.error('重连次数超过最大限制，停止重连');
            return;
        }
        
        this.reconnectAttempts++;
        console.log(`${RECONNECT_DELAY/1000}秒后尝试重连(第${this.reconnectAttempts}次)`);
        
        setTimeout(() => {
            this.connect();
        }, RECONNECT_DELAY);
    }
    
    async handleAudioData(message) {
        const { deviceId, timestamp, sequence, data } = message;
        
        try {
            // 保存原始音频数据
            const audioPath = path.join(AUDIO_DIR, `${deviceId}_${timestamp}_${sequence}.raw`);
            await writeFile(audioPath, Buffer.from(data, 'base64'));
            
            // 添加到处理队列
            this.processingQueue.push({
                deviceId,
                timestamp,
                sequence,
                audioPath
            });
            
            // 开始处理队列
            if (!this.isProcessing) {
                await this.processQueue();
            }
            
        } catch (err) {
            console.error('处理音频数据错误:', err);
            this.handleError(deviceId, sequence, err);
        }
    }
    
    async processQueue() {
        if (this.isProcessing || this.processingQueue.length === 0) {
            return;
        }
        
        this.isProcessing = true;
        
        while (this.processingQueue.length > 0) {
            const task = this.processingQueue.shift();
            try {
                // 1. 语音识别
                const text = await this.speechToText(task.audioPath);
                
                // 2. 自然语言处理
                const nlpResult = await this.processNLP(text);
                
                // 3. 语音合成
                const audioResponse = await this.textToSpeech(nlpResult.response);
                
                // 4. 保存结果
                await this.saveResult(task, {
                    originalText: text,
                    nlpResult,
                    audioResponse
                });
                
                // 5. 发送结果回TCP服务器
                this.sendResult(task.deviceId, task.sequence, {
                    type: 'ai_response',
                    text,
                    nlpResult,
                    audioResponse: audioResponse.toString('base64')
                });
                
            } catch (err) {
                console.error(`处理任务失败 (设备: ${task.deviceId}, 序列: ${task.sequence}):`, err);
                this.handleError(task.deviceId, task.sequence, err);
            }
        }
        
        this.isProcessing = false;
    }
    
    async speechToText(audioPath) {
        try {
            const audioData = await fs.promises.readFile(audioPath);
            
            // 这里实现实际的语音识别逻辑
            // 示例：使用第三方API
            const response = await axios.post('YOUR_SPEECH_TO_TEXT_API', {
                audio: audioData.toString('base64'),
                config: {
                    encoding: 'LINEAR16',
                    sampleRateHertz: 16000,
                    languageCode: 'zh-CN'
                }
            });
            
            return response.data.text;
            
        } catch (err) {
            throw new Error(`语音识别失败: ${err.message}`);
        }
    }
    
    async processNLP(text) {
        try {
            // 这里实现实际的NLP处理逻辑
            // 示例：使用第三方API
            const response = await axios.post('YOUR_NLP_API', {
                text,
                features: {
                    intent: true,
                    sentiment: true,
                    entities: true
                }
            });
            
            return {
                intent: response.data.intent,
                sentiment: response.data.sentiment,
                entities: response.data.entities,
                response: response.data.response
            };
            
        } catch (err) {
            throw new Error(`NLP处理失败: ${err.message}`);
        }
    }
    
    async textToSpeech(text) {
        try {
            // 这里实现实际的语音合成逻辑
            // 示例：使用第三方API
            const response = await axios.post('YOUR_TEXT_TO_SPEECH_API', {
                text,
                voice: {
                    languageCode: 'zh-CN',
                    name: 'zh-CN-Standard-A',
                    ssmlGender: 'FEMALE'
                },
                audioConfig: {
                    audioEncoding: 'LINEAR16',
                    sampleRateHertz: 16000
                }
            });
            
            return Buffer.from(response.data.audioContent, 'base64');
            
        } catch (err) {
            throw new Error(`语音合成失败: ${err.message}`);
        }
    }
    
    async saveResult(task, result) {
        try {
            const resultPath = path.join(RESULT_DIR, `${task.deviceId}_${task.timestamp}_${task.sequence}.json`);
            await writeFile(resultPath, JSON.stringify(result, null, 2));
        } catch (err) {
            console.error('保存结果失败:', err);
        }
    }
    
    sendResult(deviceId, sequence, result) {
        if (!this.isConnected) {
            console.warn('未连接到TCP服务器，无法发送结果');
            return;
        }
        
        try {
            this.ws.send(JSON.stringify({
                deviceId,
                sequence,
                ...result
            }));
        } catch (err) {
            console.error('发送结果失败:', err);
        }
    }
    
    handleError(deviceId, sequence, error) {
        const errorResult = {
            type: 'error',
            deviceId,
            sequence,
            error: error.message
        };
        
        // 保存错误信息
        const errorPath = path.join(RESULT_DIR, `error_${deviceId}_${sequence}.json`);
        writeFile(errorPath, JSON.stringify(errorResult, null, 2))
            .catch(err => console.error('保存错误信息失败:', err));
        
        // 发送错误信息回TCP服务器
        if (this.isConnected) {
            this.ws.send(JSON.stringify(errorResult));
        }
    }
}

// 启动AI服务
const aiService = new AIService();

// 1. 语音识别 API
app.post('/speech-to-text', async (req, res) => {
    try {
        const audioData = Buffer.from(req.body.audio, 'base64');
        const audioStream = sdk.AudioInputStream.createPushStream();
        
        // 推送音频数据
        audioStream.write(audioData);
        audioStream.close();
        
        const audioConfig = sdk.AudioConfig.fromStreamInput(audioStream);
        const recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);
        
        const result = await new Promise((resolve, reject) => {
            recognizer.recognizeOnceAsync(
                result => {
                    resolve(result);
                },
                error => {
                    reject(error);
                }
            );
        });
        
        res.json({ text: result.text });
    } catch (error) {
        console.error('语音识别错误:', error);
        res.status(500).json({ error: '语音识别失败' });
    }
});

// 2. 语义理解 API
app.post('/nlp', async (req, res) => {
    try {
        const response = await axios.post('https://api.openai.com/v1/chat/completions', {
            model: 'gpt-4',
            messages: [
                {
                    role: 'system',
                    content: '你是一个智能助手，负责理解用户的语音输入并生成合适的回复。'
                },
                {
                    role: 'user',
                    content: req.body.text
                }
            ],
            temperature: 0.7,
            max_tokens: 150
        }, {
            headers: {
                'Authorization': `Bearer ${OPENAI_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });
        
        const aiResponse = response.data.choices[0].message.content;
        
        res.json({
            intent: {
                type: 'conversation',
                confidence: 0.9,
                response: aiResponse
            }
        });
    } catch (error) {
        console.error('语义理解错误:', error);
        res.status(500).json({ error: '语义理解失败' });
    }
});

// 3. 语音合成 API
app.post('/text-to-speech', async (req, res) => {
    try {
        const { text } = req.body;
        const synthesizer = new sdk.SpeechSynthesizer(speechConfig);
        
        const result = await new Promise((resolve, reject) => {
            synthesizer.speakTextAsync(
                text,
                result => {
                    const { audioData } = result;
                    synthesizer.close();
                    resolve(audioData);
                },
                error => {
                    synthesizer.close();
                    reject(error);
                }
            );
        });
        
        res.json({
            audio: Buffer.from(result).toString('base64')
        });
    } catch (error) {
        console.error('语音合成错误:', error);
        res.status(500).json({ error: '语音合成失败' });
    }
});

// 错误处理中间件
app.use((err, req, res, next) => {
    console.error('服务器错误:', err);
    res.status(500).json({ error: '服务器内部错误' });
});

// 启动服务器
app.listen(PORT, () => {
    console.log(`AI服务启动在端口 ${PORT}`);
});

// 优雅关闭
process.on('SIGTERM', () => {
    console.log('收到SIGTERM信号，准备关闭...');
    if (aiService.ws) {
        aiService.ws.close();
    }
    process.exit(0);
}); 