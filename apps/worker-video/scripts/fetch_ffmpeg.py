"""Baixa o FFmpeg estático fixado, confere o SHA256 e extrai `ffmpeg` e `ffprobe`.

Fonte única da versão do FFmpeg CLI: usado pelo Dockerfile e pelo CI, para que o
teste de concordância de codecs rode contra o mesmo binário da imagem.
Só stdlib — roda na imagem python slim, sem curl nem xz-utils.

    python scripts/fetch_ffmpeg.py <diretório de destino>

Para atualizar: escolha um autobuild de FIM DE MÊS em
https://github.com/BtbN/FFmpeg-Builds/releases (os diários são apagados após ~14
dias), mantenha o mesmo major do FFmpeg embutido no wheel do PyAV e copie o hash
do `checksums.sha256` do release. Ver docs/adr/0001.
"""

import hashlib
import platform
import sys
import tarfile
import tempfile
import urllib.request
from pathlib import Path

RELEASE = "autobuild-2026-09-30-13-08"
BUILD = "ffmpeg-n8.1.3-9-g29e619e767-linux64-gpl-8.1"
SHA256 = "97ce978979194b5cf7e06a5e68020dbdaa7a4f3294c5452b6a1bc347100dbb79"
URL = f"https://github.com/BtbN/FFmpeg-Builds/releases/download/{RELEASE}/{BUILD}.tar.xz"
BINARIES = ("ffmpeg", "ffprobe")


def main(dest: Path) -> None:
    if (platform.system(), platform.machine()) != ("Linux", "x86_64"):
        sys.exit("build fixado é linux/amd64; para arm64 use o asset linuxarm64-gpl")

    dest.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        tarball = Path(tmp) / "ffmpeg.tar.xz"
        digest = hashlib.sha256()
        with urllib.request.urlopen(URL) as res, tarball.open("wb") as out:
            while chunk := res.read(1 << 20):
                digest.update(chunk)
                out.write(chunk)

        if digest.hexdigest() != SHA256:
            sys.exit(f"SHA256 não confere: esperado {SHA256}, obtido {digest.hexdigest()}")

        with tarfile.open(tarball) as tar:
            for name in BINARIES:
                member = tar.getmember(f"{BUILD}/bin/{name}")
                src = tar.extractfile(member)
                if src is None:
                    sys.exit(f"{name} não encontrado no tarball")
                target = dest / name
                target.write_bytes(src.read())
                target.chmod(0o755)

    print(f"{BUILD} (sha256 ok) → {', '.join(str(dest / b) for b in BINARIES)}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(Path(sys.argv[1]))
