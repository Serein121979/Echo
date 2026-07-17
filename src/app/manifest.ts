import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Echo",
    short_name: "Echo",
    description: "私人跨设备信息收件箱与 AI 检索助手",
    start_url: "/",
    display: "standalone",
    background_color: "#eef1f4",
    theme_color: "#ffffff",
    share_target: {
      action: "/share",
      method: "POST",
      enctype: "multipart/form-data",
      params: {
        title: "title",
        text: "text",
        url: "url",
        files: [
          {
            name: "file",
            accept: ["image/*", "*/*"],
          },
        ],
      },
    },
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
