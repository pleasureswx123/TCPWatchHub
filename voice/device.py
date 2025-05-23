import machine
import network
import socket
import time
import json
from machine import I2S, Pin
import struct
import os

# 配置参数
WIFI_SSID = "your_wifi_ssid"
WIFI_PASSWORD = "your_wifi_password"
TCP_SERVER = "192.168.1.100"
TCP_PORT = 3000

# 音频参数
SAMPLE_RATE = 16000
SAMPLE_BITS = 16
CHANNELS = 1
BUFFER_LENGTH = 1024
VAD_THRESHOLD = 1000  # VAD能量阈值

# 可靠性参数
MAX_RETRIES = 3
HEARTBEAT_INTERVAL = 30
CONNECTION_TIMEOUT = 5
RECONNECT_DELAY = 5
STATE_FILE = 'device_state.json'

class AudioDevice:
    def __init__(self):
        self.wifi = network.WLAN(network.STA_IF)
        self.tcp_socket = None
        self.sequence = 0
        self.last_heartbeat = 0
        self.heartbeat_failures = 0
        self.connection_state = 'disconnected'
        self.retry_count = 0
        
        # 加载保存的状态
        self.load_state()
        
        # 配置I2S
        self.i2s = I2S(
            I2S.NUM0,
            bck=Pin(26),
            ws=Pin(25),
            sdin=Pin(27),
            standard=I2S.PHILIPS,
            mode=I2S.MASTER_RX,
            dataformat=I2S.B16,
            channelformat=I2S.MONO,
            samplerate=SAMPLE_RATE,
            dmacount=8,
            dmalen=BUFFER_LENGTH
        )
        
        # 初始化音频缓冲区
        self.audio_buffer = bytearray(BUFFER_LENGTH * 2)
        
    def load_state(self):
        try:
            if STATE_FILE in os.listdir():
                with open(STATE_FILE, 'r') as f:
                    state = json.load(f)
                    self.sequence = state.get('sequence', 0)
        except:
            pass
            
    def save_state(self):
        try:
            state = {
                'sequence': self.sequence,
                'connection_state': self.connection_state
            }
            with open(STATE_FILE, 'w') as f:
                json.dump(state, f)
        except:
            pass
        
    def connect_wifi(self):
        print("正在连接WiFi...")
        if not self.wifi.active():
            self.wifi.active(True)
        
        retry_count = 0
        while not self.wifi.isconnected() and retry_count < MAX_RETRIES:
            try:
                self.wifi.connect(WIFI_SSID, WIFI_PASSWORD)
                start_time = time.time()
                while not self.wifi.isconnected():
                    if time.time() - start_time > CONNECTION_TIMEOUT:
                        raise Exception("WiFi连接超时")
                    time.sleep(1)
                print(f"WiFi已连接，IP: {self.wifi.ifconfig()[0]}")
                return True
            except Exception as e:
                print(f"WiFi连接失败: {e}")
                retry_count += 1
                time.sleep(RECONNECT_DELAY)
        
        return self.wifi.isconnected()
        
    def connect_tcp(self):
        print("正在连接TCP服务器...")
        retry_count = 0
        while retry_count < MAX_RETRIES:
            try:
                self.tcp_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                self.tcp_socket.settimeout(CONNECTION_TIMEOUT)
                self.tcp_socket.connect((TCP_SERVER, TCP_PORT))
                
                # 发送连接确认包
                self.send_connection_confirmation()
                self.connection_state = 'connected'
                print("TCP服务器连接成功")
                return True
            except Exception as e:
                print(f"TCP连接失败: {e}")
                retry_count += 1
                if self.tcp_socket:
                    self.tcp_socket.close()
                time.sleep(RECONNECT_DELAY)
        return False
    
    def send_connection_confirmation(self):
        confirmation = struct.pack(">III", 0xDEADBEEF, self.sequence, 0)
        self.tcp_socket.send(confirmation)
        # 等待服务器确认
        response = self.tcp_socket.recv(1024)
        if not response or len(response) < 4:
            raise Exception("服务器确认失败")
            
    def detect_voice(self, audio_data):
        # 增强的VAD检测
        try:
            # 计算短时能量
            energy = sum(abs(x) for x in struct.unpack(f"<{len(audio_data)//2}h", audio_data))
            energy /= (len(audio_data) // 2)
            
            # 使用自适应阈值
            threshold = VAD_THRESHOLD * (1.0 + self.get_noise_level())
            return energy > threshold
        except Exception as e:
            print(f"VAD检测错误: {e}")
            return False
            
    def get_noise_level(self):
        # 简单的背景噪声估计
        return 0.1  # 可以实现更复杂的噪声估计算法
        
    def send_audio_packet(self, audio_data):
        retry_count = 0
        while retry_count < MAX_RETRIES:
            try:
                # 构建数据包
                header = struct.pack(">IIII", 0xAABBCCDD, self.sequence, len(audio_data), int(time.time()))
                packet = header + audio_data
                self.tcp_socket.send(packet)
                
                # 等待ACK
                ack = self.tcp_socket.recv(8)
                if len(ack) == 8:
                    ack_seq = struct.unpack(">II", ack)[1]
                    if ack_seq == self.sequence:
                        self.sequence += 1
                        self.save_state()  # 保存状态
                        return True
                
                retry_count += 1
                time.sleep(0.1)
            except Exception as e:
                print(f"发送数据失败: {e}")
                retry_count += 1
                time.sleep(0.1)
        return False
        
    def send_heartbeat(self):
        try:
            current_time = time.time()
            if current_time - self.last_heartbeat >= HEARTBEAT_INTERVAL:
                heartbeat = struct.pack(">III", 0xFFEEDDCC, self.sequence, int(current_time))
                self.tcp_socket.send(heartbeat)
                
                # 等待心跳确认
                response = self.tcp_socket.recv(8)
                if len(response) == 8 and struct.unpack(">II", response)[0] == 0xFFEEDDCC:
                    self.last_heartbeat = current_time
                    self.heartbeat_failures = 0
                    return True
                else:
                    self.heartbeat_failures += 1
                    
                if self.heartbeat_failures >= MAX_RETRIES:
                    raise Exception("心跳检测失败次数过多")
                    
            return True
        except Exception as e:
            print(f"发送心跳包失败: {e}")
            self.heartbeat_failures += 1
            return False
            
    def run(self):
        while True:
            try:
                # 读取音频数据
                num_bytes = self.i2s.readinto(self.audio_buffer)
                if num_bytes > 0:
                    # VAD检测
                    if self.detect_voice(self.audio_buffer[:num_bytes]):
                        if not self.send_audio_packet(self.audio_buffer[:num_bytes]):
                            raise Exception("发送音频数据失败")
                
                # 心跳检测
                if not self.send_heartbeat():
                    raise Exception("心跳检测失败")
                    
            except Exception as e:
                print(f"运行错误: {e}")
                self.connection_state = 'disconnected'
                self.save_state()
                self.reconnect()
                
    def reconnect(self):
        print("正在尝试重新连接...")
        if self.tcp_socket:
            self.tcp_socket.close()
        
        while True:
            if not self.wifi.isconnected():
                if not self.connect_wifi():
                    time.sleep(RECONNECT_DELAY)
                    continue
                    
            if self.connect_tcp():
                self.connection_state = 'connected'
                self.save_state()
                break
                
            time.sleep(RECONNECT_DELAY)
        print("重新连接成功")

def main():
    device = AudioDevice()
    
    # 初始化连接
    while True:
        try:
            if device.connect_wifi() and device.connect_tcp():
                break
        except Exception as e:
            print(f"初始化失败: {e}")
            time.sleep(RECONNECT_DELAY)
    
    # 运行主循环
    device.run()

if __name__ == "__main__":
    main() 