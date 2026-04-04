#!/usr/bin/env python3
"""
Yapay Zihin Nis - Icon Uretici
Bagimsiz kutuphane gerektirmez, saf Python ile PNG olusturur.
Calistirma: python3 generate_icons.py
"""
import struct
import zlib
import os
import math


def pack_chunk(name: bytes, data: bytes) -> bytes:
    """PNG chunk paketi olustur."""
    crc = zlib.crc32(name + data) & 0xFFFFFFFF
    return struct.pack('>I', len(data)) + name + data + struct.pack('>I', crc)


def is_in_rounded_rect(x, y, w, h, r):
    """Noktanin yuvarlatilmis dikdortgen icinde olup olmadigini kontrol et."""
    dx = max(0, r - x, x - (w - 1 - r))
    dy = max(0, r - y, y - (h - 1 - r))
    return dx * dx + dy * dy <= r * r


def lerp(a, b, t):
    return a + (b - a) * t


def clamp(v, lo=0, hi=255):
    return max(lo, min(hi, int(v)))


def draw_lightning(x, y, cx, cy, size):
    """
    Merkeze gore normalize edilmis yildirimi (lightning bolt) olustur.
    1 donerse piksel icinde, 0 donerse disinda.
    """
    # Yildirim seklini normalize koordinatlarda tanimla (-0.5..0.5 arasi)
    nx = (x - cx) / size
    ny = (y - cy) / size

    # Yildirim iki bolumden olusur: ust ve alt diyagonal cubuk
    # Ust: (-0.05, -0.45) -> (0.18, -0.02)
    # Alt: (-0.18, 0.02) -> (0.05, 0.45)
    def seg_dist(px, py, ax, ay, bx, by):
        """Nokta ile dogru parcasi arasindaki mesafe."""
        dx, dy = bx - ax, by - ay
        length_sq = dx * dx + dy * dy
        if length_sq == 0:
            return math.sqrt((px - ax) ** 2 + (py - ay) ** 2)
        t = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / length_sq))
        return math.sqrt((px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2)

    thick = 0.07  # kalinlik
    d1 = seg_dist(nx, ny, -0.04, -0.46, 0.20, -0.02)
    d2 = seg_dist(nx, ny, -0.20, 0.02, 0.04, 0.46)

    return min(d1, d2) < thick


def create_icon(size):
    """Belirtilen boyutta RGBA PNG ikonu olustur."""
    w = h = size
    r_corner = max(2, round(size * 0.22))
    cx, cy = (w - 1) / 2.0, (h - 1) / 2.0

    rows = []
    for y in range(h):
        row = bytearray([0])  # filtre = None
        for x in range(w):
            if not is_in_rounded_rect(x, y, w, h, r_corner):
                row.extend([0, 0, 0, 0])  # saydam
                continue

            # Mor degrade: sol-ust koyu -> sag-alt acik
            tx = x / max(w - 1, 1)
            ty = y / max(h - 1, 1)
            t  = tx * 0.45 + ty * 0.55

            # Koyu mor (#4c1d95) -> Orta mor (#7c3aed) -> Acik mor (#a78bfa)
            pr = lerp(76,  167, t)
            pg = lerp(29,  139, t)
            pb = lerp(149, 250, t)

            # Merkeze dogru parlaklik vurgusu
            dist_c  = math.sqrt((x - cx) ** 2 + (y - cy) ** 2)
            max_d   = math.sqrt(cx ** 2 + cy ** 2)
            glow    = max(0.0, 1.0 - (dist_c / max(max_d, 1)) * 1.6) * 35
            pr += glow; pg += glow * 0.6; pb += glow * 0.3

            # Buyuk ikonlarda yildirim sembolunu ciz
            if size >= 32 and draw_lightning(x, y, cx, cy, size):
                # Beyaz / sari yildirim
                pr = lerp(pr, 255, 0.92)
                pg = lerp(pg, 230, 0.92)
                pb = lerp(pb, 80,  0.92)

            row.extend([clamp(pr), clamp(pg), clamp(pb), 255])

        rows.append(bytes(row))

    raw        = b''.join(rows)
    compressed = zlib.compress(raw, 6)

    # IHDR: width(4B) height(4B) bit_depth(1B) color_type(1B=6=RGBA)
    #       compression(1B) filter(1B) interlace(1B) = 13 bytes
    png  = b'\x89PNG\r\n\x1a\n'
    png += pack_chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
    png += pack_chunk(b'IDAT', compressed)
    png += pack_chunk(b'IEND', b'')
    return png


if __name__ == '__main__':
    script_dir = os.path.dirname(os.path.abspath(__file__))
    icons_dir  = os.path.join(script_dir, 'icons')
    os.makedirs(icons_dir, exist_ok=True)

    for size in [16, 48, 128]:
        data = create_icon(size)
        path = os.path.join(icons_dir, f'icon{size}.png')
        with open(path, 'wb') as f:
            f.write(data)
        print(f'[OK] {path}  ({size}x{size}, {len(data)} bytes)')

    print('\nIkonlar basariyla olusturuldu!')
