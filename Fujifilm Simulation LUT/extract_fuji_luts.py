#!/usr/bin/env python3
"""
Extract LUT data from Fuji XMP files and convert to JSON for web use.
Adobe stores LUTs in XMP using Base91-like encoding in crs:Table_XXX attributes.
"""
import re, struct, json, os, zlib

def base91_decode(data):
    """Decode Adobe Base91 encoded data (ASCII 33-125)"""
    v = -1
    b = 0
    n = 0
    out = bytearray()
    for c in data:
        if '!' <= c <= '}':
            c_val = ord(c) - 33
            if v == -1:
                v = c_val
            else:
                v += c_val * 91
                b |= (v & 0x7f) << n
                n += 7
                v >>= 7
                b |= (v & 0x7f) << n
                n += 7
                v >>= 7
                while n >= 8:
                    out.append(b & 0xff)
                    b >>= 8
                    n -= 8
                v = -1
    if v != -1:
        b |= v << n
        while n >= 8:
            out.append(b & 0xff)
            b >>= 8
            n -= 8
    return bytes(out)

def extract_lut_from_xmp(xmp_path):
    """Extract LUT data from Fuji XMP file"""
    with open(xmp_path, 'rb') as f:
        text = f.read().decode('utf-8', errors='ignore')
    
    # Find the Table_ attribute with LUT data
    match = re.search(r'crs:Table_([A-Fa-f0-9]+)="([^"]+)"', text)
    if not match:
        print(f'  No LUT data found in {os.path.basename(xmp_path)}')
        return None, None
    
    hash_val = match.group(1)
    lut_str = match.group(2)
    
    # Skip 'Lir00' prefix (5 chars) - Adobe LUT magic
    if lut_str.startswith('Lir'):
        lut_str = lut_str[5:]
    
    # Base91 decode
    decoded = base91_decode(lut_str)
    print(f'  Decoded: {len(decoded)} bytes')
    
    return decoded, os.path.basename(xmp_path).replace('.xmp', '')

def parse_lut_data(decoded, name):
    """Try to parse decoded data as 16-bit 3D LUT"""
    results = []
    
    # Try different LUT sizes
    for size in [32, 33, 64, 129]:
        expected_8 = size * size * size * 3  # 8-bit
        expected_16 = size * size * size * 3 * 2  # 16-bit
        
        if len(decoded) == expected_16:
            print(f'  -> Match: {size}^3 16-bit LUT ({expected_16} bytes)')
            # Parse as 16-bit uint16 LE
            num_vals = len(decoded) // 2
            vals = struct.unpack('<' + 'H' * num_vals, decoded)
            # Convert to 8-bit (0-255) for web use
            vals_8 = [max(0, min(255, int(v * 255.0 / 65535.0))) for v in vals]
            return vals_8, size
        
        elif len(decoded) == expected_8:
            print(f'  -> Match: {size}^3 8-bit LUT ({expected_8} bytes)')
            vals = list(decoded)
            return vals, size
    
    # No exact match - try to find closest size
    print(f'  No exact size match. Trying to find closest...')
    print(f'  Decoded length: {len(decoded)} bytes = {len(decoded)//2} 16-bit values = {len(decoded)//6} cells')
    
    # Try size=32 with possible header
    for header_skip in range(0, 1000, 2):
        for size in [32, 33]:
            data = decoded[header_skip:]
            expected_16 = size * size * size * 3 * 2
            if len(data) == expected_16:
                print(f'  -> Match with {header_skip}-byte header: {size}^3 16-bit LUT')
                num_vals = len(data) // 2
                vals = struct.unpack('<' + 'H' * num_vals, data)
                vals_8 = [max(0, min(255, int(v * 255.0 / 65535.0))) for v in vals]
                return vals_8, size
    
    print(f'  ERROR: Could not determine LUT size!')
    return None, None

def convert_fuji_luts(xmp_dir, output_path):
    """Convert all Fuji XMP LUTs to JSON"""
    results = {}
    
    # Find all XMP files (exclude wrappers)
    xmp_files = [f for f in os.listdir(xmp_dir) 
                  if f.endswith('.xmp') and 'wrapper' not in f.lower()]
    xmp_files.sort()
    
    print(f'Found {len(xmp_files)} LUT files')
    
    for xmp_file in xmp_files:
        xmp_path = os.path.join(xmp_dir, xmp_file)
        name = xmp_file.replace('.xmp', '')
        print(f'\n=== {name} ===')
        
        decoded, _ = extract_lut_from_xmp(xmp_path)
        if decoded is None:
            continue
        
        vals, size = parse_lut_data(decoded, name)
        if vals is None:
            continue
        
        results[name] = {
            'size': size,
            'lut': vals
        }
        print(f'  Converted: {name} ({size}^3, {len(vals)} values)')
    
    # Save as JSON
    with open(output_path, 'w') as f:
        json.dump(results, f, separators=(',', ':'))
    
    print(f'\nSaved {len(results)} LUTs to {output_path}')
    print(f'Total size: {os.path.getsize(output_path)} bytes')

if __name__ == '__main__':
    xmp_dir = 'C:/Users/20521/Desktop/文件夹/大学/数据结构/项目/Image denoise website/frontend/Fujifilm Simulation LUT'
    output_path = 'C:/Users/20521/Desktop/文件夹/大学/数据结构/项目/Image denoise website/frontend/filters/fuji_luts.json'
    
    convert_fuji_luts(xmp_dir, output_path)
