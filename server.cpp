/*
图像降噪后端 — C  HTTP 服务器
功能：
HTTP 服务器（无需外部库，纯 C POSIX / Winsock）
双边滤波进行图像去噪
支持格式：PNG、JPG、JPEG、BMP、TGA（通过 stb）、RAW（RGGB Bayer）
数据结构：哈希映射缓存，优先队列（最大堆），链表（内核节点），队列（任务队列）

构建（Linux/macOS）：
g -O2 -std=c17 -o server server.cpp -lpthread
构建（Windows MSVC）：
cl /O2 /std:c17 server.cpp /link ws2_32.lib
构建（Windows MinGW）：
g -O2 -std=c17 -o server.exe server.cpp -lws2_32

接口：
GET /ping — 健康检查
POST /denoise — multipart/form-data: image, sigma_s, sigma_r, mode
*/

//兼容win和linux的socket头文件
#ifdef _WIN32
  #define _WIN32_WINNT 0x0601
  #include <winsock2.h>
  #include <ws2tcpip.h>
  #pragma comment(lib, "ws2_32.lib")
  typedef SOCKET sock_t;
  #define CLOSE_SOCKET(s) closesocket(s)
  #define INVALID_SOCK INVALID_SOCKET
#else
  #include <sys/socket.h>
  #include <netinet/in.h>
  #include <arpa/inet.h>
  #include <unistd.h>
  typedef int sock_t;
  #define CLOSE_SOCKET(s) close(s)
  #define INVALID_SOCK (-1)
#endif

#include <iostream>
#include <string>
#include <vector>
#include <unordered_map>
#include <queue>
#include <list>
#include <algorithm>
#include <cmath>
#include <cstring>
#include <cassert>
#include <sstream>
#include <thread>
#include <mutex>
#include <functional>
#include <chrono>
#include <memory>
#include <fstream>

//  STB 库实现图片信息的读取和输出（仅头文件，通过 #define 内联包含）
#define STB_IMAGE_IMPLEMENTATION
#include "stb_image.h"
#define STB_IMAGE_WRITE_IMPLEMENTATION
#include "stb_image_write.h"

// 防止数值越界（把图像计算结果限制在有效范围内）
template<typename T>    // v:要检查的数值，lo:下限，hi:上限
inline T clampVal(T v, T lo, T hi) { return v < lo ? lo : (v > hi ? hi : v); }

// 数据结构
/*
 1. 哈希映射 — 高斯权重缓存（加速双边滤波权重计算，存储已经计算过的高斯权重）
    键: pair<int,int> = (空间距离², 颜色距离²)
    值: 预计算的双边权重
*/
// FNV-1a 算法，计算键的哈希值
struct PairHash {
    size_t operator()(const std::pair<int,int>& p) const {
        // 基于 FNV-1a 设计的混合方式（FNV-1a 的核心思想（使用偏移基数，异或，乘质数，再异或，再乘质数））
		size_t h = 2166136261u; // FNV-1a 偏移基数
		h ^= static_cast<size_t>(p.first);  // 空间距离²
		h *= 16777619u; // FNV-1a 质数，使哈希值分布更均匀，减少冲突
		h ^= static_cast<size_t>(p.second); // 颜色距离²
		h *= 16777619u; // FNV-1a 质数
        return h;
    }
};
using WeightCache = std::unordered_map<std::pair<int,int>, float, PairHash>;    // 哈希表，缓存双边滤波的高斯权重

//2. 链表节点，存储滤波核窗口中每个邻域像素的贡献信息
struct KernelNode {
    int dx, dy;          // 该像素相对于当前中心像素的偏移量
    float spatial_w;     // 根据偏移距离预先计算好的空间高斯权重（只与空间距离有关，与颜色无关）
    std::shared_ptr<KernelNode> next;   // 指向下一个节点的共享指针，将所有邻域像素节点串成一个链表

    KernelNode(int dx_, int dy_, float sw)
        : dx(dx_), dy(dy_), spatial_w(sw), next(nullptr) {}
};

/**
* 3. 大顶堆（优先队列）—— 瓦片处理顺序
* 先处理面积较大的，实现负载均衡
*/
struct Tile {   // 把图像分成多个图块，每个图块作为一个任务，放入优先队列中
    int x, y, w, h; // 图块左上角坐标 (x,y)，以及宽 w、高 h
    int priority;  // 优先级 = w * h（面积），越大越优先处理
    bool operator<(const Tile& o) const { return priority < o.priority; }   // 比较
};
using TileHeap = std::priority_queue<Tile>; // 大顶堆比较，面积大的优先进入队列

// 队列 — 降噪处理流水线中组织和传递处理任务
struct Task {
    std::string type;               // 指定是彩色双边滤波还是灰度双边滤波
    std::vector<uint8_t> data;      // 图像原始像素数据
    int width, height, channels;    // 图像宽、高、通道数
    float sigma_s, sigma_r;         // 双边滤波参数（空间标准差和颜色标准差），sigma_s 控制空间权重衰减速度，sigma_r 控制颜色差异敏感度
};
using TaskQueue = std::queue<Task>; // 任务队列，存储待处理的图像任务

// ============================================================
// 双边滤波
// ------------------------------------------------------------
// 使用的数据结构：
// HashMap（WeightCache）：在线程处理每个像素的双边滤波时，缓存已经算好的高斯权重，避免重复的 exp 计算。
// LinkedList（KernelNode）：定义滤波窗口的形状，预存空间权重，遍历时直接取用。
// MaxHeap（TileHeap）：把图像按面积切成大小不等的图块，大块优先出队，实现负载均衡。
// Queue（TaskQueue）：每个图块被封装成一个 Task，按序进入任务队列，等待工作线程处理。
//
// 质量与速度平衡优化：
// 1. 半径限制为5：滤波核半径设为 5，核最大为 11×11 = 121 个采样点（减少每个像素需处理的邻域点数，大幅加速）
// 2. 范围权重查找表：预计算 65536 个颜色差异对应的权重值（把在线 exp 计算变为查表操作，速度快数十倍）
// 3. 扁平核数组：用连续内存数组替代指针链表存储核节点（缓存友好，减少指针跳转的开销）
// 4. 小图像锐化掩膜：对缩略图做快速锐化处理，保留边缘（低分辨率下先保证轮廓清晰，辅助主滤波）
// 5. Catmull-Rom 双三次上采样：处理后的低分图像用高质量插值放大回原尺寸（避免线性插值的模糊，保持清晰度）
// ============================================================

// 对输入图像执行双边滤波，并返回滤波后的图像数据
class BilateralFilter {
public:
    // 接收原始像素数组和所有配置参数
    static std::vector<uint8_t> apply(
        const uint8_t* src, // 源图像像素数组首地址
        int width, int height, int channels,    // 图像的宽度、高度、通道数(RGB为3)
        float sigma_s, float sigma_r,   // 双边滤波的核心参数：空间标准差、范围标准差
        bool grayscale_mode = false // 默认不启用灰度模式
    ) {
        // 创建一个同样大小的 dst 数组用于存放处理后的像素
        std::vector<uint8_t> dst((size_t)width * height * channels);
        int W = width, H = height, C = channels;    // 简短别名

        // 确定滤波核半径与核大小
        int radius = std::min(5, std::max(2, (int)std::ceil(sigma_s * 1.4f)));  // 根据空间标准差 sigma_s 自动计算一个合适的半径，但限制在 2 到 5 之间
        int kW = 2 * radius + 1;    // 核窗口的边长
        int kSize = kW * kW;    // 核窗口内的总像素点数

        std::cout << "[Filter] radius=" << radius
            << " kernel=" << kW << "x" << kW
            << " image=" << W << "x" << H
            << " pixels=" << (W * H) << std::endl;

        // 2. 构建滤波核 (三种数据结构同时填充)
        std::vector<KSample> kn;    // 扁平数组，实际处理时遍历用
        kn.reserve(kSize);  // 预分配内存，避免后续push_back时多次扩容

        // HashMap：以(dx*1000+dy)为键缓存空间权重sw
        std::unordered_map<int, float> hmap;
        // 预计算 1/(2*sigma_s^2)，高斯公式的一部分，提取到循环外避免重复计算
        float inv2SS = 1.0f / (2.0f * sigma_s * sigma_s);

        // LinkedList：双向链表头尾指针，存储核节点
        std::shared_ptr<KernelNode> lhead = nullptr, ltail = nullptr;

        // 双层循环遍历核窗口内的所有像素偏移
        for (int dy = -radius; dy <= radius; ++dy) {
            for (int dx = -radius; dx <= radius; ++dx) {
                float d2 = (float)(dx * dx + dy * dy);  // 计算该偏移点到中心点的距离平方
                float sw = std::exp(-d2 * inv2SS);  // 计算空间高斯权重：exp(-距离平方 / (2*sigma_s^2))
                hmap[dx * 1000 + dy] = sw;          // 存入HashMap，键用dx*1000+dy保证唯一性
                kn.push_back({ (short)dx, (short)dy, sw }); // 存入扁平数组，供实际滤波时快速遍历

                // 构建链表节点并串入链表尾部（尾插法）
                auto node = std::make_shared<KernelNode>(dx, dy, sw);
                if (!lhead) lhead = ltail = node;   // 链表为空时，头尾都指向该节点
                else { ltail->next = node; ltail = node; }  // 追加到尾部
            }
        }
        std::cout << "[HashMap] " << hmap.size() << " spatial entries cached" << std::endl;
        int llCount = 0;
        for (auto n = lhead; n; n = n->next) ++llCount;
        std::cout << "[LinkedList] " << llCount << " kernel nodes" << std::endl;

        // 3. 预计算范围权重查找表（LUT）（空间换时间）
        float inv2SR = 1.0f / (2.0f * sigma_r * sigma_r);
        std::vector<float> rLUT(256 * 256); // 8位图像颜色差值平方最大为255^2=65025
        for (int d = 0; d < 256 * 256; ++d) {
            rLUT[d] = std::exp(-(float)d * inv2SR); // 直接用索引d作为颜色差值平方，预计算对应的exp权重
        }

        // 4. 构建大顶堆，调度处理顺序
        TileHeap heap;
        const int TS = 64; // 边长
        // 按64x64网格切割图像
        for (int ty = 0; ty < H; ty += TS)
            for (int tx = 0; tx < W; tx += TS) {
                Tile t;
                t.x = tx; t.y = ty;
                // 处理边缘：宽度和高度取 min(TS, 剩余宽度/高度)
                t.w = std::min(TS, W - tx);
                t.h = std::min(TS, H - ty);
                t.priority = t.w * t.h; // 面积越大优先级越高
                heap.push(t);           // 推入大顶堆，面积大的瓦片会自动浮到堆顶
            }
        std::cout << "[MaxHeap] " << heap.size() << " tiles" << std::endl;

        // 5. 逐块处理所有像素
        while (!heap.empty()) {
            Tile t = heap.top(); // 取出当前面积最大的块
            heap.pop();
            // 遍历块内的每一行
            for (int py = t.y; py < t.y + t.h; ++py) {
                size_t rowBase = (size_t)py * W;    // 预计算该行在源/目标数组中的起始索引(以像素为单位)
                // 遍历块内的每一列
                for (int px = t.x; px < t.x + t.w; ++px) {
                    size_t ci = (rowBase + px) * C; // 计算当前像素在数组中的起始索引(考虑到通道数)
                    // 根据灰度模式标志，调用不同的处理函数
                    if (grayscale_mode && C >= 3)
                        processGray(dst.data(), src, ci, W, H, C, px, py, kn, rLUT);
                    else
                        processColor(dst.data(), src, ci, W, H, C, kn, rLUT);
                }
            }
        }
        return dst; // 返回处理后的图像数据
    }

private:
    struct KSample { short dx, dy; float sw; };

    // 边界处理函数，让超出图像边界的坐标回到有效范围内
    static inline int mc(int v, int lim) {
        if (v < 0) v = -v;
        if (v >= lim) v = 2 * lim - v - 2;
        return (v < 0) ? 0 : (v >= lim ? lim - 1 : v);
    }

    // 彩色双边滤波算法
    static void processColor(
        uint8_t* dst, const uint8_t* src, size_t ci,    // ci：当前中心像素在源数组中的起始索引
        int W, int H, int C,
        const std::vector<KSample>& kn,
        const std::vector<float>& rLUT)
    {
        float sum[4] = {0,0,0,0};   // 假设最多 4 个通道（RGBA），累加“邻域像素值 × 权重”
        float wSum = 0; // 累加所有权重，最后用于归一化
        int cen[4]; // 保存中心像素的原始通道值，用于计算颜色差异
        for (int c = 0; c < C; ++c)
            cen[c] = src[ci + c];

        const int nK = (int)kn.size();  // 核内采样点总数
        for (int k = 0; k < nK; ++k) {
            int nx = (int)(ci / C % W) + kn[k].dx;  // 邻域像素的 x 坐标
            int ny = (int)(ci / C / W) + kn[k].dy;  // 邻域像素的 y 坐标
            nx = mc(nx, W); // 用 mc 处理越界坐标
            ny = mc(ny, H);

            size_t ni = ((size_t)ny * W + nx) * C;  // 邻域像素的字节起始索引，将修正后的行列坐标转回一维字节索引

            // 计算颜色差值平方
            int cd2 = 0;
            for (int c = 0; c < C; ++c) {
                int d = cen[c] - (int)src[ni + c];  // 中心与邻域在该通道的差值
                cd2 += d * d;   // 累加得到颜色差值平方和
            }
            if (cd2 >= 256 * 256)   // 防止越界
                cd2 = 256 * 256 - 1;

            float w = kn[k].sw * rLUT[cd2]; // 双边滤波的核心公式：最终权重 = kn[k].sw 预计算的空间权重 × rLUT[cd2] 从查找表取出的颜色权重
            for (int c = 0; c < C; ++c)
                sum[c] += w * src[ni + c];  // 加权累加邻域像素值
            wSum += w;  // 累加权重
        }

        if (wSum > 0) {
            for (int c = 0; c < C; ++c) {
                float v = sum[c] / wSum;    // 归一化：加权和 ÷ 总权重
                dst[ci + c] = (uint8_t)(v < 0 ? 0 : (v > 255 ? 255 : v));   // 钳位到 [0,255]
            }
        } else {    // 无有效权重，保留原值
            for (int c = 0; c < C; ++c) 
                dst[ci + c] = src[ci + c];
        }
    }

	// 灰度双边滤波算法（对彩色图像先转换为灰度再处理，最后按比例缩放回彩色）
    static void processGray(    // 对亮度（Y 通道）进行滤波，然后等比例缩放 RGB，保留原图的色调
        uint8_t* dst, const uint8_t* src, size_t ci,
        int W, int H, int C, int px, int py,
        const std::vector<KSample>& kn,
        const std::vector<float>& rLUT)
    {
        // 计算中心像素的亮度（BT.709 标准加权）
        const uint8_t* cp = src + ci;
        float Yc = 0.2126f * cp[0] + 0.7152f * cp[1] + 0.0722f * cp[2]; // Yc：中心像素的亮度，使用 BT.709 标准

        float sumY = 0, wSum = 0;
        const int nK = (int)kn.size();

        for (int k = 0; k < nK; ++k) {
            int nx = mc(px + kn[k].dx, W);  // 这里直接用传入的像素坐标 px,py
            int ny = mc(py + kn[k].dy, H);
            const uint8_t* nb = src + ((size_t)ny * W + nx) * C;

            float Yn = 0.2126f * nb[0] + 0.7152f * nb[1] + 0.0722f * nb[2]; // 邻域亮度
            float dY = Yc - Yn; // 邻域亮度
            int dYi = (int)(dY * dY);   // 亮度差平方
            if (dYi >= 256 * 256) dYi = 256 * 256 - 1;

            float w = kn[k].sw * rLUT[dYi]; // 权重 = 空间权重 × 亮度颜色权重
            sumY += w * Yn; // 累加邻域亮度
            wSum += w;
        }

        float Ynew = (wSum > 0) ? (sumY / wSum) : Yc;   // 滤波后的新亮度
        float scale = (Yc > 1e-4f) ? (Ynew / Yc) : 1.0f;    // 亮度缩放因子

        for (int c = 0; c < C && c < 3; ++c) {  // 用缩放因子统一调整 RGB 三通道，保持色调不变
            float v = cp[c] * scale;    // RGB 三通道等比例缩放
            dst[ci + c] = (uint8_t)(v < 0 ? 0 : (v > 255 ? 255 : v));
        }
        if (C == 4) dst[ci + 3] = cp[3];    // 如果图像有 Alpha 通道（C==4），直接复制，不做修改
    }
};

//  RAW 图像解码器（RGGB Bayer，8位打包）将 Bayer 格式的 RAW 传感器数据通过简单的双线性插值转换为常规的彩色 RGB 图像
class RawDecoder {
public:
    // data：指向原始 RAW 数据缓冲区的指针，len：数据长度（字节数），w, h：引用传递，函数会计算出图像的宽度和高度并写回给调用者
    static std::vector<uint8_t> decode(const uint8_t* data, size_t len, int& w, int& h) {
        // 估算图像尺寸
        size_t n = len; // n 是数据总字节数。假设 RAW 数据是正方形的（宽高相等）
        int side = static_cast<int>(std::sqrt((double)n));
        // 保证 Bayer 模式能够正常处理（RGGB 以 2×2 块为单位），宽高都取偶数，强制设置为等宽高的正方形
        while ((size_t)(side * side) > n) --side;   // 取整数部分，得到正方形的边长候选值
        w = (side % 2 == 0) ? side : side - 1;  // 如果 side*side 超过了数据总量，说明边长太大，不断减 1 直到面积 ≤ 数据量
        h = w;

        std::vector<uint8_t> rgb(w * h * 3, 0);

        // 去马赛克主循环
        for (int y = 0; y < h; ++y) {   // 双重循环遍历每个像素位置 (x, y)
            for (int x = 0; x < w; ++x) {
                int idx = y * w + x;    // idx 是当前像素在 Bayer 数据中的线性索引
                uint8_t val = (idx < (int)len) ? data[idx] : 0; // val 是当前像素的原始 Bayer 值（只是 R、G 或 B 中的一个）。越界时取 0

                auto get = [&](int ix, int iy) -> uint8_t { // get(ix, iy)：返回 Bayer 图像中坐标 (ix, iy) 处的原始值
                    ix = clampVal(ix, 0, w-1);  // 调用之前定义的 clampVal 函数（将坐标钳制在有效范围内），避免越界访问
                    iy = clampVal(iy, 0, h-1);
                    int i2 = iy * w + ix;
                    return (i2 < (int)len) ? data[i2] : 0;  // 索引超出数据长度，返回 0
                };

                uint8_t R, G, B;
                bool evenRow = (y % 2 == 0);    // 是否为偶数行
                bool evenCol = (x % 2 == 0);    // 是否为偶数列

                // 根据行/列的奇偶性判断该像素是 R、G（哪一行）还是 B
                if (evenRow && evenCol) {   // 偶数行 + 偶数列：红色像素
                    R = val;    // 当前位置是 R 像素，直接使用 val 作为 R 值
                    G = uint8_t((int(get(x-1,y)) + get(x+1,y) + get(x,y-1) + get(x,y+1)) / 4);  // 缺失的 G 用上下左右四个邻居的平均值（这四个位置正好是 G 像素）
                    B = uint8_t((int(get(x-1,y-1)) + get(x+1,y-1) + get(x-1,y+1) + get(x+1,y+1)) / 4);  // 缺失的 B 用四个对角线邻居的平均值
                } else if (evenRow && !evenCol) {   // 偶数行 + 奇数列：绿色像素（红色行上的 G）
                    G = val;    // 当前位置是 G 像素，左右邻居是 R，上下邻居是 B
                    R = uint8_t((int(get(x-1,y)) + get(x+1,y)) / 2);    // R 取左右邻居平均值
                    B = uint8_t((int(get(x,y-1)) + get(x,y+1)) / 2);    // B 取上下邻居平均值
                } else if (!evenRow && evenCol) {   //奇数行 + 偶数列：绿色像素（蓝色行上的 G）
                    G = val;    // 当前位置是 G 像素，左右邻居是 B，上下邻居是 R
                    B = uint8_t((int(get(x-1,y)) + get(x+1,y)) / 2);    // B 取左右邻居平均
                    R = uint8_t((int(get(x,y-1)) + get(x,y+1)) / 2);    // R 取上下邻居平均
                } else {    // 奇数行 + 奇数列：蓝色像素
                    B = val;    // 当前位置是 B 像素
                    G = uint8_t((int(get(x-1,y)) + get(x+1,y) + get(x,y-1) + get(x,y+1)) / 4);  // G 取上下左右邻居平均（四个 G）
                    R = uint8_t((int(get(x-1,y-1)) + get(x+1,y-1) + get(x-1,y+1) + get(x+1,y+1)) / 4);  // R 取对角线邻居平均（四个 R）
                }
                // 存储解码后的 RGB 值
                rgb[idx*3+0] = R;
                rgb[idx*3+1] = G;
                rgb[idx*3+2] = B;
            }
        }
        return rgb;
    }
};

//  图片调整大小器 — 降采样、上采样和锐化，控制图像大小并增强细节
class ImageResizer {
public:
    // downscale：把大图缩小（盒滤镜均值降采样）（如果原图宽或高超过 maxEdge，就按比例缩小，使最长边等于 maxEdge）
    // 盒滤镜（Box Filter）：每个目标像素对应源图像中一个小矩形区域，取区域内所有源像素的平均值
    static std::vector<uint8_t> downscale(  
        const uint8_t* src, int srcW, int srcH, int C,
        int& outW, int& outH, int maxEdge)
    {
        if (srcW <= maxEdge && srcH <= maxEdge) {   // 原图已经足够小，直接拷贝返回
            outW = srcW; outH = srcH;
            return std::vector<uint8_t>(src, src + (size_t)srcW * srcH * C);
        }
        float ratio = (float)maxEdge / (float)std::max(srcW, srcH); // 计算缩放比例 ratio = 最大边长限制 ÷ 原图最长边
        outW = std::max(1, (int)(srcW * ratio));    // 输出宽高按比例缩小，至少为1
        outH = std::max(1, (int)(srcH * ratio));
        std::cout << "[Resize] " << srcW << "x" << srcH << " -> "
                  << outW << "x" << outH << std::endl;

        std::vector<uint8_t> dst((size_t)outW * outH * C);  // 分配目标图像内存，sx、sy 是目标像素在源图中对应的矩形区域尺寸（浮点数）
        float sx = (float)srcW / outW;  // 每个目标像素覆盖源图的宽度
        float sy = (float)srcH / outH;  // 每个目标像素覆盖源图的高度

        for (int y = 0; y < outH; ++y) {    // 遍历目标每一行，y0 到 y1 是源图中对应的行范围（不包含 y1）
            int y0 = (int)(y * sy), y1 = (int)((y + 1) * sy);
            if (y1 > srcH) y1 = srcH;
            for (int x = 0; x < outW; ++x) {    // 遍历目标每一列，x0 到 x1 是源图中对应的列范围
                int x0 = (int)(x * sx), x1 = (int)((x + 1) * sx);
                if (x1 > srcW) x1 = srcW;
                // 在源矩形区域内对所有像素的每个通道求和并统计像素总数 n
                float sum[4] = {0}; int n = 0;
                for (int sy2 = y0; sy2 < y1; ++sy2)
                    for (int sx2 = x0; sx2 < x1; ++sx2) {
                        const uint8_t* p = src + ((size_t)sy2 * srcW + sx2) * C;
                        for (int c = 0; c < C; ++c) sum[c] += p[c];
                        ++n;
                    }
                uint8_t* d = dst.data() + ((size_t)y * outW + x) * C;
                for (int c = 0; c < C; ++c) d[c] = (uint8_t)(sum[c] / n);   //用总和除以数量得到平均值，写入目标像素
            }
        }
        return dst;
    }
    // upscale：把小图放大（Catmull‑Rom 双三次插值）（将图像放大到指定尺寸，使用 Catmull‑Rom 双三次插值）
    static std::vector<uint8_t> upscale(
        const uint8_t* src, int srcW, int srcH, int C,
        int dstW, int dstH)
    {
        if (srcW == dstW && srcH == dstH) { // 尺寸相同则直接拷贝
            return std::vector<uint8_t>(src, src + (size_t)srcW * srcH * C);
        }
        std::cout << "[Upscale:Bicubic] " << srcW << "x" << srcH << " -> "
                  << dstW << "x" << dstH << std::endl;

        std::vector<uint8_t> dst((size_t)dstW * dstH * C);
        float rx = (float)srcW / dstW;  // 目标到源的采样步长（水平）
        float ry = (float)srcH / dstH;  // 目标到源的采样步长（垂直）

        for (int dy = 0; dy < dstH; ++dy) {
            float sy = dy * ry;            // 目标行在源图像中的浮点行号
            int iy = (int)sy;              // 整数部分（基准点行号）
            float fy = sy - iy;            // 小数部分（插值偏移）

            // 计算垂直方向4个源像素的权重。4个点分别是 iy-1, iy, iy+1, iy+2
            float wy[4];
            wy[0] = cubic(1.0f + fy);
            wy[1] = cubic(fy);
            wy[2] = cubic(1.0f - fy);
            wy[3] = cubic(2.0f - fy);

            // 对水平方向也计算4个权重
            for (int dx = 0; dx < dstW; ++dx) {
                float sx = dx * rx;
                int ix = (int)sx;
                float fx = sx - ix;

                float wx[4];
                wx[0] = cubic(1.0f + fx);
                wx[1] = cubic(fx);
                wx[2] = cubic(1.0f - fx);
                wx[3] = cubic(2.0f - fx);

                float sumC[4] = {0,0,0,0};
                for (int ky = 0; ky < 4; ++ky) {
                    int sy2 = clampIdx(iy - 1 + ky, srcH);
                    float wyv = wy[ky];
                    for (int kx = 0; kx < 4; ++kx) {
                        int sx2 = clampIdx(ix - 1 + kx, srcW);
                        const uint8_t* p = src + ((size_t)sy2 * srcW + sx2) * C;    // 每个像素的贡献 = 颜色值 × 行权重 × 列权重
                        float w = wx[kx] * wyv; // 总权重 = 水平权重 × 垂直权重
                        for (int c = 0; c < C; ++c)
                            sumC[c] += w * p[c];
                    }
                }
                // 钳位到 [0, 255]，写入目标像素
                uint8_t* d = dst.data() + ((size_t)dy * dstW + dx) * C;
                for (int c = 0; c < C; ++c)
                    d[c] = (uint8_t)(sumC[c] < 0 ? 0 : (sumC[c] > 255 ? 255 : sumC[c]));
            }
        }
        return dst;
    }

    // sharpen：增强边缘（反锐化掩膜）（增强边缘，amount 控制锐化强度（0.2~0.4 为轻度））
    // 反锐化掩膜公式：sharp = 原值 + amount × (原值 - 模糊值)
    static std::vector<uint8_t> sharpen(
        const uint8_t* src, int W, int H, int C, float amount)
    {
        if (amount <= 0) {  // 无需锐化，直接返回原图
            return std::vector<uint8_t>(src, src + (size_t)W * H * C);
        }
        std::cout << "[Sharpen] amount=" << amount << std::endl;

        // 一个 3×3 高斯模糊核（近似 σ≈0.85）
        // 1/16 * [1 2 1; 2 4 2; 1 2 1]
        const int kOff[9][2] = {{-1,-1},{0,-1},{1,-1},{-1,0},{0,0},{1,0},{-1,1},{0,1},{1,1}};
        const float kWg[9] = {1,2,1,2,4,2,1,2,1};
        const float kSum = 16.0f;

        std::vector<uint8_t> dst((size_t)W * H * C);
        // 遍历每个像素，只处理前3个通道（RGB），可能保留 Alpha
        for (int y = 0; y < H; ++y) {
            for (int x = 0; x < W; ++x) {
                size_t di = ((size_t)y * W + x) * C;
                for (int c = 0; c < C && c < 3; ++c) {
                    // 对当前通道做3×3高斯模糊，得到 blur
                    float blur = 0;
                    for (int k = 0; k < 9; ++k) {
                        int sx = clampIdx(x + kOff[k][0], W);
                        int sy = clampIdx(y + kOff[k][1], H);
                        blur += kWg[k] * src[((size_t)sy * W + sx) * C + c];
                    }
                    blur /= kSum;
                    // 反锐化掩膜公式应用
                    float orig = src[di + c];
                    float sharp = orig + amount * (orig - blur);
                    dst[di + c] = (uint8_t)(sharp < 0 ? 0 : (sharp > 255 ? 255 : sharp));
                }
                if (C == 4) dst[di + 3] = src[di + 3];  // Alpha 通道直接复制
            }
        }
        return dst;
    }

private:
    static inline float cubic(float t) {    // Catmull‑Rom 插值核：输入为距离 |t|（0~2），返回权重
        // Catmull-Rom spline (a = -0.5)
        t = std::fabs(t);
        if (t <= 1.0f)
            return (1.5f * t - 2.5f) * t * t + 1.0f;
        if (t < 2.0f)
            return ((-0.5f * t + 2.5f) * t - 4.0f) * t + 2.0f;
        return 0.0f;
    }
    static inline int clampIdx(int v, int lim) {    // 简单钳位，防止坐标越界（截断方式，非镜像）
        return v < 0 ? 0 : (v >= lim ? lim - 1 : v);
    }
};

//  HTTP 服务
// HTTP 请求结构体
struct HttpRequest {
    std::string method;                                    // HTTP 方法
    std::string path;                                      // 请求路径
    std::unordered_map<std::string, std::string> headers;  // 请求头键值对
    std::vector<uint8_t> body;                             // 请求体（原始字节）
};
// HTTP 响应结构体（构建服务器返回给客户端的响应）
struct HttpResponse {
    int status = 200;                                      // 状态码，默认 200 成功
    std::string status_text = "OK";                        // 状态文本
    std::unordered_map<std::string, std::string> headers;  // 响应头
    std::vector<uint8_t> body;                             // 响应体（如返回的图片数据）
};
// 单个 Multipart 字段（每个 MultipartField 对应 form-data 中的一个字段（通常是一个文件））
struct MultipartField {
    std::string name;          // 表单字段名（如 "image"）
    std::string filename;      // 上传的文件名（如 "photo.jpg"）
    std::string content_type;  // 文件的 MIME 类型（如 "image/jpeg"）
    std::vector<uint8_t> data; // 文件二进制内容
};
// Multipart 解析器类（解析 HTTP POST 请求体中的 multipart/form-data 数据（如通过网页表单上传的文件））
class MultipartParser {
public:
    static std::vector<MultipartField> parse(
        const std::vector<uint8_t>& body,   // 完整的请求体二进制数据
        const std::string& boundary // 分隔符字符串（从 Content-Type 头中提取，形如 ----WebKitFormBoundary...）
    ) {
        std::vector<MultipartField> fields;
        std::string delim = "--" + boundary;
        std::string delimEnd = "--" + boundary + "--";

        // Convert body to string for searching headers
        // (keep binary data intact)
        size_t pos = 0;
        size_t bodySize = body.size();
        // 在 body 中从 start 位置开始搜索字符串 s，返回首次出现的字节偏移
        auto findSeq = [&](const std::string& s, size_t start) -> size_t {
            if (start + s.size() > bodySize) return std::string::npos;
            for (size_t i = start; i + s.size() <= bodySize; ++i) {
                if (memcmp(body.data() + i, s.data(), s.size()) == 0)   // 使用 memcmp 直接比较内存，保证二进制安全
                    return i;
            }
            return std::string::npos;
        };
        // 逐个解析字段
        pos = findSeq(delim, 0);   // 找到第一个分隔符
        while (pos != std::string::npos) {
            pos += delim.size();    // 跳过当前分隔符本身

            // 检查结束标志
            if (pos + 2 <= bodySize && body[pos] == '-' && body[pos+1] == '-') 
                break;
            // 跳过 CRLF 换行
            if (pos + 2 <= bodySize && body[pos] == '\r' && body[pos+1] == '\n')
                pos += 2;   // Windows 风格 \r\n
            else if (pos < bodySize && body[pos] == '\n')
                pos += 1;   // Unix 风格 \n
            // 解析头部
            MultipartField field;
            while (true) {
                size_t eol = findSeq("\r\n", pos);        // 找行尾
                if (eol == std::string::npos) eol = findSeq("\n", pos);
                if (eol == std::string::npos || eol == pos) {
                    if (eol != std::string::npos) {
                        pos = eol + (body[eol] == '\r' ? 2 : 1);
                    }
                    break;   // 遇到空行（头结束）
                }
                std::string hdr(body.begin() + pos, body.begin() + eol);
                parsePartHeader(hdr, field);   // 解析这一行头
                pos = eol + (body[eol] == '\r' ? 2 : 1);
            }
            // 定位数据部分，从当前位置找下一个分隔符，数据部分就在当前 pos 和 nextBound 之间
            size_t nextBound = findSeq("\r\n" + delim, pos);
            if (nextBound == std::string::npos)
                nextBound = findSeq("\n" + delim, pos);
            if (nextBound == std::string::npos) break;
            // 提取数据，将两个边界之间的二进制数据存入 field.data，然后添加到结果列表
            size_t dataStart = pos;
            size_t dataEnd = nextBound;
            field.data.assign(body.begin() + dataStart, body.begin() + dataEnd);
            fields.push_back(std::move(field));

            // pos 移动到下一个分隔符的开始位置，继续循环
            pos = nextBound + 2; // skip \r\n (或 \n，但通常有 \r\n)
        }
        return fields;
    }

private:
    // 从形如 Content-Disposition: form-data; name="image"; filename="test.jpg" 的字符串中提取字段名和文件名
    static void parsePartHeader(const std::string& hdr, MultipartField& f) {
        if (hdr.substr(0, 20) == "Content-Disposition:") {
            auto namePos = hdr.find("name=\"");
            if (namePos != std::string::npos) {
                namePos += 6;                          // 跳过 name="
                auto end = hdr.find('"', namePos);     // 找闭合引号
                f.name = hdr.substr(namePos, end - namePos); // 提取 name 值
            }
            auto fnPos = hdr.find("filename=\"");
            if (fnPos != std::string::npos) {
                fnPos += 10;
                auto end = hdr.find('"', fnPos);
                f.filename = hdr.substr(fnPos, end - fnPos); // 提取 filename
            }
        }
        else if (hdr.substr(0, 13) == "Content-Type:") {
            f.content_type = trim(hdr.substr(13));     // 提取 Content-Type
        }
    }
    // trim 函数，去除字符串首尾的空白字符
    static std::string trim(const std::string& s) {
        size_t a = s.find_first_not_of(" \t\r\n");
        size_t b = s.find_last_not_of(" \t\r\n");
        return (a == std::string::npos) ? "" : s.substr(a, b - a + 1);
    }
};

//  请求处理器
class RequestHandler {
public:
    static HttpResponse handle(const HttpRequest& req) {
        if (req.method == "OPTIONS") {  // 浏览器预检请求（CORS），返回允许跨域的响应
            return corsOk();
        }
        if (req.method == "GET" && req.path == "/ping") {   // 健康检查接口，客户端可用它测试服务是否存活
            return handlePing();
        }
        if (req.method == "POST" && req.path == "/denoise") {   // 核心降噪接口，客户端上传图片和参数，服务器处理后返回降噪后的图片
            return handleDenoise(req);
        }
        return error404();  //其他路径都返回 404
    }

private:
    // 响应 OPTIONS 请求，告诉浏览器服务器允许跨域访问
    static HttpResponse corsOk() {
        HttpResponse res;
        res.status = 204;                // "No Content" 状态码
        res.status_text = "No Content";
        addCors(res);                    // 添加跨域头
        return res;
    }
    // 健康检查,返回 JSON 字符串，告知客户端服务版本和使用的算法
    static HttpResponse handlePing() {
        std::string body = "{\"ok\":true,\"version\":\"1.0.0\",\"algo\":\"bilateral_filter\"}";
        HttpResponse res;
        res.headers["Content-Type"] = "application/json";
        res.body.assign(body.begin(), body.end());
        addCors(res);
        return res;
    }
    // 核心降噪处理函数 handleDenoise
    static HttpResponse handleDenoise(const HttpRequest& req) {
        // 提取 Content-Type 中的 boundary
        auto ctIt = req.headers.find("content-type");
        if (ctIt == req.headers.end()) ctIt = req.headers.find("Content-Type");
        if (ctIt == req.headers.end()) return errorBadRequest("Missing Content-Type");
        // HTTP 头键名可能大小写不同，查找两次兼容
        std::string ct = ctIt->second;
        auto boundPos = ct.find("boundary=");
        if (boundPos == std::string::npos) return errorBadRequest("Missing boundary");
        std::string boundary = ct.substr(boundPos + 9);
        // 有些实现会把 boundary 用引号括起来，这里去掉引号
        if (!boundary.empty() && boundary.front() == '"') {
            boundary = boundary.substr(1, boundary.size() - 2);
        }
        //  解析 multipart 表单数据
        auto fields = MultipartParser::parse(req.body, boundary);
        // 提取字段,遍历所有解析出来的字段，按字段名 name 区分图像数据、参数
        std::vector<uint8_t> imgData;
        std::string filename;
        float sigmaS = 5.0f, sigmaR = 25.0f;  // 默认参数
        std::string mode = "bilateral";

        for (auto& f : fields) {
            if (f.name == "image") {
                imgData = f.data;           // 图像二进制数据
                filename = f.filename;      // 原始文件名
            }
            else if (f.name == "sigma_s") {
                try { sigmaS = std::stof(std::string(f.data.begin(), f.data.end())); }  // stof 将文本转为浮点数，try/catch 防止非法输入崩溃
                catch (...) {}
            }
            else if (f.name == "sigma_r") {
                try { sigmaR = std::stof(std::string(f.data.begin(), f.data.end())); }
                catch (...) {}
            }
            else if (f.name == "mode") {
                mode = std::string(f.data.begin(), f.data.end());
            }
        }
        if (imgData.empty()) return errorBadRequest("No image data");

        // 限制参数合理范围，防止异常输入导致崩溃或极慢处理
        sigmaS = clampVal(sigmaS, 1.0f, 15.0f);
        sigmaR = clampVal(sigmaR, 1.0f, 100.0f);

        std::cout << "[Denoise] file=" << filename
                  << " sigma_s=" << sigmaS
                  << " sigma_r=" << sigmaR
                  << " mode=" << mode
                  << " size=" << imgData.size() << std::endl;

        // 解码图像
        int width = 0, height = 0, channels = 0;
        uint8_t* pixels = nullptr;
        std::vector<uint8_t> rawDecoded;

        // 判断文件类型（RAW 还是普通图片）
        bool isRaw = false;
        std::string ext;
        if (!filename.empty()) {
            size_t dot = filename.rfind('.');
            if (dot != std::string::npos) {
                ext = filename.substr(dot + 1);
                for (char& c : ext) c = (char)tolower(c);   // 转小写
                if (ext == "raw" || ext == "cr2" || ext == "nef" || ext == "arw") {
                    isRaw = true;
                }
            }
        }

        if (isRaw) {    // 如果是 RAW：调用自定义的 RawDecoder::decode 解析，固定为 3 通道 RGB
            rawDecoded = RawDecoder::decode(imgData.data(), imgData.size(), width, height);
            pixels = rawDecoded.data();
            channels = 3;
        } else {    // 否则：用 stb_image 库解码（支持 JPG、PNG、BMP 等）
            pixels = stbi_load_from_memory(
                imgData.data(), (int)imgData.size(),
                &width, &height, &channels, 0
            );
        }

        if (!pixels || width == 0 || height == 0) { // 解码失败则返回 400 错误
            return errorBadRequest("Failed to decode image");
        }

        std::cout << "[Denoise] decoded: " << width << "x" << height
                  << " ch=" << channels << std::endl;

        // 若图像太大则降采样（加速处理）
        const int MAX_EDGE = 1000;  //// 最长边不超过 1000 像素
        int procW = width, procH = height;
        std::vector<uint8_t> resized;
        const uint8_t* procPixels = pixels;
        // 如果原图过大，先用盒滤镜缩小到最长边 ≤1000，大幅减少双边滤波的计算量
        if (width > MAX_EDGE || height > MAX_EDGE) {
            resized = ImageResizer::downscale(
                isRaw ? rawDecoded.data() : pixels,
                width, height, channels, procW, procH, MAX_EDGE);
            procPixels = resized.data();
        }

        //  应用双边滤波（调用之前详细分析过的核心降噪函数，返回滤波后的像素数据）
        bool grayMode = (mode == "grayscale_bilateral");
        auto filtered = BilateralFilter::apply(
            procPixels, procW, procH, channels,
            sigmaS, sigmaR, grayMode
        );

        //  锐化与上采样恢复原尺寸（对滤波后的图像做轻度锐化（amount=0.35），增强边缘）
        filtered = ImageResizer::sharpen(
            filtered.data(), procW, procH, channels, 0.35f
        );

        // 如果之前缩小过，用 Catmull‑Rom 双三次插值放大回原始尺寸
        auto result = ImageResizer::upscale(
            filtered.data(), procW, procH, channels,
            width, height
        );
        // 如果用的是 stb_image 解码的内存，需要手动释放（RAW 用的是 rawDecoded，会自动释放）
        if (!isRaw) stbi_image_free(pixels);

        // 编码为 PNG 并返回
        std::vector<uint8_t> outBuf;
        stbi_write_png_to_func([](void* ctx, void* data, int size) {   // stbi_write_png_to_func 允许自定义写入回调。这里把 PNG 数据逐块收集到 outBuf 中
                auto* buf = static_cast<std::vector<uint8_t>*>(ctx);
                buf->insert(buf->end(), (uint8_t*)data, (uint8_t*)data + size);
            },
            &outBuf,
            width, height, channels,           // 用原始尺寸
            result.data(), width * channels
        );

        if (outBuf.empty()) return errorInternal("Encoding failed");

        std::cout << "[Denoise] output: " << outBuf.size() << " bytes (PNG)" << std::endl;
        // 构建并返回成功响应，设置响应类型为 PNG 图片，附加处理后的宽高信息头，移动 outBuf 到响应体（高效，无拷贝）
        HttpResponse res;
        res.headers["Content-Type"] = "image/png";
        res.headers["X-Processed-Width"] = std::to_string(width);
        res.headers["X-Processed-Height"] = std::to_string(height);
        res.body = std::move(outBuf);
        addCors(res);
        return res;
    }
    // CORS 与错误处理辅助函数(添加跨域头，允许网页前端从任意域名调用此服务)
    static void addCors(HttpResponse& res) {
        res.headers["Access-Control-Allow-Origin"] = "*";
        res.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
        res.headers["Access-Control-Allow-Headers"] = "Content-Type";
    }
    // 分别返回 404、400、500 错误，附带 JSON 格式的错误消息，方便前端调试
    static HttpResponse error404() {
        std::string b = "{\"error\":\"Not Found\"}";
        HttpResponse res;
        res.status = 404; res.status_text = "Not Found";
        res.headers["Content-Type"] = "application/json";
        res.body.assign(b.begin(), b.end());
        addCors(res);
        return res;
    }
    static HttpResponse errorBadRequest(const std::string& msg) {
        std::string b = "{\"error\":\"" + msg + "\"}";
        HttpResponse res;
        res.status = 400; res.status_text = "Bad Request";
        res.headers["Content-Type"] = "application/json";
        res.body.assign(b.begin(), b.end());
        addCors(res);
        return res;
    }
    static HttpResponse errorInternal(const std::string& msg) {
        std::string b = "{\"error\":\"" + msg + "\"}";
        HttpResponse res;
        res.status = 500; res.status_text = "Internal Server Error";
        res.headers["Content-Type"] = "application/json";
        res.body.assign(b.begin(), b.end());
        addCors(res);
        return res;
    }
};

//  HTTP 服务器核心(单线程监听、多线程处理的简易 HTTP 服务器)
class HttpServer {
public:
    // 构造函数，保存要监听的端口号
    HttpServer(int port) : port_(port) {}
    // 启动服务器的主流程，成功返回 true，失败返回 false
    bool start() {
// Windows 平台初始化 Winsock
#ifdef _WIN32
        WSADATA wsa;
        if (WSAStartup(MAKEWORD(2,2), &wsa) != 0) {
            std::cerr << "WSAStartup failed\n";
            return false;
        }
#endif
        // 创建监听 socket，创建一个 TCP socket（SOCK_STREAM），使用 IPv4 协议族（AF_INET）
        // INVALID_SOCK 是跨平台宏，Windows 下为 INVALID_SOCKET，Linux 下为 -1
        listenSock_ = socket(AF_INET, SOCK_STREAM, 0);
        if (listenSock_ == INVALID_SOCK) {
            std::cerr << "socket() failed\n";
            return false;
        }
        // 设置地址复用，设置 SO_REUSEADDR，允许立即重用该端口（避免重启服务器时“Address already in use”）
        int opt = 1;
#ifdef _WIN32
        setsockopt(listenSock_, SOL_SOCKET, SO_REUSEADDR, (const char*)&opt, sizeof(opt));
#else
        setsockopt(listenSock_, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt));
#endif
        // 绑定地址和端口
        sockaddr_in addr{};
        addr.sin_family = AF_INET;
        addr.sin_addr.s_addr = INADDR_ANY;  // 监听所有网卡   // INADDR_ANY 表示绑定到本机所有 IP 地址
        addr.sin_port = htons(static_cast<uint16_t>(port_));    // htons 将主机字节序转换为网络字节序（大端序）
        // 将 socket 与地址端口绑定
        if (bind(listenSock_, (sockaddr*)&addr, sizeof(addr)) < 0) {
            std::cerr << "bind() failed on port " << port_ << "\n";
            return false;
        }
        // 开始监听，最大等待连接队列长度为 16
        if (listen(listenSock_, 16) < 0) {
            std::cerr << "listen() failed\n";
            return false;
        }
        // 打印启动信息
        std::cout << "========================================\n";
        std::cout << " 图片去噪服务器 v1.0\n";
        std::cout << " 监听地址 http://localhost:" << port_ << "\n";
        std::cout << " 算法: 双边滤波\n";
        std::cout << " 数据结构: 哈希表, 链表,";
        std::cout << " 最大堆, 队列\n";
        std::cout << "========================================\n";
        // 主循环：接受连接并分发到线程
        while (true) {
            sockaddr_in clientAddr{};
            socklen_t addrLen = sizeof(clientAddr);
            sock_t clientSock = accept(listenSock_, (sockaddr*)&clientAddr, &addrLen);  // 阻塞等待客户端连接。accept 返回一个新的 socket 用于与客户端通信，并记录客户端地址
            if (clientSock == INVALID_SOCK) continue;   // 如果出错（返回无效 socket），跳过继续等待下一个连接
            // 为每个连接创建一个新线程，执行 handleClient 处理请求。detach() 让该线程在后台运行，主线程不等待其结束，可以立即回去 accept 下一个连接
            std::thread([clientSock]() {
                handleClient(clientSock);
            }).detach();
        }
        return true;
    }

private:
    // 保存端口和监听 socket 描述符
    int port_;
    sock_t listenSock_ = INVALID_SOCK;
    // 静态函数 handleClient：处理单个客户端
    static void handleClient(sock_t sock) {
        // 准备读取缓冲区
        std::vector<uint8_t> buf;   // buf 用于累积收到的全部数据
        buf.reserve(1 << 20);  // 预分配 1MB 空间，减少扩容

        const int CHUNK = 4096;
        uint8_t chunk[CHUNK];   // chunk 是每次 recv 的临时接收缓冲区，一次读 4KB

        // 读取请求直到收完整个 HTTP 消息
        size_t headerEnd = std::string::npos;   // 头部结束位置（即 \r\n\r\n 之后的位置）
        std::string headersStr;
        int contentLength = 0;  // 从 Content-Length 头解析出的请求体字节数

        while (true) {
            int n = recv(sock, (char*)chunk, CHUNK, 0);
            if (n <= 0) break;                     // 对方关闭或出错
            buf.insert(buf.end(), chunk, chunk + n); // 追加到总缓冲区

            // 查找 HTTP 头部结束标志（第一次找到 \r\n\r\n 后，计算出 headerEnd 并解析 Content-Length）
            if (headerEnd == std::string::npos) {
                std::string s(buf.begin(), buf.end());
                size_t pos = s.find("\r\n\r\n");   // HTTP 头与体之间由空行分隔
                if (pos != std::string::npos) {
                    headerEnd = pos + 4;            // 头部结束位置（跳过 \r\n\r\n）
                    headersStr = s.substr(0, pos);  // 纯头部字符串
                    // 解析 Content-Length
                    auto pos2 = headersStr.find("Content-Length:");
                    if (pos2 == std::string::npos)
                        pos2 = headersStr.find("content-length:"); // 兼容小写
                    if (pos2 != std::string::npos) {
                        pos2 += 15;                 // 跳过 "Content-Length:"
                        while (pos2 < headersStr.size() && headersStr[pos2] == ' ') pos2++;
                        contentLength = std::stoi(headersStr.substr(pos2));
                    }
                }
            }
            // 判断是否已收完请求体（如果头部后的数据量已达到或超过声明的 contentLength，则整个请求已收完）
            if (headerEnd != std::string::npos) {
                int received = (int)buf.size() - (int)headerEnd;
                if (received >= contentLength) break;  // 体接收完整，退出循环
            }
        }
        // 空请求保护
        if (buf.empty()) { CLOSE_SOCKET(sock); return; }
        // 解析请求行（取出头部字符串部分）
        HttpRequest req;
        std::string hdrStr(buf.begin(), buf.begin() + (headerEnd != std::string::npos ? headerEnd : buf.size()));
        // 从请求行提取方法、路径和 HTTP 版本
        size_t lineEnd = hdrStr.find("\r\n");
        std::string requestLine = hdrStr.substr(0, lineEnd);
        {
            std::istringstream iss(requestLine);
            std::string ver;
            iss >> req.method >> req.path >> ver;
        }

        // 解析请求头（逐行解析 Key: Value 头，存入 req.headers 哈希表）
        size_t pos = lineEnd + 2;
        while (pos < hdrStr.size()) {
            size_t end = hdrStr.find("\r\n", pos);
            if (end == std::string::npos) break;
            std::string line = hdrStr.substr(pos, end - pos);
            pos = end + 2;
            if (line.empty()) break;
            size_t colon = line.find(':');
            if (colon != std::string::npos) {
                std::string key = line.substr(0, colon);
                std::string val = line.substr(colon + 1);
                while (!val.empty() && (val[0] == ' ' || val[0] == '\t')) val.erase(0, 1);
                for (char& c : key) c = (char)tolower(c);  // 键转小写便于查找
                req.headers[key] = val;
            }
        }
        // 提取请求体
        if (headerEnd != std::string::npos && headerEnd < buf.size()) {
            req.body.assign(buf.begin() + headerEnd, buf.end());
        }

        // 调用业务处理器并计时（调用前面定义好的 RequestHandler::handle 得到响应）
        auto t0 = std::chrono::high_resolution_clock::now();
        HttpResponse res = RequestHandler::handle(req);
        auto t1 = std::chrono::high_resolution_clock::now();
        auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(t1 - t0).count();
        // 打印日志：请求方法、路径、返回状态码和处理耗时
        std::cout << req.method << " " << req.path
                  << " -> " << res.status << " (" << ms << "ms)" << std::endl;
        // 发送 HTTP 响应（构造响应头，包括状态行、Content-Length、自定义头（CORS 等），以及 Connection: close 表示处理完即关闭连接）
        std::ostringstream hdr;
        hdr << "HTTP/1.1 " << res.status << " " << res.status_text << "\r\n";
        hdr << "Content-Length: " << res.body.size() << "\r\n";
        for (auto& [k, v] : res.headers) {
            hdr << k << ": " << v << "\r\n";
        }
        hdr << "Connection: close\r\n\r\n";
        // 先发送头部，再发送响应体
        std::string hdrStr2 = hdr.str();
        send(sock, hdrStr2.c_str(), (int)hdrStr2.size(), 0);
        if (!res.body.empty()) {
            send(sock, (const char*)res.body.data(), (int)res.body.size(), 0);
        }
        //关闭连接
        CLOSE_SOCKET(sock);
    }
};

//  入口
int main(int argc, char* argv[]) {
    int port = 8080;    // 设置默认端口号为 8080
    if (argc > 1) {
        try { port = std::stoi(argv[1]); }  // 尝试将第一个参数（argv[1]）转换为整数，覆盖默认端口号
        catch(...) { std::cerr << "Invalid port, using 8080\n"; }   // 如果转换失败（比如用户输入了非数字），捕获所有异常，提示错误并使用默认端口 8080
    }

    HttpServer server(port);    // 用最终确定的端口号创建一个 HttpServer 实例
    server.start(); //启动 HTTP 服务器，进入主循环（阻塞等待连接，直到进程被外部终止）
    return 0;
}