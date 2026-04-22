import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Echo",
    short_name: "Echo",
    description: "一个黑白极简的跨设备消息同步与整理工具",
    start_url: "/",
    display: "standalone",
    background_color: "#f5f5f5",
    theme_color: "#f5f5f5",
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
