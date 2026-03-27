export interface RuntimeToolSource {
  id: string;
  label: string;
  fileName: string;
  url: string;
  autoInstall: boolean;
}

export const YT_DLP_SOURCE: RuntimeToolSource = {
  id: "yt-dlp",
  label: "yt-dlp",
  fileName: "yt-dlp.exe",
  url: "https://github.com/yt-dlp/yt-dlp/releases/download/2026.03.17/yt-dlp.exe",
  autoInstall: true
};

export const SEVEN_ZR_SOURCE: RuntimeToolSource = {
  id: "7zr",
  label: "7zr helper",
  fileName: "7zr.exe",
  url: "https://www.7-zip.org/a/7zr.exe",
  autoInstall: true
};

export const FFMPEG_SOURCE: RuntimeToolSource = {
  id: "ffmpeg",
  label: "ffmpeg",
  fileName: "ffmpeg.exe",
  url: "https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-2026-03-22-git-9c63742425-essentials_build.7z",
  autoInstall: true
};
