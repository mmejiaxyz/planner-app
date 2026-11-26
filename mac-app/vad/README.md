# Voice activity detection model

`ggml-silero-v6.2.0.bin` (about 0.9 MB) is the Silero VAD model converted to ggml for whisper.cpp.

- Source: https://huggingface.co/ggml-org/whisper-vad
- Silero VAD: https://github.com/snakers4/silero-vad (MIT)
- whisper.cpp VAD support: https://github.com/ggml-org/whisper.cpp

`build.sh` copies it into `Planner.app/Contents/Resources/`. The app passes it to `whisper-cli --vad`, so silence is
skipped instead of being transcribed as words. A newer `ggml-silero*.bin` in `~/Library/Application Support/Planner/models/`
wins over this copy.
