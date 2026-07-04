#!/usr/bin/env python3
"""
Extract Fuji LUTs from XMP files - CORRECT VERSION
"""
import re, struct, json, os

def adobe_base91_decode(encoded):
    """
    Correct Adobe Base91 decoder.
    Base91 encodes binary data using 91 printable ASCII chars ('!' to '}').
    """
    v = -1
    b = 0
    n = 0
    out = bytearray()
    
    for ch in encoded:
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
        b |= v << n
        while n >= 8:
            out.append(b & 0xff)
            b >>= 8
            n -= 8
    
    return bytes(out)


def extract_lut_bytes(xmp_path):
    """Extract raw LUT bytes from XMP file."""
    with open(xmp_path, 'rb') as f:
        text = f.read().decode('utf-8', errors='ignore')
    
    # Find: crs:Table_XXX="...."
    m = re.search(r'crs:Table_([A-Fa-f0-9]+)="([^"]+)"', text)
    if not m:
        return None, None
    
    lut_str = m.group(2)
    name = os.path.basename(xmp_path).replace('.xmp', '')
    
    print(f'  LUT string length: {len(lut_str)}')
    
    # Skip 'Lir00' prefix if present (5 chars, Adobe LUT magic)
    if lut_str.startswith('Lir'):
        print(f'  Found Lir magic, skipping 5 chars')
        lut_str = lut_str[5:]
    
    # Base91 decode
    decoded = adobe_base91_decode(lut_str)
    print(f'  Decoded: {len(decoded)} bytes')
    
    return decoded, name


def interpret_lut_bytes(data, name):
    """Try to interpret decoded bytes as 3D LUT."""
    if not data or len(data) < 100:
        return None, None
    
    # Try common LUT sizes
    # Format: size x size x size x 3 channels x 2 bytes (16-bit LE)
    candidates = []
    for size in [17, 32, 33, 64]:
        expected_16 = size * size * size * 3 * 2
        expected_8 = size * size * size * 3
        if len(data) == expected_16:
            candidates.append((size, 16, expected_16))
            print(f'  MATCH: {size}^3 16-bit LUT ({expected_16} bytes)')
        elif len(data) == expected_8:
            candidates.append((size, 8, expected_8))
            print(f'  MATCH: {size}^3 8-bit LUT ({expected_8} bytes)')
        else:
            print(f'  Size {size}: expected {expected_16} or {expected_8}, got {len(data)}')
    
    if candidates:
        size, bit, _ = candidates[0]
        return data, size
    
    # No exact match - try with header skip
    print(f'  No exact match. Trying with header skip...')
    for skip in range(0, 1000, 2):
        for size in [32, 33]:
            expected_16 = size * size * size * 3 * 2
            if len(data) - skip == expected_16:
                print(f'  MATCH with {skip}-byte skip: {size}^3 16-bit LUT')
                return data[skip:], size
    
    print(f'  ERROR: Cannot determine LUT size!')
    return None, None


def convert_to_js_format(lut_bytes, size):
    """Convert LUT bytes to 8-bit array for web use."""
    if len(lut_bytes) != size * size * size * 3 * 2:
        print(f'  WARNING: LUT size mismatch!')
        return None
    
    # Parse as 16-bit uint16 LE
    num_vals = len(lut_bytes) // 2
    vals_16 = struct.unpack('<' + 'H' * num_vals, lut_bytes)
    
    # Convert to 8-bit (0-255)
    # Adobe uses 0-65535 range, map to 0-255
    vals_8 = [max(0, min(255, int(v * 255.0 / 65535.0 + 0.5))) for v in vals_16]
    
    print(f'  16-bit range: [{min(vals_16)}, {max(vals_16)}]')
    print(f'  8-bit range: [{min(vals_8)}, {max(vals_8)}]')
    print(f'  First 9 values (first cell): {vals_8[:9]}')
    
    return vals_8


def main():
    xmp_dir = 'C:/Users/20521/Desktop/文件夹/大学/数据结构/项目/Image denoise website/frontend/Fujifilm Simulation LUT'
    output_js = 'C:/Users/20521/Desktop/文件夹/大学/数据结构/项目/Image denoise website/frontend/filters/fuji_luts.js'
    
    # Find XMP files
    xmp_files = sorted([f for f in os.listdir(xmp_dir) 
                       if f.endswith('.xmp') and 'wrapper' not in f.lower()])
    
    print(f'Found {len(xmp_files)} LUT files\n')
    
    results = {}
    
    for xmp_file in xmp_files:
        xmp_path = os.path.join(xmp_dir, xmp_file)
        name = xmp_file.replace('.xmp', '')
        
        print(f'=== {name} ===')
        
        # Extract and decode
        lut_bytes, _ = extract_lut_bytes(xmp_path)
        if not lut_bytes:
            print(f'  SKIP: No LUT data\n')
            continue
        
        # Interpret as LUT
        lut_data, size = interpret_lut_bytes(lut_bytes, name)
        if not lut_data:
            print(f'  SKIP: Cannot interpret LUT\n')
            continue
        
        # Convert to 8-bit
        vals_8 = convert_to_js_format(lut_data, size)
        if not vals_8:
            print(f'  SKIP: Conversion failed\n')
            continue
        
        results[name] = {
            'size': size,
            'lut': vals_8
        }
        print(f'  OK: {name} ({size}^3, {len(vals_8)} values)\n')
    
    # Save as JS
    if results:
        with open(output_js, 'w', encoding='utf-8') as f:
            f.write('// Fuji Film Simulation LUTs - extracted from XMP\n')
            f.write('// Auto-generated - do not edit manually\n\n')
            f.write('window.__FUJI_LUT_DATA__ = ')
            json.dump(results, f, separators=(',', ':'))
            f.write(';\n')
        
        print(f'Saved {len(results)} LUTs to {output_js}')
        print(f'File size: {os.path.getsize(output_js)} bytes')
    else:
        print('ERROR: No LUTs extracted!')


if __name__ == '__main__':
    main()
