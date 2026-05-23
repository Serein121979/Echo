export type ClipKind = "text" | "code";

export type ClipRecord = {
  id: string;
  content: string;
  kind: ClipKind;
  sourceDeviceId: string;
  sourcePlatform: string;
  isPinned: boolean;
  createdAt: string;
};
