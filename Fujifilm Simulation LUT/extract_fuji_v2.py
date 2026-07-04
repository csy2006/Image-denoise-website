#!/usr/bin/env python3
"""
Extract LUT data from Fuji XMP files.
Correct Adobe Base91 decoding.
"""
import re, struct, json, os

# Correct Adobe Base91 decode (from base91 spec)
def base91_decode(data):
    """Decode Base91 encoded data. data is a string of chars '!' to '}'."""
    v = -1
    b = 0
    n = 0
    out = bytearray()
    for ch in data:
        c = ord(ch)
        if 33 <= c <= 125:  # '!' to '}'
            c -= 33
            if v == -1:
                v = c
            else:
                v += c * 91
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
        if n:
            b |= v << n
        while n > 0:
            out.append(b & 0xff)
            b >>= 8
            n -= 8
    return bytes(out)

def extract_lut_from_xmp(xmp_path):
    with open(xmp_path, 'rb') as f:
        text = f.read().decode('utf-8', errors='ignore')
    
    # Find crs:Table_XXX="..." 
    # The XXX is a hash, the value is the encoded LUT data
    m = re.search(r'crs:Table_([A-Fa-f0-9]+)="([^"]+)"', text)
    if not m:
        return None, None
    
    lut_str = m.group(2)
    
    # Skip 'Lir00' prefix if present (Adobe LUT magic)
    if lut_str.startswith('Lir00'):
        lut_str = lut_str[5:]
    
    # Base91 decode
    decoded = base91_decode(lut_str)
    return decoded, os.path.basename(xmp_path).replace('.xmp', '')

def convert_lut_to_js(lut_bytes, name, output_dir):
    """
    Convert decoded LUT bytes to our lut_data.js format.
    The decoded data is 16-bit values (0-65535).
    We convert to 8-bit (0-255) for web use.
    """
    # Try to determine LUT size
    # Common sizes: 32, 33, 64
    n_vals = len(lut_bytes) // 2  # 16-bit values
    n_cells = n_vals // 3  # RGB cells
    
    # Find nearest cube root
    size = round(n_cells ** (1/3))
    if size * size * size * 3 * 2 == len(lut_bytes):
        actual_size = size
    else:
        # Try nearby sizes
        actual_size = None
        for s in [32, 33, 64, 17, 16]:
            if s * s * s * 3 * 2 == len(lut_bytes):
                actual_size = s
                break
        if actual_size is None:
            # Unknown size - try to infer from data
            # Adobe LUT is often 32 or 33
            for s in range(16, 129):
                if s * s * s * 3 * 2 == len(lut_bytes):
                    actual_size = s
                    break
    
    if actual_size is None:
        print(f'  WARNING: Cannot determine LUT size for {name}, got {len(lut_bytes)} bytes, {n_vals} values')
        # Guess: assume 32
        actual_size = 32
    
    print(f'  LUT size: {actual_size}^3, {len(lut_bytes)} bytes')
    
    # Parse as 16-bit uint16 LE
    n_vals = len(lut_bytes) // 2
    vals_16 = struct.unpack('<' + 'H' * n_vals, lut_bytes)
    
    # Convert to 8-bit (0-255)
    # Adobe uses 0-65535 range, map to 0-255
    vals_8 = [max(0, min(255, int(v * 255.0 / 65535.0))) for v in vals_16]
    
    return {
        'size': actual_size,
        'lut': vals_8
    }

def main():
    xmp_dir = 'C:/Users/20521/Desktop/文件夹/大学/数据结构/项目/Image denoise website/frontend/Fujifilm Simulation LUT'
    output_path = 'C:/Users/20521/Desktop/文件夹/大学/数据结构/项目/Image denoise website/frontend/filters/fuji_luts.js'
    
    # Find all XMP files (exclude wrappers)
    xmp_files = sorted([f for f in os.listdir(xmp_dir) 
                       if f.endswith('.xmp') and 'wrapper' not in f.lower()])
    
    print(f'Found {len(xmp_files)} LUT files')
    
    results = {}
    for xmp_file in xmp_files:
        xmp_path = os.path.join(xmp_dir, xmp_file)
        name = xmp_file.replace('.xmp', '')
        print(f'\n=== {name} ===')
        
        decoded, _ = extract_lut_from_xmp(xmp_path)
        if decoded is None:
            print(f'  ERROR: No LUT data found')
            continue
        
        print(f'  Decoded: {len(decoded)} bytes')
        
        lut_data = convert_lut_to_js(decoded, name, None)
        results[name] = lut_data
        print(f'  Converted: size={lut_data["size"]}, {len(lut_data["lut"])} values')
    
    # Save as JS file (matching existing lut_data.js format)
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write('// Fuji Film Simulation LUTs - extracted from XMP\n')
        f.write('// Auto-generated - do not edit manually\n\n')
        f.write('window.__FUJI_LUT_DATA__ = ')
        json.dump(results, f, separators=(',', ':'))
        f.write(';\n')
    
    print(f'\nSaved {len(results)} LUTs to {output_path}')
    print(f'File size: {os.path.getsize(output_path)} bytes')

if __name__ == '__main__':
    main()
