#pragma once

// Included inside namespace modular after the generated wavetable spectra.
inline void wavetable_ifft(std::array<double, kWtSize> &real, std::array<double, kWtSize> &imag,
                           const std::array<double, kWtSize / 2> &cosine,
                           const std::array<double, kWtSize / 2> &sine) {
    for (size_t i = 1, j = 0; i < kWtSize; ++i) {
        size_t bit = kWtSize / 2;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) {
            std::swap(real[i], real[j]);
            std::swap(imag[i], imag[j]);
        }
    }
    for (size_t length = 2; length <= kWtSize; length *= 2) {
        const size_t half = length / 2, stride = kWtSize / length;
        for (size_t base = 0; base < kWtSize; base += length) {
            for (size_t k = 0; k < half; ++k) {
                const size_t low = base + k, high = low + half;
                const double wr = cosine[k * stride], wi = sine[k * stride];
                const double re = real[high] * wr - imag[high] * wi;
                const double im = real[high] * wi + imag[high] * wr;
                real[high] = real[low] - re;
                imag[high] = imag[low] - im;
                real[low] += re;
                imag[low] += im;
            }
        }
    }
}

// Called during patch compilation. The resulting data is immutable and can be shared by
// all instances. No FFTs, locks or allocations are needed to read it on the audio thread.
inline const float *wavetable_bank(size_t bank) {
    static std::array<std::once_flag, kWtBanks> ready;
    static std::array<std::vector<float>, kWtBanks> tables;
    std::call_once(ready[bank], [bank] {
        auto &table = tables[bank];
        table.resize(kWtFrames * kWtMips * kWtSize);
        std::array<double, kWtSize / 2> cosine{}, sine{};
        for (size_t i = 0; i < cosine.size(); ++i) {
            const double angle = (2 * kPi * i) / kWtSize;
            cosine[i] = std::cos(angle);
            sine[i] = std::sin(angle);
        }
        std::array<double, kWtSize> real{}, imag{};
        for (size_t frame = 0; frame < kWtFrames; ++frame) {
            double gain = 1;
            for (size_t mip = 0; mip < kWtMips; ++mip) {
                const size_t harmonics = kWtHarmonics >> mip;
                real.fill(0);
                imag.fill(0);
                for (size_t k = 1; k <= harmonics; ++k) {
                    real[k] = kWtSpectra[bank][frame][0][k - 1];
                    imag[k] = -kWtSpectra[bank][frame][1][k - 1];
                }
                wavetable_ifft(real, imag, cosine, sine);
                if (mip == 0) {
                    double peak = 0;
                    for (double value : real) peak = std::max(peak, std::abs(value));
                    gain = peak > 0 ? 1 / peak : 0;
                }
                const size_t start = (frame * kWtMips + mip) * kWtSize;
                for (size_t i = 0; i < kWtSize; ++i) table[start + i] = float(real[i] * gain);
            }
        }
    });
    return tables[bank].data();
}

inline double wavetable_sample(const float *bank, double phase, double inc, double position, double pm) {
    const double t = phase + pm;
    const double x = (t - std::floor(t)) * kWtSize;
    const size_t i = size_t(x), next = (i + 1) % kWtSize;
    const double fraction = x - i;
    const double frame_position = position * (kWtFrames - 1);
    const size_t frame = std::min(size_t(frame_position), kWtFrames - 2);
    size_t mip = 0;
    double boundary = 0.5 / kWtHarmonics;
    while (inc > boundary && mip < kWtMips - 1) { ++mip; boundary *= 2; }
    const size_t stride = kWtMips * kWtSize;
    const size_t base = frame * stride + mip * kWtSize;
    const auto read = [&](size_t start) {
        const double a = bank[start + i], b = bank[start + next];
        return a + fraction * (b - a);
    };
    double a = read(base), b = read(base + stride);
    const double fade_start = kWtFade * boundary;
    if (mip < kWtMips - 1 && inc > fade_start) {
        const double weight = (inc - fade_start) / (boundary - fade_start);
        a += weight * (read(base + kWtSize) - a);
        b += weight * (read(base + stride + kWtSize) - b);
    }
    return a + (frame_position - frame) * (b - a);
}
