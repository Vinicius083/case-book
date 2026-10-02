"""Concordância de codecs entre os dois FFmpeg do worker (ver docs/adr/0001).

O probe usa as libs embutidas no wheel do PyAV; o encode usa o FFmpeg CLI estático.
Se uma atualização de qualquer um dos dois remover um encoder, o pipeline quebra
só em runtime — este teste antecipa a falha para o CI.
"""

import os
import shutil
import subprocess

import av
import pytest

REQUIRED_ENCODERS = ("libx264", "libx265")


def ffmpeg_cli_encoders() -> set[str]:
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg is None:
        if os.environ.get("CI"):
            pytest.fail("ffmpeg não está no PATH (no CI: scripts/fetch_ffmpeg.py)")
        pytest.skip("ffmpeg não está no PATH; rode scripts/fetch_ffmpeg.py ou use a imagem")

    out = subprocess.run(
        [ffmpeg, "-hide_banner", "-encoders"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    # Formato: cabeçalho, linha " ------", depois " V....D libx264   descrição".
    _, _, table = out.partition(" ------\n")
    return {parts[1] for line in table.splitlines() if len(parts := line.split()) >= 2}


@pytest.mark.parametrize("encoder", REQUIRED_ENCODERS)
def test_encoder_available_in_pyav(encoder: str) -> None:
    assert encoder in av.codecs_available
    # Estar listado não basta: o encoder precisa abrir em modo escrita.
    assert av.Codec(encoder, "w").name == encoder


@pytest.mark.parametrize("encoder", REQUIRED_ENCODERS)
def test_encoder_available_in_ffmpeg_cli(encoder: str) -> None:
    assert encoder in ffmpeg_cli_encoders()
