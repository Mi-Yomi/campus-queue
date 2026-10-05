"""Original two-note bell for RITM; standard-library PCM WAV, no external samples."""
import math
import struct
import wave
from pathlib import Path

rate = 44100
duration = 1.25
samples = []
for i in range(round(rate * duration)):
    t = i / rate
    value = 0.0
    for start, frequency in ((0, 1174.66), (0.24, 1567.98)):
        age = t - start
        if age >= 0:
            attack = min(1, age / 0.004)
            release = min(1, max(0, (duration - t) / 0.08))
            value += attack * release * (
                0.42 * math.sin(2 * math.pi * frequency * age) * math.exp(-6 * age)
                + 0.13 * math.sin(2 * math.pi * frequency * 2.76 * age) * math.exp(-11 * age)
                + 0.045 * math.sin(2 * math.pi * frequency * 5.4 * age) * math.exp(-18 * age)
            )
    samples.append(value)
peak = max(abs(value) for value in samples)
target = Path(__file__).resolve().parents[1] / 'public/media/call-chime.wav'
with wave.open(str(target), 'wb') as out:
    out.setnchannels(1)
    out.setsampwidth(2)
    out.setframerate(rate)
    out.writeframes(b''.join(struct.pack('<h', round(value / peak * 0.82 * 32767)) for value in samples))
print(f'Created {target.name}: {duration}s, mono PCM')
