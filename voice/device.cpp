#include <iostream>
#include <cstring>
#include <sys/socket.h>
#include <arpa/inet.h>
#include <unistd.h>
#include <thread>
#include <chrono>
#include <fstream>
#include <nlohmann/json.hpp>
#include <alsa/asoundlib.h>
#include <vector>
#include <ctime>

using json = nlohmann::json;
using namespace std;

// 配置参数
const char* TCP_SERVER = "192.168.1.100";
const int TCP_PORT = 3000;

// 音频参数
const int SAMPLE_RATE = 16000;
const int SAMPLE_BITS = 16;
const int CHANNELS = 1;
const int BUFFER_LENGTH = 1024;
const int VAD_THRESHOLD = 1000;

// 可靠性参数
const int MAX_RETRIES = 3;
const int HEARTBEAT_INTERVAL = 30;
const int CONNECTION_TIMEOUT = 5;
const int RECONNECT_DELAY = 5;
const char* STATE_FILE = "device_state.json";

class AudioDevice {
private:
    int tcp_socket;
    uint32_t sequence;
    time_t last_heartbeat;
    int heartbeat_failures;
    string connection_state;
    int retry_count;
    snd_pcm_t *capture_handle;
    vector<int16_t> audio_buffer;
    
    // 状态管理
    void load_state() {
        try {
            ifstream f(STATE_FILE);
            if (f.good()) {
                json state;
                f >> state;
                sequence = state["sequence"].get<uint32_t>();
            }
        } catch (const exception& e) {
            cerr << "加载状态失败: " << e.what() << endl;
        }
    }
    
    void save_state() {
        try {
            json state = {
                {"sequence", sequence},
                {"connection_state", connection_state}
            };
            ofstream f(STATE_FILE);
            f << state.dump(4);
        } catch (const exception& e) {
            cerr << "保存状态失败: " << e.what() << endl;
        }
    }
    
    bool setup_audio() {
        int err;
        if ((err = snd_pcm_open(&capture_handle, "default", SND_PCM_STREAM_CAPTURE, 0)) < 0) {
            cerr << "无法打开音频设备: " << snd_strerror(err) << endl;
            return false;
        }
        
        snd_pcm_hw_params_t *hw_params;
        snd_pcm_hw_params_alloca(&hw_params);
        snd_pcm_hw_params_any(capture_handle, hw_params);
        
        if ((err = snd_pcm_hw_params_set_access(capture_handle, hw_params, SND_PCM_ACCESS_RW_INTERLEAVED)) < 0) {
            cerr << "无法设置访问类型: " << snd_strerror(err) << endl;
            return false;
        }
        
        if ((err = snd_pcm_hw_params_set_format(capture_handle, hw_params, SND_PCM_FORMAT_S16_LE)) < 0) {
            cerr << "无法设置格式: " << snd_strerror(err) << endl;
            return false;
        }
        
        unsigned int rate = SAMPLE_RATE;
        if ((err = snd_pcm_hw_params_set_rate_near(capture_handle, hw_params, &rate, 0)) < 0) {
            cerr << "无法设置采样率: " << snd_strerror(err) << endl;
            return false;
        }
        
        if ((err = snd_pcm_hw_params_set_channels(capture_handle, hw_params, CHANNELS)) < 0) {
            cerr << "无法设置通道数: " << snd_strerror(err) << endl;
            return false;
        }
        
        if ((err = snd_pcm_hw_params(capture_handle, hw_params)) < 0) {
            cerr << "无法设置参数: " << snd_strerror(err) << endl;
            return false;
        }
        
        snd_pcm_prepare(capture_handle);
        audio_buffer.resize(BUFFER_LENGTH);
        return true;
    }
    
public:
    AudioDevice() : sequence(0), last_heartbeat(0), heartbeat_failures(0),
                   connection_state("disconnected"), retry_count(0), tcp_socket(-1) {
        load_state();
        if (!setup_audio()) {
            throw runtime_error("音频设备初始化失败");
        }
    }
    
    ~AudioDevice() {
        if (tcp_socket >= 0) {
            close(tcp_socket);
        }
        if (capture_handle) {
            snd_pcm_close(capture_handle);
        }
    }
    
    bool connect_tcp() {
        cout << "正在连接TCP服务器..." << endl;
        retry_count = 0;
        while (retry_count < MAX_RETRIES) {
            try {
                tcp_socket = socket(AF_INET, SOCK_STREAM, 0);
                if (tcp_socket < 0) {
                    throw runtime_error("创建socket失败");
                }
                
                struct timeval timeout;
                timeout.tv_sec = CONNECTION_TIMEOUT;
                timeout.tv_usec = 0;
                setsockopt(tcp_socket, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout));
                setsockopt(tcp_socket, SOL_SOCKET, SO_SNDTIMEO, &timeout, sizeof(timeout));
                
                struct sockaddr_in server_addr;
                server_addr.sin_family = AF_INET;
                server_addr.sin_port = htons(TCP_PORT);
                inet_pton(AF_INET, TCP_SERVER, &server_addr.sin_addr);
                
                if (connect(tcp_socket, (struct sockaddr*)&server_addr, sizeof(server_addr)) < 0) {
                    throw runtime_error("连接服务器失败");
                }
                
                send_connection_confirmation();
                connection_state = "connected";
                cout << "TCP服务器连接成功" << endl;
                return true;
            } catch (const exception& e) {
                cerr << "TCP连接失败: " << e.what() << endl;
                retry_count++;
                if (tcp_socket >= 0) {
                    close(tcp_socket);
                    tcp_socket = -1;
                }
                this_thread::sleep_for(chrono::seconds(RECONNECT_DELAY));
            }
        }
        return false;
    }
    
    void send_connection_confirmation() {
        uint32_t magic = 0xDEADBEEF;
        uint32_t data[3] = {htonl(magic), htonl(sequence), 0};
        if (send(tcp_socket, data, sizeof(data), 0) != sizeof(data)) {
            throw runtime_error("发送确认包失败");
        }
        
        uint32_t response;
        if (recv(tcp_socket, &response, sizeof(response), 0) != sizeof(response)) {
            throw runtime_error("服务器确认失败");
        }
    }
    
    bool detect_voice(const vector<int16_t>& audio_data) {
        try {
            // 计算短时能量
            double energy = 0;
            for (int16_t sample : audio_data) {
                energy += abs(sample);
            }
            energy /= audio_data.size();
            
            // 使用自适应阈值
            double threshold = VAD_THRESHOLD * (1.0 + get_noise_level());
            return energy > threshold;
        } catch (const exception& e) {
            cerr << "VAD检测错误: " << e.what() << endl;
            return false;
        }
    }
    
    double get_noise_level() {
        return 0.1; // 可以实现更复杂的噪声估计算法
    }
    
    bool send_audio_packet(const vector<int16_t>& audio_data) {
        retry_count = 0;
        while (retry_count < MAX_RETRIES) {
            try {
                // 构建数据包头
                uint32_t magic = 0xAABBCCDD;
                uint32_t timestamp = time(nullptr);
                uint32_t header[4] = {
                    htonl(magic),
                    htonl(sequence),
                    htonl(audio_data.size() * sizeof(int16_t)),
                    htonl(timestamp)
                };
                
                // 发送头部
                if (send(tcp_socket, header, sizeof(header), 0) != sizeof(header)) {
                    throw runtime_error("发送数据包头失败");
                }
                
                // 发送音频数据
                if (send(tcp_socket, audio_data.data(), audio_data.size() * sizeof(int16_t), 0) 
                    != audio_data.size() * sizeof(int16_t)) {
                    throw runtime_error("发送音频数据失败");
                }
                
                // 等待ACK
                uint32_t ack[2];
                if (recv(tcp_socket, ack, sizeof(ack), 0) == sizeof(ack)) {
                    uint32_t ack_seq = ntohl(ack[1]);
                    if (ack_seq == sequence) {
                        sequence++;
                        save_state();
                        return true;
                    }
                }
                
                retry_count++;
                this_thread::sleep_for(chrono::milliseconds(100));
            } catch (const exception& e) {
                cerr << "发送数据失败: " << e.what() << endl;
                retry_count++;
                this_thread::sleep_for(chrono::milliseconds(100));
            }
        }
        return false;
    }
    
    bool send_heartbeat() {
        try {
            time_t current_time = time(nullptr);
            if (current_time - last_heartbeat >= HEARTBEAT_INTERVAL) {
                uint32_t magic = 0xFFEEDDCC;
                uint32_t data[3] = {
                    htonl(magic),
                    htonl(sequence),
                    htonl(static_cast<uint32_t>(current_time))
                };
                
                if (send(tcp_socket, data, sizeof(data), 0) != sizeof(data)) {
                    throw runtime_error("发送心跳包失败");
                }
                
                uint32_t response[2];
                if (recv(tcp_socket, response, sizeof(response), 0) == sizeof(response) &&
                    ntohl(response[0]) == magic) {
                    last_heartbeat = current_time;
                    heartbeat_failures = 0;
                    return true;
                } else {
                    heartbeat_failures++;
                }
                
                if (heartbeat_failures >= MAX_RETRIES) {
                    throw runtime_error("心跳检测失败次数过多");
                }
            }
            return true;
        } catch (const exception& e) {
            cerr << "发送心跳包失败: " << e.what() << endl;
            heartbeat_failures++;
            return false;
        }
    }
    
    void run() {
        while (true) {
            try {
                // 读取音频数据
                int err = snd_pcm_readi(capture_handle, audio_buffer.data(), BUFFER_LENGTH);
                if (err == -EPIPE) {
                    snd_pcm_prepare(capture_handle);
                    continue;
                } else if (err < 0) {
                    throw runtime_error("读取音频数据失败: " + string(snd_strerror(err)));
                }
                
                // VAD检测
                if (detect_voice(audio_buffer)) {
                    if (!send_audio_packet(audio_buffer)) {
                        throw runtime_error("发送音频数据失败");
                    }
                }
                
                // 心跳检测
                if (!send_heartbeat()) {
                    throw runtime_error("心跳检测失败");
                }
                
            } catch (const exception& e) {
                cerr << "运行错误: " << e.what() << endl;
                connection_state = "disconnected";
                save_state();
                reconnect();
            }
        }
    }
    
    void reconnect() {
        cout << "正在尝试重新连接..." << endl;
        if (tcp_socket >= 0) {
            close(tcp_socket);
            tcp_socket = -1;
        }
        
        while (true) {
            if (connect_tcp()) {
                connection_state = "connected";
                save_state();
                break;
            }
            this_thread::sleep_for(chrono::seconds(RECONNECT_DELAY));
        }
        cout << "重新连接成功" << endl;
    }
};

int main() {
    try {
        AudioDevice device;
        
        // 初始化连接
        while (true) {
            try {
                if (device.connect_tcp()) {
                    break;
                }
            } catch (const exception& e) {
                cerr << "初始化失败: " << e.what() << endl;
                this_thread::sleep_for(chrono::seconds(RECONNECT_DELAY));
            }
        }
        
        // 运行主循环
        device.run();
        
    } catch (const exception& e) {
        cerr << "程序错误: " << e.what() << endl;
        return 1;
    }
    
    return 0;
} 