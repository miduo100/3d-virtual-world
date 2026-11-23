"""
生成 6 段环境音（循环友好），供音效库 ②模型声源 / ③环境声景 使用。
纯标准库，无第三方依赖。44.1kHz / 16bit / 单声道。

输出目录：public/uploads/character-templates/sounds/
文件名前缀 env-，便于在音效库下拉里一眼认出。
"""
import math, os, random, struct, wave

SR = 44100
LOOP_SEC = 3.0          # 最终循环长度
XFADE = 0.20            # 首尾交叉淡化长度
RAW_SEC = LOOP_SEC + XFADE
PEAK = 0.5              # 归一化到 -6dB，留足够余量

OUT_DIR = r"L:/游戏专家团测试/shegnjir185/public/uploads/character-templates/sounds"

random.seed(20261103)


def lowpass(x, fc, sr=SR):
    a = (2 * math.pi * fc / sr) / (2 * math.pi * fc / sr + 1)
    y = [0.0] * len(x)
    prev = 0.0
    for i, v in enumerate(x):
        prev = prev + a * (v - prev)
        y[i] = prev
    return y


def highpass(x, fc, sr=SR):
    a = (2 * math.pi * fc / sr) / (2 * math.pi * fc / sr + 1)
    y = [0.0] * len(x)
    prev_in = 0.0
    prev_out = 0.0
    for i, v in enumerate(x):
        prev_out = a * (prev_out + v - prev_in)
        prev_in = v
        y[i] = prev_out
    return y


def bandpass(x, lo, hi, sr=SR):
    return highpass(lowpass(x, hi, sr), lo, sr)


def white(n):
    return [random.uniform(-1, 1) for _ in range(n)]


def brown(n):
    out = [0.0] * n
    last = 0.0
    for i in range(n):
        last = (last + 0.02 * random.uniform(-1, 1)) / 1.02
        out[i] = last * 3.5
    return out


def lfo(n, hz, depth, base=1.0):
    """慢速幅度调制，让声音有起伏而不是一条直线"""
    w = 2 * math.pi * hz / SR
    return [base + depth * math.sin(w * i) for i in range(n)]


def crossfade_loop(raw, final_len, xfade_len):
    """把尾部提前与头部做等功率交叉，使循环接缝听不出来。

    关键：out[0] 必须接在 out[-1] 后面，所以开头的 xfade 段应该由
    raw[final..] 淡出 + raw[0..] 淡入 —— 即 raw[final] 在 out[0] 处权重为 1。
    权重写反会让循环点从 raw[final-1] 直接跳回 raw[0]，产生明显"啪"声。
    """
    out = raw[:final_len]
    for i in range(xfade_len):
        t = i / xfade_len
        a = math.sin(t * math.pi / 2)   # raw[i] 渐入
        b = math.cos(t * math.pi / 2)   # raw[final+i] 渐出
        out[i] = raw[i] * a + raw[final_len + i] * b
    return out


def normalize(x, peak=PEAK):
    m = max(abs(v) for v in x) or 1.0
    return [v / m * peak for v in x]


def write_wav(name, samples):
    path = os.path.join(OUT_DIR, name)
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        frames = bytearray()
        for v in samples:
            s = int(max(-1.0, min(1.0, v)) * 32767)
            frames += struct.pack("<h", s)
        w.writeframes(bytes(frames))
    print("  %-18s %6.1f KB  %d 采样" % (name, os.path.getsize(path) / 1024, len(samples)))


# ─── 六种环境音 ───────────────────────────────────────────────

def gen_wind():
    n = int(SR * RAW_SEC)
    base = lowpass(brown(n), 420)
    mod = lfo(n, 0.18, 0.45)          # 风的一阵阵强弱
    return [base[i] * mod[i] for i in range(n)]


def gen_water():
    n = int(SR * RAW_SEC)
    base = bandpass(white(n), 900, 4200)
    base = [v * 0.5 for v in base]
    # 不规则水滴：随机短促高频脉冲
    i = 0
    while i < n - 2000:
        if random.random() < 0.0012:
            dur = random.randint(600, 1800)
            amp = random.uniform(0.25, 0.7)
            f = random.uniform(1400, 3200)
            for k in range(dur):
                if i + k >= n:
                    break
                env = math.exp(-k / (dur * 0.25))
                base[i + k] += amp * env * math.sin(2 * math.pi * f * k / SR)
            i += dur
        i += 1
    return base


def gen_fire():
    n = int(SR * RAW_SEC)
    base = lowpass(brown(n), 700)
    base = [v * 0.7 for v in base]
    # 爆裂声
    i = 0
    while i < n - 1500:
        if random.random() < 0.0016:
            dur = random.randint(300, 900)
            amp = random.uniform(0.3, 0.9)
            for k in range(dur):
                if i + k >= n:
                    break
                env = math.exp(-k / (dur * 0.18))
                base[i + k] += amp * env * random.uniform(-1, 1) * 0.8
            i += dur
        i += 1
    return base


def gen_birds():
    n = int(SR * RAW_SEC)
    base = [0.0] * n
    i = int(SR * 0.2)
    while i < n - 4000:
        notes = random.randint(1, 3)
        for _ in range(notes):
            dur = random.randint(1200, 2600)
            f0 = random.uniform(2200, 3400)
            f1 = f0 * random.uniform(1.15, 1.5)
            amp = random.uniform(0.25, 0.55)
            for k in range(dur):
                if i + k >= n:
                    break
                env = math.sin(math.pi * k / dur) ** 2
                f = f0 + (f1 - f0) * (k / dur)
                base[i + k] += amp * env * math.sin(2 * math.pi * f * k / SR)
            i += dur + random.randint(300, 900)
        i += random.randint(int(SR * 0.4), int(SR * 1.1))
    # 铺一点极轻的风底，避免纯鸟叫太干
    bg = lowpass(brown(n), 300)
    return [base[i] + bg[i] * 0.12 for i in range(n)]


def gen_city():
    n = int(SR * RAW_SEC)
    rumble = lowpass(brown(n), 160)
    hiss = bandpass(white(n), 300, 1400)
    mod = lfo(n, 0.09, 0.3)
    out = [rumble[i] * 0.8 + hiss[i] * 0.18 * mod[i] for i in range(n)]
    # 远处车流掠过：带通扫频
    for _ in range(2):
        start = random.randint(int(SR * 0.2), n - int(SR * 1.2))
        dur = int(SR * random.uniform(0.6, 1.0))
        for k in range(dur):
            if start + k >= n:
                break
            env = math.sin(math.pi * k / dur) ** 2
            out[start + k] += env * 0.10 * random.uniform(-1, 1)
    return out


def gen_leaves():
    n = int(SR * RAW_SEC)
    base = highpass(white(n), 1800)
    mod = lfo(n, 0.55, 0.6)
    mod2 = lfo(n, 1.7, 0.25)
    return [base[i] * 0.35 * mod[i] * mod2[i] for i in range(n)]


def main():
    if not os.path.isdir(OUT_DIR):
        print("目录不存在:", OUT_DIR)
        return
    print("输出到", OUT_DIR)
    jobs = [
        ("env-wind.wav", gen_wind, "风（树林/旷野底噪）"),
        ("env-water.wav", gen_water, "水（喷泉/溪流）"),
        ("env-fire.wav", gen_fire, "火（篝火/火盆）"),
        ("env-birds.wav", gen_birds, "鸟叫（林间点缀）"),
        ("env-city.wav", gen_city, "城市低鸣（街区底噪）"),
        ("env-leaves.wav", gen_leaves, "树叶沙沙（树冠）"),
    ]
    final_len = int(SR * LOOP_SEC)
    xf = int(SR * XFADE)
    for name, fn, desc in jobs:
        raw = fn()
        looped = crossfade_loop(raw, final_len, xf)
        write_wav(name, normalize(looped))
        print("     " + desc)
    print("完成")


if __name__ == "__main__":
    main()
