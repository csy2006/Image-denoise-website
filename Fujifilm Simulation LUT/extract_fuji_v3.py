#!/usr/bin/env python3
"""
Correct Adobe Base91 decoder for XMP LUT data.
Reference: base91.c by Joachim Henke
"""
import re, struct, json, os

# Adobe Base91 alphabet: ASCII 33 '!' to 125 '}'
# Total 93 chars, but Base91 uses 91 of them

def adobe_base91_decode(encoded_str):
    """
    Decode Adobe Base91 encoded string.
    Base91 encodes 13 bits into 2 characters (91^2 = 8281 > 2^13 = 8192).
    """
    # Base91 decode table
    # Maps char to 13-bit value
    decoded = bytearray()
    v = -1
    b = 0
    n = 0
    
    for ch in encoded_str:
        c = ord(ch)
        if c < 33 or c > 125:
            continue  # skip invalid chars
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
                decoded.append(b & 0xff)
                b >>= 8
                n -= 8
            v = -1
    
    if v != -1:
        b |= v << n
        while n >= 8:
            decoded.append(b & 0xff)
            b >>= 8
            n -= 8
    
    return bytes(decoded)


def extract_lut_from_xmp(xmp_path):
    """Extract and decode LUT from Fuji XMP file."""
    with open(xmp_path, 'rb') as f:
        content = f.read()
    
    text = content.decode('utf-8', errors='ignore')
    
    # Find crs:Table_XXX="..." - the actual LUT data
    m = re.search(r'crs:Table_([A-Fa-f0-9]+)="([^"]+)"', text)
    if not m:
        print(f"  ERROR: No LUT data found in {os.path.basename(xmp_path)}")
        return None, None
    
    hash_val = m.group(1)
    lut_encoded = m.group(2)
    
    print(f"  Hash: {hash_val[:20]}...")
    print(f"  Encoded length: {len(lut_encoded)} chars")
    
    # Check for 'Lir00' prefix (Adobe LUT magic)
    offset = 0
    if lut_encoded.startswith('Lir'):
        # Skip "Lir00" (5 chars) or similar prefix
        # Find first newline or quote
        offset = 5  # skip "Lir00"
        print(f"  Found Lir magic, skipping {offset} chars")
        lut_encoded = lut_encoded[offset:]
    
    # Base91 decode
    lut_bytes = adobe_base91_decode(lut_encoded)
    print(f"  Decoded: {len(lut_bytes)} bytes")
    
    if len(lut_bytes) < 100:
        print(f"  ERROR: Decoded data too short!")
        return None, None
    
    return lut_bytes, os.path.basename(xmp_path).replace('.xmp', '')


def parse_and_convert_lut(lut_bytes, name):
    """
    Try to parse LUT bytes as 16-bit values and convert to 8-bit for web.
    Common LUT sizes: 32, 33, 64
    """
    # Try different sizes
    results = []
    for size in [32, 33, 64]:
        expected_8 = size * size * size * 3  # 8-bit
        expected_16 = size * size * size * 3 * 2  # 16-bit
        
        if len(lut_bytes) == expected_16:
            print(f"  -> MATCH: {size}^3 16-bit LUT ({len(lut_bytes)} bytes)")
            
            # Parse as 16-bit uint16 LE
            num_vals = len(lut_bytes) // 2
            vals_16 = struct.unpack('<' + 'H' * num_vals, lut_bytes)
            
            # Convert to 8-bit (0-255)
            # Adobe uses 0-65535 range, map to 0-255
            vals_8 = [max(0, min(255, int(v * 255.0 / 65535.0 + 0.5))) for v in vals_16]
            
            print(f"  16-bit range: [{min(vals_16)}, {max(vals_16)}]")
            print(f"  8-bit range: [{min(vals_8)}, {max(vals_8)}]")
            print(f"  First 9 values (first cell): {vals_8[:9]}")
            
            return vals_8, size
            
        elif len(lut_bytes) == expected_8:
            print(f"  -> MATCH: {size}^3 8-bit LUT ({len(lut_bytes)} bytes)")
            vals_8 = list(lut_bytes)
            print(f"  Range: [{min(vals_8)}, {max(vals_8)}]")
            return vals_8, size
    
    # No exact match
    print(f"  WARNING: No exact size match. Decoded {len(lut_bytes)} bytes.")
    print(f"  Trying to find nearest size...")
    
    # Try with header skip
    for header_skip in range(0, min(1000, len(lut_bytes)), 2):
        data = lut_bytes[header_skip:]
        for size in [32, 33, 64]:
            expected_16 = size * size * size * 3 * 2
            if len(data) == expected_16:
                print(f"  -> MATCH with {header_skip}-byte header: {size}^3 16-bit LUT")
                num_vals = len(data) // 2
                vals_16 = struct.unpack('<' + 'H' * num_vals, data)
                vals_8 = [max(0, min(255, int(v * 255.0 / 65535.0 + 0.5))) for v in vals_16]
                return vals_8, size
    
    print(f"  ERROR: Could not determine LUT size!")
    return None, None


def convert_all_fuji_luts(xmp_dir, output_js_path):
    """Convert all Fuji XMP LUTs to JS format for web use."""
    # Find all XMP files (exclude wrappers)
    xmp_files = sorted([f for f in os.listdir(xmp_dir) 
                       if f.endswith('.xmp') and 'wrapper' not in f.lower()])
    
    print(f"Found {len(xmp_files)} LUT files\n")
    
    results = {}
    
    for xmp_file in xmp_files:
        xmp_path = os.path.join(xmp_dir, xmp_file)
        name = xmp_file.replace('.xmp', '')
        
        print(f"=== {name} ===")
        
        lut_bytes, _ = extract_lut_from_xmp(xmp_path)
        if lut_bytes is None:
            continue
        
        vals_8, size = parse_and_convert_lut(lut_bytes, name)
        if vals_8 is None:
            continue
        
        results[name] = {
            'size': size,
            'lut': vals_8
        }
        print(f"  Converted: {name} ({size}^3, {len(vals_8)} values)\n")
    
    # Save as JS file (matching existing lut_data.js format)
    with open(output_js_path, 'w', encoding='utf-8') as f:
        f.write('// Fuji Film Simulation LUTs - extracted from XMP\n')
        f.write('// Auto-generated - do not edit manually\n\n')
        f.write('window.__FUJI_LUT_DATA__ = ')
        json.dump(results, f, separators=(',', ':'))
        f.write(';\n')
    
    print(f"Saved {len(results)} LUTs to {output_js_path}")
    print(f"File size: {os.path.getsize(output_js_path)} bytes")


if __name__ == '__main__':
    xmp_dir = 'C:/Users/20521/Desktop/文件夹/大学/数据结构/项目/Image denoise website/frontend/Fujifilm Simulation LUT'
    output_js = 'C:/Users/20521/Desktop/文件夹/大学/数据结构/项目/Image denoise website/frontend/filters/fuji_luts.js'
    
    convert_all_fuji_luts(xmp_dir, output_js)
