#!/usr/bin/env python3
"""
inject_i18n.py — 给 index.html 中的文本元素批量添加 data-i18n 属性
用法：python3 inject_i18n.py
"""
import re, os

HTML = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'index.html')
html = open(HTML, encoding='utf-8').read()

# 每条规则：(key, 中文文本, 匹配模式)
# 模式：'tag' = 在标签的 textContent 中；'attr' = 作为属性值
rules = [
    # 欢迎遮罩
    ('welcomeSubtitle', '棱镜降噪 · 图像降噪处理平台', 'text'),
    ('welcomeHint', '点击任意位置进入', 'text'),

    # 状态栏
    ('statusConnecting', '等待后端连接...', 'text'),

    # 导航栏
    ('navHome', '首页', 'navlink'),
    ('navFeatures', '核心特性', 'navlink'),
    ('navGuide', '参数指南', 'navlink'),
    ('navUpload', '图像降噪', 'navlink'),
    ('navResult', '降噪结果', 'navlink'),
    ('navTicket', '旅行票根', 'navlink'),
    ('navFilter', '创意滤镜', 'navlink'),
    ('navProfile', '个人中心', 'navlink'),

    # 首页
    ('heroKanji', 'Image Processing · Young__Yang', 'text'),
    ('btnDenoise', '即刻降噪', 'text'),
    ('btnFilter', '创意滤镜', 'text'),
    ('themeLight', '浅色', 'text'),
    ('themeDark', '深色', 'text'),

    # 核心特性
    ('featBilateral', '双边滤波算法', 'text'),
    ('featBilateralDesc', '空间权重与色彩权重联合保边去噪', 'text'),
    ('featDS', '数据结构', 'text'),
    ('featDSDesc', '综合运用哈希表、链表、大顶堆、队列等数据结构来管理处理流水线', 'text'),
    ('featCPP', 'C++ 后端', 'text'),
    ('featFormat', '多格式支持', 'text'),
    ('featFormatDesc', '支持 PNG、JPG、JPEG、RAW、BMP、TIFF、WebP 等主流图片格式输入', 'text'),
    ('btnViewGuide', '查看参数指南', 'text'),

    # 参数指南
    ('guideIntro', '调整降噪参数前', 'text'),
    ('guideSpace', '空间半径', 'text'),
    ('guideRange', '颜色阈值', 'text'),
    ('sigmaSScaleL', '1 − 3', 'text'),
    ('sigmaSScaleR', '15 − 强力', 'text'),
    ('sigmaRScaleL', '1 — 保边', 'text'),
    ('sigmaRScaleR', '100 — 平滑', 'text'),
    ('modeBilateral', '彩色双边', 'text'),
    ('modeGrayscale', '灰度 Y 通道', 'text'),
    ('btnGoParams', '去调整参数', 'text'),

    # 上传处理
    ('uploadTitle', '导入图片', 'text'),
    ('uploadHint', '拖拽或点击导入图片', 'text'),
    ('uploadFormat', '支持 PNG · JPG', 'text'),
    ('btnChangePhoto', '更换照片', 'text'),
    ('btnRemovePhoto', '移除照片', 'text'),
    ('metaName', '文件名', 'text'),
    ('metaFormat', '格式', 'text'),
    ('metaSize', '大小', 'text'),
    ('metaMake', '相机制造商', 'text'),
    ('metaModel', '相机型号', 'text'),
    ('metaAperture', '光圈', 'text'),
    ('metaShutter', '快门', 'text'),
    ('metaISO', 'ISO', 'text'),
    ('metaFocal', '焦距', 'text'),
    ('paramTitle', '降噪参数', 'text'),
    ('btnBackToGuide', '参数指南', 'text'),
    ('sigmaSLabel', '空间半径', 'text'),
    ('sigmaRLabel', '颜色阈值', 'text'),
    ('btnStartDenoise', '开始图像降噪', 'text'),
    ('processing', '处理中...', 'text'),

    # 降噪结果
    ('emptyTitle', '暂无处理结果', 'text'),
    ('emptyDesc', '请先前往上传处理页面', 'text'),
    ('btnGoUpload', '去上传图片', 'text'),
    ('resultTiming', '处理耗时', 'text'),
    ('resultSigmaS', 'σs 空间半径', 'text'),
    ('resultSigmaR', 'σr 颜色阈值', 'text'),
    ('resultMode', '降噪模式', 'text'),
    ('resultTitle', '降噪结果', 'text'),
    ('saveFormat', '保存格式', 'text'),
    ('savePNG', 'PNG', 'text'),
    ('saveJPEG', 'JPEG', 'text'),
    ('saveWebP', 'WebP', 'text'),
    ('qualityLabel', '压缩质量', 'text'),
    ('btnSave', '保存图片', 'text'),
    ('btnNewImage', '处理新图片', 'text'),
    ('btnConfirm', '确定', 'text'),
    ('photoInfo', '照片信息', 'text'),
    ('fileInfo', '文件信息', 'text'),
    ('fileSize', '文件大小', 'text'),
    ('colorSpace', '颜色空间', 'text'),

    # 旅行票根
    ('ticketTitle', '旅行票根', 'text'),
    ('ticketDesc', '上传照片，生成专属电子旅行票根', 'text'),
    ('ticketUploadHint', '拖放或点击上传照片', 'text'),
    ('ticketUploadFormat', '支持 JPG / PNG / WebP', 'text'),
    ('ticketEditor', '编辑票根信息', 'text'),
    ('ticketDest', '目的地', 'text'),
    ('ticketDestHint', '纯英文大写建议15字符以内', 'text'),
    ('ticketLocation', '中文地名', 'text'),
    ('ticketDate', '日期', 'text'),
    ('ticketName', '旅行者', 'text'),
    ('ticketNo', '票号', 'text'),
    ('ticketCode', '防伪码', 'text'),
    ('btnRegenerate', '重新生成', 'text'),
    ('btnDownload', '下载票根', 'text'),
    ('btnReupload', '重新上传', 'text'),
    ('ticketOptions', '票根选项', 'text'),

    # 创意滤镜
    ('filterTitle', '创意滤镜', 'text'),
    ('filterDesc', '上传照片，一键应用胶片模拟滤镜', 'text'),
    ('filterUploadHint', '拖放或点击上传照片', 'text'),
    ('filterPreset', '选择滤镜预设', 'text'),
    ('filterCatSony', '创意外观', 'text'),
    ('filterCatFilm', '胶片模拟', 'text'),
    ('filterCatTone', '类色调', 'text'),
    ('filterFL', 'FL · 柔和', 'text'),
    ('filterNT', 'NT · 中性', 'text'),
    ('filterVV', 'VV · 鲜艳', 'text'),
    ('filterSH', 'SH · 暗部', 'text'),
    ('filterIN', 'IN · 即时', 'text'),
    ('filterPT', 'PT · 人像', 'text'),
    ('filterAS', 'AS · 柔和', 'text'),
    ('filterPN', 'PN · 负片', 'text'),
    ('filterCC', 'CC · Chrome', 'text'),
    ('filterTO', 'TO · 青橙', 'text'),
    ('filterOR', 'OR · 橙红', 'text'),
    ('btnSaveFilter', '保存图片', 'text'),
    ('btnReuploadFilter', '重新上传', 'text'),
    ('filterOptions', '滤镜选项', 'text'),

    # 个人中心
    ('profileName', 'Young__Yang', 'text'),
    ('profileBio', '哈希加速双边滤波', 'text'),
    ('statTitle', '使用统计', 'text'),
    ('statDenoise', '图像降噪', 'text'),
    ('statFilter', '创意滤镜', 'text'),
    ('statTicket', '旅行票根', 'text'),
    ('settingsTitle', '偏好设置', 'text'),
    ('darkMode', '深色模式', 'text'),
    ('darkModeAuto', '跟随系统', 'text'),
    ('vibrateTitle', '震动反馈', 'text'),
    ('vibrateiOS', 'iOS设备暂不支持', 'text'),
    ('langTitle', '语言 / Language', 'text'),
    ('langZh', '中文', 'text'),
    ('aboutTitle', '关于项目', 'text'),
    ('aboutName', 'PrismDen · 棱镜降噪', 'text'),
    ('aboutAlgo', '哈希加速双边滤波', 'text'),
    ('aboutDS', 'HashMap · LinkedList', 'text'),
    ('aboutTech', 'C++ · WebAssembly', 'text'),
    ('aboutAuthor', 'Young__Yang', 'text'),
    ('aboutVersion', 'v1.0.0', 'text'),
    ('dataTitle', '数据管理', 'text'),
    ('btnClearData', '清除本地使用统计', 'text'),

    # 页脚
    ('footer', '© 2026 Young__Yang', 'text'),

    # 对比浮层
    ('compareOriginal', '原图', 'text'),
    ('compareResult', '降噪后', 'text'),
]

# 按 key 去重
seen = set()
rules_unique = []
for key, text, mode in rules:
    if key not in seen:
        seen.add(key)
        rules_unique.append((key, text, mode))

def inject_span(m, key):
    """给匹配的文本包上 <span data-i18n="key">..."""
    prefix = m.group(1)  # 前面的标签/文本
    text = m.group(2)
    suffix = m.group(3)  # 后面的标签
    return prefix + '<span data-i18n="' + key + '">' + text + '</span>' + suffix

applied = 0
skipped = []

for key, text, mode in rules_unique:
    if text in ('', '--'):
        continue

    # 转义正则特殊字符
    escaped = re.escape(text)
    # 把省略号等中文标点转义
    escaped = escaped.replace('\\.\\.\\.', '…')

    # 模式1：>文本<  （纯文本节点）
    pat1 = r'(>[^<]*)(' + escaped + r')([^<]*<)'
    before = html
    html = re.sub(pat1, lambda m, k=key: inject_span(m, k), html)
    if html != before:
        applied += 1
        continue

    # 模式2：在属性值中（如 placeholder）
    pat2 = r'(' + escaped + r')'
    # 对 placeholder 等属性单独处理
    pat_placeholder = r'(placeholder=")(' + escaped + r')(")'
    before = html
    html = re.sub(pat_placeholder, r'\1<span data-i18n="' + key + '">\2</span>\3', html)
    if html != before:
        applied += 1
        continue

    skipped.append((key, text))

print(f'应用: {applied}, 跳过: {len(skipped)}')
if skipped:
    print('跳过项:')
    for k, t in skipped:
        print(f'  {k}: {t[:30]}')

open(HTML, 'w', encoding='utf-8').write(html)
print(f'已写入: {HTML}')
