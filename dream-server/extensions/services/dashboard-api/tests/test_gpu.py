"""Tests for gpu.py — tier classification, nvidia-smi parsing, Apple Silicon detection."""

import pytest

from gpu import get_gpu_tier, get_gpu_info_nvidia, get_gpu_info_apple


# --- get_gpu_tier (pure function, no I/O) ---


class TestGetGpuTierDiscrete:
    """Discrete GPU tier boundaries."""

    @pytest.mark.parametrize("vram_gb,expected", [
        (4, "Minimal"),
        (7.9, "Minimal"),
        (8, "Entry"),
        (15.9, "Entry"),
        (16, "Standard"),
        (23.9, "Standard"),
        (24, "Prosumer"),
        (79.9, "Prosumer"),
        (80, "Professional"),
        (128, "Professional"),
    ])
    def test_tiers(self, vram_gb, expected):
        assert get_gpu_tier(vram_gb) == expected


class TestGetGpuTierUnified:
    """Strix Halo (unified memory) tier boundaries."""

    @pytest.mark.parametrize("vram_gb,expected", [
        (64, "Strix Halo Compact"),
        (89.9, "Strix Halo Compact"),
        (90, "Strix Halo 90+"),
        (96, "Strix Halo 90+"),
        (128, "Strix Halo 90+"),
    ])
    def test_tiers(self, vram_gb, expected):
        assert get_gpu_tier(vram_gb, memory_type="unified") == expected


# --- get_gpu_info_nvidia (mock subprocess) ---


class TestGetGpuInfoNvidia:

    def test_parses_valid_output(self, monkeypatch):
        csv = "NVIDIA GeForce RTX 4090, 2048, 24564, 35, 62, 285.5"
        monkeypatch.setattr("gpu.run_command", lambda cmd, **kw: (True, csv))

        info = get_gpu_info_nvidia()
        assert info is not None
        assert info.name == "NVIDIA GeForce RTX 4090"
        assert info.memory_used_mb == 2048
        assert info.memory_total_mb == 24564
        assert info.utilization_percent == 35
        assert info.temperature_c == 62
        assert info.power_w == 285.5
        assert info.gpu_backend == "nvidia"

    def test_handles_na_power(self, monkeypatch):
        csv = "Tesla T4, 1024, 16384, 10, 45, [N/A]"
        monkeypatch.setattr("gpu.run_command", lambda cmd, **kw: (True, csv))

        info = get_gpu_info_nvidia()
        assert info is not None
        assert info.power_w is None

    def test_returns_none_on_command_failure(self, monkeypatch):
        monkeypatch.setattr("gpu.run_command", lambda cmd, **kw: (False, ""))

        assert get_gpu_info_nvidia() is None

    def test_returns_none_on_empty_output(self, monkeypatch):
        monkeypatch.setattr("gpu.run_command", lambda cmd, **kw: (True, ""))

        assert get_gpu_info_nvidia() is None

    def test_returns_none_on_malformed_output(self, monkeypatch):
        monkeypatch.setattr("gpu.run_command", lambda cmd, **kw: (True, "garbage"))

        assert get_gpu_info_nvidia() is None

    def test_multi_gpu_aggregation(self, monkeypatch):
        csv = (
            "NVIDIA GeForce RTX 4090, 2048, 24564, 35, 62, 285.5\n"
            "NVIDIA GeForce RTX 4090, 4096, 24564, 50, 70, 300.0"
        )
        monkeypatch.setattr("gpu.run_command", lambda cmd, **kw: (True, csv))

        info = get_gpu_info_nvidia()
        assert info is not None
        assert "× 2" in info.name
        assert info.memory_used_mb == 2048 + 4096
        assert info.memory_total_mb == 24564 * 2


# --- get_gpu_info_apple (mock subprocess) ---


class TestGetGpuInfoApple:

    def test_returns_none_on_non_darwin(self, monkeypatch):
        monkeypatch.setattr("gpu.platform.system", lambda: "Linux")
        assert get_gpu_info_apple() is None

    def test_parses_apple_silicon(self, monkeypatch):
        monkeypatch.setattr("gpu.platform.system", lambda: "Darwin")

        def mock_run_command(cmd, **kw):
            if "machdep.cpu.brand_string" in cmd:
                return True, "Apple M4 Max"
            if "hw.memsize" in cmd:
                return True, str(64 * 1024**3)  # 64 GB
            if cmd == ["vm_stat"]:
                return True, (
                    "Mach Virtual Memory Statistics: (page size of 16384 bytes)\n"
                    "Pages active:                          500000.\n"
                    "Pages wired down:                      300000.\n"
                    "Pages occupied by compressor:          100000.\n"
                )
            return False, ""

        monkeypatch.setattr("gpu.run_command", mock_run_command)

        info = get_gpu_info_apple()
        assert info is not None
        assert info.name == "Apple M4 Max"
        assert info.memory_total_mb == 64 * 1024
        assert info.gpu_backend == "apple"
        assert info.memory_type == "unified"
        assert info.memory_used_mb > 0

    def test_returns_none_when_sysctl_fails(self, monkeypatch):
        monkeypatch.setattr("gpu.platform.system", lambda: "Darwin")
        monkeypatch.setattr("gpu.run_command", lambda cmd, **kw: (False, ""))
        assert get_gpu_info_apple() is None
